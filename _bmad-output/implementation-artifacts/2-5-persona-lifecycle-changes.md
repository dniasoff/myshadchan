# Story 2.5: Personas Change Over a Lifetime

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user whose circumstances change,
I want to add or remove a persona at any time from Settings,
so that the app follows my life rather than my signup day, and nothing I have already
recorded is ever lost by the change.

## Dependencies

**Requires Story 2.1** (`member_state`, `current_context_id()`, `set_active_context()`,
the private writer `activate_context_for()`, and the
`supabase/tests/context_resolution.sql` + `context_resolution.test.ts` pair this story
extends — none of those exist in the tree today).
**Requires Story 2.2** (`add_persona()`, `my_personas()`, `enforce_household_scope()`,
and the extension of `account_members_role_check` to include the `single` role — today
the constraint at `01_tables.sql:139-141` lists only four roles).
**Requires Story 2.3** (`login/PersonaChecklist.tsx`, `root/useMyPersonas.ts`,
`dataProvider.addPersona()` — this story imports them, it does not rebuild them).
Independent of 2.4/2.6/2.7/2.8.

**Epic 1 baseline (already merged and deployed).** This story targets the post-Epic-1
tree: `sales` → `members`, `children` → `singles`, `child_id` → `single_id`, `sales_id`
→ `member_id`, the seven fork fossils and the token portal deleted, and route/resource
registration moved out of JSX into `src/components/atomic-crm/root/routeManifest.ts`.
Nothing in this story reintroduces or edits any of that; the note exists so no task goes
hunting for a retired name.

## Acceptance Criteria

1. **Adding a persona later needs no re-registration.** Settings renders
   `PersonaChecklist` (Story 2.3) pre-checked from `useMyPersonas()`. Ticking a
   previously-unchecked box calls `add_persona()` immediately — each toggle is its own
   committed action, no separate "save" step. The Settings precedent is
   `PreferencesSection.tsx`, whose language `Select` (`:57`, `onValueChange={setLocale}`)
   and theme `ToggleGroup` (`:86-90`) both commit on change with no save button; the
   commit-on-change **checkbox** precedent lives outside Settings, in
   `tasks/Task.tsx:57-61,88-93` (`Checkbox onCheckedChange` → immediate `useUpdate`),
   with the same shape in `reminders/ReminderCard.tsx:49` and
   `references/ReferenceTasks.tsx:135`. Match those; do not invent a batched form.
   There is no `<Switch>` anywhere in `src/components/atomic-crm/` — verify with
   `grep -rn "ui/switch\|<Switch" src/components/atomic-crm/` (zero hits today) before
   reaching for one.
   A `parent`-only user who ticks `single` gets a `singles` row pointing at themselves
   in their existing household with **no** new account created and **no** re-entry of
   anything already on file — the exact case named in the epic text.
   *Decided by:* the `PersonasSection` component test in Task 6 plus a manual pass at
   `/settings`.

2. **One new function owns removal — `public.remove_persona(p_persona text)`.**
   `SECURITY DEFINER`, `SET search_path TO ''`, for the identical reason `add_persona()`
   is (Story 2.2 Dev Notes: the target context may not be the caller's active one).
   `p_persona in ('single', 'parent', 'shadchan')` or it raises, mirroring
   `add_persona()`'s guard. Unticking a box in Settings calls it. Behaviour per persona:
   - **`shadchan`** — archives the caller's `shadchan`-role membership
     (`account_members.status = 'archived'`). No-op if none is active.
   - **`single`** — archives the caller's own `singles` row (`status = 'archived'` —
     reusing the column `singles` already has at `01_tables.sql:156`, no schema addition
     needed) **only if** that row points at one of the caller's **owning** memberships
     (`parent_admin`/`self_manager` — you self-archive only a record you manage; an
     invited `single`-role member's record is managed by their household's
     `parent_admin` and is archived from the singles list, not by persona removal)
     **and** the caller holds at least one other active persona; otherwise raises
     `cannot remove your only persona` (or, for the non-owning case,
     `ask your household admin`) and changes nothing (AC-5).
     Note the FK direction this depends on: `singles.member_id` references
     `public.account_members(id)` (`01_tables.sql:525`), **not** `public.members` — the
     `*_member_id` name collision is documented at `01_tables.sql:54-58`.
   - **`parent`** — raises `cannot remove parent — no other admin manages this
     household's other singles` when the household has active `singles` rows besides
     the caller's own **and** no other active `parent_admin` remains; otherwise, if the
     caller still holds the `single` persona in that household, demotes their role to
     `self_manager`; otherwise archives the membership outright. The demote path changes
     only `role`, never `account_id`, so it does not trip 2.2's
     `enforce_household_scope()` trigger (`before insert or update of account_id`).
   *Decided by:* `supabase/tests/context_resolution.sql` (Task 6) and
   `npm run test:unit:db`.

