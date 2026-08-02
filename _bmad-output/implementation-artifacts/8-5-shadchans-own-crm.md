# Story 8.5: The shadchan's own CRM

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want to see my connections and my conversations on the same shell everyone else uses,
so that I can do my work here instead of falling back to a notebook.

## Position in Epic 8

**5th (last) of 5.** Depends on **8.1** (the shadchanus nav/dashboard shell, the
`RequireContextKind` guard and the manifest `contextKind` field), **8.2** (the connection
workflow), and **8.3** (the redt-compose dialog and the connection-scoped thread it mirrors).
This story wires all three into a real descriptor-based CRM and **replaces both of Story
8.1's placeholders** — the dashboard body and the `/connections` placeholder route.

## Acceptance Criteria

1. **A Connections list, built from the standard framework, not a bespoke screen.** A new
   `connections` resource declares a descriptor (label, icon, route, avatar, title, meta,
   relationships — AD-24) and renders through the same `EntityList` every other entity uses:
   search, the List/Cards toggle, URL-held state, empty/loading/error. No hand-rolled list
   component.
2. **A Connection 360, on the same shell as everything else.** Opening a connection renders
   `Entity360` with the fixed region order (breadcrumb → identity header → stat band → alert
   slot → tab bar → content → optional right rail). The identity header shows the connected
   household's account name and connection status (accepted / ended, with the end date if
   ended); the stat band shows at minimum the count of redts sent through this connection —
   **derived from the connection-scoped threads Story 8.3 mirrors, never from the household's
   `redts` or `inbox_items`** (structurally unreachable to the shadchan, AD-20/Story 8.4).
