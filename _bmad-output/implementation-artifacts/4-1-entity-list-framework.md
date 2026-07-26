# Story 4.1: `EntityList` framework

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every list to behave the same,
so that search and filtering are never a surprise.

## Position in Epic 4

**1st of 5.** Every other story in this epic sits on top of it:

- **4.2** (List/Cards toggle) extends the render contract this story defines — do not
  build the view-mode toggle here (see Dev Notes "What 4.1 deliberately does not build").
- **4.3** (Shidduchim list view) reuses `EntityListView` and `useEntityListStatus` directly,
  nested under its own `<List>`, and copies this story's search-wiring pattern for a fourth
  resource.
- **4.5** (Global search) fans out over the per-resource search hooks this story adds.

**Depends on Epic 1** having landed: `children` → `singles` (Story 1.3: resource `singles`,
route `/singles`, type `Single`, component `SingleList`/`SingleCard`) and the fossil
resources deleted (Story 1.1). This story is written entirely in post-Epic-1 vocabulary —
every path below is the renamed one.

**Depends on Epic 3**: Story 3.3's `EntityDescriptor` registry
(`entity360/entityDescriptor.ts`) and Story 3.9's minimal registrations (`name` +
`buildRecordPath`) for the four live entities. `EntityList` resolves each entity's display
label through that registry (AC-1, Task 3) — 3.3's doc comment atop `entityDescriptor.ts`
names this story as the consumer and forbids redefining the type.

## Acceptance Criteria

1. **One component owns list chrome.** `src/components/atomic-crm/misc/EntityList.tsx` (a
   `<List>` wrapper) and its context-only inner view
   `src/components/atomic-crm/misc/EntityListView.tsx` are the only place search box, filter
   toggle, sort control, pagination, and loading/empty/error rendering are implemented for a
   roster-style entity list. No entity list built or touched by this story contains its own
   skeleton, its own empty-state branch, or its own error handling. The list heading resolves
   from the entity's `EntityDescriptor` (`label`, added to each retrofitted entity's existing
   3.9 registration — AD-24: "an entity contributes a descriptor"), never from a per-list
   `title` prop.

2. **Three existing lists render through it**, keeping their own per-item visual as an
   injected renderer, not rebuilt: `src/components/atomic-crm/singles/SingleList.tsx`,
   `src/components/atomic-crm/shadchanim/ShadchanList.tsx`,
   `src/components/atomic-crm/references/ReferenceList.tsx`.

