import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the Epic 11 Findings 6/7/8/9/10/11/12 closure database suite against
 * the local Supabase stack. The assertions live in ai_parse_quota.sql,
 * because what they check — that claim_ai_parse_attempt() is the sole,
 * atomic, fail-closed authority for both the idempotency key and the
 * monthly quota (with no Worker-side pre-check ahead of it), that an
 * unentitled account is refused at the RPC itself, that a superseded
 * confirm hands back the winning generation's own state, that the
 * opportunistic reaper self-heals an account phantom-stuck at its cap, and
 * that NO client-callable path exists at all — only exists inside Postgres
 * (RLS + grants + real row locking) and cannot be exercised through a mock.
 * The SQL emits one JSON row per check; this file turns each into a named
 * test so a failure names the specific invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "ai_parse_quota.sql",
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
  // is ordinary psql statement output (the two void-returning confirm/release
  // calls in the SQL file's own lifecycle section print an empty result set
  // each).
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

describe("Epic 11 parse-attempt quota reservation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not. Raised from 30 to 45 when the C2 fencing-token checks were
  // added (49 as of that change), then from 45 to 70 when the Findings
  // 6/8/9/10/11/12 closure checks (result_schema_version gating, cap-exempt
  // free paths, superseded-with-result, force-reclaim, the opportunistic
  // reaper, and the retention sweep) were added (80 as of that change).
  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(70);
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
// Real concurrency proofs: claim_ai_parse_attempt() under two REAL sessions.
//
// ai_parse_quota.sql above proves the SQL logic sequentially, on one
// connection — it can never prove the atomicity claims in the design's own
// words, because a session never blocks on its own lock. This section adds
// that proof with two real `psql` connections and its own commit/cleanup,
// mirroring message_notifications.test.ts's AC-9 proof for
// claim_message_notifications() exactly (same runPsqlScript /
// runPsqlScriptUntil / marker-based readiness pattern) — per
// .claude/rules/migration-guard-integrity.md, a guard's PASS is only
// evidence if someone has watched it fail on a genuine race, and a
// sequential-only script cannot show that.
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
 * A's claim has actually executed and its locks are held, instead of
 * guessing a delay long enough to (hopefully) outlast connection setup — the
 * exact flakiness `.claude/rules/testing.md` asks E2E suites to avoid, here
 * applied to a database race instead of a UI wait.
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

function extractField(stdout: string, label: string): string | null {
  const match = stdout.match(new RegExp(`${label}=(\\S*)`));
  if (!match || match[1] === "") return null;
  return match[1];
}

/**
 * Fixture for one concurrency proof: one real, entitled account (plan 'ai',
 * status 'active') with its ai_usage row pre-seeded to 99/100 for the
 * current month. Each test in this section gets its OWN account (via
 * `fixtureName`) rather than sharing one — the two tests both spend from the
 * SAME (account_id, period) ai_usage row they seed, so a shared account would
 * let the first test's own successful claim silently push resumes_parsed to
 * 100 before the second test ever ran, corrupting its "99/100" precondition
 * (reproduced: both claims in the boundary test observed 100/100 and both
 * returned 'cap_reached', because the same-key test's own winning claim had
 * already spent the 100th unit on the shared account). Committed for real
 * (no wrapping transaction) — two separate `psql` connections need to see
 * it — and torn down in `afterAll` via `delete from public.accounts`, which
 * cascades through every row each fixture created.
 */
async function seedConcurrencyFixture(fixtureName: string): Promise<{
  accountId: number;
  inboxItemId: number;
}> {
  const script = `
\\set ON_ERROR_STOP on
-- Defensive cleanup: a previous run that failed between seeding and its own
-- afterAll teardown (a genuine crash, a killed process) can leave this fixed
-- fixture behind. Idempotent, the same shape every SQL suite in this
-- directory uses for the identical reason.
delete from public.accounts where name = '${fixtureName}';

insert into public.accounts (name, kind) values ('${fixtureName}', 'household')
returning id as account_id \\gset
insert into public.subscription (account_id, plan, status)
values (:account_id, 'ai', 'active');
insert into public.ai_usage (account_id, period, resumes_parsed)
values (:account_id, to_char(now(), 'YYYY-MM'), 99);
insert into public.inbox_items (account_id, source) values (:account_id, 'email')
returning id as inbox_item_id \\gset
\\echo ACCOUNT_ID=:account_id
\\echo INBOX_ITEM_ID=:inbox_item_id
`;
  const stdout = await runPsqlScript(script);
  const accountId = extractField(stdout, "ACCOUNT_ID");
  const inboxItemId = extractField(stdout, "INBOX_ITEM_ID");
  if (accountId === null || inboxItemId === null) {
    throw new Error(
      `concurrency fixture setup did not report both ids:\n${stdout}`,
    );
  }
  return { accountId: Number(accountId), inboxItemId: Number(inboxItemId) };
}

async function teardownConcurrencyFixture(accountId: number): Promise<void> {
  await runPsqlScript(`
\\set ON_ERROR_STOP on
delete from public.accounts where id = ${accountId};
`);
}

describe("claim_ai_parse_attempt() under two real sessions", () => {
  if (bailIfDbUnreachable(error)) return;

  const seededAccountIds: number[] = [];

  afterAll(async () => {
    for (const accountId of seededAccountIds) {
      await teardownConcurrencyFixture(accountId);
    }
  });

  it("two overlapping claims for the SAME key resolve to exactly one claimed and one conflict", async () => {
    const { accountId, inboxItemId } = await seedConcurrencyFixture(
      "Parse Quota Concurrency Fixture (same key)",
    );
    seededAccountIds.push(accountId);
    // Session A: claims the key, then holds the transaction open (and with
    // it, the row lock the INSERT's own uniqueness check takes) for a full
    // second before committing.
    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/same-key.pdf', 1::smallint) ->> 'outcome') as outcome \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo OUTCOME_A=:a_outcome
`,
      "READY",
    );

    // Do not start session B until session A's own output proves the claim
    // has executed and the lock is held — not a fixed delay guessing how
    // long that takes.
    await sessionA.ready;

    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/same-key.pdf', 1::smallint) ->> 'outcome') as outcome \\gset b_
\\echo OUTCOME_B=:b_outcome
`);

    const sessionAStdout = await sessionA.done;

    const outcomeA = extractField(sessionAStdout, "OUTCOME_A");
    const outcomeB = extractField(sessionBStdout, "OUTCOME_B");

    expect(outcomeA, `session A output:\n${sessionAStdout}`).not.toBeNull();
    expect(outcomeB, `session B output:\n${sessionBStdout}`).not.toBeNull();

    // B's own INSERT blocks on A's uncommitted row until A commits, then
    // sees the just-committed 'in_progress' row and reports 'conflict' — it
    // can never independently also succeed, because the unique constraint on
    // (account_id, inbox_item_id, attachment_path) only ever lets one INSERT
    // for this key through.
    const outcomes = [outcomeA, outcomeB].sort();
    expect(outcomes).toEqual(["claimed", "conflict"]);
  });

  it("two overlapping claims for DIFFERENT keys at the 99/100 cap boundary resolve to exactly one claimed and one cap_reached, never exceeding the limit", async () => {
    const { accountId, inboxItemId } = await seedConcurrencyFixture(
      "Parse Quota Concurrency Fixture (cap boundary)",
    );
    seededAccountIds.push(accountId);

    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/boundary-a.pdf', 1::smallint) ->> 'outcome') as outcome \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo OUTCOME_A=:a_outcome
`,
      "READY",
    );

    await sessionA.ready;

    // A different key (attachment_path), same account/period — does not
    // collide on ai_parse_attempts' own unique constraint, but DOES collide
    // on the ai_usage row for (account_id, period): A's uncommitted upsert
    // holds that row's lock, so B blocks here instead, resuming only after
    // A commits and having already incremented resumes_parsed to 100.
    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/boundary-b.pdf', 1::smallint) ->> 'outcome') as outcome \\gset b_
\\echo OUTCOME_B=:b_outcome
`);

    const sessionAStdout = await sessionA.done;

    const outcomeA = extractField(sessionAStdout, "OUTCOME_A");
    const outcomeB = extractField(sessionBStdout, "OUTCOME_B");

    expect(outcomeA, `session A output:\n${sessionAStdout}`).not.toBeNull();
    expect(outcomeB, `session B output:\n${sessionBStdout}`).not.toBeNull();

    const outcomes = [outcomeA, outcomeB].sort();
    expect(outcomes).toEqual(["cap_reached", "claimed"]);

    const finalUsageStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select resumes_parsed from public.ai_usage
  where account_id = ${accountId} and period = to_char(now(), 'YYYY-MM') \\gset final_
\\echo FINAL_USAGE=:final_resumes_parsed
`);
    const finalUsage = extractField(finalUsageStdout, "FINAL_USAGE");
    expect(finalUsage).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// Real concurrency proofs: the fencing token (review Finding C2) under two
// REAL sessions.
//
// ai_parse_quota.sql's "fencing" checks above prove the SQL branches are
// correct when called in a CHOSEN order, on one connection — they cannot
// prove the actual race the fencing token exists to close: a stale reclaim's
// UPDATE (which bumps `generation`) genuinely overlapping, at the row-lock
// level, with the PRE-reclaim generation's own confirm/release call. Per
// .claude/rules/migration-guard-integrity.md, a guard's PASS is only
// evidence if someone has watched it fail on a genuine race — this section
// is that proof, for both orders the review named:
//   (a) the reclaim's row lock is granted FIRST, so the pre-reclaim
//       generation's later confirm/release finds itself fenced out
//       ("superseded"), never able to overwrite the reclaimed row or
//       double-touch ai_usage — proven for confirm AND release below.
//   (b) the pre-reclaim generation's OWN release is granted the row lock
//       FIRST (nothing has reclaimed it yet, so it applies normally), and
//       the reclaim that follows correctly falls through to a FRESH
//       reservation instead of ever serving a free, unmetered "resume" of a
//       reservation that no longer exists — the exact "meter shows 0 used
//       while real inference was returned" defect the review's
//       interleaving (b) describes.
// ---------------------------------------------------------------------------

/**
 * Fixture for the fencing-token concurrency proofs: one real, entitled
 * account with NO ai_usage seed (starts the period at 0) — unlike
 * `seedConcurrencyFixture` above, these tests care about exact increments
 * (0 -> 1 -> back to 1 after a benign no-op, etc.), not the cap boundary.
 */
async function seedFencingFixture(fixtureName: string): Promise<{
  accountId: number;
  inboxItemId: number;
}> {
  const script = `
\\set ON_ERROR_STOP on
delete from public.accounts where name = '${fixtureName}';

insert into public.accounts (name, kind) values ('${fixtureName}', 'household')
returning id as account_id \\gset
insert into public.subscription (account_id, plan, status)
values (:account_id, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:account_id, 'email')
returning id as inbox_item_id \\gset
\\echo ACCOUNT_ID=:account_id
\\echo INBOX_ITEM_ID=:inbox_item_id
`;
  const stdout = await runPsqlScript(script);
  const accountId = extractField(stdout, "ACCOUNT_ID");
  const inboxItemId = extractField(stdout, "INBOX_ITEM_ID");
  if (accountId === null || inboxItemId === null) {
    throw new Error(
      `fencing fixture setup did not report both ids:\n${stdout}`,
    );
  }
  return { accountId: Number(accountId), inboxItemId: Number(inboxItemId) };
}

/**
 * Ordinary (non-racy) setup shared by all three fencing tests below: claim a
 * key once (generation 1), then backdate `started_at` past the 5-minute
 * staleness window so a subsequent claim for the same key genuinely takes
 * the reclaim branch. Not itself part of the race being proven — the race
 * starts only once this has already committed.
 */
async function seedStaleAttempt(
  accountId: number,
  inboxItemId: number,
  attachmentPath: string,
): Promise<{ attemptId: number }> {
  const stdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, '${attachmentPath}', 1::smallint) ->> 'attempt_id')::bigint as attempt_id \\gset
update public.ai_parse_attempts set started_at = now() - interval '10 minutes' where id = :attempt_id;
\\echo ATTEMPT_ID=:attempt_id
`);
  const attemptId = extractField(stdout, "ATTEMPT_ID");
  if (attemptId === null) {
    throw new Error(`stale-attempt setup did not report an id:\n${stdout}`);
  }
  return { attemptId: Number(attemptId) };
}

describe("the fencing token under two real sessions (review Finding C2)", () => {
  if (bailIfDbUnreachable(error)) return;

  const seededAccountIds: number[] = [];

  afterAll(async () => {
    for (const accountId of seededAccountIds) {
      await teardownConcurrencyFixture(accountId);
    }
  });

  it("interleaving (a), confirm side: a reclaim that wins the row-lock race fences the pre-reclaim generation's confirm out as a benign no-op, never overwriting the reclaimed row", async () => {
    const { accountId, inboxItemId } = await seedFencingFixture(
      "Parse Quota Fencing Fixture (reclaim vs confirm)",
    );
    seededAccountIds.push(accountId);
    const { attemptId } = await seedStaleAttempt(
      accountId,
      inboxItemId,
      "race/reclaim-vs-confirm.pdf",
    );

    // Session A: the RECLAIM — a fresh claim() call for the same key, which
    // (because the row is already stale) takes the stale-reclaim branch and
    // bumps generation 1 -> 2. Held open so session B's confirm genuinely
    // blocks on the same row's lock instead of merely running after.
    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/reclaim-vs-confirm.pdf', 1::smallint) ->> 'generation')::bigint as generation \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo GENERATION_A=:a_generation
`,
      "READY",
    );

    await sessionA.ready;

    // Session B: the PRE-reclaim generation's own confirm, still carrying
    // generation 1 — issued while A's transaction is still open, so it
    // blocks on A's row lock and only resumes once A has committed the
    // reclaim.
    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.confirm_ai_parse_attempt(${accountId}, ${attemptId}, 1, '{"forged": "by the superseded generation"}'::jsonb, 1::smallint) ->> 'outcome') as outcome \\gset b_
\\echo OUTCOME_B=:b_outcome
`);

    const sessionAStdout = await sessionA.done;

    const generationA = extractField(sessionAStdout, "GENERATION_A");
    const outcomeB = extractField(sessionBStdout, "OUTCOME_B");
    expect(generationA, `session A output:\n${sessionAStdout}`).toBe("2");
    expect(outcomeB, `session B output:\n${sessionBStdout}`).toBe("superseded");

    const rowStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select status, result, generation from public.ai_parse_attempts
  where id = ${attemptId} \\gset row_
\\echo ROW_STATUS=:row_status
\\echo ROW_GENERATION=:row_generation
`);
    // The superseded confirm never overwrote the reclaimed row: still
    // in_progress (nobody has confirmed with the CORRECT generation), still
    // generation 2, and (implicitly, since status never became 'completed')
    // never carrying B's forged result.
    expect(extractField(rowStdout, "ROW_STATUS")).toBe("in_progress");
    expect(extractField(rowStdout, "ROW_GENERATION")).toBe("2");
  });

  it("interleaving (a), release side: a reclaim that wins the row-lock race fences the pre-reclaim generation's release out as a benign no-op, never double-touching ai_usage", async () => {
    const { accountId, inboxItemId } = await seedFencingFixture(
      "Parse Quota Fencing Fixture (reclaim vs release)",
    );
    seededAccountIds.push(accountId);
    const { attemptId } = await seedStaleAttempt(
      accountId,
      inboxItemId,
      "race/reclaim-vs-release.pdf",
    );

    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/reclaim-vs-release.pdf', 1::smallint) ->> 'generation')::bigint as generation \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo GENERATION_A=:a_generation
`,
      "READY",
    );

    await sessionA.ready;

    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.release_ai_parse_attempt(${accountId}, ${attemptId}, 1) ->> 'outcome') as outcome \\gset b_
\\echo OUTCOME_B=:b_outcome
`);

    const sessionAStdout = await sessionA.done;

    const generationA = extractField(sessionAStdout, "GENERATION_A");
    const outcomeB = extractField(sessionBStdout, "OUTCOME_B");
    expect(generationA, `session A output:\n${sessionAStdout}`).toBe("2");
    expect(outcomeB, `session B output:\n${sessionBStdout}`).toBe("superseded");

    // The superseded release must NEVER decrement ai_usage — that unit is
    // still legitimately reserved by the reclaiming generation (2), which
    // has not released it. This is the exact defect interleaving (b)
    // describes if it goes the other way: this assertion is what proves it
    // cannot happen here regardless of arrival order, because the reclaim
    // already won the row lock.
    const usageStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select resumes_parsed from public.ai_usage
  where account_id = ${accountId} and period = to_char(now(), 'YYYY-MM') \\gset usage_
\\echo RESUMES_PARSED=:usage_resumes_parsed
select status from public.ai_parse_attempts where id = ${attemptId} \\gset row_
\\echo ROW_STATUS=:row_status
`);
    expect(extractField(usageStdout, "RESUMES_PARSED")).toBe("1");
    expect(extractField(usageStdout, "ROW_STATUS")).toBe("in_progress");
  });

  it("interleaving (b): the pre-reclaim generation's own release, if it wins the row-lock race first, hands the reservation back cleanly so the reclaim re-reserves fresh instead of ever serving a free, unmetered replay", async () => {
    const { accountId, inboxItemId } = await seedFencingFixture(
      "Parse Quota Fencing Fixture (release vs reclaim)",
    );
    seededAccountIds.push(accountId);
    const { attemptId } = await seedStaleAttempt(
      accountId,
      inboxItemId,
      "race/release-vs-reclaim.pdf",
    );

    // Session A: the PRE-reclaim generation's own release, generation 1 —
    // nothing has reclaimed this row yet, so this is expected to apply
    // normally. Held open so session B's reclaim genuinely blocks on the
    // same row's lock.
    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.release_ai_parse_attempt(${accountId}, ${attemptId}, 1) ->> 'outcome') as outcome \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo OUTCOME_A=:a_outcome
`,
      "READY",
    );

    await sessionA.ready;

    // Session B: a fresh claim() call for the SAME key, issued while A's
    // release transaction is still open — blocks on A's row lock, then
    // resumes to find status='failed' (A's release already committed), so
    // it takes the reclaim-from-'failed' path: a brand-new reservation, not
    // a free resume of A's already-released one.
    // Extracted as separate scalar fields, not echoed as one jsonb blob —
    // jsonb's text representation includes spaces after ':' and ',', which
    // extractField's \\S* regex cannot capture in one token (see
    // extractField's own definition above).
    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/release-vs-reclaim.pdf', 1::smallint) as claim_b \\gset
select (:'claim_b'::jsonb ->> 'outcome') as outcome,
       (:'claim_b'::jsonb ->> 'attempt_id')::bigint as attempt_id,
       (:'claim_b'::jsonb ->> 'generation')::bigint as generation \\gset b_
\\echo OUTCOME_B=:b_outcome
\\echo ATTEMPT_ID_B=:b_attempt_id
\\echo GENERATION_B=:b_generation
`);

    const sessionAStdout = await sessionA.done;

    const outcomeA = extractField(sessionAStdout, "OUTCOME_A");
    expect(outcomeA, `session A output:\n${sessionAStdout}`).toBe("applied");

    expect(
      extractField(sessionBStdout, "OUTCOME_B"),
      `session B output:\n${sessionBStdout}`,
    ).toBe("claimed");
    expect(extractField(sessionBStdout, "ATTEMPT_ID_B")).toBe(
      String(attemptId),
    );
    // Reclaimed from 'failed', not a fresh row — same attempt_id, but a NEW
    // generation (1 -> 2), because this is a brand-new reservation, not a
    // resume of A's already-given-back one.
    expect(extractField(sessionBStdout, "GENERATION_B")).toBe("2");

    // Net spend across the whole scenario: A's original claim reserved 1,
    // A's release gave it back (0), B's reclaim-from-failed reserved a fresh
    // 1 — exactly 1, never 0 (the original defect: real inference returned
    // while the meter showed nothing spent) and never 2 (a double-spend).
    const usageStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select resumes_parsed from public.ai_usage
  where account_id = ${accountId} and period = to_char(now(), 'YYYY-MM') \\gset usage_
