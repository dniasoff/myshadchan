--
-- Row-level scoping for a single (Story 6.2) — database test suite.
--
-- Covers AC 1-6, AC 8: the three-part shidduchim visibility test (own
-- singles row + visibility='shared' + is_single_visible_state), the
-- resume/shidduch_schools resume-adjacent facts (AC 2), the singles
-- own-row-only read (AC 3), the accounts read-but-not-write split (AC 4),
-- the eight zero-row tables plus account_members' own-rows-only shape
-- (AC 5), and the RPC fence (AC 6) — a `single` caller gets a raised
-- exception or zero affected rows from every domain RPC this story's
-- policies apply inside.
--
-- Arrange uses the shared "two siblings, one household" fixture
-- (dbSuiteHelpers.ts, siblingHouseholdFixtureSql()) — spliced in by
-- single_row_scoping.test.ts BEFORE this file — rather than hand-rolling
-- the household/parent/two-singles shape here: 6.1, 6.3, 6.4 and 6.5 all
-- build on the exact same fixture, so its shape is decided once, in one
-- place. This file only adds what is specific to THIS story's assertions:
-- six shidduchim (one look_into+shared, one new, one look_into+private_parent
-- per sibling), the resumes/shidduch_schools rows that hang off them, one row
-- in each of the eight AC-5 zero-row tables, and a reference row for the
-- link_reference_to_shidduch() RPC check.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (single_row_scoping.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql /
-- medical_notes.sql).
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
-- Arrange (continued from the shared fixture, run as postgres/superuser):
-- six shidduchim, two per single-visible-state case, one per sibling.
-- enforce_shidduch_initial_state permits raw inserts only into
-- new/look_into/not_sure/for_sure_not — both states used below are legal.
-- ---------------------------------------------------------------------------
insert into ids values
  ('account_id', :'sibling_fixture_account_id'),
  ('parent_member_id', :'sibling_fixture_parent_member_id'),
  ('leah_member_id', :'sibling_fixture_leah_member_id'),
  ('rivka_member_id', :'sibling_fixture_rivka_member_id'),
  ('leah_single_id', :'sibling_fixture_leah_single_id'),
  ('rivka_single_id', :'sibling_fixture_rivka_single_id');

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Visible Suggestion', 'shared', 'look_into')
returning id as leah_visible_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah New Suggestion', 'shared', 'new')
returning id as leah_new_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Private Suggestion', 'private_parent', 'look_into')
returning id as leah_private_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Rivka Visible Suggestion', 'shared', 'look_into')
returning id as rivka_visible_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Rivka New Suggestion', 'shared', 'new')
returning id as rivka_new_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Rivka Private Suggestion', 'private_parent', 'look_into')
returning id as rivka_private_id \gset

insert into ids values
  ('leah_visible_id', :'leah_visible_id'),
  ('leah_new_id', :'leah_new_id'),
  ('leah_private_id', :'leah_private_id'),
  ('rivka_visible_id', :'rivka_visible_id'),
  ('rivka_new_id', :'rivka_new_id'),
  ('rivka_private_id', :'rivka_private_id');

-- Resumes: one tied to Leah's own visible suggestion (AC-2 positive), one
-- tied to her own INVISIBLE 'new' suggestion (AC-2 negative), Leah's own
-- outbound resume (AC-2's Story 5.8 shape, positive), and Rivka's own
-- outbound resume (AC-2 negative — a sibling's own resume).
insert into public.resumes (account_id, shidduchim_id)
values (:sibling_fixture_account_id, :leah_visible_id)
returning id as leah_visible_resume_id \gset

insert into public.resumes (account_id, shidduchim_id)
values (:sibling_fixture_account_id, :leah_new_id)
returning id as leah_new_resume_id \gset

insert into public.resumes (account_id, single_id)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id)
returning id as leah_own_resume_id \gset

insert into public.resumes (account_id, single_id)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id)
returning id as rivka_own_resume_id \gset

insert into ids values
  ('leah_visible_resume_id', :'leah_visible_resume_id'),
  ('leah_new_resume_id', :'leah_new_resume_id'),
  ('leah_own_resume_id', :'leah_own_resume_id'),
  ('rivka_own_resume_id', :'rivka_own_resume_id');

