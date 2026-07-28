# Story 3.8: Universal Tasks tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want record-scoped tasks,
so that follow-up attaches to the thing it is about.

## Position in Epic 3

This story conforms to the **Epic 3 canonical API contract** (the companion document that
fixes the shapes for all 14 Epic 3 stories). The sections that bind this story are §8
(universal tab props + the target-type vocabulary), §10 (ownership), §11 Ruling 1 (the
household-scope lift) and Ruling 2 (Tasks: the tab is canonical, the rail is a summary),
§12 (build order) and §13 (test-shape rules).

**Blocking dependencies — this story does not start until all three have landed:**

| Depends on | Why |
|---|---|
| **3.9** (`RecordLink` + target-type vocabulary + `reminders/`) | 3.9 owns `ENTITY_TARGET_TYPES` / `EntityTargetType` and the widening of `TaskTargetType` in `types.ts`, **and** the two `Record<TaskTargetType, string>` maps at `src/components/atomic-crm/reminders/reminderEntity.ts:21` (`RESOURCE_FOR_TARGET`) and `:28` (`TARGET_TYPE_LABEL`), plus `reminders/useReminders.ts:42` (`ALL_TARGET_TYPES`) and its three-hook tuple at `:93`. Widening the union without those edits is `Property 'single' is missing` ×2 and a silently-skipped reminder bucket. Contract §10 + §12 step 3. |
| **3-14** (household-scope lift for `tasks` + `interactions`) | `validate_tasks_household_scope` (`supabase/schemas/04_triggers.sql:207-209`) fires `enforce_household_scope()` (`02_functions.sql:387-402`), which raises `'account % is not a household-kind account'` for any `kind = 'shadchanus'` context. Combined with `set_tasks_account_id` (`04_triggers.sql:123-125`) assigning `current_context_id()`, **every task insert by a shadchan in their own context fails with a raw Postgres exception** — while AC 3 below makes `TasksTab` accept `targetType: "shadchan"`, which Epic 8 Story 8.5 is built on. 3-14 drops that trigger. Contract §11 Ruling 1. |
| **3.2** (`buildEntityRoutes`, `Entity360Tabs`, path builders) | AC 5's rail links into the Tasks tab with `buildTabPath(resource, id, "tasks")`. No path in this story is built by template literal (contract §4, path builders). |

**Fourth blocking dependency — 3.5 (Activity), for one specific artefact.** The contract's
build order calls 3.5 a mere ordering predecessor (step 8 vs. this story's step 10), and this
story is independent of 3.5's *component* work. But AC 1 adds `'single'` to
`tasks_target_type_check`, and contract §8 rule 3 forbids adding a target type without the
matching purge trigger — which is 3.5's (`purge_polymorphic_dependents('single')` on
`public.singles`, contract §10). Task 0 therefore **blocks** on it, and correctly refuses to
add the trigger here. Treat 3.5 as a hard blocker for AC 1; only the tab component is
independent of it. 3.5 also authors
`src/components/atomic-crm/entity360/tabs/types.ts` (`UniversalTabProps`), the
`PENDING_DB_WIDENINGS` guard (contract §8 rule 2) and the purge triggers on `public.singles`
and `public.shadchanim` (contract §10). Task 0 below verifies each; where a shared artefact is
genuinely absent this story authors it to the contract shape unchanged, **except** the purge
triggers, which are 3.5's and must not be written here.

> The previous revision of this story said *"Depends on 3.3 … Suggested order: `… → 3.7 → 3.8`"*
> and claimed independence from the other tab stories. Both statements are deleted: only the
> 3.9-before-3.8 order compiles (contract §12 step 3), and 3-14 is a hard blocker.

## Scope boundary

A standalone, tested `TasksTab` **and** a standalone, tested `TasksRailSummary`, plus one
CHECK-constraint widening. Neither component is mounted into any live entity's tab bar or
right rail — that is Epic 5's job (`5-1:102`, `5-7:83`, `5-8`, `5-9`, `5-10`).

