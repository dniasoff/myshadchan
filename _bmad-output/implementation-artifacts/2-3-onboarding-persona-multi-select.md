# Story 2.3: Onboarding Persona Multi-Select

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new user,
I want to say whether I am a single, a parent, a shadchan — or more than one —
during onboarding,
so that the app provisions the contexts I actually need without me re-registering
later.

## Dependencies

**Requires Story 2.2** (hard): this story is a pure frontend consumer of
`add_persona()` and `public.my_personas()`. It performs no provisioning logic of its
own — if a case here looks like it needs a new SQL write path, that is a sign 2.2's
function is missing a branch, not a reason to add one here (NFR-14 / single-owner
rule).

**Shares its UI with Story 2.5.** `login/PersonaChecklist.tsx` (Task 4) is a standalone
component with no onboarding-specific behaviour, specifically so Settings' "add/remove a
persona" affordance (2.5) can import it rather than re-implement it. Land this story
first so 2.5 imports rather than duplicates it.

## Acceptance Criteria

1. **Onboarding shows the multi-select exactly when a login holds no persona yet.**
   `root/OnboardingGate.tsx`'s trigger condition changes from "zero `singles` rows and
   not demo" to "`my_personas()` returns zero rows and the account is not in demo mode."
   This is a real behaviour change from today (a `parent_admin` with a household but zero
   `singles` yet used to see onboarding; after this story they do not, because they
   already hold the `parent` persona) — see Dev Notes "Why the trigger condition
   changes, not just the label."

