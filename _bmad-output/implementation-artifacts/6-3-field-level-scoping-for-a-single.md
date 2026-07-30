---
baseline_commit: 5ce5422374eaf0ab33bffd6989ef3dd9afa047b6
---

# Story 6.3: Field-level scoping for a single

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want sensitive fields and candid content withheld from a single at the
database, not just hidden in the UI,
so that diligence, medical notes and private working notes stay candid, while
the dignity floor still guarantees the single their live prospects.

## Position in Epic 6

**3rd of 6 to build.** Depends on **Story 6.2** for `current_member_role()`
(and `current_member_id()`, both reused here unchanged) and for `shidduchim`
already being row-scoped to the single's own visible suggestions — this story
only narrows *content within* a row 6.2 already made visible, or denies a
table 6.2 left untouched. Precedes **Story 6.4**, which carves one narrow
write exception into this story's default-deny on `interactions`; 6.4 cannot
be built correctly until this story's deny-by-default is in place to be an
exception *to*.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

This is the epic's sensitive story. Everything it withholds is withheld **at
the database** — RLS row denial or a `security_invoker` view's `CASE`, never
a client-side filter — and every denial carries a negative test that goes red
if the rule is loosened. `.claude/rules/security-triggers.md` applies to the
whole diff.

## Acceptance Criteria

1. **`reference_links`, `"references"`, `entity_files` and
   `shidduchim_external_links` deny the `single` role outright — zero rows on
   every command.** The first two are the diligence surface: candid
   `call_status`/`what_they_said`/`conversation_log` and the reference book
   itself. `entity_files` (Story 3.7) and `shidduchim_external_links` (Story
   5.6) are uploads and link bookmarks attached during diligence — candid by
   construction, with no per-row visibility column to narrow on. There is no
   row in any of the four that is safe to expose regardless of the parent
   suggestion's visibility — the denial is content-based, not state-based,
   which is why it belongs here and not in 6.2. (`"references"` is also
   R7-scoped: no nav entry, no browse surface, out of global search. This
   story closes the data half of that ruling for the `single` role.)

2. **`interactions` denies the `single` role by default on every command,
   through every policy the table carries.** This covers private parent notes
   (`kind = 'note'`), the full activity/status-change timeline, and — since
   Story 5.9 migrated `shadchanim.notes` into `interactions` rows
   (`target_type = 'shadchan'`, `scope = 'account'`, `kind = 'note'`) — the
   family's candid shadchan commentary too. The table carries **three**
   per-command policies at HEAD (verified, listed in Task 2); the deny must
   land on all three. A single sees no interaction row of any kind at the end
   of this story — Story 6.4 is what carves the one exception.

3. **`shadchanim` rows stay readable to a single; writes are denied.**
   Post-5.9 the table holds no candid column — verified at HEAD: the columns
   are `id`, `account_id`, `created_at`, `name`, `name_he`, `location`,
   `contacts`, `responsiveness`, and there is no `notes`
   (`01_tables.sql:283-301`). What remains is the household's rolodex, needed
   so a visible suggestion's "via {shadchan}" renders as a real record (AD-24
   `RecordLink`). Read is row-level and account-wide.

4. **`shidduchim.close_reason` is withheld from a single even on an otherwise
   fully visible suggestion.** A `look_into`/`yes`/`unsure` suggestion is
   visible per Story 6.2, but its `close_reason` — free-text decision
   rationale that can carry candid content — always reads `NULL` for a
   `single` caller, never the real value.

5. **Medical notes deny the `single` role, and this story owns the negative
   test for it.** Verified at HEAD: `"Medical notes scoped to account,
   parent_admin/self_manager only"` (`05_policies.sql:267`) is an
   **allow-list** of `parent_admin`/`self_manager`, so `single` is excluded
   by construction and **no schema change is needed here**. (Story 6.2's
   Task 7 rewrites that policy's inlined membership lookup onto
   `current_member_role()`; that is a DRY rewrite of the same predicate, not
   a change of answer, and it happens before this story.) This story
   re-asserts the exclusion with its own negative test regardless, because
   Story 5.5 could not have exercised a role that had no policies gating it
   at its build time.

6. **Storage follows the tables — precisely, not wholesale.** The `documents`
   bucket carries **six** policies in two prefixes and `entity-files` carries
   three (`07_storage.sql`). They are treated differently:
   - `documents` / `resumes/` prefix (select, insert, delete —
     `07_storage.sql:131-153`) and `entity-files` (select, insert, delete —
     `:76-95`): each gains
     `and public.current_member_role() <> 'single'`. There is no visibility
     segment in either key grammar, so deny is the only expressible posture.
   - `documents` / `photos/` prefix (`:174-205`) is **not touched**. Story
     5.4 deliberately grants a `single` every object under
     `photos/shared/…` and denies `photos/private_parent/…`, matching its
     `resume_photos` row policy. Blanket-denying it here would silently
     reverse a shipped, tested decision. Anything in an older draft of this
     story that says "every storage policy for the documents bucket" is
     wrong — see Dev Notes "The `resume_photos` correction".
   - The public `attachments` bucket (avatars/logos) is out of scope — its
     hardening is a pre-existing, epic-independent gap already flagged by
     Stories 3.7/10.3.
   - No `UPDATE` policy is added to `storage.objects` under any
     circumstances: `supabase/tests/context_rls_hardening.sql` asserts,
     table-wide, that none exists.

