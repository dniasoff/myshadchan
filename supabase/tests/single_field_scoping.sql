--
-- Field-level scoping for a single (Story 6.3) — database test suite.
--
-- Covers AC 1-8: the four candid tables that deny `single` outright
-- (reference_links, "references", entity_files, shidduchim_external_links),
-- interactions' default deny (AC 2, all three per-command policies —
-- including the 5.9-migrated shadchan-targeted note shape, plus a
-- WHERE-less UPDATE that isolates the UPDATE policy's own guard from the
-- SELECT policy), the shadchanim row-readable/write-denied split plus the
-- shadchan_stats aggregate-leak assertion and a cross-account negative test
-- (AC 3), the shidduchim_summary.close_reason redaction plus an honestly-pinned
-- SCOPE NOTE on the base-table gap that redaction doesn't close (AC 4), the
-- medical_notes unconditional negative test (AC 5), the six storage policies
-- with the two-sided entity-files/resumes/photos SELECT assertion plus
-- INSERT/DELETE guards on entity-files and documents/resumes/ (AC 6), and the
-- summary-view pass-through (AC 7).
--
-- Post-review hardening (see the story's own review-fix pass): the
-- cross-account shadchanim check, the WHERE-less interactions UPDATE check,
-- the entity-files/documents-resumes INSERT+DELETE checks, the AC-4 base-table
-- SCOPE NOTE, and the `select ... into` + `found` rewrite of both
-- shadchan_stats checks (a `select ... from shadchan_stats where id = ...`
-- with no matching row inserts NO result row at all — a vanished check reads
-- as untested, not failed, and the suite stays green regardless).
--
-- Arrange uses the shared "two siblings, one household" fixture
-- (dbSuiteHelpers.ts, siblingHouseholdFixtureSql()) — spliced in by
-- single_field_scoping.test.ts BEFORE this file, exactly like Story 6.2's
-- single_row_scoping.sql — rather than hand-rolling the household/parent/
-- two-singles shape here. This file only adds what is specific to THIS
-- story's assertions: one shidduch visible to Leah (close_reason set, a
-- shadchan attached), one visible to Rivka attached to a SECOND, otherwise
-- unattached shadchan (the shadchan_stats leak fixture), a THIRD, unrelated
-- household account with its own shadchan (the cross-account fixture), one
-- row in each of the six AC-1/AC-2/AC-5 zero-row tables, and four
-- storage.objects rows.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (single_field_scoping.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / single_row_scoping.sql).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Denial assertions name the error they expect — the same helper, and the
-- same reasoning, as single_row_scoping.sql and single_input.sql (see the
-- comment at the head of the former for the demonstration).
--
-- `exception when others then insert into results values (…, true, sqlerrm)`
-- records a PASS for ANY failure, so it cannot tell "the WITH CHECK refused
-- me" from "the table was renamed", "a NOT NULL column was added" or "an
-- unrelated statement earlier in this block threw". Four checks in this file
-- still had that shape, and mutation proved all four vacuous: deleting
-- `current_member_role() <> 'single'` from "Shadchanim scoped to account"'s
-- WITH CHECK — the control the shadchanim check exists to catch — left the
-- suite 59/59 green, because an unrelated failure was raising first and
-- being absorbed. Each denial below now pins the SQLSTATE and the message
-- the control actually produces, so a DIFFERENT failure fails the check
-- instead of passing it.
-- ---------------------------------------------------------------------------
create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_expected_message_like text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate
      and p_actual_message like p_expected_message_like,
    format('sqlstate %s %L (expected %s matching %L)',
           p_actual_sqlstate, p_actual_message,
           p_expected_sqlstate, p_expected_message_like)
  );
end;
$$;

