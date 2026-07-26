# Story 3.6: Universal Notes tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want notes on any record,
so that context lives with the thing it describes.

## Position in Epic 3

**Depends on 3.5** — Notes and Activity are two views over the **same** `interactions`
table (a note is an interaction with `kind = 'note'`); 3.5's schema widening
(`target_type` → four values, the `scope_link_check` fourth branch, the
`current_member_id()` function and `set_interaction_actor_member_id` trigger) is a
prerequisite, not a parallel change. Also depends on **3.3** (tab descriptor shape) and,
for record mentions inside note bodies, **3.9** (`RecordLink`) — same suggested order as
3.5: `3.1 → 3.2 → 3.3 → 3.9 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8`.

**Scope boundary.** Same as every prior Epic 3 story: this delivers a standalone, tested
`NotesTab` component. Mounting it into a live entity's tab bar is Epic 5's job. It
**replaces** `shidduchim/ShidduchTimeline.tsx`'s inline `AddNote` sub-component as the
canonical way to write a shidduch note — but that replacement (deleting `AddNote` from
`ShidduchTimeline.tsx` and mounting `NotesTab` instead) happens when Epic 5 migrates
`shidduchim` onto `Entity360` (Story 5.1), not in this story. Do not edit
`ShidduchTimeline.tsx` here.

## Acceptance Criteria

1. **Notes are deletable without losing the audit trail — a soft delete.**
   `supabase/schemas/01_tables.sql`'s `interactions` table gains
   `deleted_at timestamp with time zone` (nullable). "Delete a note" (epics.md's own
   wording) sets `deleted_at`; the row is never removed by `DELETE`. This is a deliberate
   decision, not a gap: `06_grants.sql` already **withholds `DELETE`** on `interactions`
   with the comment *"interactions withholds DELETE as well (audit trail)"*
   [Source: supabase/schemas/06_grants.sql:512]. Soft-delete keeps that audit property
   intact while satisfying the user-facing requirement that a note can be removed from
   view. `ActivityTab` (3.5) and `NotesTab`'s own list both filter `deleted_at is null` —
   this story updates `ActivityTab`'s query to add that filter (the one cross-story
   coupling flagged in 3.5's Dev Notes).

2. **Only the author, or a `parent_admin`, may edit or soft-delete a note.** A new RLS
   `UPDATE` policy branch on `interactions`, scoped to `kind = 'note'`:
   ```sql
   with check (
       account_id = public.current_context_id()
       and actor_member_id = public.current_member_id()
       -- OR the caller's active-context role is parent_admin
   )
   ```
   (full policy text in Dev Notes — it must compose with, not replace, the existing
   visibility `using` clause from 3.5). Every other `kind` (`call_logged`,
   `status_change`, `merge`, `link_created`, `link_removed`) keeps today's unrestricted
   authenticated-member update, unchanged by this story. The column grant
   `grant update (body, metadata) on table public.interactions to authenticated`
   [Source: 06_grants.sql:532-533] gains `deleted_at` — a client may set `deleted_at`
   but not clear it back to `NULL` via ordinary update rights (undeleting is out of this
   story's scope; nothing in epics.md asks for it).

3. **Negative test.** Two members of the same account (different `account_members`
   rows, e.g. a `parent_admin` and a `helper`), one note authored by each: the `helper`
   can edit/soft-delete their own note but gets **zero rows affected** attempting to
   update the `parent_admin`'s note; the `parent_admin` can edit/soft-delete **either**.
   A member of a **different** account gets zero rows affected on both, proving the
   existing account-scope `using` clause still gates this branch too (not just the new
   author check) — this is the account-boundary half of the negative test the
   security-triggers rule requires, on top of the author-boundary half.

4. **`NotesTab` renders, adds, edits and soft-deletes.**
   `entity360/tabs/NotesTab.tsx` exports a component taking `{ targetType, targetId }`
   (same shape as `ActivityTab`), filtered to `kind = 'note' and deleted_at is null`,
   newest first. It reuses `interactionLabels.ts` (3.5) for nothing new — notes have no
   kind label to show — but reuses `formatTimelineDate`'s date formatting via the same
   helper 3.5 relies on. Each note shows body, author (resolved from `actor_member_id`
   via a `members` reference — see Dev Notes "Resolving the author's name"), and
   timestamp. An inline textarea adds a note (posts with `kind: "note"`, `scope`/
   `reference_link_id` set per the AD-3 discriminator rule already established for
   `shidduch`/`reference` targets, and `scope: "account"` for `shadchan`/`single`
   targets per 3.5's new branch). Edit/delete controls render only when the viewer is
   the note's author or `parent_admin` (client-side convenience only — the RLS policy
   from AC 2 is the actual boundary; a denied attempt shows a friendly error via
   `useNotify`, matching the existing error-handling pattern in
   `shidduchim/ShidduchTimeline.tsx:61-66`).

5. **Empty, loading and error states render.** Same treatment as 3.5 AC 6: skeleton while
   loading, an inline "no notes yet" message when empty, a friendly message on fetch
   error — not a blank tab.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: soft delete + author-scoped edit** (AC: 1, 2)
  - [ ] Add `deleted_at` to `interactions` in `01_tables.sql`.
  - [ ] Add the new RLS `UPDATE` policy branch (or extend the existing "for all" policy
        with an additional `kind = 'note'`-scoped `with check` clause — pick whichever
        composes more cleanly with the existing policy structure without duplicating the
        account/visibility `using` predicate; do not weaken the existing `using` clause
        while adding this).
  - [ ] Widen the `deleted_at`/`body`/`metadata` column grant in `06_grants.sql` per AC 2.
  - [ ] `db diff -f add_interaction_soft_delete_and_author_edit`, hand-check, `migration
        up --local`.

- [ ] **Task 2 — `current_member_id()` client exposure** (AC: 4)
  - [ ] Confirm 3.5's `current_member_id()` is callable by `authenticated` (3.5 Task 2
        grants it). Add a small `entity360/tabs/useMyMemberId.ts` hook that calls it via
        a lightweight RPC/`dataProvider` read and returns the caller's own
        `account_members.id` for the active context, used only to decide whether to show
        edit/delete controls (AC 4) — this hook does not gate anything by itself; it is a
        UI convenience layered on top of the real RLS boundary from AC 2.

