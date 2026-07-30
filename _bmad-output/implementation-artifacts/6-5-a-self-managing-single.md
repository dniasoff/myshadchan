# Story 6.5: A self-managing single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an independent, widowed or divorced single,
I want to run my own shidduchim without a parent account,
so that the app fits my actual situation instead of forcing a fictional
parent role onto me.

## Position in Epic 6

**6th and last to build.** This story introduces no new row/field scoping.
`self_manager` has been a valid `account_members_role_check` value since
Epic 2 — the five roles at HEAD are `parent_admin`, `single`, `helper`,
`self_manager`, `shadchan` (`01_tables.sql:210-212`), which is exactly
`MemberRole` in `types.ts:132-133` — and every policy Stories 6.2–6.4 write
scopes its restriction to `current_member_role() = 'single'` or
`<> 'single'`, never to "not `parent_admin`."

This story is a **parity guard**: it proves that stays true, closes the
onboarding/empty-state copy gap the epic's own AC calls out, and confirms the
provisioning path Epic 2 built produces a correctly-linked record. It is
ordered last because there is nothing to test parity against until 6.2–6.4
exist.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

**The shipped role/context model this story checks itself against** (verified
for this refresh, so the story is not measuring an earlier design):

- Five roles, one authority ladder: `role_authority()`
  (`02_functions.sql:1093`) scores `parent_admin` 3, `self_manager` 2,
  `helper`/`single`/`shadchan` 1, mirrored in TypeScript by
  `providers/commons/roleAuthority.ts`'s `ROLE_AUTHORITY`.
- `is_owning_membership_role()` (`:522`) is `parent_admin` **or**
  `self_manager` — the predicate every "owns a household" decision uses,
  including `can_moderate_note()`'s owning-role branch, which carries an
  explicit comment forbidding a literal `= 'parent_admin'` for exactly this
  reason.
- `self_manager` is deliberately **not** in `invites_role_check`
  (`01_tables.sql:258-260`): it is a role a person *arrives at* via
  `add_persona('single')`, never one another person is invited into.
- Context switching is real and shipped: `my_contexts()`
  (`02_functions.sql:379`, SECURITY INVOKER), `set_active_context()`
  (`:287`), `member_state` as the server-held pointer, and
  `layout/ContextSwitcher.tsx` in the UI. A self-manager who is also a helper
  elsewhere holds two rows in `my_contexts()` and one active context at a
  time; `useViewerRole()` returns the **active** context's role, with no
  `?? contexts[0]` fallback.
- R7 holds for this story too: `"references"` has no nav entry and no browse
  surface (`browsable: false` on its descriptor, `NO_BROWSE_SURFACE_ENTITIES`
  in `ad24Conformance.ts`), and `/references` is the unattached index. AC-3's
  "full access to references" therefore means *full data access through the
  shidduch's Diligence tab and the unattached index* — it is not a licence to
  add a references nav item for self-managers.

## Acceptance Criteria

1. **A `self_manager`-role `account_members` row has exactly the same row,
   field and storage access as a `parent_admin`'s, on every surface Stories
   6.2 and 6.3 touched.** No predicate written in this epic references
   `self_manager` directly — the guarantee comes entirely from those
   predicates being written as `= 'single'` (an allow-list of one) or
   `<> 'single'` (a deny-list of one), never as a `parent_admin`-only
   allow-list that would have silently excluded `self_manager` too.

2. **Ticking "single" at onboarding provisions one household in which the
   same login is both the `account_members` row (`role = 'self_manager'`)
   and the `singles` row it manages, linked by `member_id`, in one
   transaction.** The provisioning logic is `public.add_persona('single')`
   (`02_functions.sql:643`), invoked from `login/PersonaChecklist.tsx` via
   Story 2.3's onboarding screen. Verified at HEAD: with no existing owning
   membership it inserts the `accounts` row, then the `account_members` row
   with `role = 'self_manager'` `returning id`, then the `singles` row with
   `member_id` set — all inside one SECURITY DEFINER function body. This
   story adds the test for that atomicity and role; it builds nothing.