-- Shidduch schools: same visible/invisible pairing as the resumes above.
insert into public.shidduch_schools (account_id, shidduchim_id, kind, name_en)
values (:sibling_fixture_account_id, :leah_visible_id, 'seminary', 'Visible Seminary')
returning id as leah_visible_school_id \gset

insert into public.shidduch_schools (account_id, shidduchim_id, kind, name_en)
values (:sibling_fixture_account_id, :leah_new_id, 'seminary', 'Invisible Seminary')
returning id as leah_new_school_id \gset

insert into ids values
  ('leah_visible_school_id', :'leah_visible_school_id'),
  ('leah_new_school_id', :'leah_new_school_id');

-- One row in each AC-5 zero-row table, seeded as postgres (several of these
-- have no client insert policy at all — tasks/date_records/redts/inbox_items
-- do, but seeding all eight the same way keeps this block uniform).
-- identity_signals is NOT seeded here: sync_shidduch_identity_signals()
-- already populated one row per shidduch inserted above.
insert into public.tasks (account_id, target_type, target_id, text)
values (:sibling_fixture_account_id, 'shidduch', :leah_visible_id, 'Follow up');

insert into public.invites (account_id, email, role)
values (:sibling_fixture_account_id, 'zero-row-invite@test.local', 'helper');

insert into public.date_records (account_id, single_id, person_name_en, outcome)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Some Prior Date', 'ended');

insert into public.redts (account_id, shidduchim_id, note)
values (:sibling_fixture_account_id, :leah_visible_id, 'Redt note');

insert into public.inbox_items (account_id)
values (:sibling_fixture_account_id);

insert into public.subscription (account_id)
values (:sibling_fixture_account_id);

insert into public.ai_usage (account_id, period)
values (:sibling_fixture_account_id, '2026-07');

-- Review finding #2's own fix, falsified here: resume_photos on RIVKA's
-- visible suggestion (sibling exclusion) and on LEAH's own PRIVATE_PARENT
-- suggestion (a photo's own visibility='shared' must not override its
-- parent suggestion being wholly invisible under AC-1). Both photos are
-- themselves visibility='shared' — the negative case is the ownership join,
-- not the photo's own visibility flag.
insert into public.resumes (account_id, shidduchim_id)
values (:sibling_fixture_account_id, :rivka_visible_id)
returning id as rivka_visible_resume_id \gset

insert into public.resumes (account_id, shidduchim_id)
values (:sibling_fixture_account_id, :leah_private_id)
returning id as leah_private_resume_id \gset

insert into public.resume_photos (account_id, resume_id, path, visibility)
values (
  :sibling_fixture_account_id, :rivka_visible_resume_id,
  :'sibling_fixture_account_id' || '/photos/shared/' || :'rivka_visible_id' || '/sibling.jpg', 'shared'
)
returning id as rivka_photo_id \gset

insert into public.resume_photos (account_id, resume_id, path, visibility)
values (
  :sibling_fixture_account_id, :leah_private_resume_id,
  :'sibling_fixture_account_id' || '/photos/shared/' || :'leah_private_id' || '/private-suggestion.jpg', 'shared'
)
returning id as leah_private_photo_id \gset

-- Positive control: a photo on LEAH's OWN visible suggestion, proving the
-- ownership join above narrows without over-restricting the case it exists
-- to grant.
insert into public.resume_photos (account_id, resume_id, path, visibility)
values (
  :sibling_fixture_account_id, :leah_visible_resume_id,
  :'sibling_fixture_account_id' || '/photos/shared/' || :'leah_visible_id' || '/own.jpg', 'shared'
)
returning id as leah_own_photo_id \gset

insert into ids values
  ('rivka_photo_id', :'rivka_photo_id'),
  ('leah_private_photo_id', :'leah_private_photo_id'),
  ('leah_own_photo_id', :'leah_own_photo_id');

