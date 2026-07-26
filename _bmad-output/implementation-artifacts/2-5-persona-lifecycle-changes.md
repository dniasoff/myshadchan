# Story 2.5: Personas Change Over a Lifetime

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user whose circumstances change,
I want to add or remove a persona at any time from Settings,
so that the app follows my life rather than my signup day, and nothing I have already
recorded is ever lost by the change.

## Dependencies

**Requires Story 2.2** (`add_persona()`, `my_personas()`, `enforce_household_scope()`).
**Requires Story 2.3** (`login/PersonaChecklist.tsx` — this story imports it, it does
not rebuild it). Independent of 2.4/2.6/2.7/2.8.

## Acceptance Criteria

1. **Adding a persona later needs no re-registration.** Settings renders
   `PersonaChecklist` (Story 2.3) pre-checked from `useMyPersonas()`. Ticking a
   previously-unchecked box calls `add_persona()` immediately (no separate "save" step
   — each toggle is its own committed action; the existing Settings precedent is
   `PreferencesSection.tsx`'s selects, which commit on `onValueChange` with no save
   button — there are no boolean Settings toggles in the codebase today to copy, so
   this select-commit pattern is the one to match). A `parent`-only user who ticks `single`
   gets a `singles` row pointing at themselves in their existing household with **no**
   new account created and **no** re-entry of anything already on file — the exact case
   named in the epic text.

2. **One new function owns removal — `public.remove_persona(p_persona text)`.**
   `SECURITY DEFINER`, `SET search_path TO ''`, for the identical reason `add_persona()`
   is (Story 2.2 Dev Notes: the target context may not be the caller's active one).
   Unticking a box in Settings calls it. Behaviour per persona:
   - **`shadchan`** — archives the caller's `shadchan`-role membership
     (`account_members.status = 'archived'`). No-op if none is active.
   - **`single`** — archives the caller's own `singles` row (`status = 'archived'` —
     reusing the column `singles` already has, no schema addition needed) **only if**
     that row points at one of the caller's **owning** memberships
     (`parent_admin`/`self_manager` — you self-archive only a record you manage; an
     invited `single`-role member's record is managed by their household's
     `parent_admin` and is archived from the singles list, not by persona removal)
     **and** the caller holds at least one other active persona; otherwise raises
     `cannot remove your only persona` (or, for the non-owning case,
     `ask your household admin`) and changes nothing (AC-5).
   - **`parent`** — raises `cannot remove parent — no other admin manages this
     household's other singles` when the household has active `singles` rows besides
     the caller's own **and** no other active `parent_admin` remains; otherwise, if the
     caller still holds the `single` persona in that household, demotes their role to
     `self_manager`; otherwise archives the membership outright.

3. **Removing a persona archives, never deletes.** No `delete from` statement appears
   anywhere in `remove_persona()`'s body — every removal is a `status`/`role` transition.
   A test asserts that after removing every persona a user has, their historical
   `shidduchim`, `references`, `interactions`, `redts` rows still exist, unchanged,
   under the now-archived context.

4. **Archived context data remains queryable by whoever still has access, forever.**
   Archiving a `shadchan` or `parent` membership does not touch RLS's own scoping
   predicate (`account_id`/`current_context_id()`); it only removes that **membership**
   from the active set, so a household with a remaining `parent_admin` keeps full access
   to everything after another member's persona is removed. A negative-adjacent test:
   archiving user A's `shadchan` membership does not affect user B's continued access to
   the same shadchanus if B also holds an active membership there (out of scope for a
   single-shadchan context today, but the assertion documents the invariant for when
   Epic 8 adds shared shadchanus membership).

5. **Removing your only persona is refused, not silently accepted.** Covers both the
   `single`-alone case (AC-2) and the `parent`-with-unmanaged-dependents case (AC-2) —
   both surface as a friendly, specific error in Settings (`crm.settings.persona_*`
   copy), never a generic failure toast.

6. **`account_members.status` gains the value this story introduces.**
   `account_members_status_check check (status in ('active', 'archived'))` — the column
   is unconstrained free text today (Story 2.2 deliberately left it that way, pending
   this story). `current_context_id()`, `set_active_context()` and every RLS policy
   already only ever match `status = 'active'` (Story 2.1), so introducing `'archived'`
   changes no existing predicate — an archived membership simply stops being selectable,
   everywhere, automatically.

