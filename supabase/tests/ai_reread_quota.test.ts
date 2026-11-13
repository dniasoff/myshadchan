import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "ai_reread_quota.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runPsqlScriptUntil(
  script: string,
  marker: string,
): { ready: Promise<void>; done: Promise<string> } {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const done = new Promise<string>((resolve, reject) => {
    const child = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"]);
    let stdout = "";
    let stderr = "";
    let seen = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!seen && stdout.includes(marker)) {
        seen = true;
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!seen) resolveReady();
      if (code === 0) resolve(stdout);
      else reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
    });
    child.stdin.end(script);
  });
  return { ready, done };
}

function runSuite(): { checks: Check[]; error?: string } {
  try {
    const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    const report = stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("[") && line.endsWith("]"));
    return report
      ? { checks: JSON.parse(report) as Check[] }
      : { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const { checks, error } = runSuite();

describe("B2a re-read quota ledger (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs all ledger, CAS-trigger and privilege checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(10);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }

  it("serializes two real concurrent claims to one reservation", async () => {
    const ownerUserId = crypto.randomUUID();
    const setupSql = `
      insert into auth.users (id, instance_id, aud, role, email)
      values ('${ownerUserId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${ownerUserId}@reread.test');
      select (public.create_account_with_owner('Re-read concurrency test account', 'household', '${ownerUserId}'::uuid, 'parent_admin')->>'account_id')::bigint as account_id \\gset
      insert into public.subscription (account_id, plan, status)
      values (:account_id, 'ai', 'active');
      insert into public.singles (account_id, first_name_en)
      values (:account_id, 'Concurrency test single')
      returning id as single_id \\gset
      insert into public.shidduchim (account_id, single_id, name_en)
      values (:account_id, :single_id, 'Concurrency test shidduch')
      returning id as shidduch_id \\gset
      insert into public.resumes (account_id, shidduchim_id, files, sections)
      values (:account_id, :shidduch_id, '[]'::jsonb, '{"references":[],"additionalSections":[]}'::jsonb)
      returning id as resume_id \\gset
      select :account_id || ',' || :resume_id;
    `;
    const setupOutput = execFileSync(
      "psql",
      [DB_URL, "-X", "-At", "-F", ",", "-f", "-"],
      { encoding: "utf8", input: setupSql, timeout: 30_000 },
    ).trim();
    const setup = setupOutput
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+,\d+$/.test(line));
    if (!setup)
      throw new Error(`concurrency fixture did not return ids: ${setupOutput}`);
    const [accountId, resumeId] = setup.split(",");
    expect(accountId).toBeTruthy();
    expect(resumeId).toBeTruthy();

    try {
      const first = runPsqlScriptUntil(
        `begin;
         select public.claim_ai_reread_attempt(${accountId}, ${resumeId}, '20000000-0000-4000-8000-000000000001', 4::smallint);
         select 'REREAD_CLAIM_READY';
         select pg_sleep(2);
         commit;
        `,
        "REREAD_CLAIM_READY",
      );
      await first.ready;
      const second = execFileSync(
        "psql",
        [
          DB_URL,
          "-X",
          "-At",
          "-c",
          `select public.claim_ai_reread_attempt(${accountId}, ${resumeId}, '20000000-0000-4000-8000-000000000001', 4::smallint);`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      await first.done;

      expect(second).toContain('"outcome": "in_progress"');
      const verification = execFileSync(
        "psql",
        [
          DB_URL,
          "-X",
          "-At",
          "-c",
          `select (select resumes_parsed from public.ai_usage where account_id = ${accountId} and period = to_char(now(), 'YYYY-MM')) || ':' || (select count(*) from public.ai_reread_attempts where account_id = ${accountId});`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      ).trim();
      expect(verification).toBe("1:1");
    } finally {
      execFileSync(
        "psql",
        [
          DB_URL,
          "-X",
          "-q",
          "-c",
          `delete from public.ai_reread_attempts where account_id = ${accountId};
           delete from public.ai_usage where account_id = ${accountId};
           delete from public.subscription where account_id = ${accountId};
           delete from public.resumes where account_id = ${accountId};
           delete from public.shidduchim where account_id = ${accountId};
           delete from public.singles where account_id = ${accountId};
           delete from public.account_members where account_id = ${accountId};
           delete from public.accounts where id = ${accountId};
           delete from public.members where user_id = '${ownerUserId}';
           delete from auth.users where id = '${ownerUserId}';`,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
        },
      );
    }
  });
});
