# Story 7.3: Per-discussion privacy

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any participant,
I want to make a specific conversation private,
so that sensitive matters stay between the people actually in it, enforced by the
database rather than the UI (FR97, FR98).

## Position in Epic 7

**3rd of 5. Depends on 7.1** (`threads`, `thread_is_readable()`, `messages`,
`thread_participants`) **and 7.2** (this story doesn't touch
`default_thread_visibility`, but it must not regress it — a thread created with no
explicit `p_visibility` must still resolve per 7.2's account default before this
story's enforcement applies to it). Precedes 7.4 (connection scope reuses this story's
`thread_is_readable()` body verbatim, just adding a third branch) and 7.5
(notifications, unaffected by visibility).

This is the story where "private" stops being an inert column value and starts being
enforced. **Security-triggers.md is explicit: any diff touching RLS or a permission
boundary requires a negative test — this story's whole point is a permission boundary,
so its negative test (AC-4) is not optional.**

## Acceptance Criteria

1. **A thread can be made private, at creation or later.** `create_thread()` already
   accepts `p_visibility='private'` at creation (7.1). This story adds
   `public.set_thread_visibility(p_thread_id bigint, p_visibility text)` so an existing
   thread can be flipped **by agreement** (FR97) — any current `thread_participants`
   member of that thread may call it, not only its creator (see Dev Notes "Why any
   participant, not just the creator").

2. **Private means participants only — full stop.** `thread_is_readable()` is extended
   with a private branch: when `threads.visibility = 'private'`, the thread (and its
   messages, and its own participant roster) is readable **only** by a caller who is a
   listed `thread_participants` member of that thread — never by "any member of the
   account" (AD-1's general account read) and never widened by role (`parent_admin`
   included). This overrides AD-1's general account-scope read exactly as AD-22
   resolution rule 1 specifies.

3. **Non-participants see nothing — not even that the thread exists.** A same-account
   member who is not a participant of a private thread gets **zero rows** from
   `threads`, `messages` and `thread_participants` for that thread — not a
   permission-denied error, not a redacted stub, an absent row (RLS row-filtering, not
   a 403).

4. **Verification — the mandatory negative test.** `supabase/tests/threads_entity.sql`
   gains: one account, three members (A = parent_admin, B = parent_admin/spouse,
   C = helper); a thread between A and B only, explicitly made `'private'`; assert
   C's client reads **zero** rows from `threads`, `messages` and `thread_participants`
   for that thread, while A and B each read exactly the same one thread and its
   message. Additionally assert C **cannot break in**: C's attempt to INSERT a
   `thread_participants` row adding themselves to the private thread is rejected by
   RLS (7.1's participant-gated INSERT policy — re-proven here because this is the
   story whose promise it protects), and C's `set_thread_visibility()` call on that
   thread raises. This is the story's defining test, not incidental coverage.

5. **Open threads are unaffected.** Every 7.1/7.2 assertion in `threads_entity.sql`
   (open-thread readability, the dignity-floor gate for a `single`, the account-default
   resolution) still passes unchanged — this story adds a branch, it does not
   restructure the open case.

6. **Verification — the toolchain is green.** `make typecheck`, `npm run lint`,
   `make test`, `npm run test:unit:db` all pass with zero new warnings.

## Tasks / Subtasks