This is the **smallest schema change of the four tab stories**: `public.tasks` is already
polymorphic (`supabase/schemas/01_tables.sql:31-51`) and its RLS is already a flat,
unconditional account check (`05_policies.sql:33-36`) with no per-target-type branching to
add, unlike `interactions` in 3.5. The one real risk in this story is a **trigger**, not a
policy — see the 3-14 dependency above.

## This story's reuse target already exists and already works

`src/components/atomic-crm/references/ReferenceTasks.tsx` is a complete, working,
record-scoped Tasks implementation against the polymorphic `tasks` table today: add
(text + optional due date) at `:45-71`, list sorted by `due_date ASC` at `:37-41`, toggle
done via `done_date` at `:73-93`, empty state at `:125-130`, `useNotify` failure handling at
`:65-70` and `:85-92`. This story generalises it into `entity360/tabs/TasksTab.tsx` by
parameterising **both** `target_type` and `target_id`; it does not design a new interaction
pattern.

`ReferenceTasks.tsx` is left in place, unedited. It stays live behind
`references/ReferenceShow.tsx:159` until Story 5.10 deletes it
(`5-10:123-125`). No third task add/toggle implementation is written anywhere
(contract §11 Ruling 2 rule 5).

## Acceptance Criteria

1. **`tasks_target_type_check` reaches the four-value vocabulary, and nothing else in
   `supabase/schemas/` changes.**
   Today the constraint is `target_type in ('shadchan', 'shidduch', 'reference')`
   [Source: supabase/schemas/01_tables.sql:45-47]. After this story it is
   `target_type in ('shadchan', 'shidduch', 'reference', 'single')` — exactly the four values
   of `ENTITY_TARGET_TYPES` (contract §8; the constant itself is Story 3.9's).
   Falsifiable as all five of:
   a. A new `db`-project assertion: under an authenticated household context, an insert of a
      `'single'`-targeted task succeeds and the stored row satisfies
      `account_id = public.current_context_id()`. It fails today (check violation) and passes
      after the migration.
   b. The existing assertion at `supabase/tests/references_entity.sql:237-243` — *"the retired
      `'contact'` target type is rejected"* — still passes. `'contact'` is **not** added.
      (The previous revision's headline, *"drops the fossil `contact` value"*, was false:
      `contact` has never been in this check, and a test already pins its rejection.)
   c. `npm run test:unit:db` is green — no existing suite assumed a three-value set.
   d. The generated migration is `alter table … drop constraint … add constraint …`. If
      `supabase db diff` emits a drop/recreate of `public.tasks`, hand-correct it before
      applying (AGENTS.md, *Database Management*).
   e. `git diff` for this story shows **no change** to `supabase/schemas/05_policies.sql`,
      `supabase/schemas/04_triggers.sql` or `supabase/schemas/06_grants.sql`. The `tasks`
      policy stays the flat account check at `05_policies.sql:33-36`; the grants stay
      `06_grants.sql:602-603`; no trigger is added, renamed or dropped by this story.

2. **The TypeScript union and `reminders/` are not this story's to edit, and the pending-widening
   list shrinks by one.**
   `TaskTargetType` (`src/components/atomic-crm/types.ts:71`) is already the four-value
   `EntityTargetType` when this story starts — Story 3.9 widened it, together with the two
   `Record<TaskTargetType, string>` maps in `reminders/reminderEntity.ts:21,28` (contract §10).
   Falsifiable as all three of:
   a. **Precondition:** `npm run typecheck` is green on the working tree *before* the first
      line of this story is written. If it is red with `Property 'single' is missing` on
      `reminderEntity.ts`, 3.9 has not landed and this story is blocked — do not "fix" it by
      editing `reminders/`.
   b. This story's File List contains neither `src/components/atomic-crm/types.ts` nor any
      path under `src/components/atomic-crm/reminders/`.
   c. `tasks_target_type_check` is removed from the `PENDING_DB_WIDENINGS` constant that
      accompanies the contract §8 rule 2 schema guard, and that guard is green. (Story 3-15
      asserts the list is empty; 3.5 and 3.7 remove the other two entries.)

3. **`TasksTab` takes exactly `UniversalTabProps` and parameterises both fields.**
   `src/components/atomic-crm/entity360/tabs/TasksTab.tsx` exports
   `TasksTab(props: UniversalTabProps): ReactElement`, where `UniversalTabProps` is
   `{ targetType: EntityTargetType; targetId: Identifier }` imported from
   `entity360/tabs/types.ts` (contract §8). No extra props, no per-entity variant, no default
   value for `targetType`, no `targetType` string literal anywhere in the file body.
   Behaviour, generalised from `ReferenceTasks.tsx`: add (text + optional due date), list
   filtered by `{ target_type, target_id }` and sorted `due_date ASC`, toggle done/undone by
   writing `done_date`.
   Falsifiable in the `app` project (`vitest-browser-react` in Chromium, `TestMemoryRouter`
   from `ra-core` — pattern file `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-4,59-87`):
   a. A table-driven `it.each` over all four values of `ENTITY_TARGET_TYPES` asserting the
      `getList` call carries `filter: { target_type: <t>, target_id: <id> }` and the `create`
      call carries `data.target_type === <t>` and `data.target_id === <id>`. A copy-paste that
      renames `referenceId` to `targetId` while leaving `target_type: "reference"` hard-coded
      fails three of the four rows.
   b. The toggle test: a task with `done_date === null` is updated to a non-null ISO string,
      and one with a `done_date` is updated back to `null`.
   c. The create payload contains **only** `target_type`, `target_id`, `text` and `due_date`.
      `member_id`, `account_id` and `delivery_channels` are all server-set — respectively
      `set_member_id_default()` [Source: supabase/schemas/02_functions.sql:168-178],
      `set_tasks_account_id` → `set_account_id_default()`
      [Source: supabase/schemas/04_triggers.sql:123-125] and the column default
      [Source: supabase/schemas/01_tables.sql:42]. Sending any of them from the client is a
      failing assertion. This story adds **no** delivery-channel picker; AD-13's delivery
      invariants are untouched
      [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:121].

4. **A task created in the tab lands in the row shape the global Tasks list reads — asserted
   where that can actually fail.**
   The global list is `useGetList("tasks", { …, filter: { member_id: identity?.id } })`
   [Source: src/components/atomic-crm/tasks/TasksListByDueDate.tsx:27-34], and `member_id` is
   populated by the Postgres trigger function `set_member_id_default()`
   [Source: supabase/schemas/02_functions.sql:168-178], which the browser-mode test
   environment never runs. **A browser-mode "read `tasks` unfiltered by target" test therefore
   verifies nothing and cannot fail** — that is what the previous revision proposed and it is
   deleted. Split in two:
   a. `db` project: insert a `'single'`-targeted task using the exact column set `TasksTab`
      sends (`target_type, target_id, text, due_date`) under an authenticated JWT context, then
      assert the stored row has `member_id = (select id from public.members where user_id = auth.uid())`
      **and** `account_id = public.current_context_id()` — i.e. it satisfies the global list's
      filter. This fails if the client ever starts sending its own `member_id`, or if the
      trigger is removed.
   b. `app` project: assert `TasksTab`'s create call names resource `"tasks"` — the same
      resource the global list reads. There is no second table and no synchronisation code;
      "completing it there reflects everywhere" is a property of not duplicating the table, and
      the only falsifiable form of that claim is the resource string.
   **Stated limitation, not fixed here:** `tasks.member_id` points at `public.members` (the
   global user/profile table), **not** at `public.account_members`
   [Source: supabase/schemas/01_tables.sql:53-58 and the `comment on column` at :58]. So a task
   created by parent A never appears in parent B's global list, even in the same household, and
   this story adds no assignee control. That comment says resolving the collision is
   "Epic 2 (AD-19)"; the comment is still in the tree, so Epic 2 did **not** resolve it. See
   *Flagged for the epic owner* below.

5. **Ruling 2 — the tab is canonical; the rail is a read-only summary.**
   `src/components/atomic-crm/entity360/tabs/TasksRailSummary.tsx` exports
   `TasksRailSummary(props: UniversalTabProps & { limit?: number }): ReactElement`: the next
   `limit` (default 3) **incomplete** tasks (`done_date is null`) by due date, plus one link
   into the Tasks tab. **No add, no toggle, no edit, no delete.** `TasksTab` is the only
   component in the codebase that mutates tasks from a 360 (contract §11 Ruling 2).
   The link target is `buildTabPath(resource, targetId, "tasks")` where `resource` comes from
   `useResourceContext()` — the same mechanism `Entity360Tabs` uses (contract §6 rule 4). No
   path in either file is built by template literal.
   Falsifiable as both of:
   a. **Guard test, shown red once before it is shown green** (contract §13 rule 2): a `?raw`
      source scan — the `import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })`
      idiom at `src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20` — asserts
      `TasksRailSummary.tsx`'s source contains none of `useCreate`, `useUpdate`, `useDelete`,
      `useMutation`, and imports no form component. Prove it red by temporarily adding
      `useCreate` to the file, then remove it.
   b. Behaviour test: given seven tasks (five incomplete, two complete), exactly three rows
      render, all three incomplete, ordered by `due_date ASC`; the DOM contains no checkbox,
      no submit button and no text input; and the "see all" link's `href` equals
      `buildTabPath(resource, targetId, "tasks")`.
   Story `5-7`'s AC 3 as currently written — *"the panel **is** Story 3.8's
   `entity360/tabs/TasksTab.tsx` with `{ targetType: "shidduch", targetId }`"*
   [Source: _bmad-output/implementation-artifacts/5-7-shidduch-right-rail.md:48-53] — is
   superseded by contract §11 Ruling 2 point 3. This story ships the component 5-7 must mount.
   **Do not edit `5-7` from this story.**

6. **Empty, loading and error states render for both components** (UX-DR11)
   [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187].
   Falsifiable as one named test per state per component:
   - **Empty** — `getList` resolves `[]`: an explicit empty message renders (assert its text),
     not a blank container. For `TasksTab` the add form is still present and usable.
   - **Loading** — `getList` unresolved: a pending affordance renders and no empty-state copy
     appears. Assert the empty-state text is absent with
     `await expect.element(screen.getByText(...)).not.toBeInTheDocument()`
     [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:95].
   - **Error** — `getList` rejects: a visible error message renders; `TasksTab`'s add form and
     `TasksRailSummary`'s link into the tab both still render (a failed read does not blank the
     surface).
   - **Mutation failure** (`TasksTab` only) — a rejected `create` surfaces through `useNotify`
     and **does not clear** the text input, so the user's typing is not lost. Pattern:
     `references/ReferenceTasks.tsx:65-70,85-92`.

