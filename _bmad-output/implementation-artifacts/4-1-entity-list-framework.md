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
- **4.3** (Shidduchim pipeline & list view) reuses `EntityListView` and `useEntityListStatus`
  directly, nested under its own `<List>`, and copies this story's search-wiring pattern for a
  third resource.
- **4.5** (Global search) fans out over the per-resource search hooks this story adds.

### Dependencies (all landed — verified on `main`, 2026-07-29)

| Dependency | Shipped artefact this story binds to |
|---|---|
| Epic 1 Story 1.3 | resource `singles`, route `/singles`, type `Single`, `singles/SingleList.tsx` with local `SingleListSkeleton` / `SingleListHeader`. The retired `Child*` names no longer exist anywhere. |
| Epic 3 Story 3.3a | `entity360/entityDescriptor.ts` (the `EntityDescriptor` type, `label` **required**), `entity360/registry.ts` (`registerEntityDescriptor` / `getEntityDescriptor` / `requireEntityDescriptor`). |
| Epic 3 Story 3.9 | four `<entity>/entityDescriptor.ts` modules, each already carrying `label` (`"Singles"`, `"Shadchanim"`, `"References"`, `"Shidduchim"`) and registering itself at module scope. |
| Epic 3 Story 3.12 | `entity360/entityPaths.ts` (`buildListPath` / `buildNewPath` / `buildRecordPath` / `buildEditPath` / `buildTabPath`) and the shipped `check-route-convention` CI guard (`scripts/route-convention.json`). |
| RULING 7 | `entity360/ad24Conformance.ts`'s `NO_BROWSE_SURFACE_ENTITIES` — `references` has **no list, no `EntityList`, no search**. |

## Acceptance Criteria

1. **One component owns list chrome.** `src/components/atomic-crm/misc/EntityList.tsx` (a
   `<List>` wrapper) and its context-only inner view
   `src/components/atomic-crm/misc/EntityListView.tsx` are the only place search box, filter
   toggle, sort control, pagination, and loading/empty/error rendering are implemented for a
   roster-style entity list. No entity list built or touched by this story contains its own
   skeleton, its own empty-state branch, or its own error handling.
   *Failing looks like:* `grep -n "Skeleton\|EmptyState" singles/SingleList.tsx
   shadchanim/ShadchanList.tsx` still returns a locally-defined skeleton component or an
   `<EmptyState>` branch after this story.

