# Story 2.4: Context Switcher

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user with more than one context,
I want to switch between my household and my shadchanus from the app shell,
so that I always know which hat I am wearing and never see the wrong one by accident.

## Dependencies

**Requires Story 2.1** (`current_context_id()`, `set_active_context()`, and — critically
— the corrected `accounts`/`account_members` RLS shapes from 2.1 AC-7, without which a
user cannot even read the *name* of a context they are not currently active in).
**Requires Story 2.2** (`accounts.kind` — this story's switcher labels contexts
"Household" vs "Shadchanus" by it).

## Important: this is not the existing single-switcher

`layout/TopBar.tsx` already has a `ChildSwitcherPill` (renamed `SingleSwitcherPill` by
Story 1.3) — **that picks which single's pipeline you are viewing inside one
household**, an entirely different axis from this story. This story adds a second,
independent control that picks **which context** (household vs. shadchanus) is active
at all. Do not merge the two, do not rename the existing pill, and do not let either
control read the other's data source.

## Acceptance Criteria

1. **A user with two or more contexts sees a switcher in the app shell; a user with one
   sees nothing extra.** `useMyContexts()` (Task 2) returning fewer than 2 rows renders
   the switcher as an empty fragment — no pill, no disabled control, no visual trace —
   satisfying "a user with one context sees no switcher clutter" exactly.

2. **The current context is visible at all times.** When 2+ contexts exist, the
   switcher always renders a labelled pill showing the active context's name and kind
   (e.g. "The Klein Family · Household" or "My Shadchanus"), never a generic "Switch"
   button with no current-state label.

3. **Switching changes what every screen shows, immediately.** Selecting a different
   context calls `set_active_context(account_id)` (via the new `switchActiveContext`
   dataProvider method), then invalidates the entire React Query cache
   (`queryClient.invalidateQueries()`, the same broad invalidation
   `login/OnboardingChoice.tsx` already uses after seeding demo data — precedent, not
   invention) and navigates to `/` (the dashboard). Navigating away from whatever record
   was open avoids a stale record from the old context rendering a confusing "not
   found" in place (records live at URLs — AD-24 — and a record from the context just
   left behind is no longer one this login can resolve).

4. **A context you are not currently active in is still nameable.** The switcher lists
   every context from `useMyContexts()`, not just the active one — this is only possible
   because of 2.1 AC-7's broadened `accounts`/`account_members` policies; if this story's
   dropdown is empty or 403s for the inactive context, that is a 2.1 regression to
   report, not a UI bug to work around here.

5. **One new SQL function serves the switcher — `public.my_contexts()`.**
   `returns table(account_id bigint, kind text, name text, role text, is_active
   boolean)`, `SECURITY INVOKER`, `STABLE`, reading `account_members` joined to
   `accounts` for `auth.uid()`'s `active`-status rows only, `is_active` computed by
   comparing each row's `account_id` to `current_context_id()`. This is deliberately a
   different shape from Story 2.2's `my_personas()` (persona-oriented, one row per
   persona) — a household held for both the `parent` and `single` personas is still
   **one** context to switch to, not two.

6. **The dataProvider gains `getMyContexts()` and `switchActiveContext(accountId)`,
   mirrored in both providers (AD-10).** Same shape as `currentAccountDemo()` /
   Story 2.3's `getMyPersonas()`/`addPersona()`: thin RPC wrappers in
   `providers/supabase/dataProvider.ts` (`.rpc("my_contexts")`,
   `.rpc("set_active_context", { p_account_id: accountId })`), emulated against the
   fakerest in-memory `db` in `providers/fakerest/dataProvider.ts`.

7. **Mobile has an entry point, not a second implementation.** The desktop surface is
   `layout/TopBar.tsx` (next to, not replacing, `SingleSwitcherPill`). Mobile has no
   top-bar chrome slot for this today (`layout/MobileHeader.tsx` is a bare wrapper, and
   the existing single-switcher itself has no mobile equivalent — a pre-existing gap,
   not one this story is asked to close). **Decision:** render the same
   `ContextSwitcher` component as a new section at the top of
   `settings/SettingsPageMobile.tsx` (alongside `FamilySection`), giving mobile users a
   reachable, single, non-duplicated control rather than inventing new mobile chrome
   this story was not asked to build.

8. **User-facing copy goes through the `i18nProvider`** (AD-18): new
   `crm.context_switcher.*` keys in both message catalogues, no hardcoded strings.

9. **Toolchain green**: `make typecheck && npm run lint && make test &&
   npm run test:unit:db` (the new `my_contexts()` function needs at least a read-shape
   test — extend `context_resolution.sql` rather than adding a fourth test file for
   this domain area).

## Tasks / Subtasks