7. **No third task add/toggle implementation; `references/` is untouched.**
   Falsifiable: this story's File List contains no path under
   `src/components/atomic-crm/references/`, and `git diff --stat -- src/components/atomic-crm/references/`
   is empty for this story's branch. `ReferenceTasks.tsx` stays live behind
   `references/ReferenceShow.tsx:159` until Story 5.10 deletes it. Adapting it in place, or
   deleting it here, is out of scope in both directions.

## Tasks / Subtasks

- [ ] **Task 0 — Preconditions** (AC: 1, 2, 3, 5 — blocking; stop and raise if any fails)
  - [ ] 3.9 landed: `src/components/atomic-crm/types.ts:71` `TaskTargetType` carries four
        values, and `npm run typecheck` is green on the untouched tree.
  - [ ] 3-14 landed: `grep -n "validate_tasks_household_scope" supabase/schemas/04_triggers.sql`
        returns nothing, and on the local stack
        `select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal;`
        does not list it. **Do not drop it from this story** — that is 3-14's staged, rehearsed
        migration (contract §11 Ruling 1).
  - [ ] 3.5 landed the purge triggers: `grep -n "purge_polymorphic_dependents('single')" supabase/schemas/04_triggers.sql`
        returns a trigger on `public.singles`. Without it, widening the check strands
        `single`-targeted tasks when a single is deleted
        [Source: supabase/schemas/02_functions.sql:1799-1817 — the function deletes
        `identity_signals`, `interactions` and `tasks` for the parent it is wired to].
        **Stop and raise; do not add the trigger here** (contract §10 assigns it to 3.5).
  - [ ] 3.2 landed `buildTabPath` in `src/components/atomic-crm/entity360/entityPaths.ts`.
  - [ ] `src/components/atomic-crm/entity360/tabs/types.ts` exports `UniversalTabProps`. If
        absent (3.5 not yet merged), author it here to the contract §8 shape **verbatim** — do
        not invent a variant, do not inline the union in `TasksTab.tsx`.