3. **Search works on all three, against the real backend, not just the demo.** Typing in the
   search box filters `singles`, `shadchanim` and `references` server-side against Supabase
   (via `applyFullTextSearch`, `providers/supabase/dataProvider.ts`) and client-side against
   FakeRest. This closes a live defect: `references`' search hook is currently registered
   against the wrong resource name and never fires against Supabase (see Dev Notes "The dead
   search hook this story fixes").

4. **All list state lives in the URL.** Search text, active filter values, sort field/order,
   and page/perPage are held in the URL query string for all three lists (ra-core's native
   list-location sync — `disableSyncWithLocation` is never set on any `<List>` this story
   touches) and are restored correctly after a hard refresh and when the URL is opened fresh
   in a new tab.

5. **Four states render, always.** `EntityListView` renders: a skeleton while `isPending`; a
   retry-capable error message when `useListContext().error` is set (never a blank screen);
   the entity's `EmptyState` when there is no data and no active filter; a "no records match"
   message when there is no data but a filter is active. Exactly one of these four renders at
   a time.

6. **No superseded local implementation survives.** `ShadchanGridSkeleton`, `ChildListSkeleton`
   / `ChildListHeader`, and `ReferenceListLayout`'s three inline skeleton/empty/no-matches
   branches are deleted, replaced by `EntityListView`.

7. **Verification.** `make typecheck && npm run lint && make test` pass repo-wide with no new
   warnings; `npx prettier --config ./.prettierrc.json --check` is clean on every file this
   story creates or modifies; a new Vitest suite for `EntityListView`/`useEntityListStatus`
   covers all four states (AAA, `.claude/rules/testing.md`); an e2e spec
   (`e2e/entity-list-search.spec.ts`) proves search text and sort survive a hard reload on at
   least one retrofitted list.

## Tasks / Subtasks

- [ ] **Task 1 — `useEntityListStatus` (AC: 1, 5)**
  - [ ] Create `src/components/atomic-crm/misc/useEntityListStatus.ts`. Reads
        `useListContext()` and returns one of
        `{ status: "loading" } | { status: "error"; error: unknown; refetch: () => void } |
        { status: "empty" } | { status: "no-matches" } | { status: "ready"; data: T[] }`.
        `"empty"` = no data AND `Object.keys(filterValues).length === 0`; `"no-matches"` = no
        data AND at least one filter value set (search counts as a filter — `q` is a
        `filterValues` key like any other).
  - [ ] This is the single place the four-state decision is made — `EntityListView` (Task 2)
        and the Shidduchim list view (Story 4.3) both consume it; neither re-derives it.

- [ ] **Task 2 — `EntityListView` (AC: 1, 5, 6)**
  - [ ] Create `src/components/atomic-crm/misc/EntityListView.tsx`. Props:
        `{ resource: string; skeleton: ReactNode; emptyState: EmptyStateProps; noMatchesMessage: string; renderItems: (data: RaRecord[]) => ReactNode }`.
        Calls `useEntityListStatus()` and renders: `skeleton` for `"loading"`; an error block
        (message + a "Try again" button calling `refetch()`) for `"error"`; `<EmptyState
        {...emptyState}/>` (reuse `misc/EmptyState.tsx` — do not create a second empty-state
        component) for `"empty"`; `<p>{noMatchesMessage}</p>` for `"no-matches"`; else
        `renderItems(data)`.
  - [ ] No pagination, sort, or search UI lives here — those are `EntityList`'s job (Task 3).
        This component only renders *given* a list context; it never talks to the data
        provider.

- [ ] **Task 3 — `EntityList` (AC: 1, 4)**
  - [ ] Create `src/components/atomic-crm/misc/EntityList.tsx`. Wraps
        `@/components/admin/list`'s `<List>` (reuse — do not reimplement pagination/filter/URL
        sync, which `ListBase` already provides via `disableSyncWithLocation = false`, its
        default). Props:
        `{ eyebrow?: string; subtitle?: string; createTo?: string; createLabel?: string; searchPlaceholder?: string; extraFilters?: ReactElement[]; sortFields?: string[]; sort?: SortPayload; perPage?: number } & Pick<EntityListViewProps, "resource"|"skeleton"|"emptyState"|"noMatchesMessage"|"renderItems">`.
        There is **no `title` prop**: the heading is
        `translate(`resources.${resource}.name`, { smart_count: 2, _: getEntityDescriptor(resource).label })`
        — the same key-plus-fallback pattern `ReferenceListHeader` uses today, with the
        fallback now owned by the entity's descriptor (Story 3.3) instead of a prop.
  - [ ] Renders `<List title={false} perPage={perPage ?? 100} sort={sort} pagination={<ListPagination/>} filters={[<SearchInput source="q" alwaysOn key="q" placeholder={searchPlaceholder}/>, ...(extraFilters ?? [])]} actions={<EntityListToolbar sortFields={sortFields} createTo={createTo} createLabel={createLabel}/>}>`,
        with `<EntityListHeader eyebrow={eyebrow} title={heading} subtitle={subtitle}/>` then
        `<EntityListView .../>` as children.
  - [ ] Create `src/components/atomic-crm/misc/EntityListHeader.tsx` (eyebrow/title/subtitle
        block — the markup currently duplicated, with small variations, in
        `ChildListHeader`, `ShadchanDirectory`'s inline header, and `ReferenceListHeader`).
        `eyebrow`/`subtitle` arrive pre-translated — each call site keeps its existing
        `crm.<entity>.list.*` keys / `_:` fallbacks via `useTranslate` (AD-18: no
        hardcoded strings lost in the move).
  - [ ] Create `src/components/atomic-crm/misc/EntityListToolbar.tsx`: renders
        `<FilterButton/>` (only if `extraFilters` is non-empty — reuse
        `@/components/admin/filter-form`'s `FilterButton`), a `<SortButton fields={sortFields}/>`
        (reuse `@/components/admin/sort-button`, only if `sortFields` is non-empty), and
        `<CreateButton label={createLabel}/>` styled to match the existing gradient CTA (reuse
        the class string already used by `ChildListHeader`'s / `ShadchanList`'s "Add a …"
        links — do not invent a third visual for the same button).

- [ ] **Task 4 — Fix the dead search hook, wire the new ones (AC: 3)**
  - [ ] `src/components/atomic-crm/providers/supabase/dataProvider.ts`: the
        `applyFullTextSearch` entry is keyed `resource: "references_summary"`
        (`lifeCycleCallbacks`, ~line 749). The UI queries resource `"references"` (`<Resource
        name="references">`, `references/index.ts`); `getDataProviderWithCustomMethods()`'s
        own `getList` override (~lines 107-147) redirects `"references"` →
        `baseDataProvider.getList("references_summary", …)` **internally**, so
        `withLifecycleCallbacks` — which pattern-matches on the resource string the *caller*
        passed (verified in `ra-core`'s `withLifecycleCallbacks` source: `resource` is
        threaded through unchanged) — never sees `"references_summary"` and the hook never
        runs against Supabase. Change the key to `resource: "references"` **and, in the same
        edit, replace `"phone"` with `"phone_norm"` in its column list**: `applyFullTextSearch`
        special-cases the literal column name `phone` into `phone_fts@ilike`, and `phone_fts`
        is a generated column that exists only on the fossil `contacts_summary` view
        (`03_views.sql`) — the moment the re-keyed hook actually fires, that filter would 400
        against `references_summary`, which has `phone` and `phone_norm` but no `phone_fts`.
        `phone_norm` (the trigger-set normalized digits) is the right search column anyway.
  - [ ] Add `{ resource: "singles", beforeGetList: applyFullTextSearch(["first_name_en", "last_name_en", "first_name_he", "last_name_he"]) }`
        to the same array (this resource has no `_summary` redirect — `SingleList` queries
        `"singles"` directly — so no renaming trap here).
  - [ ] Add `{ resource: "shadchanim", beforeGetList: applyFullTextSearch(["name", "name_he", "location"]) }`.
  - [ ] **No FakeRest change is needed.** Verified: `fakerest`'s own `q` handling
        (`node_modules/fakerest/dist/fakerest.js:2723-2739`, `buildRegexSearch`) does a
        case-insensitive substring match across every string field of every record, generically,
        regardless of resource — this is why the demo has always looked like search worked even
        though the Supabase hook was dead.

- [ ] **Task 5 — Retrofit `SingleList` (AC: 2, 4, 5, 6)**
  - [ ] Extend the `singles` entry in Story 3.9's descriptor registrations (wherever 3.9 put
        them — `entity360/RecordLink.tsx` module scope or `entity360/liveResourcePaths.ts`)
        with `label: "Singles"`. Same one-line edit per entity in Tasks 6/7.
  - [ ] Rewrite `src/components/atomic-crm/singles/SingleList.tsx` to render
        `<EntityList resource="singles" eyebrow="Family roster" createTo="/singles/create" createLabel="Add a single" searchPlaceholder="Search by name" perPage={100} sort={{field:"first_name_en", order:"ASC"}} skeleton={<SingleListSkeleton/>} emptyState={{title: "Add your first single", description: "...", actionLabel: "Add a single", actionTo: "/singles/create"}} noMatchesMessage="No singles match this search." renderItems={(data) => <SingleCardGrid data={data}/>}/>`.
  - [ ] Keep `SingleCard` unchanged; `SingleCardGrid` is just today's grid `<div>` extracted
        so it can be passed as `renderItems`.
  - [ ] Delete `ChildListSkeleton`/`ChildListHeader` (superseded by `EntityListHeader` + the
        new skeleton) once nothing references them.
  - [ ] The per-single pipeline-count enrichment (`useGetList<SingleSummary>("singles_summary")`,
        joined by id) is unrelated to list chrome — keep it exactly as-is inside the new
        `renderItems` callback.

- [ ] **Task 6 — Retrofit `ShadchanList`** (AC: 2, 4, 5, 6)
  - [ ] Same shape as Task 5 (descriptor `label: "Shadchanim"`, then):
        `<EntityList resource="shadchanim" eyebrow="Matchmaker book" createTo="/shadchanim/create" createLabel="Add a shadchan" searchPlaceholder="Search by name" sort={{field:"name", order:"ASC"}} .../>`.
  - [ ] Delete `ShadchanGridSkeleton`; keep the existing `shidduchim`-count enrichment
        (`countSuggestionsByShadchan`) inside `renderItems`.

- [ ] **Task 7 — Retrofit `ReferenceList`** (AC: 2, 4, 5, 6)
  - [ ] Descriptor `label: "References"`, then
        `<EntityList resource="references" eyebrow="Reference book" createTo="/references/create" createLabel="Add a reference" searchPlaceholder="Search name, phone, school..." extraFilters={[<TextInput source="relationship"/>, <SelectInput source="open_task_count@gt" .../>, <SelectInput source="contacted_count@eq" .../>]} sort={{field:"name_en", order:"ASC"}} .../>` — the three existing `referenceFilters` entries beyond `SearchInput` move into `extraFilters` unchanged; `EntityList` supplies the `SearchInput` itself, so drop `referenceFilters`' own `<SearchInput source="q" alwaysOn/>` entry.
  - [ ] Delete `ReferenceListLayout`'s inline skeleton/empty/no-matches branches; `ReferenceRow`
        stays as the per-item renderer, passed via `renderItems`.

- [ ] **Task 8 — Tests (AC: 7)**
  - [ ] `src/components/atomic-crm/misc/EntityListView.test.tsx`: four cases (loading / error +
        retry calls `refetch` / empty renders `EmptyState` / no-matches renders the message),
        wrapping with a `ListContextProvider` fed a hand-built `ListControllerResult` (no need
        to spin up a real `<List>` fetch for this unit-level test).
  - [ ] `src/components/atomic-crm/misc/useEntityListStatus.test.ts`: the four-branch decision
        table, same wrapping approach.
  - [ ] Update `SingleList`/`ShadchanList`/`ReferenceList` — none have existing tests
        (verified: no `*.test.*` file exists in `singles/`, `shadchanim/`, or `references/` for
        these three list components today) — add one smoke test per list using the
        `CoreAdminContext` + `ra-data-fakerest` pattern already established in
        `tasks/TasksListFilter.test.tsx`, asserting the search box filters the rendered rows.
  - [ ] `e2e/entity-list-search.spec.ts`: on `/shadchanim`, type a search term, assert the
        filtered result, reload the page, assert the search term and filtered result persist
        (URL round-trip — AC-4). Per `e2e-conventions`, this is required because the story
        touches search/filter UI.

## Dev Notes

### The dead search hook this story fixes

`withLifecycleCallbacks(dataProvider, handlers)` matches `handlers[].resource` against the
exact string the **caller** passes to `.getList(resource, params)` — verified in
`node_modules/ra-core/src/dataProvider/withLifecycleCallbacks.ts:128-145`, which threads
`resource` straight through unchanged. `getDataProviderWithCustomMethods()`'s `getList`
override (`providers/supabase/dataProvider.ts:107-147`) redirects `"references"` →
`baseDataProvider.getList("references_summary", params)`, `"shidduchim"` →
`"shidduchim_summary"`, etc., **inside** that same object — a redirect the outer
`withLifecycleCallbacks` wrapper never observes, because it already decided which hook (if
any) to run before handing off to the inner provider. Since the only registered
`applyFullTextSearch` hook for a live resource is keyed `"references_summary"`
(`dataProvider.ts:749`), and the UI only ever calls `.getList("references", …)`, the hook
has never executed against Supabase. It only *looks* like it works in the demo because
FakeRest's `q` handling is generic and resource-name-independent (see Task 4). This is why
the `singles`/`shadchanim` hooks added by this story are keyed to `"singles"`/`"shadchanim"`
directly — neither of those two resources has a `_summary` redirect, so no such trap exists
for them, but it is worth stating explicitly so the next person adding a searchable
`*_summary`-backed resource (Story 4.3's `shidduchim` search) does not repeat the mistake:
**key the hook to the resource name the `<List>` component is actually given, never to the
view name it happens to redirect to internally.**

### What 4.1 deliberately does not build

- **No List/Cards toggle.** `EntityListView.renderItems` takes one render function; Story 4.2
  changes this to `renderList`/`renderCards` plus a persisted `viewMode`. Do not add a toggle
  here — it has no visual home yet (`EntityListToolbar` doesn't have a slot for it) and 4.2
  owns that slot.
- **No descriptor consumption beyond `label`.** The `EntityDescriptor` registry exists
  (Story 3.3), and Story 3.9 registered the minimal routing descriptor for all four live
  entities. This story extends those registrations with `label` and resolves list headings
  through it — the descriptor half of AD-24's list contract. `icon`/`meta`/`stats` have no
  home in list chrome yet and are **not** consumed here; Epic 5 fills the full 360
  descriptors. Never redefine the `EntityDescriptor` type — 3.3's doc comment atop
  `entityDescriptor.ts` forbids exactly that.
- **`shidduchim` is not touched.** It is not a plain roster (it is a Kanban board with a
  child-in-context filter) and does not fit `EntityList` as designed here. Story 4.3 owns it,
  reusing `EntityListView`/`useEntityListStatus` directly rather than the `EntityList` wrapper
  (see 4.3 Dev Notes for why the two can't share one `<List>` instance).
- **Tasks and Reminders are out of scope.** Both present a due-date-bucketed view (Overdue /
  Upcoming), not a searchable/sortable/paginated roster, per AD-13. They are not migrated onto
  `EntityList`.

### Architecture

- **AD-24**: "Lists render through **one `EntityList`**... An entity contributes a descriptor
  ... and no bespoke layout code." This story is that component's first landing, applied to
  the three entities whose lists are today's clearest violations (each hand-rolls its own
  header, skeleton, and — for `SingleList`/`ShadchanList` — has no search at all). The
  "contributes a descriptor" half is served through 3.3's registry (`label`), not through
  per-list props.
- **UX-DR7**: "One `EntityList` framework with URL-held state." Satisfied by leaving
  `disableSyncWithLocation` at its ra-core default (`false`) on every `<List>` — this story's
  job is to stop any component from *routing around* that sync with local `useState`
  (`SingleList`/`ShadchanList`/`ReferenceList` do not do this today; Story 4.3 is the one
  fixing that specific violation on `ShidduchimList`).
- **AD-10**: the dataProvider is the single CRUD seam; extend at its two seams. This story
  extends at exactly the seam AD-10 names — the `ResourceCallbacks[]` / lifecycle-callbacks
  array — reusing the existing `applyFullTextSearch` helper rather than writing three new
  search implementations.

### Testing standard

Component tests: `vitest-browser-react`'s `render` + `ra-core`'s `CoreAdminContext` with
`ra-data-fakerest`, the pattern in `src/components/atomic-crm/tasks/TasksListFilter.test.tsx`.
For `EntityListView`/`useEntityListStatus`, prefer wrapping with a raw
`ListContextProvider`/hand-built `ListControllerResult` over spinning up a full `<List>` fetch
— this is unit-level state-dispatch logic, not an integration test.
`.claude/rules/testing.md`: AAA structure, no shared mutable state between tests, ≥80%
coverage on the new files.

### Project Structure Notes

New files all live in `src/components/atomic-crm/misc/` — the existing home for shared,
cross-entity UI (`EmptyState.tsx`, `EditSheet.tsx`) per AGENTS.md's directory map ("misc/
Shared utilities"). None of the three retrofitted lists change directory or resource name.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-24] — `EntityList`, descriptor, no bespoke layout code.
- [Source: ARCHITECTURE-SPINE.md#AD-10] — dataProvider CRUD seam, `ResourceCallbacks[]`.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.1 AC text (UX-DR7).
- [Source: _bmad-output/implementation-artifacts/3-3-entity-descriptor-registry.md] — the
  `EntityDescriptor` type/registry this story consumes `label` from.
- [Source: _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — the existing
  minimal registrations Tasks 5-7 extend.
- [Source: .claude/rules/testing.md], [Source: .claude/skills/e2e-conventions/SKILL.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