-- Every denial in this file is a row-security violation (42501) on a named
-- relation: `interactions` and `shadchanim` for the two table checks, and
-- `objects` — storage.objects — for the two bucket checks.
create function pg_temp.denied_row_security(
  p_name text, p_relation text, p_actual_sqlstate text, p_actual_message text
) returns void language plpgsql as $$
begin
  perform pg_temp.denied(
    p_name, '42501',
    format('new row violates row-level security policy for table "%s"', p_relation),
    p_actual_sqlstate, p_actual_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (continued from the shared fixture, run as postgres/superuser).
-- ---------------------------------------------------------------------------
insert into ids values
  ('account_id', :'sibling_fixture_account_id'),
  ('parent_member_id', :'sibling_fixture_parent_member_id'),
  ('leah_member_id', :'sibling_fixture_leah_member_id'),
  ('rivka_member_id', :'sibling_fixture_rivka_member_id'),
  ('leah_single_id', :'sibling_fixture_leah_single_id'),
  ('rivka_single_id', :'sibling_fixture_rivka_single_id');

-- Two shadchanim: one attached to Leah's own visible suggestion (the "via
-- {shadchan}" realism AC-3's RecordLink render needs), one attached ONLY to
-- Rivka's visible suggestion — the second is the shadchan_stats leak
-- fixture (AC-3's own Task 3 bullet): a shadchan whose every attributed
-- shidduch is invisible to Leah under 6.2's RLS must show zeroed aggregates
-- to her, never Rivka's real counts.
insert into public.shadchanim (account_id, name)
values (:sibling_fixture_account_id, 'Leah''s Shadchan')
returning id as leah_shadchan_id \gset

insert into public.shadchanim (account_id, name)
values (:sibling_fixture_account_id, 'Stats Leak Shadchan')
returning id as stats_shadchan_id \gset

insert into ids values
  ('leah_shadchan_id', :'leah_shadchan_id'),
  ('stats_shadchan_id', :'stats_shadchan_id');

-- Leah's own visible suggestion: look_into + shared, single-visible per
-- 6.2, close_reason set (candid, AC-4's own target), leah_shadchan_id
-- attached.
insert into public.shidduchim (account_id, single_id, shadchan_id, name_en, visibility, pipeline_state, close_reason)
values (
  :sibling_fixture_account_id, :sibling_fixture_leah_single_id, :leah_shadchan_id,
  'Leah Visible Suggestion', 'shared', 'look_into', 'Candid decision rationale — not for the single''s eyes'
)
returning id as leah_visible_id \gset

-- Rivka's own visible suggestion, attached to the stats-leak shadchan only.
insert into public.shidduchim (account_id, single_id, shadchan_id, name_en, visibility, pipeline_state)
values (
  :sibling_fixture_account_id, :sibling_fixture_rivka_single_id, :stats_shadchan_id,
  'Rivka Visible Suggestion', 'shared', 'look_into'
)
returning id as rivka_visible_id \gset

insert into ids values
  ('leah_visible_id', :'leah_visible_id'),
  ('rivka_visible_id', :'rivka_visible_id');

-- The reference book + one candid reference_links row on Leah's own visible
-- suggestion (AC-1's diligence surface).
insert into public."references" (account_id, name_en)
values (:sibling_fixture_account_id, 'Story 6.3 Reference')
returning id as reference_id \gset

insert into public.reference_links (account_id, reference_id, shidduchim_id, call_status, what_they_said)
values (:sibling_fixture_account_id, :reference_id, :leah_visible_id, 'answered', 'Candid call content — not for the single')
returning id as reference_link_id \gset

insert into ids values
  ('reference_id', :'reference_id'),
  ('reference_link_id', :'reference_link_id');

-- entity_files (Story 3.7) and shidduchim_external_links (Story 5.6) — both
-- diligence uploads/bookmarks, AC-1's other two candid tables.
insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes)
values (
  :sibling_fixture_account_id, 'shidduch', :leah_visible_id,
  :'sibling_fixture_account_id' || '/shidduch/' || :'leah_visible_id' || '/diligence.pdf',
  'diligence.pdf', 'application/pdf', 1024
)
returning id as entity_file_id \gset

insert into public.shidduchim_external_links (account_id, shidduchim_id, url, label)
values (:sibling_fixture_account_id, :leah_visible_id, 'https://example.test/some-diligence-link', 'Some link')
returning id as external_link_id \gset

insert into ids values
  ('entity_file_id', :'entity_file_id'),
  ('external_link_id', :'external_link_id');

-- interactions: the 5.9-migrated shadchan-commentary shape (target_type =
-- 'shadchan', scope = 'account', kind = 'note') AND a plain shidduch-scoped
-- note — AC-2 must deny BOTH.
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:sibling_fixture_account_id, 'shadchan', :leah_shadchan_id, 'account', 'note', 'Candid shadchan commentary')
returning id as shadchan_note_id \gset

insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:sibling_fixture_account_id, 'shidduch', :leah_visible_id, 'shidduch', 'note', 'Candid parent note on Leah''s own visible suggestion')
returning id as shidduch_note_id \gset

-- Review should-fix #4's own falsifiable: a `status_change`-kind row (the
-- other half of AC-2's "full activity/status-change timeline"), deliberately
-- NOT kind = 'note'/'single_input'. Both rows above are kind = 'note', so
-- `"Interactions updatable by author or owning role"`'s trailing
-- `(kind not in ('note', 'single_input') or can_moderate_note(actor_member_id))`
-- clause blocks Leah from either of them regardless of the policy's own
-- `current_member_role() <> 'single'` guard (she authored neither and holds
-- no owning role) — a no-WHERE UPDATE against ONLY those two rows would
-- therefore stay green even with that guard deleted, proving nothing. This
-- row's kind bypasses that secondary clause entirely, so the guard is the
-- only thing standing between Leah and updating it (confirmed live: guard
-- removed -> this row updates, guard present -> it does not).
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:sibling_fixture_account_id, 'shidduch', :leah_visible_id, 'shidduch', 'status_change', 'Status changed on Leah''s own visible suggestion')
returning id as shidduch_status_change_id \gset

insert into ids values
  ('shadchan_note_id', :'shadchan_note_id'),
  ('shidduch_note_id', :'shidduch_note_id'),
  ('shidduch_status_change_id', :'shidduch_status_change_id');

-- Arrange control (anti-vacuity) for every "single sees zero interactions"
-- check below. A denial assertion is green whenever its subject does not
-- exist: if these three rows silently failed to insert, `count(*) = 0` as
-- Leah would pass while proving nothing at all. Asserted here, as postgres,
-- where the rows are unconditionally visible — the parent-side counterpart
-- further down (`AC8: parent_admin sees non-zero rows in interactions`) is
-- the same guard from the other side, but it sits ~300 lines away and is
-- itself subject to the parent's RLS, so it cannot stand in for this.
insert into results (name, passed, detail)
select
  'Arrange control (every "single sees zero interactions" check is vacuous without it): all three fixture interaction rows exist',
  count(*) = 3,
  format('rows=%s kinds=%s', count(*), string_agg(kind, ',' order by kind))
from public.interactions
where id in (
  :'shadchan_note_id'::bigint,
  :'shidduch_note_id'::bigint,
  :'shidduch_status_change_id'::bigint
);

-- medical_notes (Story 5.5) — AC-5's unconditional negative test.
insert into public.medical_notes (account_id, shidduchim_id, body)
values (:sibling_fixture_account_id, :leah_visible_id, 'Candid medical content')
returning id as medical_note_id \gset