- [ ] **Task 1 — Schema** (AC: 1, 2c)
  - [ ] Edit `supabase/schemas/01_tables.sql:45-47` to
        `target_type in ('shadchan', 'shidduch', 'reference', 'single')`.
  - [ ] Refresh the table's AD-13 comment at `01_tables.sql:27-30` — it currently enumerates
        *"a shadchan, a shidduch or a reference"*. Add the single, in AD-23 vocabulary
        (**single**, never "child" or "candidate"; `scripts/check-retired-names.mjs` fails CI on
        the retired words).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f widen_tasks_target_type`
        (the D-Bus prefix is mandatory on this machine or the CLI hangs on the keyring).
  - [ ] Hand-check the migration: `alter table … drop constraint tasks_target_type_check` +
        `add constraint …`, **not** a drop/recreate of `public.tasks`.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
  - [ ] Remove `tasks_target_type_check` from `PENDING_DB_WIDENINGS` and re-run the contract
        §8 rule 2 schema guard.

- [ ] **Task 2 — `entity360/tabs/TasksTab.tsx`** (AC: 3, 4b, 6)
  - [ ] Generalise `references/ReferenceTasks.tsx`: parameterise the `useGetList` filter, the
        `useCreate` payload and the `useUpdate` toggle by `targetType`/`targetId`. Do **not**
        copy-paste and rename `referenceId` while leaving `target_type: "reference"` hard-coded
        — AC 3(a) fails on three of four rows if you do.
  - [ ] User-facing strings go through `useTranslate` with an `_:` English fallback, key
        namespace `crm.entity360.tasks.*` (contract §13 rule 6; existing pattern
        `references/ReferenceTasks.tsx:101-130`). Do not cement a hardcoded English label map
        inside `entity360/`.
  - [ ] `TasksTab.test.tsx`: the `it.each` over `ENTITY_TARGET_TYPES`, the toggle cycle, the
        payload-shape assertion, the resource-name assertion, and the four state tests.

- [ ] **Task 3 — `entity360/tabs/TasksRailSummary.tsx`** (AC: 5, 6)
  - [ ] Read-only: one `useGetList` with `filter: { target_type, target_id, "done_date@is": null }`,
        `sort: { field: "due_date", order: "ASC" }`, `pagination: { page: 1, perPage: limit }`.
        (The `@is` operator is supported by the PostgREST filter convention and the FakeRest
        adapter — see `providers/fakerest/internal/transformFilter.ts`.)
  - [ ] Link via `buildTabPath(useResourceContext(), targetId, "tasks")`. No template-literal
        paths.
  - [ ] `TasksRailSummary.test.tsx`: the seven-task limit/order/no-mutation-controls test and
        the state tests.
  - [ ] `TasksRailSummary.guard.test.ts`: the `?raw` scan. **Show it red once** (temporarily add
        `useCreate` to the component) before showing it green, and say so in the Completion
        Notes.

- [ ] **Task 4 — `db` suite** (AC: 1a, 1b, 1c, 4a)
  - [ ] New `supabase/tests/tasks_target_types.sql` + `supabase/tests/tasks_target_types.test.ts`,
        modelled on `supabase/tests/context_rls_hardening.test.ts` (the SQL emits one JSON row
        per check; the `.test.ts` turns each into a named test) and using
        `bailIfDbUnreachable` from `supabase/tests/dbSuiteHelpers.ts`.
  - [ ] The SQL **must** `set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'`
        before inserting — pattern `supabase/tests/context_rls_hardening.sql:78`. A bare psql
        session has `auth.uid()` NULL → `current_context_id()` NULL → a NOT NULL violation on
        `account_id`, which fails for a reason unrelated to this change. (The previous
        revision's "psql insert, rolled back afterwards" step had exactly that bug.)
  - [ ] Checks: `'single'` target accepted; `account_id = current_context_id()` on the stored
        row; `member_id` resolved by the trigger to the caller's `public.members` row;
        `'contact'` still rejected; a task with no target still rejected (the existing
        `sync_task_target()` guard).
  - [ ] `npm run test:unit:db`.

- [ ] **Task 5 — Non-goal guard** (AC: 7)
  - [ ] `git diff --stat -- src/components/atomic-crm/references/ src/components/atomic-crm/reminders/ src/components/atomic-crm/types.ts`
        is empty for this story's branch. Any hit belongs to Epic 5 (references) or Story 3.9
        (reminders, types) — move it, do not absorb it.

- [ ] **Task 6 — Validation** (AC: all)
  - [ ] `npm run typecheck`, `npx vitest run`, `npm run test:unit:db`, `npm run lint`,
        `npm run build`. (There is no `Makefile` in this repo; `make typecheck` / `make test`
        do not exist.)
  - [ ] The diff touches a database migration, so `.claude/rules/security-triggers.md` applies:
        dispatch SECURITY-REVIEWER.

## Dev Notes

### Why the household-scope trigger is the real risk here, and where it went

The previous revision's *"No RLS change is needed"* reasoned entirely about policies. The
policy claim is true — `"Tasks scoped to account"` is an unconditional
`account_id = public.current_context_id()` check with no per-target branching
[Source: supabase/schemas/05_policies.sql:33-36] — but the blocker was never a policy. It was
`validate_tasks_household_scope` [Source: supabase/schemas/04_triggers.sql:207-209] calling
`enforce_household_scope()` [Source: supabase/schemas/02_functions.sql:387-402], which raises
for any non-`household` account. Story 3-14 drops it (contract §11 Ruling 1). **Before
concluding anything about `tasks` writes, grep `04_triggers.sql` for the table name** — a
policy-only reading produces a change that typechecks, passes every mocked test, and dies with
a raw Postgres exception for shadchanim in their own context.

Widening who can *see* a task by **role** (a single seeing only their own) is Epic 6's
field/row-scoping work (FR90-93), not this story's. Do not add a role-conditional branch
pre-emptively.

### `sync_task_target()` is benign — recorded so it is not re-derived

`sync_task_target()` [Source: supabase/schemas/02_functions.sql:1823-1835] raises only when
`new.target_id is null`. It knows nothing about target **types**, so widening the CHECK does
not touch it and its trigger `sync_task_target_trigger`
[Source: supabase/schemas/04_triggers.sql:127-129] needs no edit. Its existence and hardened
`search_path` are already pinned by `supabase/tests/references_entity.sql:731,744`.

### Purge coverage

`purge_polymorphic_dependents()` [Source: supabase/schemas/02_functions.sql:1799-1817] deletes
`identity_signals`, `interactions` **and** `tasks` for the parent it is wired to, and it is
wired only to `references` [Source: supabase/schemas/04_triggers.sql:109-111] and `shidduchim`
[Source: supabase/schemas/04_triggers.sql:118-120]. The existing proof that this works is
`supabase/tests/references_entity.sql:348-359`. Adding `'single'` creates a fourth target type
whose parent has no purge trigger — and `'shadchan'` already has the same hole today.
**Contract §10 assigns both triggers to Story 3.5**, which the build order places before this
one; Task 0 verifies them rather than adding them. If 3.5 has not landed, this story is
blocked, because a widened check plus a missing purge trigger strands rows that later surface
as reminders pointing at dead ids.

### The global Tasks list is scoped by creator, not by household — flagged, not fixed

See AC 4's stated limitation. `tasks.member_id` is an FK-less pointer at `public.members`
[Source: supabase/schemas/01_tables.sql:53-58], resolved from `auth.uid()` by
`set_member_id_default()` [Source: supabase/schemas/02_functions.sql:168-178]. Two parents in
one household therefore see disjoint global Tasks lists, and nothing in this story or any
other assigns a task to someone else. The schema comment names Epic 2 as the owner and Epic 2
shipped without resolving it. This story does not absorb the fix — see *Flagged for the epic
owner*.

### No FakeRest change is required

There is no task-target-type validation in the FakeRest provider to widen: `assertValidInteraction`
[Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:95-123] covers
`interactions` only, and it is invoked at `:463`. The generators seed only `reference`-targeted
tasks [Source: src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts:303,318,338];
adding `single`-targeted demo tasks is optional and out of this story's ACs.

### Vocabulary

AD-13's rule text writes the target set as `{shadchan, suggestion, reference}`
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:121].
It predates both AD-23 (which retires "suggestion"/"candidate"/"child" in favour of
**shidduch**, **single**, **shadchan**, **reference**)
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175]
and the four-entity tab matrix. The value set this story lands is the AD-23 one; AD-13's
delivery invariants (in-app + email floor, no SMS) are untouched. AD-13's illustrative list is
not normative on the value set.

