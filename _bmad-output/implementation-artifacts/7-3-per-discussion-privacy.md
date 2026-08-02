# Story 7.3: Per-discussion privacy

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any participant,
I want to make a specific conversation private,
so that sensitive matters stay between the people actually in it, enforced by the database
rather than the UI (FR97, FR98).

## Position in Epic 7

**3rd of 5. Depends on 7.1** (`threads`, `thread_is_readable()`, `messages`,
`thread_participants`, the participant-gated INSERT policies) **and 7.2** (this story does
not touch `default_thread_visibility`, but must not regress it: a thread created with no
explicit `p_visibility` still resolves per the account default before this story's
enforcement applies to it). Precedes 7.4 (whose connection branch reuses this story's
open/private resolution rather than reimplementing it) and 7.5 (notifications, unaffected by
visibility).

This is the story where `private` stops being an inert column value and starts being
enforced. `.claude/rules/security-triggers.md` is explicit: any diff touching RLS or a
permission boundary requires a negative test. This story's whole point *is* a permission
boundary, so AC-5 is not optional coverage — it is the deliverable.

**Deploy coupling.** 7.1 creates `threads.visibility` with `'private'` legal but
unenforced, and 7.1 also ships the Discussions tab. **7.1-7.3 deploy together**, or the
product renders a privacy control that does nothing.

## Acceptance Criteria

1. **A thread can be made private, at creation or later.** `create_thread()` already accepts
   `p_visibility='private'` at creation (7.1). This story adds
   `public.set_thread_visibility(p_thread_id bigint, p_visibility text) returns
   public.threads` so an existing thread can be flipped **by agreement** (FR97) — any
   current `thread_participants` member of that thread may call it, not only its creator
   (Dev Notes "Why any participant, not just the creator").

