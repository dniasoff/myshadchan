# Story 4.3: Shidduchim list view

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want a searchable list of suggestions as well as the board,
so that I can find one without scanning columns.

## Position in Epic 4

**3rd of 5.** Depends on **4.1** (`EntityListView`, `useEntityListStatus`, the
`applyFullTextSearch` wiring pattern) and **4.2** (`useEntityListViewMode`,
`EntityListViewToggle`) — both must land first; this story reuses their pieces directly
rather than the `EntityList` wrapper (see Dev Notes "Why this doesn't use `<EntityList>`").

This story also relabels the `/shidduchim` primary-nav entry from "Pipeline" to "Shidduchim"
(its own AC-6). **Story 4.4 must not re-touch that label** — 4.4 only adds/removes other
entries; see 4.4 Dev Notes.

## Acceptance Criteria

1. **A second view exists.** `/shidduchim` gains a "List" view alongside the existing "Board"
   (Kanban) view, switched by a `view` URL query param (`board` default, `list`), so a link to
   `/shidduchim?view=list` opens directly into the list.

2. **The list view is searchable and has its own List/Cards choice.** The list view renders
   through `EntityListView` with a `q` search box (wired to a new `applyFullTextSearch` hook
   for resource `"shidduchim"`) and `EntityListViewToggle` (Story 4.2), independently
   persisted from every other entity's toggle.