Every UX-DR5 row includes **Tasks**
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172],
which is why the tab, not the rail, is canonical (contract §11 Ruling 2). `mockup/MyShadchan.dc.html`
puts reminders only in the rail; it is pre-AD-24 and is not a source for anything here.

### Testing standard

- `app` project for `TasksTab.test.tsx`, `TasksRailSummary.test.tsx` and
  `TasksRailSummary.guard.test.ts`: **`vitest-browser-react` in real Chromium**, with
  `TestMemoryRouter` and `CoreAdminContext` from `ra-core`
  [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-4,59-87;
  vitest.config.ts — the five projects]. **React Testing Library is not a dependency**: no
  `screen.queryByText`, no `MemoryRouter`. The negative idiom is
  `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`
  [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:95].
- `db` project for the schema half — browser-mode tests never touch the local Postgres, so
  every claim about triggers, defaults or constraints belongs there.
- AAA structure, descriptive test names, no `waitForTimeout`, ≥80% coverage on new code
  [Source: .claude/rules/testing.md].
- The `?raw` guard is shown red before green (contract §13 rule 2). A guard that cannot fail is
  not coverage.

### Migration workflow

Declarative schema in `supabase/schemas/` is the source of truth; migrations are generated
(AGENTS.md, *Database Management*). Prefix every `npx supabase` invocation with
`DBUS_SESSION_BUS_ADDRESS=/dev/null`. This story generates **one** migration and edits
`01_tables.sql` only; `02_functions.sql` is not touched, so its exact `pg_dump` formatting
requirement does not arise here.