insert into ids values ('medical_note_id', :'medical_note_id');

-- Cross-account negative test fixture (review blocker #2): a SECOND,
-- unrelated household account with its own shadchan row. AC-3's "whole
-- book" grant on "Shadchanim visible to single" is deliberately
-- account-scoped (`account_id = current_context_id()`), never global — this
-- is the falsifiable proof that guard is load-bearing, not merely present.
insert into public.accounts (name, kind)
values ('Story 6.3 Foreign Household', 'household')
returning id as foreign_account_id \gset

insert into public.shadchanim (account_id, name)
values (:foreign_account_id, 'Foreign Household Shadchan')
returning id as foreign_shadchan_id \gset

insert into ids values
  ('foreign_account_id', :'foreign_account_id'),
  ('foreign_shadchan_id', :'foreign_shadchan_id');

-- Four storage.objects rows, inserted directly as postgres (AC-6/AC-8): one
-- entity-files object, one documents/resumes object, one documents/photos/
-- shared object and one documents/photos/private_parent object — all under
-- Leah's own visible suggestion's folder. `owner` is a uuid (the parent's
-- auth.users id, `dbSuiteHelpers.ts`'s `SIBLING_FIXTURE.parentUserId`
-- literal) — storage policies here key off the object's PATH, never
-- `owner`, so any valid uuid works; this one just reads clearly in a failed
-- assertion's `detail` column, same reasoning as documents_storage.sql /
-- entity_files.sql's own fixtures.
insert into storage.objects (bucket_id, name, owner)
values (
  'entity-files',
  :'sibling_fixture_account_id' || '/shidduch/' || :'leah_visible_id' || '/diligence.pdf',
  '51810000-0000-0000-0000-000000000001'
)
returning id as entity_files_object_id \gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'sibling_fixture_account_id' || '/resumes/' || :'leah_visible_id' || '/resume.pdf',
  '51810000-0000-0000-0000-000000000001'
)
returning id as resumes_object_id \gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'sibling_fixture_account_id' || '/photos/shared/' || :'leah_visible_id' || '/shared.jpg',
  '51810000-0000-0000-0000-000000000001'
)
returning id as shared_photo_object_id \gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'sibling_fixture_account_id' || '/photos/private_parent/' || :'leah_visible_id' || '/private.jpg',
  '51810000-0000-0000-0000-000000000001'
)
returning id as private_photo_object_id \gset

insert into ids values
  ('entity_files_object_id', :'entity_files_object_id'),
  ('resumes_object_id', :'resumes_object_id'),
  ('shared_photo_object_id', :'shared_photo_object_id'),
  ('private_photo_object_id', :'private_photo_object_id');

-- ---------------------------------------------------------------------------
-- AC 1 / AC 8: the four candid tables deny `single` outright — zero rows on
-- every command — while a `parent_admin` in the same account gets non-zero.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC1/AC8: single sees zero rows in "references"', (select count(*) from public."references") = 0;

insert into results (name, passed)
select 'AC1/AC8: single sees zero rows in reference_links', (select count(*) from public.reference_links) = 0;

insert into results (name, passed)
select 'AC1/AC8: single sees zero rows in entity_files', (select count(*) from public.entity_files) = 0;

insert into results (name, passed)
select 'AC1/AC8: single sees zero rows in shidduchim_external_links', (select count(*) from public.shidduchim_external_links) = 0;

-- AC-1: no row-subset is safe, so a plain UPDATE/DELETE attempt (not merely
-- SELECT) is also denied. Proven once, on "references" — the same `for all`
-- shape governs all four.
do $$
declare v_rows_affected int;
begin
  update public."references" set name_en = 'Tampered By Single';
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC1: single''s UPDATE on "references" affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

insert into results (name, passed)
select 'AC5: single sees zero rows in medical_notes (unconditional negative test)',
       (select count(*) from public.medical_notes) = 0;

-- ---------------------------------------------------------------------------
-- AC 2 / AC 8: interactions denies `single` by default on every command,
-- through every one of the three per-command policies — including the
-- 5.9-migrated shadchan-targeted note.
-- ---------------------------------------------------------------------------
-- Deliberately positioned BEFORE the carve-out INSERT below: at this point
-- the single has written nothing, so the only interaction rows in existence
-- are the parent's three, and the claim really is "zero, of anything". The
-- post-carve-out counterpart — "only her own single_input row, nothing
-- else" — is asserted immediately after (iii). Keep this ordering: moving
-- this check below the INSERT silently turns it into the weaker claim.
insert into results (name, passed)
select 'AC2/AC8: single sees zero rows in interactions before she has written any input (shadchan-targeted note + shidduch-scoped note + status_change row all denied)',
       (select count(*) from public.interactions) = 0;