7. **None of the above is visible through a summary view either.** Every view
   in `03_views.sql` is `security_invoker = on`, so base-table RLS carries
   through: `references_summary`, `reference_links_summary` and
   `interactions_summary` return zero rows for a `single` caller, and
   `entity_files_summary` likewise. `shidduchim_summary` returns the visible
   suggestion but redacts `close_reason` the same way AC-4 requires. This
   story adds tests proving that behaviour rather than special-casing any
   view.

8. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   `single` reading `reference_links` / `"references"` / `interactions` /
   `entity_files` / `shidduchim_external_links` / `medical_notes` gets zero
   rows even when a `parent_admin` in the same account gets non-zero rows in
   the same test run — the `interactions` fixture includes a
   shadchan-targeted `note` row (the 5.9-migrated shape) to prove the former
   `shadchanim.notes` content is covered; a `single` reading a visible
   suggestion's `close_reason` gets `NULL` while a `parent_admin` reading the
   same row gets the real value; a `single` selecting from `storage.objects`
   gets zero rows for `bucket_id = 'entity-files'` and for `documents` keys
   under `resumes/`, **and still gets the `documents` key under
   `photos/shared/`** while getting zero for `photos/private_parent/` — the
   two-sided assertion that proves this story denied what it meant to and
   nothing more.

9. **The tabs whose data this story empties are hidden from a single, not
   left as empty shells.** Using the shipped mechanism — `visibleTo?:
   MemberRole[]` on `EntityTabDescriptor`, an allow-list filtered by
   `hasVisibility()` before the array reaches `Entity360Tabs` (contract §2
   rule 7, §6 rule 2) — and not a second one. On `shidduchim`: `diligence`,
   `external-links`, `files`, `notes` and `activity` gain
   `visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"]`
   (`medical` already has its own, narrower allow-list from 5.5). The same
   allow-list goes on `singles`' `files`/`notes`/`activity` tabs. `overview`,
   `resume`, `photo` and `shidduchim` stay unrestricted — they are the
   dignity floor. `tabs ∪ pendingTabs` is unchanged, so `CANONICAL_TAB_SETS`
   needs no amendment and the AD-24 validator stays quiet.

## Tasks / Subtasks

- [x] **Task 1 — Deny the four candid tables to `single`** (AC: 1)
  - [x] Add `and public.current_member_role() <> 'single'` to the existing
        `for all` policy's `using` **and** `with check` on each of
        `"References scoped to account"` (`05_policies.sql:196`),
        `"Reference links scoped to account"` (`:286`),
        `"Shidduchim external links scoped to account"` (`:309`) and
        `"Entity files scoped to account"` (`:663`). No new policy is added
        for any of them — there is no row-subset that is safe, so the edit is
        a pure narrowing, not a two-policy split like Story 6.2's pattern.

- [x] **Task 2 — Deny `interactions` to `single` by default** (AC: 2)
  - [x] `select policyname, cmd from pg_policies where tablename = 'interactions';`
        — re-confirm at implementation time. Settled, not speculative: Story
        3.6 replaced the original single `for all` policy with three
        per-command policies, each carrying the same account/parent-visibility
        predicate:
        - `"Interactions readable within account and parent visibility"`
          (SELECT, `05_policies.sql:383`)
        - `"Interactions insertable within account and parent visibility"`
          (INSERT, `:435`)
        - `"Interactions updatable by author or owning role"` (UPDATE,
          `:514`, which additionally ANDs in
          `kind not in ('note', 'single_input') or
          public.can_moderate_note(actor_member_id)` — note `single_input`
          joined that bucket in 5.7's review-fix pass; Story 6.4 owns that
          clause, not this story).

        Add `and public.current_member_role() <> 'single'` to the **whole**
        `using`/`with check` expression of **every one of these three** — not
        one branch of one policy, and not just the two that predate 3.6.
        There is no `for delete` policy and none is to be added:
        `authenticated` holds no DELETE grant on this table
        (`06_grants.sql:679-680`, the append-only audit-trail rule).
  - [x] Do **not** add a `single`-scoped policy in this story. Story 6.4 adds
        exactly one, narrowly. Leaving the gap open here is what keeps this
        story's own negative test (AC-8) honest: "a single sees zero
        interactions" must be true at the end of *this* story,
        unconditionally.

