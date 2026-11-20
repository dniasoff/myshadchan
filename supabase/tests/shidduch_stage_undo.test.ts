import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shidduch_stage_undo.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function isolatedScript(): string {
  return [
    "\\pset format unaligned",
    "\\pset tuples_only on",
    "\\pset columns 0",
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
    `\\i ${SQL_FILE}`,
  ].join("\n");
}

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      input: isolatedScript(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { checks: [], error: message };
  }

  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));

  if (!reportLine) {
    return { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
  }

  return { checks: JSON.parse(reportLine) as Check[] };
}

const { checks, error } = runSuite();

describe("shidduch stage undo (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBe(16);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});

function runPsqlScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      env: process.env,
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
    child.stdin.end(script);
  });
}

function runPsqlScriptUntil(
  script: string,
  marker: string,
): { ready: Promise<void>; done: Promise<string> } {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const done = new Promise<string>((resolve, reject) => {
    const child = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let seenMarker = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!seenMarker && stdout.includes(marker)) {
        seenMarker = true;
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(script);
  });

  return { ready, done };
}

describe("shidduch stage undo versus account purge", () => {
  if (bailIfDbUnreachable(error)) return;

  it("completes repeated parent-first races without deadlock", async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const token = `${randomUUID().replaceAll("-", "")}_${attempt}`;
      const userId = randomUUID();
      const resultTable = `stage_undo_race_${token}`;
      const setup = await runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email)
values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userId}@test.invalid');
insert into public.accounts (name) values ('stage undo race ${token}') returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '${userId}', 'parent_admin', 'active') returning id as member_id \\gset
insert into public.member_state (user_id, active_account_id)
values ('${userId}', :account_id)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.singles (account_id, first_name_en)
values (:account_id, 'Undo race') returning id as single_id \\gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:account_id, :single_id, :member_id) returning id as shidduch_id \\gset
create table public.${resultTable} (
  runner text primary key,
  completed boolean not null,
  sqlstate_code text,
  error_message text
);
grant insert on public.${resultTable} to authenticated;
commit;
set role authenticated;
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select public.transition_shidduch(:shidduch_id, 'new', 'look_into') as transition_result \\gset
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select :account_id || ',' || :shidduch_id;
`);
      const fixture = setup
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^\d+,\d+$/.test(line));
      if (!fixture) throw new Error(`could not parse race fixture: ${setup}`);
      const [accountId, shidduchId] = fixture.split(",");

      const undo = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
do $$
begin
  perform public.undo_shidduch(${shidduchId});
  insert into public.${resultTable} values ('undo', true, null, null);
exception when others then
  insert into public.${resultTable} values ('undo', false, sqlstate, sqlerrm);
end
$$;
commit;
`);
      const purge = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
do $$
begin
  perform public.delete_account_data(${accountId}, '${userId}'::uuid, false);
  insert into public.${resultTable} values ('purge', true, null, null);
exception when others then
  insert into public.${resultTable} values ('purge', false, sqlstate, sqlerrm);
