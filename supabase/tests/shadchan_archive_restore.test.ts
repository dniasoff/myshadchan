import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shadchan_archive_restore.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  const result = spawnSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
    input: [
      "\\set ON_ERROR_STOP on",
      "begin;",
      "delete from public.account_members;",
      `\\i ${SQL_FILE}`,
    ].join("\n"),
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    return {
      checks: [],
      error: [
        result.error instanceof Error ? result.error.message : "psql failed",
        stderr.trim(),
        stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));
  return reportLine
    ? { checks: JSON.parse(reportLine) as Check[] }
    : {
        checks: [],
        error: `no report emitted:\n${stderr}\n${stdout.slice(-2000)}`,
      };
}

const { checks, error } = runSuite();

describe("shadchan archive/restore (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the lifecycle and safety checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(11);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Lifecycle lock protocol: archive/restore, enqueue and claim all acquire
// account advisory fence -> shadchan row lock. These tests deliberately use
// two real PostgreSQL sessions so an archive cannot silently race a queue
// insert or a claim hand-off.
// ---------------------------------------------------------------------------

const CONCURRENCY_USER_ID = "76000000-0000-4000-8000-000000000001";
const CONCURRENCY_ACCOUNT_NAME = "Shadchan lifecycle lock fixture";

type LifecycleFixture = {
  accountId: number;
  shadchanId: number;
  taskId: number;
  singleId: number;
  shidduchId: number;
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

function extractOutputNumber(stdout: string, label: string): number {
  const match = stdout.match(new RegExp(`${label}=(-?\\d+)`));
  if (!match) throw new Error(`missing ${label} in psql output:\n${stdout}`);
  return Number(match[1]);
}

function extractOutputBoolean(stdout: string, label: string): boolean {
  const match = stdout.match(new RegExp(`${label}=(t|f)`));
  if (!match) throw new Error(`missing ${label} in psql output:\n${stdout}`);
  return match[1] === "t";
}

function extractOutputValue(stdout: string, label: string): string {
  const match = stdout.match(new RegExp(label + "=([^\r\n]*)"));
  if (!match)
    throw new Error("missing " + label + " in psql output:\n" + stdout);
  return match[1].trim();
}

function runAccountPurgeHoldingParents(fixture: LifecycleFixture): {
  ready: Promise<void>;
  done: Promise<string>;
} {
  return runPsqlScriptUntil(
    `
\\set ON_ERROR_STOP on
set role postgres;
begin;
-- Account purge locks all parent rows before the shared advisory fence.
select id from public.singles
where id = ${fixture.singleId} and account_id = ${fixture.accountId}
for update;
select id from public.shidduchim
where id = ${fixture.shidduchId} and account_id = ${fixture.accountId}
for update;
\\echo PURGE_PARENTS_READY
select pg_sleep(1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
select public.delete_account_data(
  ${fixture.accountId},
  '${CONCURRENCY_USER_ID}',
  false
);
commit;
\\echo PURGE_COMPLETED
`,
    "PURGE_PARENTS_READY",
  );
}

async function seedLifecycleFixture(): Promise<LifecycleFixture> {
  const stdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where name = '${CONCURRENCY_ACCOUNT_NAME}';
delete from public.members where user_id = '${CONCURRENCY_USER_ID}';
delete from auth.users where id = '${CONCURRENCY_USER_ID}';
insert into auth.users (id, instance_id, aud, role, email)
values ('${CONCURRENCY_USER_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle-lock@test.local');
begin;
insert into public.accounts (name, kind)
values ('${CONCURRENCY_ACCOUNT_NAME}', 'household')
returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '${CONCURRENCY_USER_ID}', 'parent_admin', 'active');
select id as member_id from public.members where user_id = '${CONCURRENCY_USER_ID}' \\gset
insert into public.shadchanim (account_id, name)
values (:account_id, 'Lifecycle lock target')
returning id as shadchan_id \\gset
insert into public.singles (account_id, first_name_en)
values (:account_id, 'Lifecycle lock single')
returning id as single_id \\gset
insert into public.shidduchim (account_id, single_id, shadchan_id, name_en)
values (:account_id, :single_id, :shadchan_id, 'Lifecycle lock shidduch')
returning id as shidduch_id \\gset
insert into public.tasks (
  account_id, target_type, target_id, text, due_date, member_id, delivery_channels
)
values (
  :account_id, 'shadchan', :shadchan_id, 'Lifecycle lock reminder',
  now() - interval '1 hour', :member_id, array['email']
)
returning id as task_id \\gset
commit;
\\echo ACCOUNT_ID=:account_id
\\echo SHADCHAN_ID=:shadchan_id
\\echo SINGLE_ID=:single_id
\\echo SHIDDUCH_ID=:shidduch_id
\\echo TASK_ID=:task_id
`);
  return {
    accountId: extractOutputNumber(stdout, "ACCOUNT_ID"),
    shadchanId: extractOutputNumber(stdout, "SHADCHAN_ID"),
    taskId: extractOutputNumber(stdout, "TASK_ID"),
    singleId: extractOutputNumber(stdout, "SINGLE_ID"),
    shidduchId: extractOutputNumber(stdout, "SHIDDUCH_ID"),
  };
}

async function teardownLifecycleFixture(
  fixture: LifecycleFixture,
): Promise<void> {
  await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where id = ${fixture.accountId};
delete from public.members where user_id = '${CONCURRENCY_USER_ID}';
delete from auth.users where id = '${CONCURRENCY_USER_ID}';
`);
}

