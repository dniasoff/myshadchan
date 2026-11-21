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
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
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
    child.on("error", (error) => {
      if (!seenMarker) rejectReady(error);
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        if (!seenMarker) {
          rejectReady(new Error(`psql exited ${code}: ${stderr || stdout}`));
        }
        reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(script);
  });

  return { ready, done };
}

function runPsqlInteractiveUntil(
  script: string,
  marker: string,
): {
  ready: Promise<void>;
  done: Promise<string>;
  send: (input: string) => void;
  end: () => void;
} {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let psqlProcess!: ReturnType<typeof spawn>;
  let seenMarker = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise<string>((resolve, reject) => {
    psqlProcess = spawn("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    psqlProcess.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!seenMarker && stdout.includes(marker)) {
        seenMarker = true;
        resolveReady();
      }
    });
    psqlProcess.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    psqlProcess.on("error", (error) => {
      if (!seenMarker) rejectReady(error);
      reject(error);
    });
    psqlProcess.on("close", (code) => {
      if (code !== 0) {
        if (!seenMarker) {
          rejectReady(new Error(`psql exited ${code}: ${stderr || stdout}`));
        }
        reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    psqlProcess.stdin!.write(script);
  });

  return {
    ready,
    done,
    send: (input) => psqlProcess.stdin!.write(input),
    end: () => psqlProcess.stdin!.end(),
  };
}

async function waitForDatabaseLockWait(applicationName: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const report = await runPsqlScript(`
set role postgres;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select exists (
  select 1
  from pg_stat_activity
  where application_name = '${applicationName}'
    and state = 'active'
    and wait_event_type = 'Lock'
);
`);
    if (report.trim() === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${applicationName} to wait on a lock`);
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

  it("uses a real parent-lock barrier for the purge/undo grant race", async () => {
    const token = `${randomUUID().replaceAll("-", "")}_barrier`;
    const userA = randomUUID();
    const userB = randomUUID();
    const resultTable = `stage_undo_barrier_${token}`;
    const gateKey = "9223372036854771000";
    const setup = await runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email)
values
  ('${userA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userA}@test.invalid'),
  ('${userB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userB}@test.invalid');
insert into public.accounts (name) values ('stage undo purge A ${token}') returning id as account_a \\gset
insert into public.accounts (name) values ('stage undo purge B ${token}') returning id as account_b \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '${userA}', 'parent_admin', 'active') returning id as member_a \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '${userB}', 'parent_admin', 'active') returning id as member_b \\gset
insert into public.member_state (user_id, active_account_id)
values ('${userA}', :account_a), ('${userB}', :account_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.singles (account_id, first_name_en)
values (:account_a, 'Purge barrier A') returning id as single_a \\gset
insert into public.singles (account_id, first_name_en)
values (:account_b, 'Purge barrier B') returning id as single_b \\gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:account_b, :single_b, :member_b) returning id as shidduch_id \\gset
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:account_b, :single_b, 'stage-undo-purge-barrier-${token}', 'accepted', now() + interval '30 days', :account_a, now(), 'edit');
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
select public.transition_shidduch(:shidduch_id, 'new', 'look_into');
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select :account_a || ',' || :account_b || ',' || :shidduch_id;
`);
    const fixture = setup
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(\d+,){2}\d+$/.test(line));
    if (!fixture) throw new Error(`could not parse barrier fixture: ${setup}`);
    const [accountA, accountB, shidduchId] = fixture.split(",");

    // Both workers hold their own parent rows before either enters the
    // account-lock phase. The controller releases the session-level gate only
    // after both parent-lock markers arrive; no timing sleep can hide the old
    // owner-then-caller/grant-endpoint cycle.
    const gate = runPsqlInteractiveUntil(
      `\\set ON_ERROR_STOP on
select pg_advisory_lock(${gateKey});
\\echo PURGE_UNDO_GATE_HELD
`,
      "PURGE_UNDO_GATE_HELD",
    );
    let gateReleased = false;
    const releaseGate = () => {
      if (gateReleased) return;
      gateReleased = true;
      gate.send(`select pg_advisory_unlock(${gateKey});\n\\q\n`);
      gate.end();
    };
    await gate.ready;
    const purge = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountA} order by id for update;