-- ---------------------------------------------------------------------------
-- AC 2 (amended by Story 6.4's adjudication) — the INSERT half.
--
-- This check used to read: "a single's INSERT into interactions is denied",
-- exercised with kind = 'single_input' on Leah's own visible suggestion.
-- That was over-broad as written. Story 6.4 opens exactly one hole in this
-- story's default deny — a `single` may add kind = 'single_input' on a
-- suggestion they can already see — and that hole is not an erosion of the
-- privacy model, it IS the model: the dignity floor is un-lowerable by
-- AD-3 ("the single always sees their live prospects and can give input")
-- and by FR93, and FR66 spells out the same capability. Story 6.3's own
-- text anticipated it twice — AC-2 says "Story 6.4 is what carves the one
-- exception", and Task 2 says "a single sees zero interactions must be true
-- at the end of THIS story". Those are statements about a moment in the
-- delivery order (6.6 -> 6.2 -> 6.3 -> 6.4 -> 6.1 -> 6.5), but a regression
-- suite asserts for all time, and the row this check used was exactly the
-- shape 6.4's carve-out opens.
--
-- So the blanket claim is kept for every kind it is still true of, and the
-- one exception is covered positively rather than deleted. Deleting it
-- would have thrown away a real guard: `interactions` is where private
-- parent notes, the activity timeline and the 5.9-migrated candid shadchan
-- commentary live, and a single must reach none of it.
-- ---------------------------------------------------------------------------

-- (i) The blanket deny, for every kind EXCEPT the carve-out. One results
-- row, but the detail names any kind that leaked, so a loosened policy
-- still identifies itself.
do $$
declare
  v_kind text;
  v_leaked text[] := '{}';
begin
  foreach v_kind in array array['note', 'call_logged', 'status_change', 'merge', 'link_created', 'link_removed']
  loop
    begin
      insert into public.interactions (target_type, target_id, scope, kind, body)
      values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', v_kind, 'a single trying to write ' || v_kind);
      v_leaked := v_leaked || v_kind;
    exception when others then
      null; -- denied, as required
    end;
  end loop;

  insert into results values (
    'AC2: single''s INSERT into interactions is denied for EVERY kind except single_input (note/call_logged/status_change/merge/link_created/link_removed), even on her own visible suggestion',
    cardinality(v_leaked) = 0,
    format('kinds that unexpectedly inserted: %s', coalesce(array_to_string(v_leaked, ','), 'none'))
  );
end $$;

-- (ii) The carve-out is NARROW: single_input is denied on a suggestion the
-- single cannot see. Without this, (iii) below could pass under a policy
-- that let a single write input on anyone's suggestion — which would leak
-- the sibling's suggestion id as a side channel and break AC-1 of 6.4.
--
-- Which clause is load-bearing here, established by mutation rather than by
-- reading: the guard is the policy's whole `exists (select 1 from
-- shidduchim s join singles c ...)` subquery, NOT its trailing
-- `c.member_id = public.current_member_id()` conjunct. Deleting only that
-- conjunct leaves this check GREEN, because the subquery is evaluated under
-- the caller's own RLS and Story 6.2 already hides a sibling's shidduchim
-- row from her — so the EXISTS is false either way. The conjunct is
-- defence-in-depth (it would matter if 6.2's row policy were ever
-- loosened), not the thing that denies this insert today. Mutate the whole
-- EXISTS away and this check goes red; mutate only the conjunct and it does
-- not. Do not "simplify" the policy on the strength of this check alone.
do $$
declare
  v_name constant text := 'AC2/6.4-AC1: the single_input carve-out is NARROW — a single''s INSERT on a SIBLING''s suggestion is still denied by row-level security on public.interactions';
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'rivka_visible_id'), 'shidduch', 'single_input', 'Leah writing on Rivka''s suggestion');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, 'interactions', sqlstate, sqlerrm);
end $$;

-- (iii) The carve-out WORKS — the positive half. This is the dignity floor
-- (AD-3 / FR93 / FR66) expressed as a test: if this goes red, the single
-- can no longer give input and Story 6.4's central feature does not exist.
-- Asserts the row landed AND that the attribution trigger stamped Leah's
-- own membership id (never client-supplied), so a row that inserted with a
-- null or foreign actor cannot pass.
do $$
declare
  v_id bigint;
  v_actor bigint;
  v_expected bigint;
begin
  v_expected := public.current_member_id();
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'single_input', 'Leah''s own input on her own visible suggestion')
  returning id, actor_member_id into v_id, v_actor;
  insert into ids values ('leah_input_id', v_id::text);

  insert into results values (
    'AC2/6.4-AC1 (dignity floor, AD-3/FR93/FR66): a single MAY insert kind = ''single_input'' on her OWN visible suggestion, attributed to her by the server-set trigger',
    v_id is not null and v_actor is not null and v_actor = v_expected,
    format('id=%s actor_member_id=%s expected=%s', v_id, v_actor, v_expected)
  );
exception when others then
  insert into results values (
    'AC2/6.4-AC1 (dignity floor, AD-3/FR93/FR66): a single MAY insert kind = ''single_input'' on her OWN visible suggestion, attributed to her by the server-set trigger',
    false, sqlerrm
  );
end $$;

-- (iv) The post-carve-out read claim, the exact replacement for the old
-- blanket "zero rows in interactions". The single now sees EXACTLY one row
-- — her own input — and nothing else: not the parent's note, not the
-- shadchan-targeted note (the 5.9-migrated candid commentary), not the
-- status_change timeline row. Asserted as a set, not a count, so a policy
-- that leaked a note while she happened to have one input row cannot pass.
do $$
declare
  v_total int;
  v_own int;
  v_foreign_kinds text;
begin
  select count(*) into v_total from public.interactions;
  select count(*) into v_own
  from public.interactions
  where kind = 'single_input' and actor_member_id = public.current_member_id();
  select string_agg(distinct kind, ',') into v_foreign_kinds
  from public.interactions
  where not (kind = 'single_input' and actor_member_id = public.current_member_id());

  insert into results values (
    'AC2/AC8 (amended by 6.4): after giving input, a single sees ONLY her own single_input row in interactions — zero rows of every other kind, and none of another member''s',
    v_total = 1 and v_own = 1 and v_foreign_kinds is null,
    format('total=%s own_single_input=%s leaked_kinds=%s', v_total, v_own, coalesce(v_foreign_kinds, 'none'))
  );
end $$;

do $$
declare v_rows_affected int;
begin
  update public.interactions set body = 'Tampered By Single' where id = (select value::bigint from ids where name = 'shidduch_note_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC2: single''s UPDATE on interactions affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- Review should-fix #4: the WHERE id = ... shape above targets
-- shidduch_note_id, a kind = 'note' row — that row is ALSO blocked by the
-- trailing `(kind not in ('note','single_input') or
-- can_moderate_note(actor_member_id))` clause regardless of whether the
-- policy's OWN `current_member_role() <> 'single'` guard is present (Leah
-- authored neither note and holds no owning role), so it cannot, by itself,
-- prove that guard is load-bearing. Confirmed live: deleting just that guard
-- from the policy still leaves the WHERE-qualified check at rows=0, for
-- exactly that reason. A WHERE-less UPDATE against the WHOLE table also
-- reaches shidduch_status_change_id (kind = 'status_change', fixture above)
-- — a kind the can_moderate_note clause never applies to — which is why that
-- row exists: it is the one row in this fixture the guard is the ONLY thing
-- protecting. Confirmed live: guard present -> 0 rows; guard deleted -> 1
-- row (this exact row flips).
do $$
declare v_rows_affected int;
begin
  update public.interactions set body = 'Tampered By Single (no WHERE clause)';
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC2 (review should-fix): single''s UPDATE on interactions with NO WHERE clause affects zero rows (reaches the status_change row the can_moderate_note clause does not gate, isolating the UPDATE policy''s own guard)',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 3: shadchanim — row-readable, write-denied, whole book (not just own
-- suggestion's shadchan).
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC3: single reads the WHOLE shadchan book (both rows), not just her own suggestion''s shadchan',
       (select count(*) from public.shadchanim) = 2;

insert into results (name, passed)
select 'AC3: single reads leah_shadchan_id by name',
       exists (select 1 from public.shadchanim where id = (select value::bigint from ids where name = 'leah_shadchan_id') and name = 'Leah''s Shadchan');

insert into results (name, passed)
select 'AC3/cross-account (review blocker #2): single does NOT see a shadchan belonging to a DIFFERENT, unrelated household account',
       not exists (select 1 from public.shadchanim where id = (select value::bigint from ids where name = 'foreign_shadchan_id'));

do $$
declare v_rows_affected int;
begin
  update public.shadchanim set name = 'Tampered By Single';
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC3: single''s UPDATE on shadchanim affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_name constant text := 'AC3: single''s INSERT into shadchanim is denied by row-level security on public.shadchanim';
begin
  insert into public.shadchanim (name) values ('Single''s Own Shadchan');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, 'shadchanim', sqlstate, sqlerrm);
end $$;

-- shadchan_stats aggregate-leak assertion: the stats shadchan is attributed
-- ONLY to Rivka's visible suggestion, which is denied to Leah under 6.2's
-- RLS — the aggregate must show zeroes, never Rivka's real counts.
--
-- Review should-fix #5 (vanishing-assertion defect): the naive
-- `insert into results (...) select ... from public.shadchan_stats where
-- id = ...` shape inserts NO row at all if the view returns no row for that
-- id (e.g. if "Shadchanim visible to single" itself were ever dropped,
-- making the shadchan row — and hence its shadchan_stats row, driven by a
-- LEFT JOIN off shadchanim — invisible). That reads as the check having
-- vanished, not failed, and the suite still reports green. `select ... into`
-- + `found` makes an absent row an explicit, named failure instead.
do $$
declare
  v_nb_suggestions int;
  v_nb_progressed int;
  v_nb_reached_yes int;
  v_last_redt_date date;
  v_nb_open_singles int;
  v_found boolean;
begin
  select nb_suggestions, nb_progressed, nb_reached_yes, last_redt_date, nb_open_singles
    into v_nb_suggestions, v_nb_progressed, v_nb_reached_yes, v_last_redt_date, v_nb_open_singles
  from public.shadchan_stats
  where id = (select value::bigint from ids where name = 'stats_shadchan_id');
  v_found := found;

  insert into results values (
    'AC3: shadchan_stats shows ZEROED aggregates to single for a shadchan attributed only to a sibling''s suggestion (not a leak)',
    v_found and v_nb_suggestions = 0 and v_nb_progressed = 0 and v_nb_reached_yes = 0 and v_last_redt_date is null and v_nb_open_singles = 0,
    format('found=%s nb_suggestions=%s nb_progressed=%s nb_reached_yes=%s last_redt_date=%s nb_open_singles=%s',
           v_found, v_nb_suggestions, v_nb_progressed, v_nb_reached_yes, v_last_redt_date, v_nb_open_singles)
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 4 / AC 7: shidduchim_summary.close_reason is redacted for single, even
-- on Leah's own, otherwise fully visible suggestion.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC4/AC7: single reads NULL close_reason on her own otherwise-visible suggestion',
       (select close_reason from public.shidduchim_summary where id = (select value::bigint from ids where name = 'leah_visible_id')) is null;

insert into results (name, passed)
select 'AC4/AC7: single still reads every OTHER column of her own otherwise-visible suggestion (the row itself is not hidden)',
       (select name_en from public.shidduchim_summary where id = (select value::bigint from ids where name = 'leah_visible_id')) = 'Leah Visible Suggestion';

-- AC 4, CLOSED AT THE BASE TABLE. This assertion used to be a SCOPE NOTE
-- pinning the opposite outcome: a `single` selecting close_reason DIRECTLY
-- off public.shidduchim (`GET /rest/v1/shidduchim?select=id,close_reason`
-- over PostgREST — base tables are exposed too) got the real candid text,
-- because the redaction was only a CASE inside shidduchim_summary. A
-- client-filtered field still present in the API response is not a control,
-- and a test that asserts the leak defends it. It is flipped here.
--
-- What closes it is a COLUMN privilege, not a policy: RLS decides whether a
-- ROW comes back, never which COLUMNS do. `authenticated` — the one Postgres
-- role every member logs in as, whatever their account_members.role — is now
-- granted SELECT on public.shidduchim column by column WITHOUT close_reason
-- (06_grants.sql), so the column is unreadable through EVERY path: no member
-- role, no view, no `select *`. The legitimate readers go through
-- public.shidduch_close_reason(), the SECURITY DEFINER accessor whose guard
-- mirrors the "Shidduchim scoped to account" policy.
--
-- The consequence is a DENIAL (SQLSTATE 42501 / PostgREST error), not a NULL:
-- Postgres refuses the query rather than blanking the column. That is the
-- honest shape of a column privilege, and the assertion says so precisely —
-- an `is null` here would silently pass again the day someone re-granted
-- table-level SELECT and the CASE came back.
do $$
declare v_leak text;
begin
  select close_reason into v_leak
  from public.shidduchim
  where id = (select value::bigint from ids where name = 'leah_visible_id');

  insert into results values (
    'AC4: single selecting close_reason DIRECTLY off the base table public.shidduchim is REFUSED by the column privilege (this check asserted the leak before; it now proves the redaction)',
    false, 'no error raised — the column was readable and returned: ' || coalesce(v_leak, '<null>')
  );
exception when insufficient_privilege then
  insert into results values (
    'AC4: single selecting close_reason DIRECTLY off the base table public.shidduchim is REFUSED by the column privilege (this check asserted the leak before; it now proves the redaction)',
    true, sqlstate || ' ' || sqlerrm
  );
end $$;

-- The same denial reached the other way round: `select *` (PostgREST's own
-- default representation) needs SELECT on EVERY column, so it is refused too.
-- Pinned deliberately — it is the blast radius of the fix, and the reason the
-- client's shidduchim reads all go through shidduchim_summary.
do $$
begin
  perform * from public.shidduchim
  where id = (select value::bigint from ids where name = 'leah_visible_id');

  insert into results values (
    'AC4: `select *` on the base table public.shidduchim is refused for a single (no column-complete read survives the grant)',
    false, 'no error raised'
  );
exception when insufficient_privilege then
  insert into results values (
    'AC4: `select *` on the base table public.shidduchim is refused for a single (no column-complete read survives the grant)',
    true, sqlstate || ' ' || sqlerrm
  );
end $$;

-- transition_shidduch() lost its `returning *` in the same change (that clause
-- would need SELECT on close_reason); it re-reads the moved row through
-- shidduch_row() instead. Asserted here on the one row a single CAN see and
-- must not be able to move.
--
-- What this proves, precisely: the single's call is refused and the state is
-- unchanged. It does NOT exercise the function's own `if not found then
-- return` guard — verified empirically, and worth writing down rather than
-- implying: `select pipeline_state ... for update` applies the UPDATE policy's
-- `using` clause as well as the SELECT policies, so a single's call is already
-- refused by the function's `shidduch % not found` raise several statements
-- BEFORE the UPDATE. That guard is contract preservation (the old `returning
-- *` returned zero rows when RLS refused the write; a naive re-read would have
-- handed back a row that looks like it moved), not a live path, and no
-- black-box probe through this RPC can reach it while the lock is refused
-- first. The falsifiable half is the state: if RLS ever let a single move a
-- suggestion, `state_after` flips to `yes` and this fails by name.
do $$
declare
  v_id bigint;
  v_moved boolean;
  v_detail text;
  v_state text;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';

  begin
    perform * from public.transition_shidduch(v_id, 'look_into', 'yes', 'Single-forced decision');
    v_moved := true;
    v_detail := 'call returned without error';
  exception when others then
    v_moved := false;
    v_detail := sqlstate || ' ' || sqlerrm;
  end;

  select pipeline_state::text into v_state from public.shidduchim where id = v_id;

  insert into results values (
    'AC4: a single''s transition_shidduch() call is refused and the suggestion does not move (the shidduch_row() re-read papers over nothing)',
    not v_moved and v_state = 'look_into',
    format('refusal=%s state_after=%s', v_detail, v_state)
  );
end $$;

-- The accessor itself, probed directly the way PostgREST would expose it
-- (`POST /rest/v1/rpc/shidduch_close_reason`). It is SECURITY DEFINER, so it
-- CAN read the column — and it must still answer NULL to a single. This is
-- the check that would catch a future edit dropping the role conjunct from
-- its guard, which no view-level assertion can see.
insert into results (name, passed)
select 'AC4: public.shidduch_close_reason() answers NULL to a single even called directly as an RPC (the SECURITY DEFINER accessor guards itself)',
       public.shidduch_close_reason((select value::bigint from ids where name = 'leah_visible_id')) is null;

-- Every other column of the base table is still readable — the grant narrows
-- exactly one column, it does not lock a single out of the row they may see.
insert into results (name, passed)
select 'AC4: single still reads the non-candid columns off the base table (the grant narrows one column, not the row)',
       (select name_en from public.shidduchim where id = (select value::bigint from ids where name = 'leah_visible_id'))
         = 'Leah Visible Suggestion';

-- ---------------------------------------------------------------------------
-- AC 7: the summary views pass RLS through unchanged — zero rows for single.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC7: single sees zero rows in references_summary', (select count(*) from public.references_summary) = 0;

insert into results (name, passed)
select 'AC7: single sees zero rows in reference_links_summary', (select count(*) from public.reference_links_summary) = 0;

-- AC 7 (amended by Story 6.4's adjudication), same reasoning as AC-2's
-- INSERT half above: interactions_summary is `security_invoker = on`, so it
-- carries base-table RLS through verbatim — including the carve-out. The
-- blanket "zero rows" claim is therefore false for exactly one row and
-- true for every other, and is re-authored to say precisely that rather
-- than being deleted. The view must not widen what the base table grants
-- (a view that returned MORE than the base table would be the actual leak
-- this check exists to catch), so it is asserted against the same set.
do $$
declare
  v_total int;
  v_own int;
  v_foreign_kinds text;
begin
  select count(*) into v_total from public.interactions_summary;
  select count(*) into v_own
  from public.interactions_summary
  where kind = 'single_input' and actor_member_id = public.current_member_id();
  select string_agg(distinct kind, ',') into v_foreign_kinds
  from public.interactions_summary
  where not (kind = 'single_input' and actor_member_id = public.current_member_id());

  insert into results values (
    'AC7 (amended by 6.4): interactions_summary shows a single ONLY her own single_input row — the security_invoker view widens nothing beyond the base table',
    v_total = 1 and v_own = 1 and v_foreign_kinds is null,
    format('total=%s own_single_input=%s leaked_kinds=%s', v_total, v_own, coalesce(v_foreign_kinds, 'none'))
  );
end $$;

insert into results (name, passed)
select 'AC7: single sees zero rows in entity_files_summary', (select count(*) from public.entity_files_summary) = 0;

-- ---------------------------------------------------------------------------
-- AC 6 / AC 8: storage — two-sided. Zero rows for entity-files and
-- documents/resumes/, zero for photos/private_parent/, but exactly ONE row
-- for photos/shared/ (Story 5.4's dignity floor, untouched by this story).
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC6/AC8: single sees zero storage.objects rows for bucket_id = ''entity-files''',
       (select count(*) from storage.objects where bucket_id = 'entity-files') = 0;

insert into results (name, passed)
select 'AC6/AC8: single sees zero storage.objects rows under documents/resumes/',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'resumes') = 0;

insert into results (name, passed)
select 'AC6/AC8: single sees zero storage.objects rows under documents/photos/private_parent/',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos' and (storage.foldername(name))[3] = 'private_parent') = 0;

insert into results (name, passed)
select 'AC6/AC8 positive control: single STILL sees exactly one storage.objects row under documents/photos/shared/ (Story 5.4''s dignity floor, untouched)',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos' and (storage.foldername(name))[3] = 'shared') = 1;

-- ---------------------------------------------------------------------------
-- AC 6 / AC 8 (review should-fix #4): the entity-files and
-- documents/resumes/ INSERT and DELETE guards were previously exercised only
-- via the SELECT checks above — a loosened INSERT or DELETE guard on either
-- prefix stayed unproven. A single must not be able to plant a new object in
-- either prefix, nor delete an existing one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'AC6/AC8 (review should-fix): single''s INSERT into entity-files storage is denied by row-level security on storage.objects';
begin
  insert into storage.objects (bucket_id, name, owner)
  values (
    'entity-files',
    (select value from ids where name = 'account_id') || '/shidduch/' ||
      (select value from ids where name = 'leah_visible_id') || '/planted-by-single.pdf',
    '51810000-0000-0000-0000-000000000002'
  );
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, 'objects', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC6/AC8 (review should-fix): single''s INSERT into documents/resumes/ storage is denied by row-level security on storage.objects';
begin
  insert into storage.objects (bucket_id, name, owner)
  values (
    'documents',
    (select value from ids where name = 'account_id') || '/resumes/' ||
      (select value from ids where name = 'leah_visible_id') || '/planted-by-single.pdf',
    '51810000-0000-0000-0000-000000000002'
  );
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, 'objects', sqlstate, sqlerrm);
end $$;

-- DELETE, with storage.allow_delete_query set so the statement-level guard
-- (storage.protect_delete()) is not what denies it — an RLS denial, not a
-- locked door with no key (same pattern as entity_files.sql /
-- documents_storage.sql's own DELETE checks).
--
-- Verified live, mutation-tested (matching the review's own method): with
-- ONLY "Entity files deletable within account"'s (or "Documents resumes
-- deletable within account"'s) own `current_member_role() <> 'single'`
-- clause removed — the corresponding readable policy left untouched — this
-- DELETE still affects zero rows, because PostgreSQL requires a row to be
-- visible under an applicable SELECT policy before UPDATE/DELETE can target
-- it at all (the same coupling the interactions UPDATE comment above
-- documents); "Entity files readable within account" denies `single` the
-- row regardless of what the deletable policy's own clause says. The
-- deletable policy's clause is therefore NOT independently provable via a
-- black-box SQL probe as long as its sibling SELECT policy carries the same
-- guard — confirmed by additionally removing BOTH clauses together, which
-- DOES flip this check red. What this check genuinely proves: the object is
-- not reachable for deletion through the CURRENT combination of policies
-- (readable AND deletable), which is the property that actually matters —
-- it is not a claim that the deletable policy's clause is individually
-- load-bearing in isolation.
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = (select value::uuid from ids where name = 'entity_files_object_id');
delete from storage.objects where id = (select value::uuid from ids where name = 'resumes_object_id');

reset role;

insert into results (name, passed)
select 'AC6/AC8 (review should-fix): single''s DELETE attempt on the entity-files object left it intact (RLS denial, not the statement guard)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'entity_files_object_id');

insert into results (name, passed)
select 'AC6/AC8 (review should-fix): single''s DELETE attempt on the documents/resumes/ object left it intact (RLS denial, not the statement guard)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'resumes_object_id');

-- Grant-completeness, read straight out of the catalog (run as postgres —
-- has_column_privilege() for another role needs it). Because close_reason is
-- withheld by ENUMERATING the other columns rather than by subtracting one
-- (Postgres has no "all columns except" grant, and a column-level REVOKE
-- against a role holding table-level SELECT is a silent no-op), a column added
-- to public.shidduchim without a matching line in 06_grants.sql is simply
-- unreadable — every list that names it would 403. This check is what turns
-- that into a named test failure instead of a production incident, and it is
-- two-sided: it also fails if someone re-grants close_reason.
do $$
declare v_missing text; v_leaked boolean;
begin
  select string_agg(a.attname, ', ' order by a.attnum) into v_missing
  from pg_attribute a
  where a.attrelid = 'public.shidduchim'::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname <> 'close_reason'
    and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT');

  v_leaked := has_column_privilege('authenticated', 'public.shidduchim'::regclass, 'close_reason', 'SELECT');

  insert into results values (
    'AC4: the column grant on public.shidduchim covers every column EXCEPT close_reason — a column added without a grant, or close_reason re-granted, fails here',
    v_missing is null and not v_leaked,
    format('ungranted=%s close_reason_readable=%s', coalesce(v_missing, 'none'), v_leaked)
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Re-asserted as parent_admin, in the same test run: every table above is
-- non-zero and shows the REAL close_reason value — the denial above is
-- `single`-specific, not a regression on everyone else (AC-8's own shape).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in "references"', (select count(*) from public."references") > 0;

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in reference_links', (select count(*) from public.reference_links) > 0;

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in entity_files', (select count(*) from public.entity_files) > 0;

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in shidduchim_external_links', (select count(*) from public.shidduchim_external_links) > 0;

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in medical_notes', (select count(*) from public.medical_notes) > 0;

insert into results (name, passed)
select 'AC8: parent_admin sees non-zero rows in interactions (the shadchan-note, the shidduch-note and the status_change row)',
       (select count(*) from public.interactions) >= 3;

insert into results (name, passed)
select 'AC4/AC8: parent_admin reads the REAL close_reason on the same suggestion',
       (select close_reason from public.shidduchim_summary where id = (select value::bigint from ids where name = 'leah_visible_id'))
         = 'Candid decision rationale — not for the single''s eyes';

-- The other half of the column-privilege fix, and the reason it needed a
-- SECURITY DEFINER accessor rather than a bare REVOKE: the grant is role-BLIND
-- (parent_admin and single are the same Postgres role), so a parent_admin is
-- refused the base-table column exactly as hard as a single is. What restores
-- the legitimate read is shidduch_close_reason(), asserted here directly so a
-- regression that made the accessor return NULL for everyone — a "fix" that
-- silently blanks the Right Rail for the people who need it — fails by name
-- instead of passing as "redacted".
do $$
begin
  perform close_reason from public.shidduchim
  where id = (select value::bigint from ids where name = 'leah_visible_id');

  insert into results values (
    'AC4/AC8: parent_admin is ALSO refused close_reason off the base table — the column privilege is role-blind, the accessor is the only read path',
    false, 'no error raised — the column was readable'
  );
exception when insufficient_privilege then
  insert into results values (
    'AC4/AC8: parent_admin is ALSO refused close_reason off the base table — the column privilege is role-blind, the accessor is the only read path',
    true, sqlstate || ' ' || sqlerrm
  );
end $$;

insert into results (name, passed)
select 'AC4/AC8: public.shidduch_close_reason() hands the REAL value to a parent_admin (the redaction did not become a blackout)',
       public.shidduch_close_reason((select value::bigint from ids where name = 'leah_visible_id'))
         = 'Candid decision rationale — not for the single''s eyes';

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in references_summary', (select count(*) from public.references_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in reference_links_summary', (select count(*) from public.reference_links_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in interactions_summary', (select count(*) from public.interactions_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in entity_files_summary', (select count(*) from public.entity_files_summary) > 0;

-- Review should-fix #5, parent side: same `select ... into` + `found` shape
-- as the single-side check above, so a missing row fails this assertion by
-- name instead of silently not inserting one.
do $$
declare
  v_nb_suggestions int;
  v_found boolean;
begin
  select nb_suggestions into v_nb_suggestions
  from public.shadchan_stats
  where id = (select value::bigint from ids where name = 'stats_shadchan_id');
  v_found := found;

  insert into results values (
    'AC3/AC8: parent_admin sees the REAL, non-zero shadchan_stats aggregate for the leak-test shadchan',
    v_found and v_nb_suggestions > 0,
    format('found=%s nb_suggestions=%s', v_found, v_nb_suggestions)
  );
end $$;

insert into results (name, passed)
select 'AC6/AC8: parent_admin sees the entity-files object', (select count(*) from storage.objects where bucket_id = 'entity-files') = 1;

insert into results (name, passed)
select 'AC6/AC8: parent_admin sees the documents/resumes/ object',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'resumes') = 1;

insert into results (name, passed)
select 'AC6/AC8: parent_admin sees the documents/photos/private_parent/ object',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos' and (storage.foldername(name))[3] = 'private_parent') = 1;

insert into results (name, passed)
select 'AC6/AC8: parent_admin sees the documents/photos/shared/ object',
       (select count(*) from storage.objects
        where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos' and (storage.foldername(name))[3] = 'shared') = 1;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
