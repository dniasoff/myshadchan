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
and `current_member_id()` (reused here unchanged) and for `shidduchim` already
being row-scoped to the single's own visible suggestions (this story only
narrows *content within* a row 6.2 already made visible, or denies a table
6.2 left untouched). Precedes **Story 6.4**, which carves one narrow write
exception into this story's default-deny on `interactions` — 6.4 cannot be
built correctly until this story's deny-by-default is in place to be an
exception *to*.

## Acceptance Criteria

1. **`reference_links` and `"references"` deny the `single` role outright —
   zero rows on every command.** These are the diligence surface: candid
   `call_status`/`what_they_said`/`conversation_log` and the reference book
   itself. There is no row within them that is safe to expose regardless of
   the parent suggestion's visibility — deny is content-based, not
   state-based, which is why it belongs here and not in 6.2.

2. **`interactions` denies the `single` role by default on every command.**
   This covers both private parent notes (`kind = 'note'`) and the full
   activity/status-change timeline. A single sees no interaction row of any
   kind through this story — Story 6.4 is what carves the one exception.

3. **`shadchanim` stays readable to a single for non-candid fields, with
   `notes` withheld.** A single may read `name`, `name_he`, `location`,
   `contacts`, `responsiveness` for a shadchan attached to one of their own
   visible suggestions or redt history; `notes` — the family's private
   commentary on that shadchan — is never returned to a `single` caller, at
   the database, regardless of which shadchan row is read.

4. **`shidduchim.close_reason` is withheld from a single even on an otherwise
   fully visible suggestion.** A `look_into`/`yes`/`unsure` suggestion is
   visible per Story 6.2, but its `close_reason` — free-text decision
   rationale that can carry candid content — always reads `NULL` for a
   `single` caller, never the real value.

5. **Medical notes deny the `single` role, and this story owns the negative
   test for it, not Epic 5.** Epic 5 Story 5.5 ships the medical-notes
   surface and RLS *before* the `single` role exists (Epic 5 precedes Epic 6
   in delivery order), so its own negative test can only prove a `helper`
   is denied — it structurally cannot test a role that does not yet exist at
   its own build time. This story re-asserts the exclusion for `single`
   specifically, once the role exists, and extends the medical-notes RLS
   predicate if it is not already role-aware enough to cover `single` (see
   Dev Notes "The Epic 5 sequencing gap").

6. **None of the above is visible through a summary view either.** Any
   `*_summary` view a single can reach (`shidduchim_summary`) redacts
   `close_reason` the same way the base table does; any view whose rows
   derive entirely from a denied base table (`reference_links_summary`,
   `references_summary`) naturally returns zero rows for a single caller
   because the view is `security_invoker = on` — this story adds a test
   proving that behaviour rather than special-casing the view.

7. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   `single` reading `reference_links`/`"references"`/`interactions` gets zero
   rows even when a `parent_admin` in the same account gets non-zero rows in
   the same test run; a `single` reading a visible suggestion's
   `close_reason` and `shadchanim.notes` gets `NULL` in both cases while a
   `parent_admin` reading the same rows gets the real values; a `single`
   reading a medical note gets zero rows.

## Tasks / Subtasks

- [ ] **Task 1 — Deny `reference_links` and `"references"` to `single`** (AC: 1)
  - [ ] Add `and public.current_member_role() <> 'single'` to each table's
        existing "for all" policy's `using`/`with check`. No new policy is
        added for either table — there is no row-subset that is safe, so the
        edit is a pure narrowing of the existing one, not a two-policy split
        like Story 6.2's pattern.

