# Story 4.2: List / Cards toggle

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to choose how a list is displayed,
so that I can scan or browse as suits me.

## Position in Epic 4

**2nd of 5.** Directly extends Story 4.1's `EntityList`/`EntityListView` — it changes their
render contract from a single `renderItems` function to a `renderList`/`renderCards` pair
plus a persisted mode, and adds the toggle control to `EntityListToolbar`'s empty slot. **4.1
must land first**, unmodified in every other respect.

Story 4.3 (Shidduchim list view) depends on this story too: it consumes the
`renderList`/`renderCards`/`viewMode` contract this story gives `EntityListView` (Task 3)
and `EntityListViewToggle`'s visual language for its own Board/List/Cards control.

## Acceptance Criteria

1. **Every list this epic has touched gets both modes.** `SingleList`, `ShadchanList` and
   `ReferenceList` (Story 4.1) each render in both a row-based "List" mode and a grid-based
   "Cards" mode. Today `SingleList`/`ShadchanList` only have Cards and `ReferenceList` only
   has List — each gains the mode it is missing.

2. **One control, one place.** A single `EntityListViewToggle` component renders the same
   two-button control (List icon / Cards icon) in the same position — inside
   `EntityListToolbar`, immediately left of the Create button — on all three lists.

3. **The choice is per-entity and persists.** Switching `ShadchanList` to List mode, then
   navigating to `SingleList` (still shows its last-chosen mode, independently), then back to
   `ShadchanList` (still List), then reloading the page (still List) — the preference is keyed
   per resource and survives navigation and reload.

4. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on
   changed files; a Vitest suite covers `useEntityListViewMode`'s per-resource persistence; an
   e2e spec (`e2e/entity-list-view-toggle.spec.ts`) proves the cross-navigation persistence in
   AC-3.

## Tasks / Subtasks

- [ ] **Task 1 — `useEntityListViewMode` (AC: 3)**
  - [ ] Create `src/components/atomic-crm/misc/useEntityListViewMode.ts`:
        `useEntityListViewMode(resource: string, defaultMode: "list" | "cards")` — a thin
        wrapper over ra-core's `useStore<"list"|"cards">`
        `` (`${resource}.entityListViewMode`, defaultMode)``. `useStore` persists to
        `localStorage` under the app's existing `"CRM"` namespace
        (`root/crmStore.ts` → `localStorageStore(undefined, "CRM")`) — reuse it, do not add a
        second persistence mechanism.
  - [ ] Returns `[mode, setMode]`, same shape as `useState`, so it drops into existing
        component code with no other change.

- [ ] **Task 2 — `EntityListViewToggle` (AC: 2)**
  - [ ] Create `src/components/atomic-crm/misc/EntityListViewToggle.tsx`: two
        `size="icon"` buttons (`LayoutList` for List, `LayoutGrid` for Cards, both from
        `lucide-react`), `variant="secondary"` on the active one, `variant="ghost"` on the
        other, `aria-pressed` set correctly on both for accessibility. Props:
        `{ mode: "list"|"cards"; onChange: (mode: "list"|"cards") => void }` — a controlled
        component; it does not call `useEntityListViewMode` itself, so it can be unit-tested
        without a store.

- [ ] **Task 3 — Extend `EntityList` / `EntityListView` (AC: 1, 2)**
  - [ ] `EntityListView.tsx` (Story 4.1): replace the single `renderItems` prop with
        `renderList: (data) => ReactNode`, `renderCards: (data) => ReactNode`, and
        `viewMode: "list"|"cards"` — `viewMode` is lifted from the parent, never read from
        the store internally, so the component stays a pure function of its props and 4.1's
        unit tests keep passing with a trivial update.
  - [ ] `EntityList.tsx`: call `useEntityListViewMode(resource, defaultViewMode)` (new prop
        `defaultViewMode: "list"|"cards"`), pass `mode`/`renderList`/`renderCards` down to
        `EntityListView`, and render `<EntityListViewToggle mode={mode} onChange={setMode}/>`
        inside `EntityListToolbar` (new toolbar prop `viewToggle?: ReactNode`).