3. **Board and list share filters and context.** The selected single and the search text are
   the same state for both views — switching from Board to List (or back) with a search term
   active, or with a different single selected, keeps both. This closes a real gap: today the
   selected single lives in local component `useState` (`ShidduchimList.tsx`'s `childId`), not
   the URL, so it does not survive a refresh or a shared link.

4. **One shared status gate.** Loading, error (with retry), and the "no singles in this
   household yet" precondition render identically regardless of which view is active — neither
   Board nor List has its own separate loading/error handling.

5. **No second fetch on toggle.** Switching between Board and List does not re-query the data
   provider — both read the same `useListContext()` data from the same `<List>` instance.

6. **Shidduchim appears in primary navigation**, labelled "Shidduchim" (not "Pipeline"):
   `layout/navItems.ts`'s `/shidduchim` entry's `labelDefault` and `labelKey` change; its `to`
   and position are unchanged.

7. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on
   changed files; a new Vitest suite covers the shared status gate and the view-mode/filter
   sharing; an e2e spec (`e2e/shidduchim-list-view.spec.ts`) proves AC-1 and AC-3 (deep link
   into list view; search a term in list view, switch to board, confirm the board is filtered
   to the same term; switch back, confirm the search box still shows it).

## Tasks / Subtasks

- [ ] **Task 1 — Wire `shidduchim` search (AC: 2)**
  - [ ] `providers/supabase/dataProvider.ts`: add
        `{ resource: "shidduchim", beforeGetList: applyFullTextSearch(["name_en", "name_he", "shadchan_name", "shadchan_name_he", "parents_en", "parents_he", "location_en", "location_he"]) }`
        to `lifeCycleCallbacks`. Key it to `"shidduchim"` (the resource the `<List>` is
        actually given), **not** `"shidduchim_summary"` — Story 4.1 Dev Notes documents exactly
        why the latter would silently never fire.
  - [ ] No FakeRest change needed (Story 4.1 Dev Notes: `q` search is generic there).

- [ ] **Task 2 — Hoist the selected single into the URL (AC: 3)**
  - [ ] In `shidduchim/ShidduchimList.tsx`, delete the local
        `useState<Identifier|undefined>` for `childId`/`singleId` (post-1.3 naming). Replace
        the outer `<List filter={{ child_id: selectedChildId }}>` (a hard `filter`, computed
        from local state, that the user cannot override) with
        `<List filterDefaultValues={{ single_id: singles[0].id }}>` — ra-core's `getQuery()`
        (`node_modules/ra-core/src/controller/list/useListParams.ts:114-123`) only falls back
        to `filterDefaultValues` when neither the URL nor the list's stored params already
        supply a value, so this is computed exactly once, synchronously, the same moment
        today's `selectedChildId = childId ?? children[0].id` is — the existing guard (`if
        (!identity || singlesPending) return null;` before `<List>` ever mounts) already
        guarantees `singles` is loaded by then, so no async race is introduced.
  - [ ] The single-switcher pills read `filterValues.single_id` and call
        `setFilters({ ...filterValues, single_id: id }, displayedFilters)` from
        `useListContext()` (replacing their current `onSelect`/local-`setState` wiring) —
        `setFilters` is what actually writes the new value into the URL's `filter` query
        param going forward; `filterDefaultValues` only ever supplies the *initial* value.
  - [ ] This makes `single_id` (and `q`, once Task 1 lands) part of the URL's `filter` query
        param automatically — no new URL-sync code is needed; it is ra-core's existing
        `ListBase` behavior (Story 4.1 AC-4), simply no longer bypassed.

- [ ] **Task 3 — The shared status gate and view switch (AC: 1, 4, 5)**
  - [ ] Restructure `ShidduchimList.tsx`'s inner layout: one `<List filter={...} filters={[<SearchInput source="q" alwaysOn/>]} pagination={null} perPage={200} sort={{field:"index", order:"ASC"}} actions={<ShidduchimActions/>}>`
        (unchanged `perPage`/`pagination={null}` — see Dev Notes "Why this list is never
        paginated") wrapping a new `ShidduchimViewSwitch` component.
  - [ ] `ShidduchimViewSwitch` calls `useEntityListStatus()` (Story 4.1) once, renders the
        shared loading/error/empty states for anything other than `"ready"`/`"no-matches"`,
        and — for those two — reads `view` from `useSearchParams()` (`react-router`) and
        renders either `ShidduchimListContent` (existing Kanban, unchanged) for `view !==
        "list"`, or `EntityListView`-style output for `view === "list"` (see Task 4). A small
        segmented control (Board icon / List icon, reusing `EntityListViewToggle`'s visual
        language but wired to the `view` search param, not `useEntityListViewMode` — see Dev
        Notes "Two different toggles, on purpose") switches between them.
  - [ ] The "no singles yet" precondition (`ShidduchimNoSingles`, post-1.3 name) stays a
        full early return **before** `<List>` mounts, unrelated to the status gate — while
        editing, replace its hand-rolled markup with `<EmptyState>` (`misc/EmptyState.tsx`) for
        visual consistency with every other entity's empty state (small cleanup, not
        structural).

- [ ] **Task 4 — The list sub-view (AC: 2)**
  - [ ] Inside the `view === "list"` branch, render
        `<EntityListView resource="shidduchim" viewMode={viewMode} renderList={...} renderCards={...} .../>`
        directly (not the `<EntityList>` wrapper — there is already an enclosing `<List>` from
        Task 3; a second one would double-fetch). `viewMode`/`setViewMode` come from
        `useEntityListViewMode("shidduchim", "list")` (Story 4.2), default `"list"` (a flat,
        sortable table reads better for scanning many suggestions than cards).
  - [ ] `renderList`: a compact row per suggestion — name, shadchan, pipeline-state chip
        (reuse `getPipelineStateDef` from `shidduchim/pipelineStates.ts`), redt date (reuse
        `formatRedtDate` from `boardUtils.ts`) — new file
        `src/components/atomic-crm/shidduchim/ShidduchRow.tsx`. **Do not reuse `ShidduchCard`
        as-is** — it is wrapped in `react-dnd`'s `<Draggable>`, which requires a
        `DragDropContext`/`Droppable` ancestor the list view does not have; reuse its utility
        imports (`getMonogram`, `getAvatarIndex`, `formatRedtDate`), not the component itself.
  - [ ] `renderCards`: a non-draggable card grid using the same content as `ShidduchRow`, laid
        out like `SingleCard`'s grid (`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`).
  - [ ] Add a `SortButton` (`fields={["name_en", "redt_date", "pipeline_state"]}`, default
        `{field: "index", order: "ASC"}` — the same order Board renders in, so switching into
        List for the first time shows the same order the user just saw).

- [ ] **Task 5 — Navigation label (AC: 6)**
  - [ ] `layout/navItems.ts`: the `/shidduchim` entry's `labelDefault: "Pipeline"` →
        `"Shidduchim"`, `labelKey: "crm.navigation.pipeline"` → `"crm.navigation.shidduchim"`
        (unregistered in the message catalog either way — resolves via the `_:` fallback,
        matching existing precedent for every other nav label). `tourId` and `icon` are
        unchanged (the tour and the icon both still make sense — Board remains the default
        landing view). `navItems.test.ts`'s path-order assertion does not need to change
        (paths, not labels); if a label-content test is added, it belongs to Story 4.4, which
        rewrites that test file's content assertions wholesale.

- [ ] **Task 6 — Tests (AC: 7)**
  - [ ] `src/components/atomic-crm/shidduchim/ShidduchimViewSwitch.test.tsx`: given a
        `ListContextProvider` fed data + `view=list` in the URL, renders the list sub-view;
        given `view=board` (or absent), renders `ShidduchimListContent`; given an `error`,
        renders the shared error state regardless of `view`.
  - [ ] `shidduchim/pipelineStates.test.ts` and `shidduchim/boardUtils.test.ts` are unaffected
        (no change to the functions they cover) — confirm they still pass unchanged.
  - [ ] `e2e/shidduchim-list-view.spec.ts`: navigate to `/shidduchim?view=list`, assert the
        list renders (not the board); type a search term, switch to `view=board` via the
        control, assert the board's visible cards are filtered to the term; reload on
        `?view=list&single_id=<id>`, assert it opens directly into that single's list.

## Dev Notes

### Why this doesn't use `<EntityList>`

Story 4.1's `EntityList` owns its own `<List>` instance internally. This page already needs
one `<List>` to drive the Kanban board (`filter`, `perPage=200`, `pagination={null}`,
`sort={index}` — all board-specific, pre-existing). Nesting `<EntityList>` — which mounts a
*second*, independently-configured `<List>` — inside that would double-fetch the same
resource with two separate query-param syncs fighting over the same URL keys, which is
exactly the kind of divergence AD-24 exists to prevent. So this story reuses the two
*context-consuming* pieces from 4.1 (`EntityListView`, `useEntityListStatus`) directly under
the page's own single `<List>`, rather than the `<EntityList>` convenience wrapper. This is
the one entity in the epic where that distinction matters; every other retrofitted list
(4.1/4.2) is a plain roster with no competing view, so `<EntityList>` fits them exactly as
designed.

### Why this list is never paginated

Every other `EntityList` consumer pages its data (`ListPagination`). This one does not: Board
and List render the *same* `data` array from the *same* `<List>`, and Board structurally needs
every row (a Kanban column that silently drops rows past page 1 is a correctness bug, not a UX
choice). Rather than have Board and List disagree on how much data is loaded, both share the
existing `perPage={200}`/`pagination={null}` (already true of `ShidduchimList` today) — a
family's per-single suggestion count is bounded by real-world usage, not by dataset size the
way a shadchan's book or the reference book might eventually be. AC-2's "search and sort" still
work; only paging is intentionally absent for this one entity.

### Two different toggles, on purpose

- **Board ⇄ List** (`view` URL param, `useSearchParams`): a page-level mode. It must be
  shareable (a link should be able to say "open the list, not the board") and must not
  silently diverge from whatever else is in the URL — hence a plain URL param, not a
  `useStore`-persisted preference.
- **List ⇄ Cards** (Story 4.2's `useEntityListViewMode`, only meaningful once `view=list`): a
  cross-visit *preference* for how the list sub-view lays out its rows, exactly like every
  other `EntityList` consumer's toggle. It is deliberately **not** put in the URL — persisting
  it in `localStorage` (as 4.2 does) means a user's "I like dense rows" choice follows them
  without needing to be encoded into every link they share.

Do not conflate the two into one control — they answer different questions ("which screen" vs.
"how do I like my rows laid out").

### Architecture

- **UX-DR7 / AD-24**: "Lists render through one `EntityList`" — satisfied here via the shared
  `EntityListView`/`useEntityListStatus` primitives, per the "why this doesn't use
  `<EntityList>`" note above.
- **AD-4**: `transitionShidduch()` remains the sole write path for a state change; this story
  touches only reads (search, the `view` toggle, `single_id` filtering) and does not add a
  second way to move a suggestion between states. The List sub-view is read-only with respect
  to `pipeline_state` — no drag-and-drop, no inline state edit.

### Testing standard

Same stack as Stories 4.1/4.2. `.claude/rules/testing.md` AAA + ≥80% coverage on new files;
`.claude/skills/e2e-conventions` — this story changes filters/search/interactions, so the e2e
spec above is required, not optional.

### Project Structure Notes

`ShidduchimViewSwitch.tsx` and `ShidduchRow.tsx` are new files inside
`src/components/atomic-crm/shidduchim/`, alongside the existing `ShidduchimListContent.tsx`
(Board) they now sit next to. No new top-level directory.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.3 AC text.
- [Source: ARCHITECTURE-SPINE.md#AD-24], [Source: ARCHITECTURE-SPINE.md#AD-4]
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] —
  `EntityListView`/`useEntityListStatus`/the search-hook-naming rule.
- [Source: _bmad-output/implementation-artifacts/4-2-list-cards-toggle.md] —
  `useEntityListViewMode`/`EntityListViewToggle`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
