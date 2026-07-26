# Story 3.8: Universal Tasks tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want record-scoped tasks,
so that follow-up attaches to the thing it is about.

## Position in Epic 3

**Depends on 3.3** (tab descriptor shape). Independent of 3.5/3.6/3.7 (different table,
no shared migration). Suggested order: `... → 3.7 → 3.8` (last of the four tab stories,
no particular reason it must be last other than epics.md's own numbering).

**Scope boundary.** Standalone, tested `TasksTab` component. Not mounted into any live
entity's tab bar — Epic 5's job. **This story is the smallest schema change of the four
tab stories**, because `public.tasks` is already polymorphic and its RLS is already a
flat, unconditional account check (no per-target-type branching to add, unlike
`interactions` in 3.5).

## This story's reuse target already exists and already works

`references/ReferenceTasks.tsx` is a **complete, working, record-scoped Tasks
implementation** against the polymorphic `tasks` table today: add (text + due date),
list, and toggle-done, filtered by `target_type`/`target_id`
[Source: src/components/atomic-crm/references/ReferenceTasks.tsx]. This story
generalises that component into `entity360/tabs/TasksTab.tsx` by parameterising
`target_type` rather than hard-coding `"reference"` — it does not design a new
interaction pattern. `ReferenceTasks.tsx` itself is left in place, unedited, until Epic 5
migrates `references` onto `Entity360` and swaps it for `TasksTab`.

## Acceptance Criteria

1. **`tasks` accepts `single` and drops the fossil `contact` value.** Epic 1 Story 1.1
   already narrows `Task.contact_id` away and states *"`TaskTargetType` is `"shadchan" |
   "shidduch" | "reference"`"* [Source:
   _bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md — AC 10]. This
   story adds `single`: `tasks_target_type_check` becomes `target_type in ('shadchan',
   'shidduch', 'reference', 'single')` in `01_tables.sql`, and the TypeScript
   `TaskTargetType` union in `types.ts` gains `"single"` to match. No RLS change is
   needed — `"Tasks scoped to account"` is already an unconditional `account_id =
   current_context_id()` check with no per-target branching to widen
   [Source: supabase/schemas/05_policies.sql:57-65] (uses `current_context_id()` per the
   Epic 2 assumption stated in 3.5's Dev Notes "Epic 2 dependency" — same caveat applies
   here without repeating the full explanation).

2. **`TasksTab` generalises `ReferenceTasks.tsx`.**
   `entity360/tabs/TasksTab.tsx` takes `{ targetType: "shadchan" | "shidduch" |
   "reference" | "single"; targetId: Identifier }` and reproduces
   `ReferenceTasks.tsx`'s behaviour parameterised by both fields instead of the
   hard-coded `"reference"` / `referenceId`: add (text + optional due date), list sorted
   by due date, toggle done/undone via `done_date`. Delivery channels default as today
   (`['in_app', 'email']`, set by the table default, per AD-13) — this story does not add
   a channel picker. (`single` is not in AD-13's illustrative target list, which predates
   the four-entity tab matrix — the widening implements epics.md Story 3.8 / UX-DR5 and
   leaves AD-13's delivery invariants untouched.) `reminders/reminderEntity.ts`'s
   `RESOURCE_FOR_TARGET`/label maps gain their `single` entries in **Story 3.9**, not
   here — do not edit `reminders/` in this story.

3. **A completed task reflects in the global Tasks list.** Because `TasksTab` writes to
   the same `tasks` row the global list (`tasks/TasksListContent.tsx` →
   `TasksListByDueDate.tsx`, which survives Epic 1 unchanged) reads, no new synchronisation
   code is needed — this AC is satisfied by **not duplicating the table**, and is proven
   by a test that creates a task via `TasksTab`'s mutation and asserts a `useGetList`
   read against plain `"tasks"` (unfiltered by target) returns it.

4. **Empty, loading and error states render**, matching the treatment in 3.5-3.7.

## Tasks / Subtasks

- [ ] **Task 1 — Schema** (AC: 1)
  - [ ] Edit `tasks_target_type_check` in `01_tables.sql` as specified.
  - [ ] Add `"single"` to `TaskTargetType` in `types.ts`.
  - [ ] `db diff -f widen_tasks_target_type`, hand-check (a CHECK-constraint-only change,
        same shape as 3.5 Task 1 — confirm the diff is not a table
        drop/recreate), `migration up --local`.

- [ ] **Task 2 — `TasksTab.tsx`** (AC: 2, 3, 4)
  - [ ] Build by generalising `ReferenceTasks.tsx` — extract the shared logic (the
        `useGetList`/`useCreate`/`useUpdate` calls, the add form, the toggle handler) into
        `TasksTab.tsx` parameterised by `targetType`/`targetId`; do not copy-paste and
        rename `referenceId` to `targetId` while leaving `target_type: "reference"`
        hard-coded — that would defeat the point of this story.
  - [ ] `TasksTab.test.tsx`: one `it` per target type asserting the create/list/toggle
        cycle, plus the cross-read test from AC 3, plus empty/loading/error.

- [ ] **Task 3 — Confirm `ReferenceTasks.tsx` is untouched** (AC: none — a guard)
  - [ ] `git diff --stat` after this story touches no file under `references/` — if it
        does, that work belongs to Epic 5, not here.

## Dev Notes

### Why no RLS work is needed here (unlike 3.5)

`interactions` needed a new scope-derivation branch per target type because its
visibility is **conditional** on the target (AD-3's shidduch-visibility join). `tasks`
carries no such conditional visibility today — its policy is a flat account check
[Source: supabase/schemas/05_policies.sql:57-65]. Widening who can see a task by *role*
(e.g. a single seeing only their own tasks) is Epic 6's field/row-scoping work
(FR90-93), not this story's — do not add a role-conditional branch here pre-emptively.

### Testing standard

AAA, `app` project for `TasksTab.test.tsx` (fakerest/mocked provider — browser-mode
tests never touch the local Postgres). The schema half is verified at the DB layer
directly: after `migration up --local`, a `psql` insert of a `'single'`-targeted task
succeeds (rolled back afterwards), and `npm run test:unit:db` passes — confirming no
existing suite assumed the old `contact` value survived. No *new* SQL test file is
required: this story changes no RLS policy (the security-triggers rule still applies to
the migration itself — dispatch SECURITY-REVIEWER).

### Migration workflow

Same as 3.5-3.7.

### Project Structure Notes

- `TasksTab.tsx` in `entity360/tabs/`, beside `ActivityTab.tsx`, `NotesTab.tsx`,
  `FilesTab.tsx`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.8]
- [Source: ARCHITECTURE-SPINE.md#AD-13] — polymorphic tasks, delivery channels, no SMS
- [Source: src/components/atomic-crm/references/ReferenceTasks.tsx] — the working
  implementation this story generalises
- [Source: supabase/schemas/01_tables.sql:119-140] — the current `tasks` table and its
  `tasks_target_type_check`
- [Source: supabase/schemas/05_policies.sql:57-65] — the existing flat account-scope
  policy, unchanged by this story
- [Source: _bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md — AC 10]
  — `TaskTargetType` post-Epic-1 (`"shadchan" | "shidduch" | "reference"`, `contact_id`
  gone), the starting point this story adds `"single"` to
- [Source: src/components/atomic-crm/tasks/TasksListContent.tsx,
  TasksListByDueDate.tsx] — the global Tasks list this story's writes are already
  visible through, unmodified
- [Source: .claude/rules/testing.md, .claude/rules/coding-style.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
