--
-- Field-level scoping for a single (Story 6.3) — database test suite.
--
-- Covers AC 1-8: the four candid tables that deny `single` outright
-- (reference_links, "references", entity_files, shidduchim_external_links),
-- interactions' default deny (AC 2, all three per-command policies —
-- including the 5.9-migrated shadchan-targeted note shape), the shadchanim
-- row-readable/write-denied split plus the shadchan_stats aggregate-leak
-- assertion (AC 3), the shidduchim_summary.close_reason redaction (AC 4),
-- the medical_notes unconditional negative test (AC 5), the six storage
-- policies with the two-sided entity-files/resumes/photos assertion (AC 6),
-- and the summary-view pass-through (AC 7).
--
-- Arrange uses the shared "two siblings, one household" fixture
-- (dbSuiteHelpers.ts, siblingHouseholdFixtureSql()) — spliced in by
-- single_field_scoping.test.ts BEFORE this file, exactly like Story 6.2's
-- single_row_scoping.sql — rather than hand-rolling the household/parent/
-- two-singles shape here. This file only adds what is specific to THIS
-- story's assertions: one shidduch visible to Leah (close_reason set, a
-- shadchan attached), one visible to Rivka attached to a SECOND, otherwise
-- unattached shadchan (the shadchan_stats leak fixture), one row in each of
-- the six AC-1/AC-2/AC-5 zero-row tables, and four storage.objects rows.
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

insert into ids values
  ('shadchan_note_id', :'shadchan_note_id'),
  ('shidduch_note_id', :'shidduch_note_id');

-- medical_notes (Story 5.5) — AC-5's unconditional negative test.
insert into public.medical_notes (account_id, shidduchim_id, body)
values (:sibling_fixture_account_id, :leah_visible_id, 'Candid medical content')
returning id as medical_note_id \gset

insert into ids values ('medical_note_id', :'medical_note_id');

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
insert into results (name, passed)
select 'AC2/AC8: single sees zero rows in interactions (shadchan-targeted note + shidduch-scoped note both denied)',
       (select count(*) from public.interactions) = 0;

do $$
declare v_count int;
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'single_input', 'a single trying to write')
  returning 1 into v_count;
  insert into results values ('AC2: single''s INSERT into interactions is denied (raises or is filtered)', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('AC2: single''s INSERT into interactions is denied (raises or is filtered)', true, sqlerrm);
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
begin
  insert into public.shadchanim (name) values ('Single''s Own Shadchan');
  insert into results values ('AC3: single''s INSERT into shadchanim is denied (raises or is filtered)', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('AC3: single''s INSERT into shadchanim is denied (raises or is filtered)', true, sqlerrm);
end $$;

-- shadchan_stats aggregate-leak assertion: the stats shadchan is attributed
-- ONLY to Rivka's visible suggestion, which is denied to Leah under 6.2's
-- RLS — the aggregate must show zeroes, never Rivka's real counts.
insert into results (name, passed, detail)
select 'AC3: shadchan_stats shows ZEROED aggregates to single for a shadchan attributed only to a sibling''s suggestion (not a leak)',
       nb_suggestions = 0 and nb_progressed = 0 and nb_reached_yes = 0 and last_redt_date is null and nb_open_singles = 0,
       format('nb_suggestions=%s nb_progressed=%s nb_reached_yes=%s last_redt_date=%s nb_open_singles=%s',
              nb_suggestions, nb_progressed, nb_reached_yes, last_redt_date, nb_open_singles)
from public.shadchan_stats
where id = (select value::bigint from ids where name = 'stats_shadchan_id');

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

-- ---------------------------------------------------------------------------
-- AC 7: the summary views pass RLS through unchanged — zero rows for single.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC7: single sees zero rows in references_summary', (select count(*) from public.references_summary) = 0;

insert into results (name, passed)
select 'AC7: single sees zero rows in reference_links_summary', (select count(*) from public.reference_links_summary) = 0;

insert into results (name, passed)
select 'AC7: single sees zero rows in interactions_summary', (select count(*) from public.interactions_summary) = 0;

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
select 'AC8: parent_admin sees non-zero rows in interactions (both the shadchan-note and the shidduch-note)',
       (select count(*) from public.interactions) >= 2;

insert into results (name, passed)
select 'AC4/AC8: parent_admin reads the REAL close_reason on the same suggestion',
       (select close_reason from public.shidduchim_summary where id = (select value::bigint from ids where name = 'leah_visible_id'))
         = 'Candid decision rationale — not for the single''s eyes';

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in references_summary', (select count(*) from public.references_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in reference_links_summary', (select count(*) from public.reference_links_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in interactions_summary', (select count(*) from public.interactions_summary) > 0;

insert into results (name, passed)
select 'AC7/AC8: parent_admin sees non-zero rows in entity_files_summary', (select count(*) from public.entity_files_summary) > 0;

insert into results (name, passed, detail)
select 'AC3/AC8: parent_admin sees the REAL, non-zero shadchan_stats aggregate for the leak-test shadchan',
       nb_suggestions > 0,
       format('nb_suggestions=%s', nb_suggestions)
from public.shadchan_stats
where id = (select value::bigint from ids where name = 'stats_shadchan_id');

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