describe("shadchan lifecycle locks (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  let fixture: LifecycleFixture;

  beforeEach(async () => {
    fixture = await seedLifecycleFixture();
  });

  afterEach(async () => {
    if (fixture) await teardownLifecycleFixture(fixture);
  });

  it("serializes enqueue before archive and leaves no live pending row", async () => {
    const enqueue = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select public.enqueue_due_task_notifications(now()) as enqueue_count \\gset
\\echo ENQUEUE_READY
select pg_sleep(1);
commit;
\\echo ENQUEUE_COUNT=:enqueue_count
`,
      "ENQUEUE_READY",
    );
    await enqueue.ready;

    const archiveOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
select id as archived_id
from public.archive_shadchan(${fixture.shadchanId}) \\gset
\\echo ARCHIVED_ID=:archived_id
`);
    const enqueueOutput = await enqueue.done;
    expect(extractOutputNumber(archiveOutput, "ARCHIVED_ID")).toBe(
      fixture.shadchanId,
    );
    expect(extractOutputNumber(enqueueOutput, "ENQUEUE_COUNT")).toBe(1);

    const finalOutput = await runPsqlScript(`
select status::text as lifecycle_status
from public.task_notifications
where task_id = ${fixture.taskId};
`);
    expect(finalOutput).toContain("skipped");
  });

  it("blocks claim behind archive and never returns the archived target", async () => {
    await runPsqlScript(`
\\set ON_ERROR_STOP on
select public.enqueue_due_task_notifications(now());
`);

    const archive = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
select id as archived_id
from public.archive_shadchan(${fixture.shadchanId}) \\gset
\\echo ARCHIVE_READY
select pg_sleep(1);
commit;
\\echo ARCHIVED_ID=:archived_id
`,
      "ARCHIVE_READY",
    );
    await archive.ready;

    const claimOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
select count(*) as claim_count
from public.claim_due_task_notifications(1) \\gset
\\echo CLAIM_COUNT=:claim_count
`);
    const archiveOutput = await archive.done;
    expect(extractOutputNumber(archiveOutput, "ARCHIVED_ID")).toBe(
      fixture.shadchanId,
    );
    expect(extractOutputNumber(claimOutput, "CLAIM_COUNT")).toBe(0);

    const finalOutput = await runPsqlScript(`
select status::text as lifecycle_status
from public.task_notifications
where task_id = ${fixture.taskId};
`);
    expect(finalOutput).toContain("skipped");
  });

  it("serializes add_redt behind archive and rejects the archived target", async () => {
    const archive = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
select id as archived_id
from public.archive_shadchan(${fixture.shadchanId}) \\gset
\\echo ARCHIVE_READY
select pg_sleep(1);
commit;
\\echo ARCHIVED_ID=:archived_id
`,
      "ARCHIVE_READY",
    );
    await archive.ready;

    const addRedtOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
create temp table add_redt_race_result (rejected boolean);
do $$
begin
  perform public.add_redt(${fixture.shidduchId}, ${fixture.shadchanId});
  insert into add_redt_race_result values (false);
exception when others then
  insert into add_redt_race_result values (sqlerrm like 'shadchan % not found in current account');
end
$$;
select rejected as add_redt_rejected from add_redt_race_result \\gset
\\echo ADD_REDT_REJECTED=:add_redt_rejected
`);
    const archiveOutput = await archive.done;

    expect(extractOutputNumber(archiveOutput, "ARCHIVED_ID")).toBe(
      fixture.shadchanId,
    );
    expect(extractOutputBoolean(addRedtOutput, "ADD_REDT_REJECTED")).toBe(true);
  });

  it("serializes create_shidduch behind archive and rejects the archived target", async () => {
    const archive = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
select id as archived_id
from public.archive_shadchan(${fixture.shadchanId}) \\gset
\\echo ARCHIVE_READY
select pg_sleep(1);
commit;
\\echo ARCHIVED_ID=:archived_id
`,
      "ARCHIVE_READY",
    );
    await archive.ready;

    const createOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
create temp table create_shidduch_race_result (rejected boolean);
do $$
begin
  perform public.create_shidduch(${fixture.singleId}, ${fixture.shadchanId}, 'Race create');
  insert into create_shidduch_race_result values (false);
exception when others then
  insert into create_shidduch_race_result values (sqlerrm like 'shadchan % not found in current account');
end
$$;
select rejected as create_shidduch_rejected from create_shidduch_race_result \\gset
\\echo CREATE_SHIDDUCH_REJECTED=:create_shidduch_rejected
`);
    const archiveOutput = await archive.done;

    expect(extractOutputNumber(archiveOutput, "ARCHIVED_ID")).toBe(
      fixture.shadchanId,
    );
    expect(extractOutputBoolean(createOutput, "CREATE_SHIDDUCH_REJECTED")).toBe(
      true,
    );
  });

  it("keeps account purge and add_redt in parent-first order", async () => {
    const purge = runAccountPurgeHoldingParents(fixture);
    await purge.ready;

    const addRedtOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role authenticated;
set statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
create temp table add_redt_purge_race_result (
  rejected boolean,
  sql_state text,
  error_message text
);
do $$
begin
  perform public.add_redt(${fixture.shidduchId}, ${fixture.shadchanId});
  insert into add_redt_purge_race_result values (false, null, null);
exception when others then
  insert into add_redt_purge_race_result values (
    sqlstate = 'P0001',
    sqlstate,
    sqlerrm
  );
end
$$;
select
  rejected as add_redt_purge_rejected,
  sql_state as add_redt_purge_sql_state,
  error_message as add_redt_purge_error
from add_redt_purge_race_result \\gset
\\echo ADD_REDT_PURGE_REJECTED=:add_redt_purge_rejected
\\echo ADD_REDT_PURGE_SQL_STATE=:add_redt_purge_sql_state
\\echo ADD_REDT_PURGE_ERROR=:add_redt_purge_error
`);
    const purgeOutput = await purge.done;

    expect(purgeOutput).toContain("PURGE_COMPLETED");
    expect(extractOutputBoolean(addRedtOutput, "ADD_REDT_PURGE_REJECTED")).toBe(
      true,
    );
    expect(extractOutputValue(addRedtOutput, "ADD_REDT_PURGE_SQL_STATE")).toBe(
      "P0001",
    );
    expect(extractOutputValue(addRedtOutput, "ADD_REDT_PURGE_ERROR")).toBe(
      "shadchan " + fixture.shadchanId + " not found in current account",
    );
  });

  it("keeps account purge and create_shidduch in parent-first order", async () => {
    const purge = runAccountPurgeHoldingParents(fixture);
    await purge.ready;

    const createOutput = await runPsqlScript(`
\\set ON_ERROR_STOP on
set role authenticated;
set statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${CONCURRENCY_USER_ID}","role":"authenticated"}';
select public.set_active_context(${fixture.accountId});
create temp table create_purge_race_result (
  rejected boolean,
  sql_state text,
  error_message text
);
do $$
begin
  perform public.create_shidduch(${fixture.singleId}, ${fixture.shadchanId}, 'Purge race create');
  insert into create_purge_race_result values (false, null, null);
exception when others then
  insert into create_purge_race_result values (
    sqlstate = 'P0001',
    sqlstate,
    sqlerrm
  );
end
$$;
select
  rejected as create_purge_rejected,
  sql_state as create_purge_sql_state,
  error_message as create_purge_error
from create_purge_race_result \\gset
\\echo CREATE_PURGE_REJECTED=:create_purge_rejected
\\echo CREATE_PURGE_SQL_STATE=:create_purge_sql_state
\\echo CREATE_PURGE_ERROR=:create_purge_error
`);
    const purgeOutput = await purge.done;

    expect(purgeOutput).toContain("PURGE_COMPLETED");
    expect(extractOutputBoolean(createOutput, "CREATE_PURGE_REJECTED")).toBe(
      true,
    );
    expect(extractOutputValue(createOutput, "CREATE_PURGE_SQL_STATE")).toBe(
      "P0001",
    );
    expect(extractOutputValue(createOutput, "CREATE_PURGE_ERROR")).toBe(
      "shadchan " + fixture.shadchanId + " not found in current account",
    );
  });
});