7. **Losing your active context on removal is handled, not left dangling.** If the
   membership `remove_persona()` just archived was the caller's `member_state.active_account_id`,
   the function re-activates any **other** remaining active membership the caller holds
   — via 2.1's shared private writer `activate_context_for(auth.uid(), …)`, not a
   second implementation (`set_active_context()` itself cannot express the other half
   of this rule: it raises rather than writes NULL) — or sets
   `member_state.active_account_id` NULL if none remain (fail-closed, matching AD-19). The frontend's context switcher (Story 2.4, if it has
   landed) or a redirect to `/` picks up the new state on the next query, exactly as a
   manual switch does.

8. **Toolchain green + a negative RLS-adjacent test**, since this story changes a status
   check constraint and a `SECURITY DEFINER` function:
   `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Tasks / Subtasks

- [ ] **Task 1 — `account_members.status` check constraint** (AC: 6)
  - [ ] `supabase/schemas/01_tables.sql`: add
        `account_members_status_check check (status in ('active', 'archived'))`.
        Confirm no existing row anywhere (fixtures, seed data, tests) currently holds a
        status other than `'active'` before adding the constraint (`grep -rn
        "status.*:" supabase/functions/seed_demo supabase/tests` for any stray value) —
        if the local dev DB has drifted, the migration must not fail on apply.

- [ ] **Task 2 — `remove_persona()`** (AC: 2, 3, 4, 5, 7)
  - [ ] `supabase/schemas/02_functions.sql`: implement per AC-2, `SECURITY DEFINER`,
        querying `account_members`/`singles` directly for `user_id = auth.uid()` — same
        pattern as `add_persona()`/`my_personas()` (2.2), not a fresh design.
  - [ ] Implement AC-7's re-activation step by calling `activate_context_for()`
        (2.1's single private writer) — do not write `member_state` directly and do
        not call `set_active_context()` (it cannot set NULL and would re-validate a
        membership this function has just proven).
  - [ ] `06_grants.sql`: `revoke all on function public.remove_persona(text) from
        public, anon;` then grant `execute` to `authenticated` (the file's standard
        revoke-then-grant pattern — PUBLIC gets EXECUTE by default otherwise).

- [ ] **Task 3 — Migration** (AC: 6)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        persona_lifecycle_changes`, hand-check grants, apply.

- [ ] **Task 4 — Settings UI** (AC: 1)
  - [ ] New `settings/PersonasSection.tsx` (mirrors `settings/FamilySection.tsx`'s
        "quiet summary" visual pattern), rendering `login/PersonaChecklist.tsx` (2.3)
        pre-checked from `useMyPersonas()` (2.3's hook). Each toggle calls
        `dataProvider.addPersona()` / a new `dataProvider.removePersona()` immediately
        — no batch "save" button, matching `PreferencesSection.tsx`'s
        commit-on-change selects (AC-1; `PrivacySection.tsx` has no toggles — it is
        export/delete buttons — so `PreferencesSection` is the only live precedent).
  - [ ] Unticking `single` or `parent` when AC-2/AC-5's guard would reject it: surface
        the SQL exception's message as a specific, translated error (not the raw
        Postgres error text) via the same error-mapping pattern the codebase already
        uses for other RPC failures (e.g. `crm.auth.onboarding.child_save_error`'s
        `catch` block shape in `FirstRunSetup.tsx`).
  - [ ] Add `PersonasSection` to `settings/SettingsPage.tsx` and
        `settings/SettingsPageMobile.tsx`, next to `FamilySection`.

- [ ] **Task 5 — dataProvider** (AC: 2)
  - [ ] `providers/supabase/dataProvider.ts`: `removePersona(persona)` →
        `.rpc("remove_persona", { p_persona: persona })`, propagating the SQL
        exception's message to the caller rather than swallowing it (Settings needs the
        specific guard message from AC-5).
  - [ ] `providers/fakerest/dataProvider.ts`: emulate the same three branches and the
        same two guards against the in-memory `db`.

- [ ] **Task 6 — Tests** (AC: 3, 4, 5, 6, 7)
  - [ ] Extend `supabase/tests/context_resolution.sql`: archive-not-delete (AC-3), the
        two removal guards (AC-5), the active-context handoff on self-removal (AC-7),
        and the new status check constraint rejecting any value outside
        `active`/`archived` (AC-6).
  - [ ] Component test for `PersonasSection`: toggling off a guarded persona surfaces
        the specific error and leaves the checkbox checked (the removal did not
        silently succeed in the UI while failing server-side).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### The epic's own example, traced end to end

