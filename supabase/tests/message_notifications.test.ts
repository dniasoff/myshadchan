import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the notification-delivery database suite (Story 7.5) against the
 * local Supabase stack, exactly as threads_entity.test.ts runs Story 7.1's.
 *
 * message_notifications.sql covers everything a single connection can prove
 * (RLS, grants, the fan-out trigger, claim/settle's single-session shape).
 * AC-9's own falsifiable claim — "two concurrent claim_message_notifications()
 * calls against the same pending set return disjoint id sets… assert with
 * two real sessions" — cannot be expressed inside that one
 * `begin; … rollback;` script, because a session never blocks on its own
 * lock. This file adds that proof separately, with two real `psql`
 * connections and its own commit/cleanup (the SQL suite's rollback would
 * hide a real `for update skip locked` race just as easily as it would hide
 * a bug).
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "message_notifications.sql",
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

  // The report is the last line that is a JSON array; everything before it
  // is ordinary psql statement output.
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

describe("message notifications (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not.
  it("runs every AC-2, AC-4 through AC-13 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(28);
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
// AC-9: claim_message_notifications() under two REAL sessions.
// ---------------------------------------------------------------------------

/**
 * Runs a psql script over stdin on its own connection and resolves with its
 * full stdout once the process exits. Rejects on a non-zero exit so a syntax
 * error or a raised exception fails the test instead of silently returning
 * empty output.
 */
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
 * A's claim has actually executed, instead of guessing a delay long enough
 * to (hopefully) outlast connection setup — the exact flakiness
 * `.claude/rules/testing.md` asks E2E suites to avoid, here applied to a
 * database race instead of a UI wait.
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
 * Fixture for the concurrency proof: one real household, member, thread and
 * message, with exactly two `pending` message_notifications rows on it.
 * Committed for real (no wrapping transaction) — two separate `psql`
 * connections need to see it — and torn down in `afterAll` via a single
 * `delete from public.accounts`, which cascades through every row this
 * fixture created.
 */
async function seedConcurrencyFixture(): Promise<{ accountId: number }> {
  const script = `
\\set ON_ERROR_STOP on
-- Defensive cleanup: a previous run that failed between seeding and its own
-- afterAll teardown (a genuine crash, a killed process) can leave this fixed
-- fixture id behind. Idempotent, the same shape every SQL suite in this
-- directory uses ("delete from public.account_members;" at the top of its
-- own fixture) for the identical reason.
delete from public.accounts where name = 'Notifications Concurrency Fixture';
-- One transaction: psql autocommits per statement, so the account would
-- otherwise COMMIT before its membership exists and
-- assert_account_not_orphaned() would (correctly) reject it.
delete from public.members where user_id = '60000000-0000-4000-8000-000000000001';
delete from auth.users where id = '60000000-0000-4000-8000-000000000001';

insert into auth.users (id, instance_id, aud, role, email)
values ('60000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-concurrency@test.local')
returning id \\gset ignore_
begin;
insert into public.accounts (name, kind) values ('Notifications Concurrency Fixture', 'household')
returning id as account_id \\gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '60000000-0000-4000-8000-000000000001', 'parent_admin', 'active')
returning id as member_id \\gset
insert into public.threads (account_id, connection_id, subject_type, subject_id, visibility)
values (:account_id, null, 'relationship', null, 'open')
returning id as thread_id \\gset
insert into public.messages (account_id, connection_id, thread_id, sender_member_id, body)
values (:account_id, null, :thread_id, null, 'concurrency probe')
returning id as message_id \\gset
insert into public.message_notifications (account_id, message_id, recipient_member_id, channel, status)
values (:account_id, :message_id, :member_id, 'email', 'pending');
insert into public.message_notifications (account_id, message_id, recipient_member_id, channel, status)
values (:account_id, :message_id, :member_id, 'push', 'pending');
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
delete from public.members where user_id = '60000000-0000-4000-8000-000000000001';
delete from auth.users where id = '60000000-0000-4000-8000-000000000001';
`);
}

describe("AC-9: claim_message_notifications() under two real sessions", () => {
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
select id from public.claim_message_notifications(1) \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo CLAIMED_A=:a_id
`,
      "READY",
    );

    // Do not start session B until session A's own output proves the claim
    // has executed and the lock is held — not a fixed delay guessing how
    // long that takes.
    await sessionA.ready;

    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select id from public.claim_message_notifications(1) \\gset b_
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
