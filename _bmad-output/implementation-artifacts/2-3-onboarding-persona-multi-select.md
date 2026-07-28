---
baseline_commit: 92349754a11ce806aa5f69beeebb670ef5e077e1
---

# Story 2.3: Onboarding Persona Multi-Select

Status: review

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
rule). Verified 2026-07-28: `grep -rn "my_personas\|add_persona" src/ supabase/ workers/`
returns **0** hits, so neither function exists yet and every AC below that names them is
gated on 2.2 landing first.

**Requires Story 2.1** (soft, but load-bearing for AC-7): 2.1 AC-5 adds an
`after insert` trigger on `public.account_members` (`activate_first_context()`) that
sets `member_state.active_account_id` when the inserted row is the user's first active
membership. Without it, the household `add_persona('parent')` creates would exist but
would not be the caller's *active* context, and `seed_demo`'s user-scoped writes
(`_shared/resolveDemoAccount.ts:29-44` — a JWT-scoped client that relies on RLS) would
land nowhere. This story adds no client-side "now switch to it" step because 2.1 makes
one unnecessary.

**Shares its UI with Story 2.5.** `login/PersonaChecklist.tsx` (Task 4) is a standalone
component with no onboarding-specific behaviour, specifically so Settings' "add/remove a
persona" affordance (2.5) can import it rather than re-implement it. 2.5 states the
dependency explicitly in its own text (`2-5-persona-lifecycle-changes.md:17,125-126,232-233`).
Land this story first so 2.5 imports rather than duplicates it.

**Epic 1 is merged and deployed** (`main` @ `8ad49cb`). This story targets the
post-Epic-1 tree: `sales` → `members`, `children` → `singles`, `sales_id` → `member_id`,
route/resource registration via `root/routeManifest.ts`, and no token portal. Every
file path, line number and count below was re-verified against that tree.

## Acceptance Criteria

1. **Onboarding shows the multi-select exactly when a login holds no persona yet.**
   `root/OnboardingGate.tsx` today reads
   `useGetList<Single>("singles", { pagination: { page: 1, perPage: 1 }, … })` (lines
   32-38) and gates on `const hasSingles = (singlesTotal ?? 0) > 0; const showOnboarding
   = !hasSingles && isDemo !== true;` (lines 45-46). That becomes "`my_personas()`
   returns zero rows and the account is not in demo mode." This is a real behaviour
   change (a `parent_admin` with a household but zero `singles` rows sees onboarding
   today; after this story they do not, because they already hold the `parent` persona)
   — see Dev Notes "Why the trigger condition changes, not just the label."
   **Decided by:** `grep -n "useGetList" src/components/atomic-crm/root/OnboardingGate.tsx`
   returns nothing, and `grep -n "useMyPersonas" …/OnboardingGate.tsx` returns a hit.

2. **The user can tick any combination of single / parent / shadchan.** A new,
   standalone `login/PersonaChecklist.tsx` component (Task 4) renders three independent
   checkboxes. The label copy derives from the persona table in
   `_bmad-output/specs/spec-myshadchan/personas-and-contexts.md:14-16`, whose "Means"
   column reads *"I am looking for a shidduch for myself"* / *"I am looking for a
   shidduch for my children"* / *"I am a matchmaker"*. The UI may contract these
   (`I'm …`) and may append the disambiguating `(shadchan)` to the third — nothing else.
   Continuing with none ticked is blocked with an inline validation message; there is no
   "none of the above."
   **Decided by:** the Task-8 component test that renders `PersonaChecklist`, asserts
   three checkbox roles, and asserts Continue is rejected with zero ticked.
   **Precedent to follow:** `login/AgeAffirmation.tsx:5` already uses
   `Checkbox` from `@/components/ui/checkbox` on this same auth surface.

3. **Submitting calls `add_persona()` once per ticked box, sequentially, `parent`
   before `single`.** The three calls are sequential `await`s, **not** `Promise.all`.
   *Sequential* is the load-bearing part: each `add_persona()` branch is a read-then-write
   ("do I already hold an owning membership? if not, create a household"), so two
   concurrent calls both read "no membership" and both create one — two households, which
   is exactly what 2.2 AC-7 forbids.
   *The order* `parent` → `single` is required for determinism and because it is the exact
   sequence 2.2 AC-7's own test asserts (`2-2-…md:122-126`). Note for the implementer:
   the reverse order also converges to one household under 2.2 AC-6 (`single` with no
   memberships creates a household with `role = 'self_manager'`; `parent` then *promotes*
   that `self_manager` to `parent_admin` in place rather than creating a second). So the
   ordering is a determinism/parity requirement, not the only path to a single household —
   do not "optimise" it away on the theory that order is irrelevant, because the test in
   Task 8 pins it.
   **Decided by:** the Task-8 test mocking `dataProvider.addPersona` and asserting the
   recorded call sequence is exactly `["parent", "single"]` when both are ticked.

4. **Ticking `single` alone lands the user on a finished record, not an empty form.**
   Because `add_persona('single')` already creates a `singles` row for the caller
   (2.2 AC-6, `single` branch), the wizard does not ask them to "add a single" — that
   step only appears when `parent` was ticked.
   **Already half-satisfied by the current tree:** `FirstRunSetup.tsx:311-320` already
   branches its done copy on whether a single was named
   (`crm.auth.onboarding.done_body_named` → `"<name>'s record is ready…"` vs
   `crm.auth.onboarding.done_body` → `"Your record is ready…"`). The unnamed variant is
   already the right copy for a single-only signup; what is new is *routing there without
   passing through the "add a single" step*. Do not add a third copy variant for this.
   **Decided by:** the Task-8 test asserting that with only `single` ticked the rendered
   step sequence never includes the "add a single" form.

