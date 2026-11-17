import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const sqlFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "account_orphan_invariant.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  try {
    const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", sqlFile], {
      env: { ...process.env, PGPASSWORD: "postgres" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    const reportLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("[") && line.endsWith("]"));
    if (!reportLine)
      return { checks: [], error: `no report emitted:\n${stdout}` };
    return { checks: JSON.parse(reportLine) as Check[] };
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runPsql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
      env: { ...process.env, PGPASSWORD: "postgres" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
    });
    child.stdin.end(sql);
  });
}

const { checks, error } = runSuite();

describe("no orphaned accounts", () => {
  if (bailIfDbUnreachable(error)) return;

  // An account with no active membership is unreachable forever. Four code
  // paths used to commit one, and the demo clear did it on every successful
  // cycle. These checks cover both halves of the repair: the paths delete it
  // (or keep it reachable), and the deferred constraint triggers REJECT the
  // state so a future path that forgets fails loudly instead of leaking.
  //
  // The negative cases force the commit-time check with `set constraints all
  // immediate` — without that they would pass whether or not the triggers
  // exist, because this suite runs inside a transaction it rolls back.
  it("makes an orphaned account impossible and deletes the demo root when the demo ends", () => {
    expect(DB_URL).not.toContain(":54322/");
    expect(checks.length).toBeGreaterThanOrEqual(27);
    for (const check of checks) {
      expect(check.passed, check.detail ?? check.name).toBe(true);
    }
  });

  it("serializes writer-first and delete-first account lock interleavings", async () => {
    expect(DB_URL).not.toContain(":54322/");

    const token = randomUUID().replaceAll("-", "");
    const userId = randomUUID();
    const accountName = `lock-race-${token}`;
    const setup = await runPsql(`
      begin;
      set local role postgres;
      insert into auth.users (id, instance_id, aud, role, email)
      values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userId}@test.invalid')
      on conflict (id) do nothing;
      insert into public.accounts (name, kind)
      values ('${accountName}', 'household')
      returning id as account_id \\gset
      insert into public.account_members (account_id, user_id, role, status)
      values (:account_id, '${userId}', 'parent_admin', 'active');
      insert into public.singles (account_id, first_name_en)
      values (:account_id, 'Lock Race')
      returning id as single_id \\gset
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
      select public.set_active_context(:account_id);
      select id as shidduch_id
      from public.create_shidduch(
        p_single_id => :single_id,
        p_name_en => 'Lock Race Suggestion',
        p_person_gender => 'male'
      ) \\gset
      commit;
      \\pset tuples_only on
      \\pset format unaligned
      select :account_id || ',' || :shidduch_id;
    `);
    const setupLine = setup
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+,\d+$/.test(line));
    if (!setupLine)
      throw new Error(`could not parse lock race setup: ${setup}`);
    const [accountId, shidduchId] = setupLine.split(",");

    const writerFirst = async () => {
      const writer = runPsql(`
        begin;
        set local statement_timeout = '5s';
        select id from public.shidduchim
        where id = ${shidduchId} and account_id = ${accountId}
        for share;
        select pg_sleep(1);
        select public.account_storage_lock(${accountId});
        commit;
      `);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const deleter = runPsql(`
        begin;
        set local statement_timeout = '5s';
        select public.account_storage_cleanup_fence(${accountId});
        rollback;
      `);
      await Promise.all([writer, deleter]);
    };

    const deleteFirst = async () => {
      const deleter = runPsql(`
        begin;
        set local statement_timeout = '5s';
        select id from public.shidduchim
        where id = ${shidduchId} and account_id = ${accountId}
        order by id
        for update;
        select pg_sleep(1);
        select public.account_storage_lock(${accountId});
        rollback;
      `);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const writer = runPsql(`
        begin;
        set local statement_timeout = '5s';
        select id from public.shidduchim
        where id = ${shidduchId} and account_id = ${accountId}
        for share;
        select public.account_storage_lock(${accountId});
        rollback;
      `);
      await Promise.all([deleter, writer]);
    };

    try {
      await writerFirst();
      await deleteFirst();
    } finally {
      await runPsql(`
        set role postgres;
        delete from public.accounts where id = ${accountId};
        delete from public.deleted_shidduch_tombstones
        where account_id = ${accountId};
      `);
    }
  });
});
