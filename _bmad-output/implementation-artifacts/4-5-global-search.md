# Story 4.5: Global search

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want one search across everything,
so that I can find a person without knowing their type.

## Position in Epic 4

**5th (last) of 5.** Depends on:

- **Story 4.1** — reuses its `applyFullTextSearch` per-resource search hooks (`singles`,
  `shadchanim`, `references`) rather than writing new search logic; adds the fourth
  (`shidduchim`, wired by Story 4.3) to the same fan-out.
- **Story 4.3** — the `shidduchim` search hook this story's fan-out depends on.
- **Epic 3 Story 3.9 (`RecordLink`)** — every result renders as a `RecordLink`, per AD-24
  ("no ad-hoc record links remain"). `RecordLink`'s exact props are 3.9's contract, not
  restated here; if 3.9 has not landed by the time this story is picked up, that is a blocking
  dependency — hand-rolling a `<Link>` instead would violate 3.9's own acceptance criterion and
  must not be done as a workaround.

## Acceptance Criteria

1. **One search reaches everywhere.** A search affordance (icon button + keyboard shortcut) is
   visible from every screen — desktop `TopBar` and mobile `MobileHeader` — and opens the same
   search overlay regardless of where it was triggered from.

2. **Results span every entity that exists as of this epic**: `singles`, `shidduchim`,
   `shadchanim`, `references`, grouped by type, each rendered as a `RecordLink` routing to that
   record's own page. (Epic 8 adds shadchanus-context entities later — flagged in Dev Notes as
   that epic's own follow-up, not built here.)

3. **Results never cross a context or account boundary.** Searching while a household context
   is active returns only that household's rows, even if another account (or, once Epic 8
   lands, a shadchanus context) has a same-named record. A negative test proves this — see
   AC-5.

4. **A short query does nothing expensive.** Fewer than 2 characters triggers no data-provider
   call; typing is debounced (300ms) before the fan-out fires.

5. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on
   changed files; a Vitest suite covers the fan-out/merge logic and the debounce/minimum-length
   guard; **a negative test** (Dev Notes "The negative test this story owns") proves
   cross-account isolation of the search surface itself, run via `npm run test:unit:db`
   against the local Supabase stack per `.claude/rules/security-triggers.md` (this story
   touches a query surface spanning every domain table, which is exactly what that rule
   flags); an e2e spec (`e2e/global-search.spec.ts`) covers AC-1/AC-2/AC-4.

## Tasks / Subtasks

- [ ] **Task 1 — `globalSearch` custom method (AC: 2, 3, 4)**
  - [ ] `providers/supabase/dataProvider.ts`: add `globalSearch(query: string):
        Promise<GlobalSearchResult[]>` to the object returned by
        `getDataProviderWithCustomMethods()` (the same pattern as `catchShidduch`/
        `matchReferenceOnEntry` — a plain async method alongside the spread base provider; its
        return type flows into `CrmDataProvider` automatically via the existing
        `ReturnType<...>` export at the bottom of the file, no separate interface to keep in
        sync).
  - [ ] Guard: `if (query.trim().length < 2) return [];` before any data-provider call (AC-4).
  - [ ] Implementation: `Promise.all` of four `this.getList(resource, { filter: { q: query },
        pagination: { page: 1, perPage: 5 }, sort: {...} })` calls — one each for `"singles"`,
        `"shidduchim"`, `"shadchanim"`, `"references"` — reusing the exact search hooks Stories
        4.1/4.3 already wired. **No new SQL, no new Postgres function, no service-role client.**
        This is the load-bearing safety property: `globalSearch` inherits whatever RLS already
        protects those four resources (AD-1) because it calls the same `getList` path every
        other list in the app uses, under the caller's own authenticated session — there is no
        client-suppliable `account_id`/context parameter for a bug to mis-scope, because none
        is threaded through (AD-19: `current_context_id()` is server-held, never a client
        value).
  - [ ] Map each resource's rows to
        `{ resource: "singles"|"shidduchim"|"shadchanim"|"references"; id: Identifier;
        label_en: string; label_he?: string|null; subtitle?: string|null }` using each
        resource's known name fields: `singles` → `first_name_en`/`last_name_en` (+ `_he`);
        `shidduchim` (via its existing `shidduchim_summary` redirect) → `name_en`/`name_he`,
        subtitle = `shadchan_name`; `shadchanim` → `name`/`name_he`, subtitle = `location`;
        `references` (via its existing `references_summary` redirect) → `name_en`/`name_he`,
        subtitle = `relationship`.
  - [ ] Mirror in `providers/fakerest/dataProvider.ts`: same method, same fan-out over
        `this.getList(...)` — FakeRest's generic `q` handling (Story 4.1 Dev Notes) means the
        mapping logic is the only part that needs restating, not the search itself (AD-10:
        every new method is mirrored in FakeRest).
  - [ ] Add the `GlobalSearchResult` type to `types.ts`.