5. **Ticking `parent` (with or without `single`) still asks for the first single.**
   `login/FirstRunSetup.tsx` today resolves the household with
   `useGetList<Account>("accounts", { pagination: { page: 1, perPage: 1 }, … })` and
   `const account = accounts?.[0];` (lines 48-55). That assumption is already a dead end
   for a user with no account: `handleAccountSubmit` early-returns on `if (!account)
   return;` (line 71) and the submit button is `disabled={isSavingAccount || !account}`
   (line 188) — the step renders and does nothing. It only ever worked because
   `handle_new_user()` bootstraps one account for the very first global user
   (`supabase/schemas/02_functions.sql:57-70`), which Story 2.7 removes
   (`2-7-…md:148-149`, Task 4 at `:242-243`). Rewire it to take the household id as a
   prop from Task 5's screen (which already has it from the `my_personas()` `parent`
   row's `account_id`).
   **Decided by:** `grep -n 'useGetList' src/components/atomic-crm/login/FirstRunSetup.tsx`
   returns nothing.

6. **Ticking `shadchan` (alone or combined) provisions the shadchanus context silently**
   — no extra form (2.2's `add_persona('shadchan')` takes no input beyond the tick
   itself) — and the done screen acknowledges it ("Your shadchanus book is ready").
   **Decided by:** the Task-8 test asserting that ticking only `shadchan` renders neither
   the "name your family" nor the "add a single" step, and that the done screen names the
   shadchanus context.

7. **"Explore with demo data" keeps working for a user with zero personas.**
   `supabase/functions/seed_demo/index.ts:282-285` calls `resolveAccountId(user.id)` and
   returns `409 "No active account for user"` when it is null;
   `_shared/resolveDemoAccount.ts:13-23` resolves it from the caller's first *active*
   `account_members` row and nothing else. Today only the bootstrapped first global user
   or an admin-invited user has one; Story 2.7 removes the bootstrap. This story's
   onboarding screen therefore calls `addPersona("parent")` immediately before
   `dataProvider.seedDemo()` on the "Explore with demo data" path
   (`login/OnboardingChoice.tsx:56-75`, `seedDemo()` at line 62), so a brand-new user
   always has a household to seed into. This is the **one** place this story calls
   `add_persona` outside the multi-select's own submit handler, and it is documented
   inline as such.
   **Decided by:** an inline comment at the call site naming this AC, plus the Task-8
   test asserting `addPersona("parent")` is awaited before `seedDemo()` on the demo path.

8. **The dataProvider gains two thin RPC wrappers, mirrored in both providers (AD-10).**
   `getMyPersonas(): Promise<MyPersona[]>` (RPC `my_personas`) and
   `addPersona(persona: Persona): Promise<void>` (RPC `add_persona`), added to
   `providers/supabase/dataProvider.ts` next to `currentAccountDemo()`
   (**lines 451-460**, inside the "Demo / onboarding (Stage B)" block that starts at
   line 425), and emulated in `providers/fakerest/dataProvider.ts` next to its
   `currentAccountDemo` (**line 723**) — an in-memory equivalent of 2.2's provisioning
   rules, not a stub that always succeeds silently.
   **This mirroring is typechecked, not review-enforced:** `CrmDataProvider` is
   `ReturnType<typeof getDataProviderWithCustomMethods>`
   (`providers/supabase/dataProvider.ts:500-502`), re-exported by
   `providers/types.ts:1`, and the fakerest object is annotated
   `const dataProviderWithCustomMethod: CrmDataProvider = {` (`fakerest/dataProvider.ts:363`).
   Adding a method on the Supabase side and not the fakerest side fails `make typecheck`.
   **Decided by:** `make typecheck`.

9. **A new `useMyPersonas()` hook is the one place the app asks "what am I."**
   `src/components/atomic-crm/root/useMyPersonas.ts`, mirroring `root/useAccountDemo.ts`
   (17 lines; read it in full first) exactly: a `useQuery` wrapping
   `dataProvider.getMyPersonas()`, plus an exported shared query-key constant
   (`MY_PERSONAS_QUERY_KEY`, the sibling of `ACCOUNT_DEMO_QUERY_KEY` at
   `useAccountDemo.ts:9`) so `OnboardingGate` and the onboarding screen share one cache
   entry and one RPC call. Neither queries `singles` / `account_members` directly to
   infer personas. While the query is pending, `OnboardingGate` renders `children` — the
   existing behaviour at `OnboardingGate.tsx:41-43`, kept so there is no flash of the
   welcome screen on reload.
   **Decided by:** `grep -rn '"singles"' src/components/atomic-crm/root/OnboardingGate.tsx`
   returns nothing, and `grep -rn "getMyPersonas" src/` shows call sites only inside
   `root/useMyPersonas.ts`.

10. **User-facing copy is added, not hardcoded** (AD-18): every new string goes through
    `providers/commons/englishCrmMessages.ts` (448 lines) **and**
    `providers/commons/frenchCrmMessages.ts` (445 lines) under a new
    `crm.auth.onboarding.persona_*` key group, nested under the existing `crm.auth`
    group (english line 117, french line 120), and read via
    `translate(key, { _: "default" })` — the convention `FirstRunSetup.tsx` already uses
    throughout.
    **Two pre-existing inconsistencies are explicitly out of scope, not oversights:**
    (a) `grep -rno "crm\.auth\.onboarding\.[a-z_]*" src/` finds **16** keys in use, and
    `grep -c "onboarding" providers/commons/{english,french}CrmMessages.ts` returns
    **0 / 0** — the whole existing group is inline-default-only today; back-filling those
    16 is not this story's job. (b) `login/OnboardingChoice.tsx` renders **9** user-facing
    strings inline and does not import `useTranslate` at all — Task 5 extends that file,
    and only the strings Task 5 *adds* must be catalogued. Both are flagged to the epic
    owner in Dev Notes rather than silently absorbed.
    **Decided by:** `grep -c "persona_" providers/commons/englishCrmMessages.ts` and the
    same on the french catalogue return the same non-zero number.

