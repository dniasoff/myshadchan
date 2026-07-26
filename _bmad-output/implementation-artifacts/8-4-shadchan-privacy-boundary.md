# Story 8.4: The shadchan's privacy boundary

Status: ready-for-dev

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
`interactions` and `redts` are all scoped **only** by `account_id = current_context_id()`
(AD-1). A shadchan's `current_context_id()`, when their shadchanus context is active, is their
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
   `USING`/`WITH CHECK` expression for every table in AC-1–3 and AC-5 (`interactions`,
   `reference_links`, `date_records`, `singles`, `shidduchim`, `resumes`, `redts`) contains no
   reference to `connection` — i.e., no future migration can grant a shadchan connection-based
   access to any of them without this check failing.

## Tasks / Subtasks

- [ ] **Task 1 — Fixture: two households, two shadchanim, one shared household** (AC: 1–6)
  - [ ] In the new test file (Task 2), arrange: household A with a single, a private note on one
        of A's suggestions, a reference link with `what_they_said` filled in, a `date_records`
        row, and two accepted connections — A↔shadchan-S1 and A↔shadchan-S2. Use S1 to send one
        redt via `redt_via_connection()` (Story 8.3), producing one connection-scoped thread on
        connection 1.

- [ ] **Task 2 — Negative-test suite** (AC: 1–6)
  - [ ] New `supabase/tests/shadchan_privacy_boundary.sql` + `.test.ts`, same `results`/`ids`
        temp-table convention as `supabase/tests/references_entity.sql`. One assertion per AC:
        - AC-1: S1's client, `select` on `interactions` filtered to A's account → 0 rows.
        - AC-2: S1's client, `select what_they_said, conversation_log from reference_links` in
          A's account → 0 rows.
        - AC-3: S1's client, `select` on `date_records` in A's account → 0 rows.
        - AC-4: S2's client, `select` on the `threads` row(s) scoped to connection 1 → 0 rows;
          and a `select count(*) from threads` scoped by S2's own `current_context_id()` does not
          include connection 1's thread id.
        - AC-5: S1's client, `select` on `singles` and `singles_summary` in A's account → 0 rows.
        - AC-6 (positive): S1's client **can** read the thread on connection 1 it created via
          Story 8.3; S2's client cannot.
  - [ ] Each assertion runs as the shadchan's own authenticated role (`set local role
        authenticated; set local request.jwt.claims...` or whatever helper
        `references_entity.sql` already uses to switch identity mid-script — reuse it, do not
        invent a second identity-switching mechanism).

- [ ] **Task 3 — The `pg_policies` structural check** (AC: 7)
  - [ ] Add to the same test file (or a small dedicated one,
        `supabase/tests/shadchan_privacy_boundary.sql`, section 2): a query against
        `pg_policies` for `tablename in ('interactions', 'reference_links', 'date_records',
        'singles', 'shidduchim', 'resumes', 'redts')`, asserting `qual not ilike '%connection%'
        and (with_check is null or with_check not ilike '%connection%')` for every row. This is
        a cheap, durable regression guard: it fails loudly the day someone "helpfully" adds a
        connection-based read to one of these tables to make some future feature easier, which
        is exactly the mistake AD-20 exists to prevent.

- [ ] **Task 4 — Audit, not implementation** (AC: all)
  - [ ] Read every RLS policy on the seven tables in Task 3's list (`05_policies.sql`) once,
        confirming each `USING`/`WITH CHECK` is exactly `account_id = current_context_id()` (or a
        join chain that bottoms out at that predicate, e.g. `reference_links` via its parent
        `shidduchim`). If any policy already deviates, that is a **finding to report**, not a
        silent fix folded into this story — flag it and stop rather than quietly rewriting
        someone else's RLS as a side effect of a verification story.

## Dev Notes

### The five excluded classes, mapped to tables

| FR113 phrase | Table / column | Why it's already excluded |
|---|---|---|
| private notes | `interactions` where `kind = 'note'` | account-scoped only; no connection predicate anywhere |
| candid reference words | `reference_links.what_they_said`, `.conversation_log` | account-scoped only (join to parent `shidduchim` per AD-3's visibility note, itself account-scoped) |
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

### Debug Log References

### Completion Notes List

### File List
