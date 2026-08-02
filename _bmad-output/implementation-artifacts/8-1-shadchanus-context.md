---
baseline_commit: 2ead6327d682961a4f8a856e5e3fb6fd27dd1685
---

# Story 8.1: Shadchanus context — workspace shell, navigation and route isolation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want my own workspace, separate from any family's,
so that my book is mine and I never land on a screen that means nothing in my context.

## Position in Epic 8

**1st of 5.** Epic 8's five stories land in numeric order — there is no reordering like
Epic 1's. This story ships the empty container; 8.2–8.5 populate it:

- **8.1 (this story)** — the shadchanus-context shell: navigation set, route isolation,
  a placeholder dashboard and a placeholder `/connections` screen. No new tables.
- **8.2** — the connection invite/accept/end workflow on the `connections` table
  **Epic 7 Story 7.4 already created**.
- **8.3** — in-platform redting through a connection.
- **8.4** — the privacy-boundary negative-test suite.
- **8.5** — the shadchan's own CRM (Connections list/360, Conversations tab), which
  **replaces both placeholders this story ships** with descriptor-based screens.

## Acceptance Criteria

1. **A shadchanus-active context renders a distinct navigation set.** `layout/navItems.ts`
   exports a second array, `SHADCHANUS_NAV`, alongside the existing `PRIMARY_NAV`
   (household), containing exactly: Dashboard (`/`), Connections (`/connections`),
   Settings (`/settings`) — in that order. It excludes the household-domain destinations
   of the post-Epic-4 `PRIMARY_NAV` (Inbox, Shidduchim, Shadchanim — entities a shadchanus
   context can never hold, AD-2) **and** Tasks/Reminders (no taskable target exists in a
   shadchanus account — see Dev Notes "Why no Tasks or Reminders"). "Conversations" is
   deliberately **not** a nav item — per UX-DR8/UX-DR10 (a sub-record is reached from its
   parent, never primary navigation), a connection's threads are a tab on the Connection 360
   (Story 8.5 owns that tab).
2. **The nav set the user sees follows the active context, not a hardcoded list.** The two
   consumers of `PRIMARY_NAV` (`layout/Sidebar.tsx` desktop, `layout/MobileNavigation.tsx`
   mobile — both read the one shared array) switch to a `useActiveNav()` selector that
   returns `SHADCHANUS_NAV` when the active context's `kind` is `shadchanus`, else
   `PRIMARY_NAV`. Context kind comes from Story 2.4's `useMyContexts()` hook
   (`root/useMyContexts.ts`; the row with `is_active = true` carries `kind`) — never from a
   URL param or local state (AD-19). A user whose active context is household never sees
   `SHADCHANUS_NAV` rendered, and vice versa.
3. **Household-only routes are unreachable while a shadchanus context is active, and the
   mechanism is reusable in the other direction.** One route guard — not per-route ad-hoc
   checks — enforces this: navigating to `/shidduchim`, `/singles`, `/shadchanim`,
   `/references`, `/inbox_items`, `/tasks` or `/reminders` while the active context is
   `shadchanus` redirects to `/` rather than rendering an empty or erroring screen (the
   "no route renders nothing" bar Epic 1 Story 1.5 set). Mechanically: `routeManifest.ts`
   entries gain an optional `contextKind?: "household" | "shadchanus"` field, and the two
   `.map()` calls in `root/CRM.tsx` wrap any entry carrying it in the new
   `<RequireContextKind>` component. Story 8.5 sets `contextKind: "shadchanus"` on the
   `connections` resource using this same field — no second mechanism. (`surface` is
   already taken: in the 1.5 manifest it means desktop/mobile/both, never context kind.)
4. **`/connections` renders a real screen from day one — never a 404.** Because 1.5's
   `findManifestViolations` fails on a nav target that resolves to no route
   (`"unreachable-nav-target"`), this story must register `/connections` as a custom-route
   entry with a real placeholder component (`connections/ConnectionsPlaceholder.tsx`): a
   calm empty state ("Share your invite link with a family to connect" once 8.2 lands the
   action; until then, copy explaining connections are coming in this release). Story 8.5
   replaces this entry with the descriptor-based resource.