- [ ] **Task 2 — Debounce (AC: 4)**
  - [ ] In the UI component (Task 3), hold the raw input in local state and derive a debounced
        query via a 300ms `setTimeout` in a `useEffect` (cleanup clears the pending timeout on
        each keystroke) — no new dependency; `lodash` is already installed and used elsewhere
        in this codebase (`filter-form.tsx`, `ShidduchimListContent.tsx`) if a ready-made
        debounce is preferred over the inline `setTimeout`.

- [ ] **Task 3 — `GlobalSearch` UI (AC: 1, 2)**
  - [ ] Create `src/components/atomic-crm/misc/GlobalSearch.tsx`: a `CommandDialog` (reuse
        `@/components/ui/command.tsx` — already an installed, unused shadcn primitive built on
        `cmdk`, which is already a `package.json` dependency; do not add a new command-palette
        library). Controlled `open` state; opens on a search icon button and on
        `(Cmd|Ctrl)+K` (a `keydown` listener on `document`, cleaned up on unmount).
  - [ ] On query change (debounced), calls `dataProvider.globalSearch(query)` via
        `useDataProvider<CrmDataProvider>()` (no React Query wiring needed — this is a
        one-shot, cancel-on-close fetch, not cached list state).
  - [ ] Renders one `CommandGroup` per resource with a translated heading
        (`resources.<resource>.name`), each result row as a `RecordLink` (Epic 3 Story 3.9)
        wrapped so selecting it (click or Enter) closes the dialog and navigates.
  - [ ] Empty/loading/no-results states inside the dialog: a subtle `Loader` while awaiting the
        fan-out, "No results" when the debounced query is non-empty and all four groups came
        back empty, and a hint ("Search singles, shidduchim, shadchanim, references...") when
        the query is empty.

- [ ] **Task 4 — Mount it (AC: 1)**
  - [ ] `layout/TopBar.tsx`: add a search icon button (opens `GlobalSearch`) alongside
        `ThemeModeToggle`/`RefreshButton`.
  - [ ] `layout/MobileHeader.tsx`: same icon, same component, mobile has no keyboard shortcut
        so the icon is the only trigger there.
  - [ ] One `GlobalSearch` instance, mounted once high in the layout tree (e.g. alongside
        `TopBar`/`MobileHeader`'s render, not duplicated per header) so the `Cmd+K` listener
        does not double-fire.

- [ ] **Task 5 — Tests (AC: 5)**
  - [ ] `providers/supabase/dataProvider.globalSearch.test.ts` (or the FakeRest equivalent,
        whichever the existing custom-method test convention favors — check
        `providers/fakerest/dataProvider.summaryStats.test.ts` for the established pattern):
        query length < 2 returns `[]` without calling `getList`; a query matching rows across
        all four resources returns four populated groups; a query matching only one resource
        returns the other three as empty arrays, not omitted keys.
  - [ ] `src/components/atomic-crm/misc/GlobalSearch.test.tsx`: debounce timing (fake timers —
        assert `globalSearch` is not called before 300ms, is called once after); Escape closes
        the dialog; selecting a result calls navigation.
  - [ ] **The negative test this story owns** (see Dev Notes) in
        `supabase/tests/global_search.sql` (new file, alongside the existing per-table
        cross-tenant checks in `supabase/tests/references_entity.sql`/`shidduch_catch.sql`):
        seed two accounts, each with a `singles` row, a `shidduchim` row, a `shadchanim` row and
        a `references` row sharing one distinctive search term (e.g. `"Zzyx"`); assert that,
        authenticated as account A, each of the four underlying `getList`-equivalent queries
        `globalSearch` issues (`singles`, `shidduchim_summary`, `shadchanim`, `references_summary`
        filtered by that term) returns **only** account A's row. Run under
        `npm run test:unit:db` (needs `make start`).
  - [ ] `e2e/global-search.spec.ts`: open via the icon and via `Cmd/Ctrl+K`; type a known
        single's name; assert a grouped result appears and clicking it navigates to that
        single's page; type one character, assert no network call fires (or assert no loading
        state appears, per whatever is externally observable).