2. **The list heading resolves through the registry, guarded.** `EntityList` derives its
   heading as
   ```ts
   const descriptor = getEntityDescriptor(resource);          // guarded form — see AC-1a
   const heading = translate(`resources.${resource}.name`, {
     smart_count: 2,
     _: descriptor?.label ?? resource,
   });
   ```
   There is **no `title` prop** on `EntityList`.
   *Failing looks like:* (a) `make typecheck` reports TS2532 / "possibly undefined" on
   `EntityList.tsx`; (b) mounting `<EntityList resource="tasks" …/>` — a resource with **no**
   registered descriptor (`ad24Conformance.ts`'s `DESCRIPTORLESS_RESOURCES` names three) —
   throws instead of rendering the translated heading. A unit test asserts (b) explicitly.

3. **Two existing lists render through it**, keeping their own per-item visual as an injected
   renderer, not rebuilt: `src/components/atomic-crm/singles/SingleList.tsx` and
   `src/components/atomic-crm/shadchanim/ShadchanList.tsx`.
   `references` is **excluded by RULING 7** — see Dev Notes "Why references is not here".
   *Failing looks like:* either file still renders its own `<List title={false} actions=…>` with
   hand-rolled chrome instead of `<EntityList …/>`.

4. **Search works on both, against the real backend, not just the demo.** Typing in the search
   box filters `singles` and `shadchanim` server-side against Supabase (new
   `applyFullTextSearch` entries in `providers/supabase/dataProvider.ts`'s `lifeCycleCallbacks`,
   keyed to the resource name the `<List>` is given) and client-side against FakeRest.
   *Failing looks like:* the network tab shows `GET /rest/v1/singles?...` with a literal `q=`
   parameter and PostgREST answers `400` (unknown column `q`), or answers `200` with the full
   unfiltered set.

5. **All list state lives in the URL.** Search text, active filter values, sort field/order, and
   page/perPage are held in the URL query string for both lists (ra-core's native list-location
   sync — `disableSyncWithLocation` is never set on any `<List>` this story touches) and are
   restored after a hard refresh and when the URL is opened fresh in a new tab.
   *Failing looks like:* after typing a search term the address bar's `filter` param is absent,
   or a reload clears the search box.

6. **Four states render, always.** `EntityListView` renders: a skeleton while `isPending`; a
   retry-capable error message when `useListContext().error` is set (never a blank screen); the
   entity's `EmptyState` when there is no data and no active filter; a "no records match" message
   when there is no data but a filter is active. Exactly one of these four renders at a time.
   *Failing looks like:* a `ListContextProvider` fed `{ error, isPending: false, data: [] }`
   renders the empty state (or nothing) rather than the error block; or two of the four render
   together.

7. **No superseded local implementation survives.** `singles/SingleList.tsx`'s
   `SingleListSkeleton` and `SingleListHeader`, and `shadchanim/ShadchanList.tsx`'s
   `ShadchanGridSkeleton`, `AddShadchanButton` and `ShadchanListActions`, are deleted — replaced
   by `EntityListView` / `EntityListHeader` / `EntityListToolbar` (NFR-14: the replaced thing goes
   in the same diff).
   *Failing looks like:* those identifiers still resolve — check with `LSP workspaceSymbol`, not
   grep.

8. **No `/create` literal, no hand-built path.** Every create link this story writes goes through
   `buildNewPath("<entity>")` (`entity360/entityPaths.ts`).
   *Failing looks like:* `node scripts/check-route-convention.mjs` reports a
   `create-path-literal` hit (its `allowlistedFiles` is `[]`, so there is no escape).

9. **The route table is untouched, deliberately.** This story changes what the `list` component
   *renders*, never how it is *registered*. `singles/index.ts` and `shadchanim/index.ts` keep
   their existing `{ list, edit, show, hasCreate, children: buildCreateRoutes(...) }` default
   export; neither gains `buildEntityRoutes`, and neither needs explicit `hasShow`/`hasEdit`
   because both already register real `show` and `edit` components, from which
   `Resource.registerResource` computes both flags as `true`
   (`ra-core/dist/core/Resource.js`). Epic 5 (5.8 / 5.9) owns the `buildEntityRoutes` migration.
   *Failing looks like:* `src/components/atomic-crm/root/routeManifest.ts`'s
   `findManifestViolations` reports `record-flags-missing`, or `<entity>/index.ts` appears in
   this story's File List.

10. **Verification.** `make typecheck && npm run lint && make test` pass repo-wide with no new
    warnings; `npx prettier --config ./.prettierrc.json --check` is clean on every file this
    story creates or modifies; a new Vitest suite for `EntityListView` / `useEntityListStatus`
    covers all four states plus the descriptorless-resource case (AAA,
    `.claude/rules/testing.md`); an e2e spec (`e2e/entity-list-search.spec.ts`) proves search
    text and sort survive a hard reload on at least one retrofitted list.

## Tasks / Subtasks

- [ ] **Task 1 — `useEntityListStatus` (AC: 1, 6)**
  - [ ] Create `src/components/atomic-crm/misc/useEntityListStatus.ts`. Reads
        `useListContext()` and returns one of
        `{ status: "loading" } | { status: "error"; error: unknown; refetch: () => void } |
        { status: "empty" } | { status: "no-matches" } | { status: "ready"; data: RaRecord[] }`.
        `"empty"` = no data AND `Object.keys(filterValues).length === 0`; `"no-matches"` = no
        data AND at least one filter value set (search counts as a filter — `q` is a
        `filterValues` key like any other).
  - [ ] This is the single place the four-state decision is made — `EntityListView` (Task 2)
        and `ShidduchimViewSwitch` (Story 4.3) both consume it; neither re-derives it.

- [ ] **Task 2 — `EntityListView` (AC: 1, 6, 7)**
  - [ ] Create `src/components/atomic-crm/misc/EntityListView.tsx`. Props:
        `{ resource: string; skeleton: ReactNode; emptyState: EmptyStateProps;
        noMatchesMessage: string; renderItems: (data: RaRecord[]) => ReactNode }`.
        `EmptyStateProps` is imported from `misc/EmptyState.tsx` — it is already exported there;
        do not redeclare it.
  - [ ] Calls `useEntityListStatus()` and renders: `skeleton` for `"loading"`; an error block
        (message + a "Try again" button calling `refetch()`) for `"error"`; `<EmptyState
        {...emptyState}/>` (reuse `misc/EmptyState.tsx` — do not create a second empty-state
        component) for `"empty"`; `<p>{noMatchesMessage}</p>` for `"no-matches"`; else
        `renderItems(data)`.
  - [ ] No pagination, sort, or search UI lives here — those are `EntityList`'s job (Task 3).
        This component only renders *given* a list context; it never talks to the data provider.

- [ ] **Task 3 — `EntityList`, `EntityListHeader`, `EntityListToolbar` (AC: 1, 2, 5, 8)**
  - [ ] Create `src/components/atomic-crm/misc/EntityList.tsx`. Wraps
        `@/components/admin/list`'s `<List>` (reuse — do not reimplement pagination/filter/URL
        sync; `ListBase` already provides it with `disableSyncWithLocation` at its `false`
        default). Props:
        `{ eyebrow?: string; subtitle?: string; createTo?: string; createLabel?: string;
        searchPlaceholder?: string; extraFilters?: ReactElement[]; sortFields?: string[];
        sort?: SortPayload; perPage?: number } &
        Pick<EntityListViewProps, "resource"|"skeleton"|"emptyState"|"noMatchesMessage"|"renderItems">`.
  - [ ] Heading exactly per AC-2. **`getEntityDescriptor` is the guarded accessor and returns
        `EntityDescriptor | undefined`** (`entity360/registry.ts`) — never dereference it
        (`.claude/rules/coding-style.md#Error-handling`, Epic 3 contract §4 rule 3, which names
        this exact consumer). Do **not** use `requireEntityDescriptor` here: `EntityList` is
        generic over resources and three of the seven in `root/routeManifest.ts` deliberately
        have no descriptor.
  - [ ] Renders
        `<List title={false} perPage={perPage ?? 100} sort={sort} pagination={<ListPagination/>}
        filters={[<SearchInput source="q" alwaysOn key="q" placeholder={searchPlaceholder}/>, ...(extraFilters ?? [])]}
        actions={<EntityListToolbar sortFields={sortFields} createTo={createTo} createLabel={createLabel}/>}>`,
        with `<EntityListHeader eyebrow={eyebrow} title={heading} subtitle={subtitle}/>` then
        `<EntityListView .../>` as children.
  - [ ] Create `src/components/atomic-crm/misc/EntityListHeader.tsx` (eyebrow/title/subtitle
        block — the markup currently duplicated, with small variations, inside
        `SingleList.tsx`'s `SingleListHeader` and `ShadchanList.tsx`'s `ShadchanDirectory`).
        `eyebrow`/`subtitle` arrive pre-translated — each call site keeps its existing
        `crm.<entity>.list.*` keys / `_:` fallbacks via `useTranslate` (AD-18: no hardcoded
        strings lost in the move).
  - [ ] Create `src/components/atomic-crm/misc/EntityListToolbar.tsx`: renders `<FilterButton/>`
        (only when `extraFilters` is non-empty — reuse `@/components/admin/filter-form`'s
        `FilterButton`), `<SortButton fields={sortFields}/>` (reuse
        `@/components/admin/sort-button`, only when `sortFields` is non-empty), and a create
        link whose `to` is the `createTo` prop, styled with the gradient CTA class string lifted
        verbatim from today's `SingleListHeader` / `AddShadchanButton` — do not invent a third
        visual for the same button.
  - [ ] `EntityListToolbar` leaves an explicit, empty `viewToggle` slot **unused** in this story —
        Story 4.2 fills it (see "What 4.1 deliberately does not build").