- [x] **Task 3 — `shadchanim`: row-readable, write-denied** (AC: 3)
  - [x] Add `and public.current_member_role() <> 'single'` to
        `"Shadchanim scoped to account"` (`05_policies.sql:191`), both
        halves, then add:
        ```sql
        create policy "Shadchanim visible to single" on public.shadchanim
            for select to authenticated
            using (
                account_id = public.current_context_id()
                and public.current_member_role() = 'single'
            );
        ```
        Whole-book read is deliberate — see Dev Notes "Why the single sees
        the whole shadchan book".
  - [x] `shadchan_stats` (`03_views.sql:225`) is a `security_invoker` view
        over `shadchanim` + `shidduchim` + `redts`. A single reads the
        shadchan rows but zero `redts` (6.2), so its aggregate columns come
        back as zeroes/nulls rather than as another household member's
        counts. Assert that in Task 8 rather than assuming it — a view whose
        aggregate silently ignores RLS would be a leak.

- [x] **Task 4 — Redact `shidduchim.close_reason` for `single`** (AC: 4, 7)
  - [x] `supabase/schemas/03_views.sql`, `shidduchim_summary` (`:51`, the
        `s.close_reason` projection at `:80`): change it to
        `case when public.current_member_role() = 'single' then null else s.close_reason end as close_reason`.
        Keep the column in the **same ordinal position** — `create or replace
        view` can only append columns, never reorder them (the file's own
        comment at `:224` states this trap for `shadchan_stats`).
  - [x] Confirm no frontend read path selects `shidduchim.close_reason`
        directly from the base table on a single-reachable surface.
        `grep -rn "close_reason" src/components/atomic-crm/` at HEAD returns
        `types.ts` (the `ShidduchSummary` field), the two dataProviders'
        `transitionShidduch` write paths, and test fixtures — no base-table
        read. If one has appeared, point it at the view rather than
        duplicating the redaction (AD-1's one-place principle).

- [x] **Task 5 — Medical notes: no schema change, unconditional negative test** (AC: 5)
  - [x] Read `"Medical notes scoped to account, parent_admin/self_manager
        only"` (`05_policies.sql:267`) and confirm it is still an allow-list
        naming exactly `parent_admin`/`self_manager` (Story 6.2 Task 7 will
        have rewritten the lookup onto `current_member_role()`; the role set
        is unchanged). If so, **make no schema change** — adding a redundant
        `<> 'single'` clause to a policy that already denies by allow-list is
        a DRY violation and would make a future role addition look safe when
        it is not.
  - [x] Only if it has somehow become a deny-list, add
        `and public.current_member_role() <> 'single'` as in Task 1 and say
        so in the PR.
  - [x] Either way, the negative test in Task 8 is unconditional.

- [x] **Task 6 — Storage policies** (AC: 6)
  - [x] `supabase/schemas/07_storage.sql`: add
        `and public.current_member_role() <> 'single'` to exactly six
        policies — `"Entity files readable/writable/deletable within
        account"` (`:76`, `:83`, `:90`) and `"Documents resumes
        readable/writable/deletable within account"` (`:131`, `:139`,
        `:147`).
  - [x] Do **not** touch `"Documents photos readable/writable/deletable
        within account"` (`:174`, `:189`, `:198`) or any `attachments`
        policy. The photos-readable policy already contains the role check
        Story 5.4 shipped; rewriting its inlined
        `exists (… am.role <> 'single')` onto `current_member_role()` is
        Story 6.2's Task 7, not this story's.
  - [x] Add no `UPDATE` policy (`context_rls_hardening.sql` asserts
        table-wide that none exists).

- [x] **Task 7 — Generate and hand-check the migration** (AC: all)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_field_scoping`
  - [x] Confirm the diff is `DROP POLICY`+`CREATE POLICY` / `ALTER POLICY` /
        `CREATE OR REPLACE VIEW` only. If the diff **drops and recreates**
        `shidduchim_summary` rather than replacing it, hand-add
        `with (security_invoker = on)` and the view's grants — `db diff`
        re-emits neither (AGENTS.md). `supabase/tests/security_invoker_views.sql`
        and `supabase/tests/view_grants.sql` are the mechanical check for
        both; they must pass.
  - [x] Verify the storage-policy changes actually appear — `db diff` on
        `storage.objects` is often incomplete (Story 5.3 hit the same); add
        them by hand if omitted.
  - [x] `make check-migration-safety`. This story drops no column and deletes
        no row, so it must pass with no new `declared-moves.sql` entry.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [x] **Task 8 — Tests** (AC: 7, 8)
  - [x] New `supabase/tests/single_field_scoping.sql` + `.test.ts`. Reuse
        Story 6.2's fixture helper if it was factored into
        `dbSuiteHelpers.ts`; otherwise arrange: one household, one
        `parent_admin`, one `single` linked to a `look_into`+`shared`
        suggestion with `close_reason` set and a shadchan attached; a
        `reference_links` row with `what_they_said` set; one `interactions`
        row of `kind = 'note'`, `target_type = 'shadchan'`,
        `scope = 'account'` (the 5.9-migrated shape) and one of
        `target_type = 'shidduch'`, `scope = 'shidduch'`; one `entity_files`
        row; one `shidduchim_external_links` row; one `medical_notes` row;
        and four `storage.objects` rows inserted directly as `postgres` —
        `{acct}/resumes/…`, `{acct}/photos/shared/…`,
        `{acct}/photos/private_parent/…` in `documents`, and one in
        `entity-files`.
  - [x] Assert (AC-8): as `single`, `select count(*)` from each of
        `reference_links`, `"references"`, `interactions`, `entity_files`,
        `shidduchim_external_links`, `medical_notes` = `0`; as `parent_admin`
        in the same account, each is non-zero. One `insert into results` row
        per table, so a loosened policy names itself.
  - [x] Assert (AC-4/7): as `single`, `select close_reason from
        public.shidduchim_summary where id = :shid` is `NULL` even though the
        row itself is returned; as `parent_admin`, the real value comes back.
  - [x] Assert (AC-7): as `single`, `references_summary`,
        `reference_links_summary`, `interactions_summary` and
        `entity_files_summary` each return zero rows while the
        `parent_admin` gets non-zero.
  - [x] Assert (AC-3): as `single`, the shadchan row is returned
        (name/location readable); an `update` on it affects zero rows; an
        `insert` raises. Assert `shadchan_stats` returns the shadchan with
        zeroed counts, not the parent's counts.
  - [x] Assert (AC-6/8), both directions: as `single`,
        `select count(*) from storage.objects where bucket_id =
        'entity-files'` = `0`; the `documents` key under `resumes/` = `0`;
        the `documents` key under `photos/private_parent/` = `0`; the
        `documents` key under `photos/shared/` = **1**. As `parent_admin`,
        all four are visible.
  - [x] Regression: `references_entity.sql`, `shidduch_catch.sql`,
        `medical_notes.sql`, `resume_photos.sql`, `entity_files.sql`,
        `shidduchim_external_links.sql`, `documents_storage.sql`,
        `interaction_note_authorship.sql`, `interactions_targets.sql`,
        `context_rls_hardening.sql`, `security_invoker_views.sql`,
        `view_grants.sql` and Story 6.2's `single_row_scoping.sql` all pass
        **unmodified**.
  - [x] Frontend (AC-9): the shidduch and single descriptor tests assert each
        newly-restricted tab is absent for a `single` viewer and present for
        a `parent_admin`, and that `overview`/`resume`/`photo` remain present
        for a `single`. `vitest-browser-react` + `TestMemoryRouter`; the
        `EntityShow.permissions.test.tsx` pattern already exists for this.
        Run `npx vitest run src/components/atomic-crm/entity360/ad24Conformance`
        to confirm the validator stays quiet.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`
        (the DB suites need `make start`).

## Dev Notes

### Why `close_reason` redaction happens in a view, not a policy

Postgres RLS is **row**-scoped: a policy's `USING` clause decides whether a
row is returned at all, never which of its columns come back. A suggestion
that is genuinely visible to a single (state + visibility pass Story 6.2's
policy) must still surface most of its columns — hiding the whole row would
contradict the dignity floor, not protect it. The tool for "this one column,
on an otherwise-visible row, is different per viewer" is a `CASE WHEN` inside
a `security_invoker = on` view, which is why `shidduchim_summary` — already
the frontend's declared read path per AD-10 — is where this story edits, not
`05_policies.sql`. It is the only column-level redaction left in the epic:
the other candid column this story once had to redact, `shadchanim.notes`,
was eliminated at the source when Story 5.9 migrated it into `interactions`
(where AC-2's row-level deny covers it) and dropped the column.

### The `resume_photos` correction

An earlier draft of this story (and of 6.2) described `resume_photos` and the
`documents` bucket as already denying, or needing to deny, the `single` role
wholesale. Both were wrong, and acting on either would have reversed a
shipped decision with no test going red to say so. Story 5.4 grants a
`single` every `visibility = 'shared'` photo — at the row layer
(`05_policies.sql:226`) and at the object layer, keyed on the third path
segment (`07_storage.sql:174-188`) — and denies only `private_parent`. That
is the dignity floor working as designed: the photo of the person being
suggested is exactly the kind of thing the single is entitled to see. AC-6's
scope and AC-8's two-sided storage assertion exist to make that boundary
falsifiable in both directions.

### Why the single sees the whole shadchan book

Post-5.9 a `shadchanim` row is a contact card: name, location, contact
details, responsiveness. Narrowing the single to "only shadchanim attached to
your visible suggestions" would buy no privacy (the candid commentary now
lives in `interactions`, denied) and would break every `RecordLink` render of
a shadchan the moment a suggestion leaves the visible set — a dangling link
on a screen the single legitimately sees. Row-level read of the book, with
writes denied, is the smaller and more honest rule.

### Why the remaining storage denial is wholesale

The dignity floor (AD-3) is "the single always sees their live prospects and
can give input" — satisfied by 6.2's row grants (the `resumes` row carries
`extracted`/`sections`, which is what the tabs render) plus 5.4's shared
photos. The two prefixes this story closes are different: `entity-files/` and
`documents/resumes/` have no visibility segment in their key grammar, so
there is nothing to scope a narrower grant on, and their contents are
diligence uploads. Deny-by-default (AD-1) is the only posture that cannot
leak there. If the product later wants a single to open the actual resume PDF
of a visible suggestion, that is a new, narrow storage policy (path-parsed
join to `shidduchim` visibility) with its own story and its own negative
tests — not a reason to leave the prefix open now.

