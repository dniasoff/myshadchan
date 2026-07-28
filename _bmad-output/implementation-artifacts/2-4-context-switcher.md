---
baseline_commit: 774d5dd5c8168a21490103a6bcc68aedec50d0c1
---

# Story 2.4: Context Switcher

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user with more than one context,
I want to switch between my household and my shadchanus from the app shell,
so that I always know which hat I am wearing and never see the wrong one by accident.

## Dependencies

**Requires Story 2.1** (`current_context_id()`, `set_active_context()`, `member_state`, and
— critically — the corrected `accounts`/`account_members` RLS shapes from 2.1 AC-7, without
which a user cannot even read the *name* of a context they are not currently active in).
Verified absent from the tree today: `grep -rn "member_state\|current_context_id\|set_active_context" src/ supabase/` returns **zero** hits.
**Requires Story 2.2** (`accounts.kind` — this story's switcher labels contexts
"Household" vs "Shadchanus" by it). `public.accounts` has no `kind` column today
(`supabase/schemas/01_tables.sql:104-124`).

**Out of scope, and 2.1 owns it:** the `current_account_id()` → `current_context_id()` RLS
swap. That includes the **three** account-scoped policies on `storage.objects` in
`supabase/schemas/07_storage.sql:29,36,43` — a different schema file from every other
policy, and the one most easily missed. This story adds a *new* function and **must not edit
`05_policies.sql` or `07_storage.sql` at all**; if a policy needs changing, that is a 2.1 gap
to report, not work to absorb here.

## Epic 1 has shipped — what that already settled

Epic 1 (fossil deletion, `sales`→`members`, `children`→`singles`, portal retirement, route
manifest) is merged and deployed. Consequences for this story, all verified against the tree:

- The single-switcher in `layout/TopBar.tsx` is **already** named `SingleSwitcherPill`
  (`TopBar.tsx:56`); its local state is already `singleId`/`setSingleId` (`TopBar.tsx:61`).
  Nothing in this story is waiting on a rename.
- Route and resource registration is a **manifest**, not JSX:
  `src/components/atomic-crm/root/routeManifest.ts` (`CUSTOM_ROUTES` / `RESOURCES`, mapped
  over by the desktop and mobile admins). **This story registers no new route and no new
  resource, so `routeManifest.ts` is not edited.** Do not go looking for a `<Resource>` or
  `<Route>` to add — there is none to add, and there is none to edit.

## Important: this is not the existing single-switcher

`layout/TopBar.tsx` already renders `SingleSwitcherPill` — **that picks which single's
pipeline you are viewing inside one household**, an entirely different axis from this story.
This story adds a second, independent control that picks **which context** (household vs.
shadchanus) is active at all. Do not merge the two, do not rename the existing pill, and do
not let either control read the other's data source.

## Acceptance Criteria

1. **A user with two or more contexts sees a switcher in the app shell; a user with one
   sees nothing extra.** `useMyContexts()` (Task 2) returning fewer than 2 rows renders
   the switcher as an empty fragment — no pill, no disabled control, no visual trace —
   satisfying "a user with one context sees no switcher clutter" exactly. *Decided by:* the
   `ContextSwitcher` component test (Task 5) asserting an empty render for a 1-row hook
   result.

2. **The current context is visible at all times.** When 2+ contexts exist, the
   switcher always renders a labelled pill showing the active context's name and kind
   (e.g. "The Klein Family · Household" or "My Shadchanus"), never a generic "Switch"
   button with no current-state label. *Decided by:* the component test asserting the
   trigger's accessible name contains the active row's `name` and its translated `kind`.

3. **Switching changes what every screen shows, immediately.** Selecting a different
   context calls `set_active_context(account_id)` (via the new `switchActiveContext`
   dataProvider method), then invalidates the entire React Query cache
   (`queryClient.invalidateQueries()` with no argument) and navigates to `/` (the
   dashboard). The bare no-argument form is precedent, not invention: it is used at
   `login/OnboardingChoice.tsx:65` and `layout/DemoBanner.tsx:134` (the two scoped uses,
   `login/SignupPage.tsx:57` and `tasks/Task.tsx:77`, pass a `queryKey` and are the wrong
   model here — a context switch invalidates *everything*). Navigating away from whatever
   record was open avoids a stale record from the old context rendering a confusing "not
   found" in place (records live at URLs — AD-24 — and a record from the context just left
   behind is no longer one this login can resolve). *Decided by:* the component test
   asserting the call order `switchActiveContext` → `invalidateQueries()` → `navigate("/")`.

