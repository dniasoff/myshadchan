# Story 6.5: A self-managing single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an independent, widowed or divorced single,
I want to run my own shidduchim without a parent account,
so that the app fits my actual situation instead of forcing a fictional
parent role onto me.

## Position in Epic 6

**5th and last to build.** This story does not introduce new row/field
scoping — the `self_manager` role already exists in
`account_members_role_check` today (verified: it is one of the four current
values, alongside `parent_admin`, `helper`, `shadchan`) and every policy
Stories 6.2–6.4 wrote scopes its restrictions to `current_member_role() =
'single'` specifically, never to "not `parent_admin`." This story is a
**parity guard**: it proves that stays true, closes the one onboarding-copy
gap the epic's own AC calls out, and confirms the provisioning path Epic 2
Story 2.3 owns produces a correctly-linked record. It is ordered last because
it is meaningless to test parity against restrictions that do not exist yet.

## Acceptance Criteria

1. **A `self_manager`-role `account_members` row has exactly the same row and
   field access as a `parent_admin`'s, on every table Stories 6.2 and 6.3
   touched.** No predicate written in this epic references `self_manager`
   directly — the guarantee comes entirely from those predicates being
   written as `current_member_role() = 'single'` (an allow-list of one) or
   `current_member_role() <> 'single'` (a deny-list of one), never as a
   `parent_admin`-only allow-list that would have silently excluded
   `self_manager` too.

2. **Ticking "single" at onboarding (Epic 2 Story 2.3) provisions one
   household in which the same login is both the `account_members` row
   (`role = 'self_manager'`) and the `singles` row it manages, linked by
   `member_id`, created in the same transaction as the household itself** —
   this story adds the negative/positive test for that atomicity; the
   provisioning logic itself is Epic 2 Story 2.3's to build (see Dev Notes).

3. **A self-manager has full, unfiltered access to their own household's
   pipeline, references and shadchanim** — explicitly, none of Story 6.3's
   deny-lists (`reference_links`, `"references"`, `interactions`,
   `date_records`, `redts`, `identity_signals`, `inbox_items`) apply to
   `self_manager`, and none of Story 6.2's row-narrowing (own-`singles`-row-only
   on `shidduchim`/`resumes`/`shidduch_schools`/`singles` itself) applies
   either.

4. **Nothing in the UI addresses a self-manager as a parent addressing a
   child.** Any onboarding, roster, or empty-state copy that reads "add your
   singles" / "your children" in a parent-oriented flow is either absent or
   correctly branches for a self-manager (e.g. "add another single to your
   household" only if they also hold the parent persona; nothing implying
   they are managing someone else when they are managing themselves).