5. **The shadchanus dashboard is honest about having nothing yet.** `/` under a shadchanus
   active context renders `dashboard/ShadchanDashboard.tsx` (not the household
   `Dashboard.tsx`/`MobileDashboard.tsx`, which query household resources and would show
   nonsensical copy like "0 singles"). It shows a calm empty state ("Once you connect with
   a family, their conversations will appear here") and does **not** query `connections`
   content or Epic-7 `threads` — real data is Story 8.5's.
6. **No bespoke layout code.** Reuse `layout/TopBar.tsx`, `layout/Layout.tsx` and
   `layout/MobileLayout.tsx` unchanged; only the nav array, the routed dashboard component
   and the placeholder route differ per context kind (AD-24).
7. **A negative test proves the isolation at the UI layer.** This story changes no RLS, so
   its negative test is a component/route test, not a SQL one: with the active context
   mocked to `kind: 'shadchanus'`, a render of the Sidebar/mobile nav contains no
   household-only `to` path in the DOM; a route test asserts `/shidduchim` (and each other
   guarded path) redirects rather than rendering its screen; and the mirror case — a
   mocked `household` context against a `kind="shadchanus"` guard — redirects too.

## Tasks / Subtasks

- [x] **Task 1 — Confirm the dependency, do not re-implement it** (informs all ACs)
  - [x] Epic 2's context primitives this story consumes, by name: `current_context_id()` /
        `member_state` / `set_active_context()` (Story 2.1) and `my_contexts()` +
        `useMyContexts()` + `getMyContexts()`/`switchActiveContext()` (Story 2.4). Read
        `root/useMyContexts.ts` before writing anything — this story consumes that hook,
        it does not define a second active-context source.
  - [x] Epic 2 Story 2.2 owns the database-level guarantee that a `shadchanus`-kind account
        never holds household domain rows (AD-2). **This story does not re-test that at the
        SQL layer** — Task 5's negative test is UI-only, precisely so 8.1 and 2.2 do not
        both claim the same DB assertion.

- [x] **Task 2 — Navigation set** (AC: 1, 2)
  - [x] `layout/navItems.ts`: add `SHADCHANUS_NAV: NavItem[]` next to `PRIMARY_NAV`, reusing
        the same `NavItem` interface (`to`, `labelKey`, `labelDefault`, `icon`, `tourId`).
        3 entries: Dashboard (`/`), Connections (`/connections`), Settings (`/settings`).
        New i18n key `crm.navigation.connections`, English default `"Connections"`, added to
        **both** `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` — the
        two catalogues the shipped `i18nProvider.ts` actually merges (French is the live
        second locale; AD-18's own text names Hebrew, but the repo has shipped English+French
        since Epic 2 — Story 2.3 Dev Notes already flagged this AD-18-vs-reality drift as
        open and unowned, and it is not this story's job to resolve it. "Second-catalogue
        parity" below always means French).
  - [x] Add `useActiveNav()` in `navItems.ts` itself (one place knows the mapping), reading
        `useMyContexts()`; switch `Sidebar.tsx` and `MobileNavigation.tsx` to it.

- [x] **Task 3 — Route guard primitive** (AC: 3)
  - [x] Add `layout/RequireContextKind.tsx` (`<RequireContextKind kind="household"
        redirectTo="/">`): reads the active context kind from `useMyContexts()` and renders
        `<Navigate to={redirectTo} replace />` on mismatch, else `children`. Export it for
        Story 8.5's `kind="shadchanus"` use.
  - [x] `root/routeManifest.ts`: add the optional `contextKind` field to
        `CustomRouteEntry`/`ResourceEntry`; set `contextKind: "household"` on the
        `shidduchim`, `singles`, `shadchanim`, `references`, `inbox_items`, `tasks` and
        `reminders` entries. Wire the wrapping in `root/CRM.tsx`'s existing `.map()` calls —
        do not reintroduce raw `<Route>` JSX (1.5 removed it for a reason).

- [x] **Task 4 — Placeholder screens** (AC: 4, 5, 6)
  - [x] `dashboard/ShadchanDashboard.tsx`: identity header ("Your shadchanus workspace") +
        one empty-state card, no data fetching. Register a small dashboard-route component
        that picks `ShadchanDashboard` vs the household `Dashboard`/`MobileDashboard` by
        active context kind — one component, one place; do not fork the manifest entry.
  - [x] `connections/ConnectionsPlaceholder.tsx`: empty-state screen registered as the
        `/connections` custom route (AC-4). New folder `connections/` starts here; 8.5
        fills it.
  - [x] All copy through the `i18nProvider` (AD-18) — no hardcoded string outside a
        translation key, added to both `englishCrmMessages.ts` and `frenchCrmMessages.ts`
        (the shipped second catalogue — see Task 2's note; not Hebrew).

- [x] **Task 5 — Tests** (AC: 7)
  - [x] Extend the existing `layout/navItems.test.ts`: `SHADCHANUS_NAV` contains none of the
        7 guarded household paths; `useActiveNav()` returns the right array per mocked
        context kind; and `findManifestViolations(...)` returns `[]` when fed
        `SHADCHANUS_NAV.map(i => i.to)` as nav targets too (extend 1.5's positive test —
        the validator must hold for both nav sets).
  - [x] `layout/RequireContextKind.test.tsx`: mocked `shadchanus` context ⇒ household-only
        content never renders, redirect occurs; mirror case for `household` vs a
        `kind="shadchanus"` guard.
  - [x] `dashboard/ShadchanDashboard.test.tsx` + `connections/ConnectionsPlaceholder.test.tsx`:
        empty-state copy renders (no fetch, so empty state is the only state) — the minimum
        bar UX-DR11 sets; light/dark and 375px stay with the project's existing
        visual-regression setup — reuse it, do not add a new harness.
  - [x] `make typecheck && npm run lint && make test`, plus `npx prettier --config
        ./.prettierrc.json --check` over this story's changed files only (repo-wide prettier
        is Epic 1 Story 1.6's gate).

## Dev Notes

### What this story deliberately does not build

`connection_invites` RPCs, `shadchanim.connection_id`, threads, and the real Connections
list/360 are 8.2/8.5's. This story ships `/connections` as a **rendered placeholder**, not a
dead link: a nav item pointing at an unregistered route would fail 1.5's
`"unreachable-nav-target"` manifest rule and its "none blank" e2e check, so the placeholder
screen is the only way the nav item can exist from day one.

### Why no Tasks or Reminders in `SHADCHANUS_NAV`

At the time this story runs, `tasks.target_type` (post-Epic-3 widening) allows only
household-book targets — `shadchan`, `shidduch`, `reference`, `single` — and a shadchanus
account holds no rows of any of them (AD-2). A Tasks or Reminders screen in a shadchanus
context would render empty forever and its create flow would offer zero valid targets:
exactly the "screen that means nothing in my context" this story exists to prevent.

This is not left open: Story 8.5 adds `'connection'` to `ENTITY_TARGET_TYPES` (contract §8
rule 4, "'connection' is Epic 8's value to add \[8.2/8.5]") so a shadchan CAN hold a task or
a note about a specific connection by the time Epic 8 closes — that is what makes "the
shadchan's own CRM" (8.5's title) literally true, and what Story 3.14/R1's lift of
`enforce_household_scope()` from `tasks`/`interactions` was FOR (contract §11 Ruling 1:
"while Epic 8.5 ... is built entirely on them"). That does **not** change this story's AC-1:
a connection-scoped task/note is reached from the Connection 360's own Tasks/Notes tabs
(8.5 Task 8, mirroring Ruling 2 — "every entity's 360 gets a full tasks tab" — and the
`references` precedent, which also gets no global nav entry), never from a global
all-my-tasks list. `SHADCHANUS_NAV` staying at exactly Dashboard/Connections/Settings is
therefore still correct once 8.5 lands; only the reason "there is nothing to ever list here"
changes to "the list lives on the record, not in primary nav."

### Current-state grounding

- `layout/navItems.ts` exports one array, `PRIMARY_NAV`, consumed by exactly two components:
  `layout/Sidebar.tsx` and `layout/MobileNavigation.tsx`. By the time this story runs
  (pinned epic order), Story 4.3 has relabelled Pipeline → Shidduchim and Story 4.4 has
  swapped References for Tasks, so `PRIMARY_NAV` is: Dashboard, Inbox, Shidduchim,
  Shadchanim, Tasks, Reminders, Settings. `/references` and `/singles` remain reachable as
  routes (4.4 AC-2) — hence they are in the guard list (AC-3) though not in the nav.
- `root/routeManifest.ts` (Epic 1 Story 1.5) is the single source of truth for routes and
  resources, mapped by `root/CRM.tsx`, with the `findManifestViolations` validator — extend
  it, never add parallel JSX.

### Architecture citations

- **AD-2**: a shadchanus context may never contain household domain rows, enforced by CI and
  scope checks. This story's route guard is defense-in-depth on top of that DB guarantee.
- **AD-19**: the active context is server-held (`member_state` via `current_context_id()`),
  never a client claim. `useMyContexts()` reads over that server state — never infer kind
  from a URL or local state.
- **UX-DR10 / UX-DR8**: "References is not a primary destination" generalises to "a
  connection's threads are not a primary destination" — hence no Conversations nav item.
- **AD-24**: every screen renders through the same shell primitives (`Layout.tsx`,
  `MobileLayout.tsx`) — this story swaps only the nav array and two routed components,
  never the shell.

### Dependencies

- **Epic 2 Stories 2.1, 2.2, 2.4** — hard: no active-context read primitive or switcher UI
  without them.
- **Epic 4 Stories 4.3, 4.4** — the nav shape this story extends (Shidduchim label, Tasks in,
  References out).
- **Epic 1** (naming, `routeManifest.ts`) — this story writes `/singles`, never `/children`.

### Testing standard

Frontend-only story: Vitest component tests per `.claude/rules/testing.md` (AAA, descriptive
names, no shared mutable state). No SQL test file — no schema change in this story.

### Project Structure Notes

New: `layout/RequireContextKind.tsx` (+ `.test.tsx`), `dashboard/ShadchanDashboard.tsx`
(+ `.test.tsx`), `connections/ConnectionsPlaceholder.tsx` (+ `.test.tsx`). Modified:
`layout/navItems.ts` (+ existing `.test.ts`), `layout/Sidebar.tsx`,
`layout/MobileNavigation.tsx`, `root/routeManifest.ts`, `root/CRM.tsx`,
`providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts` (the
new `crm.navigation.connections` key and this story's placeholder/dashboard copy, in both
catalogues — AD-18).

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), dispatched as the developer for STACK_ID=1 / STACK_OWNER=8-1-shadchanus-context.

### Debug Log References

- `npm run typecheck`: clean on first structural attempt, one real error found and fixed —
  `buildDashboardRoute`'s household-dashboard parameter was typed `DashboardComponent`
  (`ComponentType<{ permissions: any }>`), and instantiating it as JSX (`<HouseholdDashboard />`)
  made the JSX checker demand a `permissions` prop that `Dashboard`/`MobileDashboard` never take.
  Fixed by typing the parameter as a bare `ComponentType` (zero props) instead — the factory's
  *return* type stays `DashboardComponent` since that value is only ever passed by reference to
  `<Admin dashboard={...}>`, never JSX-instantiated directly, mirroring how the original
  `dashboard={props.dashboard ?? Dashboard}` line always type-checked.
- `npm run lint`: clean, no `eslint-disable` added.
- `npx vitest run` (full repo, no STACK_ID — frontend-only story, nothing here reads
  `SUPABASE_DB_URL`): 241 files / 2753 tests green, including this story's 6 new/extended files
  (53 tests). One assertion needed a fix after first run:
  `ConnectionsPlaceholder.test.tsx`'s `getByRole("heading", { name: "Connections" })` matched
  both the `<h1>Connections</h1>` and the EmptyState's `<h2>Connections are coming soon</h2>`
  (non-exact substring match) — added `level: 1` to disambiguate.
- `npm run build`: clean (`tsc && vite build && verify-push-sw-build.mjs`); no new chunk-size
  regression beyond the pre-existing >500kB warning.
- `npx prettier --config ./.prettierrc.json --check "**/*.{mjs,js,json,ts,tsx,css,md,html}"`:
  clean after `--write` on this story's own new/changed files (6 files needed reformatting on
  first pass — trailing-comma/line-wrap only, no logic change).