3. **Threads are a tab, not a destination.** The Connection 360's tab set is
   `overview, discussions, notes, tasks, activity` — the canonical Connection tab set and
   order (contract §3 rule 5; `CANONICAL_TAB_SETS.connections` in Task 9). It intentionally
   mirrors `shadchanim`'s shape (`overview, shidduchim, notes, tasks, activity` —
   `entity360/ad24Conformance.ts`) rather than `singles`'/`shidduchim`'s: no `resume`/`photo`,
   no `files` (no story wires a connection Files tab; `entity_files` still gains `'connection'`
   as a legal `target_type` for TS/DB-union parity, Task 9 — that a value is legal and that a
   tab exists are two different questions, exactly as `entity_files_target_type_check` already
   allows `'shadchan'` though `shadchanim` has no Files tab). The tab **key** is `discussions`,
   label "Discussions", taken from the closed `TabKey` union in `entity360/tabKeys.ts`;
   `conversations` is a **different, non-interchangeable** key reserved for the reference
   **call log** (5.10), and using it here does not express what this tab is (contract §3,
   drift-closing ruling table: one key `discussions` for every Epic 7
   `threads/ThreadPanel.tsx` surface). The `discussions` tab lists the connection's threads
   (Task 3); `notes`/`tasks`/`activity` are the standard `NotesTab`/`TasksTab`/`ActivityTab`
   from `entity360/tabs/`, each given `{ targetType: "connection", targetId: connection.id }`
   (`UniversalTabProps`, contract §8) — no bespoke component, exactly the reuse Ruling 2
   requires and the reason Story 3.14/R1 lifted `tasks`/`interactions` out of
   `enforce_household_scope()` in the first place (contract §11 Ruling 1: "while Epic 8.5 ...
   is built entirely on them"). Reusing `threads/ThreadPanel.tsx` for `discussions` is the
   only place a shadchan reaches a thread from, consistent with UX-DR8's "reached from its
   parent, not primary navigation."
4. **"Send a redt" is reachable without leaving the page.** The Connection 360 (right rail or an
   action in the tab bar, per AD-24's optional-right-rail region) launches Story 8.3's
   `RedtComposeDialog`, pre-bound to this connection's id.
5. **Ending a connection is available from its own 360**, calling Story 8.2's `endConnection()`;
   after ending, the 360 still renders (history is not hidden — see Story 8.2 Dev Notes on what
   ending does and does not do) but "Send a redt" is disabled with a reason.
6. **Every mention of a connection anywhere is a `RecordLink`.** Dashboard summaries, if any,
   and any future cross-reference to a connection use the shared `RecordLink` primitive (Epic 3
   Story 3.9) — no ad-hoc `<Link>`.
7. **The shadchanus dashboard is now real.** Story 8.1's placeholder is replaced with a stat
   band (accepted-connection count, unread-conversation count per Task 6's definition) and a
   short list of the most recently active connections, each a `RecordLink`. It still renders
   correctly with **zero** connections (empty state, not an error) — this must not regress
   Story 8.1's empty-state behaviour.
8. **No household record is ever rendered here, and the surfaces are sealed both ways.** The
   Connections list and every Connection 360 tab query only connection-scoped rows and the
   caller's own account-scoped rows — never a household table directly (Story 8.4's suite is
   the DB proof; this story does not re-write it). The reverse holds too: a route test proves
   a household-active session is redirected off `/connections` (the epic's "my records never
   leak into a household context", at the UI layer — the DB layer is Epic 2's isolation suite).
9. **A shadchan can hold a task and a private note about a specific connection.** `'connection'`
   joins `ENTITY_TARGET_TYPES` (contract §8 rule 4, "'connection' is Epic 8's value to add
   [8.2/8.5]") and the three DB check constraints it backs (`tasks_target_type_check`,
   `interactions_target_type_check`, `entity_files_target_type_check`). A task or an
   interaction with `target_type = 'connection'` is writable and readable only by an active
   member of one of that connection's two accounts (own-account scoping, same as every other
   target type — Task 9), and is invisible to the other side of the connection (a shadchan's
   note about household A is never in household A's own account, and vice versa — the same
   AD-20 guarantee Story 8.4 proves for threads, now extended to this axis). Without this AC,
   R1 (contract §11 Ruling 1) has no consumer anywhere in Epic 8 and 8.1's "the shadchan's
   book is mine" premise has nothing to hold a private note in.

## Tasks / Subtasks

- [ ] **Task 1 — Locate and reuse, don't rebuild** (informs all ACs)
  - [ ] Read Epic 3's `Entity360` shell and descriptor contract (Story 3.1/3.3) and Epic 4's
        `EntityList` (Story 4.1) before writing a single component — this story must produce
        **zero** bespoke layout code per AD-24. Use `LSP workspaceSymbol` / `documentSymbol` on
        an existing descriptor-based resource (e.g. whatever Epic 5 shipped for `shadchanim` or
        `references`) as the template to copy the *shape* of, not the content.
  - [ ] Read `threads/ThreadList.tsx` and `threads/ThreadPanel.tsx` (Epic 7 Story 7.1, privacy
        toggle from 7.3) before building Task 3 — reuse their rendering. `ThreadList`'s
        `useGetList("threads", { filter: { subject_type, subject_id } })` is **not** enough on
        its own: 8.3's `redt_via_connection()` creates connection-scoped threads with
        `subject_type = 'relationship'`, `subject_id = null` (the `threads_subject_id_check`
        pairing), and a shadchan with two connections would have TWO such threads with the
        identical `(subject_type, subject_id)` pair, differing only in `connection_id` — a
        `subject_id`-only filter cannot tell them apart and would mix connection 1's threads
        into connection 2's tab. `ThreadListProps` needs widening (Task 3).

- [ ] **Task 2 — `connections` resource and descriptor** (AC: 1, 2, 6)
  - [ ] In the existing `src/components/atomic-crm/connections/` folder (Story 8.1 created it):
        `index.ts` (descriptor + resource registration, following the shape of an existing
        Epic-5 entity folder), `ConnectionList` (thin — descriptor-driven, per AD-24 "no entity
        contains bespoke layout code"), `ConnectionShow` (renders `Entity360` with this story's
        tabs).
  - [ ] Register in `root/routeManifest.ts` with `contextKind: "shadchanus"` — the field
        Story 8.1 Task 3 added and `CRM.tsx` already wraps in `RequireContextKind`. Do **not**
        touch the manifest's `surface` field for this: `surface` means desktop/mobile/both
        (1.5), never context kind. Remove 8.1's `/connections` placeholder custom-route entry
        and `ConnectionsPlaceholder.tsx` in the same change (NFR-14: the replaced thing is
        deleted, not left beside its replacement). This closes the mirror direction 8.1 left
        open: a household-active session cannot reach `/connections`.
  - [ ] `RecordLink` (Epic 3 Story 3.9) target for a connection → `/connections/{id}`.

- [ ] **Task 3 — `discussions` tab** (AC: 3)
  - [ ] Add the `connections` row — `overview, discussions, notes, tasks, activity` — to
        `CANONICAL_TAB_SETS` in `entity360/ad24Conformance.ts` **in this same diff**.
        Registering a `connections` descriptor against a table that has no row for it is
        itself a `tab-set-incomplete` violation [Source:
        _bmad-output/implementation-artifacts/3-11-ad24-conformance-validator.md — AC 6,
        "a descriptor whose `name` has no row … is not silently skipped"]. All five tabs ship
        in this story (`notes`/`tasks`/`activity` via Task 8's `ENTITY_TARGET_TYPES` widening),
        so the descriptor needs no `pendingTabs`.
  - [ ] Add the `discussions` tab (key `discussions`, no `label` override — the label resolves
        through `useTabLabel` to "Discussions") to the `connections` descriptor's tab list.
        `threads/ThreadList.tsx` (`ThreadListProps`) needs a small widening, done here (it has
        no other consumer to break): add an optional `connectionId?: Identifier`, mutually
        exclusive with `subjectType`/`subjectId` (mirroring `threads`' own XOR shape) — when
        supplied, the `useGetList("threads", ...)` filter becomes `{ connection_id:
        connectionId }` instead of `{ subject_type, subject_id }` (`threads.connection_id` has
        a full, uncolumn-restricted `select` grant to `authenticated`, `06_grants.sql`, so this
        is a plain PostgREST filter — no new RPC). Everything downstream of the fetched `data`
        (the unread computation, `ThreadPanel` selection) is already keyed off the returned
        thread ids and needs no change. Pass `connectionId={connection.id}` from the
        `discussions` tab; do not add a second thread-list component. No `*_summary` view
        exists for threads today — query the base `threads` resource directly, as
        `ThreadList` already does.

- [ ] **Task 4 — Send-a-redt action** (AC: 4)
  - [ ] Wire Story 8.3's `connections/RedtComposeDialog.tsx` as an action in the Connection
        360's right rail — launch it, do not duplicate it.
  - [ ] Disable the action with an explanatory tooltip/message when `connection.status ===
        'ended'` (AC-5).

- [ ] **Task 5 — End-connection action** (AC: 5)
  - [ ] A confirm-and-call action wired to `dataProvider.endConnection()` (Story 8.2), refreshing
        the 360 on success so the identity header immediately shows `ended`.

- [ ] **Task 6 — Shadchanus dashboard, for real** (AC: 7)
  - [ ] Replace Story 8.1's `dashboard/ShadchanDashboard.tsx` placeholder body (keep the file and
        its route wiring — do not create a second dashboard component) with: a stat band —
        count of `status = 'accepted'` connections, and count of **unread** conversations using
        Story 7.5's unread definition (a thread with a message newer than the caller's
        `thread_participants.last_read_at`; 7.5 lands before this story, so the signal exists —
        do not invent a second recency heuristic) — and a short list of the most recently
        active connections (latest message first) as `RecordLink`s.
  - [ ] Zero-connections state renders the same empty-state copy Story 8.1 shipped, not a new one
        — reuse the i18n key.

- [ ] **Task 7 — FakeRest parity** (AC: all)
  - [ ] Extend the FakeRest data generator with a handful of demo connections + threads so the
        shadchanus context has something to look at in demo mode (`make start-demo`), per AD-10's
        "keep FakeRest in sync" and the general expectation that every persona's context is
        demoable.

- [ ] **Task 8 — `'connection'` joins `ENTITY_TARGET_TYPES`** (AC: 9; contract §8 rule 4)
  - [ ] `types.ts`: add `"connection"` to `ENTITY_TARGET_TYPES` (currently `["shidduch",
        "single", "shadchan", "reference"]`). `TaskTargetType` widens with it (it is a type
        alias, no separate edit).
  - [ ] `01_tables.sql`: add `'connection'` to `tasks_target_type_check`,
        `interactions_target_type_check` and `entity_files_target_type_check` — contract §8
        rule 1 requires the three stay at parity; the migration touches all three in one diff,
        never just the one(s) a given UI surface happens to use.
  - [ ] `05_policies.sql`: `tasks` and `entity_files` need **no** policy change — both are
        plain `account_id = current_context_id()` scoping with no per-target-type existence
        check today, so the new value is already covered. `interactions`' SELECT/INSERT
        policies ("Interactions readable/insertable within account and parent visibility") DO
        have a per-target-type `exists(...)` branch for `shadchan`/`single` — add the matching
        `connection` branch: `target_type = 'connection' and exists (select 1 from
        public.connections c where c.id = interactions.target_id and
        (c.household_account_id = public.current_context_id() or c.shadchanus_account_id =
        public.current_context_id()))` — no `status = 'accepted'` filter (Story 8.2 Dev Notes:
        ending a connection is not retroactive, and annotating an ended connection's history is
        legitimate). Also add `'connection'` to `interactions_scope_link_check`'s
        `scope = 'account'` arm, alongside `'shadchan'`/`'single'` — a connection has no
        shidduch parent, same reasoning as those two.
  - [ ] `reminders/reminderEntity.ts`: add `connection` to `LINKABLE_TARGET_TYPES`,
        `RESOURCE_FOR_TARGET` (`connection: "connections"`), `TARGET_TYPE_LABEL` and
        `TARGET_TYPE_LABEL_PLURAL` — all four are `Record<TaskTargetType, string>` and fail
        `tsc` without an entry apiece.
  - [ ] `reminders/useReminders.ts`: `ALL_TARGET_TYPES` gains `"connection"`; per the file's own
        comment, "a fourth [here: fifth] target type needs a fourth hook call, not just a
        fourth map entry" — add the fifth `useGetMany(RESOURCE_FOR_TARGET.connection, { ids:
        connectionIds }, { enabled: connectionIds.length > 0 })` alongside the existing four.
  - [ ] No purge trigger is wired for `'connection'` on `purge_polymorphic_dependents()`
        (contract §8 rule 3 would otherwise require one): that function runs `AFTER DELETE` on
        the parent row, and `public.connections` rows are never hard-deleted — `end_connection()`
        (Story 8.2) only flips `status`/`ended_at`, keeping the row as history. There is no
        DELETE event to hook into. State this explicitly in the migration comment, matching how
        8.3's Task 1 pre-empts an AD-1 reviewer flag for `inbox_items.connection_id`.
  - [ ] New `supabase/tests/shadchan_connection_notes.sql` + `.test.ts` (same `results`/`ids`
        temp-table convention as `references_entity.sql`): (a) shadchan S1 can create and read
        a task/interaction with `target_type = 'connection'`, `target_id` = connection 1;
        (b) shadchan S2 (party to a different connection into the same household) reads 0 rows
        for connection 1's tasks/interactions; (c) a member of household A cannot read S1's
        connection-1-targeted interaction (it is account-scoped to S1's shadchanus account, not
        A's — the same AD-20 guarantee Story 8.4 proves for threads); (d) inserting a
        `target_type = 'connection'` interaction whose `target_id` is a connection the caller
        is not a party to is rejected by the new `exists(...)` branch, no row created.

- [ ] **Task 9 — Tests** (AC: 1, 2, 3, 7, 8, 9)
  - [ ] Descriptor/list/show tests following whatever pattern Epic 3/5's descriptor-based
        entities established (component tests: empty/loading/error, light+dark, 375px per
        UX-DR11 — reuse the existing visual-regression harness, do not add a new one).
  - [ ] `dashboard/ShadchanDashboard.test.tsx` (extending Story 8.1's file): zero-connections
        empty state still passes; a populated-state render shows the stat band and `RecordLink`s.
  - [ ] Route-guard negative test (AC-8): with a mocked `household` active context,
        `/connections` redirects and `ConnectionList` never renders — the mirror of Story 8.1's
        guard test, now against the real resource.
  - [ ] Task 8's SQL suite (`supabase/tests/shadchan_connection_notes.sql` + `.test.ts`) closes
        AC-9's falsifiability — see Task 8's four cases.
  - [ ] All new copy through the `i18nProvider` (AD-18), keys in both
        `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` (Story 8.1 Dev
        Notes: the shipped second catalogue is French, not the Hebrew AD-18 names).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (Task 8 needs
        `make start`), plus scoped `prettier --check`.

## Dev Notes

### What this story does not re-litigate

The privacy boundary (which data a shadchan may query) is **Story 8.4's** and is proven at the
database. This story only has to avoid **querying** anything outside that boundary from the
frontend — it must not add a second, UI-side privacy check that duplicates RLS (the app never
enforces visibility alone, per the architecture's constraint list) or, worse, papers over an RLS
gap with a client-side filter. If a query here ever needs to hide something the database already
returns, that is a Story 8.4 defect to report, not a filter to add in `ConnectionShow`.

### Architecture citations

- **AD-24**: the full shell contract this story must produce zero exceptions to — fixed region
  order, descriptor-only, `EntityList`/`RecordLink` reuse, tabs declaring who may see them.
  The mechanism is `EntityTabDescriptor.visibleTo?: MemberRole[]` — an explicit allow-list,
  absent meaning visible to every role (contract §2 rule 7; the spine's "minimum visibility"
  phrasing predates that ruling and there is no `minVisibility` field). Not applicable here
  beyond "shadchanus context only", already handled by the route guard, not
  a per-tab visibility rule: **all five `connections` tabs omit `visibleTo`** — there is no
  `single`-role membership on a shadchanus account (Story 2.2's role/kind trigger) for a
  per-role restriction to ever matter here.
- **UX-DR8/UX-DR10**: threads are a tab, not a nav destination — same reasoning Story 8.1 applied
  to the nav set, now applied to the record level.
- **AD-20**: "Suggestions redted through a connection still belong to the household" — reinforces
  why the Connection 360 shows thread activity and a redt count, never the suggestion's pipeline
  state (which the shadchan structurally cannot read, per Story 8.4).

### Dependencies

- **Epic 3** (`Entity360` shell, descriptor registry — Stories 3.1, 3.3) and **Epic 4**
  (`EntityList` — Story 4.1) are hard prerequisites for Task 2. Epic 8's own FR coverage row in
  epics.md ("FR108–113, AD-4, AD-7") does not mention UX-DR1/UX-DR7/AD-24 at all, yet this story
  cannot be built without them — flagged to the epic owner in the story-writing report.
- **Epic 7** (thread list/detail component) for Task 3.
- **Story 8.1** (nav/dashboard shell, `RequireContextKind`), **Story 8.2** (`connections`
  resource + `endConnection`), **Story 8.3** (`RedtComposeDialog`, redt count data).
- **Epic 3 Stories 3.5/3.8** (`interactions`/`tasks_target_type_check` widening) — the
  precedent Task 8 repeats for `'connection'`, and **contract §8 rule 4**, the binding
  assignment of that value to Epic 8 (this story) that Task 8 discharges.

### Testing standard

Frontend component tests per `.claude/rules/testing.md` (AAA); reuse Epic 3/5's established
descriptor-entity test pattern rather than inventing a new one for this resource. Task 8's
`ENTITY_TARGET_TYPES` widening is a schema/RLS change (touches `interactions`' policies) —
per `.claude/rules/security-triggers.md` it gets its own SQL negative-test suite, not a
frontend test standing in for one.

### Project Structure Notes

The `connections/` folder exists since Story 8.1 (placeholder) and holds Story 8.3's
`RedtComposeDialog.tsx`. New in it: `index.ts` (descriptor), `ConnectionList.tsx`,
`ConnectionShow.tsx`, plus co-located tests. Deleted: `ConnectionsPlaceholder.tsx` (+ test).
Modified: `dashboard/ShadchanDashboard.tsx` (from Story 8.1), `root/routeManifest.ts`,
FakeRest data generator, `entity360/ad24Conformance.ts` (`CANONICAL_TAB_SETS.connections`),
`types.ts` (`ENTITY_TARGET_TYPES`), `01_tables.sql` (three check constraints), `05_policies.sql`
(`interactions`' two policies gain a `connection` branch — no other table's policy changes,
Task 8), `reminders/reminderEntity.ts`, `reminders/useReminders.ts`, `threads/ThreadList.tsx`
(the `connectionId` widening), `providers/commons/englishCrmMessages.ts` /
`frenchCrmMessages.ts`. Every `RecordLink` call site that links to a connection uses the
existing `entity360/RecordLink.tsx` unchanged — no edit to that file itself. New:
`supabase/tests/shadchan_connection_notes.sql` + `.test.ts` (Task 8), plus a migration
generated by `db diff` for the target-type widening (no grants change: `tasks`/
`interactions`/`entity_files` already grant `authenticated` the same DML regardless of
`target_type` value — only the CHECK constraints and the one RLS policy gate it).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