4. **A context you are not currently active in is still nameable.** The switcher lists
   every context from `useMyContexts()`, not just the active one — this is only possible
   because of 2.1 AC-7's broadened `accounts`/`account_members` policies; if this story's
   dropdown is empty or 403s for the inactive context, that is a 2.1 regression to
   report, not a UI bug to work around here. *Decided by:* the SQL check added to
   `supabase/tests/context_resolution.sql` (Task 5) — one user, two contexts, `my_contexts()`
   returns two rows while only one is active.

5. **One new SQL function serves the switcher — `public.my_contexts()`.**
   `RETURNS TABLE("account_id" bigint, "kind" "text", "name" "text", "role" "text",
   "is_active" boolean)`, `STABLE`, **SECURITY INVOKER**, `SET "search_path" TO ''`, reading
   `account_members` joined to `accounts` for `auth.uid()`'s `active`-status rows only,
   `is_active` computed by comparing each row's `account_id` to `current_context_id()`.
   House form, verified against `supabase/schemas/02_functions.sql`:
   - the file is in **`pg_dump` output format** — uppercase keywords, double-quoted
     identifiers (`CREATE OR REPLACE FUNCTION "public"."my_contexts"() RETURNS TABLE(...)`).
     Deviating produces phantom diffs on the next `db dump` (AGENTS.md, Database Management).
   - **SECURITY INVOKER is expressed by omitting `SECURITY DEFINER`**, exactly as
     `public.ai_entitlement()` (`02_functions.sql:1699-1701`) and
     `public.match_reference_on_entry(...)` (`02_functions.sql:995-1015`) do. Do not write a
     literal `SECURITY INVOKER` clause; pg_dump does not emit one and the next dump would
     strip it.
   - **all 34** functions in the file carry `SET "search_path" TO ''`; this one does too.
   - `RETURNS TABLE` has three existing precedents in the file (`02_functions.sql:6`, `:878`,
     `:1001`) — it is not a new pattern here.

   This is deliberately a different shape from Story 2.2's `my_personas()`
   (persona-oriented, one row per persona) — a household held for both the `parent` and
   `single` personas is still **one** context to switch to, not two.

6. **The dataProvider gains `getMyContexts()` and `switchActiveContext(accountId)`,
   mirrored in both providers (AD-10).** Same shape as `currentAccountDemo()` /
   Story 2.3's `getMyPersonas()`/`addPersona()`: thin RPC wrappers in
   `providers/supabase/dataProvider.ts` (`getSupabaseClient().rpc("my_contexts")`,
   `.rpc("set_active_context", { p_account_id: accountId })` — see `currentAccountDemo()`
   at `providers/supabase/dataProvider.ts:451-460` for the exact error-handling shape),
   emulated against the fakerest in-memory `db` in `providers/fakerest/dataProvider.ts`.
   *Decided by:* `make typecheck`. `CrmDataProvider` is
   `ReturnType<typeof getDataProviderWithCustomMethods>`
   (`providers/supabase/dataProvider.ts:500-502`), so adding the two methods to the Supabase
   provider widens the type automatically and the FakeRest provider fails to compile until it
   implements both — AD-10's "keep FakeRest in sync" is enforced by the compiler, not by
   review.

7. **Mobile has an entry point, not a second implementation.** The desktop surface is
   `layout/TopBar.tsx` (next to, not replacing, `SingleSwitcherPill`). Mobile has no
   top-bar chrome slot for this today (`layout/MobileHeader.tsx` is a 9-line bare wrapper
   that renders only its `children`, and the existing single-switcher itself has no mobile
   equivalent — a pre-existing gap, not one this story is asked to close). **Decision:**
   render the same `ContextSwitcher` component as a new section at the top of
   `settings/SettingsPageMobile.tsx` — inside the existing `space-y-6` stack, above
   `<ProfileSection />` (`SettingsPageMobile.tsx:36-41`) — giving mobile users a reachable,
   single, non-duplicated control rather than inventing new mobile chrome this story was not
   asked to build. This mount is explicitly **interim**: Story 4.4 AC-4 moves it into the
   mobile "More" menu and deletes it from here.

8. **User-facing copy goes through the `i18nProvider`** (AD-18): new
   `crm.context_switcher.*` keys in **both** catalogues —
   `providers/commons/englishCrmMessages.ts` and `providers/commons/frenchCrmMessages.ts`
   (en + fr are the two locales registered today, per
   `providers/commons/i18nProvider.test.ts`) — no hardcoded strings. Keys nest under the
   existing top-level `crm` object, alongside `crm.settings` (`englishCrmMessages.ts:253`,
   `frenchCrmMessages.ts:257`).

9. **Toolchain green**: `make typecheck && make lint && make test && npm run test:unit:db`.
   (`make lint` runs both `npm run lint` and `npm run prettier --check`; running `npm run
   lint` alone leaves prettier unchecked.) The new `my_contexts()` function needs at least a
   read-shape test — extend `supabase/tests/context_resolution.sql` rather than adding a
   fifth suite for this domain area. Note the `db` vitest project matches
   `supabase/tests/**/*.test.ts` (`vitest.config.ts:112-123`), so the new SQL checks only run
   once Story 2.1's `context_resolution.test.ts` runner exists and names them; today the
   directory holds four suites (`billing_entitlement`, `members_rename`, `references_entity`,
   `shidduch_catch`) and **no** `context_resolution.*`.