- [ ] **Task 1 — Extend `thread_is_readable()` with the private branch** (AC: 2, 3, 5)
  - [ ] `supabase/schemas/02_functions.sql`: `CREATE OR REPLACE FUNCTION
        public.thread_is_readable` — after the existing account-match + dignity-floor
        check (7.1's body, unchanged), add: if `visibility = 'private'`, return
        `exists (select 1 from thread_participants tp where tp.thread_id =
        p_thread_id and tp.member_id = public.current_member_id())` — and **nothing
        else** (no dignity-floor re-check on top; see Dev Notes "Why private doesn't
        re-apply the single gate"). If `visibility = 'open'`, keep 7.1's existing
        logic unchanged.
  - [ ] No RLS policy text changes anywhere — every policy from 7.1
        (`threads`/`thread_participants`/`messages` SELECT) already calls
        `thread_is_readable()`; extending the function extends every caller for free.
        This is the payoff of centralizing it in 7.1 instead of inlining the logic
        three times.

- [ ] **Task 2 — `set_thread_visibility()` RPC** (AC: 1)
  - [ ] `supabase/schemas/02_functions.sql`: `public.set_thread_visibility(p_thread_id
        bigint, p_visibility text) returns public.threads` — `SECURITY DEFINER SET
        search_path ''`. Validates `p_visibility in ('open','private')`; validates the
        caller is a current `thread_participants` member of `p_thread_id`
        (`tp.member_id = public.current_member_id()` — **not** merely a same-account
        member: a non-participant cannot flip visibility on a thread they're not even
        in, open or private); updates `threads.visibility`; returns the updated row.
  - [ ] Grant `execute` to `authenticated`/`service_role` in `06_grants.sql`
        (not `anon`). No table-level UPDATE grant on `threads` is added for
        `authenticated` — this RPC remains the sole write path for `visibility`,
        matching 7.1's "no UPDATE policy for authenticated" decision.

- [ ] **Task 2a — Generate and apply the migration** (AC: 1, 2, 3)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        thread_privacy_enforcement`. This migration is function-body-only
        (`CREATE OR REPLACE FUNCTION` for `thread_is_readable` and the new
        `set_thread_visibility`) — hand-check that `db diff` actually emitted both
        `CREATE OR REPLACE FUNCTION` statements (a `plpgsql` body change is sometimes
        missed if the signature is unchanged; if the generated migration is empty,
        write the two statements by hand into it).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`, never `db push`.

- [ ] **Task 3 — Types and provider** (AC: 1)
  - [ ] `providers/supabase/dataProvider.ts`: add `setThreadVisibility(threadId:
        Identifier, visibility: ThreadVisibility): Promise<Thread>` calling
        `.rpc("set_thread_visibility", { p_thread_id: threadId, p_visibility:
        visibility })`, same shape as `createShidduchViaRpc`.
  - [ ] Mirror in `providers/fakerest/dataProvider.ts` (AD-10).

- [ ] **Task 4 — UI: the privacy toggle** (AC: 1)
  - [ ] In `threads/ThreadPanel.tsx` (from 7.1), add a lock/unlock control calling
        `dataProvider.setThreadVisibility()`, visible only to current participants
        (non-participants can't see the thread at all, so this is naturally
        unreachable by anyone else). Copy through `i18nProvider`
        (`crm.threads.visibility.*`).

- [ ] **Task 5 — Tests** (AC: 4, 5, 6)
  - [ ] Extend `supabase/tests/threads_entity.sql` with the AC-4 negative test
        (three-member, one-account scenario above) and an AC-1 positive test
        (`set_thread_visibility` by a non-creator participant succeeds; by a
        non-participant same-account member fails).
  - [ ] Re-run the full `threads_entity.sql` suite to confirm AC-5 (no 7.1/7.2
        regressions).
  - [ ] Vitest for the privacy toggle (AAA, ≥80% new lines).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        prettier on this story's changed files only.

## Dev Notes

### Why any participant, not just the creator, can flip visibility

FR97: "A thread may be made private **at creation or by agreement**." "By agreement"
reads as any party to the conversation, not a creator-only privilege — a thread started
open by one parent should be lockable by the other parent too, without the first
parent's action. `set_thread_visibility()` therefore checks current
`thread_participants` membership, not `created_by_member_id`.

### Why private doesn't re-apply the single-visibility gate

AD-22 resolution rule 2 ("open never widens AD-3") is stated for the `open` branch
only. For `private`, the participant list is itself an explicit human decision — if a
single was deliberately added as a participant of a private thread about their own
suggestion, that addition **is** the consent; there is no separate "but is this
pipeline_state visible to a single" check layered on top. Re-applying the dignity-floor
gate to private threads would create a strange asymmetry (a parent could privately
discuss a suggestion *with* the single but the single's own client would still filter
it based on pipeline_state) that no AC asks for and that undermines the point of adding
someone to a private conversation on purpose. This is a deliberate design decision, not
an oversight — stated here so it isn't "fixed" into inconsistency later.

### Why extending one function is safer than editing three policies

If Story 7.1 had inlined the open/private logic separately into the `threads`,
`thread_participants` and `messages` policies, this story would need to edit three
`CREATE POLICY` statements identically and could easily let them drift (e.g., messages
staying readable on a thread whose `threads` policy already denies it). Because 7.1
centralized the logic in `thread_is_readable()` — the same "one SQL function is the one
authority" pattern as `is_single_visible_state()` (AD-3) — this story's entire
enforcement change is a single `CREATE OR REPLACE FUNCTION`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-22] — resolution rule 1: "Private beats scope…
  readership is its participants only… overrides the general connection-membership
  read in AD-20 and the general account read in AD-1."
- [Source: .claude/rules/security-triggers.md] — RLS-touching diffs require a negative
  test; this story's AC-4 is that test.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.3-Per-discussion-privacy]
- Story `7-1-thread-model.md` — `thread_is_readable()`'s v1 body (extended here, not
  replaced) and the `threads_entity.sql` test file this story extends.
- `supabase/schemas/02_functions.sql:578-599` (`is_child_visible_state` — the "one
  authority function" precedent this story's centralization pays off against).

### Project Structure Notes

- No new files beyond the UI toggle addition inside `threads/ThreadPanel.tsx`
  (7.1's file) and the RPC/provider additions inside existing files.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