3. **A self-manager has full, unfiltered access to their own household's
   pipeline, references and shadchanim** — explicitly: none of Story 6.2's
   row-narrowing (`shidduchim`/`resumes`/`shidduch_schools`/`singles`) or
   wholesale denies (`tasks`, `invites`, `date_records`, `redts`,
   `identity_signals`, `inbox_items`, `subscription`, `ai_usage`,
   `account_members` roster) applies to `self_manager`; none of Story 6.3's
   candid-content denies (`reference_links`, `"references"`, `interactions`,
   `entity_files`, `shidduchim_external_links`, `medical_notes`, the
   `entity-files` bucket and the `documents`/`resumes/` prefix) applies
   either; `shidduchim_summary.close_reason` reads its real value; and every
   tab restricted by 6.2 AC-10 / 6.3 AC-9 renders for a `self_manager`
   viewer (their `visibleTo` allow-lists all name `self_manager`).

4. **Nothing in the UI addresses a self-manager as a parent managing someone
   else.** The onboarding checkbox copy is already correct at HEAD
   (`crm.auth.onboarding.persona_single` = "I'm looking for a shidduch for
   myself"), so the gap is downstream: the Singles list empty state reads
   *"A shidduchim pipeline belongs to a single — the person you are redting
   for. Add a single to start tracking suggestions."*
   (`crm.singles.list.emptyDescription`), which is false for someone whose
   pipeline is their own. Every string shown when the `single` persona is
   held **without** `parent` must not imply a second person is being managed;
   where one component serves both, branch the copy on the personas held
   rather than writing one string that only reads correctly for one of them.

5. **Negative/parity test, required by `.claude/rules/security-triggers.md`
   because this story concerns role-based access even though it changes no
   policy text:** a `self_manager` reading each surface in AC-3 gets the
   **same** (unrestricted) result a `parent_admin` in an
   otherwise-identical fixture gets — run side by side in one suite, so a
   future edit that accidentally widens any Epic 6 `single` check to also
   catch `self_manager` fails immediately.

## Tasks / Subtasks

- [ ] **Task 1 — Verify the provisioning path as landed** (AC: 2)
  - [ ] Read `add_persona()`'s `single` branch (`02_functions.sql:722-766`).
        Verified for this refresh and expected unchanged: the no-op guard
        (`singles` row already pointing at one of the caller's own active
        memberships, with `s.status = 'active'` load-bearing for the
        archive/re-add round trip); attachment to an existing **owning**
        membership when the caller has one (never a helper's household); and
        otherwise a fresh household with `role = 'self_manager'`. If the
        landed code has drifted (e.g. defaults the creator to
        `parent_admin`), fix that line in Epic 2's function with a comment
        citing this story — do not add a second provisioning path here.
  - [ ] Note the consequence for AC-2's "no second `singles` row" assertion:
        when the caller **already** holds an owning membership, this branch
        attaches a `singles` row to that existing household rather than
        creating a new one. The assertion is therefore about the fresh-user
        path specifically; arrange it with a user who holds no membership at
        all.

- [ ] **Task 2 — The parity test suite** (AC: 1, 2, 3, 5)
  - [ ] New `supabase/tests/self_manager_parity.sql` + `.test.ts`, reusing
        Story 6.2's shared fixture helper from
        `supabase/tests/dbSuiteHelpers.ts` so household P and household S are
        seeded by the same code and cannot drift.
  - [ ] Arrange household S by calling `add_persona('single')` as a fresh
        authenticated user (this doubles as AC-2's provisioning assertion),
        then seed it with the same data shape
        `single_row_scoping.sql`/`single_field_scoping.sql` use: a `new`
        suggestion, a `look_into`+`shared` suggestion (with `close_reason`
        set, a shadchan, a reference link, an interaction note, an entity
        file, an external link), one row each in `tasks`, `invites`,
        `date_records`, `redts`, `identity_signals`, `inbox_items`,
        `subscription`, `ai_usage`, `medical_notes`, and `storage.objects`
        rows under `entity-files`, `documents/resumes/`,
        `documents/photos/shared/` and `documents/photos/private_parent/`.
        Arrange household P identically under a `parent_admin`.
  - [ ] Assert (AC-2): household S holds exactly one `account_members` row
        (`role = 'self_manager'`, `status = 'active'`) and exactly one
        `singles` row, linked by `member_id`, and no second `singles` row.
  - [ ] Assert (AC-1/3/5): for every table named in AC-3 plus `shidduchim`,
        `resumes`, `shidduch_schools`, `singles`, `accounts` and
        `resume_photos`, the self-manager's `select count(*)` equals the
        `parent_admin`'s on the identical fixture — full counts, never the
        narrowed or zero count a `single`-role caller gets. Include
        `shidduchim_summary.close_reason` (real value, not `NULL`), the four
        `security_invoker` summary views a single is denied
        (`references_summary`, `reference_links_summary`,
        `interactions_summary`, `entity_files_summary`), and all four
        `storage.objects` keys (all visible).
  - [ ] Assert (write parity): the self-manager can `update` their own
        `accounts` row, insert an `interactions` note, moderate a note they
        authored (`can_moderate_note()`'s owning-role branch), and is refused
        an `update` on a `single_input` row exactly as a `parent_admin` is
        (Story 6.4 AC-3 denies it to every role — parity here means *equally
        denied*, which is the assertion most likely to be written backwards).
  - [ ] Assert (invite authority): `create_invite('x@y.z', 'helper')`
        succeeds for the self-manager (`is_invite_capable_role()` includes
        `self_manager`, `role_authority('helper') = 1 ≤ 2`) and
        `create_invite('x@y.z', 'parent_admin')` raises. This is the one
        place `self_manager`'s authority is genuinely *different* from
        `parent_admin`'s, and asserting it stops a future "parity" edit from
        flattening the ladder.

- [ ] **Task 3 — Copy audit** (AC: 4)
  - [ ] **Do not** run a bare `grep -rniE "\bchild\b|\bchildren\b"` and treat
        every hit as a 1.3 regression. At HEAD that grep returns
        `crm.auth.onboarding.persona_parent` — *"I'm looking for a shidduch
        for my children"* — which is **correct** copy for the parent persona
        and is deliberately exempted: `scripts/retired-names.json`'s
        `1.3-children-contextual` rule uses a contextual regex
        (`child_|_child|child-|public\.children|…`) precisely because the
        bare word also matches React's `children` prop and legitimate domain
        prose. Run the repo's own guard instead, and treat *its* output as
        the regression signal.
  - [ ] The real audit is narrower and role-shaped: for each surface a
        self-manager reaches, check whether the copy presumes a second
        person. Known hit at HEAD, to fix in this story:
        `crm.singles.list.emptyDescription` — *"A shidduchim pipeline belongs
        to a single — the person you are redting for."* Branch it (or reword
        it) so a self-manager is not told their own pipeline belongs to
        someone they are redting for. Re-check in the same pass:
        `crm.singles.list.emptyTitle` ("Add your first single"), the "Add a
        single" action label, `settings/PersonasSection.tsx`,
        `login/OnboardingChoice.tsx`, `login/FirstRunSetup.tsx`,
        `root/OnboardingGate.tsx` and the Singles nav item label
        (`layout/navItems.ts`).
  - [ ] Where one component serves both a self-manager and a parent, branch
        on the personas held (`my_personas()` / the existing personas query)
        rather than on `useViewerRole()` alone — a self-manager who *also*
        holds the parent persona legitimately manages other singles and
        should see the parent-shaped copy.
  - [ ] Any new or changed string goes through the `i18nProvider` (AD-18 — no
        hardcoded UI text), with keys in **both**
        `providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts` (the French catalogue's values are runtime
        data, permitted by `.claude/rules/english-only.md`).
  - [ ] Update the affected component tests
        (`singles/SingleList.test.tsx`, `settings/PersonasSection.test.tsx`,
        `login/OnboardingChoice.test.tsx`,
        `login/PersonaChecklist.test.tsx`) — several of them assert the
        current strings verbatim and will go red.

- [ ] **Task 4 — No schema migration expected**
  - [ ] This story changes no policy and no table. If Task 1 uncovers a
        genuine drift in `add_persona()`, that fix lands as a small,
        separately-justified migration — but the expected outcome is **no
        migration at all**, because Stories 6.2–6.4 were written
        role-symmetric. Do not manufacture a migration to have something to
        ship; nothing-needed is the correct, honest outcome here.

- [ ] **Task 5 — Run and verify**
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`
        and `make check-migration-safety` only if Task 1 produced a
        migration; otherwise skip straight to tests.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`
        (the DB suites need `make start`). Re-run `single_row_scoping.sql`,
        `single_field_scoping.sql` and `single_input.sql` from Stories
        6.2–6.4 **unmodified** alongside this story's new suite, in the same
        run, so a regression in either direction (self-manager
        over-restricted, or single under-restricted) is caught by the
        combined suite.
  - [ ] Run the repo's retired-name guard (the checker that consumes
        `scripts/retired-names.json`) and the AD-24 conformance suite; both
        must be green after the copy changes.

## Dev Notes

### Why this story is "prove it," not "build it"

Every policy this epic writes is phrased as either
`current_member_role() = 'single'` or `current_member_role() <> 'single'`.
Neither form can accidentally catch `self_manager` — the only way it could
end up restricted is a future edit that rewrites one of those predicates as,
say, `<> 'parent_admin'` (a deny-list phrased around the wrong role) or
`in ('parent_admin')` (an allow-list that forgets `self_manager` exists).
This story's parity suite exists specifically to fail loudly if that ever
happens — a regression fence, not new functionality. That is why Task 4
explicitly allows "no migration needed" as the expected outcome: a story
whose job is to prove an existing invariant should not invent work to look
busy.

The two allow-lists in the single's blast radius that *do* name roles both
already include `self_manager`: `medical_notes`' policy
(`parent_admin`/`self_manager`, `05_policies.sql:267`) and the `visibleTo`
arrays Stories 6.2/6.3 add. Task 2's read assertions cover both.

### Why "self-seeker is not a separate account type" matters here

`personas-and-contexts.md` is explicit: *"a widow managing both herself and
her children is **one** household containing a `singles` row for herself and
rows for each child. 'Self-seeker' is not a separate account type."* A
self-manager is not a fourth kind of thing alongside household/shadchanus —
they are a `parent_admin`-equivalent role inside an ordinary household that
happens to also contain their own `singles` row. Story 6.2's predicates
already generalize: `'self_manager'` never matches an `= 'single'` check, so
full account access follows without any self-manager-specific code — which is
exactly what Task 2 confirms rather than assumes.

That framing is also why AC-4 is a *copy* problem and not a *role* problem.
There is no self-manager mode to build; there are sentences written on the
assumption that the reader is redting for someone else.

### `self_manager` is not `parent_admin` — one difference, deliberately kept

`role_authority()` puts `self_manager` at 2 and `parent_admin` at 3, so a
self-manager may invite a `helper` or a `single` into their own household but
never a `parent_admin`. Task 2 asserts that difference explicitly. "Parity"
in this story means parity of **data access**, not of invite authority — a
test that flattened the ladder in the name of parity would be a real
regression wearing this story's badge.

### What this story does not decide

- **Whether a self-manager can later add the `parent` persona and start
  managing additional singles** — `add_persona('parent')` already promotes an
  existing `self_manager` membership in place (`02_functions.sql:684-697`);
  the lifecycle around it is Story 2.5's territory, not this story's.
- **Whether a self-manager who also becomes a `helper` for someone else's
  household needs different treatment** — no Epic 6 AC describes it; the
  context switcher already handles two memberships, and `useViewerRole()`
  already returns the active one. Out of scope.
- **Whether `"references"` should gain a nav entry for anyone** — R7 says no,
  for every role. AC-3's "full access to references" is about data, not
  navigation.

### Testing standard

Same shape as Stories 6.2–6.4 — plain SQL `results`-table suites via
`npm run test:unit:db`, multi-identity via `set local request.jwt.claims`,
harness in `supabase/tests/dbSuiteHelpers.ts`. This suite is explicitly
**comparative** (a self-manager fixture vs. an equivalent `parent_admin`
fixture, asserted side by side in one file) so future regressions surface as
a diff in one place rather than requiring two suites' outputs to be compared
by hand. Frontend tests are `vitest-browser-react` in real Chromium with
`TestMemoryRouter`. AAA per `.claude/rules/testing.md`.

### Project Structure Notes — the true file set

Schema / DB:
- No schema files touched unless Task 1 surfaces a genuine `add_persona()`
  drift (see Task 4).
- `supabase/tests/self_manager_parity.sql`, `.test.ts` — new
- `supabase/tests/dbSuiteHelpers.ts` — shared fixture, extended if needed
- Regression-only, must not be edited: `single_row_scoping.sql`,
  `single_field_scoping.sql`, `single_input.sql`, `context_resolution.sql`,
  `medical_notes.sql`, `resume_photos.sql`

Frontend (AC-4):
- `src/components/atomic-crm/singles/SingleList.tsx` + `SingleList.test.tsx`
- `src/components/atomic-crm/settings/PersonasSection.tsx` + `.test.tsx`
- `src/components/atomic-crm/login/OnboardingChoice.tsx` + `.test.tsx`
- `src/components/atomic-crm/login/PersonaChecklist.tsx` + `.test.tsx`
- `src/components/atomic-crm/login/FirstRunSetup.tsx`
- `src/components/atomic-crm/root/OnboardingGate.tsx` + `.test.tsx`
- `src/components/atomic-crm/layout/navItems.ts` + `navItems.test.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`,
  `frenchCrmMessages.ts`
- `registry.json` (regenerated by the pre-commit hook; commit what it
  produces)
- `scripts/retired-names.json` — only if a new legitimate exemption is
  genuinely needed; prefer rewording the string.

E2E:
- `e2e/navigation.spec.ts`, `e2e/fixtures.ts` — only if a copy assertion
  there goes red.

### References

- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 1 ("one self-managing single... both a member and a `singles` row
  in their own household") and the "self-seeker is not a separate account
  type" framing.
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — `add_persona('single')`: the provisioning logic this story tests
  (household + `role = 'self_manager'` + linked `singles` row).
- [Source: _bmad-output/implementation-artifacts/2-3-onboarding-persona-multi-select.md]
  — the onboarding multi-select (`login/PersonaChecklist.tsx`) that invokes it.
- [Source: _bmad-output/implementation-artifacts/2-4-context-switcher.md] —
  `my_contexts()` / `set_active_context()` / `layout/ContextSwitcher.tsx`,
  the context model AC-1's "active context" wording depends on.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.5] — literal AC
  text, including "nothing in the UI calls me a child" (AC-4/Task 3 here).
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary; `self_manager`
  pre-dates this epic in `account_members_role_check`.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2] — rule 7:
  `visibleTo?: MemberRole[]` is an allow-list; the arrays 6.2/6.3 add all
  name `self_manager`, which AC-3 asserts.
- Stories 6.2 (`single_row_scoping.sql`), 6.3 (`single_field_scoping.sql`)
  and 6.4 (`single_input.sql`) — this story's fixtures mirror theirs, so a
  reviewer can diff the suites' expected counts directly.
- Current code, verified for this refresh:
  `supabase/schemas/01_tables.sql:210-212` (five roles), `:258-260`
  (`invites_role_check`, no `self_manager`);
  `supabase/schemas/02_functions.sql:287` (`set_active_context`), `:379`
  (`my_contexts`), `:522` (`is_owning_membership_role`), `:608`
  (`can_moderate_note`), `:643`/`:722-766` (`add_persona`, `single` branch),
  `:1093` (`role_authority`), `:1117` (`is_invite_capable_role`);
  `src/components/atomic-crm/types.ts:132-133` (`MemberRole`);
  `src/components/atomic-crm/providers/commons/roleAuthority.ts`;
  `src/components/atomic-crm/login/PersonaChecklist.tsx:24-38`;
  `src/components/atomic-crm/singles/SingleList.tsx:86-95`;
  `scripts/retired-names.json` (`1.3-children-contextual`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