2. **The user can tick any combination of single / parent / shadchan.** A new,
   standalone `login/PersonaChecklist.tsx` component (Task 4) renders three independent
   checkboxes with the exact wording from personas-and-contexts.md ("I'm looking for a
   shidduch for myself" / "I'm looking for a shidduch for my children" / "I'm a
   matchmaker (shadchan)"). Continuing with none ticked is blocked with an inline
   validation message — there is no "none of the above."

3. **Submitting calls `add_persona()` once per ticked box, `parent` before `single`.**
   This order is load-bearing (2.2 Dev Notes: ticking both yields one household, not
   two, only if `parent` provisions the household first and `single` then finds it).
   The three calls are sequential `await`s, not `Promise.all` — a household created by
   the `parent` call must be committed before the `single` call looks for it.

4. **Ticking `single` alone lands the user on a finished record, not an empty form.**
   Because `add_persona('single')` already creates a `singles` row for the caller (2.2
   AC-6), the wizard does not ask them to "add a single" — that step only appears when
   `parent` was ticked. The done screen for a single-only signup reads distinctly from
   the parent one (e.g. "Your record is ready" rather than "\<child\>'s record is
   ready").

5. **Ticking `parent` (with or without `single`) still asks for the first single.**
   `login/FirstRunSetup.tsx`'s existing "add a single" step is kept for this case,
   rewired to operate on the household `add_persona('parent')` just created (looked up
   via `my_personas()`'s `account_id` for the `parent` row) instead of assuming
   `accounts[0]` already exists — today's code reads `useGetList("accounts")` and takes
   the first result, which only ever worked because the old `handle_new_user()`
   auto-bootstrapped one account for the very first global user (Story 2.7 removes that
   bootstrap; every user now provisions their own via `add_persona`).

6. **Ticking `shadchan` (alone or combined) provisions the shadchanus context silently**
   — no extra form (2.2's `add_persona('shadchan')` needs no input beyond the tick
   itself) — and the done screen acknowledges it ("Your shadchanus book is ready").

7. **"Explore with demo data" keeps working for a user with zero personas.** Today's
   `seedDemo()` (`supabase/functions/seed_demo`) requires the caller to already have an
   account — which today only the very **first** user ever (the bootstrap in
   `handle_new_user()`) or an admin-invited user gets; everyone else fails closed with
   no membership at all. This story's onboarding screen calls `add_persona('parent')` immediately
   before `dataProvider.seedDemo()` when "Explore with demo data" is chosen, so a
   brand-new invited user always has a household to seed into. This is the one place
   this story calls `add_persona` outside the multi-select's own submit handler, and it
   is documented inline as such.

8. **The dataProvider gains two thin RPC wrappers, mirrored in both providers (AD-10).**
   `getMyPersonas(): Promise<MyPersona[]>` (RPC `my_personas`) and
   `addPersona(persona: Persona): Promise<void>` (RPC `add_persona`), added to
   `providers/supabase/dataProvider.ts` following the exact shape of the existing
   `currentAccountDemo()` method, and emulated in `providers/fakerest/dataProvider.ts`
   following `currentAccountDemo`'s fakerest emulation (`providers/fakerest/dataProvider.ts:898`)
   — an in-memory equivalent of 2.2's provisioning rules, not a stub that always
   succeeds silently.

9. **A new `useMyPersonas()` hook is the one place the app asks "what am I."**
   `src/components/atomic-crm/root/useMyPersonas.ts`, mirroring
   `root/useAccountDemo.ts`'s shape exactly (`useQuery` wrapping
   `dataProvider.getMyPersonas()`, a shared query-key constant). `OnboardingGate` and
   the onboarding screen both use it; neither queries `singles`/`account_members`
   directly to infer personas.

10. **User-facing copy is added, not hardcoded** (AD-18): every new string goes through
    `providers/commons/englishCrmMessages.ts` / `frenchCrmMessages.ts` under a new
    `crm.auth.onboarding.persona_*` key group, following the existing `_:` default-value
    convention already used throughout `FirstRunSetup.tsx`'s keys.

11. **Toolchain green**: `make typecheck && npm run lint && make test`. This story adds
    no SQL, so `npm run test:unit:db` is unaffected; a passing run is still required
    since 2.2's suite must remain green.

## Tasks / Subtasks

- [ ] **Task 1 — dataProvider RPC wrappers** (AC: 8)
  - [ ] `providers/supabase/dataProvider.ts`: add `getMyPersonas()` and `addPersona()`
        next to `currentAccountDemo()` (same file, same section), calling
        `getSupabaseClient().rpc("my_personas")` / `.rpc("add_persona", { p_persona })`.
  - [ ] `providers/fakerest/dataProvider.ts`: emulate both against the in-memory `db`
        — `getMyPersonas` derives from `db.account_members`/`db.singles` using the same
        rules 2.2's `my_personas()` uses (`parent` from `parent_admin`, `single` from a
        `singles` row pointing at any own membership, `shadchan` from a
        `shadchan`-role membership — copy the rules, don't reinvent them); `addPersona` mutates the fake `db` the same way the SQL
        function mutates real tables (create a household/singles row/shadchanus account
        as appropriate). The fake collection keys are snake_case, matching the real
        tables: `db.account_members` (verified in
        `providers/fakerest/dataGenerator/types.ts` and `shidduchim.ts`), `db.accounts`,
        and — post-1.3 — `db.singles`.
  - [ ] Add matching `MyPersona` / `Persona` types to `src/components/atomic-crm/types.ts`.

- [ ] **Task 2 — `useMyPersonas` hook** (AC: 9)
  - [ ] `root/useMyPersonas.ts`, mirroring `root/useAccountDemo.ts` (Read that file
        before writing this one — same query-key-constant pattern, same doc-comment
        style explaining why it is a shared cache key).

- [ ] **Task 3 — Onboarding gate trigger** (AC: 1)
  - [ ] `root/OnboardingGate.tsx`: replace the `useGetList<Single>("singles", …)` +
        `hasChildren`-style check with `useMyPersonas()`; `showOnboarding = personas.length
        === 0 && isDemo !== true`.

- [ ] **Task 4 — `PersonaChecklist`, a standalone reusable component** (AC: 2)
  - [ ] New `login/PersonaChecklist.tsx`: the three-checkbox control from AC-2, taking
        `value: Persona[]` / `onChange: (next: Persona[]) => void` — a plain controlled
        checkbox group with no onboarding-specific behaviour (no wizard steps, no
        `add_persona` calls, no demo button) baked in. **Story 2.5 imports this exact
        file** for its Settings "add/remove a persona" affordance — do not couple it to
        anything onboarding-only (the done screen, the demo button, the step machinery
        all stay in `OnboardingChoice.tsx`).

- [ ] **Task 5 — The persona multi-select screen** (AC: 3, 4, 6, 7, 10)
  - [ ] Extend `login/OnboardingChoice.tsx`: the existing "choice" mode (demo vs. own
        family) gets a new intermediate state for the "own family" path — before
        `FirstRunSetup` renders, render `PersonaChecklist` (Task 4) plus a "Continue"
        button and the AC-2 "at least one" validation.
  - [ ] Wire "Explore with demo data" per AC-7 (call `addPersona("parent")` then
        `seedDemo()`).
  - [ ] On multi-select submit, call `addPersona()` sequentially per AC-3, then route:
        if `parent` was ticked, hand off to `FirstRunSetup` (Task 6); otherwise show the
        done screen directly (AC-4/AC-6), summarising every persona actually provisioned.

- [ ] **Task 6 — Rework `FirstRunSetup`** (AC: 5)
  - [ ] `login/FirstRunSetup.tsx`: drop the `account` step's `useGetList("accounts")` +
        blind `accounts[0]` assumption; resolve the household via `useMyPersonas()`'s
        `parent` row's `account_id` instead (passed in as a prop from Task 5, since the
        multi-select screen already has it from the `addPersona` calls it just made).
        Keep the "name your family" step and the "add a single" step; rename the latter's
        copy from "child" to "single" wording only where it still says "child" (verify
        against 1.3's rename — if 1.3 has already landed, `FirstRunSetup.tsx` should
        already say "single" everywhere and this sub-task is a no-op to confirm, not
        redo).

- [ ] **Task 7 — Copy** (AC: 10)
  - [ ] Add the new `crm.auth.onboarding.persona_*` keys to both message catalogues.

- [ ] **Task 8 — Tests** (AC: all)
  - [ ] Extend/add a component test for the multi-select's validation (AC-2's "at least
        one" rule) and for the call-ordering in AC-3 (mock `dataProvider.addPersona` and
        assert call order `parent` then `single` when both are ticked).
  - [ ] `make typecheck && npm run lint && make test`.