- All four CI guards (`check-suppressions.mjs`, `check-retired-names.mjs`,
  `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`): all OK.
- No SQL touched — `supabase db diff --local` and `make check-migration-safety` are N/A for
  this story (Task 1 explicitly: no schema change, AD-2's DB guarantee is Epic 2's, not
  re-tested here).
- `make test STACK_ID=1`: ran as `npm run test` (the Makefile target's own body when
  `STACK_ID` is set only exports `SUPABASE_DB_URL` for the stack's Postgres before delegating
  to the same `vitest --run`) — same 241/2753 green result as above; nothing in this story's
  scope queries Supabase directly, so no live stack was started for a frontend-only, no-SQL
  story (no `make start-app-e2e` — Task 5 calls for Vitest component tests only, no Playwright
  e2e file was added).

### Completion Notes List

- **AC-1**: `SHADCHANUS_NAV` (`layout/navItems.ts`) is exactly `["/", "/connections",
  "/settings"]`, in that order — proven by `navItems.test.ts`'s ordered-array assertion plus an
  absence check against all 7 guarded household paths.
- **AC-2**: `useActiveNav()` (`layout/navItems.ts`) is the one place that maps
  `useMyContexts()`'s active-context `kind` to a nav array; `Sidebar.tsx` and
  `MobileNavigation.tsx` both call it instead of importing `PRIMARY_NAV` directly.
  `MobileNavigation.tsx` needed real restructuring (not just a call-site swap): its existing
  5-slot bar hard-derives named items (`pipelineItem`, `shadchanimItem`, etc.) that don't exist
  in `SHADCHANUS_NAV`, so `MobileNavigation` is now a thin dispatcher over two extracted
  components — `HouseholdMobileNavigation` (the original 5-slot bar, unchanged behavior, now
  parametrized) and a new `ShadchanusMobileNavigation` (Dashboard/Connections/Settings, no
  raised center create button). `MoreButton` was generalized to take a `quickLinks: NavItem[]`
  prop (household passes Inbox/Tasks/Reminders/Settings exactly as before; shadchanus passes
  none) so both bars share one "More" dropdown implementation rather than a second hand-rolled
  copy — this also keeps the context switcher and theme toggle reachable on the shadchanus bar
  (`SettingsPageMobile.tsx`'s own comment records that menu as mobile's *only* entry point for
  both; dropping it for shadchanus users who also hold a household context would have been a
  real regression the story didn't ask for but shouldn't cause either).