- [ ] **Task 4 — Build the missing renderer per list (AC: 1)**
  - [ ] `SingleList.tsx`: `defaultViewMode="cards"` (unchanged default look); add a "List" mode
        — new `src/components/atomic-crm/singles/SingleRow.tsx`, a compact row (monogram
        avatar via `getMonogram`/`getAvatarIndex` from `shidduchim/boardUtils.ts` — reuse, the
        same helpers `ReferenceRow` already imports cross-entity — name, and the pipeline-count
        chip `SingleCard` already computes). `renderCards` = today's grid over `SingleCard`;
        `renderList` = a `flex flex-col gap-2` stack over `SingleRow`.
  - [ ] `ShadchanList.tsx`: `defaultViewMode="cards"`; add
        `src/components/atomic-crm/shadchanim/ShadchanRow.tsx` mirroring `ShadchanCard`'s data
        (name, location, suggestion count) in row form.
  - [ ] `ReferenceList.tsx`: `defaultViewMode="list"` (unchanged default look); add a "Cards"
        mode — new `src/components/atomic-crm/references/ReferenceCard.tsx`, a grid-card
        version of `ReferenceRow`'s content (monogram, name, relationship/phone/school meta,
        linked-count and open-reminders chips). `renderList` = today's `flex flex-col gap-3`
        stack over `ReferenceRow`; `renderCards` = a
        `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3` over `ReferenceCard` (same grid
        classes `SingleList`/`ShadchanList` already use, for visual consistency).

- [ ] **Task 5 — Tests (AC: 4)**
  - [ ] `src/components/atomic-crm/misc/useEntityListViewMode.test.ts`: setting mode for
        resource `"a"` does not affect resource `"b"`'s stored mode; the value round-trips
        through a fresh hook instance (simulating reload) by re-mounting against the same
        store.
  - [ ] `src/components/atomic-crm/misc/EntityListViewToggle.test.tsx`: clicking each button
        calls `onChange` with the right mode; `aria-pressed` reflects `mode`.
  - [ ] `e2e/entity-list-view-toggle.spec.ts`: the AC-3 cross-navigation + reload sequence,
        against two of the three lists (e.g. Shadchanim and Singles).

## Dev Notes

### Why the default differs per entity

`SingleList`/`ShadchanList` keep Cards as their default (that is their current, only, and
presumably deliberately-designed look — a small family/matchmaker-book roster reads better as
cards than as a dense table); `ReferenceList` keeps List as its default for the same reason.
This story adds the *other* mode as an option, it does not change anyone's first-visit
experience.

### `useStore` persistence, verified

`root/crmStore.ts`: `createCrmStore = () => localStorageStore(undefined, "CRM")`, passed as
the app's `store` prop in `root/CRM.tsx`. Every `useStore` call — this hook included —
persists under that same `"CRM"` localStorage namespace, keyed by the string passed as the
first argument. Using `` `${resource}.entityListViewMode` `` as that key is what makes AC-3's
per-resource independence hold: `"shadchanim.entityListViewMode"` and
`"singles.entityListViewMode"` are simply different keys.

### Architecture

- **UX-DR7 / AD-24**: "one `EntityList`... " — the toggle is exactly the kind of control the
  epic calls out as needing one shared home ("the control sits in the same place with the same
  behaviour everywhere").
- Builds directly on Story 4.1's file layout — no new directories, no new resources.

### Testing standard

Same as Story 4.1: `vitest-browser-react` + `CoreAdminContext`/`ra-data-fakerest` for
integration-flavoured tests; plain hook/unit tests for `useEntityListViewMode` and
`EntityListViewToggle` in isolation. `.claude/rules/testing.md` AAA + ≥80% new-code coverage.

### Project Structure Notes

All new files continue in `src/components/atomic-crm/misc/` (the toggle/hook, cross-entity)
and each entity's own folder (the new Row/Card renderer, entity-specific).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.2 AC text.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — one shared control per concern.
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] — the
  `EntityList`/`EntityListView` contract this story extends.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