-- A reference, for the link_reference_to_shidduch() RPC check (AC 6), plus a
-- reference_link (for log_reference_call()) and a second reference (for
-- merge_references()). references/reference_links/interactions are Story
-- 6.3's axis, untouched here — see Dev Notes "What this story deliberately
-- does not decide"; the fixture below exists only so AC-6's own two
-- functions get an honest, run assertion instead of staying untested (review
-- finding #2).
insert into public."references" (account_id, name_en)
values (:sibling_fixture_account_id, 'Some Reference')
returning id as reference_id \gset

insert into public."references" (account_id, name_en)
values (:sibling_fixture_account_id, 'Some Reference B (merge loser)')
returning id as reference_b_id \gset

insert into public.reference_links (account_id, reference_id, shidduchim_id)
values (:sibling_fixture_account_id, :reference_id, :leah_visible_id)
returning id as reference_link_id \gset

insert into ids values
  ('reference_id', :'reference_id'),
  ('reference_b_id', :'reference_b_id'),
  ('reference_link_id', :'reference_link_id');

-- ---------------------------------------------------------------------------
-- Baseline: current_member_role() itself (AC 9's own function).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sibling-fixture-outsider@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'current_member_role(): resolves to ''single'' for a single-role caller',
       public.current_member_role() = 'single';

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000099","role":"authenticated"}';

insert into results (name, passed)
select 'current_member_role(): NULL for a caller with no active membership (fails closed)',
       public.current_member_role() is null;

-- Dev Notes "The NULL trap this story avoids", pinned directly (review
-- finding #5): `current_member_role() <> 'single'` must evaluate to NULL
-- (falsy in a USING clause), never true, for a caller with no active
-- membership — `IS DISTINCT FROM` would wrongly evaluate to true here. Every
-- policy in this story ANDs this with `account_id = current_context_id()`
-- (itself NULL for the same caller), so a live policy fails closed either
-- way and no black-box query against a real table can tell `<>` and
-- `IS DISTINCT FROM` apart (confirmed: mutating `tasks`'s clause to
-- `IS DISTINCT FROM` still passes every check below). This assertion pins
-- the expression itself, in isolation, so at least a direct test of the
-- convention exists.
insert into results (name, passed)
select 'The NULL trap: current_member_role() <> ''single'' is NULL (falsy), not true, for an unaffiliated caller — this is why every policy in this story uses <>, never IS DISTINCT FROM',
       (select public.current_member_role() <> 'single') is null;

-- ---------------------------------------------------------------------------
-- AC 1 / AC 8: shidduchim — Leah sees exactly her own visible suggestion.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC1: Leah sees exactly one shidduch (her own look_into+shared suggestion)',
       (select count(*) from public.shidduchim) = 1;

insert into results (name, passed)
select 'AC1: the one shidduch Leah sees is her own visible suggestion',
       exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'leah_visible_id'));

insert into results (name, passed)
select 'AC8: Leah cannot see her sibling Rivka''s visible suggestion (sibling exclusion)',
       not exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'rivka_visible_id'));

insert into results (name, passed)
select 'AC1: Leah cannot see her own ''new'' (single-invisible-state) suggestion',
       not exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'leah_new_id'));

insert into results (name, passed)
select 'AC1: Leah cannot see her own ''private_parent'' suggestion (visibility overrides state)',
       not exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'leah_private_id'));

-- ---------------------------------------------------------------------------
-- AC 1 / AC 8, vice versa: Rivka sees exactly her own visible suggestion,
-- never Leah's.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'AC1: Rivka sees exactly one shidduch (her own look_into+shared suggestion)',
       (select count(*) from public.shidduchim) = 1;

insert into results (name, passed)
select 'AC1: the one shidduch Rivka sees is her own visible suggestion',
       exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'rivka_visible_id'));

insert into results (name, passed)
select 'AC8: Rivka cannot see her sibling Leah''s visible suggestion (sibling exclusion, vice versa)',
       not exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'leah_visible_id'));

-- ---------------------------------------------------------------------------
-- AC 2: resumes / shidduch_schools — Leah's resume-adjacent facts.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC2: Leah reads the resume tied to her own visible suggestion',
       exists (select 1 from public.resumes where id = (select value::bigint from ids where name = 'leah_visible_resume_id'));

insert into results (name, passed)
select 'AC2: Leah does NOT read the resume tied to her own invisible ''new'' suggestion',
       not exists (select 1 from public.resumes where id = (select value::bigint from ids where name = 'leah_new_resume_id'));

insert into results (name, passed)
select 'AC2: Leah reads her own outbound resume (single_id set, Story 5.8 shape)',
       exists (select 1 from public.resumes where id = (select value::bigint from ids where name = 'leah_own_resume_id'));

