# Story 12.3: Family-shared tasks with assignees

Status: ready-for-dev — **first story of Epic 12**

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Placement — SETTLED 2026-07-30 (reconciliation pass)

Number confirmed: **Story 12.3**, in **Epic 12 — Phase-1 Completion & Operational Readiness**.
The section *"Why the identifier is `12-3`"* below is kept as history; its predictions about
sibling numbering (12-5, 12-6) are superseded — the adopted orphans landed as 12.1, 12.3 (this),
12.4 and **5.12**, plus 12.2 from the silent-defects track.

The story's argument against Epic 5 was accepted in full, against the gap brief's own suggestion
("give it a story in Epic 5 alongside 5.9"): it has zero Epic 5 dependency, and Epic 5 placement
would put it in a wave contending on `types.ts`, `registry.json`, both i18n catalogues,
`supabase/schemas/**` and `entity360/tabs/{TasksTab,TasksRailSummary}.tsx` with 5.8/5.9/5.10 for
no reason. Its "not schedulable in the same wave as any Epic 5 story" constraint is recorded in
`epics.md` and stands.

**It is scheduled first in Epic 12 because two sibling stories depend on its outcome.**
Binding delivery order: **12.3 → 12.1 → 12.2 → 12.4.**

### Cross-story reconciliation findings (from the same pass)

- **F2 — BLOCKING interaction with Story 12.2 (reminder delivery), resolved in 12.2's favour of
  intent.** 12.2 AC-5 settles a null `member_id` as **`failed`**; this story makes **Unassigned**
  an explicit, legitimate choice (AC-3) and *nulls* every unresolvable `member_id` in its migration
  (AC-9). Together, every deliberately-unassigned reminder would be a permanent delivery failure.
  **Ruling, recorded in both files:** after this story, `member_id is null` settles **`skipped`**;
  `failed` is reserved for a non-null `member_id` naming no live or no enabled member. Nothing in
  *this* story changes — the amendment lands in 12.2 — but do not "fix" the null semantics here.
- **F3 — BLOCKING product consequence this story must state in its Rulings section.** The ruling
  *"`member_id` is the assignee and the creator is not tracked"* is accepted. Its consequence,
  once 12.2 ships, is that **assigning a reminder to your spouse silently redirects the only
  notification away from you, with no record of who asked.** Add this to *"Rulings this story makes
  (do not re-litigate inside the story)"* as an accepted cost, so a future reviewer meets it as a
  decision rather than as a bug report. 12.2 carries the mitigation: its reworded delivery line
  must name the recipient.
- **F4 — BLOCKING wave conflict with Story 12.2.** Both edit `reminders/ReminderCreateSheet.tsx`
  (this story adds the assignee select; 12.2 removes the push checkbox and rewords `:323-337`),
  plus `types.ts`, both i18n catalogues, `supabase/schemas/01|02|06`, `registry.json`,
  `e2e/fixtures.ts`, and each adds its own migration. **Never the same wave; this story first.**