### The Epic 5 sequencing gap this story exists to close

Story 5.5's medical-notes RLS and Story 5.4's `resume_photos` RLS were both
written before the `single` role appeared in any general policy. 5.4
explicitly included `single` in its reasoning and its negative test; 5.5's
allow-list excludes `single` by construction. This story treats 5.5 as
verified (Task 5 reads the policy) but owns the `single`-specific negative
test unconditionally, because "a test existed for a similar role" is not
evidence a test exists for this one. `resume_photos` keeps 5.4's own suite as
its guard — but AC-8's storage assertion re-covers the object layer, since
that is where this story's edits sit next to 5.4's.

### What this story does not decide

- **Whether a `helper` should see less than a `parent_admin`** anywhere in
  this schema. Real gap, not this epic's to close (no Epic 6 AC asks for
  it) — flagged in the epic's closing report.
- **The single's dating history and redt history** — denied by Story 6.2's
  wholesale list; unchanged here.
- **Whether the single may write anything at all** — Story 6.4's, and its
  one exception is deliberately absent from this story's policies.

### Testing standard

Same shape as Story 6.2 — plain SQL `results`-table suites run via
`npm run test:unit:db`, multi-identity via `set local request.jwt.claims`,
harness in `supabase/tests/dbSuiteHelpers.ts`, pattern in
`supabase/tests/references_entity.sql`. Supabase CLI calls need
`DBUS_SESSION_BUS_ADDRESS=/dev/null`. Frontend tests are
`vitest-browser-react` in real Chromium with `TestMemoryRouter`. AAA per
`.claude/rules/testing.md`.