end
$$;
commit;
`);

      try {
        await Promise.all([undo, purge]);
        const report = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role postgres;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select json_agg(row_to_json(r) order by r.runner)
from (
  select runner, completed, coalesce(sqlstate_code, '') as sqlstate_code,
         coalesce(error_message, '') as error_message
  from public.${resultTable}
) r;
`);
        const rows = JSON.parse(report.trim()) as Array<{
          runner: string;
          completed: boolean;
          sqlstate_code: string;
          error_message: string;
        }>;
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(["undo", "purge"]).toContain(row.runner);
          expect(row.sqlstate_code).not.toBe("40P01");
          expect(row.sqlstate_code).not.toBe("57014");
          if (row.runner === "purge") {
            expect(row.completed).toBe(true);
          }
          if (row.runner === "undo" && !row.completed) {
            expect(["P0001", "42501"]).toContain(row.sqlstate_code);
            expect([
              `shidduch ${shidduchId} not found`,
              `undo is not available for shidduch ${shidduchId}`,
            ]).toContain(row.error_message);
          }
        }
      } finally {
        await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id = ${accountId};
`);
      }
    }
  });

  it("holds purge parents before starting undo, then completes the second lock without deadlock", async () => {
    const token = `${randomUUID().replaceAll("-", "")}_barrier`;
    const userId = randomUUID();
    const resultTable = `stage_undo_barrier_${token}`;
    const setup = await runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email)
values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userId}@test.invalid');
insert into public.accounts (name) values ('stage undo barrier ${token}') returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '${userId}', 'parent_admin', 'active') returning id as member_id \\gset
insert into public.member_state (user_id, active_account_id)
values ('${userId}', :account_id)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.singles (account_id, first_name_en)
values (:account_id, 'Undo barrier') returning id as single_id \\gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:account_id, :single_id, :member_id) returning id as shidduch_id \\gset
create table public.${resultTable} (
  runner text primary key,
  completed boolean not null,
  sqlstate_code text,
  error_message text
);
grant insert on public.${resultTable} to authenticated;
commit;
set role authenticated;
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select public.transition_shidduch(:shidduch_id, 'new', 'look_into') as transition_result \\gset
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select :account_id || ',' || :shidduch_id;
`);
    const fixture = setup
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+,\d+$/.test(line));
    if (!fixture) throw new Error(`could not parse barrier fixture: ${setup}`);
    const [accountId, shidduchId] = fixture.split(",");

    // Session A owns the first purge locks and keeps them open. Session B is
    // started only after that marker, so the old fence-first undo order would
    // hold the account key-share lock while waiting on these parents; A then
    // requests the account row and PostgreSQL deterministically detects 40P01.
    const purge = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select 1 from public.singles
where account_id = ${accountId}
order by id
for update;
select 1 from public.shidduchim
where account_id = ${accountId}
order by id
for update;
\\echo PURGE_PARENTS_READY
select pg_sleep(1);
do $$
begin
  perform public.delete_account_data(${accountId}, '${userId}'::uuid, false);
  insert into public.${resultTable} values ('purge', true, null, null);
exception when others then
  insert into public.${resultTable} values ('purge', false, sqlstate, sqlerrm);
end
$$;
commit;
`,
      "PURGE_PARENTS_READY",
    );
    await purge.ready;

    const undo = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
do $$
begin
  perform public.undo_shidduch(${shidduchId});
  insert into public.${resultTable} values ('undo', true, null, null);
exception when others then
  insert into public.${resultTable} values ('undo', false, sqlstate, sqlerrm);
end
$$;
commit;
`);

    try {
      await Promise.all([purge.done, undo]);
      const report = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role postgres;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select json_agg(row_to_json(r) order by r.runner)
from (
  select runner, completed, coalesce(sqlstate_code, '') as sqlstate_code,
         coalesce(error_message, '') as error_message
  from public.${resultTable}
) r;
`);
      const rows = JSON.parse(report.trim()) as Array<{
        runner: string;
        completed: boolean;
        sqlstate_code: string;
        error_message: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.runner === "purge")?.completed).toBe(true);
      const undoRow = rows.find((row) => row.runner === "undo");
      expect(undoRow?.sqlstate_code).not.toBe("40P01");
      expect(undoRow?.sqlstate_code).not.toBe("57014");
      expect(undoRow?.completed).toBe(false);
    } finally {
      await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id = ${accountId};
delete from auth.users where id = '${userId}';
`);
    }
  });

  it("serializes reciprocal accepted-edit undo calls through an advisory barrier", async () => {
    const token = `${randomUUID().replaceAll("-", "")}_reciprocal`;
    const userA = randomUUID();
    const userB = randomUUID();
    const resultTable = `stage_undo_reciprocal_${token}`;
    const gateKey = "9223372036854770000";
    const setup = await runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email)
values
  ('${userA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userA}@test.invalid'),
  ('${userB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userB}@test.invalid');
insert into public.accounts (name) values ('stage undo reciprocal A') returning id as account_a \\gset
insert into public.accounts (name) values ('stage undo reciprocal B') returning id as account_b \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '${userA}', 'parent_admin', 'active') returning id as member_a \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '${userB}', 'parent_admin', 'active') returning id as member_b \\gset
insert into public.member_state (user_id, active_account_id)
values ('${userA}', :account_a), ('${userB}', :account_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.singles (account_id, first_name_en)
values (:account_a, 'Reciprocal A') returning id as single_a \\gset
insert into public.singles (account_id, first_name_en)
values (:account_b, 'Reciprocal B') returning id as single_b \\gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:account_a, :single_a, :member_a) returning id as shidduch_a \\gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:account_b, :single_b, :member_b) returning id as shidduch_b \\gset
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:account_a, :single_a, 'stage-undo-reciprocal-a', 'accepted', now() + interval '30 days', :account_b, now(), 'edit'),
  (:account_b, :single_b, 'stage-undo-reciprocal-b', 'accepted', now() + interval '30 days', :account_a, now(), 'edit');