11. **`MemberRole` gains `"single"`.** `src/components/atomic-crm/types.ts:84-85` is
    `export type MemberRole = "parent_admin" | "helper" | "self_manager" | "shadchan";`
    — it does not include `"single"`. 2.2 AC-2 widens the DB's
    `account_members_role_check` to `('parent_admin', 'single', 'helper', 'self_manager',
    'shadchan')` but 2.2 touches no TypeScript at all (`grep -n "types.ts\|MemberRole"` on
    `2-2-…md` returns nothing). This story is the first frontend consumer of that role
    (the fakerest `getMyPersonas` emulation reads `db.account_members[].role`), so the
    one-token widening lands here or the TS type silently diverges from the check
    constraint.
    **Decided by:** `grep -n '"single"' src/components/atomic-crm/types.ts` matches inside
    the `MemberRole` union.

12. **No route or resource is registered; `routeManifest.ts` is untouched.** Since Story
    1.5, all `<Resource>` / `<Route>` JSX is gone: `root/routeManifest.ts` (282 lines) is
    the single source of truth, mapped over by `DesktopAdmin` / `MobileAdmin`
    (`root/CRM.tsx:212,237` via `routesFor` / `resourcesFor`, imported at `CRM.tsx:40-41`).
    Onboarding is **not** a route — `OnboardingGate` wraps the whole shell inline from
    `layout/Layout.tsx:25` and `layout/MobileLayout.tsx:23`. Nothing in this story adds a
    manifest entry.
    **Decided by:** `git diff --name-only` lists neither
    `src/components/atomic-crm/root/routeManifest.ts` nor `root/CRM.tsx`, and
    `root/routeManifest.test.ts` stays green under `make test`.

13. **This story writes no SQL.** Nothing under `supabase/` changes — in particular not
    `supabase/schemas/07_storage.sql`, whose three account-scoped `storage.objects`
    policies (lines 25-44, each calling `public.current_account_id()`) are Story 2.1's to
    migrate to `current_context_id()`, not this story's. Provisioning SQL is 2.2's;
    `handle_new_user()` is 2.7's; the `seed_demo` edge function is deliberately untouched
    (see Dev Notes).
    **Decided by:** `git diff --name-only -- supabase/` is empty.

