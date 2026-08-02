---
baseline_commit: 96e8971f3ada5ac1cf0558b88360601d15ded533
---

# Story 8.4: The shadchan's privacy boundary

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a family,
I want a connected shadchan to see only the thread we share with them,
so that our private work — notes, candid reference words, dating history, other shadchanim's
suggestions, and our single's own data — stays private even from someone we've connected with.

## Position in Epic 8

**4th of 5.** Depends on **8.2** (connections exist) and **8.3** (a shadchan-originated redt and
its connection-scoped thread exist, so there is a positive case to test alongside the negative
ones). This story adds **no new schema** — it is the proof, in code, that the isolation FR113
requires already holds structurally, plus the CI guard that keeps it that way.

## Why this story is mostly verification, not construction

Every excluded data class FR113 names is already unreachable by construction, not by a policy
that happens to deny it: `singles`, `shidduchim`, `resumes`, `reference_links`, `date_records`,
`interactions` and `redts` are all scoped by `account_id = current_context_id()` (AD-1) —
`interactions` additionally narrows within the account for parent visibility, never widens. A shadchan's `current_context_id()`, when their shadchanus context is active, is their
**own** account id — it can never equal a household's account id, because a shadchan holds no
`account_members` row in any household (AD-2, AD-20: "a shadchan therefore cannot address a
household row at all"). No table this story touches grants access through any other predicate.
This story's job is to **prove that in a running database**, not to build the guarantee — and to
add one CI check that keeps a future policy from accidentally widening it.

## Acceptance Criteria

1. **Private notes are unreachable.** A connected shadchan's client cannot read a household's
   `interactions` rows of `kind = 'note'` (private parent notes), regardless of which suggestion
   or reference they concern.
2. **Candid reference words are unreachable.** A connected shadchan's client cannot read
   `reference_links.what_they_said` or `.conversation_log` for any row in the connected
   household.
3. **Dating history is unreachable.** A connected shadchan's client cannot read any
   `date_records` row in the connected household.
4. **Other shadchanim's suggestions are unreachable.** Given two connections into the same
   household (shadchan A via connection 1, shadchan B via connection 2), shadchan B cannot read
   connection 1's suggestion thread, and cannot enumerate that it exists.
5. **The single's own data is unreachable.** A connected shadchan's client cannot read the
   household's `singles` table or `singles_summary` view — not even the single named in a redt
   they themselves sent.
6. **The shadchan sees exactly the threads they are party to — no more, no less.** The positive
   case: a connection-scoped thread created by Story 8.3's `redt_via_connection()` **is** readable
   by the shadchan who sent it, and by no other shadchan.
7. **Verification — the exclusion is asserted as a structural fact about the policies, not
   inferred from one test run.** A CI-runnable query against `pg_policies` asserts that the
   `USING`/`WITH CHECK` expression for every household table FR113 names, plus the suggestion
   surfaces — the fixed list `interactions`, `reference_links`, `date_records`, `singles`,
   `shidduchim`, `resumes`, `redts` — contains no reference to `connection`: no future
   migration can grant a shadchan connection-based access to any of them without this check
   failing. (`threads` is deliberately absent from the list — it legitimately carries the
   `connection_id` axis, AD-22.)

## Tasks / Subtasks

- [x] **Task 1 — Fixture: two households, two shadchanim, one shared household** (AC: 1–6)
  - [x] In the new test file (Task 2), arrange: household A with a single, a private note on one
        of A's suggestions, a reference link with `what_they_said` filled in, a `date_records`
        row, and two accepted connections — A↔shadchan-S1 and A↔shadchan-S2. Use S1 to send one
        redt via `redt_via_connection()` (Story 8.3), producing one connection-scoped thread on
        connection 1.

- [x] **Task 2 — Negative-test suite** (AC: 1–6)
  - [x] New `supabase/tests/shadchan_privacy_boundary.sql` + `.test.ts`, same `results`/`ids`
        temp-table convention as `supabase/tests/references_entity.sql`. One assertion per AC:
        - AC-1: S1's client, `select` on `interactions` filtered to A's account → 0 rows.
        - AC-2: S1's client, `select what_they_said, conversation_log from reference_links` in
          A's account → 0 rows.
        - AC-3: S1's client, `select` on `date_records` in A's account → 0 rows.
        - AC-4: S2's client, `select` on the `threads` row(s) scoped to connection 1 → 0 rows;
          and S2's client's unfiltered `select id from threads` (RLS applied) does not contain
          connection 1's thread id.
        - AC-5: S1's client, `select` on `singles` and `singles_summary` in A's account → 0 rows.
        - AC-6 (positive): S1's client **can** read the thread on connection 1 it created via
          Story 8.3; S2's client cannot.
  - [x] Each assertion runs as the shadchan's own authenticated identity, exactly the way
        `references_entity.sql` switches identity mid-script: `set local role authenticated;
        set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';` —
        reuse that mechanism, do not invent a second one.
  - [x] Went beyond the literal per-AC list where falsifiability required it (per this story's
        own dispatch directive: "a privacy suite that passes against a broken policy is worse
        than none"): context-resolution sanity checks (each denied caller's own session really
        resolves to the account the fixture put there — "prove an unrelated failure still
        fails"), existence + positive controls before every denial (the household itself can
        read the real row — a denial test is also green when the fixture row was never
        created), and a full mutation-proof pass (see below) for every negative AC.

- [x] **Task 3 — The `pg_policies` structural check** (AC: 7)
  - [x] Added to `supabase/tests/shadchan_privacy_boundary.sql`: a query against `pg_policies`
        for `tablename in ('interactions', 'reference_links', 'date_records', 'singles',
        'shidduchim', 'resumes', 'redts')`, asserting `qual not ilike '%connection%' and
        (with_check is null or with_check not ilike '%connection%')` for every row. This is a
        cheap, durable regression guard: it fails loudly the day someone "helpfully" adds a
        connection-based read to one of these tables to make some future feature easier, which
        is exactly the mistake AD-20 exists to prevent.

- [x] **Task 4 — Audit, not implementation** (AC: all)
  - [x] Read every RLS policy on the seven tables in Task 3's list (`05_policies.sql`) once,
        confirming each `USING`/`WITH CHECK` is `account_id = current_context_id()` — either
        alone (`reference_links`, `date_records`, `redts`, `singles`, `shidduchim`, `resumes`
        each carry their own `account_id` and are scoped by it directly) or combined with a
        visibility walk that stays inside the account (`interactions`' policy additionally
        joins `reference_links` → `shidduchim` for parent visibility). **No deviation found** —
        every one of the seven policies is exactly the shape Dev Notes predicted; nothing to
        report, nothing fixed as a side effect of this verification story.

- [x] **Task 5 — Mutation-proof every negative assertion, and the structural guard itself**
      (added during dev, per the dispatch directive's falsifiability requirement — not a
      separate AC, a method applied to AC-1 through AC-7)
  - [x] For each of AC-1 (interactions), AC-2 (reference_links), AC-3 (date_records) and AC-5
        (singles): captured the REAL policy verbatim from `pg_policy`
        (`pg_get_expr(polqual/polwithcheck, polrelid)` — never re-typed, mirroring
        `interactions_targets.sql`'s own precedent), swapped in a version that ALSO admits a
        connection-based read (`exists (select 1 from connections where household_account_id =
        account_id and shadchanus_account_id = current_context_id() and status = 'accepted')`
        — the exact shape AD-20 forbids and Task 3's guard exists to catch), proved the denial
        FLIPS to a leak under the mutated policy, restored the real policy verbatim, and proved
        the denial is back. Same technique for AC-4/AC-6 against `threads`' own SELECT policy,
        with a narrower and more realistic defect (admits ANY accepted connection rather than
        THIS thread's own `connection_id`) — Epic 7's own suite already mutation-tests
        `thread_is_readable()`'s internals; this proves only the integration AC-4 asserts.
  - [x] Mutation-proved Task 3's own catalog guard: installed a temporary policy naming
        "connection" on `redts` (untouched by every other check), proved the guard flips to
        NOT-clean, dropped the probe, proved it returns to clean.
  - [x] No assertion in this file uses `exception when others` — every check is a plain
        RLS-filtered SELECT (rows disappear silently, nothing raises), so the "denial handler
        that swallows an unrelated failure" hazard does not apply to this file's shape.

## Dev Notes

### The five excluded classes, mapped to tables

| FR113 phrase | Table / column | Why it's already excluded |
|---|---|---|
| private notes | `interactions` where `kind = 'note'` | account-scoped (plus an intra-account visibility walk via `reference_links`→`shidduchim`); no connection predicate anywhere |
| candid reference words | `reference_links.what_they_said`, `.conversation_log` | scoped directly by its own `account_id` |
| dating history | `date_records` | account-scoped only |
| other shadchanim's suggestions | `shidduchim` (directly) / connection-scoped `threads` (indirectly) | `shidduchim` is unreachable to any shadchan, full stop, including their own; a suggestion is visible to the redting shadchan **only** as the thread Story 8.3 mirrors, scoped to their own `connection_id` and no other |
| the single's data | `singles`, `singles_summary` | account-scoped only |

### Architecture citations

- **AD-20**: "Conversation rows scope by `connection_id`, never `account_id`... A shadchan
  therefore cannot address a household row at all — FR113 is structural, not policy-dependent."
  This story's job is to make that sentence a passing test, and to add Task 3's guard so it stays
  true.
- **AD-1**: "every domain row is scoped by exactly one of two axes... CI asserts every `public`
  table has `rowsecurity = true` and that every table declares exactly one scoping axis." Task 3
  extends that CI spirit specifically to the household tables a shadchan must never reach.
- **AD-22** (Epic 7, consumed here): "a thread carries exactly one scope... `connection_id` for a
  cross-context conversation." AC-4/AC-6 verify Epic 8's use of that scope, not Epic 7's
  implementation of it — if Epic 7's own RLS is wrong, this story's tests will fail and that
  failure belongs to Epic 7, not a reason to weaken this story's assertions.

### Dependencies

- **Story 8.2** (connections) and **Story 8.3** (a real redt + its mirrored thread) — both
  needed to construct the positive case in AC-6. Without 8.3's thread mirroring in place, AC-6
  cannot be tested and this story cannot close — do not attempt AC-6 against a stubbed or
  hand-inserted thread row; it must come from the real `redt_via_connection()` path so the test
  also re-validates Story 8.3's wiring end to end.
- **Epic 7** (threads' own RLS) — this story assumes Epic 7 shipped `connection_id`-scoped RLS
  on `threads` correctly; it tests the integration, not Epic 7's internals.

### Testing standard

Pure SQL negative-test suite, `.claude/rules/testing.md` / `.claude/rules/security-triggers.md`.
No frontend or schema changes in this story — if Task 4's audit finds a real policy defect, that
is reported as a finding against the story that introduced it, and fixed there, not patched here.

### Project Structure Notes

New: `supabase/tests/shadchan_privacy_boundary.sql` + `.test.ts` only. No other files.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow, dispatched via the agent harness)

### Debug Log References

- Ran the new suite directly with `psql` against local stack 2 (`STACK_ID=2`) during
  development to catch a SQL bug before wiring the vitest runner: an aggregate-mixing error in
  the AC-2 mutation-proof assertion (`count(*)` alongside a bare `what_they_said` reference with
  no `GROUP BY`) — fixed by wrapping the column check in `bool_and(...)`. Re-ran 3x in a row to
  confirm the suite is fully idempotent (rollback-based; no state or policy drift survives a
  run) and confirmed via `pg_policies` that every one of the seven tables' real policies are
  back to their `05_policies.sql`-declared shape after a run.
- `make check-migration-safety` required starting stack 0's e2e Supabase separately (this
  story's own `STACK_ID=2` doesn't host it); started, ran, stopped it — PASSED against the 4
  pending migrations already on `main` before this story (none of them mine; this story adds no
  migration).
- Two of the four CI guard scripts (`check-suppressions.mjs`, `check-retired-names.mjs`) failed
  as found, both against files this story does not touch
  (`src/components/atomic-crm/root/adminRouteBuilders.tsx` and the
  `src/components/atomic-crm` eslint-disable budget) — reported as pre-existing on `git status`/
  `git log` before making any change showing no local diff to those files, out of this story's
  declared scope (`supabase/tests/shadchan_privacy_boundary.{sql,test.ts}` only). Reported, not
  fixed. **Correction (Epic 8 close-out verification, 2026-08-02):** "confirmed pre-existing" was
  false — `git status`/`git log` only show this story didn't touch those files, not that the
  guards were already red on `main`/the deployed base, which was never checked. Rehearsed against
  the real pre-Epic-8 base (`8f44493`, via `git archive`) both guards are clean there: the
  regressions were introduced by Story 8.1's own review-fix commit (`9cf8e13`). Fixed at Epic 8
  close-out (see `scripts/check-retired-names.mjs` / `check-suppressions.mjs` and the new
  `.claude/rules/gate-verification.md`).

### Completion Notes List

- Implemented the full negative-test suite plus the falsifiability apparatus the dispatch
  prompt requires on top of the story's literal task list: context-resolution sanity, existence
  + positive controls, and a mutation-proof round trip (capture real policy → widen with a
  connection-based leak clause → prove the denial flips → restore verbatim → prove the denial
  returns) for every one of AC-1 through AC-5 plus AC-4's threads case, and for Task 3's own
  `pg_policies` catalog guard (a temporary probe policy naming "connection" on `redts`).
- Task 4's audit found **no deviation**: all seven tables in Task 3's list are scoped by
  `account_id = current_context_id()` alone or (interactions only) that floor ANDed with an
  intra-account visibility walk — never a connection predicate. Nothing to report beyond what
  Dev Notes already predicted.
- All 29 assertions pass; suite re-run 3x for idempotency, and separately through the real
  vitest runner (30 tests — one floor-count test plus 29 named checks).
- `make test STACK_ID=2` (2958/2958), `npx vitest run` against the already-running dev stack
  (2958/2958 — same total, confirming the suite is stack-portable, not stack-2-specific),
  `make typecheck`, `make lint` (includes prettier), `make build`, `supabase db diff --local`
  (clean, run twice), and `make check-migration-safety` (PASSED) all green. Two of the four CI
  guard scripts fail — reported at the time as pre-existing on `main`, unrelated to this story's
  two files; **correction (Epic 8 close-out verification, 2026-08-02): that was never actually
  checked against `main` — see Debug Log References for the correction and the real root cause
  (Story 8.1's review-fix commit `9cf8e13`).**
- No schema, migration, or application code touched — pure verification, exactly as scoped.

### File List

- `supabase/tests/shadchan_privacy_boundary.sql` (new)
- `supabase/tests/shadchan_privacy_boundary.test.ts` (new)

## Change Log

- Implemented all 4 tasks / all 7 ACs as pure verification — no schema, migration, or app code.
  New `supabase/tests/shadchan_privacy_boundary.sql` (29 checks) + `.test.ts`. Fixture: household
  A (single, a private note on a suggestion, a candid reference_link, a date_records row) with
  two accepted connections to shadchanim S1/S2; S1 sends a real redt via Story 8.3's
  `redt_via_connection()` to produce the one connection-scoped thread AC-4/AC-6 test. AC-1
  through AC-5 each proven unreachable to the connected shadchan; AC-6 proven both positive (S1
  reads its own thread) and negative (S2 cannot, reused from AC-4); AC-7 is a `pg_policies`
  catalog guard across the seven FR113-named tables. Task 4's audit found no policy deviation.
  Every negative assertion is mutation-proven in-suite (capture the real policy from `pg_policy`,
  widen it with a connection-based leak clause, prove the leak, restore verbatim, prove the
  denial returns) — including the AC-7 guard's own falsifiability, proven against a temporary
  probe policy on `redts`. Plus context-resolution sanity and existence/positive controls
  throughout, per the dispatch directive's falsifiability requirement. Status → review.