create table public.${resultTable} (
  runner text primary key,
  completed boolean not null,
  sqlstate_code text,
  error_message text
);
grant insert on public.${resultTable} to authenticated;
commit;
set role authenticated;
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
select public.transition_shidduch(:shidduch_b, 'new', 'look_into');
set request.jwt.claims = '{"sub":"${userB}","role":"authenticated"}';
select public.transition_shidduch(:shidduch_a, 'new', 'look_into');
reset role;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select :account_a || ',' || :account_b || ',' || :single_a || ',' || :single_b || ',' || :shidduch_a || ',' || :shidduch_b;
`);
    const fixture = setup
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(\d+,){5}\d+$/.test(line));
    if (!fixture) {
      throw new Error(`could not parse reciprocal fixture: ${setup}`);
    }
    const [accountA, accountB, , , shidduchA, shidduchB] = fixture.split(",");

    // The controller holds a session-level advisory barrier while both real
    // sessions lock their first (owner parent) rows. Releasing both callers
    // together makes the old owner-then-caller order hit its reciprocal cycle;
    // the fixed implementation takes the two account ids in one order.
    const gate = runPsqlScriptUntil(
      `select pg_advisory_lock(${gateKey});
\\echo RECIPROCAL_GATE_HELD
select pg_sleep(2);
`,
      "RECIPROCAL_GATE_HELD",
    );
    await gate.ready;

    const undoA = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountB} order by id for update;
select 1 from public.shidduchim where account_id = ${accountB} order by id for update;
select pg_advisory_lock(${gateKey});
do $$
begin
  perform public.undo_shidduch(${shidduchB});
  insert into public.${resultTable} values ('undo_a', true, null, null);
exception when others then
  insert into public.${resultTable} values ('undo_a', false, sqlstate, sqlerrm);
end
$$;
commit;
`);
    const undoB = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userB}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountA} order by id for update;
select 1 from public.shidduchim where account_id = ${accountA} order by id for update;
select pg_advisory_lock(${gateKey});
do $$
begin
  perform public.undo_shidduch(${shidduchA});
  insert into public.${resultTable} values ('undo_b', true, null, null);
exception when others then
  insert into public.${resultTable} values ('undo_b', false, sqlstate, sqlerrm);
end
$$;
commit;
`);

    try {
      await Promise.all([gate.done, undoA, undoB]);
      const report = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role postgres;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select json_agg(row_to_json(r) order by r.runner)
from (
  select runner, completed, coalesce(sqlstate_code, '') as sqlstate_code,
         coalesce(error_message, '') as error_message
  from public.${resultTable}
) r;
`);
      const rows = JSON.parse(report.trim()) as Array<{
        runner: string;
        completed: boolean;
        sqlstate_code: string;
        error_message: string;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.completed, row.error_message).toBe(true);
        expect(row.sqlstate_code).not.toBe("40P01");
        expect(row.sqlstate_code).not.toBe("57014");
      }
    } finally {
      await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id in (${accountA}, ${accountB});
delete from auth.users where id in ('${userA}', '${userB}');
`);
    }
  });
});