select 1 from public.shidduchim where account_id = ${accountA} order by id for update;
\\echo PURGE_PARENTS_READY
select pg_advisory_lock(${gateKey});
do $$
begin
  perform public.delete_account_data(${accountA}, '${userA}'::uuid, false);
  insert into public.${resultTable} values ('purge', true, null, null);
exception when others then
  insert into public.${resultTable} values ('purge', false, sqlstate, sqlerrm);
end
$$;
commit;
`,
      "PURGE_PARENTS_READY",
    );
    const undo = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountB} order by id for update;
select 1 from public.shidduchim where account_id = ${accountB} order by id for update;
\\echo UNDO_PARENTS_READY
select pg_advisory_lock(${gateKey});
do $$
begin
  perform public.undo_shidduch(${shidduchId});
  insert into public.${resultTable} values ('undo', true, null, null);
exception when others then
  insert into public.${resultTable} values ('undo', false, sqlstate, sqlerrm);
end
$$;
commit;
`,
      "UNDO_PARENTS_READY",
    );

    try {
      await Promise.all([purge.ready, undo.ready]);
      releaseGate();
      await Promise.all([gate.done, purge.done, undo.done]);
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
      for (const row of rows) {
        expect(row.sqlstate_code).not.toBe("40P01");
        expect(row.sqlstate_code).not.toBe("57014");
      }
    } finally {
      releaseGate();
      await Promise.allSettled([gate.done, purge.done, undo.done]);
      await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id in (${accountA}, ${accountB});
delete from auth.users where id in ('${userA}', '${userB}');
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
    // only after both markers arrive makes the old owner-then-caller order hit
    // its reciprocal cycle; the fixed implementation takes the two account
    // ids in one order. This is a real barrier, not a timing sleep.
    const gate = runPsqlInteractiveUntil(
      `\\set ON_ERROR_STOP on
select pg_advisory_lock(${gateKey});
\\echo RECIPROCAL_GATE_HELD
`,
      "RECIPROCAL_GATE_HELD",
    );
    let gateReleased = false;
    const releaseGate = () => {
      if (gateReleased) return;
      gateReleased = true;
      gate.send(`select pg_advisory_unlock(${gateKey});\n\\q\n`);
      gate.end();
    };
    await gate.ready;

    const undoA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountB} order by id for update;
