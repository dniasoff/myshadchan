import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

type Fixture = {
  accountId: number;
  resumeAId: number;
  resumeBId: number;
};

function runPsqlScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"]);
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
      if (code !== 0) {
        reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(script);
    child.stdin.end();
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
    const child = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"]);
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
    child.stdin.write(script);
    child.stdin.end();
  });

  return { ready, done };
}

function extractValue(stdout: string, label: string): number {
  const match = stdout.match(new RegExp(`${label}=(\\d+)`));
  if (!match) {
    throw new Error(`missing ${label} in psql output:\n${stdout}`);
  }
  return Number(match[1]);
}

async function seedFixture(): Promise<Fixture> {
  const stdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where name = 'Resume Reference Concurrency Fixture';
delete from public.members where user_id = '77770000-0000-0000-0000-000000000001';
delete from auth.users where id = '77770000-0000-0000-0000-000000000001';
insert into auth.users (id, instance_id, aud, role, email)
values (
  '77770000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'resume-reference-concurrency@test.local'
);
begin;
insert into public.accounts (name, kind)
values ('Resume Reference Concurrency Fixture', 'household')
returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '77770000-0000-0000-0000-000000000001', 'parent_admin', 'active');
insert into public.singles (account_id, first_name_en, gender)
values (:account_id, 'Concurrency Single', 'female')
returning id as single_id \\gset
set local session_replication_role = replica;
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Concurrency suggestion A')
returning id as shidduch_a_id \\gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Concurrency suggestion B')
returning id as shidduch_b_id \\gset
insert into public.resumes (account_id, shidduchim_id, sections)
values (:account_id, :shidduch_a_id, jsonb_build_object('references', jsonb_build_array(
  jsonb_build_object('name', 'Concurrent Person', 'phone', '555-123-4567', 'relationship', 'friend')
)))
returning id as resume_a_id \\gset
insert into public.resumes (account_id, shidduchim_id, sections)
values (:account_id, :shidduch_b_id, jsonb_build_object('references', jsonb_build_array(
  jsonb_build_object('name', 'Concurrent Person', 'phone', '555-123-4567', 'relationship', 'friend')
)))
returning id as resume_b_id \\gset
set local session_replication_role = origin;
commit;
\\echo ACCOUNT_ID=:account_id
\\echo RESUME_A_ID=:resume_a_id
\\echo RESUME_B_ID=:resume_b_id
`);

  return {
    accountId: extractValue(stdout, "ACCOUNT_ID"),
    resumeAId: extractValue(stdout, "RESUME_A_ID"),
    resumeBId: extractValue(stdout, "RESUME_B_ID"),
  };
}

async function teardownFixture(fixture: Fixture): Promise<void> {
  await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where id = ${fixture.accountId};
delete from public.members where user_id = '77770000-0000-0000-0000-000000000001';
delete from auth.users where id = '77770000-0000-0000-0000-000000000001';
`);
}

let dbError: string | undefined;
let fixture: Fixture | undefined;

try {
  await runPsqlScript("select 1;");
} catch (error) {
  dbError = error instanceof Error ? error.message : String(error);
}

describe("resume reference reconciliation under concurrent suggestions", () => {
  if (bailIfDbUnreachable(dbError)) return;

  beforeAll(async () => {
    fixture = await seedFixture();
  });

  afterAll(async () => {
    if (fixture) await teardownFixture(fixture);
  });

  it("serializes same-person identity creation across two real sessions", async () => {
    const currentFixture = fixture;
    if (!currentFixture) throw new Error("concurrency fixture was not seeded");

    const lockKey = `resume-reference-account:${currentFixture.accountId}`;
    const blocker = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
select 'ACCOUNT_LOCK_HELD' as marker;
select pg_sleep(1.0);
commit;
`,
      "ACCOUNT_LOCK_HELD",
    );

    await blocker.ready;
    const rpc = (resumeId: number) =>
      runPsqlScript(`
\\set ON_ERROR_STOP on
select public.sync_resume_references_for_account(
  ${resumeId}, ${currentFixture.accountId}
);
`);

    const calls = await Promise.all([
      rpc(currentFixture.resumeAId),
      rpc(currentFixture.resumeBId),
      blocker.done,
    ]);
    expect(calls).toHaveLength(3);

    const counts = await runPsqlScript(`
\\set ON_ERROR_STOP on
select count(*) as identity_count
  from public."references"
 where account_id = ${currentFixture.accountId}
   and name_norm_en = 'concurrent person'
   and phone_norm = '5551234567' \\gset
select count(*) as link_count
  from public.reference_links rl
  join public."references" r on r.id = rl.reference_id
 where rl.account_id = ${currentFixture.accountId}
   and r.name_norm_en = 'concurrent person' \\gset
\\echo IDENTITY_COUNT=:identity_count
\\echo LINK_COUNT=:link_count
`);

    expect(extractValue(counts, "IDENTITY_COUNT")).toBe(1);
    expect(extractValue(counts, "LINK_COUNT")).toBe(2);
  });
});
