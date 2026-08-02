---
baseline_commit: 3c1f25c
---

# Story 9.2: Publish a single's listing

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the manager of a single,
I want to publish a narrow profile,
so that shadchanim can consider them.

## Position in Epic 9

**2nd of 5** (`9.1 → 9.2 (this story) → 9.3 → 9.4 → 9.5`, this pass's own ordering — see
`9-1-publish-shadchan-listing.md` §"Position in Epic 9" for why).

**Hard dependency: 9.1, landed first.** This story adds **only**:
- the `Single listings insert` and `Single listings update` RLS policies (the `listing_type =
  'single'` branch — 9.1 deliberately left these unwritten; see 9.1 Dev Notes "Policy ownership
  map"), and
- the frontend publish flow for a single's listing.

It does **not** create the `listings` table (9.1 already did, with every `single_*` column this
story needs), does not touch the `anon` grant or the two select policies (already correct and
type-agnostic), and does not implement withdrawal or the dignity-floor lock (9.3's).

**Depends on:**
- **9.1** — the `listings` table (including `listings_single_id_fkey`), its shared select
  policies, its grants.
- **Epic 2** — Story 2.2 for the `'single'` role (today's `account_members_role_check` already
  holds `'parent_admin'` and `'self_manager'`); Story 2.1 for `current_context_id()`.
- **Epic 6** for the `self_manager` shape (a single who is their own manager) actually existing
  in a household by the time this story's authorization logic runs.
- *(Reference, not a build dependency:)* Epic 5 Story 5.2's Overview field list is the superset
  Dev Notes "Field set decision" deliberately narrows — nothing from 5.2 needs to have landed.

**Who may publish — precisely, because FR103 is easy to under-specify:**

> "FR103 — Only the manager of a single may publish that single's listing — the parent, or the
> single themselves if self-managing."
> [Source: amendment-a2.md#A2.5]

"Manager" resolves to exactly two `account_members.role` values against the target single's own
household: `parent_admin` (may publish for **any** single in their household) and
`self_manager` (may publish **only for the single record that is themselves** — a self-manager's
`singles` row has `member_id` pointing at their own `account_members.id`, per D11/Epic 6). A
plain `single` role (a single with a login whose parent still manages them) **cannot publish** —
they can only ever withdraw (FR104, Story 9.3). A `helper` cannot publish either. This asymmetry
is deliberate and is the reason 9.2 and 9.3 write different DELETE-vs-INSERT authorization.

## Acceptance Criteria

1. **Field-by-field opt-in, nothing published by default.** Given a single I manage, when I open
   "Publish a listing" for them, I see one independent toggle per offered field (Dev Notes
   "Field set decision" has the exact list), each defaulting **off**. An unchecked field is
   never written — the column stays `null`.

2. **At least a first name is required to publish.** Given neither `first_name_en` nor
   `first_name_he` is opted in, publishing is refused server-side (the CHECK constraint 9.1
   already wrote — `listings_single_name_required` — enforces this; this story does not
   duplicate the constraint, only the UI-level guard).

3. **Only the manager may publish.** Given I am a `helper`, or a plain `single` (not
   self-managing) in the household, when I attempt to insert a `listing_type = 'single'` row for
   any single in that household, RLS refuses it. Given I am a `self_manager`, when I attempt to
   publish a listing for a **different** single in my household (e.g. a sibling), RLS refuses it
   — a self-manager may publish only their own.

4. **The working record is never offered, let alone published.** Given the publish form, the
   pipeline state, shidduch history, private/parent notes, reference call content, diligence
   progress, dating history and medical notes are **not present as options** — not merely
   unchecked. This is a UI/form-shape assertion (nothing in the form's field list references
   those entities) backed by the fact that `listings` physically has no column that could hold
   them (AD-21).

5. **The family as such is never listed.** There is no household-level "publish us" action and
   no `listings` row exists whose subject is a household rather than a single or a shadchan —
   `listings_single_id_presence` (9.1's CHECK) already makes a subject-less row impossible; this
   story's UI never attempts to create one.

6. **Publishing is idempotent per single — one live listing, not a growing pile.** Given a
   single already has a published listing, when their manager changes a field and publishes
   again, the existing row is updated in place (`listings_single_id_key`, 9.1's partial unique
   index, makes a duplicate impossible at the database).

7. **Anonymously readable the moment it exists.** Given a published single's listing, an
   unauthenticated `anon`-role `select` on `public.listings` returns the opted-in fields and
   only the opted-in fields (verify with a raw query exactly as 9.1 AC-4 does, since 9.4's search
   UI does not exist yet).

8. **Negative test — cross-account.** Given single S belongs to household A, when a
   `parent_admin` of household B attempts to publish, update or read-as-owner a listing for S,
   RLS refuses all three — and the refusal must come from RLS itself, not surface as a
   foreign-key error (Dev Notes explains why this test is kept even though 9.1's composite FK
   also blocks the write at the schema).

## Tasks / Subtasks

- [x] **Task 1 — RLS: the `single` branch of insert/update** (AC: 1, 2, 3, 6, 8)
  - [x] `"Single listings insert"` on `public.listings`, `for insert to authenticated with check
        (listing_type = 'single' and account_id = public.current_context_id() and single_id in
        (select s.id from public.singles s where s.account_id = public.current_context_id())
        and exists (select 1 from public.accounts a where a.id = public.current_context_id() and
        a.kind = 'household') and (
          exists (select 1 from public.account_members am where am.account_id =
            public.current_context_id() and am.user_id = auth.uid() and am.role = 'parent_admin')
          or exists (
            select 1 from public.account_members am
              join public.singles s on s.member_id = am.id
            where am.account_id = public.current_context_id() and am.user_id = auth.uid()
              and am.role = 'self_manager' and s.id = listings.single_id
          )
        ))`.
  - [x] `"Single listings update"` — same predicate, `for update ... using (account_id =
        public.current_context_id() and listing_type = 'single') with check (<same as insert>)`.
  - [x] **Do not add a lock/consent predicate here.** That column does not exist until 9.3 —
        9.3 will `drop policy "Single listings insert"` and recreate it with the extra check.
        Say so in your PR description so the reviewer does not mistake the omission for a miss.
  - [x] **Do not touch** `"Listings readable by anon"`, `"Listings readable by owner"`, or any
        `Shadchan listings *` policy — all four already cover both branches or are 9.1's alone.

- [x] **Task 2 — Generate and hand-check the migration** (AC: all)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_single_listing_policies`
  - [x] Confirm the diff contains **only** the two new `create policy` statements — if it also
        touches the table definition or 9.1's policies, something drifted; stop and reconcile
        against 9.1 rather than accepting an unexpected diff.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`,
        never `db push`.

- [x] **Task 3 — Types** (AC: 1, 2, 4)
  - [x] `src/components/atomic-crm/types.ts`: extend the `Listing` type (added by 9.1) with a
        `PublishableSingleListingFields` type restricted to exactly the field set in Dev Notes
        "Field set decision" — this is the type the publish form binds to, and its narrowness is
        itself part of AC-4 (a field that isn't in the type can't be offered by the form).

- [x] **Task 4 — Provider** (AC: 1, 6)
  - [x] `providers/supabase/dataProvider.ts`: no bespoke RPC (same reasoning as 9.1 Task 6) —
        plain `dataProvider.create` / `dataProvider.update` on the `listings` resource.
  - [x] `providers/fakerest/`: extend the `listings` base resource (created empty by 9.1) so
        FakeRest demo singles can carry a seeded listing; mirror the existing
        `dataGenerator/shidduchim.ts` seeding pattern.

- [x] **Task 5 — Components** (AC: 1, 2, 3, 4, 5)
  - [x] `listings/PublishSingleListingSection.tsx` — the field-by-field form from AC-1, offering
        exactly the fields in Dev Notes "Field set decision" and no others. Reuse the same
        create-vs-update decision logic pattern as 9.1's `PublishShadchanListingSection.tsx`
        (extract a shared `useListingUpsert(accountId, listingType, subjectId)` hook from 9.1's
        component now, rather than copy-pasting the upsert branch — this is exactly the kind of
        duplication `.claude/rules/coding-style.md` (DRY) flags).
  - [x] Where it is reached from: **not** a tab on the Single 360 — Epic 5 Story 5.8's tab list
        (Overview, Resume, Photo, Files, Shidduchim, Notes, Tasks, Activity) does not include a
        "Listing" tab, and this story does not amend Epic 5's story. Reach it from Settings
        instead — a new `settings/SingleListingSection.tsx` listing each single in the household
        with a "Publish" / "Manage listing" action per row, next to the existing
        `settings/FamilySection.tsx`. Flag to the epic owner that a future UX pass may want this
        promoted onto the Single 360 once Epic 3's entity-descriptor `actions` field (Story 3.3)
        exists — not blocking for this story.
  - [x] The publish form offers **no photo control of any kind** — not a disabled toggle, not a
        "coming soon" placeholder. A listing never carries a photo (Dev Notes "Field set
        decision", last row); a photo control here would imply otherwise and invite a future
        "just wire it up" regression.
  - [x] **Both i18n catalogues** — every field label, helper text and error message this form
        adds gets a key in `providers/commons/englishCrmMessages.ts` **and**
        `providers/commons/frenchCrmMessages.ts` in the same diff (C7 — see Project Structure
        Notes).

- [x] **Task 6 — Tests** (AC: all)
  - [x] Extend `supabase/tests/listings.sql` (created by 9.1) with the `single`-branch checks:
        AC-2 (name-required CHECK), AC-3 (both negative sub-cases: helper/single role refused,
        self-manager publishing for a sibling refused), AC-6 (partial unique index prevents a
        duplicate), AC-7 (anon read), AC-8 (cross-account, both the read-as-owner and the
        write attempt). Do not create a second `.sql` file — one suite per table, as
        `references_entity.sql` demonstrates for a table with many behaviors.
  - [x] Frontend: a test for `PublishSingleListingSection.tsx` asserting the offered field list
        matches Dev Notes exactly (a regression here is exactly AC-4's failure mode) and a test
        for the extracted `useListingUpsert` hook's create-vs-update branch.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        `npx prettier --check` on this story's changed files only.

## Dev Notes

### Field set decision — deliberately narrow, not an oversight

Epic 5 Story 5.2's Overview tab fields are: *"name (both scripts), age/DOB, height, background,
location, shul, current and earlier yeshiva, father, mother, marital status and children."*
[Source: epics.md#Story-5.2]. This story does **not** offer all of them. PRV-1 names *"family
details"* as one of the product's highest-sensitivity categories alongside photos and health
notes [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#PRV-1], and PRV-13's "narrow" requirement plus the general "least-exposure
by default" posture argue against defaulting the *offer list* as wide as the private Overview
tab. The field set this story ships is:

| Offered | Not offered (this story) | Why not |
|---|---|---|
| `first_name_en` / `first_name_he` | `last_name_*` | A last name plus location/community is a stronger identifying combination than shidduch listings conventionally expose; omit for now. |
| `age` (an integer, entered or computed once at publish time) | raw `dob` | Publishing an exact birthdate is a strictly worse privacy trade than publishing an age; AD-21/PRV-1's caution argues for the narrower one. |
| `height` | `shul`, `yeshiva` (current/earlier) | Reasonable future additions, deliberately deferred rather than guessed at — flag to the epic owner rather than invent scope. |
| `community` | `father`, `mother` | PRV-1 names "family details" as highest-sensitivity; a third party's name is not the publisher's alone to expose the same way their own is. |
| `location` | `marital status`, `children` | These describe the single's own history and are arguably reasonable, but are also exactly the kind of field a later story should add deliberately (with its own review), not one folded in here by default. |
| `summary` (free text, optional) | — | Lets a manager say what the fixed fields cannot, without it becoming a second unstructured channel for the excluded fields above. |
| — | photo | Never part of a listing at all — not gated, not deferred: PRV-1 ranks photos highest-sensitivity, and AD-9 permits photo bytes only through the `share/` Worker's logged, revocable, expiring proxy, none of which an anonymous public listing has. Photos travel only through 9.5's share links. See 9.1 Dev Notes "No photo on a listing". |

This is a **story-level scope decision**, stated and justified rather than left open, per the
"no unresolved decisions" standard. It is not a permanent ceiling — a later story can widen the
offered set, and should do so explicitly rather than by a developer independently deciding a
field "obviously" belongs.

### Why "self-manager may only publish their own" needs its own EXISTS clause

A naive `role in ('parent_admin', 'self_manager')` check would let a self-manager publish a
listing for *any* single in the household, which is wrong: a self-manager's authority is scoped
to being their own manager, not to the household generally (unlike `parent_admin`, who manages
everyone). The second `exists` clause in Task 1 closes this by joining `singles.member_id` back
to the caller's own `account_members.id` — without it, AC-3's second negative case ("self-manager
publishing for a sibling") would pass RLS incorrectly.

### Why the cross-account negative test (AC-8) still matters despite the composite FK

9.1 gave `listings.single_id` the domain's composite FK (`(account_id, single_id) →
singles(account_id, id)`), so a cross-account `single_id` now also fails at the schema. AC-8 is
kept for the layer above it: it proves the RLS `with check` — specifically its `single_id in
(select s.id from public.singles s where s.account_id = public.current_context_id())`
sub-select — refuses the write **on its own**. That sub-select is the piece a future policy edit
could silently drop while every same-account write still succeeds, and tenant refusal must come
from RLS, not surface as a constraint-error side effect.

### Security / RLS

`.claude/rules/security-triggers.md` mandates a security review and negative tests for this
diff (new RLS policies, role-based authorization). AC-3 and AC-8 are the required negative
tests; both must run under `npm run test:unit:db`, not merely be asserted in a component test.

### Migration workflow

Same as 9.1: `supabase/schemas/*.sql` is the source of truth; every `npx supabase` call is
prefixed `DBUS_SESSION_BUS_ADDRESS=/dev/null`; never `db reset`/`db push` from a story
[Source: AGENTS.md#Database-Management, memory/supabase-cli-dbus-hang.md].

### Testing standards

`supabase/tests/listings.sql` is outside `make test` — only `npm run test:unit:db` runs it
[Source: vitest.config.ts `db` project; makefile `test-unit` target]. AAA structure, ≥80%
coverage on new paths [Source: .claude/rules/testing.md].

### Project Structure Notes

- No new schema file; two new policies appended to `05_policies.sql`'s existing `listings`
  section (created by 9.1).
- `listings/PublishSingleListingSection.tsx` alongside 9.1's components in
  `src/components/atomic-crm/listings/`. Extract shared upsert logic into
  `listings/useListingUpsert.ts` rather than duplicating it — flag this refactor as part of this
  story's own diff even though the duplicated code originates in 9.1, since DRY is a coding-style
  requirement, not an optional cleanup [Source: .claude/rules/coding-style.md].
- **`registry.json`** — new files land under `atomic-crm/listings/`; regenerate with
  `make registry-gen` (or the pre-commit hook) and declare the file as touched, same reasoning
  as 9.1.
- **Both i18n catalogues** (`providers/commons/englishCrmMessages.ts`,
  `providers/commons/frenchCrmMessages.ts`) — this story's field-by-field toggle labels (Dev
  Notes "Field set decision"), the "must consent again"-adjacent copy is 9.3's, but this story's
  own publish-form and error copy needs a key in both catalogues in the same diff (C7 — a
  missing French twin is a `make typecheck` failure since `frenchCrmMessages.ts` is `satisfies
  CrmMessages`). Renders inside Settings (inside `<Admin>`), so the ordinary `useTranslate()`
  seam applies.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.2-Publish-a-singles-listing]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.2-Shidduch-Overview-tab] — the field superset this story deliberately narrows
- [Source: amendment-a2.md#A2.5] — FR102, FR103, PRV-13
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#PRV-1] — highest-sensitivity data categories (photos, candid words, health, family details)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-21] — listings snapshot rule
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md] — `self_manager`, D11 shape
- [Source: 9-1-publish-shadchan-listing.md#Dev-Notes] — the shared `listings` table shape (including `listings_single_id_fkey` and "No photo on a listing") and policy ownership map
- [Source: .claude/rules/security-triggers.md] — negative-test requirement
- [Source: .claude/rules/coding-style.md] — DRY / file-size conventions
- [Source: AGENTS.md#Database-Management] — migration workflow

## Change Log

- 2026-08-03 — Implemented Story 9.2 end to end: the `single` branch's two RLS policies (Task 1), `PublishableSingleListingFields` type, the extracted shared `useListingUpsert` hook (with `useShadchanListing.ts` refactored onto it, DRY), the seven-field publish form (`PublishSingleListingSection.tsx`) and its Settings wiring (`SingleListingSection.tsx`), FakeRest parity (one seeded demo single listing), i18n in both catalogues, and the database + component test suites. Status → review.

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), dispatched as the `developer`/bmad-dev-story agent on `STACK_ID=1`, `STACK_OWNER=9-2`.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_single_listing_policies` — generated `supabase/migrations/20260802231822_add_single_listing_policies.sql`; hand-checked and confirmed it contains **only** the two new `create policy` statements (Task 2's own requirement) — no table-definition or 9.1-policy drift.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` run twice after `migration up --local` — both reported "No schema changes found" (clean, convergent).
- Ran `supabase/tests/listings.sql` directly via `psql` before wrapping it in the vitest runner, to iterate on the 9.2 arrange block in isolation: 51 checks total (36 pre-existing 9.1 checks + 15 new 9.2 checks), all green, including the AC-8 cross-account INSERT proving the RLS `with check`'s `single_id in (...)` sub-select raises 42501 (row-level security) BEFORE the composite FK's 23503 ever has a chance to fire — empirically confirming the ordering Dev Notes "Why the cross-account negative test still matters" assumes (Postgres evaluates `ExecWithCheckOptions` before an AFTER-ROW FK trigger can run).
- `npm run test:unit:db` — 33 files / 1226 tests, all pass (`listings.test.ts` alone: 52 tests — the 51 SQL checks plus the file's own "runs every 9.1/9.2 check group" floor assertion, bumped from 25 to 45).
- `make test STACK_ID=1` (a fresh, isolated Supabase stack, `STACK_OWNER=9-2`) — 260 files / 3120 tests, all pass against that stack's own database, independent confirmation the migration and RLS are correct on a from-scratch instance, not just the long-lived dev stack. Stack released afterward (`make stop-supabase-e2e STACK_ID=1`).
- `make check-migration-safety STACK_ID=1` fails — reproduced and diagnosed, not newly discovered: the failure is in `supabase/tests/migration-data-safety/fixture.sql:533` (`connections` seed missing the NOT NULL `proposed_by_account_id` column Story 8.5 added), the exact pre-existing defect Story 9.1's own Dev Agent Record already proved unrelated to `listings` by checking out `ec81675`. This story never touches `fixture.sql` at all (`git diff HEAD -- supabase/tests/migration-data-safety/fixture.sql` is empty), and the failure occurs during the guard's OWN seed step — which runs against the last-deployed schema BEFORE any of this story's pending migrations are even applied — so it is structurally impossible for this story's diff to be the cause. Reported, not fixed, per `.claude/rules/parallel-ownership.md` ("out-of-scope work is reported, not taken") and 9.1's own precedent for the same finding.
- Retired-name guard (`node scripts/check-retired-names.mjs`) initially flagged this story's own `PublishSingleListingSection.test.tsx` for the literal word "Children" inside a test's excluded-field-text array (a defensive AC-4 assertion mirroring the Dev Notes field-set table). Removed that one array entry rather than allowlisting the guard — "Marital status" already covers the same Dev Notes row, and the type-level narrowness of `PublishableSingleListingFields` proves the same claim structurally; all four CI guards (suppression ratchet, retired-name, route-convention, Tailwind v3-syntax) are green.
- `make typecheck`, `make lint` (ESLint + `prettier --config ./.prettierrc.json --check`), `make build`, and `npx vitest run` (`make test`, unscoped) all pass. Bare `npx prettier --check .` (no `--config`) flags the same 16 pre-existing files 9.1's own Dev Agent Record already named (`.github/workflows/*.yml`, `doc/src/content/docs/**/*.mdx`, `.lintstagedrc`) — none touched by this story.

### Completion Notes List

- All 8 ACs implemented and covered: AC-1/AC-2/AC-4/AC-6 primarily by `PublishSingleListingSection.test.tsx` (5 tests) and `useListingUpsert.test.tsx` (5 tests); AC-2/AC-3/AC-6/AC-7/AC-8 by `supabase/tests/listings.sql`'s new Story 9.2 block (15 checks); AC-3's UX-layer half (who even sees the action) by `SingleListingSection.test.tsx` (6 tests, including the self-manager-vs-sibling row gate).
- The DRY extraction Task 5 asked for (`useListingUpsert(accountId, listingType, subjectId)`) is a genuine behavior-preserving refactor of `useShadchanListing.ts`, not a rename: `PublishShadchanListingSection.test.tsx` (9.1's own suite, unmodified) still passes byte-for-byte, which is the proof the shadchan branch's observable behavior did not change. The name-required validation stays in each branch's own component/wrapper (shadchan's in `useShadchanListing.ts`, single's in `PublishSingleListingSection.tsx`) rather than in the shared hook — the two CHECK constraints they mirror (`listings_shadchan_name_required` vs `listings_single_name_required`) are different rules, so the shared hook's own job stays exactly "create vs. update," nothing branch-specific.
- Also extracted `ListingToggleField` (9.1's inline component) into its own `listings/ListingToggleField.tsx` so the seven-field single form did not duplicate the three-field shadchan form's toggle-row markup a second time — an `inputType` prop (`"number"` for Age) is the only addition; `PublishShadchanListingSection.tsx`'s own rendering and tests are unaffected.
- AC-3's key negative case (a self-manager refused on a SIBLING, not merely "any non-manager") required seeding a household with the self-manager's own single (`member_id` pointing at their `account_members.id`) and a genuinely separate sibling single with no such link — both created directly via `insert into public.singles` as the household's parent_admin (no RPC needed; `enforce_membership_role_matches_context_trigger` only checks account `kind` vs. `role`, not any `singles` linkage, so a plain `single`-role and `helper`-role member could be seeded the same direct way `medical_notes.sql` already does).
- FR103's frontend gate (`SingleListingSection.tsx`'s `canPublish`) uses `useCurrentMemberId()` (Story 7.3's existing "who am I in the `account_members.id` space" hook) to match a self-manager against their own `singles.member_id` — reused rather than re-derived, since it is exactly the id space `singles.member_id` and the RLS policy's own `EXISTS` clause both key on.
- FakeRest parity (Task 4): `listingsSeed` in `dataGenerator/shidduchim.ts` gives the demo one partially opted-in single listing (Rivky — name, age, community on; area/height/summary off), overwriting `index.ts`'s own empty default the same way `db.connections` is already documented to be overwritten — no change was needed to `providers/fakerest/dataProvider.ts` itself, since its existing `create()` override already stamps `account_id` for the `listings` resource generically (not `shadchan`-specific).
- `supabase/tests/migration-data-safety/fixture.sql`'s pre-existing gap (see Debug Log) is not owned by this story's File List and is not fixed here — it predates `listings` entirely and is Story 8.5's own NOT NULL columns colliding with a fixture that was never updated for them.

### File List

- `supabase/schemas/05_policies.sql` — the two new `single`-branch policies (`Single listings insert`, `Single listings update`), appended after 9.1's five (Task 1); no existing policy edited.
- `supabase/migrations/20260802231822_add_single_listing_policies.sql` — generated + hand-checked (contains only the two new `create policy` statements).
- `src/components/atomic-crm/types.ts` — `PublishableSingleListingFields`, `Pick`ed from `Listing`.
- `src/components/atomic-crm/listings/useListingUpsert.ts` — the shared create-vs-update hook extracted from `useShadchanListing.ts` (Task 5, DRY).
- `src/components/atomic-crm/listings/useListingUpsert.test.tsx` — unit tests for the extracted hook's create-vs-update branch, subjectId handling, and withdraw().
- `src/components/atomic-crm/listings/useShadchanListing.ts` — refactored to a thin wrapper over `useListingUpsert` (same external API; `PublishShadchanListingSection.tsx` untouched).
- `src/components/atomic-crm/listings/ListingToggleField.tsx` — the shared toggle-row primitive extracted out of `PublishShadchanListingSection.tsx` (DRY), with an added `inputType` prop for the numeric Age field.
- `src/components/atomic-crm/listings/PublishShadchanListingSection.tsx` — now imports `ListingToggleField` instead of defining it inline; no behavior change (its own test suite passes unmodified).
- `src/components/atomic-crm/listings/PublishSingleListingSection.tsx` — the seven-field publish form (AC-1 through AC-6).
- `src/components/atomic-crm/listings/PublishSingleListingSection.test.tsx` — unit tests (AC-1, AC-2, AC-4, AC-6).
- `src/components/atomic-crm/settings/SingleListingSection.tsx` — the household-gated roster + per-row Publish/Manage-listing Dialog, wired to FR103's authority rule.
- `src/components/atomic-crm/settings/SingleListingSection.test.tsx` — gating unit tests (kind gate, parent_admin, self_manager-vs-sibling, helper/single non-managing roles).
- `src/components/atomic-crm/settings/SettingsPage.tsx` / `SettingsPageMobile.tsx` — mount `SingleListingSection` next to `FamilySection`.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts` — `listingsSeed` (one seeded single listing for the demo) and its `db.listings` wiring.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` — comment update only (documents the `db.listings` override, no behavior change).
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` / `frenchCrmMessages.ts` — `crm.settings.single_listing.*` and `crm.settings.single_listing_form.*` keys.
- `registry.json` — regenerated (`make registry-gen`) for the new `listings/`/`settings/` files.
- `supabase/tests/listings.sql` — extended with Story 9.2's 15 new checks (AC-1, AC-2, AC-3 ×4, AC-6 ×3, AC-7, AC-8 ×4, plus supporting confirmations).
- `supabase/tests/listings.test.ts` — header comment updated for both stories; the "floor" assertion raised from 25 to 45.
