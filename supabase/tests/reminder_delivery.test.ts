import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the reminder-delivery database suite (Story 12.2) against the local
 * Supabase stack, exactly as message_notifications.test.ts runs Story 7.5's.
 *
 * reminder_delivery.sql covers everything a single connection can prove
 * (enqueue's skipped/failed/pending split, the AC-4 backfill statement's own
 * semantics, claim/settle's single-session shape, and both negative RLS/
 * grant tests of AC-8). AC-6's own falsifiable claim — "two concurrent
 * claim_due_task_notifications() calls against the same pending set return
 * disjoint id sets… assert with two real sessions" — cannot be expressed
 * inside that one `begin; … rollback;` script, because a session never
 * blocks on its own lock. This file adds that proof separately, with two
 * real `psql` connections and its own commit/cleanup.
 *
 * Needs `make start` (or the leased STACK_ID stack). If the database is
 * unreachable the suite reports a single skipped test rather than failing
 * the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "reminder_delivery.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
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

describe("reminder delivery (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently
  // vanishing ones are not.
  it("runs every AC-1 through AC-9 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(30);
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
// AC-6: claim_due_task_notifications() under two REAL sessions.
// ---------------------------------------------------------------------------

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

/**
 * Same as runPsqlScript, but resolves as soon as `marker` appears on stdout
 * rather than waiting for the process to exit — session A's script keeps
 * running (holding its row lock through `pg_sleep`) well after that point.
 * This is what lets the test start session B deterministically, the instant
 * A's claim has actually executed, instead of guessing a delay.
 */
function runPsqlScriptUntil(
  script: string,
  marker: string,
): { ready: Promise<void>; done: Promise<string> } {
  let resolveReady: () => void;
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

function extractClaimedId(stdout: string, label: string): number | null {
  const match = stdout.match(new RegExp(`${label}=(-?\\d+|)`));
  if (!match || match[1] === "") return null;
  return Number(match[1]);
}

/**
 * Fixture for the concurrency proof: one real household, member and
 * shadchan target, two SEPARATE tasks (channel is a closed 'email'-only
 * enumeration on task_notifications, unlike message_notifications'
 * email/push pair, so two distinct pending rows need two distinct tasks,
 * not two channels on one) — each carrying exactly one `pending`
 * task_notifications row. Committed for real (no wrapping transaction) —
 * two separate `psql` connections need to see it — and torn down in
 * `afterAll` via `delete from public.accounts`, which cascades through
 * every row this fixture created (tasks, task_notifications), plus an
 * explicit cleanup of the auth.users/public.members rows the account
 * deletion does not reach.
 */
async function seedConcurrencyFixture(): Promise<{ accountId: number }> {
  const script = `
\\set ON_ERROR_STOP on
delete from public.accounts where name = 'Reminder Delivery Concurrency Fixture';
-- One transaction: psql autocommits per statement, so the account would
-- otherwise COMMIT before its membership exists and
-- assert_account_not_orphaned() would (correctly) reject it.
delete from public.members where user_id = '60000000-0000-4000-8000-000000000002';
delete from auth.users where id = '60000000-0000-4000-8000-000000000002';

insert into auth.users (id, instance_id, aud, role, email)
values ('60000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rd-concurrency@test.local')
returning id \\gset ignore_
begin;
insert into public.accounts (name, kind) values ('Reminder Delivery Concurrency Fixture', 'household')
returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '60000000-0000-4000-8000-000000000002', 'parent_admin', 'active')
returning id as account_member_id \\gset
select id as member_id from public.members where user_id = '60000000-0000-4000-8000-000000000002' \\gset
insert into public.shadchanim (account_id, name)
values (:account_id, 'Concurrency Fixture Shadchan')
returning id as shadchan_id \\gset
insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Concurrency probe A', now() - interval '1 hour', :member_id, array['in_app','email'])
returning id as task_a \\gset
insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Concurrency probe B', now() - interval '1 hour', :member_id, array['in_app','email'])
returning id as task_b \\gset
insert into public.task_notifications (account_id, task_id, channel, due_date, status, recipient_email)
values (:account_id, :task_a, 'email', now() - interval '1 hour', 'pending', 'rd-concurrency@test.local');
insert into public.task_notifications (account_id, task_id, channel, due_date, status, recipient_email)
values (:account_id, :task_b, 'email', now() - interval '1 hour', 'pending', 'rd-concurrency@test.local');
commit;
\\echo ACCOUNT_ID=:account_id
`;
  const stdout = await runPsqlScript(script);
  const accountId = extractClaimedId(stdout, "ACCOUNT_ID");
  if (accountId === null) {
    throw new Error(
      `concurrency fixture setup did not report an id:\n${stdout}`,
    );
  }
  return { accountId };
}

async function teardownConcurrencyFixture(accountId: number): Promise<void> {
  await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where id = ${accountId};
delete from public.members where user_id = '60000000-0000-4000-8000-000000000002';
delete from auth.users where id = '60000000-0000-4000-8000-000000000002';
`);
}

describe("AC-6: claim_due_task_notifications() under two real sessions", () => {
  if (bailIfDbUnreachable(error)) return;

  let accountId: number | undefined;

  beforeAll(async () => {
    ({ accountId } = await seedConcurrencyFixture());
  });

  afterAll(async () => {
    if (accountId !== undefined) {
      await teardownConcurrencyFixture(accountId);
    }
  });

  it("two overlapping claims return disjoint id sets covering both pending rows", async () => {
    // Session A: claims one row, then holds the transaction open (and with
    // it, the row lock `for update skip locked` takes) for a full second
    // before committing.
    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select id from public.claim_due_task_notifications(1) \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo CLAIMED_A=:a_id
`,
      "READY",
    );

    await sessionA.ready;

    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select id from public.claim_due_task_notifications(1) \\gset b_
\\echo CLAIMED_B=:b_id
`);

    const sessionAStdout = await sessionA.done;

    const claimedA = extractClaimedId(sessionAStdout, "CLAIMED_A");
    const claimedB = extractClaimedId(sessionBStdout, "CLAIMED_B");

    expect(claimedA, `session A output:\n${sessionAStdout}`).not.toBeNull();
    expect(claimedB, `session B output:\n${sessionBStdout}`).not.toBeNull();
    expect(claimedA).not.toBe(claimedB);
  });
});