- [ ] **Task 4 — Wire the two search hooks (AC: 4)**
  - [ ] `src/components/atomic-crm/providers/supabase/dataProvider.ts`, `lifeCycleCallbacks`
        (currently: one `members` `beforeSave`, one `references_summary` `beforeGetList`, then
        the spread `...entityFilesCleanupCallbacks`). Add
        `{ resource: "singles", beforeGetList: applyFullTextSearch(["first_name_en", "last_name_en", "first_name_he", "last_name_he"]) }`.
        `singles` has no `_summary` redirect — `SingleList` queries `"singles"` directly — so no
        renaming trap here.
  - [ ] Add `{ resource: "shadchanim", beforeGetList: applyFullTextSearch(["name", "name_he", "location"]) }`.
        Same: no redirect.
  - [ ] **Key each hook to the resource name the `<List>` is actually given, never to the view
        name the provider redirects to internally** — see Dev Notes "The dead-hook trap". This is
        the one sentence Story 4.3 and Story 4.5 both cite.
  - [ ] Insert both entries **before** the `...entityFilesCleanupCallbacks` spread, so the array's
        shape stays "explicit entries, then the generated block". Story 3.7 owns that block; do
        not edit it.
  - [ ] **No FakeRest change is needed.** Verified: `fakerest`'s own `q` handling
        (`node_modules/fakerest/dist/fakerest.js`, `buildRegexSearch`) does a case-insensitive
        substring match across every string field of every record, generically, regardless of
        resource.
  - [ ] **Do not touch the existing `references_summary` entry.** It is dead (see Dev Notes
        "Residual: the dead references hook") and RULING 7 removed its only would-be consumer;
        deleting it belongs to the RULING 7 references wave, which owns `references/`.