- **F6 — AC-10's surface list is one surface short.** It enumerates `/tasks`, `/reminders`,
  `TasksTab` and `TasksRailSummary`. Story 12.1 adds a **dashboard** reminders card that lists
  household tasks — the same "shows everyone, unlabelled" shape this story exists to fix. This
  story does **not** grow to cover it (12.1's file does not exist yet at implementation time);
  instead, `tasks/TaskAssigneeChip.tsx` must be exported as a **reusable, surface-agnostic**
  component so 12.1 imports it rather than writing a second chip. 12.1 carries the obligation.
- **F10 — the 3-8 amendment is recorded in `epics.md`.** This story supersedes `3-8` AC 3(c) in
  part (`member_id` becomes client-sendable; `account_id`/`delivery_channels` do not), and per
  corpus convention does not edit `3-8`. The amendment is now noted under Epic 12 in `epics.md` so
  it cannot be lost with this file.
- **F14 — `registry.json` and both catalogues are contended** with 12.1, 12.2, 5.12 and Epic 5.

## Story

As a parent sharing a household with my spouse,
I want to assign a task to either of us and see what the other is handling,
so that we stop keeping two private to-do lists for one family's shidduchim.

## Why the identifier is `12-3`

This is one of four orphaned gaps the mobile gap analysis surfaced (`D3`) and the project owner
adopted. It belongs to no existing epic:

- It is **not Epic 5**. It has zero dependency on the Entity 360s — its whole dependency set
  (Epic 2's context/persona model, Epic 3's `tasks` scope lift and universal Tasks tab) is
  already **built and deployed** at `a8c5e3d`. Filing it as `5-12` would falsely bind it to
  Epic 5's serial wave order and to the `entity360/ad24Conformance.ts` contention that forces
  it, which this story does not have.
- It cannot be inserted into Epics 6–11 — those are storied and numbered, and renumbering them
  is out of this story's ownership.
- `_bmad-output/planning-artifacts/epics.md` is **not edited by this story** (a sibling agent
  places these). A trailing epic number is the only free space that requires no edit there.

**Epic 12 = "Adopted mobile-gap remediation".** The story number is the gap's own `D` number, so
the four sibling stories written in this same round cannot collide on a filename without any
coordination between their authors: `D1 → 12-1`, `D3 → 12-3`, `D5 → 12-5`, `D6 → 12-6`.
A later agent may renumber; nothing inside this file depends on the number.

**Recorded and explicitly disowned** at
`_bmad-output/implementation-artifacts/3-8-universal-tasks-tab.md:425-428` — "Two parents in one
household see disjoint Tasks lists, and there is no assignee control anywhere in Epics 3-9. Needs
an owner." This story is that owner.

## The diagnosis — read this before designing anything

The owner's framing ("closer to a correctness defect than a feature") is right, and the cause is
narrower than it looks. Verified against the tree on 2026-07-30:

**It is the query. It is not the policy, and it is not the column.**

| Layer | State today | Verdict |
|---|---|---|
| RLS | `create policy "Tasks scoped to account" on public.tasks for all to authenticated using (account_id = public.current_context_id()) with check (…)` (`05_policies.sql:35-38`). **No `member_id` term at all.** | Already household-wide. Not the cause. |
| Column | `tasks.member_id bigint`, FK-less, → `public.members(id)` (`01_tables.sql:36`, comment `:53-58`). Defaulted on insert from `auth.uid()` by `set_member_id_default()` (`02_functions.sql:168-178`) via `set_task_member_id_trigger` (`04_triggers.sql:6-9`). | Present and usable. Not the cause. |
| `/tasks` query | `TasksListByDueDate.tsx:32` — `filter: { member_id: identity?.id }`, where `identity.id` is `public.members.id` (`providers/supabase/authProvider.ts:11-23`). | **This one line is the entire defect.** |
| `/reminders` query | `useReminders.ts:127-132` — `useGetList<Task>("tasks", { filter: { "done_date@is": null }, … })`. No `member_id` term. | Already shows the whole household. |
| 360 Tasks tab | `entity360/tabs/TasksTab.tsx:80-84` — filters on `target_type`/`target_id` only. | Already shows the whole household. |

So the product does not have one behaviour, it has **two contradictory ones**: the same task row
is private on `/tasks` and shared on `/reminders` and on every record's Tasks tab, with no
attribution anywhere. Both halves are wrong. `/tasks` hides your spouse's work; `/reminders`
shows it to you unlabelled, so you cannot tell whose it is or hand one over.

**Consequences for scope, stated plainly:**

1. **The read fix is a filter change, not a migration.** Deleting/conditioning one filter line
   makes the lists agree.
2. **The write feature is a migration**, for two reasons that are not optional:
   - **There is no way to render or pick a member.** `tasks.member_id` → `public.members` and
     `public.members` carries no `account_id`; the household roster lives in
     `public.account_members`, and the two tables are joined only on `user_id` with **no foreign
     key between them**, so PostgREST cannot embed one in the other. Every existing surface that
     needs a name for a membership solves this with a `security_invoker` view joining
     `account_members → members on user_id` (`interactions_summary`, `03_views.sql:262-264`;
     `entity_files_summary`, `:294-296`). This story adds the third.
   - **`member_id` is currently client-writable to any value.**
     `grant select, insert, update, delete on table public.tasks to authenticated`
     (`06_grants.sql:629-630`) is table-level, so it covers every column, and the RLS policy
     constrains only `account_id`. `set_member_id_default()` is an **if-null default**, not an
     overwrite (contrast `set_interaction_actor_member_id()`, `02_functions.sql:417-425`, which
     unconditionally overwrites). A client can therefore PATCH `member_id` to an arbitrary
     `bigint`, including a `members.id` belonging to another household. That is not a read leak
     — `tasks` stays account-scoped, and the foreign member cannot see the row — but it is an
     attribution-integrity hole, and the moment "assigned to me" becomes a filter it becomes a
     way to make a task **invisible to every member of the household**. The trigger in Task 3
     closes it.

## The re-add trap does **not** bite here — and the one migration that would create it is forbidden

Note authorship resolves by `user_id` through a join because `account_members.id` is **re-minted**
when a persona is archived and added back (`03_views.sql:221-224`; `can_moderate_note()`'s
"Why authorship joins on user_id", `02_functions.sql:613-617`).

`tasks.member_id` points at `public.members(id)`, and `public.members` has
`create unique index uq__members__user_id on public.members using btree (user_id)`
(`01_tables.sql:25`) — **one row per auth user, for the lifetime of the account, never re-minted
by an archive/re-add round-trip.** So the trap is already avoided, by accident of history rather
than by design.

**Therefore: do NOT "align" `tasks.member_id` onto `account_members.id`** to match
`singles.member_id` / `shidduchim.owner_member_id` / `interactions.actor_member_id`. The schema
comment at `01_tables.sql:53-58` names that collision as Epic 2's to resolve and Epic 2 did not,
which reads as an invitation. It is the opposite: aligning the column would *introduce* the exact
bug the notes view was written to avoid, and would strand every existing assignment on the first
persona archive/re-add. This story keeps the column, keeps the referent, and rewrites the comment
to say so. AC-7 asserts the round-trip.

## Acceptance Criteria

1. **Given** a household with two active `parent_admin` members A and B, and a task assigned to B,
   **when** A opens `/tasks`, **then** the task is listed, and its row carries B's name.
   The default scope of `/tasks` is **Everyone**, not "Mine" — the fail-closed direction here is
   *showing too much*, not too little, and a "Mine" default reproduces the defect for anyone who
   has never touched the toggle.
   **Failing looks like:** `TasksListByDueDate.tsx` still passes `member_id` unconditionally
   (`:32`), so A's list is unchanged and B's task is absent; **or**
   `tasks/useTaskAssigneeScope.ts`'s default is `"mine"`, which the unit test in Task 6 pins
   explicitly. Do not satisfy this AC by deleting the filter outright — AC-2 needs it back,
   conditionally.
2. **Given** `/tasks`, **when** I use the scope control, **then** I can switch between
   **Everyone** and **Assigned to me**, "Assigned to me" narrows the list to
   `member_id = <my members.id>`, the choice persists across a reload, and the same control with
   the same semantics is present on `/reminders`. The persistence mechanism is ra-core's
   `useStore` under a single key — `useEntityListViewMode` (`misc/useEntityListViewMode.ts:20-27`)
   is the in-repo precedent and its comment records that `root/crmStore.ts` already persists every
   `useStore` key into the app's one `"CRM"` localStorage namespace. Do **not** add a second
   persistence mechanism, a URL param, or a per-surface key.
   **Failing looks like:** the toggle resets to the default after a page reload; or `/reminders`
   still has no control and keeps showing everyone unconditionally
   (`useReminders.ts:127-132`); or two different store keys make `/tasks` and `/reminders`
   disagree about what "Mine" means.
3. **Given** the task edit form and the reminder create sheet, **when** I set an assignee,
   **then** the choices are exactly the **active** members of my **current context**, each shown
   with their name and role, "you" marked on my own row, plus an explicit **Unassigned** option;
   and the value written to `tasks.member_id` is that member's `public.members.id`.
   The choices come from the new `public.context_members` view (Task 2) — **not** from a
   `useGetList("members")`, which is a global table with no `account_id` and would offer every
   member of every household the caller can see.
   **Failing looks like:** the picker lists a name that is not in this household; or the picker
   is empty for a household that has two active members; or `grep -n "getList(\"members\"\|useGetList(\"members\"" src/components/atomic-crm/tasks/ src/components/atomic-crm/reminders/`
   returns a hit.
4. **Given** the new `public.context_members` view, **when** a login that holds memberships in
   household A and shadchanus B is **active in A**, **then** the view returns only A's active
   members and **zero** rows for B, and
   `select reloptions from pg_class where relname = 'context_members';` shows
   `security_invoker=on`. Both halves are asserted. The cross-context negative is **one login,
   two contexts, active in one** — never two disjoint users
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 3].
   Note the view **must** carry its own `and am.account_id = public.current_context_id()`
   predicate: `account_members`' SELECT policy is
   `user_id = auth.uid() or account_id = public.current_context_id()` (`05_policies.sql:145-150`),
   and that first disjunct alone would publish the caller's memberships in **every** context they
   hold into a picker scoped to one.
   **Failing looks like:** the B-context assertion returns ≥1 row (the view relies on RLS alone);
   or the `reloptions` assertion returns null/empty, meaning the view runs as its owner, RLS never
   applies, and every household's roster is readable by every caller — silently, because the
   picker still looks correct to its own tenant.
