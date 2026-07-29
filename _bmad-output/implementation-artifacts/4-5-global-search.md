---
baseline_commit: 5b934cf72d23a60b4b67095d66741d336e3a03c7
---

# Story 4.5: Global search

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want one search across everything,
so that I can find a person without knowing their type.

## Position in Epic 4

**5th (last) of 5.** Depends on:

- **Story 4.1** — reuses its `applyFullTextSearch` per-resource search hooks (`singles`,
  `shadchanim`) rather than writing new search logic, and its dead-hook naming rule.
- **Story 4.3** — the `shidduchim` search hook this story's fan-out depends on.
- **Story 4.4** — the `MoreButton` dropdown this story inserts a "Search" item into, and the
  `TopBar` it adds a search button to. 4.4 must land first (it rewrites both).
- **Epic 3 Story 3.9 (`RecordLink`)** — shipped. Every result renders as a `RecordLink`, per AD-24
  and contract §7 rule 5, which names "search result" as one of the six mention sites.
- **RULING 7** (`entity360/ad24Conformance.ts`'s `NO_BROWSE_SURFACE_ENTITIES`) — references have
  **no global-search results**. This is the one story in Epic 4 whose scope the ruling *shrinks*
  rather than merely constrains.

## Acceptance Criteria

1. **One search reaches everywhere.** Desktop: a search icon button in `layout/TopBar.tsx` plus a
   `(Cmd|Ctrl)+K` shortcut, available on every screen. Mobile: a "Search" item at the top of the
   bottom bar's "More" menu (`layout/MobileNavigation.tsx`) — the bottom bar is the only chrome
   present on *every* mobile screen (`MobileHeader` is a per-page wrapper the list pages do not
   render). Every trigger opens the same overlay instance.
   *Failing looks like:* `Cmd+K` fires twice (two `GlobalSearch` instances mounted), or the mobile
   overlay cannot be opened from a list screen.

2. **Results span exactly three entities**: `singles`, `shidduchim`, `shadchanim` — grouped by
   type, each row rendered as a `RecordLink` routing to that record's own page.
   *Failing looks like:* `grep -n "references" misc/useGlobalSearch.ts misc/GlobalSearch.tsx`
   returns a hit. **`references` is excluded by RULING 7** (see Dev Notes "Why references is not
   searchable"). Epic 8 adds shadchanus-context entities later — flagged in Dev Notes as that
   epic's follow-up, not built here.

3. **Every result row exposes the descriptor-built href.** Each rendered result's anchor `href`
   equals `buildRecordPath(resource, id)` (`entity360/entityPaths.ts`), which delegates to the
   entity's own `descriptor.buildRecordPath`. No hand-written `/x/${id}` template literal, and no
   `useCreatePath({ type: "show" })`.
   *Failing looks like:* a unit test asserting the href finds `undefined`, or finds a path that
   does not change when a descriptor's `buildRecordPath` changes. This is what makes Epic 5's
   one-line route flips propagate here for free.

4. **Results never cross a context or account boundary.** Searching while a household context is
   active returns only that household's rows, even if another account has a same-named record.
   *Failing looks like:* the negative SQL test in Task 5 returns account B's row when
   authenticated as account A.

5. **A short query does nothing expensive.** Fewer than 2 characters triggers no data-provider
   call; typing is debounced (300ms) before the fan-out fires.
   *Failing looks like:* a provider spy records a `getList` for a 1-character query, or records
   more than one fan-out for a burst of keystrokes inside 300ms.

6. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on changed
   files; a Vitest suite covers the fan-out/merge logic, the href contract (AC-3) and the
   debounce/minimum-length guard; **a negative test** (Dev Notes "The negative test this story
   owns") proves cross-account isolation of the search surface itself, run via
   `npm run test:unit:db` against the local Supabase stack per
   `.claude/rules/security-triggers.md`; an e2e spec (`e2e/global-search.spec.ts`) covers
   AC-1/AC-2/AC-5.

## Tasks / Subtasks

- [x] **Task 1 — `useGlobalSearch` (AC: 2, 3, 4, 5)**
  - [x] Create `src/components/atomic-crm/misc/useGlobalSearch.ts`: given the (debounced) query, a
        `Promise.all` of **three**
        `dataProvider.getList(resource, { filter: { q: query }, pagination: { page: 1, perPage: 5 }, sort })`
        calls — `"singles"` (sort `first_name_en ASC`), `"shidduchim"` (`name_en`), `"shadchanim"`
        (`name`) — via `useDataProvider<CrmDataProvider>()`, reusing the exact search hooks
        Stories 4.1/4.3 already wired.
  - [x] **Why a hook over `useDataProvider()` rather than a dataProvider custom method —
        load-bearing, do not "improve" it back:** the `q` → `@or` search hooks are applied by
        `withLifecycleCallbacks`, which wraps the object `getDataProviderWithCustomMethods()`
        returns. A custom method calling `this.getList(...)` runs *inside* that wrapper, so the
        hooks would never fire and the raw `q` would 400 against PostgREST — the same dead-hook
        trap 4.1's Dev Notes document. `useDataProvider()` hands out the fully wrapped provider,
        so this fan-out takes exactly the `getList` path every list screen uses.
  - [x] Guard: `query.trim().length < 2` resolves an empty result **with all three group keys
        present as empty arrays** — not omitted keys — and calls `getList` zero times (AC-5).
  - [x] Map each resource's rows to
        `{ resource: "singles"|"shidduchim"|"shadchanim"; id: Identifier; label_en: string;
        label_he?: string|null; subtitle?: string|null }`:
        `singles` → `first_name_en`/`last_name_en` (+ `_he`);
        `shidduchim` (served by its existing `shidduchim_summary` redirect) → `name_en`/`name_he`,
        subtitle = `shadchan_name`;
        `shadchanim` → `name`/`name_he`, subtitle = `location`.
        Add the `GlobalSearchResult` type to `types.ts`. Its `resource` field is a **closed union
        of the three**, so adding a fourth is a typecheck event, not a silent widening.
  - [x] **Do not resolve paths in this hook.** Paths come from `buildRecordPath` at render time
        via `RecordLink`, which reads the descriptor. A path baked into the result object would
        freeze Epic 5's route flips out.
  - [x] Nothing to mirror in FakeRest (AD-10): no provider file changes at all — both providers
        already serve `q` through `getList` (Supabase via 4.1/4.3's hooks, FakeRest generically).

- [x] **Task 2 — Debounce (AC: 5)**
  - [x] In the UI component (Task 3), hold the raw input in local state and derive a debounced
        query via a 300ms `setTimeout` in a `useEffect` (cleanup clears the pending timeout on
        each keystroke) — no new dependency; `lodash` is already installed and used in this
        codebase (`filter-form.tsx`, `ShidduchimListContent.tsx`) if a ready-made debounce is
        preferred over the inline `setTimeout`.

- [x] **Task 3 — `GlobalSearch` UI (AC: 1, 2, 3)**
  - [x] Create `src/components/atomic-crm/misc/GlobalSearch.tsx`: a `CommandDialog` (reuse
        `@/components/ui/command.tsx`, installed over the existing `cmdk` dependency; its
        `CommandDialog` export has no consumer today — do not add a new command-palette library).
        Also export a small `GlobalSearchProvider` + `useGlobalSearchDialog()` context exposing
        `open()`, so any chrome trigger can open the shell's single dialog instance. The dialog
        owns the `(Cmd|Ctrl)+K` `keydown` listener on `document`, cleaned up on unmount.
  - [x] On query change (debounced), calls `useGlobalSearch` (Task 1) — no React Query wiring
        needed; this is a one-shot, cancel-on-close fetch, not cached list state.
  - [x] Renders one `CommandGroup` per resource with a translated heading
        (`resources.<resource>.name`). **Each result row is
        `<CommandItem asChild …><RecordLink resource={…} id={…}>…</RecordLink></CommandItem>`** —
        `cmdk`'s `Item` accepts `asChild` (verified: `node_modules/cmdk/dist/index.d.ts`,
        cmdk 1.1.1), and our `CommandItem` wrapper types its props as
        `React.ComponentProps<typeof CommandPrimitive.Item>`, so `asChild` passes through and
        typechecks. This is what satisfies AC-3: the anchor is the row.
        **`RecordLink` has exactly five props** (`resource`, `id`, `children`, `className`,
        `style`) — **no `onClick`, no `ref`, no spread** (contract §7 rule 0). Closing the dialog
        on selection therefore goes on `CommandItem`'s own `onSelect`, or on an ancestor's
        capture-phase click handler — never as a prop on `RecordLink`.
        *If `asChild` turns out not to compose with `cmdk`'s keyboard `onSelect`,* the fallback is
        `CommandItem onSelect={() => { close(); navigate(buildRecordPath(resource, id)); }}` with
        the `RecordLink` still rendered as the visible row — and the Task 5 test must then also
        assert exactly **one** navigation per activation (mouse and keyboard).
  - [x] Empty/loading/no-results states inside the dialog: a subtle `Loader` while awaiting the
        fan-out, "No results" when the debounced query is non-empty and all three groups came back
        empty, and a hint ("Search singles, shidduchim, shadchanim…") when the query is empty.
        Note the hint string is a **user-facing list of what is searchable** — it must not name
        references (AC-2).

- [x] **Task 4 — Mount it (AC: 1)**
  - [x] One `GlobalSearch` instance per shell: `layout/Layout.tsx` (desktop) and
        `layout/MobileLayout.tsx` (mobile) each render `GlobalSearchProvider` + `<GlobalSearch/>`
        once. The shells are mutually exclusive (`root/CRM.tsx` picks by `useIsMobile`), so the
        `Cmd+K` listener cannot double-fire.
  - [x] `layout/TopBar.tsx`: a search icon button alongside `ThemeModeToggle`/`RefreshButton`
        calling `useGlobalSearchDialog().open()`. **Do not disturb the `ContextSwitcher` pill or
        `SingleSwitcherPill`** — Story 4.4 AC-6 asserts on the pill's presence in this file.
  - [x] `layout/MobileNavigation.tsx`: a "Search" `DropdownMenuItem` at the **top** of
        `MoreButton`'s dropdown calling the same `open()` — mobile has no keyboard shortcut, so
        this is the only trigger there. 4.4 restructured this dropdown (Inbox, Tasks, Reminders,
        Settings, separator, context items, separator, theme items); insert above Inbox and leave
        the rest alone.

- [x] **Task 5 — Tests (AC: 6)**
  - [x] `src/components/atomic-crm/misc/useGlobalSearch.test.ts` (wrap with `CoreAdminContext` +
        `ra-data-fakerest`, the pattern in `tasks/TasksListFilter.test.tsx`): a query of length < 2
        resolves three empty groups and calls `getList` zero times (spy on the provider); a query
        matching rows across all three resources returns three populated groups; a query matching
        only one resource returns the other two as **empty arrays, not omitted keys**.
  - [x] `src/components/atomic-crm/misc/GlobalSearch.test.tsx`: debounce timing (fake timers —
        no fetch before 300ms, exactly one after); Escape closes the dialog; **AC-3** — a rendered
        result row's `href` equals `buildRecordPath(resource, id)` for each of the three
        resources; selecting a result navigates exactly once and closes the dialog.
  - [x] **The negative test this story owns** (see Dev Notes) in `supabase/tests/global_search.sql`
        + `supabase/tests/global_search.test.ts` — the repo's convention is a `.sql` file emitting
        one JSON row per check and a sibling `.test.ts` that shells out to `psql` and turns each
        into a named test (`supabase/tests/dbSuiteHelpers.ts`; see `references_entity.test.ts` for
        the exact shape, including its `bailIfDbUnreachable` skip). Seed two accounts, each with a
        `singles` row, a `shidduchim` row and a `shadchanim` row sharing one distinctive term (e.g.
        `"Zzyx"`); assert that, authenticated as account A, each of the three underlying
        `getList`-equivalent queries the fan-out issues (`singles`, `shidduchim_summary`,
        `shadchanim`, filtered by that term) returns **only** account A's row. Run under
        `npm run test:unit:db` (needs `make start`; prefix every `npx supabase` call with
        `DBUS_SESSION_BUS_ADDRESS=/dev/null`).
  - [x] `e2e/global-search.spec.ts`: open via the desktop icon and via `Cmd/Ctrl+K`, and on a
        mobile viewport via the "More" menu's Search item; type a known single's name; assert a
        grouped result appears and clicking it navigates to that single's page; type one
        character and assert no loading state appears.

## Dev Notes

### Why references is not searchable

`entity360/ad24Conformance.ts`'s `NO_BROWSE_SURFACE_ENTITIES` records the owner's standing
RULING 7 and names search explicitly: a reference *"has no nav entry, no list, no dashboard tile,
no tour step **and no global-search results**"*. `epics.md` states the same for Story 5.10:
references are reached from a shidduch's diligence — *"never from navigation, a list or search"*.

The reasoning, so nobody re-litigates it as an oversight: a 2-character query returning a paged
roster of references the user did not name **is** enumeration with a search box in front of it.
Reference discovery is already served, in the right context, by match-on-entry
(`references/useReferenceMatch.ts` + `ReferenceMatchPanel`) inside the shidduch-scoped create
flow, and the recovery path for a reference with no shidduch is the unattached-references panel at
`/references` (owned by the RULING 7 references wave).

Concretely this story drops references from: the fan-out, the result mapping, the
`GlobalSearchResult` union, the empty-state hint string, and the `supabase/tests/global_search.sql`
seed. Four resources became three. `amendment-a2.md`'s UX-DR8 still says "reachable ... from
search"; it predates the ruling and is the weaker text. Where they disagree, the shipped table
wins.

### The negative test this story owns

This story adds no new RLS policy — the fan-out runs over `getList` against tables/views that
already carry `FORCE ROW LEVEL SECURITY` (AD-1) and already have their own isolation tests. What
it *does* add is a new aggregate code path that could, through a mundane implementation mistake,
undermine that isolation without touching a single RLS policy — for example, hitting a resource
name that bypasses the intended search hook, or (worse) using a service-role client for the
fan-out instead of the caller's own authenticated session.
`.claude/rules/security-triggers.md`'s instruction to dispatch a security review "when in doubt"
on anything touching database queries applies squarely here, even though no file in
`supabase/schemas/` changes. The negative test exists to prove the fan-out itself is safe, not to
re-prove RLS other stories already cover.

### Why no new Postgres function

A tempting alternative is one `search_records(query text)` SQL function unioning all sources
server-side, for a single round trip instead of three. Deliberately not done: a `SECURITY DEFINER`
function bypasses RLS by design and would need to hand-reconstruct the account/context scoping
AD-1 already gives every table for free; a `SECURITY INVOKER` function gains little over three
ordinary `getList` calls the app already knows how to make safely. Reusing the dataProvider seam
(AD-10) is simpler, safer, and consistent with how every other cross-cutting read in this codebase
is built.

### Why a command dialog, not a `/search` route

AD-24 says records live at URLs, not modals — but that governs *record* pages, not a transient
utility overlay with no persistent state of its own. "Search from anywhere" is best served by an
always-available overlay rather than a navigation to a dedicated page and back; this mirrors the
standard command-palette pattern the app already ships a primitive for (`CommandDialog` over
`cmdk`). Note that Story 3-13's `recordSurfaceDialogs.guard.test.ts` polices *record surfaces* in
dialogs, not utility overlays — this component is not in its scope, and adding it would be wrong.

### The route table is untouched

This story adds no routes and registers nothing. It **consumes** the route table: every result's
href comes from `buildRecordPath` → `requireEntityDescriptor` → the entity's own descriptor
(AC-3). No `<entity>/index.ts`, no `buildEntityRoutes`, no `hasShow`/`hasEdit`, no
`root/routeManifest.ts` edit. Three of the seven registered resources deliberately have no
descriptor (`ad24Conformance.ts`'s `DESCRIPTORLESS_RESOURCES`: `tasks`, `inbox_items`, `members`)
and none of the three is searched here — but note that `RecordLink` degrades to an inert `<span>`
plus one `console.error` for an unregistered resource rather than throwing, so a future widening
fails visibly and safely rather than blanking the dialog.

### Scope: three resources, for now

`singles`, `shidduchim`, `shadchanim` are every searchable **browsable** entity that exists by the
end of this epic. Epic 8 ("Shadchan Context") adds shadchanus-context entities (connections,
shadchan-originated redts) that a shadchan will eventually want to find via this same search — that
epic must extend `useGlobalSearch`'s resource list, the `GlobalSearchResult` union and the result
mapping when it lands. Flagged here as a forward dependency, not built now, since those resources
and their RLS do not exist yet.

### Architecture

- **AD-1 / AD-19**: no client-suppliable scope parameter exists anywhere in the fan-out —
  `current_context_id()` is server-held, never a client value. This is the property that makes
  AC-4 hold structurally, not by convention.
- **AD-24 (via Story 3.9)**: every result is a `RecordLink`; no ad-hoc `<Link>` in this component.
  Contract §7 rule 5 names "search result" as one of the six mention sites and rule 0 closes the
  prop list at five.
- **AD-10**: all reads go through the dataProvider's existing `getList` path — no new seam,
  nothing to mirror in FakeRest.

### Ownership hazards (declare before dispatch)

| Shared artefact | Also edited by | Handling |
|---|---|---|
| `layout/MobileNavigation.tsx` (`MoreButton`) | 4.4 (rewrites the dropdown) | Sequential, 4.4 first; insert above Inbox and change nothing else. |
| `layout/TopBar.tsx` | 4.4 (AC-6 asserts the `ContextSwitcher` pill renders here) | Add beside the toggles; do not move the pill. |
| `types.ts` | 4-5, plus most of Epic 3 part 2 and six Epic 5 stories | One appended type. Serialise within the epic; append, never reorganise. |
| `supabase/tests/` + the local stack | every DB-touching story | `npm run test:unit:db` reaches the **shared** local database. Hold the stack lease; do not run concurrently with another agent's `supabase db diff` or `migration up`. |
| e2e stack | every story with a spec | Host-global singleton. One `STACK_ID` (1-6, never 0) plus `STACK_OWNER`; stop it afterwards. |

### Testing standard

`vitest-browser-react` in real Chromium with `TestMemoryRouter`; **React Testing Library is not a
dependency** — do not import it. `.claude/rules/testing.md` AAA + ≥80% coverage.
`.claude/rules/security-triggers.md` — database queries touched, so the negative test above is
required regardless of the "no new RLS" fact, and a security review is dispatched on this diff.
`.claude/skills/e2e-conventions` — search/interaction UI, e2e spec required; deterministic waits
only, never `waitForTimeout`.

### Project Structure Notes

`GlobalSearch.tsx` and `useGlobalSearch.ts` live in `src/components/atomic-crm/misc/`
(cross-entity, like `EntityList`). Neither provider file changes. The new DB test follows the
existing `supabase/tests/<name>.sql` + `<name>.test.ts` pair convention.

### Files this story will touch

```
src/components/atomic-crm/misc/useGlobalSearch.ts          (new)
src/components/atomic-crm/misc/useGlobalSearch.test.ts     (new)
src/components/atomic-crm/misc/GlobalSearch.tsx            (new)
src/components/atomic-crm/misc/GlobalSearch.test.tsx       (new)
src/components/atomic-crm/types.ts                         (GlobalSearchResult, appended)
src/components/atomic-crm/layout/Layout.tsx                (provider + one instance)
src/components/atomic-crm/layout/MobileLayout.tsx          (provider + one instance)
src/components/atomic-crm/layout/TopBar.tsx                (search button)
src/components/atomic-crm/layout/MobileNavigation.tsx      (Search item, top of More)
supabase/tests/global_search.sql                           (new)
supabase/tests/global_search.test.ts                       (new)
e2e/global-search.spec.ts                                  (new)
registry.json                                              (regenerated)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.5 AC text ("results span
  entities and render as `RecordLink`s"; "results never cross a context or account boundary").
- [Source: _bmad-output/planning-artifacts/epics.md] — the RULING 7 block, and Epic 5 Story 5.10's
  AC: references are reached from a shidduch's diligence, *"never from navigation, a list or
  search"*.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1]
  — every domain row scoped by exactly one axis, `FORCE ROW LEVEL SECURITY`, `security_invoker`
  views.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-19]
  — the active context is a server-side row, not a client claim.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10]
  — the dataProvider is the single CRUD seam.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — every record mention through one `RecordLink`.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §7 "`RecordLink`" rules 0, 2
  and 5 — five closed props; unregistered resource degrades to an inert `<span>`; "search result"
  is a mention site.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §4 "Path builders" — all five
  go through `requireEntityDescriptor`, which is why AC-3 makes Epic 5's flips free.
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] — the
  `applyFullTextSearch` hooks this story fans out over, and the dead-hook trap.
- [Source: _bmad-output/implementation-artifacts/4-3-shidduchim-list-view.md] — the `shidduchim`
  search hook.
- [Source: _bmad-output/implementation-artifacts/4-4-navigation-set-and-context-switcher.md] —
  the `MoreButton` dropdown and `TopBar` this story extends.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts] —
  `NO_BROWSE_SURFACE_ENTITIES` ("no global-search results"), `DESCRIPTORLESS_RESOURCES`.
- [Source: supabase/tests/references_entity.test.ts] + [Source: supabase/tests/dbSuiteHelpers.ts]
  — the `.sql` + `.test.ts` pair convention Task 5 follows.
- [Source: node_modules/cmdk/dist/index.d.ts] — `Item` accepts `asChild` (cmdk 1.1.1).
- [Source: .claude/rules/security-triggers.md], [Source: .claude/rules/testing.md],
  [Source: .claude/skills/e2e-conventions/SKILL.md], [Source: .claude/rules/parallel-ownership.md]

### Inherited from the loose-ends round (commit `af2074e`)

The Epic 1–3 loose-ends round ran in parallel with Epic 4 on `main`. Two findings fell inside this
story's declared paths, so it reported and stopped rather than taking them
(`.claude/rules/parallel-ownership.md`, "Out-of-scope work is reported, not taken").

1. **`layout/MobileHeader.tsx:3` does not honour `--banner-h`, and that is now visible from the
   first frame.** `layout/DemoBanner.tsx` measures its own height and publishes it as `--banner-h`
   on `document.documentElement`; `Sidebar` and `TopBar` consume it so nothing overlaps.
   `MobileHeader` never did, so on a demo account it renders *under* the banner. `af2074e` changed
   `DemoBanner` to seed its first paint from the last resolved `current_account_demo()` value
   (fixing a measured 0.122 CLS on a cold 390px load), which means the banner is now present from
   frame 0 instead of arriving a paint late — so this overlap went from intermittent to constant.
   It is **more noticeable, not newly broken**, and the round recorded it as a known gap rather
   than silently assuming someone else had it. Add `--banner-h` to `MobileHeader`'s offset when
   you touch it.

2. **`layout/TopBar.tsx`** — one-off UI fixes deferred from the round's item I. Note `TopBar` is
   already a correct `--banner-h` consumer; keep it one.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

- Fake timers (`vi.useFakeTimers()`) proved incompatible with `vitest-browser-react` in this
  real-browser (Playwright/Chromium) setup: `.fill()` still updated the controlled input's value,
  but advancing the fake clock never let the resulting `useEffect`/`setTimeout` chain actually run
  (React's passive-effect flush and Playwright's own actionability checks both ride on real
  animation-frame/message ticks the fake clock also freezes). `GlobalSearch.test.tsx`'s debounce
  suite uses real timers + `expect.poll` instead (a deterministic retrying assertion, never a
  blind `waitForTimeout`) — see that file's own header comment for the full account.
- `CommandItem asChild` does not compose with `RecordLink`: `RecordLink`'s closed five-prop
  contract (no `ref` forwarding, no prop spread — contract §7 rule 0) means `cmdk`'s `Slot`-based
  `asChild` composition silently drops every prop it tries to inject (`role`, `aria-selected`,
  `onClick`, the tracking `id`, the ref cmdk needs to read the item's rendered text). This is the
  story's own named fallback condition ("if `asChild` turns out not to compose with cmdk's
  keyboard `onSelect`") — confirmed true, not hypothetical, on inspection of both `RecordLink`'s
  and `cmdk`'s compiled source. Implemented as: `RecordLink` renders as `CommandItem`'s plain
  child (not `asChild`), `CommandItem`'s own `onSelect` performs `close()` + `navigate(...)`, and
  a wrapping `<div onClickCapture={(e) => e.preventDefault()}>` blocks `RecordLink`'s own
  click-driven navigation — so a mouse click and a keyboard Enter both resolve through the exact
  same `onSelect` path, exactly once. `GlobalSearch.test.tsx` asserts this for both activation
  methods.
- `useGlobalSearchDialog` initially lived in `GlobalSearch.tsx` next to the two components it
  serves, which tripped `react-refresh/only-export-components` (a file mixing a hook export with
  component exports). `src/components/atomic-crm`'s inline lint-suppression budget
  (`scripts/check-suppressions.mjs`) was already at its cap (3/3), so a suppression comment was
  not available. Moved the hook + its context + its no-op fallback into `useGlobalSearch.ts`
  (which exports only hooks) instead — see that file's own doc comment on the hook.
- `MobileNavigation.test.tsx` (pre-existing, outside this story's declared paths) renders
  `<MobileNavigation/>` standalone, with no `GlobalSearchProvider` ancestor. A throwing
  `useGlobalSearchDialog()` broke all 9 of its tests. Fixed by having the hook degrade to a
  no-op fallback (mirroring `RecordLink`'s own "degrade, log via `console.error`, never throw"
  contract for a cross-cutting chrome primitive) instead of throwing — this kept the pre-existing
  test green without touching it, which is outside this story's declared path set.
- The DB negative test (Task 5) was run against a dedicated, freshly-provisioned stack
  (`STACK_ID=5`, `STACK_OWNER=4-5`) rather than the shared dev database, and stopped/released
  afterward — the shared dev stack showed unrelated, pre-existing failures during this session
  (another agent's concurrent migration work), confirming the stack-isolation instruction was
  load-bearing, not precautionary.

### Completion Notes List

- **AC-1** (reachable everywhere, one instance): `TopBar.tsx` gained a `GlobalSearchButton` icon
  button; `MobileNavigation.tsx`'s `MoreButton` dropdown gained a "Search" item at the top (above
  Inbox); `GlobalSearch.tsx` owns the one `(Cmd|Ctrl)+K` `keydown` listener. `Layout.tsx` and
  `MobileLayout.tsx` each mount exactly one `GlobalSearchProvider` + `<GlobalSearch/>`, and the two
  shells are mutually exclusive (`root/CRM.tsx`'s `useIsMobile` fork), so the shortcut cannot
  double-fire. Covered by `GlobalSearch.test.tsx` (Escape closes; Cmd/Ctrl+K is exercised via the
  fact the dialog's `open`/`close` plumbing is the same path the icon button uses, itself covered
  in `TopBar.test.tsx`) and `e2e/global-search.spec.ts` (icon, shortcut, and the mobile More-menu
  trigger, on both Playwright projects).
- **AC-2** (exactly three resources, grouped): `useGlobalSearch.ts` fans out over exactly
  `singles`/`shidduchim`/`shadchanim` via `useDataProvider().getList` — never a dataProvider
  custom method (the dead-hook trap Story 4.1 documents) — and `references` appears nowhere in
  the fan-out, the result mapping, the `GlobalSearchResult` union, or the empty-state hint string
  (RULING 7). `GlobalSearch.tsx` renders one `CommandGroup` per non-empty resource, headed by the
  translated `resources.<resource>.name`.
- **AC-3** (descriptor-built href): every result renders as `RecordLink`, whose href is
  `descriptor.buildRecordPath(id)` — never a hand-written template literal. `GlobalSearch.test.tsx`
  asserts the exact href for all three resources; `useGlobalSearch.test.ts` asserts no mapped
  result carries a baked-in `href`/`path` field.
- **AC-4** (no cross-account/context leak): structural via AD-1/AD-19 (no client-suppliable scope
  parameter anywhere in the fan-out) and proven by the new negative DB test
  (`supabase/tests/global_search.sql` + `.test.ts`): two disjoint household tenants, each seeded
  with a `singles`/`shidduchim`/`shadchanim` row sharing the term "Zzyx"; authenticated as tenant
  A, each of the three real read paths (`singles`, `shidduchim_summary`, `shadchanim`) returns
  only tenant A's row, with a sanity-control arm proving the same for tenant B. Run against a
  dedicated stack (`STACK_ID=5`) — 9/9 checks passed; `npm run test:unit:db`'s full 14-file suite
  (466 tests) also passed unchanged on the same stack, and `supabase db diff` reported no schema
  drift (this story adds no migration).
- **AC-5** (2-char minimum + 300ms debounce): `useGlobalSearch.ts`'s guard resolves three empty
  arrays and calls `getList` zero times below 2 characters; `GlobalSearch.tsx` holds the raw
  keystroke locally and only republishes it to the fan-out 300ms after the last keystroke (cleared
  and rescheduled on every keystroke). Covered by both test files and by
  `e2e/global-search.spec.ts`'s "a 1-character query never shows a loading state" case.
- **AC-6** (verification): see the gate output section of this report below (relayed to the
  dispatching agent) — `make typecheck`, `npm run lint`, prettier, the full `app`/`functions`/
  `workers`/`scripts` vitest run (1341 tests), `make build`, the isolated-stack DB suite, and four
  of the five named CI guards all ran clean; `check-wave-ownership` was not run (no wave manifest
  exists for this standalone dev-story dispatch — see the report's final notes).
- A security review pass (`.claude/rules/security-triggers.md`, triggered by the new database
  queries even though no RLS policy changed) found no findings: the fan-out reuses the same
  authenticated `useDataProvider()` seam and the same `applyFullTextSearch` filter-building code
  path every other list screen already uses, all navigation targets are built through the
  registry (`buildRecordPath`) rather than string concatenation, and no rendered text uses
  `dangerouslySetInnerHTML` or an equivalent unsafe sink.
- Not built, by design: Epic 8's shadchanus-context entities (connections, shadchan-originated
  redts) are explicitly out of scope for this story (Dev Notes, "Scope: three resources, for
  now") — `useGlobalSearch`'s resource list, the `GlobalSearchResult` union, and the result
  mapping are the extension points a future epic widens.

### File List

- `src/components/atomic-crm/misc/useGlobalSearch.ts` (new)
- `src/components/atomic-crm/misc/useGlobalSearch.test.ts` (new)
- `src/components/atomic-crm/misc/GlobalSearch.tsx` (new)
- `src/components/atomic-crm/misc/GlobalSearch.test.tsx` (new)
- `src/components/atomic-crm/types.ts` (`GlobalSearchResource`/`GlobalSearchResult` appended)
- `src/components/atomic-crm/layout/Layout.tsx` (mounts `GlobalSearchProvider` + `GlobalSearch`)
- `src/components/atomic-crm/layout/MobileLayout.tsx` (same, mobile shell)
- `src/components/atomic-crm/layout/TopBar.tsx` (`GlobalSearchButton`, exported for its own test)
- `src/components/atomic-crm/layout/TopBar.test.tsx` (new `GlobalSearchButton` coverage)
- `src/components/atomic-crm/layout/MobileNavigation.tsx` ("Search" item, top of `MoreButton`)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (`crm.global_search.*`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (French translations)
- `supabase/tests/global_search.sql` (new)
- `supabase/tests/global_search.test.ts` (new)
- `e2e/global-search.spec.ts` (new)
- `registry.json` (regenerated)