- [ ] **Task 5 — Retrofit `SingleList` (AC: 3, 5, 6, 7, 8)**
  - [ ] **No descriptor edit is required.** `singles/entityDescriptor.ts` already declares
        `label: "Singles"` (`label` is a **required** field of `EntityDescriptor`, so every
        shipped descriptor has one). Confirm and move on — there is nothing to add.
  - [ ] Rewrite `src/components/atomic-crm/singles/SingleList.tsx` to render
        ```tsx
        <EntityList
          resource="singles"
          eyebrow="Family roster"
          subtitle="Every single you are redting for, each with their own pipeline."
          createTo={buildNewPath("singles")}
          createLabel="Add a single"
          searchPlaceholder="Search by name"
          perPage={100}
          sort={{ field: "first_name_en", order: "ASC" }}
          skeleton={<SingleCardGridSkeleton/>}
          emptyState={{
            title: "Add your first single",
            description: "A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions.",
            actionLabel: "Add a single",
            actionTo: buildNewPath("singles"),
          }}
          noMatchesMessage="No singles match this search."
          renderItems={(data) => <SingleCardGrid data={data}/>}
        />
        ```
        `createTo` / `actionTo` are `buildNewPath("singles")` — **never** the string
        `"/singles/create"` (AC-8).
  - [ ] Keep `SingleCard` unchanged; `SingleCardGrid` is today's grid `<div>` extracted so it can
        be passed as `renderItems`. `SingleCardGridSkeleton` is today's `SingleListSkeleton`
        markup moved into that same file (it is a card-grid shape, entity-specific) — the *state
        decision* moves to `EntityListView`, the *markup* stays with the entity.
  - [ ] Delete `SingleListSkeleton` and `SingleListHeader` from `SingleList.tsx` (AC-7).
  - [ ] The per-single pipeline-count enrichment (`useGetList<SingleSummary>("singles_summary")`,
        joined by id) is unrelated to list chrome — keep it exactly as-is inside the new
        `renderItems` callback / `SingleCardGrid`.

- [ ] **Task 6 — Retrofit `ShadchanList` (AC: 3, 5, 6, 7, 8)**
  - [ ] Same shape (`shadchanim/entityDescriptor.ts` already declares `label: "Shadchanim"` —
        nothing to add):
        `<EntityList resource="shadchanim" eyebrow="Matchmaker book" subtitle="Every matchmaker your family has worked with, in one calm book." createTo={buildNewPath("shadchanim")} createLabel="Add a shadchan" searchPlaceholder="Search by name" perPage={200} sort={{field:"name", order:"ASC"}} …/>`.
  - [ ] Delete `ShadchanGridSkeleton`, `AddShadchanButton` and `ShadchanListActions`; keep the
        existing `shidduchim`-count enrichment (`countSuggestionsByShadchan`) inside
        `renderItems`.
  - [ ] `perPage={200}` and `pagination={null}` are today's deliberate settings for this roster —
        preserve them by passing `perPage={200}`; if `EntityList` cannot express
        `pagination={null}`, add a `pagination?: ReactNode | null` pass-through prop rather than
        silently paginating a book that has never paged.