5. **Negative test, required by `.claude/rules/security-triggers.md` because
   this story touches role-based access even though it changes no policy
   text:** a `self_manager` reading each table in Stories 6.2/6.3's deny/narrow
   lists gets the **same** (unrestricted) result a `parent_admin` in an
   otherwise-identical fixture gets — run side by side in one test so a
   future edit to any Epic 6 policy that accidentally widens its `single`
   check to also catch `self_manager` fails this suite immediately.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm Epic 2 Story 2.3's provisioning path exists and its
      shape** (AC: 2)
  - [ ] `grep -rniE "self_manager|provision" supabase/schemas/02_functions.sql`
        and `LSP workspaceSymbol` for whatever onboarding function Epic 2
        Story 2.3 built (its own AC: "ticking 'single' creates a household
        with a single record pointing at me"). Read it before writing any
        test — this story does **not** re-implement provisioning; it only
        tests that the two writes (the `account_members` row and the
        `singles` row's `member_id`) happened atomically and with the right
        role.
  - [ ] If Epic 2 Story 2.3's function does *not* set `role = 'self_manager'`
        for this specific path (e.g. it defaults every new household creator
        to `parent_admin`, which would be wrong for someone who ticked only
        "single," per `personas-and-contexts.md`'s explicit "Self-seeker is
        not a separate account type" but distinct-role framing), that is a
        gap in Epic 2's landed scope, not Epic 6's to silently patch around —
        flag it and fix the one line in Epic 2's function with a comment
        citing this story, rather than adding a second provisioning path here.

- [ ] **Task 2 — The parity test suite** (AC: 1, 3, 5)
  - [ ] New `supabase/tests/self_manager_parity.sql` + `.test.ts`. Arrange:
        one household provisioned via the self-managing path (one login,
        `role = 'self_manager'`, one `singles` row with `member_id` set to
        that login's `account_members.id`), seeded with the same shape of
        data `single_row_scoping.sql`/`single_field_scoping.sql` used for
        their `parent_admin` fixtures — a `new` suggestion, a `look_into`+
        `shared` suggestion with a shadchan and a reference link and an
        interaction note attached, one `private_parent`-visibility
        suggestion, one row each in `date_records`/`redts`/`identity_signals`
        /`inbox_items`/`subscription`/`ai_usage`.
  - [ ] For each of the eleven tables Stories 6.2/6.3 touched
        (`shidduchim`, `resumes`, `shidduch_schools`, `singles`, `accounts`,
        `account_members`, `date_records`, `redts`, `identity_signals`,
        `inbox_items`, `subscription`, `ai_usage`, `reference_links`,
        `"references"`, `interactions`, `shadchanim`), assert: as the
        self-manager, `select count(*)` returns the **full** unrestricted
        count (every row in the fixture for that table), not the narrowed or
        zero count a `single`-role caller would get on the identical fixture.
  - [ ] Assert: as the self-manager, `shidduchim_summary.close_reason` and
        `shadchanim.notes` return their real values, not `NULL`.
  - [ ] Assert (AC-2): the household-creation transaction produced exactly
        one `account_members` row and one `singles` row, linked, and no
        second `singles` row was created for anyone else (distinguishing
        this path from the parent-onboarding path, which per Epic 2 Story
        2.3's own AC prompts the user to add singles as a *separate* step).

- [ ] **Task 3 — Copy audit** (AC: 4)
  - [ ] `grep -rniE "\bchild\b|\bchildren\b|your child" src/components/atomic-crm/root/ src/components/atomic-crm/login/ src/components/atomic-crm/settings/` —
        by this story's position (post story 1.3), this should already return
        nothing; if it does return something, that is a story 1.3 regression
        to fix at its source, not to patch here with a self-manager-specific
        exception.
  - [ ] Audit specifically the onboarding and roster copy that Epic 2 Story
        2.3 introduces for the multi-select flow: every string shown when
        the `single` persona is ticked **without** `parent` must never imply
        a second person is being managed (no "who are you redting for,"
        no "add your children"). Where the same component serves both a
        self-manager and a parent (e.g. a shared "who's in your household"
        step), branch the copy on which personas were ticked rather than
        writing a single string that only reads correctly for one of them.
  - [ ] i18n: add/adjust keys through the existing `i18nProvider`
        (`.claude/rules/coding-style.md`/AD-18 — no hardcoded UI strings), in
        both `providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts`, English keys with French values per
        `.claude/rules/english-only.md`.

- [ ] **Task 4 — No schema migration expected**
  - [ ] This story changes no policy and no table. If Task 1 uncovers a
        genuine one-line gap in Epic 2's provisioning function (the
        `self_manager` role default), that fix lands as a small,
        separately-justified migration (`db diff -f self_manager_role_default`
        or similar) — but the expected outcome of this story is that no
        migration is needed at all, because Stories 6.2–6.4 were already
        written role-symmetric. Do not manufacture a migration to have
        something to ship; an empty "Tasks" checkbox here that stays
        unchecked because nothing was needed is the correct, honest outcome.

- [ ] **Task 5 — Run and verify**
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`
        only if Task 1/4 produced a migration; otherwise skip straight to
        tests.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`
        (needs `make start`). Re-run `single_row_scoping.sql`,
        `single_field_scoping.sql` and `single_input.sql` from Stories
        6.2–6.4 unmodified alongside this story's new suite, in the same CI
        run, so a regression in either direction (self-manager over-restricted,
        or single under-restricted) is caught by the combined suite.

## Dev Notes

### Why this story is "prove it," not "build it"

Every policy this epic writes (Stories 6.2, 6.3, 6.4) is phrased as either
`current_member_role() = 'single'` (a positive check naming exactly one
role) or `current_member_role() <> 'single'` (a negative check excluding
exactly one role). Neither form can accidentally catch `self_manager` — the
only way `self_manager` could end up restricted is a future edit that
rewrites one of those predicates as, say, `current_member_role() <>
'parent_admin'` (a deny-list phrased around the wrong role) or
`current_member_role() in ('parent_admin')` (an allow-list that forgets
`self_manager` exists). This story's parity suite exists specifically to
fail loudly if that ever happens, now or later — it is a regression fence,
not new functionality. This is why Task 4 explicitly allows "no migration
needed" as the expected, correct outcome: a story whose job is to prove an
existing invariant should not invent work to look busy.

### Why "self-seeker is not a separate account type" matters here

`personas-and-contexts.md` is explicit: *"a widow managing both herself and
her children is **one** household containing a `singles` row for herself and
rows for each child. 'Self-seeker' is not a separate account type."* This
means a self-manager is not a fourth kind of thing alongside
household/shadchanus — they are a `parent_admin`-equivalent role inside an
ordinary household that happens to also contain their own `singles` row.
Story 6.2's row-scoping predicates already generalize correctly to this:
`current_member_role() = 'self_manager'` never matches the `= 'single'`
checks, so full account access follows without any self-manager-specific
code — which is exactly what Task 2's parity suite is confirming, not
assuming.

### What this story does not decide

- **Whether a self-manager can later add the `parent` persona and start
  managing additional singles** — Epic 2 Story 2.5 ("personas change over a
  lifetime") territory, not this story's.
- **Whether a self-manager who also becomes a `helper` for someone else's
  household needs different treatment** — not a scenario any Epic 6 AC
  describes; out of scope.

### Testing standard

Same shape as Stories 6.2–6.4 — plain SQL `results`-table suites,
multi-identity via `set local request.jwt.claims`. This story's suite is
explicitly **comparative** (self-manager fixture vs. an equivalent
parent_admin fixture, same shape, asserted side by side) rather than
standalone, which is a deliberate structural choice to make future
regressions visible as a diff in the same test file rather than requiring
someone to remember to compare two separate suites' outputs by hand.

### Project Structure Notes

- No schema files touched unless Task 1 surfaces a genuine Epic 2 gap (see
  Task 4).
- `supabase/tests/self_manager_parity.sql`, `.test.ts` — new.
- i18n: `providers/commons/englishCrmMessages.ts`,
  `providers/commons/frenchCrmMessages.ts` — copy audit additions only, no
  new keys unless Task 3 finds a real gap in Epic 2's onboarding copy.

### References

- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 1 ("one self-managing single... both a member and a `singles` row
  in their own household") and the explicit "self-seeker is not a separate
  account type" framing.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3] — "ticking
  'single' creates a household with a single record pointing at me" — the
  provisioning path this story tests but does not build.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.5] — literal AC
  text, including "nothing in the UI calls me a child" (AC-4/Task 3 here).
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary; `self_manager` is
  already one of the four values in `account_members_role_check` in the
  schema as it stands today (verified: `check (role in ('parent_admin',
  'helper', 'self_manager', 'shadchan'))`, pre-dating this epic).
- Stories 6.2 (`single_row_scoping.sql`) and 6.3 (`single_field_scoping.sql`)
  — this story's fixtures mirror theirs exactly, substituting
  `self_manager` for the manually-inserted `single` role, so a reviewer can
  diff the two suites' expected-row-counts directly.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