> "Given I registered as a parent only / When I add the single persona later from
> settings / Then a single record pointing at me is created in my household, with no
> re-registration / And when I remove a persona, its records are archived and remain
> auditable / And no history, suggestion, reference or thread is deleted by removing a
> persona."
> [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5]

The "add" half is already fully built by Story 2.2's `add_persona('single')` — this
story's AC-1 is the Settings **wiring** for a function that already exists, not new
provisioning logic. The "remove" half (`remove_persona()`, AC-2/3) is what this story
actually builds new, because 2.2 deliberately stopped at provisioning and left removal
here (2.2's scope is provisioning only; its Dev Notes "Decisions this story settles"
records the matching `status`-constraint hand-off to this story).

### Why the two removal guards exist (AC-2, AC-5) — not invented complexity

Removing `single` when it is a user's only persona would leave an `account_members` row
with no purpose it can serve — the household exists, the user is in it, but they hold no
role that does anything (a bare `self_manager`/`single` row with no reason to be
consulted). Removing `parent` while other singles still depend on this admin and no one
else can act for them would silently orphan real children's records mid-process — the
opposite of the product's whole promise. Both guards are refusals, not silent no-ops,
because a silent no-op here would look like success in the UI while quietly not doing
what was asked; a specific, named error is the honest response. Neither guard is stated
verbatim in epics.md's Story 2.5 text, but both follow directly from FR82 ("removing a
persona archives, never deletes") combined with the ordinary meaning of "archive a
household's only admin while dependents remain" — which cannot be reconciled with
"nothing is deleted" if taken literally (an admin-less household with active singles is
not itself deleted, but it becomes unmanageable, which is a worse outcome the guard
exists to prevent). Flagged here explicitly as this story's own reasoned addition, not a
literal epic requirement, so a reviewer can evaluate the reasoning rather than hunt for
a source that does not exist.

### Verified current state

- `account_members.status` (`01_tables.sql:269`): `text not null default 'active'`, no
  check constraint — Story 2.2 explicitly left it this way (see its Dev Notes), on the
  understanding that this story adds the constraint once `'archived'` is a real value.
- `singles.status` (post-1.3 rename, `01_tables.sql:288` today as `children.status`):
  already `text not null default 'active'` — this story is the **first** thing to write
  `'archived'` into it, but the column itself needs no schema change.
- `settings/FamilySection.tsx` — the "quiet summary section" visual pattern
  `PersonasSection.tsx` follows.
- **Settings reachability (interim):** the desktop entry points to `/settings` (the
  Sidebar nav item and the TopBar user-menu item) are wrapped in
  `<CanAccess resource="configuration" action="edit">` today, which resolves true only
  for a member whose legacy `administrator` flag is set — the mobile bottom nav is
  ungated, and the route itself is ungated. Story 2.7's `is_admin()` retirement removes
  those two wrappers; until it lands, this story's `PersonasSection` is reachable by
  every member on mobile and by direct URL on desktop. Do not add a third gate or a
  workaround here.

### Security posture

`remove_persona()` is a new `SECURITY DEFINER` function that archives access — the
highest-consequence direction to get wrong is archiving the **wrong** membership (e.g.
someone else's). Every query inside must filter on `user_id = auth.uid()`; there is no
parameter that ever names another user or another account directly. This is a
`.claude/rules/security-triggers.md` case; a security review is expected.

### Testing standards

Extend `supabase/tests/context_resolution.sql` (2.1/2.2's suite) rather than adding a
fourth file for this domain area — `.claude/rules/testing.md`'s negative-test
requirement applies to both new guards (AC-5) and to AC-3's "nothing is deleted"
assertion.

### Project Structure Notes

New: `settings/PersonasSection.tsx`. Edited: `settings/SettingsPage.tsx`,
`settings/SettingsPageMobile.tsx`, both `dataProvider.ts` files, `01_tables.sql`,
`02_functions.sql`, `06_grants.sql`. Reused, not duplicated: `login/PersonaChecklist.tsx`
and `root/useMyPersonas.ts` (both from Story 2.3).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5] — the story's own AC text.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#Personas-change-over-a-lifetime]
  — "removing one archives, never deletes … entitlement, listings and connections must
  tolerate a persona being switched off."
- [Source: ARCHITECTURE-SPINE.md#AD-2] — "removing one archives, never deletes (FR82)."
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — `add_persona()`, `my_personas()`, the `SECURITY DEFINER` rationale this story reuses
  verbatim for `remove_persona()`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