### Project Structure Notes — the true file set

Schema / DB:
- `supabase/schemas/05_policies.sql` (`"references"`, `reference_links`,
  `entity_files`, `shidduchim_external_links`, the three `interactions`
  policies, `shadchanim` + one new policy; `medical_notes` only in the
  unexpected deny-list case)
- `supabase/schemas/03_views.sql` (`shidduchim_summary` redaction)
- `supabase/schemas/07_storage.sql` (six policies: `entity-files` ×3,
  `documents`/`resumes` ×3)
- `supabase/migrations/<timestamp>_single_role_field_scoping.sql`
- `supabase/tests/single_field_scoping.sql`, `.test.ts` (new)
- `supabase/tests/dbSuiteHelpers.ts` (shared fixture, if 6.2 factored it)
- Regression-only, must not be edited: `references_entity.sql`,
  `shidduch_catch.sql`, `medical_notes.sql`, `resume_photos.sql`,
  `entity_files.sql`, `shidduchim_external_links.sql`,
  `documents_storage.sql`, `interaction_note_authorship.sql`,
  `interactions_targets.sql`, `context_rls_hardening.sql`,
  `security_invoker_views.sql`, `view_grants.sql`, `single_row_scoping.sql`

Frontend (AC-9 only):
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/singles/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/entity360/ad24Conformance.test.ts` (must stay
  green; no `CANONICAL_TAB_SETS` edit)
- `registry.json` (regenerated by the pre-commit hook; commit what it
  produces)

No new i18n keys are expected (`visibleTo` hides tabs whose labels already
exist). If any string is added, both
`providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` change.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — "the underlying data was never sent
  to the client"; deny-by-default.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — visibility extends to every child
  table via join-to-parent RLS; this story is where the candid-content half
  of that rule (as opposed to Story 6.2's state-based half) is decided.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — the spine words tab visibility as
  "tabs declare a minimum visibility". The **implemented** mechanism is
  `EntityTabDescriptor.visibleTo?: MemberRole[]`, an explicit allow-list, not
  an ordered threshold; `minVisibility` does not exist and any story text
  using it is stale.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2] — rule 7:
  `visibleTo?: MemberRole[]`, absent = visible to every role.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#6] — rule 2:
  a denied tab's `render` is never called and its label never enters the DOM.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "gut
  set-asides, candid reference words, private notes and medical notes are
  unreachable at the database, not merely hidden."
- [Source: _bmad-output/implementation-artifacts/5-9-shadchan-360.md] —
  migrates `shadchanim.notes` into `interactions` and drops the column; the
  reason AC-3 needs no column redaction.
- [Source: _bmad-output/implementation-artifacts/5-5-medical-tab-sensitive-tier.md]
  — `public.medical_notes` and its allow-list; Task 5's verification target.
- [Source: _bmad-output/implementation-artifacts/5-4-photo-tab-explicit-visibility.md]
  — the shared/private_parent photo split AC-6 must not reverse.
- [Source: _bmad-output/implementation-artifacts/3-7-universal-files-tab.md]
  and [5-6-files-and-external-links-tabs.md] — `entity_files` /
  `shidduchim_external_links` and the `entity-files` bucket.
- [Source: _bmad-output/implementation-artifacts/5-3-resume-tab-version-history.md]
  — the `documents` bucket and its account-folder storage policies.
- [Source: _bmad-output/implementation-artifacts/3-6-universal-notes-tab.md]
  — the three-policy split on `interactions` Task 2 must cover in full.
- Current schema, verified for this refresh: `supabase/schemas/01_tables.sql:283-301`
  (`shadchanim`, no `notes`), `:607-670` (`interactions` discriminators and
  their exhaustive check constraints — read before editing);
  `supabase/schemas/03_views.sql:51` / `:80` (`shidduchim_summary`,
  `close_reason`), `:107` / `:139` / `:225` / `:276` / `:310` (the other
  `security_invoker` views); `supabase/schemas/05_policies.sql:191`, `:196`,
  `:267`, `:286`, `:309`, `:383`, `:435`, `:514`, `:663`;
  `supabase/schemas/07_storage.sql:76-95`, `:131-153`, `:174-205`;
  `supabase/schemas/06_grants.sql:679-680`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (developer agent, STACK_ID=3, STACK_OWNER=6.3).

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-3 -f single_role_field_scoping` — generated migration, hand-checked (only `DROP POLICY`/`CREATE POLICY`/`CREATE OR REPLACE VIEW`, no `DROP TABLE`/`CREATE TABLE`).
- Hand-added `alter view "public"."shidduchim_summary" set (security_invoker = on);` to the generated migration — `db diff` emitted a bare `create or replace view` (no drop), but even that resets `security_invoker` to off with no `WITH (...)` clause. Caught by `security_invoker_views.test.ts` and `global_search.test.ts` both going red before the fix, both green after. Grants survived untouched (a bare `CREATE OR REPLACE VIEW` does not touch the pg_class ACL the way a DROP+CREATE does) — confirmed via `view_grants.test.ts` staying green throughout, so no grant re-issue was needed (unlike `20260730094101`'s drop-and-recreate case).
- `supabase db diff --workdir .supabase-e2e-3` — clean twice after applying the migration (`post_fix_clean_1`/`post_fix_clean_2`, both "No schema changes found").
- `make check-migration-safety STACK_ID=3` — PASSED (no column drop, no row delete, no new `declared-moves.sql` entry).
- `npx vitest run` (STACK_ID=3, full repo, all projects) — 2312/2316 passed. The 4 remaining failures are pre-existing test files this story does not own and Task 8 explicitly requires to "pass unmodified" — both are direct, unavoidable, and correctly-predicted consequences of this story's ACs, not defects in this story's own diff. See Completion Notes for the full explanation of each.
- `make typecheck`, `make lint`, `make build`, `npx prettier --check .` — all clean.
- Four CI guards (`check-suppressions.mjs`, `check-retired-names.mjs`, `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`) — all OK.
- `make registry-gen` — zero diff (no new UI component touched).

### Completion Notes List

- Tasks 1-8 implemented exactly as specified. Task 1: `"references"`/`reference_links`/`shidduchim_external_links`/`entity_files` each narrowed with `and public.current_member_role() <> 'single'` on both `using` and `with check` of their existing `for all` policy — no second policy added. Task 2: the same clause added to the WHOLE predicate (not one branch) of all three `interactions` per-command policies (SELECT/INSERT/UPDATE), verified at HEAD to still be exactly three, no `for delete` policy added or needed. Task 3: `shadchanim` split into the existing `for all` (narrowed to deny `single`) plus a new SELECT-only `"Shadchanim visible to single"` policy granting the whole book, account-wide, no join to the caller's own suggestion — the two-policy pattern Story 6.2 established. Task 4: `shidduchim_summary.close_reason` redacted via `CASE WHEN current_member_role() = 'single' THEN NULL ELSE s.close_reason END`, same ordinal position. Task 5: verified `"Medical notes scoped to account, parent_admin/self_manager only"` is still an allow-list at HEAD — no schema change made, per the story's own instruction. Task 6: exactly six storage policies gained the role guard (`entity-files` ×3, `documents`/`resumes` ×3); the three `documents`/`photos` policies were deliberately left untouched, confirmed by a diff review of `07_storage.sql` before committing.
- `shadchan_stats` aggregate-leak assertion (Task 3's own bullet) proven with a dedicated fixture: a second shadchan attributed ONLY to a sibling's visible suggestion — Leah (single) reads the shadchan row but the view's own LEFT JOIN to `shidduchim` returns zero rows under her RLS, so every aggregate column comes back as 0/NULL; the parent in the same run sees the real, non-zero count. This is the two-sided assertion the story asks for ("zeroed counts, not the parent's counts"), not just a single-sided "reads zero" check.
- `single_field_scoping.sql`/`.test.ts`: 41 checks (AC 1-8), reusing `dbSuiteHelpers.ts`'s shared sibling fixture unchanged, exactly as Story 6.2 factored it for this purpose. Every regression file Task 8 names as "must pass unmodified" was run and confirmed green **except** the two documented below, which are direct, self-consistent consequences of this story's own ACs.
- Frontend (AC-9): `shidduchim/entityDescriptor.tsx` gained `visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"]` on `diligence`/`external-links`/`files`/`notes`/`activity`; `singles/entityDescriptor.tsx` gained the same allow-list on `files`/`notes`/`activity`. `medical` (shidduchim) keeps its own, narrower Story 5.5 allow-list unchanged. `overview`/`resume`/`photo`/`shidduchim` (dignity floor) stay unrestricted. `tabs ∪ pendingTabs` unchanged on both descriptors — `ad24Conformance.test.ts` stays green, no `CANONICAL_TAB_SETS` edit needed. `registry.json` regenerated with zero diff (no new UI component).
- **NOT owned, decided per the story's own instruction:** AC-9 restricts only the `shidduchim` and `singles` descriptors. `shadchanim/entityDescriptor.tsx` (wave 2's file, not in this story's declared ownership) is left untouched — its `notes`/`activity` tabs stay reachable and now render permanently-empty shells for a `single` viewer (AC-3 grants a single account-wide `shadchanim` read, so the Shadchan 360 itself stays reachable). Per the story's own framing ("Either widen AC-9 and this entry, or accept the shells explicitly"), this is the **"accept the shells explicitly"** branch, made because widening AC-9 to a table this story does not own is out of scope for a STACK_ID=3 dispatch scoped to `shidduchim`/`singles` only. Flagging for a follow-up story/task to add the same `visibleTo` allow-list to `shadchanim/entityDescriptor.tsx`'s `notes`/`activity` tabs.
- **Two pre-existing regression files, explicitly named by this story's own Task 8 as "must pass unmodified," now fail — by design, not by defect — and are outside this story's declared ownership, so left untouched and flagged here rather than edited:**
  - `supabase/tests/single_row_scoping.sql` (Story 6.2's file): 2 of its own assertions — `AC6 SCOPE NOTE (Story 6.3 to close): log_reference_call() is not yet denied for a single` and the same for `merge_references()` — are pinned, in that file's own comments, to flip red the moment this story lands ("Story 6.3 turns them red ... a signal to update the expectation to 'denied', not silently leaves them looking untested"). That is exactly what happened: both RPCs now raise `... not found in current account` for a `single` caller, because they read `reference_links`/`"references"` under RLS (Task 1). Fixing this requires updating those two DO blocks' expected outcome from "succeeds" to "denied" inside a file this story does not own (`supabase/tests/single_row_scoping.sql`, `supabase/tests/single_row_scoping.test.ts`) — needs a follow-up commit to that file, not this one.
  - `supabase/tests/shidduchim_external_links.sql` (Story 5.6's file): 2 assertions — `(c) select`/`(c) update: single ... (AC 6: no role check)` — literally assert the pre-6.3 behaviour Task 1 is expressly designed to overturn (`shidduchim_external_links` is one of the four tables AC-1 names). This file has no forward-looking note the way `single_row_scoping.sql` does, but the conflict is the same shape: a prior story's regression test pins a decision this story's binding AC explicitly reverses. Needs a follow-up commit updating those two assertions to expect denial, inside a file this story does not own.
  - Both were confirmed to be the ONLY failures in the full, repo-wide `npx vitest run` (STACK_ID=3) — 2312/2316 passing, the same 4 failures whether run via `npx vitest run` or `make test STACK_ID=3`.
- One file outside this story's declared ownership was fixed directly, unlike the two above, because Story 6.2 already established the precedent of fixing this EXACT file for this EXACT mechanism (see 6.2's own Completion Notes) and it carries no "must pass unmodified" instruction anywhere in this story: `src/components/atomic-crm/entity360/routeConvention.routes.test.tsx`'s unresolved-role tab-count assertion for `/singles/1` dropped from 7 to 4 (Story 6.2 previously bumped it from 8 to 7 for the identical `tasks`-tab mechanism; this story's `files`/`notes`/`activity` additions remove three more tabs for an unresolved role under `hasVisibility`'s fail-closed rule).

### File List

Schema / DB:
- `supabase/schemas/05_policies.sql` (policy edits: `"references"`, `reference_links`, `shidduchim_external_links`, `entity_files` narrowed; `interactions` ×3 narrowed; `shadchanim` narrowed + new `"Shadchanim visible to single"` policy)
- `supabase/schemas/03_views.sql` (`shidduchim_summary.close_reason` redaction)
- `supabase/schemas/07_storage.sql` (6 policies narrowed: `entity-files` ×3, `documents`/`resumes` ×3; `documents`/`photos` ×3 untouched)
- `supabase/migrations/20260730175650_single_role_field_scoping.sql` (generated + hand-checked + hand-added `alter view ... set (security_invoker = on)`)
- `supabase/tests/single_field_scoping.sql` (new)
- `supabase/tests/single_field_scoping.test.ts` (new)
- `supabase/tests/dbSuiteHelpers.ts` (unchanged — 6.2's shared fixture reused as-is, no new helper needed)

Frontend (AC-9):
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` (+`visibleTo` on `diligence`/`external-links`/`files`/`notes`/`activity`)
- `src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx` (+describe block for the 5 newly-restricted tabs' `visibleTo`)
- `src/components/atomic-crm/singles/entityDescriptor.tsx` (+`visibleTo` on `files`/`notes`/`activity`)
- `src/components/atomic-crm/singles/entityDescriptor.test.tsx` (+describe block for the 3 newly-restricted tabs' `visibleTo`)
- `registry.json` (regenerated — zero diff)

Outside originally declared ownership, fixed as a direct, unavoidable, mechanical consequence of AC-9 (see Completion Notes; mirrors Story 6.2's own precedent for this exact file):
- `src/components/atomic-crm/entity360/routeConvention.routes.test.tsx` (unresolved-role tab count: 7 → 4)

Outside originally declared ownership, deliberately left UNCHANGED and flagged for follow-up (both explicitly named "must pass unmodified" by this story's own Task 8, both now genuinely red as a self-consistent consequence of this story's binding ACs — see Completion Notes):
- `supabase/tests/single_row_scoping.sql` / `supabase/tests/single_row_scoping.test.ts` (Story 6.2's file — 2 self-documented "Story 6.3 to close" SCOPE NOTE assertions now flip red)
- `supabase/tests/shidduchim_external_links.sql` / `supabase/tests/shidduchim_external_links.test.ts` (Story 5.6's file — 2 "AC 6: no role check" assertions now flip red)

Not touched (out of this story's scope, per its own instruction, "accept the shells explicitly"):
- `src/components/atomic-crm/shadchanim/entityDescriptor.tsx` (wave 2's file — `notes`/`activity` tabs stay reachable and now render empty for a `single` viewer)

Unchanged (verified, not edited — regression-only per Task 8):
- `supabase/tests/references_entity.sql`, `supabase/tests/shidduch_catch.sql`, `supabase/tests/medical_notes.sql`, `supabase/tests/resume_photos.sql`, `supabase/tests/entity_files.sql`, `supabase/tests/documents_storage.sql`, `supabase/tests/interaction_note_authorship.sql`, `supabase/tests/interactions_targets.sql`, `supabase/tests/context_rls_hardening.sql`, `supabase/tests/security_invoker_views.sql`, `supabase/tests/view_grants.sql`

## Change Log

- 2026-07-30: Story 6.3 implemented — field-level scoping for a single at the database (AC 1-9). RLS narrows `"references"`/`reference_links`/`shidduchim_external_links`/`entity_files` and all three `interactions` policies to deny `single` outright; `shadchanim` split into row-readable/write-denied; `shidduchim_summary.close_reason` redacted via CASE; medical_notes re-verified as an unconditional allow-list with its own negative test; 6 storage policies narrowed (photos untouched). New `single_field_scoping` DB suite (41 checks). Frontend hides the now-permanently-empty tabs (`diligence`/`external-links`/`files`/`notes`/`activity` on shidduchim, `files`/`notes`/`activity` on singles) via `visibleTo`. Two pre-existing regression files (Story 6.2's `single_row_scoping.sql`, Story 5.6's `shidduchim_external_links.sql`) now fail as a self-consistent, documented consequence of this story's ACs and are flagged for a follow-up commit rather than edited outside this story's declared ownership.