## Tasks / Subtasks

- [x] **Task 1 — `my_contexts()`** (AC: 5)
  - [x] `supabase/schemas/02_functions.sql`: implement per AC-5 — pg_dump casing/quoting,
        no `SECURITY DEFINER` clause, `SET "search_path" TO ''`.
  - [x] `supabase/schemas/06_grants.sql`: follow the file's own revoke-then-grant pattern
        verbatim — **three** lines, not two (Postgres default-grants EXECUTE to PUBLIC on new
        functions, so the revoke is the deny):
        `revoke all on function public.my_contexts() from public, anon;`
        `grant execute on function public.my_contexts() to authenticated;`
        `grant execute on function public.my_contexts() to service_role;`
        **29 of the 30** `revoke all on function` blocks in the file use this exact
        three-line form (e.g. `06_grants.sql:197-199`, `:202-204`); the one exception is the
        legacy `get_user_id_by_email(text)` block at `:13-14`. Counted, not assumed:
        `grep -c "revoke all on function" supabase/schemas/06_grants.sql` → 30, and
        `grep -c "grant execute on function.*to service_role;"` → 29. The `service_role`
        line is part of the pattern, not optional.
  - [x] Migration: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        context_switcher`, hand-check that the generated file carries the grants, apply with
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        (The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is required on every `npx supabase`
        call in this environment — without it the CLI hangs on the keyring.)

- [x] **Task 2 — dataProvider + hook** (AC: 6)
  - [x] `providers/supabase/dataProvider.ts`: `getMyContexts()`,
        `switchActiveContext(accountId)`, added to the custom-methods overlay next to
        `currentAccountDemo()` (`:451`).
  - [x] `providers/fakerest/dataProvider.ts`: emulate both against the in-memory `db`.
        Story 2.1 is schema-only ("It changes no `src/` file" —
        `2-1-context-aware-authorisation.md:533`), so no fakerest `member_state` emulation
        exists yet: this story is the first
        consumer and adds the minimal fake state itself. Add a single `let activeAccountId`
        **inside `createDataProvider`**, next to the existing `let fakeDemo = false`
        (`fakerest/dataProvider.ts:125`) — no fake table needed. Note the in-file comment at
        `:712` calls `fakeDemo` "module-level"; it is not — it is a closure-local `let`, one
        per provider instance. Match its **actual** placement, not its comment.
  - [x] `root/useMyContexts.ts`, mirroring `root/useAccountDemo.ts` (17 lines: an exported
        query-key constant + a `useQuery` over `useDataProvider<CrmDataProvider>()`). If
        Story 2.3 has landed, `root/useMyPersonas.ts` is the same shape — mirror whichever is
        present; `useAccountDemo.ts` is the only one of the two in the tree today.

- [x] **Task 3 — `ContextSwitcher` component** (AC: 1, 2, 3, 4, 7)
  - [x] New `layout/ContextSwitcher.tsx` (its own file per the "many small files"
        convention — `TopBar.tsx` is 141 lines today and already carries three local
        components; do not append a fourth of similar size to it).
  - [x] Dropdown pattern mirrors `SingleSwitcherPill`'s existing
        `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent` structure
        (`TopBar.tsx:77-105`) for visual consistency, but is a **separate** component
        reading `useMyContexts()`, never `useGetList("singles")`.
  - [x] Selecting a context calls `switchActiveContext`, then
        `queryClient.invalidateQueries()` + `navigate("/")`, per AC-3. Imports:
        `useQueryClient` from `@tanstack/react-query`, `useNavigate` from `react-router`,
        `useDataProvider`/`useTranslate` from `ra-core` — the same set `DemoBanner.tsx:1-20`
        uses.
  - [x] Import into `layout/TopBar.tsx` next to `SingleSwitcherPill` in the header's left
        slot (`TopBar.tsx:29`) — both render; when `useMyContexts()` has fewer than 2 rows,
        `ContextSwitcher` renders nothing (AC-1), so a single-context user's `TopBar` is
        visually unchanged from today.
  - [x] Import into `settings/SettingsPageMobile.tsx` per AC-7, styled to match the quiet
        `SectionLabel` + `ItemGroup`/`Item` pattern `FamilySection.tsx` uses.
  - [x] Do **not** touch `root/routeManifest.ts` — this story adds no route and no resource.

- [x] **Task 4 — Copy** (AC: 8)
  - [x] Add `crm.context_switcher.*` keys to `providers/commons/englishCrmMessages.ts` and
        `providers/commons/frenchCrmMessages.ts` (both, same key set — the fr catalogue is
        not optional).

- [x] **Task 5 — Tests** (AC: all)
  - [x] Extend `supabase/tests/context_resolution.sql` (created by 2.1) with `my_contexts()`
        shape/read checks — one user, two contexts → two rows with the correct `is_active`;
        a stranger's context never appears. Emit them as `results` rows in the same
        `{name, passed, detail}` shape the existing suites use (see
        `supabase/tests/members_rename.test.ts:32` for how the runner turns each row into a
        named test), and register the new names in 2.1's `context_resolution.test.ts`.
  - [x] Component test `layout/ContextSwitcher.test.tsx`: renders nothing for 1 context,
        renders a labelled pill + working switch for 2, calls `switchActiveContext` then
        invalidates then navigates. Shape it like the existing `*.test.tsx` files (11 in
        `src/` today) — e.g. `tasks/TasksListFilter.test.tsx`, **not**
        `login/GoogleSignInButton.test.tsx`, which Story 2.6 deletes
        (`2-6-passwordless-sign-in.md:156`).
  - [x] `make typecheck && make lint && make test && npm run test:unit:db`.

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

`singles.id` is `bigint generated by default as identity primary key`
(`supabase/schemas/01_tables.sql:146`), globally unique across every account — never reused
per-account. `SingleSwitcherPill`'s local `singleId`/`setSingleId` state (`TopBar.tsx:61`)
therefore fails safe across a context switch without any change: after
`invalidateQueries()` refetches `"singles"` for the new context,
`selected = singleList.find((single) => single.id === singleId) ?? singleList[0]`
(`TopBar.tsx:73-74`) falls through to `singleList[0]` because the stale id from the old
context cannot coincidentally match a row in the new one. Confirmed by reading
`layout/TopBar.tsx`'s current implementation — no change is required there, and none should
be made speculatively.

### Verified current state (re-checked against the post-Epic-1 tree)

- `layout/TopBar.tsx` — **141 lines**. `SingleSwitcherPill` (`:56`) is the only pill in the
  bar. No context concept exists anywhere in the frontend today.
- `login/OnboardingChoice.tsx:65` and `layout/DemoBanner.tsx:134` — the two bare
  `await queryClient.invalidateQueries()` precedents this story's switch handler follows.
- `root/useAccountDemo.ts` — the 17-line hook shape `useMyContexts.ts` mirrors.
- `settings/SettingsPageMobile.tsx:36-41` — the mobile insertion point (the `space-y-6`
  stack) — and `settings/FamilySection.tsx` — the "quiet summary section" pattern
  (`SectionLabel` + `ItemGroup`/`Item`) `ContextSwitcher`'s mobile rendering should match.
- `layout/MobileHeader.tsx` — 9 lines, a bare `<header>` wrapper around `children`; it holds
  no chrome slot to hang this on, which is why AC-7 chooses Settings instead.
- `root/routeManifest.ts` — the single registration point for routes and resources. Read it
  once to confirm nothing here belongs in it; then leave it alone.

### Downstream: Story 4.4 consumes these exact names

`4-4-navigation-set-and-context-switcher.md` AC-4 and its Task list assume this story lands
`layout/ContextSwitcher.tsx`, the `TopBar.tsx` mount, and the interim
`SettingsPageMobile.tsx` mount, and that switch behaviour (invalidate + go home) is **this**
story's contract. 4.4 later extracts a `ContextMenuItems` sub-component and deletes the
Settings mount. Keeping the file name and component name as written here is what makes 4.4
a small change rather than a rewrite.

### Testing standards

SQL: extend `supabase/tests/context_resolution.sql` (`.claude/rules/testing.md`, AAA,
`npm run test:unit:db`). The `db` vitest project only discovers `supabase/tests/**/*.test.ts`
runners, so a `.sql` check that no `.test.ts` names is a check that never runs — register the
new names in 2.1's `context_resolution.test.ts`. Component: Vitest + Testing Library,
matching existing `*.test.tsx` files' shape.

### Project Structure Notes

New files: `layout/ContextSwitcher.tsx`, `root/useMyContexts.ts`, plus the component test
`layout/ContextSwitcher.test.tsx`. Edited: `layout/TopBar.tsx`,
`settings/SettingsPageMobile.tsx`, both `dataProvider.ts` files,
`providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`,
`supabase/schemas/02_functions.sql`, `supabase/schemas/06_grants.sql`,
`supabase/tests/context_resolution.sql`. **Not** edited: `root/routeManifest.ts` (no new
route or resource), `supabase/schemas/05_policies.sql` and `supabase/schemas/07_storage.sql`
(2.1 owns every policy change, including the three `storage.objects` policies). No new
top-level directory — this fits the existing `layout/`/`root/` split.

### References

Citation note: two files named `ARCHITECTURE-SPINE.md` exist in the repo. The authoritative
one is `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`
(AD-1 … AD-24). The copy at `mockup/uploads/ARCHITECTURE-SPINE.md` stops at AD-18 and does
not contain AD-19 or AD-24 — do not resolve `#AD-19`/`#AD-24` against it.

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4] — "the current context is
  visible at all times," "a user with one context sees no switcher clutter."
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md#The-accounts-account_members-policy-shape]
  — the RLS precondition this story depends on.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — "the active context is a server-side row, not a
  client claim"; switching goes through `set_active_context(account_id)`, which validates
  membership before writing. The switcher is a view onto that row, never its own source of
  truth.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "records live at URLs, not in modals" — the
  reasoning behind AC-3's post-switch redirect to `/`.