- [ ] **Task 7 — Tests (AC: 10)**
  - [ ] `src/components/atomic-crm/misc/useEntityListStatus.test.ts`: the five-branch decision
        table, wrapping with a `ListContextProvider` fed a hand-built `ListControllerResult`.
  - [ ] `src/components/atomic-crm/misc/EntityListView.test.tsx`: loading / error + "Try again"
        calls `refetch` / empty renders `EmptyState` / no-matches renders the message / ready
        renders `renderItems`. Same wrapping approach — no real `<List>` fetch for this
        unit-level test.
  - [ ] `src/components/atomic-crm/misc/EntityList.test.tsx`: **AC-2's falsifiable half** —
        `<EntityList resource="tasks" …/>` (no registered descriptor) renders without throwing
        and shows the translated `resources.tasks.name`; `<EntityList resource="singles" …/>`
        shows "Singles". Wrap with `CoreAdminContext` + `ra-data-fakerest`, the pattern in
        `src/components/atomic-crm/tasks/TasksListFilter.test.tsx`.
  - [ ] One smoke test per retrofitted list (`SingleList.test.tsx`, `ShadchanList.test.tsx`;
        verified: neither exists today), asserting the search box filters the rendered rows.
  - [ ] `e2e/entity-list-search.spec.ts`: on `/shadchanim`, type a search term, assert the
        filtered result, reload the page, assert the search term and filtered result persist
        (URL round-trip — AC-5). Per `.claude/skills/e2e-conventions`, required because this
        story touches search/filter UI.
  - [ ] **e2e stack discipline:** Playwright needs **both** `make start-supabase-e2e` and
        `make start-app-e2e`, and the stack is a host-global singleton
        (`playwright.config.ts`: `workers: 1`, fixed ports, `reuseExistingServer: true`). If you
        run unit tests concurrently with another agent, take a `STACK_ID` (1-6, never 0) plus
        `STACK_OWNER=<label>` and stop the stack afterwards
        (`.claude/rules/parallel-ownership.md`).

## Dev Notes

### Why `references` is not here

**RULING 7 (project owner, standing):** *a reference exists only within a shidduch's context.*
It keeps a full 360 at `/references/{id}` and shows every shidduch it serves from inside its own
record; it has **no nav entry, no list, no `EntityList`, no dashboard tile, no tour step and no
global-search results.** This is a product decision, not a security boundary — RLS stays
deliberately account-wide (FR51) and must not be narrowed to enforce it.

The ruling is not prose: it is **shipped, enforced code**. `entity360/ad24Conformance.ts` exports
`NO_BROWSE_SURFACE_ENTITIES = { references: … }` and `findNoBrowseSurfaceViolations` reports
`browse-surface-on-scoped-entity` for (a) any `PRIMARY_NAV` target under `/references` and (b) any
file containing a `/references` list-path literal or a `buildListPath("references")` call. Its
guard test (`entity360/ad24Conformance.guard.test.ts`) currently pins the four known offenders and
names **Story 4.4** as the story that clears them.

Consequences for this story, all deletions rather than retargetings:
- `references` is not one of the retrofitted lists (AC-3 says two, not three).
- The `extraFilters` prop still exists on `EntityList` — it is not references-specific — but this
  story ships no consumer for it. That is fine; 4.2/4.3 do not need it either. Do not delete the
  prop and do not invent a consumer.
- `/references` itself becomes the **unattached-references panel** (only rows with zero links,
  each with an inline attach action). That component is owned by the RULING 7 references wave,
  **not by any Epic 4 story.** Do not build it here and do not delete `ReferenceList.tsx` here —
  it is outside this story's declared paths (`.claude/rules/parallel-ownership.md`: needing a path
  outside your declaration means report and stop, which is a successful outcome).

### Residual: the dead `references_summary` search hook

`lifeCycleCallbacks` carries `{ resource: "references_summary", beforeGetList: applyFullTextSearch([...]) }`.
It has never fired: `withLifecycleCallbacks` matches on the resource string the **caller** passes
to `.getList()`, and the UI only ever calls `getList("references")` — the
`"references" → "references_summary"` swap happens *inside*
`getDataProviderWithCustomMethods()`, below the wrapper. An earlier draft of this story re-keyed
it to `"references"`. **That fix is deleted, not retargeted:** RULING 7 removes its only consumer
(the reference-book search box), so re-keying it would revive a browse surface the owner closed.
It is left in place as inert code and recorded here so the next reader does not rediscover it as a
bug. Its deletion belongs to whoever owns `references/` under the RULING 7 wave.