### Project Structure Notes

- `TasksTab.tsx`, `TasksRailSummary.tsx`, `TasksRailSummary.guard.test.ts` and the two
  component test files live in `src/components/atomic-crm/entity360/tabs/`, beside
  `ActivityTab.tsx` (3.5), `NotesTab.tsx` (3.6) and `FilesTab.tsx` (3.7).
- `src/components/atomic-crm/entity360/` does not exist on `main` — nothing in Epic 3 is built
  yet.
- Keep both components under the ~400-line ceiling
  [Source: .claude/rules/coding-style.md]. If the add form grows, extract it rather than
  appending.

### Flagged for the epic owner (do not silently absorb into this story)

1. **Global-list scoping by `member_id`.** AC 4's limitation. `tasks.member_id` → `public.members`
   (global), not `account_members`; the schema comment at `01_tables.sql:53-58` names Epic 2 as
   the owner and Epic 2 did not resolve it. Two parents in one household see disjoint Tasks
   lists, and there is no assignee control anywhere in Epics 3-9. Needs an owner.
2. **`5-7` AC 3 still reads as written** (`5-7:48-53`, plus `5-7:83` and `:102-103`) and
   contradicts contract §11 Ruling 2. This story ships `TasksRailSummary`; 5-7's text must be
   amended by whoever owns that file.

