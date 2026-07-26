# Story 8.1: Shadchanus context — workspace shell, navigation and route isolation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want my own workspace, separate from any family's,
so that my book is mine and I never land on a screen that means nothing in my context.

## Position in Epic 8

**1st of 5.** Epic 8's five stories land in numeric order — there is no reordering like
Epic 1's. This story ships the empty container; 8.2–8.5 populate it:

- **8.1 (this story)** — the shadchanus-context shell: navigation set, route isolation,
  and a placeholder dashboard. No new tables.
- **8.2** — the `connections` table and the invite-based propose/accept/end flow. Lights
  up the "Connections" nav item this story creates.
- **8.3** — in-platform redting through a connection.
- **8.4** — the privacy-boundary negative-test suite.
- **8.5** — the shadchan's own CRM (Connections list/360, Conversations tab), which
  **replaces this story's placeholder dashboard** with one backed by real data.

## Acceptance Criteria

1. **A shadchanus-active context renders a distinct navigation set.** `layout/navItems.ts`
   exports a second array, `SHADCHANUS_NAV`, alongside the existing `PRIMARY_NAV`
   (household), containing exactly: Dashboard, Connections, Tasks, Reminders, Settings —
   in that order. It excludes Pipeline, Inbox, Shidduchim, Shadchanim and References: those
   name household-domain entities a shadchanus context can never hold (AD-2). "Conversations"
   is deliberately **not** a nav item — per UX-DR8/UX-DR10 (a sub-record is reached from its
   parent, never primary navigation), a connection's threads are a tab on the Connection 360
   (Story 8.5 owns that tab).
2. **The nav set the user sees follows the active context, not a hardcoded list.** Wherever
   `PRIMARY_NAV` is currently consumed (desktop Sidebar, mobile bottom nav — both read the one
   shared array per the doc comment in `navItems.ts`), the choice of array is driven by the
   active context's `kind` from Epic 2's context primitive (AD-19). A user with only a
   household context never sees `SHADCHANUS_NAV` rendered, and vice versa.