### The dead-hook trap (the rule this story exports)

`withLifecycleCallbacks(dataProvider, handlers)` matches `handlers[].resource` against the exact
string the **caller** passes to `.getList(resource, params)` — `resource` is threaded straight
through unchanged (`node_modules/ra-core/src/dataProvider/withLifecycleCallbacks.ts`).
`getDataProviderWithCustomMethods()`'s own `getList` override redirects `"references"` →
`"references_summary"`, `"shidduchim"` → `"shidduchim_summary"`, etc., **inside** that same
object — a redirect the outer wrapper never observes, because it already decided which hook (if
any) to run before handing off.

**Rule, cited by 4.3 and 4.5: key the hook to the resource name the `<List>` component is actually
given, never to the view name it happens to redirect to internally.** `singles` and `shadchanim`
have no redirect, so neither hook in this story can hit the trap — but Story 4.3's `shidduchim`
hook is redirect-backed and the rule is what keeps it alive.

Second trap, same helper: `applyFullTextSearch` special-cases the literal column names `email`
and `phone` into `email_fts@ilike` / `phone_fts@ilike`. Those generated columns exist only on the
fossil `contacts_summary` view. **Never pass `"phone"` or `"email"` to `applyFullTextSearch`** —
pass the real column (`phone_norm`, etc.) or the filter 400s the moment the hook fires.

### What 4.1 deliberately does not build

- **No List/Cards toggle.** `EntityListView.renderItems` takes one render function; Story 4.2
  changes this to `renderList` / `renderCards` plus a persisted `viewMode`. Do not add a toggle
  here — `EntityListToolbar` has the slot but 4.2 owns filling it.
- **No descriptor consumption beyond `label`.** `icon` / `meta` / `statBand` have no home in list
  chrome yet and are **not** consumed here; Epic 5 fills the full 360 descriptors. Never redefine
  the `EntityDescriptor` type — `entityDescriptor.ts`'s own doc comment forbids exactly that, and
  a second, list-specific descriptor shape is the drift AD-24 exists to prevent.
- **No route-table work.** See AC-9. `buildEntityRoutes`, `hasShow`, `hasEdit`, `EntityShow` and
  `<entity>/index.ts` are Epic 5's migration surface, not this story's.
- **`shidduchim` is not touched.** It is not a plain roster (it is a pipeline with a
  single-in-context filter) and does not fit `EntityList` as designed here. Story 4.3 owns it,
  reusing `EntityListView` / `useEntityListStatus` directly rather than the `EntityList` wrapper
  (see 4.3 Dev Notes for why the two cannot share one `<List>` instance).
- **Tasks, Reminders and Inbox are out of scope.** All present a bucketed or triage view, not a
  searchable/sortable/paginated roster, per AD-13. They are not migrated onto `EntityList`, which
  is exactly why AC-2's guarded accessor matters: `tasks`, `inbox_items` and `members` are
  registered resources with **no** descriptor (`ad24Conformance.ts`'s `DESCRIPTORLESS_RESOURCES`).

### Architecture

- **AD-24**: "Lists render through **one `EntityList`** with URL-held state... An entity
  contributes a descriptor ... and no bespoke layout code." This story is that component's first
  landing, applied to the two entities whose lists are today's clearest violations (each
  hand-rolls its own header, skeleton and CTA, and neither has search at all).
- **UX-DR7**: "One `EntityList` framework with URL-held state." Satisfied by leaving
  `disableSyncWithLocation` at its ra-core default (`false`) on every `<List>` this story
  touches. Note UX-DR7's own text ("behave identically for every entity") predates RULING 7 and
  reads one entity too wide; the shipped `NO_BROWSE_SURFACE_ENTITIES` table is the binding
  statement.
- **AD-10**: the dataProvider is the single CRUD seam; extend at its two seams. This story
  extends at exactly the seam AD-10 names — the `ResourceCallbacks[]` lifecycle array — reusing
  the existing `applyFullTextSearch` helper rather than writing two new search implementations.

### Ownership hazards (declare before dispatch)