3. **Removing a persona archives, never deletes.**
   `grep -in "delete from" ` over `remove_persona()`'s body in
   `supabase/schemas/02_functions.sql` returns zero hits — every removal is a
   `status`/`role` transition. `'archived'` is a genuinely new value in this codebase:
   `grep -rn "archived" src/ supabase/schemas/` returns **zero** hits today (the only
   match anywhere is the unrelated legacy `archived_at` column in the fossil migration
   `supabase/migrations/20240730075029_init_db.sql:90`), so nothing pre-existing has to
   be reconciled. A test asserts that after removing every persona a user has, their
   historical `shidduchim`, `references`, `interactions`, `redts` rows still exist,
   unchanged, under the now-archived context (all four tables confirmed present:
   `01_tables.sql:200,181,367,327`).

4. **Archived context data remains queryable by whoever still has access, forever.**
   Archiving a `shadchan` or `parent` membership does not touch any policy's own scoping
   predicate; it only removes that **membership** from the active set, so a household
   with a remaining `parent_admin` keeps full access after another member's persona is
   removed. This holds structurally because **no RLS policy reads
   `account_members.status` directly** — every one of them reaches membership through
   the single resolver function (`current_account_id()` today,
   `current_context_id()` after Story 2.1). Verify before and after:
   `grep -c "^create policy" supabase/schemas/05_policies.sql` → **22**, of which **17**
   mention the resolver; plus **3** more on `storage.objects` in
   `supabase/schemas/07_storage.sql:25,32,39` (`Attachments readable / writable /
   deletable within account`) — **25 policies in total**, and the storage trio lives in
   a *different* schema file from every other policy, so a sweep that only looks at
   `05_policies.sql` will miss it and silently break every attachment read and write.
   A negative-adjacent test: archiving user A's `shadchan` membership does not affect
   user B's continued access to the same shadchanus if B also holds an active membership
   there (out of scope for a single-shadchan context today, but the assertion documents
   the invariant for when Epic 8 adds shared shadchanus membership).

5. **Removing your only persona is refused, not silently accepted.** Covers both the
   `single`-alone case (AC-2) and the `parent`-with-unmanaged-dependents case (AC-2) —
   both surface as a friendly, specific, **translated** error in Settings, never a
   generic failure toast and never raw Postgres error text.
   *Decided by:* the two guard tests in `context_resolution.sql` (server side) and the
   `PersonasSection` component test (client side, Task 6).

6. **`account_members.status` gains the value this story introduces.**
   `account_members_status_check check (status in ('active', 'archived'))` on
   `public.account_members` (`01_tables.sql:131-142`) — the column is unconstrained free
   text today (`status text not null default 'active'`, `01_tables.sql:137`); Story 2.2
   deliberately left it that way, pending this story.
   The constraint is safe to add because the **only** place in the whole schema that
   compares `account_members.status` to a literal is
   `current_account_id()` at `supabase/schemas/02_functions.sql:156`
   (`and am.status = 'active'`), and every write site writes `'active'`:
   `02_functions.sql:68-69` (`handle_new_user()`),
   `supabase/functions/users/index.ts:117`,
   `supabase/functions/users/index.ts:91` and
   `supabase/functions/_shared/resolveDemoAccount.ts:18` (reads).
   Introducing `'archived'` therefore changes no existing predicate — an archived
   membership simply stops resolving, everywhere, automatically.
   *Decided by:* Task 1's pre-flight grep + a `context_resolution.sql` assertion that
   `insert … status = 'bogus'` is rejected.

7. **Losing your active context on removal is handled, not left dangling.** If the
   membership `remove_persona()` just archived was the caller's
   `member_state.active_account_id`, the function re-activates any **other** remaining
   active membership the caller holds — via 2.1's shared private writer
   `activate_context_for(auth.uid(), …)`, not a second implementation
   (`set_active_context()` itself cannot express the other half of this rule: it raises
   rather than writes NULL) — or sets `member_state.active_account_id` NULL if none
   remain. Writing NULL is the fail-closed choice: AD-19 specifies that
   `current_context_id()` returns NULL when the stored context is no longer an active
   membership, so a NULL row and a stale row resolve identically; NULL is simply the
   honest representation. The frontend's context switcher (Story 2.4, if it has landed)
   or a redirect to `/` picks up the new state on the next query, exactly as a manual
   switch does.