## References

- [Source: _bmad-output/planning-artifacts/epics.md:551-562] — Epic 3 Story 3.8's own AC
  ("linked to that record and appears in the global Tasks list; completing it there reflects
  everywhere")
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:121]
  — AD-13: polymorphic tasks, in-app + email floor, no outbound SMS
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175]
  — AD-23: the entity vocabulary (**single**, never "child"/"candidate")
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]
  — AD-24: one shell, one route convention, one `RecordLink`, descriptor-driven, no bespoke
  layout code
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-172]
  — UX-DR4 shared tab vocabulary + UX-DR5 per-entity matrix (Tasks in all four rows)
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187]
  — UX-DR11: empty, loading and error states; light and dark; 375px
- [Source: src/components/atomic-crm/references/ReferenceTasks.tsx:24-93,101-130] — the working
  record-scoped implementation this story generalises
- [Source: src/components/atomic-crm/references/ReferenceShow.tsx:159] — its one live mount,
  deleted by Story 5.10
- [Source: supabase/schemas/01_tables.sql:27-30] — the AD-13 table comment this story refreshes
- [Source: supabase/schemas/01_tables.sql:31-51] — the `tasks` table; `:42` delivery-channel
  default, `:44` `target_type`, `:45-47` `tasks_target_type_check`
