# Story 6.3: Field-level scoping for a single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want sensitive fields and candid content withheld from a single at the
database, not just hidden in the UI,
so that diligence, medical notes and private working notes stay candid, while
the dignity floor still guarantees the single their live prospects.

## Position in Epic 6

**2nd of 5 to build.** Depends on **Story 6.2** for `current_member_role()`
(and 3.5's `current_member_id()`, both reused here unchanged) and for
`shidduchim` already being row-scoped to the single's own visible suggestions
(this story only narrows *content within* a row 6.2 already made visible, or
denies a table 6.2 left untouched). Precedes **Story 6.4**, which carves one
narrow write exception into this story's default-deny on `interactions` — 6.4
cannot be built correctly until this story's deny-by-default is in place to be
an exception *to*.

## Acceptance Criteria

1. **`reference_links`, `"references"`, `entity_files` and
   `shidduchim_external_links` deny the `single` role outright — zero rows on
   every command.** The first two are the diligence surface: candid
   `call_status`/`what_they_said`/`conversation_log` and the reference book
   itself. `entity_files` (Story 3.7) and `shidduchim_external_links` (Story
   5.6) are uploads and link bookmarks attached during diligence — candid by
   construction, with no per-row visibility column to narrow on. There is no
   row in any of the four that is safe to expose regardless of the parent
   suggestion's visibility — deny is content-based, not state-based, which is
   why it belongs here and not in 6.2.

2. **`interactions` denies the `single` role by default on every command,
   through every policy the table carries.** This covers private parent notes
   (`kind = 'note'`), the full activity/status-change timeline, and — since
   Story 5.9 migrated `shadchanim.notes` into `interactions` rows
   (`target_type = 'shadchan'`, `kind = 'note'`) — the family's candid
   shadchan commentary too. A single sees no interaction row of any kind
   through this story — Story 6.4 is what carves the one exception. By this
   story's build time `interactions` may carry more than one policy (3.5's
   widened base policy; 3.6's note-author edit clause, folded in or separate)
   — the deny must land on **all** of them, enumerated from `pg_policies`,
   not on one remembered name.

3. **`shadchanim` rows stay readable to a single.** Post-5.9 the table holds
   no candid column (`notes` was migrated to `interactions` and dropped in
   that story's migration); what remains — `name`, `name_he`, `location`,
   `contacts`, `responsiveness` — is the household's rolodex, needed so a
   visible suggestion's "via {shadchan}" renders as a real record (AD-24
   `RecordLink`). Read is row-level and account-wide; writes deny `single`.

4. **`shidduchim.close_reason` is withheld from a single even on an otherwise
   fully visible suggestion.** A `look_into`/`yes`/`unsure` suggestion is
   visible per Story 6.2, but its `close_reason` — free-text decision
   rationale that can carry candid content — always reads `NULL` for a
   `single` caller, never the real value.

5. **Medical notes deny the `single` role, and this story owns the negative
   test for it, not Epic 5.** Story 5.5 ships `public.medical_notes` and its
   RLS *before* the `single` role exists in any policy (Epic 5 precedes Epic
   6 in delivery order), deciding readers as an allow-list
   (`parent_admin`/`self_manager`). If that allow-list shape landed as
   specified, no schema change is needed here — `single` is excluded by
   construction. Either way this story re-asserts the exclusion with its own
   negative test, because 5.5 could not have exercised a role that was not
   yet grantable at its build time.

6. **Storage follows the tables.** The private buckets Epics 3/5 added —
   `documents` (5.3/5.4: resumes, photos) and `entity-files` (3.7) — have
   account-folder-scoped `storage.objects` policies with no role awareness; a
   single could otherwise list and download every household file, bypassing
   every deny above. Each of those policies gains
   `and public.current_member_role() <> 'single'`. See Dev Notes "Why storage
   is denied wholesale" for the dignity-floor reasoning. The fork's public
   `attachments` bucket (avatars/logos) is out of scope — its hardening is a
   pre-existing, epic-independent gap already flagged by Stories 3.7/10.3.

7. **None of the above is visible through a summary view either.** Any
   `*_summary` view a single can reach (`shidduchim_summary`) redacts
   `close_reason` the same way AC-4 requires; any view whose rows derive
   entirely from a denied base table (`reference_links_summary`,
   `references_summary`) naturally returns zero rows for a single caller
   because the view is `security_invoker = on` — this story adds a test
   proving that behaviour rather than special-casing the view.

8. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   `single` reading `reference_links` / `"references"` / `interactions` /
   `entity_files` / `shidduchim_external_links` / `medical_notes` gets zero
   rows even when a `parent_admin` in the same account gets non-zero rows in
   the same test run — the `interactions` fixture includes a
   shadchan-targeted `note` row (the 5.9-migrated shape) to prove the former
   `shadchanim.notes` content is covered; a `single` reading a visible
   suggestion's `close_reason` gets `NULL` while a `parent_admin` reading the
   same row gets the real value; a `single` selecting from `storage.objects`
   in the `documents` and `entity-files` buckets gets zero rows while the
   `parent_admin` does not.

## Tasks / Subtasks

- [ ] **Task 1 — Deny the four candid tables to `single`** (AC: 1)
  - [ ] Add `and public.current_member_role() <> 'single'` to the existing
        "for all" policy's `using`/`with check` on each of `reference_links`,
        `"references"`, `entity_files`, `shidduchim_external_links`. No new
        policy is added for any of them — there is no row-subset that is
        safe, so the edit is a pure narrowing, not a two-policy split like
        Story 6.2's pattern.

- [ ] **Task 2 — Deny `interactions` to `single` by default** (AC: 2)
  - [ ] `select policyname, cmd from pg_policies where tablename = 'interactions';`
        — enumerate what actually exists post-3.5/3.6 (expected: the widened
        `"Interactions scoped to account and parent visibility"` base policy;
        possibly a separate note-author `UPDATE` policy if 3.6 chose that
        composition). Add `and public.current_member_role() <> 'single'`
        wrapping the **whole** `using`/`with check` expression of **every**
        policy found — not one branch of one policy.
  - [ ] Do **not** add a `single`-scoped policy in this story. Story 6.4 adds
        exactly one, narrowly. Leaving the gap open here is what keeps this
        story's own negative test (AC-8) honest: "a single sees zero
        interactions" must be true at the end of *this* story,
        unconditionally.

- [ ] **Task 3 — `shadchanim`: row-readable, write-denied** (AC: 3)
  - [ ] First verify 5.9 landed: `grep -n "notes" supabase/schemas/01_tables.sql`
        must show no `notes` column on `shadchanim`. If the column still
        exists, 5.9 did not land as written — stop and resolve that first
        (its migration owns moving the data), rather than resurrecting a
        redaction view here for a column that is contracted to die.
  - [ ] Add `and public.current_member_role() <> 'single'` to the existing
        `"Shadchanim scoped to account"` policy, then add:
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

- [ ] **Task 4 — Redact `shidduchim.close_reason` for `single`** (AC: 4, 7)
  - [ ] `supabase/schemas/03_views.sql`, `shidduchim_summary`: change
        `s.close_reason` to
        `case when public.current_member_role() = 'single' then null else s.close_reason end as close_reason`.
  - [ ] Confirm no frontend read path selects `shidduchim.close_reason`
        directly from the base table on a single-reachable surface (Epic 5's
        Overview tab, Story 5.2, reads `shidduchim_summary` per AD-10's
        "list/summary resources route through a `*_summary` view" — verify
        with `grep -rn "close_reason" src/components/atomic-crm/`). If a
        base-table read exists, point it at the view rather than duplicating
        the redaction (AD-1's one-place principle).

- [ ] **Task 5 — Medical notes: verify the allow-list, own the negative test** (AC: 5)
  - [ ] Read `public.medical_notes`' policy in `supabase/schemas/05_policies.sql`
        (created by Story 5.5). If it grants by role allow-list
        (`parent_admin`/`self_manager`) as 5.5 specifies, make **no** schema
        change — do not add a redundant `<> 'single'` clause to a policy that
        already denies by allow-list, per DRY.
  - [ ] If it instead landed as a deny-list (`<> 'helper'`-style), add
        `and public.current_member_role() <> 'single'` as in Task 1 — the
        scenario where 5.5 genuinely could not cover `single` and this
        story's edit is load-bearing.
  - [ ] Either way, the negative test in Task 7 is unconditional.

- [ ] **Task 6 — Storage policies** (AC: 6)
  - [ ] `supabase/schemas/07_storage.sql`: every `storage.objects` policy for
        the `documents` and `entity-files` buckets gains
        `and public.current_member_role() <> 'single'`. Do not touch the
        `attachments` bucket's policies.

- [ ] **Task 7 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_field_scoping`
  - [ ] Confirm the diff is `ALTER POLICY`/`DROP POLICY`+`CREATE POLICY`/
        `CREATE OR REPLACE VIEW` only. Re-check `security_invoker = on` and
        the grant set on any view this story drops-and-recreates (`db diff`
        drops both, per AGENTS.md and the 1.3 story's Dev Notes on the same
        trap). Verify the storage-policy changes actually appear — `db diff`
        on `storage.objects` is often incomplete (Story 5.3 hit the same);
        add them by hand if omitted.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 8 — Tests** (AC: 7, 8)
  - [ ] New `supabase/tests/single_field_scoping.sql` + `.test.ts`. Arrange:
        one household, one `parent_admin`, one `single` linked to a
        `look_into`+`shared` suggestion with `close_reason` set and a
        shadchan attached; a `reference_links` row with `what_they_said` set;
        one `interactions` row of `kind = 'note'` targeting the shadchan (the
        5.9-migrated shape) and one targeting the suggestion; one
        `entity_files` row; one `shidduchim_external_links` row; one
        `medical_notes` row; one `storage.objects` row in each of
        `documents`/`entity-files` (inserted directly as postgres — the suite
        does not exercise the upload API).
  - [ ] Assert (AC-8): as `single`, `select count(*)` from each of
        `reference_links`, `"references"`, `interactions`, `entity_files`,
        `shidduchim_external_links`, `medical_notes` = `0`; as `parent_admin`
        in the same account, each is non-zero.
  - [ ] Assert: as `single`, `select close_reason from public.shidduchim_summary
        where id = :shid` is `NULL` even though the row itself is returned;
        as `parent_admin`, the real value comes back.
  - [ ] Assert: as `single`, the shadchan row is returned (name/location
        readable); an `update` on it affects zero rows.
  - [ ] Assert (AC-6): as `single`, `select count(*) from storage.objects
        where bucket_id in ('documents', 'entity-files')` = `0`; as
        `parent_admin`, non-zero.
  - [ ] Regression: re-run `references_entity.sql`/`shidduch_catch.sql` and
        Story 6.2's `single_row_scoping.sql` unmodified and green.
  - [ ] `make typecheck && npm run lint && npm run test:unit:db` (needs
        `make start`).

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

### Why the single sees the whole shadchan book

Post-5.9 a `shadchanim` row is a contact card: name, location, contact
details, responsiveness. Narrowing the single to "only shadchanim attached to
your visible suggestions" would buy no privacy (the candid commentary now
lives in `interactions`, denied) and would break every `RecordLink` render of
a shadchan the moment a suggestion leaves the visible set — a dangling link
on a screen the single legitimately sees. Row-level read of the book, with
writes denied, is the smaller and more honest rule.

### Why storage is denied wholesale

The dignity floor (AD-3) is "the single always sees their live prospects and
can give input" — satisfied by 6.2's row grants: the `resumes` row carries
`extracted`/`sections`, which is what the tabs render. Raw storage objects
under the household's folder include private photos (5.4 already denies the
`resume_photos` rows), diligence uploads and, potentially, medical
attachments — with only an account-folder path convention separating them.
There is no per-object metadata to scope a narrower grant on today, so
deny-by-default (AD-1) is the only posture that cannot leak. If the product
later wants a single to open the actual resume PDF of a visible suggestion,
that is a new, narrow storage policy (path-parsed join to `shidduchim`
visibility) with its own story and its own negative tests — not a reason to
leave every bucket open now.

### The Epic 5 sequencing gap this story exists to close

Story 5.5's medical-notes RLS and Story 5.4's `resume_photos` RLS were both
written before the `single` role existed in any policy. 5.4 explicitly
included `single` in its allow-set reasoning and negative test; 5.5's
allow-list excludes `single` by construction. This story treats both as
*probably* correct but owns the `single`-specific negative test for
`medical_notes` unconditionally (Task 5/8), because "a test existed for a
similar role" is not evidence a test exists for this one. (`resume_photos`
keeps 5.4's own test as its guard; re-testing it here would duplicate an
existing suite.)

### What this story does not decide

- **Whether a `helper` should see less than a `parent_admin`** anywhere in
  this schema. Real gap, not this epic's to close (no Epic 6 AC asks for
  it) — flagged in the epic's closing report.
- **The single's dating history and redt history** — denied by Story 6.2's
  wholesale list; unchanged here.
- **Which tabs a single's client renders at all** — Epic 3 Story 3.4's
  permission-aware rendering plus each descriptor's `visibleTo` declarations
  (an explicit `MemberRole[]` allow-list; absent means visible to every role —
  contract §2 rule 7. There is no `minVisibility` and no ordered role
  hierarchy). This story guarantees the *data* is never sent regardless of
  what the client renders (AD-1's actual requirement). The frontend half —
  making the viewer's real role resolvable so a `visibleTo` array that lists
  `single` works at all — is Story 6.4's `useViewerRole()` rewiring task, not
  this story's.

### Testing standard

Same shape as Story 6.2 — plain SQL `results`-table suites run via
`npm run test:unit:db`, multi-identity via `set local request.jwt.claims`.
See `supabase/tests/references_entity.sql` for the pattern. AAA structure per
`.claude/rules/testing.md`.

### Project Structure Notes

No new files under `src/`; schema + migration + SQL-test story, same
category as 6.2. Changed files:
- `supabase/schemas/05_policies.sql` (policy edits on `reference_links`,
  `"references"`, `entity_files`, `shidduchim_external_links`,
  `interactions`, `shadchanim`, and — only if 5.5 landed as a deny-list —
  `medical_notes`)
- `supabase/schemas/03_views.sql` (`shidduchim_summary` redaction)
- `supabase/schemas/07_storage.sql` (`documents` + `entity-files` policies)
- `supabase/migrations/<timestamp>_single_role_field_scoping.sql`
- `supabase/tests/single_field_scoping.sql`, `.test.ts` (new)

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — "the underlying data was never sent
  to the client"; deny-by-default.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — visibility extends to every child
  table (`reference_links`, `interactions`, `resumes`, notes) via
  join-to-parent RLS; this story is where the candid-content half of that
  rule (as opposed to Story 6.2's state-based half) is decided.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "tabs declare a minimum visibility"
  (the spine's wording); the data never reaches the client. This story delivers
  the "data never reaches the client" half. The **implemented** mechanism is
  `EntityTabDescriptor.visibleTo?: MemberRole[]`, an explicit allow-list rather
  than an ordered threshold — see the contract citation below.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2] — rule 7:
  `visibleTo?: MemberRole[]`, absent = visible to every role; `minVisibility`
  does not exist.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "gut
  set-asides, candid reference words, private notes and medical notes are
  unreachable at the database, not merely hidden."
- [Source: _bmad-output/implementation-artifacts/5-9-shadchan-360.md] —
  migrates `shadchanim.notes` into `interactions` and drops the column; the
  reason AC-3 needs no column redaction.
- [Source: _bmad-output/implementation-artifacts/5-5-medical-tab-sensitive-tier.md]
  — `public.medical_notes` and its allow-list; Task 5's verification target.
- [Source: _bmad-output/implementation-artifacts/3-7-universal-files-tab.md]
  and [5-6-files-and-external-links-tabs.md] — `entity_files` /
  `shidduchim_external_links` and the `entity-files` bucket.
- [Source: _bmad-output/implementation-artifacts/5-3-resume-tab-version-history.md]
  — the `documents` bucket and its account-folder storage policies.
- [Source: _bmad-output/implementation-artifacts/3-6-universal-notes-tab.md]
  — the possible second `interactions` policy Task 2 must also guard.
- Current schema: `supabase/schemas/01_tables.sql` (`interactions`
  discriminator columns and their exhaustive check constraints — read before
  editing), `supabase/schemas/03_views.sql` (`shidduchim_summary`,
  `reference_links_summary`, `references_summary`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