5. **Given** `validate_task_assignee` (Task 3), **when** a caller active in household A inserts or
   updates a task with `member_id` set to a `members.id` that is not an **active** member of that
   task's `account_id`, **then** the statement raises with `errcode = 'check_violation'` and no
   row is written or changed. Asserted in the `db` project via `psql`, not through PostgREST —
   a 0-row UPDATE returns `404`/`PGRST116`, which is indistinguishable from a policy error
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 4].
   **Failing looks like:** the insert succeeds and `select member_id from public.tasks where id = …`
   shows the foreign id; or the trigger was created but sorts before `set_tasks_account_id`, so it
   reads `new.account_id is null` and passes everything (see Dev Notes → "Trigger name ordering is
   load-bearing").
6. **Given** the same trigger, **when** a task whose assignee is no longer an active member is
   **completed or snoozed**, **then** the update succeeds. The trigger is
   `before insert or update of member_id, account_id` — **never a bare `update`** — so a
   `done_date`/`due_date` write never re-validates a historical assignment.
   **Failing looks like:** the trigger is declared `before insert or update on public.tasks`;
   ticking the checkbox on a task assigned to an archived member then returns a
   `check_violation` and the row can never be closed. This is the fail-closed footgun in this
   story; it is why the column list on the trigger is part of the AC and not an implementation
   detail.
7. **Given** a member is archived (`account_members.status = 'archived'`, the one lifecycle
   transition `remove_persona()` writes — `01_tables.sql:156-163`) and later re-added,
   **then**: while archived, their tasks **remain listed** under Everyone, remain completable
   (AC-6), and their row renders the "no longer in this household" assignee state with a
   **Reassign** affordance — never a blank chip and never a crash; and after re-adding, the same
   tasks resolve back to the **same person's name with no data change**, because
   `public.members.id` is stable per `user_id` (`uq__members__user_id`, `01_tables.sql:25`) while
   `account_members.id` is re-minted.
   **Failing looks like:** the task disappears from the list while its assignee is archived (the
   list was built with an inner join to `context_members` instead of a client-side lookup with a
   fallback); or the chip renders `undefined`/empty; or re-adding the member leaves the task
   showing the unresolved state, which is the signature of somebody having migrated `member_id`
   onto `account_members.id` after all.
8. **Given** a caller active in a **shadchanus** context, **when** they create a task, **then**
   assignment works there too — the picker lists that account's active `shadchan` memberships and
   the trigger validates against them. Tasks are **not** household-only: Story 3.14 dropped
   `validate_tasks_household_scope` on the owner's ruling
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#11 — Ruling 1], and
   `enforce_household_scope()` is attached to 11 tables with neither `tasks` nor `interactions`
   among them (`04_triggers.sql:186-201`).
   **Failing looks like:** `context_members` or the trigger function contains a
   `kind = 'household'` test; or the picker is empty in a shadchanus context; or
   `supabase/tests/household_scope_lift.sql`'s "AC 4(d)" catalog check
   (`enforce_household_scope` attached to exactly 11 tables) goes red because a new
   `validate_*` trigger was pointed at the wrong function.
9. **Given** the migration, **when** it lands, **then** every pre-existing `tasks` row whose
   `member_id` is non-null and does **not** resolve to an active member of that row's
   `account_id` has been set to `null` **in the same migration, before the trigger is created**,
   and the number of rows changed is recorded in the Dev Agent Record. A fail-closed constraint
   that ships without its backfill is how this project once served an entirely empty production
   (`member_state`, AFTER INSERT trigger, no backfill, HTTP 200 and zero rows on every surface).
   **Failing looks like:** the generated migration contains
   `create or replace trigger validate_task_assignee` with no preceding `update public.tasks …
   set member_id = null …`; or the pre-migration count
   (`select count(*) from public.tasks where member_id is not null and not exists (…)`) is not
   recorded, so nobody can tell whether the backfill nulled 0 rows or 400.
10. **Given** every surface that renders a task row, **when** the household has more than one
    active member, **then** the assignee is visible on the row: `/tasks` (`tasks/Task.tsx`),
    `/reminders` (`reminders/ReminderCard.tsx`), the universal Tasks tab
    (`entity360/tabs/TasksTab.tsx`) and the read-only rail summary
    (`entity360/tabs/TasksRailSummary.tsx`). The rail chip is **display only** — adding it must
    not trip `entity360/tabs/TasksRailSummary.guard.test.ts`, which scans the raw source for
    `useCreate`/`useUpdate`/`useDelete`/`useMutation` and for `Input`/`Textarea`/`Checkbox`/`Button`
    imports (Ruling 2, contract §11).
    **Failing looks like:** `npx vitest run src/components/atomic-crm/entity360` reports the
    rail guard failing on a newly imported `Button`; or a row shows a due date and text but no
    indication of who owns it in a two-member household.
11. **Given** `TasksTab`'s create path, **when** an assignee is chosen, **then** `member_id` is
    included in the create payload, and when it is not chosen the payload omits it and the
    server default applies. `entity360/tabs/TasksTab.test.tsx:98-121` currently pins
    `expect(params.data).toEqual({ target_type, target_id, text, due_date })` under the title
    *"sends only target_type, target_id, text and due_date — never member_id, account_id or
    delivery_channels"*, and `TasksTab.tsx:88-92` says the same in a comment. Both are **meant**
    to go red; retarget them to two cases (omitted vs. explicitly assigned) rather than deleting
    the assertion. See Dev Notes → "This story supersedes 3-8 AC 3(c), in part".
    **Failing looks like:** the test file was deleted or the assertion loosened to
    `expect.objectContaining`, which would stop catching a stray `account_id` or
    `delivery_channels` in the payload — the thing that assertion actually exists for.
12. **Given** the FakeRest provider (AD-10 lockstep), **when** the demo runs, **then**
    `context_members` resolves and the seeded household has **at least two** active members, so
    the assignee picker, the chips and the Everyone/Mine toggle are all demonstrable in
    `make start-demo`. Today `dataGenerator/shidduchim.ts:265-274` seeds exactly **one**
    `account_members` row (Jane Doe, `user_id: "0"`) and every seeded task carries
    `member_id: 0` (`dataGenerator/references.ts:338-347`), so a demo of this feature would show
    a one-name picker and a toggle that changes nothing.
    **Failing looks like:** `make start-demo` → `/tasks` → the scope toggle produces an identical
    list in both positions; or the picker renders one option; or the console logs an unknown
    resource for `context_members`.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the diagnosis before writing code** (AC: 1)
  - [ ] Re-read the five rows of the diagnosis table above against the tree. Specifically confirm
        `TasksListByDueDate.tsx:32` is still the **only** `member_id` filter in a task query:
        `grep -rn "member_id" src/components/atomic-crm/tasks/ src/components/atomic-crm/reminders/ src/components/atomic-crm/dashboard/ src/components/atomic-crm/entity360/tabs/`
        (today: that line, plus `TasksListFilter.test.tsx:15`'s fixture). This is a `grep` and not
        an `LSP` call on purpose — `member_id` is a database identifier that lives in string
        literals and SQL, not a TypeScript symbol
        [Source: .claude/rules/lsp-usage.md, "When `grep`/`rg` IS the right tool"].
  - [ ] If a filter has appeared elsewhere since, it is in scope; add it to the ownership
        manifest rather than leaving it disagreeing with the rest.
- [ ] **Task 2 — `public.context_members` view** (AC: 3, 4, 8)
  - [ ] Append to `supabase/schemas/03_views.sql`, after `entity_files_summary`:

        ```sql
        -- Story 12.3: the assignee picker's roster — the ACTIVE members of the
        -- caller's ACTIVE context, whatever that context's kind (Ruling 1: a
        -- shadchanus context holds tasks too). `id` is public.members.id,
        -- because that is what tasks.member_id holds (01_tables.sql:53-58) and
        -- because it is the identity key that survives a persona archive/re-add
        -- round-trip — account_members.id is re-minted and is deliberately NOT
        -- exposed here. Same user_id-keyed join interactions_summary
        -- (03_views.sql:262-264) and entity_files_summary use.
        --
        -- The explicit account_id predicate is NOT redundant with RLS.
        -- account_members' SELECT policy is
        -- `user_id = auth.uid() or account_id = public.current_context_id()`
        -- (05_policies.sql:145-150); its first disjunct would leak the caller's
        -- memberships in every OTHER context they hold into a picker scoped to
        -- one. security_invoker keeps both base tables' RLS applying on top.
        create or replace view public.context_members with (security_invoker = on) as
        select
            m.id,
            am.account_id,
            am.user_id,
            am.role,
            nullif(btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '') as full_name,
            (am.user_id = auth.uid()) as is_self
        from public.account_members am
            join public.members m on m.user_id = am.user_id
        where am.status = 'active'
          and am.account_id = public.current_context_id();
        ```

  - [ ] **Name it `context_members`, not `*_summary`.** The FakeRest adapter strips a `_summary`
        suffix before the resource name reaches the provider
        (`providers/fakerest/internal/supabaseAdapter.ts:5-7`), which would collapse
        `context_members_summary` onto the in-memory `account_members` table and silently return
        raw membership rows with no name. `shadchan_stats` is the in-repo precedent for a view
        deliberately outside the `_summary` convention (`providers/fakerest/dataProvider.ts:618-626`
        records exactly this reasoning).
  - [ ] Grants — `06_grants.sql`, mirroring the `shadchan_stats` block at `:483-485` verbatim in
        shape:
        `revoke all on table public.context_members from anon, authenticated;`
        `grant select on table public.context_members to authenticated;`
        `grant all on table public.context_members to service_role;`
  - [ ] `types.ts`: add a `ContextMember` type (`id: Identifier; account_id: Identifier;
        user_id: string; role: MemberRole; full_name: string | null; is_self: boolean`) next to
        `MyContext` (`types.ts:193`). `role` reuses the existing `MemberRole` union — do not
        declare a second one.
- [ ] **Task 3 — `validate_task_assignee` trigger + backfill** (AC: 5, 6, 8, 9)
  - [ ] `supabase/schemas/02_functions.sql`, in exact `pg_dump` form (AGENTS.md; contract §8
        rule 6 — anything else produces a phantom diff):

        ```sql
        CREATE OR REPLACE FUNCTION "public"."validate_task_assignee"() RETURNS "trigger"
            LANGUAGE "plpgsql"
            SET "search_path" TO ''
            AS $$
        begin
          if new.member_id is null then
            return new;
          end if;

          if not exists (
            select 1
            from public.account_members am
              join public.members m on m.user_id = am.user_id
            where m.id = new.member_id
              and am.account_id = new.account_id
              and am.status = 'active'
          ) then
            raise exception 'member % is not an active member of account %',
              new.member_id, new.account_id
              using errcode = 'check_violation';
          end if;

          return new;
        end;
        $$;
        ```

        **NOT `SECURITY DEFINER`**, and that is deliberate — the same split
        `set_interaction_actor_member_id()` documents (`02_functions.sql:409-416`). Under invoker
        rights the two base tables' RLS applies, which makes the check *stricter*, never looser:
        a foreign `members` row is invisible, `not exists` holds, and the statement raises. A
        `service_role` writer bypasses RLS and still gets the correct answer, because the
        predicate is written on real ids, not on `auth.uid()`.
  - [ ] `supabase/schemas/04_triggers.sql`, immediately after `sync_task_target_trigger`
        (`:139-141`):

        ```sql
        -- Story 12.3: an assignee must be an ACTIVE member of the task's own
        -- account. `update of member_id, account_id` — never a bare `update`:
        -- completing or snoozing a task whose assignee has since been archived
        -- must keep working (AC-6). Named `validate_...` so it sorts AFTER every
        -- `set_...`/`sync_...` trigger on this table ('v' > 's'), which is what
        -- guarantees set_tasks_account_id has already filled new.account_id by
        -- the time this reads it — read the naming rationale at :186-201 before
        -- renaming it.
        create or replace trigger validate_task_assignee
            before insert or update of member_id, account_id on public.tasks
            for each row execute function public.validate_task_assignee();
        ```

  - [ ] Rewrite the `comment on column public.tasks.member_id` (`01_tables.sql:53-58`): it is the
        **assignee**, it points at `public.members(id)` **on purpose**, and it is deliberately
        **not** `account_members.id` because that id is re-minted on archive/re-add. Delete the
        "resolving the collision is Epic 2 (AD-19), not this story" sentence — Epic 2 shipped and
        this story rules that the column stays as it is.
  - [ ] Index: `create index tasks_account_member_idx on public.tasks using btree (account_id,
        member_id);` beside the two existing task indexes (`01_tables.sql:814-815`). "Assigned to
        me" is `account_id` (RLS) + `member_id` (filter); `tasks_account_id_idx` alone leaves the
        member predicate to a filter step.
  - [ ] **Hand-add the backfill to the generated migration, positioned BEFORE the
        `create or replace trigger` statement** (`db diff` never emits data steps):

        ```sql
        -- Story 12.3 AC-9: normalise unresolvable assignments before the guard
        -- exists, so no legacy row is left in a state the new trigger would
        -- reject on its next member_id write.
        update public.tasks t
        set member_id = null
        where t.member_id is not null
          and not exists (
            select 1
            from public.account_members am
              join public.members m on m.user_id = am.user_id
            where m.id = t.member_id
              and am.account_id = t.account_id
              and am.status = 'active'
          );
        ```

  - [ ] Before running the migration, capture the count and paste it into the Dev Agent Record:
        `select count(*) from public.tasks t where t.member_id is not null and not exists (…same
        predicate…);` — run it against the **local** stack, and again as a read-only check against
        production before the deploy round. A non-trivial count is a finding to report, not a
        number to bury.
- [ ] **Task 4 — Read surfaces: scope toggle and assignee chips** (AC: 1, 2, 7, 10)
  - [ ] New `tasks/useTaskAssigneeScope.ts`: `useStore<"everyone" | "mine">("tasks.assigneeScope",
        "everyone")`, one key shared by `/tasks` and `/reminders`. Model it on
        `misc/useEntityListViewMode.ts:20-27` (thin `useStore` wrapper, `useState`-shaped return).
        **Default `"everyone"`** — pinned by a unit test, per AC-1.
  - [ ] New `tasks/TaskScopeToggle.tsx`: a controlled two-button segmented control taking
        `{ scope, onChange }` and reading nothing from the store itself, exactly like
        `misc/EntityListViewToggle.tsx:20-30` (`role="group"` + `aria-label` + `aria-pressed`,
        so it unit-tests with only a translate context).
  - [ ] New `tasks/useTaskAssignees.ts`: one `useGetList<ContextMember>("context_members", {
        pagination: { page: 1, perPage: 50 }, sort: { field: "id", order: "ASC" } })`, returning a
        `Map<Identifier, ContextMember>` plus `isMultiMember` (`> 1` row). Every row-level chip
        reads this one hook's cache — do **not** fetch per row.
  - [ ] New `tasks/TaskAssigneeChip.tsx`: given `member_id`, renders "You", or the member's
        `full_name` + role, or the **unresolved** state when the id is non-null and absent from the
        map (AC-7 — archived member; never a blank, never a crash), or nothing at all when
        `member_id` is null **and** the household has one member (AC-10 keeps the chip out of the
        way of single-parent households).
  - [ ] `tasks/TasksListByDueDate.tsx:27-35`: make the filter conditional —
        `filter: scope === "mine" ? { member_id: identity?.id } : {}`. Keep the
        `{ enabled: !!identity }` guard only for the `"mine"` branch; under `"everyone"` the list
        must not wait on identity. Mount `TaskScopeToggle` above the groups.
  - [ ] `reminders/useReminders.ts:127-132` + `reminders/RemindersPage.tsx`: same toggle, same
        store key, applied to the existing `{ "done_date@is": null }` filter.
  - [ ] `tasks/Task.tsx` and `reminders/ReminderCard.tsx`: render `TaskAssigneeChip` on the row.
  - [ ] `entity360/tabs/TasksTab.tsx` and `entity360/tabs/TasksRailSummary.tsx`: same chip.
        **The rail is display-only** — `TasksRailSummary.guard.test.ts` scans the raw source and
        fails on a `Button`/`Input`/`Checkbox`/`Textarea` import as well as on the four mutation
        hooks, so the chip component must not pull one in transitively at the rail's import site.
        Run `npx vitest run src/components/atomic-crm/entity360` after this edit, not at the end.
- [ ] **Task 5 — Write surfaces: the assignee picker** (AC: 3, 11)
  - [ ] New `tasks/TaskAssigneeSelect.tsx`: options = **Unassigned** + one per `context_members`
        row, label `full_name` (+ "(you)" when `is_self`) with the role beside it, value =
        `ContextMember.id` (i.e. `public.members.id`).
  - [ ] `tasks/TaskFormContent.tsx`: add it to the existing two-column grid beside
        `type`/`due_date`. This is the `/tasks` row → Edit path (`tasks/TaskEdit.tsx`,
        `tasks/TaskEditSheet.tsx`), so reassignment works from the list without a new surface.
  - [ ] `reminders/ReminderCreateSheet.tsx`: add it to the sheet, defaulting to **me** (the
        `is_self` row) — a reminder you create for yourself must stay a one-tap flow.
  - [ ] `entity360/tabs/TasksTab.tsx:98-116`: add the assignee to the inline add form and include
        `member_id` in the create payload **only when one is chosen**; the comment at `:88-92`
        ("member_id, account_id and delivery_channels are all server-set … sending any of them
        from the client would be a failing assertion") is now false for `member_id` and must be
        rewritten in the same edit. `account_id` and `delivery_channels` stay server-set.
  - [ ] Both i18n catalogues, in lockstep. English at
        `providers/commons/englishCrmMessages.ts` (the `resources.tasks` block is `:72-102`);
        French at `providers/commons/frenchCrmMessages.ts` (`:74-104`). New keys under
        `crm.tasks.assignee.*`: `label`, `unassigned`, `you`, `everyone`, `mine`, `scope_group`,
        `former_member`, `reassign`. Framework-layer strings go through `translate()` with an
        `_:` English fallback [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 —
        rule 6]. A key added to one catalogue and not the other ships an English string into the
        French UI.
- [ ] **Task 6 — FakeRest lockstep (AD-10)** (AC: 12)
  - [ ] `providers/fakerest/dataProvider.ts`: add a `resource === "context_members"` branch to
        `getList` (and `getMany`, which `useGetList`'s cache warm-up can hit), emulating the view
        by joining the in-memory `account_members` rows for the demo account to `db.members` on
        `user_id`, filtering `status === "active"`. Model it on the `shadchan_stats` branch
        (`:618-626`) — a non-`_summary` resource name that arrives intact.
  - [ ] `providers/fakerest/dataGenerator/shidduchim.ts:265-274`: seed a **second** active
        `account_members` row so the demo has two parents. `generateMembers`
        (`dataGenerator/members.ts:6-46`) already produces six members (`id: 0` Jane Doe plus five
        random); bind one of them as a second `parent_admin` on `ACCOUNT_ID`. Give them a stable
        name rather than a `faker` one if the screenshots need to be reproducible.
  - [ ] `providers/fakerest/dataGenerator/references.ts:338-347`: spread the seeded tasks across
        both members instead of `member_id: 0` for all of them, so the Everyone/Mine toggle
        visibly changes the list in the demo.
  - [ ] Confirm `providers/fakerest/internal/accountDomainData.ts:20-32` still needs no change —
        `"tasks"` is already in `DOMAIN_RESOURCES`, and `context_members` is a view, not a domain
        table, so it must **not** be added there.
- [ ] **Task 7 — Tests** (AC: all)
  - [ ] **Database suite — new pair** `supabase/tests/task_assignment.sql` +
        `supabase/tests/task_assignment.test.ts`. SQL suites in this repo are **paired without
        exception** (14 pairs today); a `.sql` with no runner never executes. Copy the shape of
        `supabase/tests/household_scope_lift.sql` verbatim: `\set ON_ERROR_STOP on`, a
        `results(name, passed, detail)` temp table, every check wrapped in
        `begin … exception when others`, a JSON report on the last line, and a rollback. Its
        runner (`household_scope_lift.test.ts`) is the template for the `.test.ts` half, including
        `bailIfDbUnreachable`. Checks required:
        - AC-4: one login `U`, `parent_admin` of household `A` and `shadchan` of shadchanus `B`
          (that role pairing is mandatory — `enforce_membership_role_matches_context()` rejects
          any other). Active in `A`: `context_members` returns A's members and **zero** rows for
          `B`. Then `set_active_context(B)`: the mirror.
        - AC-4: `select reloptions from pg_class where relname = 'context_members'` contains
          `security_invoker=on`.
        - AC-5 (**the negative that must go red if the policy or trigger is loosened**): active in
          `A`, insert a task with `member_id` = a `members.id` whose only active membership is in
          `B` → raises `check_violation`, and `select count(*)` afterwards is unchanged. Repeat as
          an `update`.
        - AC-6: assign a task to a member, archive that membership, then
          `update public.tasks set done_date = now()` → **succeeds**.
        - AC-7: archive then re-add the membership; the task's `member_id` is unchanged and
          `context_members` resolves the same `id` to the same name, while the row's
          `account_members.id` differs before and after. Assert the `account_members.id` difference
          explicitly — that assertion is what makes the round-trip check meaningful rather than a
          tautology.
        - AC-8: active in shadchanus `B`, insert a task assigned to B's own `shadchan` member →
          succeeds; and the `enforce_household_scope`-attached-to-11-tables catalog fact still
          holds (the same query `household_scope_lift.sql` uses).
        - AC-9: with a deliberately unresolvable `member_id` planted before the backfill statement
          is replayed, the backfill nulls exactly that row and leaves valid ones alone.
  - [ ] **Component tests** run in **real Chromium via `vitest-browser-react`** with
        `StoryWrapper` / ra-core's `TestMemoryRouter` — see `references/ReferenceCreate.test.tsx`
        and `dashboard/StatStrip.test.tsx` for the shape. **React Testing Library is not a
        dependency of this repo**; `import { render } from "@testing-library/react"` does not
        resolve. Cover: the default scope is `"everyone"` (AC-1, a direct assertion on
        `useTaskAssigneeScope`, not inferred from a rendered list); the toggle switches the filter
        passed to `getList`; the chip's four states (you / other member / unresolved / hidden in a
        one-member household); the picker's options come from `context_members` and include
        Unassigned.
  - [ ] **Retarget, do not delete**, `entity360/tabs/TasksTab.test.tsx:98-121` into two cases:
        no assignee chosen → payload is exactly `{ target_type, target_id, text, due_date }`
        (unchanged); assignee chosen → exactly those four **plus** `member_id`. Keep `toEqual`;
        `expect.objectContaining` would stop catching the stray `account_id` /
        `delivery_channels` the case exists to catch. Update the case title, which currently says
        "never member_id".
  - [ ] **Regression guard** — new `tasks/taskScope.guard.test.ts`: read
        `tasks/TasksListByDueDate.tsx` via `?raw` (the `import.meta.glob({ query: "?raw", eager:
        true })` idiom `entity360/tabs/TasksRailSummary.guard.test.ts:20-25` uses; a bare
        `import x from "./y?raw"` needs a `*?raw` module declaration to typecheck under `strict`)
        and assert the source contains no **unconditional** `member_id:` in the `filter` object.
        **Show it red first** against a deliberately broken copy and paste the `npx vitest run`
        output into the Dev Agent Record — a guard that cannot fail is not coverage
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 2].
  - [ ] **E2E** — new `e2e/tasks-assignment.spec.ts`, plus whatever `e2e/fixtures.ts` needs to
        sign in as a second household member. Two flows: assign a task to the other parent and
        see it under Everyone but not under Mine; sign in as that parent and see it under Mine.
        Deterministic waits only — `waitForResponse` / `expect(locator).toBeVisible()`, never
        `waitForTimeout` [Source: .claude/rules/testing.md]. **Declare this file and run the e2e
        suite at least once in this wave**: nothing in the unit suite covers the two-login path,
        and this project has already lost one e2e handoff (`e2e/navigation.spec.ts`) that existed
        only inside a report.
  - [ ] `npm run typecheck && npm run lint && npx vitest run && npm run test:unit:db`, plus the
        e2e run above.

## Dev Notes

### This story supersedes 3-8 AC 3(c), in part

`3-8-universal-tasks-tab.md` AC 3(c) states that `TasksTab` sends exactly four fields and that
"member_id, account_id and delivery_channels are all server-set … sending any of them from the
client would be a failing assertion". That was correct when there was no assignee control. It is
now correct for **two of the three**: `account_id` and `delivery_channels` stay server-set and
client-unsendable; `member_id` becomes a client-sendable field with a server-side **default**
(`set_member_id_default()`, unchanged) and a server-side **validator** (`validate_task_assignee`,
new). The live assertion at `TasksTab.test.tsx:98-121` and the comment at `TasksTab.tsx:88-92` are
edited by this story (AC-11).

**The story text of `3-8` itself is not edited here** — this story owns only its own file, exactly
as `3-8` did when it flagged `5-7`'s AC 3 as wrong and left the amendment to that file's owner
(`3-8:429-431`). Whoever next touches `3-8` should fold this in.

### Trigger name ordering is load-bearing

Postgres fires same-event `BEFORE` triggers in **alphabetical trigger-name order**, and this
schema's `set_*` / `sync_*` / `validate_*` naming exists precisely to exploit that
(`04_triggers.sql:193-201`: "Renaming any of these is a migration-time total insert outage, not a
refactor"). On `public.tasks` the resulting order is:

1. `set_task_member_id_trigger` — defaults `member_id` from `auth.uid()` when null (`:6-9`)
2. `set_tasks_account_id` — defaults `account_id` from `current_context_id()` (`:134-137`)
3. `sync_task_target_trigger` — guards the polymorphic target (`:139-141`)
4. `validate_task_assignee` — **new**; reads `new.member_id` **and** `new.account_id`, both of
   which are guaranteed populated by then

Name it anything sorting before `set_tasks_account_id` and it reads `new.account_id is null` on
every SPA insert (the SPA never sends `account_id`), the `not exists` is trivially true, and the
guard **passes everything while looking installed**. That failure is silent in every test that
only inserts happy-path rows — which is why AC-5's negative is a `db`-project assertion and not a
component test.

### Why the picker needs a view at all

`public.members` has no `account_id` (`01_tables.sql:14-25`) — it is the global auth-profile
table. The household roster is `public.account_members`, which has no name columns. There is **no
foreign key between them** (`account_members.user_id` and `members.user_id` both reference
`auth.users`), so PostgREST cannot embed one in the other and a client-side two-query join would
have to leak the caller's `current_context_id()` into the client to filter correctly. Every
existing surface with this exact problem solved it with a `security_invoker` view joining on
`user_id`: `interactions_summary` (`03_views.sql:262-264`) and `entity_files_summary`
(`:294-296`). `context_members` is the third instance of one pattern, not a new one.

### `db diff` blind spots — hand-add both of these

1. **`security_invoker` is never emitted.** `supabase db diff` drops
   `with (security_invoker = on)` when it writes a view, and `create or replace view` does not
   carry existing reloptions forward. The precedent is written down in-tree:
   `supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37` is a hand-added
   `-- MANUAL ADJUSTMENTS` block whose note 1 reads *"It drops `WITH (security_invoker = on)` when
   it writes a view. Without it these views execute as their owner and RLS never runs."* Append
   `alter view "public"."context_members" set (security_invoker = on);` to the generated
   migration. AC-4's `pg_class.reloptions` assertion is the guard.
2. **View privileges are not diffed** (note 2 of that same block). The three `06_grants.sql` lines
   from Task 2 must be hand-added to the migration too, or every authenticated read of the picker
   403s while `03_views.sql` and `06_grants.sql` both look correct.
3. `db diff` also does not diff storage-bucket rows — not triggered by this story, listed so the
   blind-spot list is not read as exhaustive at two entries.

### Migration workflow

Declarative schema in `supabase/schemas/` is the source of truth; migrations are generated
(AGENTS.md, *Database Management*). **Prefix every `npx supabase` invocation with
`DBUS_SESSION_BUS_ADDRESS=/dev/null`** — without it the CLI hangs on the keyring and it looks like
a Docker fault.

This story edits `01_tables.sql` (column comment + index), `02_functions.sql` (one new function),
`03_views.sql` (one new view), `04_triggers.sql` (one new trigger) and `06_grants.sql` (three
lines), and produces **one** migration:

```
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f task_assignment
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local
```

Hand-checks on the generated file, in order:

1. The **AC-9 backfill** is present and sits **before** `create or replace trigger
   validate_task_assignee`. `db diff` never emits data steps.
2. `alter view "public"."context_members" set (security_invoker = on);` and the three grants are
   appended under a `-- MANUAL ADJUSTMENTS` comment.
3. The diff touches **nothing but** `context_members`, `validate_task_assignee`, the new trigger,
   the new index and the column comment. `02_functions.sql` must be in exact `pg_dump` form or the
   diff will drag unrelated functions in — if it does, re-dump per AGENTS.md
   (`npx supabase db dump --local --schema public`) before continuing.
4. No `*_target_type_check` line and no `enforce_household_scope` line. Either means a schema file
   was edited from a stale assumption — revert it.

Never `db reset` / `db push` from inside the story. Deploy-time migration application is the
harness's separate round.

### Security review is mandatory for this story

It touches RLS-adjacent schema (a `security_invoker` view over two RLS'd tables), a migration, a
new trigger that gates a write, and grants — four of the triggers listed in
`.claude/rules/security-triggers.md`. Dispatch SECURITY-REVIEWER; do not treat the small diff size
as a reason to skip it.

### Rulings this story makes (do not re-litigate inside the story)

1. **Grouping stays by due date, not by person.** The mockup grouped tasks under
   `You — Chani` / `Yaakov — husband (helper)` / `Rivky — child`. The shipped IA groups by
   due-date bucket on `/tasks` (`TasksListByDueDate.tsx:87-114`) and by overdue/upcoming on
   `/reminders` (`useReminders.ts:165-166`), and both are the right primary axis for a hub whose
   job is "what is late". The scope toggle plus a per-row assignee chip delivers the mockup's
   *purpose* — see whose it is, hand it over — without a third grouping. **Flagged for the epic
   owner**, not silently absorbed: if per-person grouping is wanted as well, it is a follow-up
   story on top of this one, not a change to these ACs.
2. **`member_id` is the assignee; the creator is not tracked.** Today the column is a creator
   stamp used as a de-facto owner. After this story, reassignment overwrites it and the original
   creator is not recorded anywhere. Adding a `created_by_member_id` column, or writing an
   `interactions` row on reassignment, would each be real work — the latter needs a new
   `interactions.kind` value, a widened check constraint, an `ActivityTab` label and a FakeRest
   mirror. **Out of scope, YAGNI**, and recorded here so its absence reads as a decision.
3. **The column is not renamed.** `member_id` → `assignee_member_id` would be a
   `DROP COLUMN`/`ADD COLUMN` in a generated diff unless hand-rewritten to
   `ALTER TABLE … RENAME COLUMN` (AGENTS.md warns about exactly this), and would touch every
   surface plus the FakeRest generators for zero behavioural gain. The `comment on column` carries
   the meaning instead.
4. **The scope control is shared, one store key, defaulting to Everyone.** Different defaults per
   surface would preserve today's contradiction under a nicer UI.

### Dependencies

**Blocking (all built and deployed at `a8c5e3d`):**

- **Epic 2** — `current_context_id()` (`02_functions.sql:184-201`), the `account_members`
  status/role model (`01_tables.sql:140-164`), and the archive-not-delete lifecycle (`:156-163`).
  `context_members` and the trigger are both written directly on these.
- **Story 3.14 / Ruling 1** — `tasks` is no longer household-only, which is the only reason AC-8
  is satisfiable [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#11].
- **Story 3.8 / Ruling 2** — `TasksTab` is the canonical mutate surface and `TasksRailSummary`
  stays read-only; AC-10 and AC-11 are written to that split.
- **Story 4.1/4.2** — only as the `useStore` precedent for AC-2 (`misc/useEntityListViewMode.ts`).
  Deployed locally; **not yet in production** at the time of writing.

**Not a dependency:** Epic 5. Nothing here reads `entity360/ad24Conformance.ts`,
`entity360/registry.ts`, `entityDescriptor.ts` or any route shape.

**Scheduling constraint (this is the part the wave planner needs):** although logically
independent of Epic 5, this story is **not schedulable in the same wave as any Epic 5 story**. It
writes `src/components/atomic-crm/types.ts`, `registry.json`, both
`providers/commons/*CrmMessages.ts`, `supabase/schemas/**`, `supabase/migrations/**` and
`entity360/tabs/{TasksTab,TasksRailSummary}.tsx` — every one of which 5-8/5-9/5-10 also write. The
loser of a concurrent edit fails the build on an innocent story.

### Ownership manifest — the exact file set

Declared deliberately wide; every previously declared set in this project has been too small.

**Schema / database**
- `supabase/schemas/01_tables.sql` — `tasks.member_id` comment (`:53-58`), new
  `tasks_account_member_idx` beside `:814-815`
- `supabase/schemas/02_functions.sql` — new `validate_task_assignee()`
- `supabase/schemas/03_views.sql` — new `context_members` view
- `supabase/schemas/04_triggers.sql` — new `validate_task_assignee` trigger
- `supabase/schemas/06_grants.sql` — three `context_members` lines
- `supabase/migrations/<ts>_task_assignment.sql` — **new**, with hand-added backfill,
  `security_invoker` and grants
- `supabase/tests/task_assignment.sql` — **new**
- `supabase/tests/task_assignment.test.ts` — **new** (the paired runner; never ship the `.sql`
  alone)

**Source**
- `src/components/atomic-crm/tasks/TasksListByDueDate.tsx` — the defect line
- `src/components/atomic-crm/tasks/Task.tsx` — assignee chip
- `src/components/atomic-crm/tasks/TaskFormContent.tsx` — assignee select
- `src/components/atomic-crm/tasks/useTaskAssigneeScope.ts` — **new**
- `src/components/atomic-crm/tasks/TaskScopeToggle.tsx` — **new**
- `src/components/atomic-crm/tasks/useTaskAssignees.ts` — **new**
- `src/components/atomic-crm/tasks/TaskAssigneeChip.tsx` — **new**
- `src/components/atomic-crm/tasks/TaskAssigneeSelect.tsx` — **new**
- `src/components/atomic-crm/reminders/ReminderCard.tsx` — assignee chip
- `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx` — assignee select
- `src/components/atomic-crm/reminders/useReminders.ts` — scope filter
- `src/components/atomic-crm/reminders/RemindersPage.tsx` — mount the toggle
- `src/components/atomic-crm/entity360/tabs/TasksTab.tsx` — chip, select, payload, stale comment
- `src/components/atomic-crm/entity360/tabs/TasksRailSummary.tsx` — chip (display only)
- `src/components/atomic-crm/types.ts` — `ContextMember`

**Categories that keep getting missed — all in scope**
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (`resources.tasks` block
  `:72-102`) **and** `frenchCrmMessages.ts` (`:74-104`) — in lockstep
- `registry.json` — five new non-test source files under
  `src/components/atomic-crm/**/*.ts*` mutate it; `scripts/generate-registry.mjs` globs them and
  `.husky/pre-commit` regenerates it. Declare it; do not hand-edit it
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — `context_members` branch
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts:265-274` — second
  active member
- `src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts:338-347` — spread
  task assignment across members
- `e2e/tasks-assignment.spec.ts` — **new**
- `e2e/fixtures.ts` — second-member sign-in fixture
- `src/components/atomic-crm/entity360/tabs/TasksTab.test.tsx:98-121` — retargeted (AC-11)
- `src/components/atomic-crm/tasks/TasksListFilter.test.tsx:15` — its fixture carries
  `member_id: null`; re-read before assuming it is unaffected
- `src/components/atomic-crm/tasks/taskScope.guard.test.ts` — **new** (`?raw`, shown red first)
- New component tests beside each new component

**Explicitly NOT touched**
- `_bmad-output/planning-artifacts/epics.md` and every other story file — a sibling agent places
  these stories
- `src/components/atomic-crm/entity360/{ad24Conformance.ts, registry.ts, entityDescriptor.ts,
  registry.stubs.test.ts}` and `src/components/atomic-crm/root/routeManifest.ts` — no route or
  descriptor shape changes; `routeManifest.ts:140-141`'s `tasks` exemption text ("Read/complete-only
  list … task creation lives in reminders/") stays **true** after this story, because assignment
  is an edit, not a create, and `/tasks` still has no create control
- `supabase/schemas/05_policies.sql` — the RLS policy is already correct and widening it is not
  the fix; if a diff touches this file, the diagnosis was misread

### Project Structure Notes

Every new component lands in the existing `src/components/atomic-crm/tasks/` folder alongside the
surfaces that consume it — including the ones mounted from `reminders/` and `entity360/tabs/`,
because the chip, the select and the scope hook are task concepts, not surface concepts, and
duplicating them per surface is how a third task implementation gets written (contract §11 Ruling
2 point 5 already forbids a third add/toggle implementation). Keep every file under the ~400-line
typical ceiling; grow the file count, not the file
[Source: .claude/rules/coding-style.md].

## References

- [Source: _bmad-output/implementation-artifacts/3-8-universal-tasks-tab.md:425-428] — the
  "Flagged for the epic owner" entry that disowns this gap: *"Two parents in one household see
  disjoint Tasks lists, and there is no assignee control anywhere in Epics 3-9. Needs an owner."*
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#11] — Ruling 1 (`tasks` and
  `interactions` leave household-only scope; the shadchanus context holds tasks) and Ruling 2
  (`TasksTab` is the only component that mutates tasks from a 360; `TasksRailSummary` is read-only)
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13] — rule 2 (a `?raw` guard is
  shown red first), rule 3 (cross-tenant negatives are one login in two contexts), rule 4 ("zero
  rows affected" is not observable through PostgREST — assert in the `db` project), rule 6
  (i18n with `_:` fallbacks)
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#8] — rule 6, `02_functions.sql`
  must be in exact `pg_dump` form or `db diff` produces a phantom diff
- [Source: src/components/atomic-crm/tasks/TasksListByDueDate.tsx:27-35] — `filter: { member_id:
  identity?.id }`, the whole defect
- [Source: src/components/atomic-crm/reminders/useReminders.ts:127-132] — the same table read
  with no `member_id` term: the contradictory half
- [Source: src/components/atomic-crm/entity360/tabs/TasksTab.tsx:80-84,88-92,98-116] — the
  record-scoped query, the now-false "member_id is server-set" comment, and the create payload
- [Source: src/components/atomic-crm/entity360/tabs/TasksTab.test.tsx:98-121] — the `toEqual`
  assertion this story retargets
- [Source: src/components/atomic-crm/entity360/tabs/TasksRailSummary.guard.test.ts:20-37] — the
  `?raw` idiom and the forbidden-import list the rail chip must not trip
- [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:11-23] — `getIdentity()`
  returns `public.members.id`, which is why the existing filter compares against that column
- [Source: src/components/atomic-crm/misc/useEntityListViewMode.ts:20-27] — the `useStore`
  persistence precedent for the scope toggle
- [Source: src/components/atomic-crm/misc/EntityListViewToggle.tsx:20-30] — the controlled
  segmented-control precedent (`role="group"`, `aria-pressed`, no store access)
- [Source: src/components/atomic-crm/providers/fakerest/internal/supabaseAdapter.ts:5-7] — the
  `_summary` suffix strip, and why the new view must not be named `*_summary`
- [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:618-626] — the
  `shadchan_stats` branch: the precedent for emulating a non-`_summary` view
- [Source: src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts:265-274] —
  the single seeded `account_members` row
- [Source: src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts:338-347] —
  seeded tasks, all `member_id: 0`
- [Source: supabase/schemas/01_tables.sql:14-25] — `public.members` (no `account_id`) and
  `uq__members__user_id`, the index that makes `members.id` survive an archive/re-add round-trip
- [Source: supabase/schemas/01_tables.sql:31-58] — the `tasks` table and the `member_id` comment
  this story rewrites
- [Source: supabase/schemas/01_tables.sql:140-164] — `account_members`, its role check and its
  `active`/`archived` status check
- [Source: supabase/schemas/01_tables.sql:814-815] — the two existing `tasks` indexes the new
  composite index joins
- [Source: supabase/schemas/02_functions.sql:168-178] — `set_member_id_default()`: an **if-null**
  default, not an overwrite
- [Source: supabase/schemas/02_functions.sql:396-407] — `set_account_id_default()`
- [Source: supabase/schemas/02_functions.sql:409-425] — `set_interaction_actor_member_id()`: the
  unconditional-overwrite counterexample, and the "NOT SECURITY DEFINER" rationale this story's
  trigger function reuses
- [Source: supabase/schemas/02_functions.sql:613-617] — "never on `account_members.id` (see Dev
  Notes 'Why authorship joins on user_id')"
- [Source: supabase/schemas/03_views.sql:213-264] — `interactions_summary`: the
  `security_invoker` + `account_members → members on user_id` pattern `context_members` copies,
  and the written rationale for why the join key is `user_id`
- [Source: supabase/schemas/04_triggers.sql:6-9,134-141] — the three existing `BEFORE INSERT`
  triggers on `tasks`
- [Source: supabase/schemas/04_triggers.sql:186-201] — alphabetical trigger-name ordering; the
  `validate_*` naming convention and the "renaming is a total insert outage" warning
- [Source: supabase/schemas/05_policies.sql:14-29] — the `members` SELECT policy (a foreign
  member's profile is visible only inside a shared **active** context)
- [Source: supabase/schemas/05_policies.sql:31-38] — the `tasks` policy: account-scoped, no
  `member_id` term. Unchanged by this story
- [Source: supabase/schemas/05_policies.sql:120-150] — the `account_members` SELECT policy and
  the review-finding comment above it; the `user_id = auth.uid()` disjunct is why
  `context_members` carries its own `account_id` predicate
- [Source: supabase/schemas/06_grants.sql:483-485] — the `shadchan_stats` grant block
  `context_members` mirrors
- [Source: supabase/schemas/06_grants.sql:629-630] — the table-level `tasks` grant that makes
  `member_id` client-writable today
- [Source: supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37] — the
  `MANUAL ADJUSTMENTS` precedent: `db diff` drops `security_invoker` and does not diff view
  privileges
- [Source: supabase/tests/household_scope_lift.sql:1-50] — the suite shape (temp `results`
  table, wrapped checks, JSON report, rollback) and the one-login-two-contexts fixture
  `task_assignment.sql` copies
- [Source: supabase/tests/household_scope_lift.test.ts] — the paired-runner template
- [Source: .claude/rules/security-triggers.md] — RLS / migrations / database queries: dispatch
  SECURITY-REVIEWER
- [Source: .claude/rules/testing.md] — 80% coverage, AAA, no `waitForTimeout`
- [Source: .claude/rules/coding-style.md] — many small files; grow the file count, not the file
- [Source: AGENTS.md] — declarative schema is the source of truth; `db diff` workflow;
  `02_functions.sql` must match `pg_dump` output exactly

## Dev Agent Record

### Agent Model Used

Claude (Sonnet), via the BMad dev-story workflow.

### Debug Log References

**AC-9 pre-migration backfill count** — run against the local stack (`STACK_ID=1`,
`postgresql://postgres:postgres@127.0.0.1:54352/postgres`) both before generating the migration
and again after applying it, using the exact predicate from Task 3:

```sql
select count(*) from public.tasks t
where t.member_id is not null
  and not exists (
    select 1
    from public.account_members am
      join public.members m on m.user_id = am.user_id
    where m.id = t.member_id
      and am.account_id = t.account_id
      and am.status = 'active'
  );
```

Result: **0 rows** matched the predicate on the local stack (2026-08-06) — no legacy task had an
unresolvable assignee, so the backfill in `supabase/migrations/20260806201222_task_assignment.sql`
nulled 0 rows. This 0-row result is also recorded as a comment directly above the `update` in the
migration file, per Task 3's instruction. A non-zero count would have been reported here rather
than buried; there was none to report.

**Guard test shown red first (`tasks/taskScope.guard.test.ts`, contract §13 rule 2)** — ran
`npx vitest run --project app src/components/atomic-crm/tasks/taskScope.guard.test.ts` against a
deliberately reverted copy of `TasksListByDueDate.tsx` (the `filter` line reverted from
`scope === "mine" ? { member_id: identity?.id } : {}` back to the pre-story unconditional
`{ member_id: identity?.id }`), then restored the fix. Captured output:

```
 RUN  v4.1.10 /home/daniel/repos/myshadchan

 ❯ |app (chromium)| src/components/atomic-crm/tasks/taskScope.guard.test.ts (3 tests | 1 failed) 153ms
     × does not contain an unconditional member_id filter 151ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |app (chromium)| src/components/atomic-crm/tasks/taskScope.guard.test.ts > TasksListByDueDate never sends member_id unconditionally (AC-1) > does not contain an unconditional member_id filter
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/components/atomic-crm/tasks/taskScope.guard.test.ts:51:56
     49|
     50|   it("does not contain an unconditional member_id filter", () => {
     51|     expect(UNCONDITIONAL_MEMBER_ID_FILTER.test(SOURCE)).toBe(false);
       |                                                        ^
     52|   });
     53| });

 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

After restoring the real fix, the same command reports `Test Files 1 passed (1)` /
`Tests 3 passed (3)`, confirming the guard is non-vacuous in both directions.

### Completion Notes List

- AC-9's backfill matched 0 rows on the local stack; nothing to report beyond the count above.
- The trigger-name-ordering hazard (Dev Notes → "Trigger name ordering is load-bearing") was
  respected: `validate_task_assignee` sorts after `set_task_member_id_trigger` and
  `set_tasks_account_id` alphabetically, so `new.account_id` is populated before the guard reads it.
- `db diff`'s two blind spots (`security_invoker`, view grants) were hand-added to the generated
  migration per the Dev Notes checklist and confirmed present in
  `supabase/migrations/20260806201222_task_assignment.sql`.

### File List

**Schema / database**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/03_views.sql`
- `supabase/schemas/04_triggers.sql`
- `supabase/schemas/06_grants.sql`
- `supabase/migrations/20260806201222_task_assignment.sql` (new)
- `supabase/tests/task_assignment.sql` (new)
- `supabase/tests/task_assignment.test.ts` (new)

**Source**
- `src/components/atomic-crm/tasks/TasksListByDueDate.tsx`
- `src/components/atomic-crm/tasks/TasksListByDueDate.test.tsx` (new)
- `src/components/atomic-crm/tasks/Task.tsx`
- `src/components/atomic-crm/tasks/Task.test.tsx` (new)
- `src/components/atomic-crm/tasks/TaskFormContent.tsx`
- `src/components/atomic-crm/tasks/useTaskAssigneeScope.ts` (new)
- `src/components/atomic-crm/tasks/useTaskAssigneeScope.test.ts` (new)
- `src/components/atomic-crm/tasks/TaskScopeToggle.tsx` (new)
- `src/components/atomic-crm/tasks/TaskScopeToggle.test.tsx` (new)
- `src/components/atomic-crm/tasks/useTaskAssignees.ts` (new)
- `src/components/atomic-crm/tasks/useTaskAssignees.test.tsx` (new)
- `src/components/atomic-crm/tasks/TaskAssigneeChip.tsx` (new)
- `src/components/atomic-crm/tasks/TaskAssigneeChip.test.tsx` (new)
- `src/components/atomic-crm/tasks/TaskAssigneeSelect.tsx` (new)
- `src/components/atomic-crm/tasks/TaskAssigneeSelect.test.tsx` (new)
- `src/components/atomic-crm/tasks/assigneeLabel.ts` (new)
- `src/components/atomic-crm/tasks/taskScope.guard.test.ts` (new)
- `src/components/atomic-crm/reminders/ReminderCard.tsx`
- `src/components/atomic-crm/reminders/ReminderCard.test.tsx`
- `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx`
- `src/components/atomic-crm/reminders/ReminderCreateSheet.test.tsx` (new)
- `src/components/atomic-crm/reminders/useReminders.ts`
- `src/components/atomic-crm/reminders/useReminders.test.tsx` (new)
- `src/components/atomic-crm/reminders/RemindersPage.tsx`
- `src/components/atomic-crm/entity360/tabs/TasksTab.tsx`
- `src/components/atomic-crm/entity360/tabs/TasksTab.test.tsx`
- `src/components/atomic-crm/entity360/tabs/TasksRailSummary.tsx`
- `src/components/atomic-crm/entity360/tabs/TasksRailSummary.test.tsx`
- `src/components/atomic-crm/types.ts`

**Categories that keep getting missed**
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts`
- `e2e/tasks-assignment.spec.ts` (new)
- `e2e/fixtures.ts`

**Known collateral, out of this story's ownership manifest — reported by the dev agent, then
fixed by the epic owner in this same commit**
- `supabase/tests/invites.sql` — the new `validate_task_assignee` trigger correctly rejects a
  stale-JWT-claims fixture bug at `invites.sql:851` (`reset role;` does not also reset
  `request.jwt.claims`, unlike the documented-correct pattern at `:592-597`), which failed
  `npm run test:unit:db`'s `invites.test.ts` suite. The file is not in this story's declared
  ownership manifest, so the dev agent correctly reported it rather than taking it, per
  "out-of-scope work is reported, not taken".
- **It was then fixed by the epic owner and is part of commit `f1a6b4c`**, because `make test` is
  a required gate and this story's own trigger is what made it red. The fix is the one line the
  agent identified — `set local request.jwt.claims = '{}';` after the `reset role;` — with a
  comment explaining why.
- An audit of the other 24 `reset role;` sites in that file found 22 carry the same latent hazard
  and only 2 clear the claims. They are harmless today because no `tasks` insert follows them.
  Rewriting a fixture this story does not own, for a hypothetical, was judged the wrong trade;
  recorded here so the next reader meets it as a decision.
- Two independent reviewers and the gate agent each proved this failure was **not** pre-existing,
  per `.claude/rules/gate-verification.md`: dropping the trigger mid-transaction made every check
  in `invites.sql` pass, and `git archive` of base `895d435` showed the trigger absent there with
  both files byte-identical.