\\echo RESUMES_PARSED=:usage_resumes_parsed
`);
    expect(extractField(usageStdout, "RESUMES_PARSED")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Real concurrency proof: force_reclaim_ai_parse_attempt() under two REAL
// sessions (Epic 11 Finding 12 closure).
//
// ai_parse_quota.sql's sequential force-reclaim checks prove the function's
// branches on one connection — they cannot prove the row lock its own
// `UPDATE ... WHERE status = 'completed'` takes actually serializes two
// GENUINELY concurrent reclaims of the SAME row, which is the only thing
// standing between "exactly one caller reclaims it" and "both callers
// believe they reclaimed it, and both go on to re-run inference for a
// document only one of them actually holds the fresh claim for". Per
// .claude/rules/migration-guard-integrity.md, that proof needs two real
// `psql` connections, same as the fencing-token proofs above.
// ---------------------------------------------------------------------------

describe("force_reclaim_ai_parse_attempt() under two real sessions", () => {
  if (bailIfDbUnreachable(error)) return;

  const seededAccountIds: number[] = [];

  afterAll(async () => {
    for (const accountId of seededAccountIds) {
      await teardownConcurrencyFixture(accountId);
    }
  });

  it("two overlapping force-reclaims of the SAME completed row resolve to exactly one reclaimed and one not_reclaimable", async () => {
    const { accountId, inboxItemId } = await seedFencingFixture(
      "Parse Quota Force-Reclaim Fixture (concurrent)",
    );
    seededAccountIds.push(accountId);

    // Ordinary (non-racy) setup: claim and confirm once, so there is a real
    // 'completed' row both sessions will race to force-reclaim.
    const setupStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.claim_ai_parse_attempt(${accountId}, ${inboxItemId}, 'race/force-reclaim.pdf', 1::smallint) ->> 'attempt_id')::bigint as attempt_id \\gset
select public.confirm_ai_parse_attempt(${accountId}, :attempt_id, 1, '{"fields": {"x": 1}}'::jsonb, 1::smallint) as confirm_result \\gset
\\echo ATTEMPT_ID=:attempt_id
`);
    const attemptId = extractField(setupStdout, "ATTEMPT_ID");
    if (attemptId === null) {
      throw new Error(
        `force-reclaim setup did not report an id:\n${setupStdout}`,
      );
    }

    // Session A: force-reclaims the row, then holds the transaction open
    // (and with it, the row lock its own UPDATE took) for a full second
    // before committing.
    const sessionA = runPsqlScriptUntil(
      `
\\set ON_ERROR_STOP on
begin;
select (public.force_reclaim_ai_parse_attempt(${accountId}, ${attemptId}) ->> 'outcome') as outcome \\gset a_
\\echo READY
select pg_sleep(1);
commit;
\\echo OUTCOME_A=:a_outcome
`,
      "READY",
    );

    // Do not start session B until session A's own output proves the
    // force-reclaim has executed and the lock is held — not a fixed delay
    // guessing how long that takes.
    await sessionA.ready;

    const sessionBStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select (public.force_reclaim_ai_parse_attempt(${accountId}, ${attemptId}) ->> 'outcome') as outcome \\gset b_