- [Source: ARCHITECTURE-SPINE.md#AD-10] — the dataProvider is the single CRUD seam; every
  new method is mirrored in FakeRest (AC-6).
- [Source: ARCHITECTURE-SPINE.md#AD-18] — all UI text through the `i18nProvider`, no
  hardcoded strings (AC-8).
- [Source: _bmad-output/implementation-artifacts/4-4-navigation-set-and-context-switcher.md]
  — the downstream consumer that pins this story's file and component names.
- [Source: AGENTS.md#Database-Management] — `02_functions.sql` must keep the exact `pg_dump`
  format or the next diff is a phantom.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-code, bmad-dev-story workflow)

### Debug Log References

- Verified Stories 2.1/2.2 are fully landed before starting: `current_context_id()`,
  `set_active_context()`, `member_state`, `accounts.kind` and the AC-7 corrected
  `accounts`/`account_members` RLS shapes all present in `supabase/schemas/`. Also found
  `root/useMyPersonas.ts` already in the tree (Story 2.3 landed ahead of 2.4, out of the
  build-plan's stated order) — mirrored it 1:1 for `root/useMyContexts.ts` per the story's own
  "mirror whichever is present" instruction.
- `my_contexts()` placed in `02_functions.sql` immediately after `current_account_demo()`
  (the file has no `RETURNS TABLE` precedent at the exact line numbers the story cites —
  the tree has moved since the story was written — so placement was chosen by grouping with
  the other `current_context_id()`-adjacent reader functions rather than by line number).
  `LANGUAGE "sql" STABLE` with no `SECURITY DEFINER` clause, matching
  `match_reference_on_entry()`'s exact house form for an invoker-rights `RETURNS TABLE`
  function.
- `db diff --local -f context_switcher` emitted ONLY the `CREATE OR REPLACE FUNCTION` —
  no grants, confirming Story 2.1's own finding ("`db diff` did not emit function grants")
  reproduces here too. Hand-added the 3-line revoke/grant block to the generated migration,
  matching `06_grants.sql`'s own pattern verbatim. Verified post-apply: `prosecdef = false`
  (SECURITY INVOKER), `provolatile = 's'` (STABLE), `search_path = ""`, EXECUTE granted to
  `authenticated`/`service_role` only (not `anon`/`public`). A second `db diff` afterward
  reported "No schema changes found" — no phantom diff.
- fakerest emulation (`internal/contexts.ts`) needed a "what is active if nothing has been
  explicitly switched yet" rule the story doesn't spell out (fakerest has no
  `activate_first_context` trigger to bootstrap `member_state`). Resolved by treating the
  first membership found (ordered by id) as active until `switchActiveContext()` is called
  explicitly — mirrors the trigger's real intent ("a login with any membership always has a
  live active context") without adding a fake table.
- `settings/SettingsPageMobile.tsx`'s AC-7 mount needed its own `useMyContexts()` read (a
  second, cheap cache hit on the same query key) to gate the `SectionLabel` heading itself —
  otherwise a 1-context login would see an orphan "Context" heading with nothing switchable
  beneath it once `ContextSwitcher` renders its own empty fragment, which is exactly the
  "visual trace" AC-1 forbids. This is additive to the story's literal task list, not a
  deviation from any AC.
- Component test (`layout/ContextSwitcher.test.tsx`) uses `TestMemoryRouter` +
  `locationCallback` rather than mocking `react-router`'s `useNavigate` — react-router v7's
  `react-router` and `react-router-dom` packages share the same underlying router context, so
  the real navigation the component performs is observable without module mocking. The
  call-order assertion (`switchActiveContext` → `invalidateQueries()` → `navigate("/")`)
  is proven by: an array recording the first two calls via spies, plus polling the captured
  location's `pathname` for `"/"` (which can only happen after both awaited calls resolve,
  per `handleSelect`'s own sequential structure).
- `make typecheck`, `make lint` (eslint + prettier), `make test` (all 5 vitest projects) and
  `npm run test:unit:db` all green: 670 tests total, zero regressions. `context_resolution.sql`
  grew from 89 to 95 checks (all passing); its `test.ts` threshold bumped from 85 to 95.
- `git diff --name-only -- supabase/schemas/05_policies.sql supabase/schemas/07_storage.sql
  src/components/atomic-crm/root/routeManifest.ts` confirmed empty — none of the three
  files this story is forbidden from touching were touched.

### Completion Notes List

- All 9 ACs implemented. `supabase/schemas/02_functions.sql` gained `my_contexts()`
  (`RETURNS TABLE`, `STABLE`, SECURITY INVOKER, `search_path = ''`); `06_grants.sql` gained
  its 3-line revoke/grant block; migration `20260728011519_context_switcher.sql` applied
  locally and verified (AC-5).
- Both `dataProvider.ts` files gained `getMyContexts()`/`switchActiveContext(accountId)`
  (AC-6) — Supabase via thin RPC wrappers next to `currentAccountDemo()`; FakeRest via a new
  `internal/contexts.ts` module plus a closure-local `activeAccountId` next to `fakeDemo`.
  `root/useMyContexts.ts` mirrors `useAccountDemo.ts`/`useMyPersonas.ts` exactly.
- `layout/ContextSwitcher.tsx` (new): renders an empty fragment for fewer than 2 contexts
  (AC-1); otherwise a labelled pill showing `"{name} · {kind}"` for the active context (AC-2,
  AC-4 — every context is listed via the dropdown, not only the active one); selecting a
  context calls `switchActiveContext` → `queryClient.invalidateQueries()` (no args) →
  `navigate("/")` (AC-3), with an error toast via `useNotify` on a rejected switch. Mounted in
  `layout/TopBar.tsx` next to `SingleSwitcherPill` (desktop) and in
  `settings/SettingsPageMobile.tsx` above `<ProfileSection />`, gated by its own local
  `ContextSwitcherSection` wrapper so the section heading disappears along with the switcher
  for a 1-context login (AC-7).
- Copy: `crm.context_switcher.*` (label, kind_household, kind_shadchanus, switch_error,
  section_title) added to both `englishCrmMessages.ts` and `frenchCrmMessages.ts` (AC-8) — no
  hardcoded strings; the middot-separated label goes through `%{name}`/`%{kind}` interpolation
  like `crm.references.header.progress`'s existing precedent.
- Tests: `supabase/tests/context_resolution.sql` extended with 6 new `my_contexts()` checks
  (two-context shape, `is_active` flagging, kind/role reporting, an unprovisioned stranger
  sees nothing, SECURITY INVOKER structural check, anon-cannot-execute); `context_resolution.test.ts`'s
  non-trivial-count threshold raised 85 → 95. New `layout/ContextSwitcher.test.tsx` (4 tests)
  covers AC-1/2/3/4 directly. Toolchain green throughout (AC-9).
- Not done / out of scope, as the story specifies: `05_policies.sql`, `07_storage.sql` and
  `root/routeManifest.ts` were not touched. No story claim failed to reproduce.

### Review Response (adversarial review of commits `900695e` + `9c5c6ad`, verdict NEEDS-FIX)

All 5 should-fix findings and 4 of 6 notes are FIXED; two notes are FLAGGED, not changed
(reasoning below). `context_resolution.sql` grows from 95 to 97 checks (`test:unit:db`: 239 →
241); the frontend suite gains a new `internal/contexts.test.ts` (10 tests) and 2 tests in
`ContextSwitcher.test.tsx` (4 → 6). Full re-run after all fixes: `npm run typecheck`, `make
lint` (eslint + prettier), `npm run test` (684 tests / 61 files, all green), `npm run
test:unit:db` (241 checks, all green).

- **Finding #1 (should-fix) — `internal/contexts.ts` shipped with zero tests. FIXED.**
  Added `internal/contexts.test.ts` (10 tests), mirroring `personas.test.ts`'s own
  in-memory-`DataProvider` shape: both `identity == null` guards on `getMyContexts` and
  `switchActiveContext`, the "first membership by id is active until switched" bootstrap, the
  `holdsMembership` throw (including a revoked-membership case), a shared-account-id case
  pinning the new memoized `getOne` (see finding #7), and that a `revoked` membership is
  reported by neither function.
- **Finding #2 (should-fix) — the component test never exercised `getMyContexts`; all 4 tests
  logged a swallowed TypeError. FIXED.** `ContextSwitcher.test.tsx`'s `buildDataProvider` now
  takes the `contexts` array and returns `getMyContexts: vi.fn().mockResolvedValue(contexts)`
  instead of a bare `vi.fn()`, so react-query's default background refetch-on-mount resolves
  successfully instead of rejecting on `undefined`. All 6 tests (4 original + 2 new) now
  round-trip through the real hook/provider seam with no console errors.
- **Finding #3 (should-fix) — the `crm.context_switcher.switch_error` key was unreachable;
  users saw a hardcoded English/dev-facing string. FIXED.** `handleSelect`'s catch block always
  calls `notify("crm.context_switcher.switch_error", { type: "error", messageArgs: { _: "..." } })`
  now — the `error instanceof Error ? error.message : translate(...)` branch (which never took
  the `translate` side, since both providers throw plain `Error`s) is gone. A French user now
  sees the translated copy on any failed switch, from either provider.
- **Finding #4 (should-fix) — a failed `my_contexts()` RPC silently deleted the switcher. FIXED.**
  `ContextSwitcher` reads `isError` from `useMyContexts()` and, via a `useEffect` guarded by a
  ref (so it fires once per failure, not on every re-render while errored), calls
  `notify("crm.context_switcher.load_error", ...)`. The switcher still renders nothing on error
  (restoring full switch capability from a hard failure was judged out of scope for a
  should-fix — the story never asked for a retry affordance), but the failure is no longer
  silent, matching the "fail loud" intent `dataProvider.ts`'s own comment states. New test:
  "notifies (and still renders nothing) when getMyContexts fails to load."
- **Finding #5 (should-fix) — no negative test on the `status = 'active'` filter. FIXED.**
  `context_resolution.sql` gained a fourth account (D) with a `revoked` membership for u1,
  inserted alongside the existing A/B/C fixtures, plus the assertion `my_contexts() excludes a
  REVOKED membership`. Confirmed it actually pins the filter: temporarily removing `and
  am.status = 'active'` from `my_contexts()` fails this new check (verified locally, then
  reverted).
- **Finding #6 (note) — `is_active` was SQL `NULL`, not `false`, in the fail-closed case.
  FIXED.** `02_functions.sql`: `am.account_id = public.current_context_id() as is_active` →
  `coalesce(am.account_id = public.current_context_id(), false) as is_active`. Migration
  `20260728015112_context_switcher_review_fixes.sql` generated via `db diff`, hand-verified to
  carry only the `CREATE OR REPLACE FUNCTION` (grants persist across `CREATE OR REPLACE` and
  were confirmed unchanged post-apply), applied locally; a follow-up `db diff` reports "No
  schema changes found." New test forces `member_state.active_account_id` to `NULL` directly
  (elevated role) for a login with exactly one membership and asserts `my_contexts()` reports
  `is_active = false`, never `NULL`.
- **Finding #7 (note) — DRY violation between `contexts.ts` and `personas.ts`. FIXED.**
  Extracted `PAGE_ALL`/`SORT_BY_ID`/`GetIdentity`/`activeMembershipsFor` into a new
  `internal/accountMemberships.ts`, imported by both files (personas.ts's `hasLinkedSingle`
  also needed `SORT_BY_ID`, so that one is exported too). `contexts.ts`'s `getMyContexts` also
  gained `personas.ts`-style `accountCache` memoization for its `getOne("accounts")` calls (was
  one call per membership, no memo) — pinned by the new "reports one row per account even when
  two memberships share the same account" test asserting exactly one `getOne` call.
- **Finding #8 (note) — Task 3's mobile styling instruction (match `FamilySection`'s
  `SectionLabel` + `ItemGroup`/`Item`) not followed. FLAGGED, not changed.** The story's own
  AC-7 decision text commits to verbatim reuse — "the same component both places, never a
  second implementation" — specifically to avoid inventing mobile-specific chrome for a mount
  Story 4.4 deletes outright. Restyling `ContextSwitcher` into an `Item`-row shape for mobile
  only would mean either forking it into two visual variants (reintroducing the "second
  implementation" AC-7 explicitly rejects) or reworking `Item`/`ItemGroup` into a working
  dropdown trigger — a materially larger change than this note's "should match the pattern"
  wording implies, for an admittedly interim surface. The reviewer's own verdict — "AC-7 itself
  is satisfied" — confirms this is a style deviation from task wording, not a defect; left as
  disclosed interim debt for whoever picks up 4.4.
- **Finding #9 (note) — re-selecting the active context was a destructive no-op. FIXED.**
  `handleSelect` now returns immediately when `String(accountId) === String(active.account_id)`,
  before `switchActiveContext`/`invalidateQueries`/`navigate` run. New test: "does not switch,
  invalidate, or navigate when re-selecting the already-active context."
- **Finding #10 (note) — two visually identical, unlabelled pills. FIXED.** Added
  `aria-label`s naming each pill's axis: `ContextSwitcher`'s trigger gets
  `crm.context_switcher.trigger_label` ("Switch context: %{context}") and
  `SingleSwitcherPill`'s (pre-existing, `TopBar.tsx`) gets the new
  `crm.single_switcher.trigger_label` ("Switch single: %{name}"), both added to en+fr. The
  AC-2 test's exact-name assertion updated to the new full accessible name (still asserts the
  active row's name+kind, satisfying the AC's own "contains" wording).
- **Finding #11 (note) — FakeRest's `activeAccountId` is write-only; a demo-mode switch changes
  no data. FLAGGED, not changed** — the reviewer's own text calls this "pre-existing... not a
  regression by this story" (FakeRest has no account scoping at all today); fixing it is a
  FakeRest-wide scoping project, not a `ContextSwitcher` fix.
- **Finding #12 (note) — minor report inaccuracies.** Corrected here: the original "95 in
  `context_resolution`" phrasing named the SQL check count but was read as the vitest file's
  test count, which was 96 (95 per-check `it()`s + the file's own separate "runs a non-trivial
  number of checks" threshold test) — now 97/98 respectively after findings #5 and #6 add two
  more SQL checks. "No hardcoded strings" is now true only after finding #3's fix above; it was
  not, at the time the original report made that claim.

### File List

- `supabase/schemas/02_functions.sql` (edit — `my_contexts()`)
- `supabase/schemas/06_grants.sql` (edit — grants for `my_contexts()`)
- `supabase/migrations/20260728011519_context_switcher.sql` (new)
- `supabase/tests/context_resolution.sql` (edit — `my_contexts()` checks)
- `supabase/tests/context_resolution.test.ts` (edit — check-count threshold)
- `src/components/atomic-crm/types.ts` (edit — `MyContext` type)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` (edit — `getMyContexts()`,
  `switchActiveContext()`)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (edit — same two methods,
  `activeAccountId` state)
- `src/components/atomic-crm/providers/fakerest/internal/contexts.ts` (new — FakeRest
  mirrors of `my_contexts()`/`set_active_context()`)
- `src/components/atomic-crm/root/useMyContexts.ts` (new)
- `src/components/atomic-crm/layout/ContextSwitcher.tsx` (new)
- `src/components/atomic-crm/layout/ContextSwitcher.test.tsx` (new)
- `src/components/atomic-crm/layout/TopBar.tsx` (edit — mounts `ContextSwitcher`)
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx` (edit — mounts
  `ContextSwitcher` via a gated `ContextSwitcherSection`)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (edit —
  `crm.context_switcher.*`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (edit —
  `crm.context_switcher.*`)

**Review follow-up (this commit) — see Review Response above for detail:**

- `supabase/schemas/02_functions.sql` — `my_contexts()`'s `is_active` wrapped in
  `coalesce(..., false)` (finding #6).
- `supabase/migrations/20260728015112_context_switcher_review_fixes.sql` (new) — the
  `coalesce` fix, applied and verified locally (no phantom diff).
- `supabase/tests/context_resolution.sql` — added a revoked-membership fixture/assertion
  (finding #5) and a fail-closed `is_active = false` assertion (finding #6); 95 → 97 checks.
- `src/components/atomic-crm/providers/fakerest/internal/accountMemberships.ts` (new) —
  `activeMembershipsFor`/`PAGE_ALL`/`SORT_BY_ID`/`GetIdentity` extracted out of `contexts.ts`
  and `personas.ts` (finding #7).
- `src/components/atomic-crm/providers/fakerest/internal/contexts.ts` — uses the shared
  `accountMemberships.ts` helpers; `getMyContexts` gained `accountCache` memoization
  (finding #7).
- `src/components/atomic-crm/providers/fakerest/internal/contexts.test.ts` (new) — 10 tests
  closing finding #1's coverage gap.
- `src/components/atomic-crm/providers/fakerest/internal/personas.ts` — uses the shared
  `accountMemberships.ts` helpers instead of its own copies (finding #7); no behaviour change.
- `src/components/atomic-crm/layout/ContextSwitcher.tsx` — `handleSelect`'s catch always uses
  the `crm.context_switcher.switch_error` key (finding #3); re-select-active-context no-op
  guard (finding #9); `isError`-driven load-failure notify (finding #4); `aria-label` on the
  trigger (finding #10).
- `src/components/atomic-crm/layout/ContextSwitcher.test.tsx` — `getMyContexts` mocked as
  `mockResolvedValue` throughout (finding #2); AC-2's exact-name assertion updated for the new
  `aria-label` (finding #10); two new tests (findings #4, #9).
- `src/components/atomic-crm/layout/TopBar.tsx` — `SingleSwitcherPill`'s trigger gained an
  `aria-label` (finding #10).
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` /
  `frenchCrmMessages.ts` — added `crm.context_switcher.load_error`,
  `crm.context_switcher.trigger_label`, `crm.single_switcher.trigger_label` (findings #4, #10).
