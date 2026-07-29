---
baseline_commit: 9569006
---

# Story 4.2: List / Cards toggle

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to choose how a list is displayed,
so that I can scan or browse as suits me.

## Position in Epic 4

**2nd of 5.** Directly extends Story 4.1's `EntityList` / `EntityListView` — it changes their
render contract from a single `renderItems` function to a `renderList` / `renderCards` pair plus a
persisted mode, and fills `EntityListToolbar`'s `viewToggle` slot. **4.1 must land first**,
unmodified in every other respect.

Story 4.3 depends on this story too: it consumes the `renderList` / `renderCards` / `viewMode`
contract this story gives `EntityListView` (Task 3) and `EntityListViewToggle`'s visual language
for its own three-position Board · List · Cards control.

### Dependencies

- **4.1** — `EntityList`, `EntityListView`, `EntityListToolbar`, and the two retrofitted lists.
- **`root/crmStore.ts`** — `createCrmStore = () => localStorageStore(undefined, CRM_STORE_APP_KEY)`
  where `CRM_STORE_APP_KEY = "CRM"`, passed as the app's `store` prop in `root/CRM.tsx`. Already
  shipped; this story adds no second persistence mechanism.
- **RULING 7** (`entity360/ad24Conformance.ts`'s `NO_BROWSE_SURFACE_ENTITIES`) — `references` has
  no list, so it gets no toggle and no card renderer. See Dev Notes.

## Acceptance Criteria

1. **Both lists this epic has touched get both modes.** `SingleList` and `ShadchanList` (Story
   4.1) each render in a row-based "List" mode and a grid-based "Cards" mode. Today both have
   Cards only — each gains List.
   *Failing looks like:* switching the control leaves the same DOM shape (still a card grid), or
   one of the two lists renders no control at all.

2. **One control, one place.** A single `EntityListViewToggle` component renders the same
   two-button control (List icon / Cards icon) in the same position — inside `EntityListToolbar`,
   immediately left of the create link — on both lists.
   *Failing looks like:* a second toggle implementation exists (`LSP workspaceSymbol` finds more
   than one component rendering `LayoutList`/`LayoutGrid` as a pair), or the control sits in a
   different place on one of the two lists.

3. **The choice is per-entity and persists.** Switching `ShadchanList` to List mode, then
   navigating to `SingleList` (still shows *its* last-chosen mode, independently), then back to
   `ShadchanList` (still List), then reloading the page (still List).
   *Failing looks like:* switching one list's mode changes the other's; or the mode resets on
   reload. The store keys are `"shadchanim.entityListViewMode"` and
   `"singles.entityListViewMode"` — two different keys is *why* the independence holds, and the
   unit test asserts that directly.

4. **`viewMode` is a prop, never a store read inside `EntityListView`.** `EntityListView` stays a
   pure function of its props so 4.1's unit tests keep passing with a trivial update and Story
   4.3 can drive it from a *different* store key (`"shidduchim.pageView"`).
   *Failing looks like:* `grep -n "useStore\|useEntityListViewMode" misc/EntityListView.tsx`
   returns a hit.

5. **AD-23 vocabulary in new user-facing copy.** `ShadchanRow` labels its count **"shidduchim"**
   (singular "shidduch"), never "suggestion(s)". The underlying identifiers — `nb_suggestions`,
   `countSuggestionsByShadchan`, `ShadchanSuggestions.tsx` — are DB/code names and keep theirs.
   *Failing looks like:* `grep -n "suggestion" shadchanim/ShadchanRow.tsx` matches a rendered
   string. (`ShadchanCard.tsx`'s existing `"suggestion"/"suggestions"` label is **Story 5.9's**
   remediation, not this story's — do not fix it here, and do not copy it.)

6. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on
   changed files; a Vitest suite covers `useEntityListViewMode`'s per-resource persistence and
   `EntityListViewToggle`'s controlled behaviour; an e2e spec
   (`e2e/entity-list-view-toggle.spec.ts`) proves the cross-navigation + reload persistence in
   AC-3.

## Tasks / Subtasks

- [x] **Task 1 — `useEntityListViewMode` (AC: 3)**
  - [x] Create `src/components/atomic-crm/misc/useEntityListViewMode.ts`:
        `useEntityListViewMode(resource: string, defaultMode: "list" | "cards")` — a thin wrapper
        over ra-core's `useStore<"list"|"cards">(`${resource}.entityListViewMode`, defaultMode)`.
        `useStore`'s two-argument overload returns `[T, setter]` (no `undefined` in the union)
        when a default is supplied — verified in `node_modules/ra-core/dist/store/useStore.d.ts`.
  - [x] Returns `[mode, setMode]`, same shape as `useState`.

- [x] **Task 2 — `EntityListViewToggle` (AC: 2)**
  - [x] Create `src/components/atomic-crm/misc/EntityListViewToggle.tsx`: two `size="icon"`
        buttons (`LayoutList` for List, `LayoutGrid` for Cards, both from `lucide-react`),
        `variant="secondary"` on the active one, `variant="ghost"` on the other, `aria-pressed`
        set correctly on both, and an accessible name on each (`aria-label` "List view" /
        "Cards view") so the e2e spec can target them by role+name rather than by icon.
  - [x] Props: `{ mode: "list"|"cards"; onChange: (mode: "list"|"cards") => void }` — a
        **controlled** component; it does not call `useEntityListViewMode` itself, so it unit-tests
        without a store.

- [x] **Task 3 — Extend `EntityList` / `EntityListView` / `EntityListToolbar` (AC: 1, 2, 4)**
  - [x] `EntityListView.tsx`: replace the single `renderItems` prop with
        `renderList: (data: RaRecord[]) => ReactNode`, `renderCards: (data: RaRecord[]) => ReactNode`
        and `viewMode: "list"|"cards"`. `viewMode` is lifted from the parent (AC-4).
  - [x] The `skeleton` prop stays a single `ReactNode` — do **not** fork it per mode. Skeletons
        stand in for height, and 4.1's card-grid skeleton is close enough in both modes;
        splitting it doubles the surface for zero measured gain (YAGNI,
        `.claude/rules/coding-style.md`).
  - [x] `EntityList.tsx`: new prop `defaultViewMode: "list"|"cards"`; call
        `useEntityListViewMode(resource, defaultViewMode)`; pass
        `viewMode`/`renderList`/`renderCards` down to `EntityListView`; render
        `<EntityListViewToggle mode={mode} onChange={setMode}/>` into `EntityListToolbar`'s
        `viewToggle?: ReactNode` slot (4.1 left it empty for exactly this).
  - [x] Update 4.1's `EntityListView.test.tsx` / `EntityList.test.tsx` for the renamed props —
        a trivial rename, not a rewrite. If it is not trivial, `viewMode` has leaked into the
        component (AC-4).

- [x] **Task 4 — Build the missing renderer per list (AC: 1, 5)**
  - [x] `SingleList.tsx`: `defaultViewMode="cards"` (unchanged default look); add
        `src/components/atomic-crm/singles/SingleRow.tsx`, a compact row — monogram avatar via
        `getMonogram` / `getAvatarIndex` from **`../entity360/avatar`** (that is where they live;
        `references/ReferenceList.tsx` already imports them from there — do **not** import from
        `shidduchim/boardUtils.ts`), name, and the pipeline-count chip `SingleCard` already
        computes. `renderCards` = today's grid over `SingleCard`; `renderList` = a
        `flex flex-col gap-2` stack over `SingleRow`.
  - [x] `ShadchanList.tsx`: `defaultViewMode="cards"`; add
        `src/components/atomic-crm/shadchanim/ShadchanRow.tsx` mirroring `ShadchanCard`'s data
        (name, location, **shidduch count** — AC-5) in row form.
  - [x] **Both new row components wrap the record mention in `RecordLink`**
        (`entity360/RecordLink.tsx`), exactly as `SingleCard.tsx` and `ShadchanCard.tsx` already
        do. `RecordLink` has **exactly five props** (`resource`, `id`, `children`, `className`,
        `style`) — no `onClick`, no `ref`, no spread. Anything interactive beyond the navigation
        goes on the row's own wrapper element, **outside** the anchor.
  - [x] Neither row component re-implements the data fetch: both receive their record (and the
        enrichment value the list already computed) as props.

- [x] **Task 5 — Tests (AC: 6)**
  - [x] `src/components/atomic-crm/misc/useEntityListViewMode.test.ts`: setting mode for resource
        `"a"` does not affect resource `"b"`'s stored mode; the value round-trips through a fresh
        hook instance (simulating reload) by re-mounting against the same store.
  - [x] `src/components/atomic-crm/misc/EntityListViewToggle.test.tsx`: clicking each button calls
        `onChange` with the right mode; `aria-pressed` reflects `mode`; both buttons have
        accessible names.
  - [x] `src/components/atomic-crm/shadchanim/ShadchanRow.test.tsx`: renders a `RecordLink` whose
        `href` equals `buildRecordPath("shadchanim", id)`, and its count label reads "shidduch" /
        "shidduchim" (AC-5).
  - [x] `e2e/entity-list-view-toggle.spec.ts`: the AC-3 cross-navigation + reload sequence across
        `/shadchanim` and `/singles`, targeting the toggle by role + accessible name.

## Dev Notes

### Why `references` is not here

RULING 7 removed the reference browse surface entirely: `entity360/ad24Conformance.ts` exports
`NO_BROWSE_SURFACE_ENTITIES = { references: … }` and `findNoBrowseSurfaceViolations` reports
`browse-surface-on-scoped-entity` for any file linking `/references` as a list path. There is no
`ReferenceList` for this story to give a Cards mode to, and **`references/ReferenceCard.tsx` is
not built** — that was the largest single line item in this story's earlier draft and it is
deleted, not retargeted. `/references` becomes the unattached-references panel, owned by the
RULING 7 references wave and by no Epic 4 story.

Do not touch `references/` in this story. Needing a path outside the declared set means report
and stop — a successful outcome (`.claude/rules/parallel-ownership.md`).

### Why the default is Cards on both lists

`SingleList` / `ShadchanList` keep Cards as their default — that is their current, only, and
deliberately-designed look; a small family/matchmaker-book roster reads better as cards than as a
dense table. This story adds the *other* mode as an option; it does not change anyone's
first-visit experience. (The earlier draft justified a `defaultViewMode="list"` for
`ReferenceList`; that clause is gone with the list.)

### `useStore` persistence, verified

`root/crmStore.ts`: `createCrmStore = () => localStorageStore(undefined, CRM_STORE_APP_KEY)` with
`CRM_STORE_APP_KEY = "CRM"`, passed as the app's `store` prop in `root/CRM.tsx`. Every `useStore` call — this hook included — persists under
that same `"CRM"` localStorage namespace, keyed by the string passed as the first argument. Using
`` `${resource}.entityListViewMode` `` as that key is what makes AC-3's per-resource independence
hold: `"shadchanim.entityListViewMode"` and `"singles.entityListViewMode"` are simply different
keys. Story 4.3 uses a **third**, deliberately different key (`"shidduchim.pageView"`) because
that page's control has three positions, not two — see 4.3.

### The route table is untouched

Same as 4.1 AC-9, and for the same reason: this story changes what the `list` component
*renders*, never how it is *registered*. `singles/index.ts` and `shadchanim/index.ts` keep their
`{ list, edit, show, hasCreate, children: buildCreateRoutes(...) }` default export; both already
register real `show`/`edit` components, so `Resource.registerResource` computes `hasShow`/`hasEdit`
as `true` and no `record-flags-missing` violation can fire. `buildEntityRoutes` / `EntityShow`
belong to Epic 5's migration stories (5.8 / 5.9), not here. Neither `<entity>/index.ts` appears in
this story's File List.

### Architecture

- **UX-DR7 / AD-24**: "one `EntityList` ... one shared control per concern" — the toggle is
  exactly the kind of control the epic calls out as needing one shared home ("the control sits in
  the same place with the same behaviour everywhere").
- **AD-24 / UX-DR6**: every record mention routes through `RecordLink` — including a list row.
  Both new row components obey it (Task 4), and the closed five-prop signature is why any drag
  handle, click guard or ref goes on a wrapper outside the anchor.
- Builds directly on Story 4.1's file layout — no new directories, no new resources, no provider
  changes.

### Ownership hazards (declare before dispatch)

| Shared artefact | Also edited by | Handling |
|---|---|---|
| `misc/EntityListView.tsx`, `misc/EntityList.tsx`, `misc/EntityListToolbar.tsx` | 4.1 creates them, this story rewrites their render contract | Strictly sequential after 4.1. 4.3 then consumes the *post*-4.2 contract. |
| `singles/SingleList.tsx`, `shadchanim/ShadchanList.tsx` | 4.1 | Same. |
| `registry.json` | any story adding a file under `src/components/atomic-crm/**` | Two new files here; regenerated by the pre-commit hook. Commit on a quiet tree. |

### Testing standard

Same as Story 4.1: `vitest-browser-react` (real Chromium) + `CoreAdminContext` /
`ra-data-fakerest` for integration-flavoured tests, `TestMemoryRouter` for routing. **React
Testing Library is not a dependency** — do not import it. Plain hook/unit tests for
`useEntityListViewMode` and `EntityListViewToggle` in isolation. `.claude/rules/testing.md` AAA +
≥80% new-code coverage.

### Project Structure Notes

New cross-entity files continue in `src/components/atomic-crm/misc/` (the toggle and the hook);
the two new Row renderers live in their entity's own folder.

### Files this story will touch

```
src/components/atomic-crm/misc/useEntityListViewMode.ts          (new)
src/components/atomic-crm/misc/useEntityListViewMode.test.ts     (new)
src/components/atomic-crm/misc/EntityListViewToggle.tsx          (new)
src/components/atomic-crm/misc/EntityListViewToggle.test.tsx     (new)
src/components/atomic-crm/misc/EntityListView.tsx                (render contract)
src/components/atomic-crm/misc/EntityListView.test.tsx           (prop rename)
src/components/atomic-crm/misc/EntityList.tsx                    (defaultViewMode + toggle)
src/components/atomic-crm/misc/EntityList.test.tsx               (prop rename)
src/components/atomic-crm/misc/EntityListToolbar.tsx             (viewToggle slot filled)
src/components/atomic-crm/singles/SingleRow.tsx                  (new)
src/components/atomic-crm/singles/SingleList.tsx                 (renderList/renderCards)
src/components/atomic-crm/shadchanim/ShadchanRow.tsx             (new)
src/components/atomic-crm/shadchanim/ShadchanRow.test.tsx        (new)
src/components/atomic-crm/shadchanim/ShadchanList.tsx            (renderList/renderCards)
e2e/entity-list-view-toggle.spec.ts                              (new)
registry.json                                                    (regenerated)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.2 AC text ("the control
  sits in the same place with the same behaviour everywhere ... my choice persists per entity").
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — one shared control per concern; every record mention through one `RecordLink`.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §7 "`RecordLink`" rules 0 and 5
  — exactly five props, and a **list row** is one of the six named mention sites.
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] — the
  `EntityList` / `EntityListView` / `EntityListToolbar` contract this story extends.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts] — `NO_BROWSE_SURFACE_ENTITIES`
  (why `references` is absent).
- [Source: src/components/atomic-crm/entity360/avatar.ts] — `getMonogram` / `getAvatarIndex`.
- [Source: node_modules/ra-core/dist/store/useStore.d.ts] — the two `useStore` overloads.
- [Source: .claude/rules/testing.md], [Source: .claude/skills/e2e-conventions/SKILL.md],
  [Source: .claude/rules/parallel-ownership.md], [Source: .claude/rules/coding-style.md]

### Inherited from the loose-ends round (commit `af2074e`)

The Epic 1–3 loose-ends round ran in parallel with Epic 4 on `main`. One finding fell inside this
story's reach, so the round reported and stopped rather than taking it
(`.claude/rules/parallel-ownership.md`, "Out-of-scope work is reported, not taken").

**`shadchanim/ShadchanCard.tsx:34, :46, :69`** — three UI defects from the round's item I. The
round's own note is that `:69` is the one it most wanted to take and the one it was most confident
should wait: **`:69`'s `whitespace-nowrap` is the product's only real horizontal overflow**, measured
at `scrollWidth 799` in a 768px viewport, i.e. the page scrolls sideways on a tablet. It was
deferred here because two Epic 4 stories name this file (this one at `:66`, `:121`, `:124`, and
4-1 at `:124`) even though neither declares it in its manifest entry — an undeclared reach, which
is precisely the indirect-overlap class the pre-dispatch checker cannot see.

Fix all three while you have the file open. If this story's card work replaces
`ShadchanCard.tsx` outright, the overflow must not be reintroduced in its successor — carry a test
for it, because nothing in the tree currently asserts the page does not scroll horizontally.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-sonnet-5 for this dispatch — STACK_ID=3 / STACK_OWNER=4-2)

### Debug Log References

- `npm run typecheck` — clean (tsconfig.app.json / tsconfig.workers.json / tsconfig.node.json).
- `npm run lint` — clean (`--max-warnings=0`).
- `npx prettier --config ./.prettierrc.json --check "**/*.{mjs,js,json,ts,tsx,css,md,html}"` — clean.
- `STACK_ID=3 npx vitest run` (all projects) — 152 passed | 13 skipped (1268 tests passed, 0 failed).
- `make test STACK_ID=3` — same result (db project self-skips: no local Supabase running for this dispatch).
- `make build` — succeeds (`tsc && vite build`).
- CI guards run directly: `check-retired-names.mjs`, `check-suppressions.mjs`,
  `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs` — all OK. `check-wave-ownership.mjs`
  requires a wave manifest this single-story dispatch does not have (it is the
  orchestrator's pre-dispatch/post-wave tool); not run for that reason — path
  ownership was instead respected manually per the dispatch's declared-paths list.
- AC falsification checks re-verified directly: `grep -n "useStore\|useEntityListViewMode"
  misc/EntityListView.tsx` → no match (AC-4); `grep -rln "LayoutList\|LayoutGrid" src/` →
  only `EntityListViewToggle.tsx` (AC-2).

### Completion Notes List

- Task 1: `useEntityListViewMode(resource, defaultMode)` — thin wrapper over ra-core's
  `useStore<"list"|"cards">(`${resource}.entityListViewMode`, defaultMode)`, returning
  `[mode, setMode]`. Unit-tested (`useEntityListViewMode.test.ts`) with an explicit
  `memoryStore()` shared across separate `render()` calls, proving both per-resource
  isolation and reload-safe round-tripping (a fresh mount against the same store).
- Task 2: `EntityListViewToggle` — controlled two-button segmented control
  (`LayoutList`/`LayoutGrid`, `secondary`/`ghost` variants, `aria-pressed`, translated
  `aria-label`s under new `crm.entity_list.view_list`/`view_cards` catalog keys). Does not
  call the persistence hook itself; unit-tested standalone against a translate-only context.
- Task 3: `EntityListView` now takes `renderList`/`renderCards`/`viewMode` (bare
  `"list"|"cards"` union, not imported from the hook's module, to keep AC-4's falsification
  grep clean) instead of `renderItems`. `EntityList` gained `defaultViewMode`, calls the new
  hook, and renders `<EntityListViewToggle>` into `EntityListToolbar`'s pre-existing
  `viewToggle` slot (no change needed to `EntityListToolbar`'s render logic — its slot
  already existed from 4.1; only its stale doc comment was updated). 4.1's two test files
  updated for the renamed props (trivial rename) plus one new integration test proving the
  toggle actually switches which render function fires.
- Task 4: `SingleRow.tsx` / `ShadchanRow.tsx` added — both wrapped in `RecordLink` (five
  closed props only), monogram avatar via `entity360/avatar.ts`. `SingleList.tsx` /
  `ShadchanList.tsx` each gained a small local `*RowList` component that mirrors their
  existing `*CardGrid`'s own self-contained enrichment fetch (`singles_summary` /
  `shidduchim`) rather than sharing state through props — the row components themselves
  never fetch. `ShadchanRow`'s count is rendered via a new i18n key
  (`crm.shadchanim.row.shidduchimCount`, real singular/plural via `smart_count` +
  `||||`), never the "suggestion(s)" wording `ShadchanCard.tsx` still carries (that is
  Story 5.9's remediation, explicitly not this story's per the story's own AC-5 note).
  `ShadchanRow` also avoids reintroducing `ShadchanCard.tsx`'s known horizontal-overflow
  defect (`min-w-0 truncate` on the name/location column, `shrink-0` on the count chip,
  no `whitespace-nowrap` anywhere) — noted in its own doc comment as the reason.
- Task 5: all four named tests written, plus `SingleRow.test.tsx` (not named by the story's
  own Task 5, but required by `.claude/rules/testing.md`'s 80%-new-code floor per the
  dispatch instructions, since `SingleRow.tsx` is just as new as `ShadchanRow.tsx`).
- **Out of declared scope, reported and not touched**: `shadchanim/ShadchanCard.tsx` (its
  `:34`/`:46`/`:69` defects, including the real horizontal-overflow bug at `:69` the story's
  Dev Notes ask this story to fix "while you have the file open") — this file is **not** in
  this dispatch's declared path list, so per `.claude/rules/parallel-ownership.md` it is
  reported rather than edited. `references/**`, `singles/index.ts`, `shadchanim/index.ts` —
  confirmed untouched, exactly as the dispatch instructed.
- All verification gates green: `make typecheck`, `npm run lint`, `npx vitest run` (whole
  repo, 152 files / 1268 tests), `make build`, `npx prettier --check .`, `make test
  STACK_ID=3`, and the four runnable CI guards. No SQL touched, so no migration diff was
  generated. The e2e spec (`e2e/entity-list-view-toggle.spec.ts`) was written per Task 5 but
  not executed against a live stack in this dispatch (no `make start-supabase-e2e` /
  `make start-app-e2e` stack was started for it).

### File List

- `src/components/atomic-crm/misc/useEntityListViewMode.ts` (new)
- `src/components/atomic-crm/misc/useEntityListViewMode.test.ts` (new)
- `src/components/atomic-crm/misc/EntityListViewToggle.tsx` (new)
- `src/components/atomic-crm/misc/EntityListViewToggle.test.tsx` (new)
- `src/components/atomic-crm/misc/EntityListView.tsx` (render contract: `renderItems` →
  `renderList`/`renderCards`/`viewMode`)
- `src/components/atomic-crm/misc/EntityListView.test.tsx` (updated for the renamed props +
  new viewMode-branch coverage)
- `src/components/atomic-crm/misc/EntityList.tsx` (`defaultViewMode` prop, wires the
  persistence hook and the toggle)
- `src/components/atomic-crm/misc/EntityList.test.tsx` (updated for the renamed props + new
  toggle-wiring integration test)
- `src/components/atomic-crm/misc/EntityListToolbar.tsx` (doc-comment only — the
  `viewToggle` slot itself was unchanged, already built in 4.1)
- `src/components/atomic-crm/singles/SingleRow.tsx` (new)
- `src/components/atomic-crm/singles/SingleRow.test.tsx` (new)
- `src/components/atomic-crm/singles/SingleList.tsx` (`renderList`/`renderCards`,
  `defaultViewMode="cards"`)
- `src/components/atomic-crm/shadchanim/ShadchanRow.tsx` (new)
- `src/components/atomic-crm/shadchanim/ShadchanRow.test.tsx` (new)
- `src/components/atomic-crm/shadchanim/ShadchanList.tsx` (`renderList`/`renderCards`,
  `defaultViewMode="cards"`)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (new
  `crm.entity_list.view_list`/`view_cards`, `crm.shadchanim.row.shidduchimCount`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (same two additions,
  French)
- `e2e/entity-list-view-toggle.spec.ts` (new)
- `registry.json` (regenerated by the pre-commit hook)

### Change Log

- 2026-07-29: Story implemented (all 5 tasks, all ACs) and committed at `939c317` via
  `make commit`. Status moved `ready-for-dev` → `review`.