- **AC-3**: `RequireContextKind` (`layout/RequireContextKind.tsx`) is the one guard component.
  `routeManifest.ts` gained an optional `contextKind?: ContextKind` field (type re-exported from
  `layout/navItems.ts` as `ContextKind = MyContext["kind"]`, not a second hand-written literal
  union) on both `CustomRouteEntry` and `ResourceEntry`, set to `"household"` on exactly the 7
  named entries (`shidduchim`, `singles`, `inbox_items`, `shadchanim`, `references`, `tasks` as
  resources; `reminders` as a custom route). `root/CRM.tsx`'s `renderCustomRoutes` wraps a
  carrying entry's `<Component/>` in `<RequireContextKind>`; `renderResources` wraps the same
  entries' `list` slot only (every guarded resource in this manifest registers `list` only — none
  set a top-level `edit`/`show`/`create` — so wrapping `list` covers the whole guarded subtree;
  `children`/`buildCreateRoutes`'s own `<Route>` elements are untouched, since `<Routes>` requires
  literal `<Route>` children and wrapping them would break react-router's own child-type
  invariant). A `toElement()` helper normalizes a `ComponentType | ReactElement` slot value to an
  element before wrapping, mirroring `ra-core/src/core/Resource.tsx`'s own private `getElement`.
  Both redirect to `/`. Proven by `RequireContextKind.test.tsx` (both directions, plus a
  matching-kind pass-through case and a "renders children while `useMyContexts()` has no data
  yet" case) and by `routeManifest.test.ts`'s new `contextKind` describe block.
- **AC-4**: `connections/ConnectionsPlaceholder.tsx` registered as a `CUSTOM_ROUTES` entry
  (`path: "/connections"`, deliberately **no** `contextKind` yet — 8.1 only guards the
  household-only direction; 8.5 sets `contextKind: "shadchanus"` on the real resource). Copy
  explains the release boundary ("Connections are coming soon" / "lays the groundwork") rather
  than promising 8.2's not-yet-built invite action — proven by a test that explicitly asserts
  "share your invite link" is NOT present yet.
- **AC-5**: `dashboard/ShadchanDashboard.tsx` — identity header + one `EmptyState`, no data
  fetching, no query against `connections` or Epic-7 `threads`. Wired at `/` via a new
  `buildDashboardRoute()` factory in `root/CRM.tsx`, instantiated once per surface
  (`DesktopDashboardRoute = buildDashboardRoute(Dashboard)`, `MobileDashboardRoute =
  buildDashboardRoute(MobileDashboard)`) at module scope — not inside `DesktopAdmin`/
  `MobileAdmin`'s render body, which would have re-created the component's identity on every
  render and defeated `WithPermissions`'s remount-on-identity-change behavior (would have reset
  the household dashboard's own single-selector state on every unrelated re-render, e.g. every
  context switch's `invalidateQueries()`). Falls back to the household dashboard while
  `useActiveContextKind()` is still resolving, matching `RequireContextKind`'s own
  fail-toward-current-shell posture.
- **AC-6**: no bespoke layout code — `Layout.tsx`/`MobileLayout.tsx`/`TopBar.tsx` untouched; only
  the nav array, the two routed dashboard components and the placeholder route differ.
  `ShadchanDashboard`/`ConnectionsPlaceholder` reuse `misc/EmptyState.tsx` and the same
  eyebrow+`<h1>` header shape `reminders/RemindersPage.tsx` already established, rather than
  inventing a new page-header pattern.
- **AC-7**: negative tests at the UI layer only (no RLS touched, per Task 1's explicit
  boundary with Epic 2 Story 2.2): `navItems.test.ts` proves `SHADCHANUS_NAV` excludes all 7
  guarded paths and that `useActiveNav()`/`useActiveContextKind()` resolve correctly per mocked
  context; `MobileNavigation.test.tsx` proves a shadchanus-context render has no household-only
  `href` in the DOM (plus: no raised create button, More menu drops Inbox/Tasks/Reminders but
  keeps the context switcher and theme toggle); `RequireContextKind.test.tsx` proves both
  redirect directions plus the matching-kind and still-loading cases.
- All copy added to **both** `englishCrmMessages.ts` and `frenchCrmMessages.ts` under new
  `crm.navigation.connections`, `crm.shadchanus_context.eyebrow` (shared by both new screens),
  `crm.shadchan_dashboard.*` and `crm.connections_placeholder.*` keys — no hardcoded string
  outside a translation key in either new component (AD-18).
- **Not done, and why**: no new `layout/Sidebar.test.tsx` file — `Sidebar.tsx` is a thin
  `.map()` over whatever `useActiveNav()` returns with no per-item filtering logic of its own,
  so its shadchanus-context behavior is already fully proven by `navItems.test.ts`'s
  `useActiveNav()` coverage; a DOM-level "no household path in the DOM" render assertion for the
  *mobile* nav is what `MobileNavigation.test.tsx` carries (per AC-7's own "Sidebar/mobile nav"
  wording, read as one behavior proven two ways — hook-level for desktop's consumer, DOM-level
  for mobile's, since mobile's is the one requiring real restructuring). `layout/Sidebar.tsx` was
  not in this story's declared file set with a paired test file, and adding one was judged
  redundant rather than in-scope; flagged here rather than silently skipped.

### File List

**New**
- `src/components/atomic-crm/layout/RequireContextKind.tsx`
- `src/components/atomic-crm/layout/RequireContextKind.test.tsx`
- `src/components/atomic-crm/dashboard/ShadchanDashboard.tsx`
- `src/components/atomic-crm/dashboard/ShadchanDashboard.test.tsx`
- `src/components/atomic-crm/connections/ConnectionsPlaceholder.tsx`
- `src/components/atomic-crm/connections/ConnectionsPlaceholder.test.tsx`

**Modified**
- `src/components/atomic-crm/layout/navItems.ts` — `SHADCHANUS_NAV`, `ContextKind`,
  `useActiveContextKind()`, `useActiveNav()`
- `src/components/atomic-crm/layout/navItems.test.ts` — extended
- `src/components/atomic-crm/layout/Sidebar.tsx` — reads `useActiveNav()` instead of
  `PRIMARY_NAV`
- `src/components/atomic-crm/layout/MobileNavigation.tsx` — dispatches on `useActiveNav()`;
  extracted `HouseholdMobileNavigation`/`ShadchanusMobileNavigation`; `MoreButton` generalized
  to take `quickLinks`
- `src/components/atomic-crm/layout/MobileNavigation.test.tsx` — extended
- `src/components/atomic-crm/root/routeManifest.ts` — `contextKind` field on
  `CustomRouteEntry`/`ResourceEntry`; 7 entries marked `"household"`; new `/connections`
  `CUSTOM_ROUTES` entry
- `src/components/atomic-crm/root/routeManifest.test.ts` — extended
- `src/components/atomic-crm/root/CRM.tsx` — `renderCustomRoutes`/`renderResources` wrap
  guarded entries in `<RequireContextKind>`; new `buildDashboardRoute()` dashboard-route picker
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — new
  `crm.navigation.connections`, `crm.shadchanus_context`, `crm.shadchan_dashboard`,
  `crm.connections_placeholder` keys
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same keys, French

**Generated**
- `registry.json` — regenerated by `.husky/pre-commit` at commit time (no shadcn component
  added or moved; expected no-op)

## Change Log

- 2026-08-02: Story 8.1 implemented — the shadchanus-context shell. `SHADCHANUS_NAV` (Dashboard/
  Connections/Settings) and `useActiveNav()`/`useActiveContextKind()` added to
  `layout/navItems.ts`; `Sidebar.tsx` and `MobileNavigation.tsx` switched to the active-context
  selector (`MobileNavigation` split into `HouseholdMobileNavigation`/
  `ShadchanusMobileNavigation`, sharing a generalized `MoreButton`); `layout/RequireContextKind.tsx`
  added as the one route guard, wired into `root/CRM.tsx`'s existing `renderCustomRoutes`/
  `renderResources` `.map()` calls via a new `contextKind` field on `root/routeManifest.ts`'s
  entry types (set on `shidduchim`/`singles`/`inbox_items`/`shadchanim`/`references`/`tasks`/
  `reminders`); `dashboard/ShadchanDashboard.tsx` and `connections/ConnectionsPlaceholder.tsx`
  added as calm empty-state screens, wired via a new `buildDashboardRoute()` picker and a new
  `/connections` `CUSTOM_ROUTES` entry; all new copy added to both `englishCrmMessages.ts` and
  `frenchCrmMessages.ts`. All gates green: `make typecheck`, `npm run lint`, `npx vitest run`
  (241 files / 2753 tests), `npm run build`, `npx prettier --check .`, all four CI guards,
  `make test STACK_ID=1`. No SQL touched, so `supabase db diff --local` and
  `make check-migration-safety` are N/A.