3. **Household-only routes are unreachable while a shadchanus context is active, and the
   reverse holds once Story 8.5 adds shadchan-only routes.** A single, reusable route guard —
   not five ad-hoc checks — enforces this. Navigating to `/shidduchim`, `/singles`,
   `/shadchanim`, `/references` or `/inbox_items` while the active context is `shadchanus`
   redirects to `/` rather than rendering an empty or erroring screen (the same "no route
   renders nothing" bar Epic 1 Story 1.5 set). The guard is exported from one module so
   Story 8.5 can apply it to `/connections` in the other direction without duplicating the
   check.
4. **The shadchanus dashboard is honest about having nothing yet.** `/` under a shadchanus
   active context renders a distinct dashboard component (not the household `Dashboard.tsx`,
   which queries household resources that will simply come back empty and would show
   nonsensical copy like "0 singles"). It shows a calm empty state ("Once you connect with a
   family, their conversations will appear here") and does **not** query `connections` or any
   Epic-7 `threads` table — those do not exist until Story 8.2/Epic 7 land, and this story
   must not depend on them.
5. **No bespoke layout code.** The shadchanus dashboard and nav are built as ordinary
   components, not as a fork of the household `Dashboard.tsx` — no copy-pasted JSX that then
   drifts. Reuse `layout/TopBar.tsx`, `layout/Layout.tsx` and `layout/MobileLayout.tsx`
   unchanged; only the nav array and the routed dashboard component differ per context kind.
6. **A negative test proves the isolation at the UI layer.** Because this story changes no
   RLS, its negative test is a component/route test, not a SQL one: with the active context
   mocked to `kind: 'shadchanus'`, a render of the Sidebar/mobile nav contains no
   `SHADCHANUS_NAV`-excluded item in the DOM, and a route test asserts `/shidduchim` (etc.)
   redirects rather than rendering `SingleShow`/`ShidduchList`/equivalent.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the dependency, do not re-implement it** (informs all ACs)
  - [ ] Locate Epic 2's context primitive (expected: a hook/provider exposing the active
        context's `id` and `kind`, backed by `current_context_id()`/`member_state`, AD-19).
        Grep for `current_context_id`, `active_context`, `useActiveContext`, `ActiveContext`
        before writing anything — this story consumes that primitive, it does not define a
        second one.
  - [ ] Confirm Epic 2 Story 2.2's database-level guarantee that a `shadchanus`-kind account
        can never hold a row in a household-scoped table (AD-2: "enforced by CI and by scope
        checks"). **This story does not re-test that at the SQL layer** — Task 6's negative
        test is UI-only, precisely so 8.1 and Epic 2 Story 2.2 do not both claim the same DB
        assertion.

- [ ] **Task 2 — Navigation set** (AC: 1, 2)
  - [ ] `layout/navItems.ts`: add `SHADCHANUS_NAV: NavItem[]` next to `PRIMARY_NAV`, reusing
        the same `NavItem` interface (`to`, `labelKey`, `labelDefault`, `icon`, `tourId`).
        5 entries: Dashboard (`/`), Connections (`/connections`), Tasks (`/tasks`), Reminders
        (`/reminders`), Settings (`/settings`). New i18n keys under `crm.navigation.connections`
        with an English default `"Connections"` (no French string yet — French catalogue
        parity is not this story's job; leave the key to fall back).
  - [ ] Wherever the desktop Sidebar and mobile bottom nav import `PRIMARY_NAV` today, switch
        to a single `useActiveNav()` (or equivalently named) selector that returns
        `SHADCHANUS_NAV` when the active context kind is `shadchanus`, else `PRIMARY_NAV`. Put
        the selector in `navItems.ts` itself so there is one place that knows the mapping.

- [ ] **Task 3 — Route guard primitive** (AC: 3)
  - [ ] Add one wrapper, e.g. `layout/RequireContextKind.tsx` (`<RequireContextKind
        kind="household" redirectTo="/">`), that reads the same active-context primitive from
        Task 1 and renders `<Navigate to={redirectTo} replace />` when the active context's
        kind does not match, else renders `children`.
  - [ ] Wrap the household-only route entries (`/shidduchim`, `/singles`, `/shadchanim`,
        `/references`, `/inbox_items`) with `<RequireContextKind kind="household">` in the
        route manifest introduced by Epic 1 Story 1.5 (`root/routeManifest.ts`) — extend
        whatever field that manifest already uses to declare per-route wrapping; do not
        reintroduce raw `<Route>` JSX in `root/CRM.tsx` (1.5 removed it for a reason).
  - [ ] Export `RequireContextKind` so Story 8.5 can apply `kind="shadchanus"` to `/connections`
        without a second implementation.

- [ ] **Task 4 — Shadchanus dashboard placeholder** (AC: 4, 5)
  - [ ] Add `dashboard/ShadchanDashboard.tsx`: identity header ("Your shadchanus workspace")
        + one empty-state card, no data fetching. Route `/` to `ShadchanDashboard` instead of
        the household `Dashboard`/`MobileDashboard` when the active context kind is
        `shadchanus`, using the same route-manifest / component-selection pattern Epic 1 Story
        1.5 established for other context-dependent surfaces — grep for an existing
        conditional-component-by-context pattern before inventing a new one.
  - [ ] Empty-state copy goes through the `i18nProvider` (AD-18) — no hardcoded string outside
        a translation key.

- [ ] **Task 5 — Tests** (AC: 6)
  - [ ] `layout/navItems.test.ts` (new or extended): asserts `SHADCHANUS_NAV` contains none of
        the 5 excluded `to` paths, and that the nav-selector returns `SHADCHANUS_NAV` /
        `PRIMARY_NAV` correctly for each mocked context kind.
  - [ ] `layout/RequireContextKind.test.tsx`: renders the guard with a mocked `shadchanus`
        context and asserts a household-only route's content never renders and a redirect
        occurs; and
        the mirror case for a mocked `household` context against a `kind="shadchanus"` guard.
  - [ ] `dashboard/ShadchanDashboard.test.tsx`: renders empty/loading (no fetch, so effectively
        just an empty-state render) and asserts the empty-state copy is present — the minimum
        bar UX-DR11 sets ("every screen renders empty/loading/error, light+dark, at 375px");
        light/dark and 375px are visual-regression concerns already covered by the project's
        existing Storybook/visual setup for other screens — reuse it, do not add a new harness.

## Dev Notes

### What this story deliberately does not build

`connections`, `shadchanim.connection_id`, threads, and the actual "Connections" list/360
content are **not** this story's — see 8.2 (connections + invites) and 8.5 (the CRM UI). This
story's `/connections` route (Task 2) exists in the nav from day one so the nav item never
"appears later"; **it 404s or shows nothing meaningful until 8.5 registers the resource** —
that interim state is accepted because Story 8.5 lands in the same epic before ship (Epic 1's
precedent for an accepted interim gap between two pinned-order stories, e.g. its `/tasks`
redirect discussion, is the same pattern: a documented gap between numbered stories in one
epic, not a shipped defect).

### Current-state grounding

- `layout/navItems.ts` today exports one array, `PRIMARY_NAV` — 7 items: Dashboard,
  `/shidduchim` (Pipeline), `/inbox_items` (Inbox), `/shadchanim`, `/references`, `/reminders`,
  `/settings`. The doc comment already states the "6 foundation nav destinations" design intent
  (now 7) is shared by desktop Sidebar and mobile bottom nav from one source — this story adds
  a second array to the same source, it does not fork navigation per surface.
- `root/routeManifest.ts` (Epic 1 Story 1.5) is where routes/resources are declared today as a
  single manifest consumed by `.map()` in `root/CRM.tsx` — extend it, do not add parallel JSX.

### Architecture citations

- **AD-2**: "an account is a context and carries a `kind` ∈ `household | shadchanus`... A
  shadchanus context may never contain household domain rows, enforced by CI and by scope
  checks." This story's route guard is defense-in-depth on top of that DB guarantee, not a
  replacement for it.
- **AD-19**: the active context is `member_state(user_id, active_account_id)` resolved via
  `current_context_id()`, server-held, never a client claim. This story's nav/route selection
  must read whatever client-side primitive Epic 2 exposes over that server state — never
  infer context kind from a URL param or local state.
- **UX-DR10 / UX-DR8**: "References is not a primary destination" generalises directly to
  "a connection's threads are not a primary destination" — hence no "Conversations" nav item.
- **AD-24**: every entity/screen still renders through the same shell primitives
  (`Layout.tsx`, `MobileLayout.tsx`) — this story swaps only the nav array and the routed
  dashboard component, never the shell itself.

### Dependencies

- **Epic 2 Stories 2.1 (context-aware authorisation), 2.2 (persona/context data model) and
  2.4 (context switcher)** must land first. This story has no code to write without a working
  `current_context_id()` / active-context read primitive and a UI mechanism to switch into a
  shadchanus context in the first place.
- **Epic 1** (naming) must have landed: this story writes `/singles`, `/shadchanim`, not
  `/children`.

### Testing standard

Frontend-only story: Vitest component tests per `.claude/rules/testing.md` (AAA, descriptive
names, no shared mutable state). No SQL test file — there is no schema change in this story
(see "What this story deliberately does not build").

### Project Structure Notes

New files: `layout/RequireContextKind.tsx` (+ `.test.tsx`), `dashboard/ShadchanDashboard.tsx`
(+ `.test.tsx`). Modified: `layout/navItems.ts` (+ `.test.ts`), `root/routeManifest.ts`. All
within existing directories — no new top-level folder for this story (Story 8.5 introduces
`connections/`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