- [ ] **Task 3 — The negative test** (AC: 3)
  - [ ] Extend the DB suite from 3.5 Task 3 (or its own file if that one is already
        large) with the author-boundary + account-boundary matrix from AC 3.

- [ ] **Task 4 — `NotesTab.tsx`** (AC: 4, 5)
  - [ ] Build per AC 4, reusing `formatTimelineDate` (move it alongside
        `interactionLabels.ts` if not already shared by 3.5 — check 3.5's actual file
        layout before duplicating it).
  - [ ] `NotesTab.test.tsx`: add/edit/soft-delete happy paths, author-only control
        visibility, empty/loading/error states (AAA, one behaviour per `it`).

## Dev Notes

### Resolving the author's name

`actor_member_id` points at `account_members.id`, not at `members.id` (the renamed
`sales` table) directly — `account_members` is the membership row, `members` is the
person. Rendering "who wrote this" therefore needs a join:
`account_members.user_id → members` (or `auth.users`, depending on how Epic 1's rename
of `sales` finally wires the FK — check `01_tables.sql`'s `account_members` definition
at implementation time rather than assuming). Do not deno-normalize the author's name
onto `interactions` itself — that would be a second source of truth for a name that can
change; resolve it at read time the same way `ShidduchTimeline`/`ShidduchShow` resolve
`shadchanName` from a separate list fetch today
[Source: src/components/atomic-crm/shidduchim/ShidduchShow.tsx:75-78,96-97].

### Full RLS policy text for AC 2

```sql
create policy "Notes editable by their author or a parent admin" on public.interactions
    for update to authenticated
    using (
        -- reuse the same visibility predicate as the base policy (3.5) —
        -- do not relax it here
        account_id = public.current_context_id()
    )
    with check (
        account_id = public.current_context_id()
        and (
            kind <> 'note'
            or actor_member_id = public.current_member_id()
            or exists (
                select 1 from public.account_members am
                where am.user_id = auth.uid()
                  and am.account_id = public.current_context_id()
                  and am.status = 'active'
                  and am.role = 'parent_admin'
            )
        )
    );
```
This is an **additional** policy alongside 3.5's existing `"Interactions scoped to
account and parent visibility"` — Postgres RLS `OR`s multiple permissive policies for the
same command together by default, so adding a second, narrower `UPDATE` policy here would
actually **widen** access, not restrict it. **Do not add a second policy** — fold this
`with check` clause into the *existing* policy's `UPDATE`-relevant `with check`
instead (or split the existing "for all" policy into per-command policies if that is
cleaner to reason about), so the two constraints compose with `AND`, not `OR`. Get this
right before writing the negative test, or the test will pass for the wrong reason.

### Testing standard

AAA, `app` project for `NotesTab.test.tsx`, `db` project for the RLS suite
[Source: .claude/rules/testing.md]. Security review required — this story touches an
RLS policy [Source: .claude/rules/security-triggers.md].

### Migration workflow

Same as 3.5: schema file → `db diff` → hand-check → `migration up --local`. Never `db
reset`/`db push`.

### Project Structure Notes

- `NotesTab.tsx` and `useMyMemberId.ts` live in `entity360/tabs/` beside `ActivityTab.tsx`
  and `interactionLabels.ts` from 3.5.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.6]
- [Source: 3-5-universal-activity-tab.md] — the schema widening and
  `current_member_id()` this story builds directly on top of
- [Source: supabase/schemas/06_grants.sql:341-351,512,528-533] — the existing DELETE
  withholding and column-scoped UPDATE grant this story extends, not replaces
- [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions — "Single-owner logic"] —
  why `current_member_id()` is not re-derived inline in this story's policy
- [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx] — the `AddNote`
  implementation this tab generalises and eventually replaces (Epic 5)
- [Source: .claude/rules/security-triggers.md, .claude/rules/testing.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