- [ ] **Task 1 — `my_contexts()`** (AC: 5)
  - [ ] `supabase/schemas/02_functions.sql`: implement per AC-5.
  - [ ] `06_grants.sql`: grant `execute` to `authenticated`, none to `anon`.
  - [ ] Migration: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        context_switcher`, hand-check grants, apply with `migration up --local`.

- [ ] **Task 2 — dataProvider + hook** (AC: 6)
  - [ ] `providers/supabase/dataProvider.ts`: `getMyContexts()`,
        `switchActiveContext(accountId)`.
  - [ ] `providers/fakerest/dataProvider.ts`: emulate both against the in-memory `db`,
        deriving `is_active` from the fake `member_state` equivalent Story 2.1 must
        already have added there (if 2.1 did not add a fakerest `member_state`
        emulation because it made no frontend change, this story is the first consumer
        and must add the minimal fake-store field itself — check before assuming it
        exists).
  - [ ] `root/useMyContexts.ts`, mirroring `root/useAccountDemo.ts` /
        `root/useMyPersonas.ts` exactly.

- [ ] **Task 3 — `ContextSwitcher` component** (AC: 1, 2, 3, 4, 7)
  - [ ] New `layout/ContextSwitcher.tsx` (extracted as its own file per the "many small
        files" convention — `TopBar.tsx` is already ~200 lines and growing with
        `SingleSwitcherPill`'s local component; do not append a second inline component
        of similar size to it).
  - [ ] Dropdown pattern mirrors `SingleSwitcherPill`'s existing
        `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent` structure for visual
        consistency, but is a **separate** component reading `useMyContexts()`, never
        `useGetList("singles")`.
  - [ ] Selecting a context calls `switchActiveContext`, then
        `queryClient.invalidateQueries()` + `navigate("/")`, per AC-3.
  - [ ] Import into `layout/TopBar.tsx` next to `SingleSwitcherPill` (both render; when
        `useMyContexts()` has fewer than 2 rows, `ContextSwitcher` renders nothing —
        AC-1 — so a single-context user's `TopBar` is visually unchanged from today).
  - [ ] Import into `settings/SettingsPageMobile.tsx` per AC-7.

- [ ] **Task 4 — Copy** (AC: 8)
  - [ ] Add `crm.context_switcher.*` keys to both message catalogues.

- [ ] **Task 5 — Tests** (AC: all)
  - [ ] Extend `supabase/tests/context_resolution.sql` with `my_contexts()` shape/read
        checks (one user, two contexts → two rows, correct `is_active`; a stranger's
        context never appears).
  - [ ] Component test for `ContextSwitcher`: renders nothing for 1 context, renders a
        labelled pill + working switch for 2, calls `switchActiveContext` then
        invalidates + navigates.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Why `my_contexts()` is not `my_personas()` reused

Story 2.2's `my_personas()` is persona-shaped: a user who is both `parent` and `single`
in the *same* household produces two rows from it, correctly, because those are two
different answers to "what am I." A switcher needs the opposite shape — one row per
**context to switch to** — or a parent-who-is-also-a-single would see their own single
household listed twice as if it were two places to go. Reusing `my_personas()` here
would be the wrong tool wearing the right badge; `my_contexts()` is a small, separate,
single-purpose function for exactly this reason, not a duplicate of 2.2's logic (it
reads the same two tables but answers a genuinely different question).

### Interaction with `SingleSwitcherPill` — verified, not a fix needed

`singles.id` is a `bigint identity` primary key, globally unique across every account —
never reused per-account. `SingleSwitcherPill`'s local `childId`/`setChildId` state
therefore fails safe across a context switch without any change: after
`invalidateQueries()` refetches `"singles"` for the new context, `selected =
childList.find((c) => c.id === childId) ?? childList[0]` falls through to `childList[0]`
because the stale id from the old context cannot coincidentally match a row in the new
one. Confirmed by reading `layout/TopBar.tsx`'s current implementation — no change is
required there, and none should be made speculatively.

### Verified current state

- `layout/TopBar.tsx` (today, 202 lines): `ChildSwitcherPill` (→ `SingleSwitcherPill`
  post-1.3) is the only pill in the bar. No context concept exists anywhere in the
  frontend today.
- `login/OnboardingChoice.tsx:64-65` — the `queryClient.invalidateQueries()` precedent
  this story's switch handler follows.
- `root/useAccountDemo.ts` — the hook shape `useMyContexts.ts` mirrors.
- `settings/SettingsPageMobile.tsx` / `settings/FamilySection.tsx` — the mobile
  insertion point and the "quiet summary section" pattern `ContextSwitcher`'s mobile
  rendering should match visually.

### Testing standards

SQL: extend `supabase/tests/context_resolution.sql` (`.claude/rules/testing.md`, AAA,
`npm run test:unit:db`). Component: Vitest + Testing Library, matching existing
`*.test.tsx` files' shape (e.g. `GoogleSignInButton.test.tsx`).

### Project Structure Notes

New file: `layout/ContextSwitcher.tsx`, `root/useMyContexts.ts`. Edited:
`layout/TopBar.tsx`, `settings/SettingsPageMobile.tsx`, both `dataProvider.ts` files,
both message catalogues, `02_functions.sql`, `06_grants.sql`. No new top-level
directory — this fits the existing `layout/`/`root/` split.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4] — "the current context is
  visible at all times," "a user with one context sees no switcher clutter."
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md#The-accounts-account_members-policy-shape]
  — the RLS precondition this story depends on.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "records live at URLs, not in modals" — the
  reasoning behind AC-3's post-switch redirect to `/`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