\\echo OUTCOME_B=:b_outcome
`);

    const sessionAStdout = await sessionA.done;

    const outcomeA = extractField(sessionAStdout, "OUTCOME_A");
    const outcomeB = extractField(sessionBStdout, "OUTCOME_B");

    expect(outcomeA, `session A output:\n${sessionAStdout}`).not.toBeNull();
    expect(outcomeB, `session B output:\n${sessionBStdout}`).not.toBeNull();

    // B's own UPDATE blocks on A's uncommitted row lock until A commits,
    // then finds status is no longer 'completed' (A's reclaim already
    // flipped it to in_progress) — it can never independently also
    // reclaim, because the WHERE clause only ever matches a 'completed'
    // row.
    const outcomes = [outcomeA, outcomeB].sort();
    expect(outcomes).toEqual(["not_reclaimable", "reclaimed"]);

    const rowStdout = await runPsqlScript(`
\\set ON_ERROR_STOP on
select status, generation from public.ai_parse_attempts
  where id = ${attemptId} \\gset row_
\\echo ROW_STATUS=:row_status
\\echo ROW_GENERATION=:row_generation
`);
    // Exactly one reclaim applied: generation bumped exactly once (1 -> 2),
    // never twice.
    expect(extractField(rowStdout, "ROW_STATUS")).toBe("in_progress");
    expect(extractField(rowStdout, "ROW_GENERATION")).toBe("2");
  });
});