- [Source: supabase/schemas/01_tables.sql:53-58] — `tasks.member_id` points at `public.members`,
  not `account_members` (the global-list scoping limitation)
- [Source: supabase/schemas/05_policies.sql:33-36] — the flat account-scope policy, unchanged by
  this story
- [Source: supabase/schemas/06_grants.sql:602-603] — the `tasks` grants, unchanged by this story
- [Source: supabase/schemas/04_triggers.sql:123-125] — `set_tasks_account_id`
- [Source: supabase/schemas/04_triggers.sql:127-129] — `sync_task_target_trigger`
- [Source: supabase/schemas/04_triggers.sql:147-158] — the trigger-naming rationale
  ("renaming any of these is a migration-time total insert outage, not a refactor")
- [Source: supabase/schemas/04_triggers.sql:207-209] — `validate_tasks_household_scope`, dropped
  by Story 3-14
- [Source: supabase/schemas/02_functions.sql:168-178] — `set_member_id_default()`
- [Source: supabase/schemas/02_functions.sql:387-402] — `enforce_household_scope()`
- [Source: supabase/schemas/02_functions.sql:1799-1817] — `purge_polymorphic_dependents()`
- [Source: supabase/schemas/02_functions.sql:1823-1835] — `sync_task_target()`
- [Source: supabase/tests/references_entity.sql:237-243] — the existing "retired `'contact'`
  target type is rejected" assertion
- [Source: supabase/tests/references_entity.sql:348-359] — the existing purge proof for
  `reference`-targeted tasks
- [Source: supabase/tests/context_rls_hardening.sql:78] — the `set local request.jwt.claims`
  pattern the new db suite must use
- [Source: supabase/tests/context_rls_hardening.test.ts:1-40] — the SQL-emits-JSON-rows suite
  shape; [Source: supabase/tests/dbSuiteHelpers.ts] — `bailIfDbUnreachable`
- [Source: src/components/atomic-crm/types.ts:71] — `TaskTargetType`, widened by Story 3.9
- [Source: src/components/atomic-crm/reminders/reminderEntity.ts:21,28] — the two
  `Record<TaskTargetType, string>` maps that make 3.9-before-3.8 the only order that compiles
- [Source: src/components/atomic-crm/reminders/useReminders.ts:42,93] — `ALL_TARGET_TYPES` and
  the three-hook tuple, also Story 3.9's
- [Source: src/components/atomic-crm/tasks/TasksListByDueDate.tsx:27-34] — the global Tasks list
  query this story's writes must satisfy
- [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:95-123] —
  `assertValidInteraction`, which covers `interactions` only (no task equivalent to widen)
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-4,59-87] — the
  browser-mode test pattern and the negative idiom
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the
  `import.meta.glob(..., { query: "?raw" })` source-scan idiom
- [Source: _bmad-output/implementation-artifacts/5-7-shidduch-right-rail.md:48-53] — the AC 3
  this story's Ruling-2 restatement supersedes
- [Source: _bmad-output/implementation-artifacts/5-10-reference-360-and-diligence.md:123-125] —
  the story that deletes `ReferenceTasks.tsx`
- [Source: .claude/rules/testing.md, .claude/rules/coding-style.md,
  .claude/rules/english-only.md, .claude/rules/security-triggers.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