- [ ] **Task 2 — Deny `interactions` to `single` by default** (AC: 2)
  - [ ] Add `and public.current_member_role() <> 'single'` to the existing
        `"Interactions scoped to account and parent visibility"` policy's
        `using`/`with check` (both branches — the `scope = 'account'` and the
        two `scope = 'shidduch'` branches all sit inside the same policy
        today; the added clause wraps the whole expression, not one branch).
  - [ ] Do **not** add a `single`-scoped policy in this story. Story 6.4 adds
        exactly one, narrowly. Leaving the gap open here (rather than
        pre-building it) is what keeps this story's own negative test
        (AC-7) honest: "a single sees zero interactions" must be true at the
        end of *this* story, unconditionally.

- [ ] **Task 3 — `shadchanim`: readable, `notes` redacted** (AC: 3)
  - [ ] The existing `"Shadchanim scoped to account"` policy stays a `for
        all` policy for everyone except `single` (add the same `<> 'single'`
        clause). Add a `SELECT`-only policy for `single`:
        ```sql
        create policy "Shadchanim visible to single" on public.shadchanim
            for select to authenticated
            using (
                account_id = public.current_context_id()
                and public.current_member_role() = 'single'
            );
        ```
        This grants row access to every shadchan in the account (the
        shadchan book itself carries no candid-per-row content once `notes`
        is redacted) — the redaction happens at the column level next.
  - [ ] `notes` cannot be column-redacted by RLS (RLS is row-scoped, not
        column-scoped — see Dev Notes "Why `close_reason`/`notes` redaction
        happens in a view, not a policy"). Update `supabase/schemas/03_views.sql`:
        the shidduchim_summary-equivalent read path the frontend actually
        queries for shadchan display must not select `shadchanim.notes`
        directly when the caller is a single. If Epic 5's Shadchan 360
        (Story 5.9) reads `shadchanim` directly rather than through a
        `*_summary` view, add a **`shadchanim_summary`** view here (mirroring
        the shape of `shidduchim_summary`) that redacts `notes` for the
        `single` role via
        `case when public.current_member_role() = 'single' then null else notes end as notes`
        and point the frontend at it instead. Grep
        `src/components/atomic-crm/shadchanim/` for the actual current read
        path before choosing between "add a redacting view" and "the
        existing read path already goes through a view this story can edit
        in place" — do not build a second view if one already exists.

- [ ] **Task 4 — Redact `shidduchim.close_reason` for `single`** (AC: 4, 6)
  - [ ] `supabase/schemas/03_views.sql`, `shidduchim_summary`: change
        `s.close_reason` to
        `case when public.current_member_role() = 'single' then null else s.close_reason end as close_reason`.
        This is why the view redacts rather than the base table's RLS: RLS
        can only include/exclude whole rows, and a `look_into` suggestion
        with a `close_reason` set must still be *readable* by the single
        (its other 20-odd columns are the dignity floor), just not that one
        field. Column-level `CASE WHEN` inside a `security_invoker` view is
        this schema's existing tool for exactly this (compare
        `get_child_portal()`'s hand-picked column list, pre-dating this
        story, for the same principle applied via a function instead of a
        view).
  - [ ] Confirm no other frontend read path selects `shidduchim.close_reason`
        directly from the base table for a suggestion-detail screen (Epic 5's
        Overview tab, Story 5.2, is expected to read from `shidduchim_summary`
        per AD-10's "list/summary resources route through a `*_summary`
        view" — if it instead reads the base table directly, this redaction
        must be duplicated there, which is a violation of AD-1's "one place"
        principle worth raising rather than silently accepting).

- [ ] **Task 5 — Medical notes: extend RLS + own the single-specific negative test** (AC: 5, 7)
  - [ ] `grep -rniE "medical" supabase/schemas/*.sql` to find Epic 5 Story
        5.5's table/RLS (not present in the schema as of this story's
        writing — nothing to grep yet — but must exist by the time this
        story is picked up, since Epic 5 precedes Epic 6). Read its policy.
  - [ ] If the existing policy already denies by an entitled-role allow-list
        (e.g. `role in ('parent_admin', 'self_manager')`) rather than a
        `single`-specific deny, **no schema change is needed** — `single` is
        already excluded by construction, because it is not in the allow-list.
        Confirm this is the shape before touching anything; do not add a
        redundant `<> 'single'` clause to a policy that already denies by
        allow-list, per DRY.
  - [ ] If instead the existing policy denies by a `<> 'helper'`-style
        exclusion list (deny-list rather than allow-list), add
        `and public.current_member_role() <> 'single'` the same way as
        Task 1 — this is the scenario where Epic 5.5 genuinely could not have
        covered `single` and this story's edit is load-bearing, not just a
        test.
  - [ ] Either way, add the negative test (Task 6) — it is required
        regardless of whether a code change was needed, because Epic 5.5's
        own test suite could not have exercised the `single` role.