insert into results (name, passed)
select 'AC2: Leah does NOT read her sibling Rivka''s own outbound resume',
       not exists (select 1 from public.resumes where id = (select value::bigint from ids where name = 'rivka_own_resume_id'));

insert into results (name, passed)
select 'AC2: Leah reads the shidduch_schools row tied to her own visible suggestion',
       exists (select 1 from public.shidduch_schools where id = (select value::bigint from ids where name = 'leah_visible_school_id'));

insert into results (name, passed)
select 'AC2: Leah does NOT read the shidduch_schools row tied to her own invisible ''new'' suggestion',
       not exists (select 1 from public.shidduch_schools where id = (select value::bigint from ids where name = 'leah_new_school_id'));

-- ---------------------------------------------------------------------------
-- Review finding #2's own fix: resume_photos ownership. `resume_photos` was
-- household-wide for the `single` role before this fix (any shared photo,
-- regardless of whose suggestion it belonged to) — the review reproduced a
-- real cross-sibling read (and, via hide_resume_photo(), write) using
-- exactly this shape. Both photos below have their OWN visibility='shared';
-- the negative case is entirely the ownership join, not that flag.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC2/review#2: Leah does NOT read a resume_photos row on her sibling Rivka''s suggestion',
       not exists (select 1 from public.resume_photos where id = (select value::bigint from ids where name = 'rivka_photo_id'));

insert into results (name, passed)
select 'AC1/review#2: Leah does NOT read a resume_photos row on her own private_parent suggestion (visibility overrides state, and this table too)',
       not exists (select 1 from public.resume_photos where id = (select value::bigint from ids where name = 'leah_private_photo_id'));

insert into results (name, passed)
select 'AC2/review#2 positive control: Leah DOES read a resume_photos row on her OWN visible suggestion (the ownership join narrows without over-restricting)',
       exists (select 1 from public.resume_photos where id = (select value::bigint from ids where name = 'leah_own_photo_id'));

-- ---------------------------------------------------------------------------
-- AC 3: singles — Leah reads exactly her own row.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC3: Leah reads exactly one singles row (her own)',
       (select count(*) from public.singles) = 1
       and exists (select 1 from public.singles where id = (select value::bigint from ids where name = 'leah_single_id'));

insert into results (name, passed)
select 'AC3: Leah cannot read her sibling Rivka''s singles row',
       not exists (select 1 from public.singles where id = (select value::bigint from ids where name = 'rivka_single_id'));

-- ---------------------------------------------------------------------------
-- AC 4: accounts — reads stay, writes deny single.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC4: Leah reads the household account row',
       (select count(*) from public.accounts) = 1;

insert into results (name, passed)
select 'AC4: my_contexts() returns Leah''s one context with role=''single''',
       (select count(*) from public.my_contexts()) = 1
       and (select role from public.my_contexts() limit 1) = 'single';

do $$
declare v_rows_affected int;
begin
  update public.accounts set name = 'Tampered By Single';
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC4: Leah''s UPDATE on accounts affects zero rows',
    v_rows_affected = 0,
    'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare v_rows_affected int;
begin
  delete from public.accounts;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC4: Leah''s DELETE on accounts affects zero rows',
    v_rows_affected = 0,
    'rows affected: ' || v_rows_affected
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 5 / AC 8: the eight zero-row tables, plus account_members' own-row-only
-- shape, as Leah.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC5: Leah sees zero rows in tasks', (select count(*) from public.tasks) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in invites', (select count(*) from public.invites) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in date_records', (select count(*) from public.date_records) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in redts', (select count(*) from public.redts) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in identity_signals', (select count(*) from public.identity_signals) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in inbox_items', (select count(*) from public.inbox_items) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in subscription', (select count(*) from public.subscription) = 0;

insert into results (name, passed)
select 'AC5: Leah sees zero rows in ai_usage', (select count(*) from public.ai_usage) = 0;

insert into results (name, passed)
select 'AC5/AC8: Leah sees exactly her own account_members row (1), never the household roster',
       (select count(*) from public.account_members) = 1;