select 1 from public.shidduchim where account_id = ${accountB} order by id for update;
\\echo UNDO_A_PARENTS_READY
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
`,
      "UNDO_A_PARENTS_READY",
    );
    const undoB = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userB}","role":"authenticated"}';
select 1 from public.singles where account_id = ${accountA} order by id for update;
select 1 from public.shidduchim where account_id = ${accountA} order by id for update;
\\echo UNDO_B_PARENTS_READY
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
`,
      "UNDO_B_PARENTS_READY",
    );

    try {
      await Promise.all([undoA.ready, undoB.ready]);
      releaseGate();
      await Promise.all([gate.done, undoA.done, undoB.done]);
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
      releaseGate();
      await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id in (${accountA}, ${accountB});
delete from auth.users where id in ('${userA}', '${userB}');
`);
    }
  });

  it("serializes an accepted-edit mutator with account purge", async () => {
    const token = `${randomUUID().replaceAll("-", "")}_grant_purge`;
    const userA = randomUUID();
    const userB = randomUUID();
    const resultTable = `stage_undo_grant_purge_${token}`;
    const blockerApp = `stage_undo_blocker_${token}`;
    const purgeApp = `stage_undo_purge_${token}`;
    const mutatorApp = `stage_undo_mutator_${token}`;
    const setup = await runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email)
values
  ('${userA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userA}@test.invalid'),
  ('${userB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${userB}@test.invalid');
insert into public.accounts (name) values ('stage grant purge A ${token}') returning id as account_a \\gset
insert into public.accounts (name) values ('stage grant purge B ${token}') returning id as account_b \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '${userA}', 'parent_admin', 'active') returning id as member_a \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '${userB}', 'parent_admin', 'active') returning id as member_b \\gset
insert into public.member_state (user_id, active_account_id)
values ('${userA}', :account_a), ('${userB}', :account_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.singles (account_id, first_name_en)
values (:account_b, 'Grant purge target') returning id as single_b \\gset
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at,
   grantee_account_id, accepted_at, access_level)
values
  (:account_b, :single_b, 'stage-undo-grant-purge-${token}', 'accepted',
   now() + interval '30 days', :account_a, now(), 'edit')
returning id as grant_id \\gset
create table public.${resultTable} (
  runner text primary key,
  completed boolean not null,
  sqlstate_code text,
  error_message text
);
grant insert on public.${resultTable} to authenticated;
commit;
\\pset format unaligned
\\pset tuples_only on
\\pset columns 0
select :account_a || ',' || :account_b || ',' || :grant_id;
`);
    const fixture = setup
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(\d+,){2}\d+$/.test(line));
    if (!fixture) {
      throw new Error(`could not parse grant/purge fixture: ${setup}`);
    }
    const [accountA, accountB, grantId] = fixture.split(",");

    // Hold the higher endpoint account first. The purge then reports its
    // actual wait on that row before the mutator starts. Releasing the
    // blocker after the mutator is also waiting makes the old grant-row-first
    // order form a deterministic cycle; account-first locking must serialize.
    const blocker = runPsqlInteractiveUntil(
      `\\set ON_ERROR_STOP on
begin;
set local role postgres;
set local application_name = '${blockerApp}';
select id from public.accounts where id = ${accountB} for update;
\\echo GRANT_PURGE_BLOCKER_READY
`,
      "GRANT_PURGE_BLOCKER_READY",
    );
    let blockerReleased = false;
    const releaseBlocker = () => {
      if (blockerReleased) return;
      blockerReleased = true;
      blocker.send("commit;\\n\\q\\n");
      blocker.end();
    };

    let purge: Promise<string> | undefined;
    let mutator: Promise<string> | undefined;
    try {
      await blocker.ready;
      purge = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local application_name = '${purgeApp}';
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userA}","role":"authenticated"}';
do $$
begin
  perform public.delete_account_data(${accountA}, '${userA}'::uuid, false);
  insert into public.${resultTable} values ('purge', true, null, null);
exception when others then
  insert into public.${resultTable} values ('purge', false, sqlstate, sqlerrm);
end
$$;
commit;
`);
      await waitForDatabaseLockWait(purgeApp);

      mutator = runPsqlScript(`
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
set local application_name = '${mutatorApp}';
set local statement_timeout = '5s';
set request.jwt.claims = '{"sub":"${userB}","role":"authenticated"}';
do $$
begin
  perform public.update_child_grant_access(${grantId}, 'read');
  insert into public.${resultTable} values ('mutator', true, null, null);
exception when others then
  insert into public.${resultTable} values ('mutator', false, sqlstate, sqlerrm);
end
$$;
commit;
`);
      await waitForDatabaseLockWait(mutatorApp);
      releaseBlocker();
      await Promise.all([purge, mutator]);

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
      const purgeRow = rows.find((row) => row.runner === "purge");
      const mutatorRow = rows.find((row) => row.runner === "mutator");
      expect(purgeRow?.completed).toBe(true);
      expect(mutatorRow?.completed).toBe(false);
      expect(mutatorRow?.sqlstate_code).not.toBe("40P01");
      expect(mutatorRow?.sqlstate_code).not.toBe("57014");
      expect(mutatorRow?.error_message).toBe(
        `child grant ${grantId} not found`,
      );
    } finally {
      releaseBlocker();
      await Promise.allSettled(
        [blocker.done, purge, mutator].filter(
          (promise): promise is Promise<string> => promise !== undefined,
        ),
      );
      await runPsqlScript(`
set role postgres;
drop table if exists public.${resultTable};
delete from public.accounts where id in (${accountA}, ${accountB});
delete from auth.users where id in ('${userA}', '${userB}');
`);
    }
  });
});
