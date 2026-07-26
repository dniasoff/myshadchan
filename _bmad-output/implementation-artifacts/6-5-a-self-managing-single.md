# Story 6.5: A self-managing single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an independent, widowed or divorced single,
I want to run my own shidduchim without a parent account,
so that the app fits my actual situation instead of forcing a fictional
parent role onto me.

## Position in Epic 6

**5th and last to build.** This story introduces no new row/field scoping —
`self_manager` has been a valid `account_members_role_check` value since
before this epic (verified in the current schema: `parent_admin`, `helper`,
`self_manager`, `shadchan`; Story 2.2 adds `single`, making five), and every
policy Stories 6.2–6.4 wrote scopes its restrictions to
`current_member_role() = 'single'` or `<> 'single'`, never to "not
`parent_admin`." This story is a **parity guard**: it proves that stays true,
closes the one onboarding-copy gap the epic's own AC calls out, and confirms
the provisioning path Epic 2 built produces a correctly-linked record. It is
ordered last because there is nothing to test parity against until 6.2–6.4
exist.

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
   transaction.** The provisioning logic is Story 2.2's `add_persona('single')`
   (invoked by Story 2.3's onboarding screen), whose own spec already pins
   `role = 'self_manager'` and the linked `singles` row — this story adds
   the test for that atomicity and role, it builds nothing.

3. **A self-manager has full, unfiltered access to their own household's
   pipeline, references and shadchanim** — explicitly: none of Story 6.2's
   row-narrowing (`shidduchim`/`resumes`/`shidduch_schools`/`singles`) or
   wholesale denies (`tasks`, `invites`, `date_records`, `redts`,
   `identity_signals`, `inbox_items`, `subscription`, `ai_usage`,
   `account_members` roster) applies to `self_manager`; none of Story 6.3's
   candid-content denies (`reference_links`, `"references"`, `interactions`,
   `entity_files`, `shidduchim_external_links`, `medical_notes`, the
   `documents`/`entity-files` storage buckets) applies either; and
   `shidduchim_summary.close_reason` reads its real value.

4. **Nothing in the UI addresses a self-manager as a parent addressing a
   child.** Any onboarding, roster, or empty-state copy that reads "add your
   singles" / "your children" in a parent-oriented flow is either absent or
   correctly branches for a self-manager (e.g. "add another single to your
   household" only if they also hold the parent persona; nothing implying
   they are managing someone else when they are managing themselves).

5. **Negative test, required by `.claude/rules/security-triggers.md` because
   this story touches role-based access even though it changes no policy
   text:** a `self_manager` reading each surface in AC-3 gets the **same**
   (unrestricted) result a `parent_admin` in an otherwise-identical fixture
   gets — run side by side in one suite, so a future edit that accidentally
   widens any Epic 6 `single` check to also catch `self_manager` fails
   immediately.

## Tasks / Subtasks

- [ ] **Task 1 — Verify the provisioning path as landed** (AC: 2)
  - [ ] `grep -n "add_persona" supabase/schemas/02_functions.sql` and read
        the `single` branch. Expected per 2.2's spec: no existing linked
        `singles` row and no owning membership → create a household with
        `role = 'self_manager'`, then the `singles` row with `member_id` set,
        in the same function call. If the landed code deviates (e.g. defaults
        the creator to `parent_admin`), that is a drift from 2.2's own AC —
        fix the line in Epic 2's function with a comment citing this story;
        do not add a second provisioning path here.

- [ ] **Task 2 — The parity test suite** (AC: 1, 2, 3, 5)
  - [ ] New `supabase/tests/self_manager_parity.sql` + `.test.ts`. Arrange
        household S by calling `add_persona('single')` as a fresh user (this
        doubles as AC-2's provisioning assertion), then seed it with the same
        data shape `single_row_scoping.sql`/`single_field_scoping.sql` used:
        a `new` suggestion, a `look_into`+`shared` suggestion (with
        `close_reason` set, a shadchan, a reference link, an interaction
        note, an entity file, an external link), one row each in `tasks`,
        `invites`, `date_records`, `redts`, `identity_signals`,
        `inbox_items`, `subscription`, `ai_usage`, `medical_notes`, and one
        `storage.objects` row per private bucket. Arrange household P
        identically under a `parent_admin`.
  - [ ] Assert (AC-2): household S holds exactly one `account_members` row
        (`role = 'self_manager'`, `status = 'active'`) and exactly one
        `singles` row, linked by `member_id` — and no second `singles` row
        (distinguishing this path from parent onboarding, which prompts for
        singles as a separate step).
  - [ ] Assert (AC-1/3/5): for every table named in AC-3 plus `shidduchim`,
        `resumes`, `shidduch_schools`, `singles`, `accounts`, the
        self-manager's `select count(*)` equals the parent_admin's on the
        identical fixture — full counts, never the narrowed or zero count a
        `single`-role caller gets. Include `shidduchim_summary.close_reason`
        (real value, not `NULL`) and `storage.objects` in the two private
        buckets (non-zero).
  - [ ] Assert (write parity): the self-manager can `update` their own
        `accounts` row and insert an `interactions` note — the two spots
        where 6.2/6.4 added write-side guards.

- [ ] **Task 3 — Copy audit** (AC: 4)
  - [ ] `grep -rniE "\bchild\b|\bchildren\b|your child" src/components/atomic-crm/root/ src/components/atomic-crm/login/ src/components/atomic-crm/settings/` —
        post-1.3 this should return nothing; a hit is a 1.3 regression to fix
        at its source, not to patch here with a self-manager-specific
        exception.
  - [ ] Audit the onboarding and roster copy Stories 2.3/2.5 introduced:
        every string shown when the `single` persona is ticked **without**
        `parent` must never imply a second person is being managed (no "who
        are you redting for," no "add your children"). Where one component
        serves both a self-manager and a parent, branch the copy on which
        personas were ticked rather than writing a single string that only
        reads correctly for one of them.
  - [ ] Any new/changed strings go through the `i18nProvider` (AD-18 — no
        hardcoded UI text), with keys added to both
        `providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts` (the French catalog's values are runtime
        data, permitted by `.claude/rules/english-only.md`).

- [ ] **Task 4 — No schema migration expected**
  - [ ] This story changes no policy and no table. If Task 1 uncovers a
        genuine drift in `add_persona()`, that fix lands as a small,
        separately-justified migration — but the expected outcome is **no
        migration at all**, because Stories 6.2–6.4 were written
        role-symmetric. Do not manufacture a migration to have something to
        ship; nothing-needed is the correct, honest outcome here.

- [ ] **Task 5 — Run and verify**
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`
        only if Task 1 produced a migration; otherwise skip straight to tests.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`
        (needs `make start`). Re-run `single_row_scoping.sql`,
        `single_field_scoping.sql` and `single_input.sql` from Stories
        6.2–6.4 unmodified alongside this story's new suite, in the same
        run, so a regression in either direction (self-manager
        over-restricted, or single under-restricted) is caught by the
        combined suite.

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
busy. (The one allow-list in the single's blast radius that *does* name
roles, `medical_notes`' `parent_admin`/`self_manager` list from Story 5.5,
already includes `self_manager` — Task 2's read assertion covers it.)

### Why "self-seeker is not a separate account type" matters here

`personas-and-contexts.md` is explicit: *"a widow managing both herself and
her children is **one** household containing a `singles` row for herself and
rows for each child. 'Self-seeker' is not a separate account type."* A
self-manager is not a fourth kind of thing alongside household/shadchanus —
they are a `parent_admin`-equivalent role inside an ordinary household that
happens to also contain their own `singles` row. Story 6.2's predicates
already generalize: `'self_manager'` never matches an `= 'single'` check, so
full account access follows without any self-manager-specific code — which
is exactly what Task 2 confirms rather than assumes.

### What this story does not decide

- **Whether a self-manager can later add the `parent` persona and start
  managing additional singles** — Story 2.5 ("personas change over a
  lifetime") territory.
- **Whether a self-manager who also becomes a `helper` for someone else's
  household needs different treatment** — no Epic 6 AC describes it; out of
  scope.

### Testing standard

Same shape as Stories 6.2–6.4 — plain SQL `results`-table suites,
multi-identity via `set local request.jwt.claims`. This suite is explicitly
**comparative** (self-manager fixture vs. an equivalent `parent_admin`
fixture, asserted side by side in one file) so future regressions surface as
a diff in one place rather than requiring two suites' outputs to be compared
by hand.

### Project Structure Notes

- No schema files touched unless Task 1 surfaces a genuine `add_persona()`
  drift (see Task 4).
- `supabase/tests/self_manager_parity.sql`, `.test.ts` — new.
- i18n: `providers/commons/englishCrmMessages.ts`, `frenchCrmMessages.ts` —
  copy-audit additions only, no new keys unless Task 3 finds a real gap.

### References

- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 1 ("one self-managing single... both a member and a `singles` row
  in their own household") and the "self-seeker is not a separate account
  type" framing.
- [Source: _bmad-output/implementation-artifacts/2-2-persona-and-context-data-model.md]
  — `add_persona('single')`: the provisioning logic this story tests
  (household + `role = 'self_manager'` + linked `singles` row).
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3] — the
  onboarding multi-select that invokes it.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.5] — literal AC
  text, including "nothing in the UI calls me a child" (AC-4/Task 3 here).
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary; `self_manager`
  pre-dates this epic in `account_members_role_check`.
- Stories 6.2 (`single_row_scoping.sql`), 6.3 (`single_field_scoping.sql`)
  and 6.4 (`single_input.sql`) — this story's fixtures mirror theirs, so a
  reviewer can diff the suites' expected counts directly.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