-- Re-asserted as the parent, in the same test run: the roster is fully
-- intact and readable for a non-single role (AC 5's "never the household
-- roster" is a `single`-specific denial, not a regression on everyone else).
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC5/AC8: the parent''s session sees the full three-member roster in the same test run',
       (select count(*) from public.account_members) = 3;

-- ---------------------------------------------------------------------------
-- AC 6: a single cannot reach a denied row through an RPC either. Every
-- SECURITY INVOKER domain RPC gets a raised exception or zero affected rows
-- from a `single` caller. Structured as one named result per function so a
-- future definer-isation of any one of them fails a named assertion.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.transition_shidduch(v_id, 'look_into'::public.pipeline_state, 'yes'::public.pipeline_state);
  insert into results values ('AC6: transition_shidduch() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: transition_shidduch() raises or affects zero rows for a single', true, sqlerrm);
end $$;

do $$
declare v_id bigint;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  insert into results values (
    'AC6: catch_shidduch() never fabricates a match for a single (identity_signals/date_records both RLS-empty)',
    public.catch_shidduch(v_id) = jsonb_build_object('has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb),
    public.catch_shidduch(v_id)::text
  );
exception when others then
  insert into results values ('AC6: catch_shidduch() never fabricates a match for a single (identity_signals/date_records both RLS-empty)', true, sqlerrm);
end $$;

do $$
declare v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_redt(v_id);
  insert into results values ('AC6: add_redt() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: add_redt() raises or affects zero rows for a single', true, sqlerrm);
end $$;

do $$
declare v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_school(v_id);
  insert into results values ('AC6: add_school() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: add_school() raises or affects zero rows for a single', true, sqlerrm);
end $$;

do $$
declare v_single_id bigint; v_count int;
begin
  select value::bigint into v_single_id from ids where name = 'leah_single_id';
  select count(*) into v_count from public.create_shidduch(p_single_id => v_single_id);
  insert into results values ('AC6: create_shidduch() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: create_shidduch() raises or affects zero rows for a single', true, sqlerrm);
end $$;

do $$
declare v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_resume_file(
    p_path => 'x/y.pdf', p_filename => 'y.pdf', p_mime_type => 'application/pdf', p_size => 1,
    p_shidduchim_id => v_id
  );
  insert into results values ('AC6: add_resume_file() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: add_resume_file() raises or affects zero rows for a single', true, sqlerrm);
end $$;

-- AC 6 (review finding #2 — previously untested): add_resume_photo() against
-- Leah's OWN visible suggestion. Denied not by resume_photos itself but one
-- level up: the function's own upsert into `resumes` is refused by RLS
-- (Task 3's `<> 'single'` guard) before a resume_photos row is ever reached.
do $$
declare v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_resume_photo(
    p_shidduchim_id => v_id, p_path => 'x/photos/shared/x/x.jpg', p_visibility => 'shared'
  );
  insert into results values ('AC6: add_resume_photo() raises or affects zero rows for a single', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: add_resume_photo() raises or affects zero rows for a single', true, sqlerrm);
end $$;

-- AC 6 / review finding #2 (previously untested, and the exact shape the
-- review reproduced as a real vulnerability pre-fix): hide_resume_photo()
-- against a photo on Rivka's suggestion — a SIBLING's photo, not a denied
-- shidduch's. Before this story's review fix to `resume_photos`'s policy,
-- this call succeeded (hide_resume_photo()'s own "does this photo exist"
-- check is a plain SELECT that trusted the table's own, then household-wide,
-- RLS). Now denied: Leah cannot even SEE the row, so the function's own
-- `not exists` check raises 'photo % not found in current account'.
do $$
declare v_photo_id bigint; v_count int;
begin
  select value::bigint into v_photo_id from ids where name = 'rivka_photo_id';
  select count(*) into v_count from public.hide_resume_photo(v_photo_id);
  insert into results values (
    'AC6/review#2: hide_resume_photo() raises or affects zero rows for a single targeting a SIBLING''s photo',
    v_count = 0, 'rows: ' || v_count
  );
exception when others then
  insert into results values (
    'AC6/review#2: hide_resume_photo() raises or affects zero rows for a single targeting a SIBLING''s photo',
    true, sqlerrm
  );
end $$;

-- link_reference_to_shidduch() is exercised against Leah's sibling's
-- suggestion (denied to Leah under AC-1), not her own visible one: neither
-- `reference_links` nor `interactions` is this story's axis (Dev Notes,
-- "What this story deliberately does not decide" — Story 6.3's), so the
-- fence this story can actually prove here is the one it owns: `shidduchim`
-- itself denies Leah the row before the RPC ever reaches the tables it
-- writes.
do $$
declare v_reference_id bigint; v_shidduch_id bigint; v_count int;
begin
  select value::bigint into v_reference_id from ids where name = 'reference_id';
  select value::bigint into v_shidduch_id from ids where name = 'rivka_visible_id';
  select count(*) into v_count from public.link_reference_to_shidduch(v_reference_id, v_shidduch_id);
  insert into results values ('AC6: link_reference_to_shidduch() raises or affects zero rows for a single targeting a denied shidduch', v_count = 0, 'rows: ' || v_count);
exception when others then
  insert into results values ('AC6: link_reference_to_shidduch() raises or affects zero rows for a single targeting a denied shidduch', true, sqlerrm);
end $$;

-- AC 6 (review finding #2 — previously untested): match_reference_on_entry()
-- fixed target_type='reference' — its own axis is identity_signals (AD-5),
-- which IS this story's own AC-5 zero-row table. Even though `references`
-- itself has no single-role guard yet (Story 6.3's axis), the underlying
-- identity_signals row (auto-populated for "Some Reference" by
-- sync_reference_identity_signals()) is invisible to Leah, so no candidate
-- ever surfaces through this RPC.
do $$
declare v_count int;
begin
  select count(*) into v_count from public.match_reference_on_entry(p_name_en => 'Some Reference');
  insert into results values (
    'AC6: match_reference_on_entry() returns zero candidates for a single (identity_signals is RLS-empty)',
    v_count = 0, 'rows: ' || v_count
  );
exception when others then
  insert into results values (
    'AC6: match_reference_on_entry() returns zero candidates for a single (identity_signals is RLS-empty)',
    true, sqlerrm
  );
end $$;

-- AC 6 SCOPE NOTE (review finding #2 — previously untested; documented, not
-- silently skipped): log_reference_call() and merge_references() operate
-- entirely through reference_links/"references"/interactions, none of which
-- carries a `single`-role guard yet — that is explicitly Story 6.3's axis
-- (Dev Notes, "What this story deliberately does not decide": "6.3 puts
-- interactions into 'deny the single role by default'"). Unlike
-- link_reference_to_shidduch() above, neither function touches a table THIS
-- story gates, so there is no lever here to deny Leah with — both calls
-- below genuinely succeed today. Asserting a denial would be a false green;
-- these two results instead pin the CURRENT, honestly-disclosed behaviour,
-- so Story 6.3 turns them red (a signal to update the expectation to
-- "denied"), not silently leaves them looking untested.
do $$
declare v_link_id bigint; v_count int;
begin
  select value::bigint into v_link_id from ids where name = 'reference_link_id';
  select count(*) into v_count from public.log_reference_call(v_link_id, p_call_status => 'answered', p_what_they_said => 'test call');
  insert into results values (
    'AC6 SCOPE NOTE (Story 6.3 to close): log_reference_call() is not yet denied for a single — succeeds today',
    v_count = 1, 'rows: ' || v_count
  );
exception when others then
  insert into results values (
    'AC6 SCOPE NOTE (Story 6.3 to close): log_reference_call() is not yet denied for a single — succeeds today',
    false, sqlerrm
  );
end $$;

do $$
declare v_loser_id bigint; v_winner_id bigint; v_result bigint;
begin
  select value::bigint into v_loser_id from ids where name = 'reference_b_id';
  select value::bigint into v_winner_id from ids where name = 'reference_id';
  select public.merge_references(v_loser_id, v_winner_id) into v_result;
  insert into results values (
    'AC6 SCOPE NOTE (Story 6.3 to close): merge_references() is not yet denied for a single — succeeds today',
    v_result = v_winner_id, 'winner: ' || v_result
  );
exception when others then
  insert into results values (
    'AC6 SCOPE NOTE (Story 6.3 to close): merge_references() is not yet denied for a single — succeeds today',
    false, sqlerrm
  );
end $$;

do $$
begin
  perform public.create_invite('single-cannot-invite@test.local', 'single');
  insert into results values ('AC6: create_invite() refuses a single caller', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    'AC6: create_invite() refuses a single caller',
    sqlerrm like '%role single may not send invites%',
    sqlerrm
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