## Dev Notes

### Why the trigger condition changes, not just the label

Today, `OnboardingGate` shows the welcome screen based on `singles` being empty — a
`parent_admin` with a household but no children yet sees onboarding. After this story,
onboarding is about **persona provisioning**, which a `parent_admin` membership already
proves happened. Re-showing "which personas apply to you" to someone who is
demonstrably already a `parent` would be confusing and would risk them double-clicking
`add_persona('parent')` from a stale screen (harmless — Story 2.2 made it idempotent —
but still wrong UX). `my_personas()` returning zero rows is the correct, precise
condition: it is true only for a user who has never provisioned anything, which is
exactly "new user, first login" (AC-1).

### The `seedDemo()` dependency this story surfaces (flag for the epic owner)

`supabase/functions/seed_demo/index.ts` resolves the caller's existing account before
seeding (`resolveAccountId`, `_shared/resolveDemoAccount.ts`) and has never needed to
create one — in the pre-2.7 world the only self-served user was the bootstrapped first
one, who already had an account. Story 2.7 removes that bootstrap. AC-7's fix (call
`add_persona('parent')` client-side before `seedDemo()`) keeps the demo path working
without touching the edge function, but it is a workaround, not a redesign: if a caller
somehow reaches "Explore with demo data" through a path that skips this screen (there is
none today, but flag it for whoever adds one later), `seed_demo` will still fail for a
personaless caller. Not a gap this story needs to close inside the edge function, since
epics.md assigns this story no edge-function scope — flagged so it is not silently
forgotten.

### Verified current state

- `root/OnboardingGate.tsx` (today): `useGetList<Child>("children", …)`, gate on
  `hasChildren`. Post-1.3 this reads `Single`/`"singles"`; post-this-story it reads
  `useMyPersonas()` instead and drops the `singles` query entirely.
- `login/OnboardingChoice.tsx` (today, 186 lines): two-card choice (`ExploreDemoButton`,
  `OwnFamilyButton`), no persona concept at all.
- `login/FirstRunSetup.tsx` (today, 338 lines): assumes `accounts[0]` already exists
  (works only because of the pre-2.7 bootstrap); this story's Task 6 is the fix.
- `root/useAccountDemo.ts` — the exact hook shape Task 2 mirrors, read in full before
  writing `useMyPersonas.ts`.
- `providers/supabase/dataProvider.ts:587-596` (`currentAccountDemo`) and
  `providers/fakerest/dataProvider.ts:898` — the exact RPC-wrapper shape Task 1 mirrors.

### Testing standards

Component-level tests (Vitest + Testing Library, matching the project's existing
`*.test.tsx` convention, e.g. `landing/LandingGate.test.tsx` or
`tasks/TasksListFilter.test.tsx` — not `GoogleSignInButton.test.tsx`, which Story 2.6
deletes) for the multi-select's validation and call-ordering. No new SQL in this story, so no `supabase/tests/*.sql`
addition — `.claude/rules/testing.md`'s AAA structure still applies to the component
tests.

### Project Structure Notes

Everything in this story lives under `src/components/atomic-crm/{login,root,providers}/`
— no new top-level directory. `MyPersona`/`Persona` types go in the existing
`src/components/atomic-crm/types.ts`, not a new types file (grow the file count only
when a module crosses the 400-line typical ceiling — `types.ts` is not this story's to
split).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3] — the four-bullet AC
  this story implements verbatim (single→household+singles row, parent→household+prompt,
  shadchan→shadchanus, both→one household).
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — `add_persona()`, `my_personas()`, the parent-before-single ordering requirement.
- [Source: ARCHITECTURE-SPINE.md#AD-18] — all UI strings via the i18nProvider, no
  hardcoded text.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