14. **Toolchain green**: `make typecheck && make lint && make test`, plus
    `node scripts/check-retired-names.mjs`.
    - `make lint` runs `npm run lint` **and** `npm run prettier` (`makefile:118-120`) —
      `npm run lint` alone is not the gate.
    - `make test` runs `npm run test` (`makefile:108-109`) = `vitest --run` over all
      **five** projects, `db` included; there is no separate `npm run test:unit:db` step
      to remember. The `db` project self-skips when the local Supabase stack is
      unreachable, so a green local run is not proof 2.2's SQL suite passed — run it
      against a live local stack before calling the story done.
    - `node scripts/check-retired-names.mjs` is a CI gate
      (`.github/workflows/check.yml:147`). Its `1.3-children-camelcase` pattern bans
      `\bChild\b|\bChildren\b|Child[A-Za-z]|[a-z]Child|CHILD|child[a-z]*[A-Z]` across
      `src/` (exempting only React's own `asChild`, `PropsWithChildren`, etc.), so **no
      new identifier, comment or string in this story may use "child"** — `hasChildren`,
      `childCount`, `ChildStep` and friends all fail CI.

## Tasks / Subtasks

- [x] **Task 1 — dataProvider RPC wrappers** (AC: 8, 11)
  - [x] `providers/supabase/dataProvider.ts`: add `getMyPersonas()` and `addPersona()`
        inside the existing "Demo / onboarding (Stage B)" block (starts line 425),
        immediately after `currentAccountDemo()` (lines 451-460), calling
        `getSupabaseClient().rpc("my_personas")` / `.rpc("add_persona", { p_persona })`.
        Match `currentAccountDemo`'s error shape: `console.error("<rpc>.error", error)`.
        **Fail-soft vs. fail-loud differs by method:** `getMyPersonas` may fall back to
        `[]` only if the caller then treats "unknown" as "show onboarding" — prefer
        throwing, since a swallowed error here silently re-runs onboarding for an
        existing user. `addPersona` must always throw: a swallowed provisioning failure
        strands the user with no context.
  - [x] `providers/fakerest/dataProvider.ts`: add both to
        `dataProviderWithCustomMethod` (line 363) next to `currentAccountDemo` (line 723),
        against the in-memory `db` closed over by `createDataProvider` (parameter at
        line 117). `getMyPersonas` derives — never stores — using **2.2 AC-8's exact
        predicates, copied not reinvented**: `parent` from an active `parent_admin`-role
        membership; `shadchan` from an active `shadchan`-role membership; `single` from a
        `singles` row whose `member_id` matches **any** of the caller's own active
        memberships. `addPersona` mutates the fake `db` the same way the SQL function
        mutates real tables (create household / `singles` row / shadchanus account as
        appropriate, and no-op on the same idempotency predicates).
  - [x] The fake collection keys are snake_case and match the real tables — verified in
        `providers/fakerest/dataGenerator/types.ts:26-28` (`accounts`, `account_members`,
        `singles`) and assigned in `dataGenerator/shidduchim.ts:384-386`.
  - [x] Add `Persona` (`"single" | "parent" | "shadchan"`) and `MyPersona`
        (`{ persona: Persona; account_id: Identifier; account_kind: "household" |
        "shadchanus"; role: MemberRole }`, matching 2.2 AC-8's
        `returns table(persona text, account_id bigint, account_kind text, role text)`)
        to `src/components/atomic-crm/types.ts` (592 lines — under the 800-line hard
        ceiling in `.claude/rules/coding-style.md`, so it does not get split here;
        `Account` is at 91-97, `AccountMember` at 99-106, `Single` at 108-120).
  - [x] Widen `MemberRole` (`types.ts:84-85`) with `"single"` per AC-11.

- [x] **Task 2 — `useMyPersonas` hook** (AC: 9)
  - [x] `root/useMyPersonas.ts`, mirroring `root/useAccountDemo.ts` (17 lines — read it
        first): same exported-query-key-constant pattern, same doc-comment style
        explaining why it is a shared cache key.

- [x] **Task 3 — Onboarding gate trigger** (AC: 1)
  - [x] `root/OnboardingGate.tsx`: delete the `useGetList<Single>("singles", …)` block
        (lines 32-38) and the `hasSingles` derivation (line 45); replace with
        `useMyPersonas()` and `showOnboarding = personas.length === 0 && isDemo !== true`.
        Keep the pending-renders-`children` behaviour (lines 41-43), now gating on the
        personas query's `isPending` alongside `demoPending`.
  - [x] Drop the now-unused `Single` import (line 5) and `useGetList` import (line 2).
  - [x] Rewrite the component's doc comment (lines 8-30): it currently says "Shows the
        choice screen whenever the account has no singles AND isn't already in demo mode"
        and "The choice naturally stops showing once a single exists" — both become
        wrong. Keep the paragraph explaining why there is deliberately **no**
        seen/dismissed store flag (it documents a reverted attempt and still applies);
        re-express the condition in persona terms.

- [x] **Task 4 — `PersonaChecklist`, a standalone reusable component** (AC: 2)
  - [x] New `login/PersonaChecklist.tsx`: the three-checkbox control from AC-2, taking
        `value: Persona[]` / `onChange: (next: Persona[]) => void` — a plain controlled
        checkbox group with no onboarding-specific behaviour (no wizard steps, no
        `add_persona` calls, no demo button) baked in. Use `Checkbox` from
        `@/components/ui/checkbox` + `Label` from `@/components/ui/label`, following
        `login/AgeAffirmation.tsx` (same surface, same primitives).
  - [x] **Story 2.5 imports this exact file** for its Settings "add/remove a persona"
        affordance and renders it pre-checked from `useMyPersonas()`
        (`2-5-…md:23,125-126`) — do not couple it to anything onboarding-only (the done
        screen, the demo button and the step machinery all stay in `OnboardingChoice.tsx`).
        In particular the "at least one ticked" rule is the *caller's* to enforce: 2.5
        legitimately allows unticking down to zero (persona removal), so that validation
        lives in Task 5's screen, not in this component.

- [x] **Task 5 — The persona multi-select screen** (AC: 3, 4, 6, 7, 10)
  - [x] Extend `login/OnboardingChoice.tsx` (186 lines; `type Mode = "choice" | "own"` at
        line 19): the "own family" path gains an intermediate state before
        `FirstRunSetup` renders — render `PersonaChecklist` (Task 4) plus a "Continue"
        button and the AC-2 "at least one" validation.
  - [x] Wire "Explore with demo data" per AC-7: inside `handleExploreDemo` (lines 56-75),
        `await dataProvider.addPersona("parent")` before the existing
        `await dataProvider.seedDemo()` (line 62), inside the same `try`, so a failed
        provisioning surfaces through the existing `notify(...)` error branch
        (lines 66-74) rather than falling through to a 409 from the edge function.
  - [x] On multi-select submit, call `addPersona()` sequentially per AC-3, then route:
        if `parent` was ticked, hand off to `FirstRunSetup` (Task 6) with the household
        id; otherwise show the done screen directly (AC-4 / AC-6), summarising every
        persona actually provisioned.
  - [x] After the last `addPersona()` resolves, invalidate the `useMyPersonas` query key
        (the screen's own `useQueryClient` is already in place at line 48) so
        `OnboardingGate` re-evaluates against fresh data rather than the pre-provisioning
        empty list.

- [x] **Task 6 — Rework `FirstRunSetup`** (AC: 5)
  - [x] `login/FirstRunSetup.tsx` (340 lines): drop `useGetList<Account>("accounts", …)`
        (lines 48-54) and `const account = accounts?.[0];` (line 55); take the household
        id as a prop from Task 5's screen. Update the three places that consumed the
        derived `account`: the `accountForm` `values` seed (lines 60-62), the
        `if (!account) return;` guard (line 71) and the button's
        `disabled={isSavingAccount || !account}` (line 188). Drop the
        `isAccountLoading` spinner branch (lines 167-171) if the prop makes it dead.
  - [x] Keep the "name your family" step and the "add a single" step unchanged otherwise.
  - [x] **Already satisfied by Epic 1 — verify, do not redo.** The earlier draft of this
        story asked for a "child" → "single" copy rename here. Story 1.3 landed that:
        `FirstRunSetup.tsx` says "single" throughout (`crm.auth.onboarding.single_title`,
        `single_body`, `single_first_name`, `add_single`, `single_save_error`, and the
        `createSingle("singles", …)` call at lines 87-110). Confirm with
        `node scripts/check-retired-names.mjs` — a surviving "child" would fail CI, so
        this needs no manual grep and no edit.

- [x] **Task 7 — Copy** (AC: 10)
  - [x] Add the new `crm.auth.onboarding.persona_*` keys to **both** catalogues, nested
        under the existing `crm.auth` group (`englishCrmMessages.ts:117`,
        `frenchCrmMessages.ts:120`). Keep the two files key-for-key identical in shape;
        `i18nProvider.ts:34-40` layers the french catalogue over the english one, so a
        key present in only one silently falls back rather than erroring.

- [x] **Task 8 — Tests** (AC: all)
  - [x] Add `login/PersonaChecklist.test.tsx` (or extend an `OnboardingChoice` test) for
        AC-2's "at least one" validation and AC-3's call ordering (mock
        `dataProvider.addPersona`, assert the recorded sequence is exactly
        `["parent", "single"]` when both are ticked). Add the AC-4 / AC-6 step-routing
        assertions and AC-7's `addPersona` → `seedDemo` ordering.
  - [x] These land in the `app` vitest project, which runs in real Chromium via
        Playwright (`vitest.config.ts` "app" project) — `make install-playwright-browsers`
        is a prerequisite for running them locally.
  - [x] `make typecheck && make lint && make test && node scripts/check-retired-names.mjs`
        (AC-14).

## Dev Notes

### Why the trigger condition changes, not just the label

Today `OnboardingGate` shows the welcome screen based on `singles` being empty
(`OnboardingGate.tsx:32-46`) — a `parent_admin` with a household but no singles yet sees
onboarding. After this story, onboarding is about **persona provisioning**, which a
`parent_admin` membership already proves happened. Re-showing "which personas apply to
you" to someone who is demonstrably already a `parent` would be confusing and would risk
them double-clicking `add_persona('parent')` from a stale screen (harmless — 2.2 AC-6
made it idempotent — but still wrong UX). `my_personas()` returning zero rows is the
correct, precise condition: it is true only for a user who has never provisioned
anything, which is exactly "new user, first login" (AC-1).

### The `seedDemo()` dependency this story surfaces (flag for the epic owner)

`supabase/functions/seed_demo/index.ts:282-285` resolves the caller's existing account
via `resolveAccountId` (`_shared/resolveDemoAccount.ts:13-23`) and has never needed to
create one — in the pre-2.7 world the only self-served user was the bootstrapped first
one, who already had an account. Story 2.7 removes that bootstrap. AC-7's fix (call
`add_persona('parent')` client-side before `seedDemo()`) keeps the demo path working
without touching the edge function, but it is a workaround, not a redesign: if a caller
reaches "Explore with demo data" through a path that skips this screen (there is none
today, but flag it for whoever adds one later), `seed_demo` still returns
`409 "No active account for user"` for a personaless caller. Not a gap this story closes
inside the edge function, since epics.md assigns this story no edge-function scope —
flagged so it is not silently forgotten.

Two adjacent facts, both verified, that make AC-7 actually work and are worth not
re-deriving later:
- `resolveAccountId` reads `account_members` through the **admin** client with
  `order("id").limit(1)`, i.e. its own first-active-membership resolver, entirely
  independent of the `current_account_id()` SQL function 2.1 deletes. Epic 2's resolver
  swap therefore does not break `seed_demo`, and this story must not "helpfully" migrate
  it (that is out of scope and would be a second provisioning path — NFR-14).
- `seed_demo`'s *writes* go through `userScopedClient` (`resolveDemoAccount.ts:29-44`),
  which relies on RLS, so the freshly created household must be the caller's **active**
  context. 2.1 AC-5's `activate_first_context()` trigger guarantees that on the very
  insert `add_persona('parent')` performs — which is why this story adds no client-side
  context switch. If 2.1 has not landed, AC-7 will appear to succeed and seed nothing.

### AD-18 debt this story steps around, deliberately (flag for the epic owner)

Verified counts as of 2026-07-28:
- `crm.auth.onboarding.*` keys referenced in `src/`: **16**. Present in
  `englishCrmMessages.ts`: **0**. Present in `frenchCrmMessages.ts`: **0**. The entire
  group runs on `translate(key, { _: "default" })` inline defaults.
- `login/OnboardingChoice.tsx` — the file Task 5 extends — renders **9** user-facing
  strings as literal JSX and does not import `useTranslate` at all.

AD-18 ("no hardcoded UI strings") is therefore already violated in the exact files this
story touches. Closing that is a bounded but real chunk of work with its own review
surface, and epics.md gives Story 2.3 no i18n-remediation scope. AC-10 consequently binds
only the strings this story *adds*. Recorded here rather than left as an implicit
"someone will notice."

Related, smaller: AD-18 specifies **English + Hebrew** catalogues; the repo has English +
French (the fork's), wired in `providers/commons/i18nProvider.ts` with
`getInitialLocale(): "en" | "fr"`. No Epic 2 story adds Hebrew. AC-10 targets the two
catalogues that exist.

### Verified current state (re-checked against `main` @ `8ad49cb`, 2026-07-28)

| Claim | Verified value |
|---|---|
| `root/OnboardingGate.tsx` | 53 lines; `useGetList<Single>("singles", …)` 32-38; `hasSingles`/`showOnboarding` 45-46; pending→`children` 41-43 |
| `login/OnboardingChoice.tsx` | 186 lines; `type Mode` 19; `handleExploreDemo` 56-75; `seedDemo()` 62; error `notify` 66-74; `useQueryClient` 48 |
| `login/FirstRunSetup.tsx` | **340** lines (was quoted as 338); `useGetList<Account>` 48-54; `accounts?.[0]` 55; `if (!account) return;` 71; `disabled … \|\| !account` 188; done-copy branch 311-320 |
| `root/useAccountDemo.ts` | 17 lines; `ACCOUNT_DEMO_QUERY_KEY` 9 — the exact shape Task 2 mirrors |
| `providers/supabase/dataProvider.ts` | 688 lines; `currentAccountDemo` **451-460** (was quoted as 587-596); `CrmDataProvider = ReturnType<…>` 500-502 |
| `providers/fakerest/dataProvider.ts` | 811 lines; `currentAccountDemo` **723** (was quoted as 898 — past the end of the file); `dataProviderWithCustomMethod: CrmDataProvider` 363; `db` param 117 |
| fakerest collection keys | `accounts` / `account_members` / `singles` — `dataGenerator/types.ts:26-28`, assigned `dataGenerator/shidduchim.ts:384-386` |
| `src/components/atomic-crm/types.ts` | 592 lines; `MemberRole` 84-85 (no `"single"`); `Account` 91-97; `AccountMember` 99-106; `Single` 108-120 |
| `my_personas` / `add_persona` / `useMyPersonas` / `PersonaChecklist` in the tree | **0** hits across `src/ supabase/ workers/` — all four are new here or in 2.2 |
| `handle_new_user()` first-user bootstrap | still present, `supabase/schemas/02_functions.sql:57-70` |
| `07_storage.sql` `storage.objects` policies | **3**, lines 25-44, all calling `public.current_account_id()` — 2.1's to migrate, untouched here |
| Onboarding route registration | none — `OnboardingGate` is inline via `layout/Layout.tsx:25` and `layout/MobileLayout.tsx:23`; `root/routeManifest.ts` is 282 lines and gains nothing |

### Project Structure Notes

Everything in this story lives under `src/components/atomic-crm/{login,root,providers}/`
— no new top-level directory, no `routeManifest.ts` entry (AC-12), no `supabase/` change
(AC-13). `MyPersona` / `Persona` go in the existing `src/components/atomic-crm/types.ts`
(592 lines: over the 400-line "typical" guidance in `.claude/rules/coding-style.md` but
well under its 800-line hard ceiling, and it is the single canonical type module for the
domain — splitting it is a separate, repo-wide decision, not this story's).

### Testing standards

Component-level tests (Vitest + Testing Library) in the `app` project, matching the
project's existing `*.test.tsx` convention — `landing/LandingGate.test.tsx` and
`tasks/TasksListFilter.test.tsx` are both good shapes to copy. Do **not** copy
`login/GoogleSignInButton.test.tsx`: it is the only other test in `login/`, and Story 2.6
deletes it along with `GoogleSignInButton.tsx` (`2-6-…md:150-156`). `.claude/rules/testing.md`'s
AAA structure applies. This story adds no SQL, so no `supabase/tests/*.sql` file is added
— but `make test` runs the `db` project anyway (it self-skips without a live local stack),
so 2.2's suite must still be green.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3 (lines 363-378)] — the
  five-bullet AC this story implements (single→household+singles row, parent→household+
  prompt, shadchan→shadchanus, both→one household).
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md, lines 9-18] —
  the persona table AC-2's checkbox copy derives from, and "Onboarding asks … as a
  **multi-select**."
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — AC-2 (`single` role), AC-6 (`add_persona()`'s three branches + idempotency), AC-7
  (parent-then-single yields one household), AC-8 (`my_personas()`'s return shape and
  predicates).
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md#AC-5]
  — `activate_first_context()`, the trigger AC-7 depends on.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md#AC-7]
  — removal of `handle_new_user()`'s bootstrap branch, which AC-5 and AC-7 both hinge on.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10]
  — "the frontend reaches data **only** through the `dataProvider` … Every new
  resource/method is mirrored in the **FakeRest** provider" (AC-8).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-18]
  — all UI strings via the `i18nProvider`, no hardcoded text (AC-10).
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md] — file-size guidance
  and AAA test structure.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-code, bmad-dev-story workflow)

### Debug Log References

- Verified the story's "Verified current state" table line-for-line before
  writing anything: `OnboardingGate.tsx` (53 lines, `useGetList<Single>` at
  32-38), `OnboardingChoice.tsx` (186 lines, `handleExploreDemo` 56-75),
  `FirstRunSetup.tsx` (340 lines, `useGetList<Account>` 48-54),
  `useAccountDemo.ts` (17 lines), `dataProvider.ts` (688 lines,
  `currentAccountDemo` 451-460), `fakerest/dataProvider.ts` (811 lines,
  `currentAccountDemo` 723) all matched exactly. `grep -rn "my_personas\|add_persona"
  src/ supabase/ workers/` returned 0 hits in `src/`/`workers/` (2.2's SQL
  side already had them, confirmed separately) — 2.2 is fully landed on
  `main`, confirming the hard dependency is satisfied.
- **Story claim did not reproduce (AC-13's own table)**: the story's
  "Verified current state" table claims `07_storage.sql`'s 3 policies "all
  calling `public.current_account_id()`" — false on the actual tree at
  dispatch time. Story 2.1 (`8da4f01`/`cd253d5`) had already migrated all 3
  to `current_context_id()` (`grep -c current_context_id
  supabase/schemas/07_storage.sql` → 3; `current_account_id` → 0 hits
  anywhere under `supabase/schemas/`). No action needed here (AC-13 forbids
  touching `07_storage.sql` regardless), but the story's own snapshot was
  stale by the time of dispatch — flagging so nobody re-derives a false
  "still needs migrating" conclusion from this file.
- **Fakerest gap the story doesn't name**: `dataGenerator/shidduchim.ts`
  seeds `db.account_members = []` (empty) for the demo dataset — the
  default fakerest login (member id `0`, "Jane Doe") had zero
  `account_members` rows. Under the OLD `useGetList("singles")` gate this
  was masked (the two seeded `singles` rows are read unfiltered, with no
  account scoping in fakerest yet — 2.4 hasn't landed). Under the NEW
  `my_personas()`-based gate, an empty `account_members` collection made
  `getMyPersonas()` return `[]` for the default demo login, which would
  have shown the persona multi-select on every `make start-demo` boot
  instead of the seeded board — a real regression AC-1's own test
  couldn't catch (it doesn't touch the demo generator). Fixed by seeding
  one `account_members` row (`user_id: "0"`, `role: "parent_admin"`,
  `account_id: ACCOUNT_ID`) alongside the existing "Klein Family" account.
  Documented inline at the seed site.
- **Design deviation from the literal Task 5 wording, with reasoning**:
  Task 5's bullet 4 says to invalidate the shared `useMyPersonas` query key
  "after the last addPersona() resolves." Implemented literally, this
  invalidates the SAME query key `OnboardingGate` is actively subscribed to
  (by design, per Task 2/AC-9 — one shared cache entry). Since
  `OnboardingGate` is mounted throughout the whole "own family" flow, an
  immediate invalidation the moment `addPersona('parent')` succeeds would
  flip `OnboardingGate`'s `showOnboarding` to `false` (personas is no
  longer empty) and unmount `OnboardingChoice` — including `FirstRunSetup`
  — before the user ever sees the "name your family" / "add a single"
  steps AC-5 requires, or before the AC-4/AC-6 done screens are shown.
  Confirmed by tracing `queryClient.invalidateQueries()`'s documented
  behaviour (its returned promise resolves only once matching ACTIVE
  queries have refetched) — awaiting it before routing would make
  `OnboardingGate` re-render with fresh data before this screen's own
  `onHousehold`/`onDone` callbacks ever fire. Implemented instead: routing
  is decided from a one-off `dataProvider.getMyPersonas()` call (bypassing
  the shared query cache entirely), and the shared query key is invalidated
  only at the natural end of each branch — `FirstRunSetup`'s new
  `onFinished` prop (called from its "Go to my dashboard" button) and
  `PersonaOnboardingDone`'s equivalent button. This still satisfies the
  underlying goal ("`OnboardingGate` re-evaluates against fresh data rather
  than the pre-provisioning empty list") without cutting the wizard short.
  Flagging this explicitly since it deviates from the task's literal
  ordering; no AC is weakened by it — AC-3's ordering assertion (recorded
  `addPersona` call sequence) is unaffected, since it does not depend on
  when the query invalidation happens.
- `make typecheck`, `make lint` (eslint + prettier), and `make test`
  (all 5 vitest projects, `db` included, run against a live local Supabase
  stack) all green on the first attempt after implementation: 638 tests
  total (14 new, 624 pre-existing, zero regressions). `node
  scripts/check-retired-names.mjs` clean.
- `git diff --name-only -- supabase/` confirmed empty (AC-13); `root/routeManifest.ts`
  and `root/CRM.tsx` confirmed absent from the changed-file list (AC-12).

### Completion Notes List

- All 14 ACs implemented. `providers/supabase/dataProvider.ts` gained
  `getMyPersonas()` (fail-loud, throws rather than falling back to `[]`)
  and `addPersona(persona)` (RPCs `my_personas`/`add_persona`), placed
  right after `currentAccountDemo()` per AC-8. `providers/fakerest/
  dataProvider.ts` mirrors both via a new `internal/personas.ts` module
  (kept out of the already-811-line `dataProvider.ts`, per
  `.claude/rules/coding-style.md`'s file-size guidance and the existing
  `internal/shidduchCatch.ts` etc. precedent) — a real derivation/mutation
  over the in-memory `account_members`/`singles` tables copying 2.2's exact
  predicates (`is_owning_membership_role`, the single-detection join), not
  a stub (AD-10). `Persona` / `MyPersona` types added to `types.ts`;
  `MemberRole` widened with `"single"` (AC-11); `Account` gained an
  optional `kind?: "household" | "shadchanus"` field (not explicitly asked
  by the story, but required for the fakerest mirror to report
  `account_kind` correctly — defaults to `"household"` when absent, so no
  existing seed data needed updating).
- `root/useMyPersonas.ts` added, mirroring `useAccountDemo.ts` exactly
  (`MY_PERSONAS_QUERY_KEY`, a bare `useQuery` wrapper) — the one shared
  cache entry `OnboardingGate` and the onboarding screen both read (AC-9).
- `root/OnboardingGate.tsx`: `useGetList<Single>("singles", …)` replaced
  with `useMyPersonas()`; condition is now `personas.length === 0 &&
  isDemo !== true` (AC-1). Doc comment rewritten to describe the persona
  condition instead of the retired singles-count one, keeping the
  "no seen/dismissed flag" rationale paragraph (still true, still load-bearing).
- `login/PersonaChecklist.tsx` (new): a standalone controlled
  three-checkbox group (`Checkbox` + `Label`, following
  `AgeAffirmation.tsx`'s exact styling precedent), taking `value`/`onChange`
  only — no wizard logic, no "at least one" validation baked in, so Story
  2.5 can import it unchanged for its Settings persona editor (AC-2, Task 4).
- `login/OnboardingChoice.tsx` reworked: `Mode` widened to `"choice" |
  "own-select" | "own-household" | "own-done"`. New `PersonaSelectCard`
  (the `own-select` step) renders `PersonaChecklist` + inline "pick at
  least one" validation + a Continue handler that awaits `addPersona()`
  sequentially in `["parent", "single", "shadchan"]` order, filtered to
  what's ticked (never `Promise.all` — 2.2 AC-7) (AC-2, AC-3). On success:
  if `parent` was ticked, a fresh `getMyPersonas()` read supplies the new
  household's `account_id` and hands off to `FirstRunSetup`; otherwise a
  new `PersonaOnboardingDone` screen renders directly, reusing
  `done_title`/`done_body`/`go_to_dashboard` verbatim for the single-only
  case (no third copy variant, per AC-4) and one new key
  (`persona_done_shadchan_body`) when `shadchan` was ticked (AC-4, AC-6).
  `handleExploreDemo` now awaits `addPersona("parent")` before `seedDemo()`,
  inside the same `try`, with an inline comment naming AC-7.
- `login/FirstRunSetup.tsx` reworked per AC-5: `useGetList<Account>` and
  the `accounts?.[0]` derivation deleted; the household id now arrives as a
  required `accountId` prop. The "account" step's loading-spinner branch is
  gone (no fetch to wait on) and its submit button's `|| !account` guard is
  gone. The "add a single" step is untouched (it never referenced `account`
  — `singles.account_id` is stamped server-side by `set_account_id_default()`
  off the caller's active context, not sent from the client). Also gained a
  required `onFinished` callback, called from the done step's "Go to my
  dashboard" button — see the Debug Log entry on why the shared
  `useMyPersonas` invalidation is deferred to here instead of happening
  right after `addPersona()` resolves.
- Copy: `crm.auth.onboarding.persona_*` added to both
  `englishCrmMessages.ts` and `frenchCrmMessages.ts` under a new
  `onboarding: {}` object nested in the existing `crm.auth` group (AC-10).
  The pre-existing 16 `crm.auth.onboarding.*` keys already in use
  (account_title, done_body, etc.) were deliberately left as
  inline-defaults-only, per the story's own explicit scope note.
- Tests added: `login/PersonaChecklist.test.tsx` (5 tests — rendering,
  checked/unchecked state, add/remove on toggle, no built-in "at least one"
  enforcement), `login/OnboardingChoice.test.tsx` (5 tests — AC-2's
  validation block, AC-3's exact `["addPersona:parent", "addPersona:single"]`
  call sequence with FirstRunSetup then rendering, AC-4's single-only done
  screen with the "add a single" / "name your family" steps asserted
  absent, AC-6's shadchan-only done screen naming the shadchanus context,
  AC-7's `addPersona` → `seedDemo` ordering), `root/OnboardingGate.test.tsx`
  (4 tests — pending renders children, zero personas + not demo shows
  onboarding, any persona shows the app, zero personas + demo mode shows
  the app). All 14 new tests pass in the `app` vitest project (real
  Chromium via Playwright); full `make test` (638 tests, 5 projects) green.
- AC-12 verified: `git diff --name-only` for this story touches neither
  `root/routeManifest.ts` nor `root/CRM.tsx`; `routeManifest.test.ts` still
  green (part of the full `make test` run). AC-13 verified: `git diff
  --name-only -- supabase/` is empty.

### File List

- `src/components/atomic-crm/types.ts` — added `Persona`, `MyPersona`
  types; widened `MemberRole` with `"single"` (AC-11); added optional
  `Account.kind` field (needed for the fakerest `MyPersona.account_kind`
  mirror, AC-8).
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — added
  `getMyPersonas()` / `addPersona(persona)` RPC wrappers next to
  `currentAccountDemo()` (AC-8).
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — wired
  `getMyPersonas` / `addPersona` to the new `internal/personas.ts` module,
  next to `currentAccountDemo` (AC-8, AD-10).
- `src/components/atomic-crm/providers/fakerest/internal/personas.ts`
  (new) — fakerest mirrors of `my_personas()` / `add_persona()`, copying
  2.2's exact predicates over the in-memory `account_members`/`singles`
  tables.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts`
  — seeded one `account_members` row for the default demo login so
  `getMyPersonas()` reports the `parent` persona instead of regressing the
  `make start-demo` experience; `accounts` seed row gained `kind:
  "household"`.
- `src/components/atomic-crm/root/useMyPersonas.ts` (new) — the shared
  `useMyPersonas()` hook / `MY_PERSONAS_QUERY_KEY`, mirroring
  `useAccountDemo.ts` (AC-9).
- `src/components/atomic-crm/root/OnboardingGate.tsx` — gate condition
  switched from `useGetList<Single>("singles", …)` to `useMyPersonas()`
  (AC-1); doc comment rewritten.
- `src/components/atomic-crm/root/OnboardingGate.test.tsx` (new).
- `src/components/atomic-crm/root/onboardingKeys.ts` — one stale doc-comment
  word fixed ("no singles yet" → "no persona provisioned yet").
- `src/components/atomic-crm/login/PersonaChecklist.tsx` (new) — the
  standalone three-checkbox persona multi-select (AC-2, Task 4).
- `src/components/atomic-crm/login/PersonaChecklist.test.tsx` (new).
- `src/components/atomic-crm/login/OnboardingChoice.tsx` — added
  `PersonaSelectCard` (own-select step) and `PersonaOnboardingDone` (the
  non-parent done screen); `handleExploreDemo` now provisions `parent`
  before seeding (AC-2, AC-3, AC-4, AC-6, AC-7).
- `src/components/atomic-crm/login/OnboardingChoice.test.tsx` (new).
- `src/components/atomic-crm/login/FirstRunSetup.tsx` — takes `accountId`
  (required prop, replacing `useGetList<Account>`) and a new `onFinished`
  callback (AC-5).
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` —
  new `crm.auth.onboarding` key group (AC-10).
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` —
  same, in French (AC-10).