## Dev Notes

### The negative test this story owns

`globalSearch` adds no new RLS policy — it fans out over `getList` calls against tables/views
that already carry `FORCE ROW LEVEL SECURITY` (AD-1) and already have their own isolation
tests from the epics that introduced them (`singles`/`shadchanim`/`references` from Epic 1
onward; `shidduchim` from the product's foundation; the `q`-search hooks specifically from
Stories 4.1/4.3). What this story *does* add is a new aggregate code path that could, through a
mundane implementation mistake, undermine that isolation without touching a single RLS
policy — for example, accidentally hitting a resource name that bypasses the intended search
hook, or (worse) using a service-role client for the fan-out instead of the caller's own
authenticated session. `.claude/rules/security-triggers.md`'s instruction to dispatch a
security review "when in doubt" on anything touching database queries applies squarely here,
even though no `.sql` file in `supabase/schemas/` changes. The negative test in Task 5 exists
to prove the fan-out itself is safe, not to re-prove RLS that other stories already cover.

### Why no new Postgres function

A tempting alternative is one `search_records(query text)` SQL function unioning all four
sources server-side, for a single round trip instead of four. This story deliberately does not
do that: a `SECURITY DEFINER` function bypasses RLS by design and would need to hand-reconstruct
the account/context scoping AD-1 already gives every table for free; a `SECURITY INVOKER`
function gains little over four ordinary `getList` calls the app already knows how to make
safely. Reusing the dataProvider seam (AD-10) is simpler, safer, and consistent with how every
other cross-cutting read in this codebase (e.g. `ShadchanList`'s suggestion counts) is already
built — fetch via the existing provider, compose client-side.

### Scope: four resources, for now

`singles`, `shidduchim`, `shadchanim`, `references` are every searchable entity that exists by
the end of this epic. Epic 8 ("Shadchan Context") adds shadchanus-context entities
(connections, shadchan-originated redts) that a shadchan will eventually want to find via this
same search — that epic must extend `globalSearch`'s resource list and result mapping when it
lands; it is flagged here as a forward dependency, not built now, since those resources and
their RLS do not exist yet.

### Why a command dialog, not a `/search` route

AD-24 says records live at URLs, not modals — but that governs *record* pages, not a transient
utility overlay with no persistent state of its own. "Search from anywhere" (the epic's own
framing) is best served by an always-available overlay rather than a navigation to a dedicated
page and back; this mirrors the standard command-palette pattern the app already ships an
unused primitive for (`@/components/ui/command.tsx`, `cmdk`).

### Architecture

- **AD-1 / AD-19**: no client-suppliable scope parameter exists in `globalSearch`'s signature —
  this is the property that makes AC-3 hold structurally, not by convention.
- **AD-24 (via Epic 3 Story 3.9)**: every result is a `RecordLink`; no ad-hoc `<Link>` in this
  component.
- **AD-10**: the dataProvider custom-method seam; mirrored in FakeRest.

### Testing standard

`.claude/rules/testing.md` AAA + ≥80% coverage. `.claude/rules/security-triggers.md` — database
queries touched, so this story requires the negative test above regardless of the "no new RLS"
fact. `.claude/skills/e2e-conventions` — search/interaction UI, e2e spec required.

### Project Structure Notes

`GlobalSearch.tsx` lives in `src/components/atomic-crm/misc/` (cross-entity, like `EntityList`).
`globalSearch()` lives beside every other custom method in
`providers/supabase/dataProvider.ts` / `providers/fakerest/dataProvider.ts`. The new SQL test
file follows the existing `supabase/tests/*.sql` convention.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.5 AC text.
- [Source: ARCHITECTURE-SPINE.md#AD-1], [Source: ARCHITECTURE-SPINE.md#AD-19],
  [Source: ARCHITECTURE-SPINE.md#AD-10], [Source: ARCHITECTURE-SPINE.md#AD-24]
- [Source: .claude/rules/security-triggers.md]
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] — the
  `applyFullTextSearch` hooks this story fans out over.
- [Source: _bmad-output/implementation-artifacts/4-3-shidduchim-list-view.md] — the
  `shidduchim` search hook.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