| Shared artefact | Also edited by | Handling |
|---|---|---|
| `providers/supabase/dataProvider.ts` `lifeCycleCallbacks` | 4.3 (adds `shidduchim`), Story 3.7 (owns `entityFilesCleanupCallbacks`) | Sequential. Add entries above the spread; never reorder it. |
| `e2e/fixtures.ts` (`base.extend` block + the seed helpers) | 4.4 | Sequential. If this story's search spec needs ≥2 seeded shadchanim, add the helper **and** its two type/fixture-map lines in one edit and say so in the File List. |
| `registry.json` | any story adding/deleting a file under `src/components/atomic-crm/**` | Regenerated by the pre-commit hook (`make registry-gen`). Commit on a quiet tree. |

### Testing standard

Component tests: `vitest-browser-react`'s `render` + `ra-core`'s `CoreAdminContext` with
`ra-data-fakerest`, the pattern in `src/components/atomic-crm/tasks/TasksListFilter.test.tsx`.
**React Testing Library is not a dependency** — do not import it. Routing in tests uses
`TestMemoryRouter`. For `EntityListView` / `useEntityListStatus`, prefer wrapping with a raw
`ListContextProvider` / hand-built `ListControllerResult` over spinning up a full `<List>` fetch —
this is unit-level state-dispatch logic, not an integration test.
`.claude/rules/testing.md`: AAA structure, no shared mutable state between tests, ≥80% coverage
on the new files.

### Project Structure Notes

New files all live in `src/components/atomic-crm/misc/` — the existing home for shared,
cross-entity UI (`EmptyState.tsx`, `EditSheet.tsx`, `FormPageFrame.tsx`) per AGENTS.md's
directory map. Neither retrofitted list changes directory or resource name.

### Files this story will touch

```
src/components/atomic-crm/misc/useEntityListStatus.ts            (new)
src/components/atomic-crm/misc/useEntityListStatus.test.ts       (new)
src/components/atomic-crm/misc/EntityListView.tsx                (new)
src/components/atomic-crm/misc/EntityListView.test.tsx           (new)
src/components/atomic-crm/misc/EntityList.tsx                    (new)
src/components/atomic-crm/misc/EntityList.test.tsx               (new)
src/components/atomic-crm/misc/EntityListHeader.tsx              (new)
src/components/atomic-crm/misc/EntityListToolbar.tsx             (new)
src/components/atomic-crm/singles/SingleList.tsx                 (rewritten)
src/components/atomic-crm/singles/SingleList.test.tsx            (new)
src/components/atomic-crm/shadchanim/ShadchanList.tsx            (rewritten)
src/components/atomic-crm/shadchanim/ShadchanList.test.tsx       (new)
src/components/atomic-crm/providers/supabase/dataProvider.ts     (2 array entries)
e2e/entity-list-search.spec.ts                                   (new)
e2e/fixtures.ts                                                  (seed helper, if needed)
registry.json                                                    (regenerated)
```

### References

- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — "Lists render through **one `EntityList`** with URL-held state ... An entity contributes a
  **descriptor** ... and **no bespoke layout code**."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10]
  — dataProvider CRUD seam, keep FakeRest in sync.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.1 AC text (behaviour
  identical across entities; URL-held state; empty/loading/error states).
- [Source: _bmad-output/planning-artifacts/epics.md] §"RULING 7 — a reference exists only within
  a shidduch's context" and the UX-DR8 / UX-DR10 restatements above it.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §4 "Registry — three
  functions", rules 2-4 (`replace` is the whole extend API; never dereference the guarded form;
  `EntityList` over `tasks`/`inbox_items`/`members` must use the guarded form; a descriptor's
  home is `<entity>/entityDescriptor.ts`).
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §5 "Routes", rule 4 — explicit
  `hasShow`/`hasEdit`, and why this story does not need them.
- [Source: src/components/atomic-crm/entity360/entityDescriptor.ts] — `label` is REQUIRED;
  region renderers are `ComponentType<{ record: T }>`; `EntityTabDescriptor` is non-generic.
- [Source: src/components/atomic-crm/entity360/registry.ts] — the three accessors.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts] — `NO_BROWSE_SURFACE_ENTITIES`,
  `DESCRIPTORLESS_RESOURCES`, `findNoBrowseSurfaceViolations`.
- [Source: scripts/route-convention.json] — `create-path-literal`, `allowlistedFiles: []`.
- [Source: .claude/rules/testing.md], [Source: .claude/skills/e2e-conventions/SKILL.md],
  [Source: .claude/rules/parallel-ownership.md], [Source: .claude/rules/lsp-usage.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