8. **An archived `single` is not left half-visible in the UI.** *(New in this refresh —
   the gap is real in the current tree and this story is the first thing to create it.)*
   `singles.status` today has a UI vocabulary of exactly two values — `SingleInputs.tsx:41-49`
   offers `active` and `paused` and nothing else — and two screens derive presence from
   it directly (`SingleCard.tsx:43` and `SingleShow.tsx:41`, both
   `single.status === "active"`). Writing a third value `'archived'` therefore has two
   consequences that must be handled, not discovered later:
   - **Edit-form round-trip.** An archived single opened in `SingleEdit` renders a
     `SelectInput` with no matching choice (blank) and can be silently reset to `active`
     on save. Either add `archived` as a (disabled or read-only) choice, or block the
     edit form for archived singles. Pick one and say which in the File List.
   - **Unfiltered reads.** Nine read paths pull `singles` with no `status` filter today:
     the six `useGetList<Single>("singles", …)` call sites
     (`layout/TopBar.tsx:57`, `shidduchim/ShidduchimList.tsx:20`,
     `settings/FamilySection.tsx:23`, `settings/PrivacySection.tsx:24`,
     `dashboard/useDashboardData.ts:26`, `root/OnboardingGate.tsx:32`), plus
     `singles/SingleList.tsx` (no filter at all), `shidduchim/ShidduchInputs.tsx:67`
     (`<ReferenceInput source="single_id" reference="singles">`) and
     `settings/exportFamilyData.ts:4-9` (bulk export — which **must keep** including
     archived rows; AC-3's "remains auditable" is the whole point of the export).
     `singles_summary` (`03_views.sql:176`) also passes `status` through unfiltered
     (`:188`).
     Minimum bar for this story: `TopBar`'s single switcher and `OnboardingGate`'s count
     must exclude `status = 'archived'` (an archived single must not be selectable, and
     must not keep onboarding suppressed). The remaining sites may keep showing archived
     rows *provided they render them as archived*; whichever you choose, record the
     decision per-site in the Completion Notes.
   *Decided by:* `grep -rn 'useGetList<Single>' src/ --include=*.tsx --include=*.ts | grep -v "\.test\." | grep -v "/providers/"`
   (six hits today) plus the component test in Task 6.

9. **Toolchain green + a negative RLS-adjacent test**, since this story changes a status
   check constraint and adds a `SECURITY DEFINER` function:
   `make typecheck && npm run lint && make test && npm run test:unit:db`.
   (All four verified present: `makefile` targets `typecheck`, `lint`, `test`;
   `package.json` scripts `lint` and `test:unit:db`.)

## Tasks / Subtasks

- [x] **Task 1 — `account_members.status` check constraint** (AC: 6)
  - [x] `supabase/schemas/01_tables.sql`: add
        `account_members_status_check check (status in ('active', 'archived'))` to the
        `public.account_members` block at `:131-142`, alongside the existing
        `account_members_role_check` at `:139-141`.
  - [x] Pre-flight — confirm no existing row or fixture holds a status outside the new
        vocabulary before adding the constraint, so the migration cannot fail on apply:
        `grep -rn "account_members" -A5 --include=*.sql --include=*.ts --include=*.tsx supabase/ src/ | grep -i status`
        returns **8** lines today (`supabase/schemas/01_tables.sql:129` is prose;
        `02_functions.sql:68`/`:156`, `supabase/functions/users/index.ts:91`/`:117`,
        `supabase/functions/_shared/resolveDemoAccount.ts:18`,
        `supabase/tests/members_rename.sql:114`,
        `supabase/tests/references_entity.sql:40`), and every literal is `'active'`.
        Re-run it — if the count has moved, reconcile before adding the constraint.
        `supabase/seed.sql` inserts no `account_members` rows; the FakeRest generator
        builds `db.account_members` in memory only
        (`providers/fakerest/dataGenerator/shidduchim.ts:259,385`).

- [x] **Task 2 — `remove_persona()`** (AC: 2, 3, 4, 5, 7)
  - [x] `supabase/schemas/02_functions.sql`: implement per AC-2, `SECURITY DEFINER`,
        `SET search_path TO ''`, querying `account_members`/`singles` directly for
        `user_id = auth.uid()` — same pattern as `add_persona()`/`my_personas()` (2.2),
        not a fresh design. Follow the file's `pg_dump` formatting convention
        (`CREATE OR REPLACE FUNCTION "public"."remove_persona"("p_persona" "text") …`)
        so `db diff` does not produce a phantom rewrite of the whole file.
  - [x] Implement AC-7's re-activation step by calling `activate_context_for()`
        (2.1's single private writer) — do not write `member_state` directly and do
        not call `set_active_context()` (it cannot set NULL and would re-validate a
        membership this function has just proven).
  - [x] `06_grants.sql`: follow the file's three-line pattern exactly, as at `:197-199`:
        `revoke all on function public.remove_persona(text) from public, anon;` then
        `grant execute on function public.remove_persona(text) to authenticated;` then
        `grant execute on function public.remove_persona(text) to service_role;`
        (PUBLIC gets EXECUTE by default otherwise; the `service_role` line is part of
        the pattern and is missing from most first drafts).

- [x] **Task 3 — Migration** (AC: 6)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        persona_lifecycle_changes`, hand-check that the grants came through and that no
        unrelated function was rewritten, then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        (The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is required — every
        `npx supabase` call hangs on the keyring without it.)

- [x] **Task 4 — Settings UI** (AC: 1, 5)
  - [x] New `settings/PersonasSection.tsx` (mirrors `settings/FamilySection.tsx`'s
        "quiet summary" pattern — `SectionLabel` + `ItemGroup`/`Item` inside a bordered
        rounded container), rendering `login/PersonaChecklist.tsx` (2.3) pre-checked
        from `useMyPersonas()` (2.3's hook). Each toggle calls
        `dataProvider.addPersona()` / a new `dataProvider.removePersona()` immediately —
        no batch "save" button (AC-1).
  - [x] Unticking `single` or `parent` when AC-2/AC-5's guard would reject it: surface
        the SQL exception's message as a specific, translated error via the same
        `notify(<key>, { type: "error" })` shape `FirstRunSetup.tsx:103` uses for
        `crm.auth.onboarding.single_save_error` (note the key name — this is the
        post-Epic-1 `singles` naming; there is no `child_save_error` key in the tree).
        Leave the checkbox in its pre-toggle state on failure.
  - [x] Add `crm.settings.persona_*` copy to **both** message files —
        `providers/commons/englishCrmMessages.ts` (the `settings:` block begins at
        `:253`) and `providers/commons/frenchCrmMessages.ts`. `i18nProvider.test.ts`
        registers exactly `en` and `fr`; a key present in one file only is a silent
        fallback, not an error.
  - [x] Add `<PersonasSection />` to `settings/SettingsPage.tsx` (desktop, next to
        `<FamilySection />` at `:57`) and `settings/SettingsPageMobile.tsx` (`:37-40`).
        **No route work is needed:** `/settings` is already registered on both surfaces
        in `root/routeManifest.ts:81-92` (`SettingsPage` desktop, `SettingsPageMobile`
        mobile). There is no `<Route>`/`<Resource>` JSX to edit anywhere — `CRM.tsx`
        maps over the manifest.

- [x] **Task 5 — dataProvider** (AC: 2, 5)
  - [x] `providers/supabase/dataProvider.ts`: add `removePersona(persona)` →
        `.rpc("remove_persona", { p_persona: persona })` in the same object as
        `aiEntitlement()` (`:470`), propagating the SQL exception's message to the
        caller rather than swallowing it (Settings needs the specific guard message from
        AC-5 — so this is the opposite of `aiEntitlement()`'s deliberate fail-soft
        `return UNENTITLED_AI`).
  - [x] `providers/fakerest/dataProvider.ts`: emulate the same three branches and the
        same two guards against the in-memory `db` (`db.account_members`, `db.singles`).
        This is not optional: `CrmDataProvider` is
        `ReturnType<typeof <supabase factory>>` (`providers/supabase/dataProvider.ts:500`,
        re-exported by `providers/types.ts:1`), so adding the method on the Supabase side
        widens the shared type and `make typecheck` fails until FakeRest matches.

- [x] **Task 6 — Tests** (AC: 3, 4, 5, 6, 7, 8)
  - [x] Extend the `supabase/tests/context_resolution.sql` + `context_resolution.test.ts`
        pair created by 2.1 — **both halves**: the `.sql` file holds the assertions,
        the `.test.ts` file is what `npm run test:unit:db` actually discovers (the four
        existing suites — `billing_entitlement`, `members_rename`, `references_entity`,
        `shidduch_catch` — are all `.sql` + `.test.ts` pairs sharing
        `dbSuiteHelpers.ts`'s `bailIfDbUnreachable`). Add: archive-not-delete (AC-3),
        the two removal guards (AC-5), the active-context handoff on self-removal
        (AC-7), the `account_members_status_check` rejecting a value outside
        `active`/`archived` (AC-6), and the AC-4 assertion that a remaining
        `parent_admin` still reads everything after another member is archived.
  - [x] Component test for `PersonasSection`: toggling off a guarded persona surfaces
        the specific translated error and leaves the checkbox checked (the removal did
        not silently succeed in the UI while failing server-side).
  - [x] Test for AC-8's minimum bar: `TopBar`'s single switcher and `OnboardingGate`'s
        count exclude `status = 'archived'`.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### The epic's own example, traced end to end

> "Given I registered as a parent only / When I add the single persona later from
> settings / Then a single record pointing at me is created in my household, with no
> re-registration / And when I remove a persona, its records are archived and remain
> auditable / And no history, suggestion, reference or thread is deleted by removing a
> persona."
> [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5]

The "add" half is already fully built by Story 2.2's `add_persona('single')` — this
story's AC-1 is the Settings **wiring** for a function that will already exist, not new
provisioning logic. The "remove" half (`remove_persona()`, AC-2/3) is what this story
actually builds new, because 2.2 deliberately stopped at provisioning and left removal
here (2.2's Dev Notes record the matching `status`-constraint hand-off to this story).

### Why the two removal guards exist (AC-2, AC-5) — not invented complexity

Removing `single` when it is a user's only persona would leave an `account_members` row
with no purpose it can serve — the household exists, the user is in it, but they hold no
role that does anything (a bare `self_manager`/`single` row with no reason to be
consulted). Removing `parent` while other singles still depend on this admin and no one
else can act for them would silently orphan real records mid-process — the opposite of
the product's whole promise. Both guards are refusals, not silent no-ops, because a
silent no-op here would look like success in the UI while quietly not doing what was
asked; a specific, named error is the honest response. Neither guard is stated verbatim
in epics.md's Story 2.5 text, but both follow directly from FR82 ("removing a persona
archives, never deletes") combined with the ordinary meaning of "archive a household's
only admin while dependents remain" — which cannot be reconciled with "nothing is
deleted" if taken literally (an admin-less household with active singles is not itself
deleted, but it becomes unmanageable, which is a worse outcome the guard exists to
prevent). Flagged here explicitly as this story's own reasoned addition, not a literal
epic requirement, so a reviewer can evaluate the reasoning rather than hunt for a source
that does not exist.

### Verified current state (re-verified against the post-Epic-1 tree)

- `public.account_members` — `01_tables.sql:131-142`. `status text not null default
  'active'` at `:137`, **no** check constraint. `account_members_role_check` at
  `:139-141` currently allows four roles: `parent_admin`, `helper`, `self_manager`,
  `shadchan`. The `single` role AD-2 requires is **not there yet** — Story 2.2 adds it,
  which is why AC-2's "invited `single`-role member" case is a dependency, not a
  present-tense fact.
- `public.singles` — `01_tables.sql:145-158`. `status text not null default 'active'`
  at `:156`; `member_id bigint` at `:157`, FK to `public.account_members(id)` at `:525`.
  The `children` → `singles` rename shipped in Story 1.3; there is no `children` table
  and no `child_id` column anywhere in the tree. This story is the **first** thing to
  write `'archived'` into `singles.status`, but the column itself needs no schema change.
- **`'archived'` appears nowhere today** — `grep -rn "archived" src/ supabase/schemas/`
  is empty. The single repo-wide match is the unrelated legacy `archived_at` column in
  the fossil migration `supabase/migrations/20240730075029_init_db.sql:90`.
- **`singles.status` has a two-value UI vocabulary today** (`active`, `paused` —
  `SingleInputs.tsx:41-49`), consumed as a boolean at `SingleCard.tsx:43` and
  `SingleShow.tsx:41`. This is why AC-8 exists.
- **No RLS policy reads `account_members.status`.** The only literal comparison in the
  schema is inside `current_account_id()` (`02_functions.sql:146-162`, predicate at
  `:156`). Policy inventory: **22** in `05_policies.sql` (17 mentioning the resolver) +
  **3** on `storage.objects` in `07_storage.sql:25,32,39` = **25**. `current_account_id()`
  is referenced **63** times across `supabase/schemas/` (05: 38, 02: 18, 06: 4, 07: 3).
  Story 2.1 replaces it with `current_context_id()` everywhere — *including* the storage
  trio, which is easy to miss because it is the only policy block outside
  `05_policies.sql`.
- `settings/FamilySection.tsx` — the "quiet summary section" visual pattern
  `PersonasSection.tsx` follows (`SectionLabel` + `ItemGroup`/`Item`, bordered rounded
  container, `useGetList` count on the right).
- **Route registration is a manifest, not JSX.** `/settings` lives at
  `root/routeManifest.ts:81-92` as two `CustomRouteEntry` records (`SettingsPage`,
  `surface: "desktop"`; `SettingsPageMobile`, `surface: "mobile"`; both
  `chrome: "shell"`). `routeManifest.test.ts` validates the manifest. This story adds a
  *section inside* an existing page, so it touches neither.
- **Settings reachability (interim):** the desktop entry points to `/settings` — the
  Sidebar nav item (`layout/Sidebar.tsx:46-54`) and the TopBar user-menu item
  (`layout/TopBar.tsx:37-39`) — are wrapped in
  `<CanAccess resource="configuration" action="edit">`. That resolves true only for role
  `admin`, which `providers/supabase/authProvider.ts:169` sets solely from
  `members.administrator` (the legacy flag, post-`sales`→`members` rename);
  `providers/commons/canAccess.ts` denies `configuration` for everyone else. The mobile
  bottom-nav entry (`layout/MobileNavigation.tsx:230`) is ungated, and the route in the
  manifest is ungated. Story 2.7 Task 7 unwraps those two `CanAccess` blocks and deletes
  `is_admin()` (`02_functions.sql:104-113`); until it lands, this story's
  `PersonasSection` is reachable by every member on mobile and by direct URL on desktop.
  **Do not add a third gate or a workaround here.**

### Security posture

`remove_persona()` is a new `SECURITY DEFINER` function that archives access — the
highest-consequence direction to get wrong is archiving the **wrong** membership (e.g.
someone else's). Every query inside must filter on `user_id = auth.uid()`; there is no
parameter that ever names another user or another account directly. This is a
`.claude/rules/security-triggers.md` case (database migration + SECURITY DEFINER +
membership/authorization); a security review is expected.

### Testing standards

Extend the `supabase/tests/context_resolution.sql` + `.test.ts` pair (2.1/2.2's suite)
rather than adding a fifth database suite for this domain area — the directory holds
four pairs today (`billing_entitlement`, `members_rename`, `references_entity`,
`shidduch_catch`), each shelling out to `psql` via `dbSuiteHelpers.ts`'s
`bailIfDbUnreachable`. `.claude/rules/testing.md`'s negative-test requirement applies to
both new guards (AC-5) and to AC-3's "nothing is deleted" assertion.

### Project Structure Notes

New: `settings/PersonasSection.tsx`. Edited: `settings/SettingsPage.tsx`,
`settings/SettingsPageMobile.tsx`, `providers/supabase/dataProvider.ts`,
`providers/fakerest/dataProvider.ts`, `providers/commons/englishCrmMessages.ts`,
`providers/commons/frenchCrmMessages.ts`, `supabase/schemas/01_tables.sql`,
`supabase/schemas/02_functions.sql`, `supabase/schemas/06_grants.sql`, plus whichever
`singles` read sites AC-8 resolves (at minimum `layout/TopBar.tsx`,
`root/OnboardingGate.tsx`, and `singles/SingleInputs.tsx`). Reused, not duplicated:
`login/PersonaChecklist.tsx` and `root/useMyPersonas.ts` (both from Story 2.3).
Untouched: `root/routeManifest.ts` (no new route), `supabase/schemas/05_policies.sql`
and `07_storage.sql` (no policy predicate changes — see AC-4).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5] — the story's own AC text.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#Personas-change-over-a-lifetime]
  — "removing one archives, never deletes … entitlement, listings and connections must
  tolerate a persona being switched off."
- [Source: ARCHITECTURE-SPINE.md#AD-2] — "Personas are **mutable for life** (FR81):
  adding one provisions its context on demand; removing one **archives, never deletes**
  (FR82)"; also the five-role vocabulary including `single`, which 2.2 lands.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `member_state`, `current_context_id()`
  returning NULL for a no-longer-active membership (fail closed), and the deletion of
  `current_account_id()`. AC-7's "write NULL rather than leave a stale row" is this
  story's reading of that rule, not a verbatim quote.
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md]
  — `member_state`, `activate_context_for()`, and the `context_resolution` test pair.
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — `add_persona()`, `my_personas()`, the `single` role addition, and the
  `SECURITY DEFINER` rationale this story reuses verbatim for `remove_persona()`.
- [Source: _bmad-output/implementation-artifacts/2-3-onboarding-persona-multi-select.md]
  — `login/PersonaChecklist.tsx`, `root/useMyPersonas.ts`, `dataProvider.addPersona()`.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-code, bmad-dev-story workflow)

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f persona_lifecycle_changes` —
  confirmed `db diff` again silently dropped the `remove_persona()` GRANT/REVOKE block (the
  documented pitfall); added the three lines by hand to the generated migration, then verified
  with a follow-up no-op `db diff` (empty diff) and a direct `pg_proc`/`has_function_privilege`
  query against the local DB.
- `npm run test:unit:db` before any story-2.5 edit landed: 98 checks green (2.1/2.2/2.4 baseline).
  After Task 1/2/6: 122 checks green (24 new).
- `make test`: 731 tests / 64 files green (includes the 3 new frontend test files).

### Completion Notes List

- **Pre-existing landmine found and fixed, not introduced by this story:** the Story 2.1 fixture
  in `supabase/tests/context_resolution.sql` inserted an `account_members` row with the
  placeholder literal `status = 'revoked'` to exercise `my_contexts()`'s "excludes a non-active
  membership" case. `account_members_status_check` (this story's AC-6) would have rejected that
  insert outright, breaking `npm run test:unit:db` on an otherwise-unrelated fixture. Fixed by
  changing the literal to `'archived'` (the value that now actually exists in the vocabulary) and
  updating the surrounding comments/assertion names to match — recorded here per the "never quote
  a count you did not run / the tree moves" rule, since neither AC-6's own grep nor Task 1's
  pre-flight (which only scanned for `'active'` writers, not arbitrary non-active literals in
  fixtures) would have caught it.
- **Required correction to Story 2.2's `add_persona()`/`my_personas()`, in the same change:**
  neither function's `single`-branch predicate filtered `singles.status = 'active'` — unreachable
  before this story (nothing wrote `'archived'` yet), but load-bearing the moment `remove_persona()`
  does. Without the fix, (a) `my_personas()` would keep reporting a `single` persona forever after
  it was archived (AC-1's Settings checklist would stay ticked post-removal, and AD-19/AC-8's
  "archived single must not keep onboarding suppressed" would silently fail since `OnboardingGate`
  now gates on `useMyPersonas()`, not a direct `singles` read — 2.3 already replaced that gate), and
  (b) re-ticking `single` after removing it would no-op forever against the now-archived row instead
  of provisioning a fresh one, breaking the epic's own "add a persona back" round trip. Added
  `and s.status = 'active'` to both functions' `single` predicates and to the FakeRest mirrors
  (`personas.ts`'s `hasLinkedSingle` already filtered on `status: "active"` — only the two
  SQL/inline predicates needed the fix). Covered by a dedicated `context_resolution.sql` assertion
  (the r5 fixture: remove single → re-add single → single reports again, two rows total, only the
  new one active).
- **AC-8 / `OnboardingGate.tsx`:** the story's Dev Notes reference an `OnboardingGate.tsx:32`
  `useGetList<Single>("singles")` read that no longer exists — Story 2.3 (built earlier in this
  epic's actual order) already replaced that gate with `useMyPersonas()`. The AC-8 requirement
  ("OnboardingGate's count must exclude archived") is satisfied transitively by the `my_personas()`
  fix above, not by an `OnboardingGate.tsx` edit; noted here so the mismatch isn't mistaken for a
  missed task.
- **AC-8 per-site decisions for the nine unfiltered `singles` read paths**, as required by the story:
  - `layout/TopBar.tsx` (`SingleSwitcherPill`) — **excluded** (`status@neq: archived`). Mandatory
    minimum bar.
  - `root/OnboardingGate.tsx` — no longer reads `singles` directly (see above); satisfied via the
    `my_personas()` fix.
  - `shidduchim/ShidduchimList.tsx` — **excluded**. Same "not a selectable current single"
    rationale as TopBar's switcher.
  - `dashboard/useDashboardData.ts` — **excluded**. Same rationale; drives an identical local
    single-switcher.
  - `shidduchim/ShidduchInputs.tsx`'s `<ReferenceInput source="single_id">` — **excluded**.
    Creating a brand-new shidduch for an archived/removed single record makes no sense.
  - `settings/FamilySection.tsx` (count only) — **kept unfiltered**. It is a total-records
    disclosure linking into the roster, not a selector; the roster itself (below) renders archived
    rows distinctly.
  - `settings/PrivacySection.tsx` (records-held disclosure) — **kept unfiltered**, deliberately:
    AC-3/AC-4's "archived, never deleted, remains auditable" invariant means a privacy disclosure
    of "what's held for your family" is more honest counting the true total, including archived
    rows, than silently under-reporting.
  - `singles/SingleList.tsx` / `SingleShow.tsx` — **kept unfiltered** (the full family roster/
    audit trail), but no longer silently mislabels an archived row as "Paused": both now render a
    third, distinct "Archived" status-pill label (`SingleCard.tsx`/`SingleShow.tsx`'s new
    `STATUS_LABEL` map) instead of collapsing every non-active status into "Paused".
  - `settings/exportFamilyData.ts` — **kept unfiltered**, as the story requires (AC-3's "remains
    auditable").
  - `singles_summary` view (`03_views.sql`) — left as a pass-through view; filtering is a read-site
    decision, not the view's job (unchanged, per AC-4's "no policy predicate changes").
- **`singles/SingleInputs.tsx` edit-form decision:** added `archived` as a third, `disabled: true`
  `SelectInput` choice (using the existing `disableValue`/`disabled` choice convention already
  supported by `@/components/admin/select-input`) rather than blocking the whole edit form. This
  gives an archived single's edit form a matching (but unselectable) choice instead of rendering
  blank and silently resetting to `active` on save, while still allowing a parent to fix a
  non-status field (e.g. a name typo) on an archived record without a bespoke read-only mode.
- **`PersonaChecklist.tsx`** gained one small additive prop, `disabled?: boolean` (default
  `false`), so Settings can freeze all three checkboxes while a toggle's `addPersona()`/
  `removePersona()` call is in flight (prevents a double-submit race). Onboarding (2.3) never
  passes it; existing `PersonaChecklist.test.tsx` cases are unaffected.
- **`removePersona()`'s guard-message → i18n-key mapping** lives client-side in
  `PersonasSection.tsx` (`removalErrorCopy()`), matching substrings of the SQL's own raised
  messages (`'ask your household admin'`, `'cannot remove your only persona'`,
  `'cannot remove parent'`) to the three `crm.settings.persona_remove_error_*` keys, with a
  generic fourth key as a catch-all for anything unrecognized — never raw Postgres text reaches
  the toast (AC-5).
- **Zero `delete from` in `remove_persona()`'s body** — verified both by `grep -in "delete from"`
  over the function's SQL text and by a `context_resolution.sql` assertion reading `pg_proc.prosrc`
  directly (AC-3).
- Neither `05_policies.sql`, `07_storage.sql`, nor `root/routeManifest.ts` were touched — verified
  with `git diff --stat` returning empty for all three, matching the Dev Notes' "Untouched" list.
- All four toolchain gates green: `make typecheck`, `make lint`, `make test` (731/731, 64 files),
  `npm run test:unit:db` (265/265 across the 5 db suites; 122/122 in `context_resolution` alone).
  `node scripts/check-retired-names.mjs` also passes (no "child"-shaped identifiers introduced).
- `make registry-gen` run once at the end to register the two new component files
  (`settings/PersonasSection.tsx`, `providers/fakerest/internal/removePersona.ts`) in
  `registry.json`; the pre-existing unrelated `accountMemberships.ts` registry entry (already
  uncommitted before this story started) was picked up in the same regen pass and is included in
  the diff, not reverted.

### File List

**New**
- `src/components/atomic-crm/settings/PersonasSection.tsx`
- `src/components/atomic-crm/settings/PersonasSection.test.tsx`
- `src/components/atomic-crm/providers/fakerest/internal/removePersona.ts`
- `src/components/atomic-crm/providers/fakerest/internal/removePersona.test.ts`
- `src/components/atomic-crm/layout/TopBar.test.tsx`
- `supabase/migrations/20260728021544_persona_lifecycle_changes.sql`

**Edited**
- `supabase/schemas/01_tables.sql` — `account_members_status_check`.
- `supabase/schemas/02_functions.sql` — new `remove_persona()`; `s.status = 'active'` fix to
  `add_persona()` and `my_personas()`'s `single` predicates.
- `supabase/schemas/06_grants.sql` — `remove_persona()` grant/revoke block.
- `supabase/tests/context_resolution.sql` — Story 2.5 test section (24 new assertions); fixed the
  pre-existing `'revoked'` fixture literal to `'archived'`.
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — `removePersona()`.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — wired `removePersona()`.
- `src/components/atomic-crm/settings/SettingsPage.tsx` — mounted `<PersonasSection />`.
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx` — mounted `<PersonasSection />`.
- `src/components/atomic-crm/login/PersonaChecklist.tsx` — added optional `disabled` prop.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — `crm.settings.persona*` keys.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — `crm.settings.persona*` keys.
- `src/components/atomic-crm/layout/TopBar.tsx` — archived-exclusion filter; exported
  `SingleSwitcherPill` for testability.
- `src/components/atomic-crm/shidduchim/ShidduchimList.tsx` — archived-exclusion filter.
- `src/components/atomic-crm/dashboard/useDashboardData.ts` — archived-exclusion filter.
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx` — archived-exclusion filter on the
  `single_id` `ReferenceInput`.
- `src/components/atomic-crm/singles/SingleInputs.tsx` — disabled `archived` choice.
- `src/components/atomic-crm/singles/SingleCard.tsx` — three-way `STATUS_LABEL`.
- `src/components/atomic-crm/singles/SingleShow.tsx` — three-way `STATUS_LABEL`.
- `registry.json` — regenerated (`make registry-gen`).
</content>
</invoke>