- [ ] **Task 6 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_field_scoping`
  - [ ] Confirm the diff is `ALTER POLICY`/`CREATE POLICY`/`CREATE OR REPLACE
        VIEW` only. Re-check `security_invoker = on` and the `anon`/`authenticated`
        grant triplet on any view this story drops-and-recreates (`db diff`
        drops both, per AGENTS.md and the 1.3 story's Dev Notes on the same
        trap).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 7 — Tests** (AC: 7)
  - [ ] New `supabase/tests/single_field_scoping.sql` + `.test.ts`. Arrange:
        one household, one `parent_admin`, one `single` linked to a
        `look_into`+`shared` suggestion that has a shadchan attached
        (`shadchanim.notes` set to a candid string), a `reference_links` row
        with `what_they_said` set, and — once its shape is confirmed in
        Task 5 — one medical note.
  - [ ] Assert (AC-7): as `single`, `select count(*) from public.reference_links`
        / `"references"` / `interactions` = `0`; as `parent_admin` in the
        same account, each is non-zero.
  - [ ] Assert: as `single`, `select close_reason from public.shidduchim_summary
        where id = :shid` is `NULL` even though the row itself is returned
        (the suggestion is visible; the field is not); as `parent_admin`, the
        real value comes back.
  - [ ] Assert: as `single`, the shadchan row is returned by whatever read
        path Task 3 lands on, with `notes` `NULL`; as `parent_admin`, `notes`
        is the real value.
  - [ ] Assert: as `single`, the medical-notes table/view returns zero rows.
  - [ ] Regression: re-run `references_entity.sql`/`shidduch_catch.sql`
        unmodified and green (no `parent_admin`/`helper` behaviour changed).
  - [ ] `make typecheck && npm run lint && npm run test:unit:db` (needs
        `make start`).

## Dev Notes

### Why `close_reason`/`notes` redaction happens in a view, not a policy

Postgres RLS is **row**-scoped: a policy's `USING` clause decides whether a
row is returned at all, never which of its columns come back. A suggestion
that is genuinely visible to a single (state + visibility pass Story 6.2's
policy) must still surface most of its columns — hiding the whole row would
contradict the dignity floor, not protect it. The tool for "this one column,
on an otherwise-visible row, is different per viewer" is a `CASE WHEN` inside
a `security_invoker = on` view, which is why `shidduchim_summary` — already
the frontend's declared read path per AD-10 — is where this story edits, not
`05_policies.sql`. This mirrors, at view granularity, exactly what
`get_child_portal()` already did at hand-picked-column granularity before the
portal was retired (story 1.4) — the same technique, carried into the
permanent, non-token surface this epic replaces it with.

### The Epic 5 sequencing gap this story exists to close

Epic 5 Story 5.5's own acceptance criteria read: *"a negative test proves a
single and a helper cannot read it"* — but Epic 5 is delivered **before**
Epic 6 in the epic list, and the `single` role (plus every function this
story and 6.2 introduce to resolve it) does not exist until Epic 6. Story
5.5 cannot have written a test for a role that is not yet representable in
the schema at its own build time. This is a real inconsistency in the epic
sequencing (flagged in this epic's closing report, not silently absorbed) —
this story's resolution is to treat Epic 5.5's medical-notes RLS as
*probably* already correct (if it denies by allow-list of entitled roles,
`single` was never going to be on that list) but to **never assume it without
checking**, and to own the negative test unconditionally, because "a test
existed for a similar role" is not evidence a test exists for this one.

### Why `reference_links`/`"references"` get a pure narrowing, not a two-policy split

Story 6.2 introduced a "keep the old policy, add a narrow new one" pattern
for tables where *some* subset of rows is safe for a single (their own
visible suggestion's resume, their own `singles` row). `reference_links` and
`"references"` have no such subset — every row is diligence content by
definition (`reference_links`) or the reference book itself
(`"references"`). Adding a second, empty-in-practice policy would be dead
code; narrowing the one policy that exists is the correct, smaller diff.

### What this story does not decide

- **Whether a `helper` should see less than a `parent_admin`** anywhere in
  this schema. Real gap, not this epic's to close (no Epic 6 AC asks for
  it) — flagged in the epic's closing report.
- **The single's own outbound resume, dating history, or redt history** — out
  of scope per Story 6.2's Dev Notes; unchanged here.
- **Which tabs a single's client renders at all** (Overview vs. Diligence vs.
  Notes vs. Activity) — that is Epic 3 Story 3.4's ("permission-aware
  rendering") generic mechanism plus Epic 5's per-descriptor `minVisibility`
  declarations. This story guarantees the *data* is never sent regardless of
  what the client renders (AD-1's actual requirement); it does not touch a
  descriptor or a component. If Epic 3/5's descriptor mechanism exists by the
  time this story is implemented, wiring `single` into each suggestion tab's
  `minVisibility` set is a small, mechanical follow-up in the same PR — grep
  for the descriptor registry (Epic 3 Story 3.3) before assuming it needs to
  be invented here.

### Testing standard

Same shape as Story 6.2 — plain SQL `results`-table suites run via
`npm run test:unit:db`, multi-identity via `set local request.jwt.claims`.
See `supabase/tests/references_entity.sql` for the pattern. AAA structure per
`.claude/rules/testing.md`.

### Project Structure Notes

No new files under `src/`; schema + migration + SQL-test story, same
category as 6.2. Changed files:
- `supabase/schemas/05_policies.sql` (policy edits on `reference_links`,
  `"references"`, `interactions`, `shadchanim`, and the medical-notes table
  from Epic 5.5)
- `supabase/schemas/03_views.sql` (`shidduchim_summary` redaction; possibly a
  new `shadchanim_summary` view — decided by Task 3's grep)
- `supabase/migrations/<timestamp>_single_role_field_scoping.sql`
- `supabase/tests/single_field_scoping.sql`, `.test.ts` (new)

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — "the underlying data was never sent
  to the client," CI-asserted RLS on every table.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — visibility extends to every child
  table (`reference_links`, `interactions`, `resumes`, notes) via
  join-to-parent RLS; this story is where the candid-content half of that
  rule (as opposed to Story 6.2's state-based half) is decided.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — tabs declare a minimum visibility;
  the shell omits what the viewer may not see and the data never reaches the
  client. This story delivers the "data never reaches the client" half.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "gut
  set-asides, candid reference words, private notes and medical notes are
  unreachable at the database, not merely hidden."
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.5] and
  [#Story-6.3] — the cross-epic sequencing tension this story's Task 5 and
  Dev Notes resolve.
- Current schema (translated to post-1.3 names as in Story 6.2):
  `supabase/schemas/01_tables.sql` (`reference_links`, `interactions`
  discriminator columns and their exhaustive check constraints — read before
  editing so the added clause does not disturb the existing
  `interactions_scope_link_check` logic), `supabase/schemas/03_views.sql`
  (`shidduchim_summary`, `reference_links_summary`), `02_functions.sql`
  (`get_child_portal()` — the pre-Epic-1 precedent for hand-picked "safe
  fields only," read for the pattern, not reused — it is deleted by story
  1.4).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