2. **Private means participants only — full stop.** `thread_is_readable()` gains a private
   branch: when `threads.visibility = 'private'`, the thread, its messages and its own
   participant roster are readable **only** by a caller who is a listed
   `thread_participants` member of that thread — never by "any member of the account"
   (AD-1's general read) and never widened by role, `parent_admin` included. This overrides
   AD-1's general account-scope read exactly as AD-22 resolution rule 1 specifies.

3. **Non-participants see nothing — not even that the thread exists.** A same-account member
   who is not a participant of a private thread gets **zero rows** from `threads`, `messages`
   and `thread_participants` for that thread: RLS row-filtering, not a 403, not a redacted
   stub. Asserted by row count in the `db` project via psql — "zero rows" is not observable
   through PostgREST, where a 0-row read and a policy error are indistinguishable
   (contract §13 rule 4).

4. **Privacy is a round trip, not a one-way latch.** Flipping an open thread to `private`
   removes it from a non-participant's reads **immediately** (same session, no cache step),
   and flipping it back to `open` restores them. **Falsifiable:** the same non-participant
   session reads 1 → 0 → 1 across two `set_thread_visibility()` calls. A test that only
   checks the private state passes against an implementation that hard-denies everything.

5. **Verification — the mandatory negative test.** `supabase/tests/threads_entity.sql`
   gains: one account, three members (A = `parent_admin`, B = `parent_admin`, C = `helper`);
   a thread between A and B only, explicitly `'private'`. Assert C reads **zero** rows from
   `threads`, `messages` and `thread_participants` for it, while A and B each read exactly
   that one thread and its message. Additionally assert C **cannot break in**: C's INSERT of
   a `thread_participants` row adding themselves is rejected by 7.1's participant-gated
   INSERT policy (re-proven here because this is the story whose promise it protects), and
   C's `set_thread_visibility()` call on that thread **raises** with a specific SQLSTATE
   that the test matches by code — never `exception when others then … PASS`, which is
   green for a typo, a dropped function or a broken `search_path`. Prove the denial by
   mutation, and separately prove an unrelated failure still fails.

6. **The single's carve-out is scoped to the thread and is not a back door.** A `single`
   deliberately added as a participant of a private thread about a shidduch they cannot
   otherwise see (a sibling's, or one with `visibility='private_parent'`) **does** read that
   thread and its messages — the participant list is the human decision, and re-applying the
   dignity-floor gate on top would make adding them meaningless (Dev Notes "Why private does
   not re-apply the single gate"). **Falsifiable, and this is the clause that keeps it from
   becoming a leak:** in the same fixture, that single still reads **zero** rows from
   `public.shidduchim`, `public.resumes`, `public.interactions` and `public.entity_files`
   for that subject. Epic 6's row and field scoping is untouched; what the single gains is
   the conversation they were invited into, and nothing else.

7. **Open threads are unaffected.** Every 7.1/7.2 assertion in `threads_entity.sql` — open
   readability, the three-part dignity-floor gate (7.1 AC-9), the account-default resolution
   — still passes unchanged. This story adds a branch; it does not restructure the open case.

8. **The connection axis stays closed until 7.4.** `set_thread_visibility()` refuses a
   connection-scoped thread, because 7.1's `thread_is_readable()` returns false for one and
   this RPC requires readability as well as participation. **Falsifiable:** a service-role-
   seeded connection-scoped private thread cannot be flipped by any `authenticated` caller.
   7.4 widens this by widening `thread_is_readable()`, and this RPC follows for free.

9. **Verification — the toolchain is green.** `make typecheck`, `npm run lint`, `make test`,
   `npm run test:unit:db` all pass with zero new warnings. `make check-migration-safety`
   passes (this story's migration is function bodies only — no column is added, dropped or
   narrowed).

## Tasks / Subtasks

- [x] **Task 1 — Extend `thread_is_readable()` with the private branch** (AC: 2, 3, 4, 6, 7)
  - [x] `supabase/schemas/02_functions.sql`: `CREATE OR REPLACE FUNCTION
        "public"."thread_is_readable"(…)` in exact `pg_dump` form (contract §8 rule 6, or
        `db diff` produces a phantom diff). Keep 7.1's body order intact and insert one
        step:
        1. thread missing → false (7.1);
        2. `connection_id is not null` → false (7.1; 7.4 replaces this line);
        3. `account_id <> current_context_id()` → false (7.1);
        4. **new:** `visibility = 'private'` → return
           `exists (select 1 from public.thread_participants tp where tp.thread_id =
           p_thread_id and tp.member_id = public.current_member_id())` and **nothing else**
           — no dignity-floor re-check on top (AC-6, Dev Notes);
        5. `visibility = 'open'` → 7.1's existing logic, including the three-part single
           gate, unchanged.
  - [x] **No RLS policy text changes anywhere.** Every 7.1 SELECT policy on
        `threads`/`thread_participants`/`messages` already calls `thread_is_readable()`;
        extending the function extends every caller for free. This is the payoff of
        centralizing it in 7.1 instead of inlining the logic three times.
  - [x] Keep the function `STABLE SECURITY DEFINER SET search_path ''`. Do not make it
        `IMMUTABLE` (it reads tables) and do not drop `SET search_path ''` — a broken
        `search_path` is one of the failure modes a bare `exception when others` handler
        would hide, which is why AC-5 forbids one.

- [x] **Task 2 — `set_thread_visibility()` RPC** (AC: 1, 4, 8)
  - [x] `public.set_thread_visibility(p_thread_id bigint, p_visibility text) returns
        public.threads` — `SECURITY DEFINER SET search_path ''`, `pg_dump` form. In order:
        validate `p_visibility in ('open','private')` or raise `22023`
        (`invalid_parameter_value`); require `public.thread_is_readable(p_thread_id)` (this
        is what closes AC-8 with no connection-specific code); require the caller is a
        current `thread_participants` member (`tp.member_id = public.current_member_id()`)
        or raise `42501` (`insufficient_privilege`) — **not** merely a same-account member,
        so a non-participant cannot flip visibility on a thread they are not in, open or
        private; update `threads.visibility`; return the updated row.
  - [x] Use distinct, documented SQLSTATEs for the two refusals so AC-5's test can match a
        code rather than a message, and so a future message reword does not silently turn
        the assertion green.
  - [x] `06_grants.sql`: `revoke all on function public.set_thread_visibility(bigint, text)
        from public, anon;` then `grant execute … to authenticated, service_role;`. **No
        table-level UPDATE grant on `threads` for `authenticated`** — this RPC stays the
        sole write path for `visibility`, matching 7.1's "no UPDATE grant, no UPDATE policy"
        decision. If `authenticated` gained UPDATE on `threads`, this whole story would be
        one `dataProvider.update` away from bypassed.

- [x] **Task 2a — Generate and apply the migration** (AC: 1, 2, 3)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        thread_privacy_enforcement`. This migration is function bodies only. Hand-check that
        `db diff` emitted **both** `CREATE OR REPLACE FUNCTION` statements — a `plpgsql`
        body change with an unchanged signature is sometimes missed. If the generated
        migration is empty or partial, write the statements into it by hand.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
        `db diff` twice more to prove convergence. Never `db reset` on a stack holding data;
        never `db push`.
  - [x] `make check-migration-safety` (function-only, so this should be a clean pass — if it
        is not, something else drifted).

- [x] **Task 3 — Types and provider** (AC: 1)
  - [x] `providers/supabase/dataProvider.ts`: `setThreadVisibility(threadId: Identifier,
        visibility: ThreadVisibility): Promise<Thread>` calling
        `.rpc("set_thread_visibility", { p_thread_id: threadId, p_visibility: visibility })`
        — same shape as `createShidduchViaRpc` (`dataProvider.ts:85-100`).
  - [x] Mirror in `providers/fakerest/dataProvider.ts` (AD-10), including the FakeRest
        equivalent of the participant check, so the demo build does not offer a control that
        silently succeeds for everyone.
  - [x] No `types.ts` change — `ThreadVisibility` and `Thread` land in 7.1.

- [x] **Task 4 — UI: the privacy control** (AC: 1)
  - [x] In `threads/ThreadPanel.tsx` (7.1), a lock/unlock control calling
        `dataProvider.setThreadVisibility()`, rendered only for current participants — a
        non-participant cannot see a private thread at all, and on an *open* thread a
        non-participant must not be offered a control the RPC will refuse. Derive
        participation from the thread's already-loaded participant list; do not add a
        second round trip.
  - [x] The control must state the consequence in plain language, not just toggle an icon: a
        private thread is invisible to the rest of the household, which is the point and is
        not obvious from a padlock alone. Copy through the `i18nProvider` under
        `crm.threads.visibility.*`, in **both** `englishCrmMessages.ts` and
        `frenchCrmMessages.ts` (the French catalogue is genuinely translated).
  - [x] Invalidate the thread/message queries on success so AC-4's round trip is observable
        without a reload.

- [x] **Task 5 — Tests** (AC: 4, 5, 6, 7, 8, 9)
  - [x] Extend `supabase/tests/threads_entity.sql` (7.1's file) with:
        - the AC-5 three-member negative scenario, plus C's two break-in attempts, each
          matched by **specific SQLSTATE**;
        - the AC-4 round trip (1 → 0 → 1 for the same non-participant session);
        - the AC-6 pair: the single participant reads the private thread **and** reads zero
          rows from `shidduchim`/`resumes`/`interactions`/`entity_files` for that subject;
        - the AC-8 refusal on a service-role-seeded connection-scoped thread;
        - the AC-1 positives: `set_thread_visibility()` by a **non-creator** participant
          succeeds; by a non-participant same-account member raises.
  - [x] Prove the suite can fail: mutate the private branch to `return true` and confirm
        AC-5 and AC-3 go red before shipping them green. A guard that cannot fail is not
        coverage (contract §13 rule 2).
  - [x] Re-run the whole `threads_entity.sql` suite for AC-7 (no 7.1/7.2 regressions).
  - [x] Vitest (browser mode, `vitest-browser-react` + `TestMemoryRouter`) for the privacy
        control: shown to a participant, absent for a non-participant, and the success path
        invalidates. AAA, ≥80% of new lines.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus prettier
        on this story's changed files only.

## Dev Notes

### Why any participant, not just the creator, can flip visibility

FR97: "A thread may be made private **at creation or by agreement**." "By agreement" reads as
any party to the conversation, not a creator-only privilege — a thread started open by one
parent should be lockable by the other parent without the first parent's action.
`set_thread_visibility()` therefore checks current `thread_participants` membership, not
`created_by_member_id`. The symmetric consequence is deliberate: any participant can also
*unlock* it. That is what "by agreement" costs, and no AC in Epic 7 asks for a lock that only
its setter can release.

### Why private does not re-apply the single gate — and the boundary that keeps it honest

AD-22 resolution rule 2 ("open never widens AD-3") is stated for the `open` branch only. For
`private`, the participant list is itself an explicit human decision: if a single was
deliberately added to a private thread about a shidduch, that addition **is** the consent.
Re-applying the dignity-floor gate would create a strange asymmetry — a parent could
privately discuss a shidduch *with* the single while the single's own client filtered it
out — that no AC asks for and that empties the act of adding someone on purpose.

What makes this a decision rather than a hole is AC-6's second half. The carve-out is scoped
to **the thread**: the single reads the conversation and nothing else. `shidduchim`,
`resumes`, `interactions` and `entity_files` for that subject stay at zero rows under Epic
6's shipped policies (`05_policies.sql:352-367` and the sibling three-clause policies at
`:399`, `:464`, `:494`, `:604`, `:867`), which this story does not touch. Without that
assertion, "private beats the dignity floor" would be one join away from a general bypass;
with it, the blast radius is exactly the messages someone chose to include them in.

State it in the UI, too: adding a participant to a private thread is a disclosure decision,
and the composer's participant control is where a parent finds that out.

### Why extending one function is safer than editing three policies

If 7.1 had inlined the open/private logic into the `threads`, `thread_participants` and
`messages` policies separately, this story would have to edit three `CREATE POLICY`
statements identically and could easily let them drift — e.g. messages staying readable on a
thread whose `threads` policy already denies it. Because 7.1 centralized it in
`thread_is_readable()` — the same "one SQL function is the one authority" pattern as
`is_single_visible_state()` (`02_functions.sql:1484`, AD-3) — this story's entire enforcement
change is a single `CREATE OR REPLACE FUNCTION`. Keep it that way: a reviewer should be able
to read the whole permission boundary in one function body.

### References

- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-22`]
  — resolution rule 1: "Private beats scope… readership is its participants only… overrides
  the general connection-membership read in AD-20 and the general account read in AD-1."
- [Source: same file `#AD-3`] — the one-authority visibility function and the un-lowerable
  floor this story composes with rather than re-deriving.
- [Source: `.claude/rules/security-triggers.md`] — RLS-touching diffs require a negative
  test; AC-5 is that test.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-7-Communication`, Story 7.3]
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §8 rule 6 (`pg_dump`
  function form), §13 rules 2 and 4 (a guard must be proven red; zero-rows is asserted in the
  `db` project)].
- `supabase/schemas/02_functions.sql:1484` (`is_single_visible_state` — the one-authority
  precedent this story's centralization pays off against), `:249`/`:290`/`:316`
  (`current_context_id` / `current_member_id` / `current_member_role`).
- `supabase/schemas/05_policies.sql:352-367` (Story 6.2's three-part single gate, unchanged
  by this story and asserted still-holding by AC-6).
- `supabase/schemas/06_grants.sql:290-292` (function-grant convention).
- `src/components/atomic-crm/providers/supabase/dataProvider.ts:85-100`
  (`createShidduchViaRpc` — the RPC-wrapper shape).
- Story `7-1-thread-model.md` — `thread_is_readable()`'s v1 body (extended here, not
  replaced), the participant-gated INSERT policies, and `threads_entity.sql`.

## Dependencies

- **7.1** (blocking): `thread_is_readable()`, the three tables, the participant-gated INSERT
  policies, `threads_entity.sql`.
- **7.2** (blocking, ordering only): its account-default assertions live in the same SQL
  suite and AC-7 requires them to still pass.
- **Blocks 7.4**, which reuses this story's open/private resolution for the connection
  branch rather than writing a second copy.
- **Deploy coupling:** ships with 7.1 and 7.2.
- **Wave:** touches `02_functions.sql`, `06_grants.sql`, `dataProvider.ts` (both providers),
  both i18n catalogues and `threads/ThreadPanel.tsx` — **never the same wave as 7.1, 7.2 or
  7.5**, all of which write the same files.

## Declared file set

**Schema / DB**
`supabase/schemas/02_functions.sql`, `06_grants.sql`, one new
`supabase/migrations/<ts>_thread_privacy_enforcement.sql`,
`supabase/tests/threads_entity.sql` (extended).

**Providers / i18n**
`src/components/atomic-crm/providers/supabase/dataProvider.ts`,
`providers/fakerest/dataProvider.ts`,
`providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`.

**UI**
`src/components/atomic-crm/threads/ThreadPanel.tsx` and its `.test.tsx`.

**Generated**
`registry.json` (pre-commit `make registry-gen`).

No `types.ts` change, no schema table change, no tab/descriptor change, no
`CANONICAL_TAB_SETS` change, no `01_tables.sql` change — and therefore no column-order risk.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (developer subagent, harness dispatch), STACK_ID=3 / STACK_OWNER=7-3.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-3 -f
  thread_privacy_enforcement` emitted both `CREATE OR REPLACE FUNCTION` statements
  (`thread_is_readable`, `set_thread_visibility`) but, as the Hard-won rules warned, **no**
  grant/revoke statements for the new function — hand-added to the migration, matching 7.1's
  own precedent for the same gap. Verified against the live catalog
  (`information_schema.role_routine_grants`) before and after the hand-add.
- `db diff` converged ("No schema changes found") twice after the migration was applied.
- `make check-migration-safety STACK_ID=3` passed clean (function bodies only — no column
  added/dropped/narrowed, so no fixture extension was needed).
- Falsifiability proof (AC-5/Task 5): temporarily replaced `thread_is_readable()`'s private
  branch with `return true;` directly on the stack via `psql`, reran
  `npm run test:unit:db` — exactly 4 checks went red (the three AC-3/AC-5 zero-row assertions
  on the private A/B thread, plus AC-4's "flipped to private → 0 rows" step); all other 62
  checks stayed green. Restored the original function body and reconfirmed 66/66 green and
  `db diff` still converges.
- Full gate run: `make typecheck`, `npm run lint`, `npx prettier --check` (on this story's
  changed files — repo-wide `prettier --check .` has pre-existing, unrelated warnings in
  `doc/**`/`.github/**`/`.lintstagedrc`, none of which this story touched), the 4 CI guards
  (`check-suppressions.mjs`, `check-retired-names.mjs`, `check-route-convention.mjs`,
  `check-tailwind-arbitrary-var.mjs`), `npm run build`, and `make test STACK_ID=3` (227 files /
  2598 tests) all passed.

### Completion Notes List

- **Task 1**: `thread_is_readable()` gained the private branch exactly as specified — inserted
  after the account-scope check, before the single's dignity-floor branch, returning ONLY the
  participant-membership `exists()` for `visibility = 'private'` with no re-check on top.
  Header comment rewritten to describe the closed gap (previously documented as an open,
  deploy-coupled hazard by 7.1/7.2's own review findings F1.5/F1) rather than still warning
  about it.
- **Task 2**: `set_thread_visibility()` added with the two documented SQLSTATEs —
  `invalid_parameter_value` (22023) for a bad `p_visibility`, `insufficient_privilege` (42501)
  for BOTH "not readable" and "not a listed participant" (the same code for both, since Task 2
  itself describes them as one compound "may this caller touch this thread" refusal — for a
  private thread the two checks are the same test by construction). No table-level UPDATE
  grant added to `threads` for `authenticated` — verified live via
  `information_schema.role_table_grants` (SELECT only).
- **Task 3**: `setThreadVisibility()` wrappers added to both dataProviders. Also added
  `getCurrentMemberId()` to both — not explicitly named by the story, but required to satisfy
  Task 4's "derive participation from the thread's already-loaded participant list": there is
  no existing client-side primitive for "my own `account_members.id` in the active context"
  (the same trap `ThreadPanel.tsx`'s pre-existing Composer comment documents for message
  attribution), so this is the minimal server-authoritative resolver, backed by the
  already-existing, already-granted `current_member_id()` RPC on the Supabase side and the
  existing `resolveCallerMembership()` internal helper on the FakeRest side (no new SQL, no new
  FakeRest identity logic — both already existed for other purposes). Cached under one
  `["currentMemberId"]` query (`threads/useCurrentMemberId.ts`) so only the FIRST `ThreadPanel`
  opened in a session pays for it; every other thread in the same session reuses the cache and
  only pays for its own `thread_participants` fetch.
- **Task 4**: `ThreadPanel.tsx` now takes the whole `Thread` record (not just its id) so
  `visibility` comes from `ThreadList.tsx`'s already-loaded list rather than a second
  `getOne("threads", …)` round trip inside the panel — this required a small, in-scope change
  to `ThreadList.tsx` (within the dispatched `threads/**` glob, though not named in this
  story's own "Declared file set" prose) to pass the resolved `Thread` object instead of a bare
  id. The control renders nothing (not disabled — absent) for a non-participant or while
  participation is still resolving (fail-closed). Copy is under `crm.threads.visibility.*` in
  both catalogues, genuinely translated into French. `onChanged` calls the panel's existing
  `refresh()` (the same mechanism the Composer already uses for AC-4/AC-8), which invalidates
  every active query — satisfying the round-trip requirement.
- **Task 5**: `threads_entity.sql` extended with the AC-5 three-member fixture (a NEW second
  `parent_admin`, B; the existing helper reused as C), the AC-4 round trip, the AC-6 pair (with
  new `resumes`/`interactions`/`entity_files` fixture rows on Rivka's shidduch, since none
  existed for that subject before this story), the AC-8 connection-axis refusal (a fresh
  service-role-seeded connection thread, since 7.1's existing one is deleted by the AC-10
  cascade earlier in the file), and the AC-1 positives/negative. Suite grew from ~44 to 66
  checks. `ThreadPanel.test.tsx` gained a `ThreadPanelHarness` wrapper (`useGetOne("threads",
  …)`) so its "flip to private, observe the control update without a reload" test exercises the
  SAME live-refetch wiring production uses (a static prop object, as the pre-7.3 test passed,
  never re-renders on `refresh()` — this was caught by the test initially failing red before
  the harness was added). A new colocated `dataProvider.setThreadVisibility.test.ts` covers the
  FakeRest mirror's two refusals (not explicitly named in this story's own "Declared file set",
  but follows the exact precedent of `dataProvider.createThread.test.ts` sitting beside
  `dataProvider.ts`).
- **Not done / flagged, not fixed**: `settings/CommunicationSection.tsx` still hard-disables
  the account-default "Private" radio (its own header comment says this is provisional "until
  Story 7.3 lands"). Re-enabling it is not one of this story's ACs and the file is outside the
  dispatched path set — left disabled and named here as a fast-follow, per that file's own
  comment ("whoever does that must re-check `CommunicationSection.tsx`'s disabled state at the
  same time").

### File List

**Owned paths (schema/DB)**
- `supabase/schemas/02_functions.sql` — `thread_is_readable()` private branch;
  `set_thread_visibility()` added.
- `supabase/schemas/06_grants.sql` — grants for `set_thread_visibility()`.
- `supabase/migrations/20260802024905_thread_privacy_enforcement.sql` — new; generated via
  `db diff`, hand-completed with the function grants `db diff` omitted.
- `supabase/tests/threads_entity.sql` — extended (AC-1, AC-3, AC-4, AC-5, AC-6, AC-8 checks).

**Owned paths (providers / i18n)**
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — `setThreadVisibility()`,
  `getCurrentMemberId()`.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — same two methods, FakeRest
  mirror.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — `crm.threads.visibility.*`.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same, translated.

**Owned paths (UI)**
- `src/components/atomic-crm/threads/ThreadPanel.tsx` — `VisibilityControl`, participation
  derivation.
- `src/components/atomic-crm/threads/ThreadPanel.test.tsx` — new tests + `ThreadPanelHarness`.

**Within the dispatched `threads/**` glob, beyond this story's own "Declared file set" prose**
- `src/components/atomic-crm/threads/ThreadList.tsx` — passes the whole `Thread` record to
  `ThreadPanel` instead of a bare id (needed for the "no second round trip" requirement).
- `src/components/atomic-crm/threads/useCurrentMemberId.ts` — new; the cached
  `getCurrentMemberId()` query hook.

**Within the dispatched `providers/fakerest/dataProvider.ts` feature unit, beyond the single
named file**
- `src/components/atomic-crm/providers/fakerest/internal/threads.ts` — `setThreadVisibility()`
  mirror; `isThreadParticipant()` exported for reuse (was file-private).
- `src/components/atomic-crm/providers/fakerest/dataProvider.setThreadVisibility.test.ts` —
  new; FakeRest mirror unit tests, colocated per this directory's existing convention.

**Not touched (confirmed by design)**: `supabase/schemas/05_policies.sql`,
`supabase/schemas/01_tables.sql`, `supabase/schemas/03_views.sql`, `src/components/atomic-crm/types.ts`,
`src/components/atomic-crm/settings/CommunicationSection.tsx`.
