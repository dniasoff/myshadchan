--
-- Row-level scoping for a single (Story 6.2) — database test suite.
--
-- Covers AC 1-6, AC 8: the three-part shidduchim visibility test (own
-- singles row + visibility='shared' + is_single_visible_state), the
-- resume/shidduch_education resume-adjacent facts (AC 2), the singles
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
-- per sibling), the resumes/shidduch_education rows that hang off them, one row
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
-- Denial assertions name the error they expect.
--
-- `exception when others then insert into results values (…, true, sqlerrm)`
-- records a PASS for ANY failure — a typo, a dropped function, a broken
-- search_path, a fixture that never materialised. Demonstrated on this very
-- file: renaming add_redt() out of existence left "AC6: add_redt() raises or
-- affects zero rows for a single" green and the suite 52/52. A denial test
-- that cannot tell "the policy refused me" from "the call blew up" proves
-- nothing, which is why the two RPC denials further down already matched
-- their specific message instead (see their comment). Every handler in this
-- file now does the same, through these two helpers:
--
--   denied()           — the call MUST raise, with THIS sqlstate and THIS
--                        message. A different failure fails the assertion.
--   unexpected_raise() — the call must NOT raise at all (it denies by
--                        returning nothing). Any exception fails.
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

create function pg_temp.unexpected_raise(
  p_name text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    false,
    format('expected the call to return an empty result, not raise; got sqlstate %s %L',
           p_actual_sqlstate, p_actual_message)
  );
end;
$$;

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

-- Focused actor-role regression: the invited `single` role is read-only on
-- the domain rows.  A permissive FOR ALL policy for that role would OR with
-- the normal manager policy and silently re-open private suggestions or
-- transitions, even though the visible-to-single SELECT policy is correct.
insert into results (name, passed, detail)
select
  'actor boundary: invited single has no direct singles/shidduchim write policy; self_manager uses the existing manager path',
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('singles', 'shidduchim')
      and policyname in ('Singles writable by self', 'Shidduchim writable by self')
  ),
  'the role=single FOR ALL policies must remain absent';

-- `location_en` is not decoration: it is the ONE corroborator that lifts an
-- exact name match above match_identity()'s NULL-confidence floor, which is
-- what gives the catch twin below (and therefore catch_shidduch()'s
-- parent-side control) something real to find.
insert into public.shidduchim (account_id, single_id, name_en, location_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Visible Suggestion', 'Lakewood', 'shared', 'look_into')
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

-- The catch twin: the SAME person (name + location) already suggested for
-- Rivka. This is what makes catch_shidduch()'s denial assertion falsifiable —
-- without it, `has_catch: false` is the answer for EVERY caller, including
-- the parent_admin, so "the single never sees a catch" would be green against
-- a fixture that had no catch to see. Kept in the `new` pipeline_state so it
-- stays invisible to BOTH siblings' own AC-1 row counts (it is a fixture for
-- the parent-side control, not a fourth visibility case).
insert into public.shidduchim (account_id, single_id, name_en, location_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Leah Visible Suggestion', 'Lakewood', 'shared', 'new')
returning id as catch_twin_id \gset

insert into ids values
  ('leah_visible_id', :'leah_visible_id'),
  ('catch_twin_id', :'catch_twin_id'),
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

-- Shidduch education: same visible/invisible pairing as the resumes above.
insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en)
values (:sibling_fixture_account_id, :leah_visible_id, 'seminary', 'Visible Seminary')
returning id as leah_visible_education_id \gset

insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en)
values (:sibling_fixture_account_id, :leah_new_id, 'seminary', 'Invisible Seminary')
returning id as leah_new_education_id \gset

insert into ids values
  ('leah_visible_education_id', :'leah_visible_education_id'),
  ('leah_new_education_id', :'leah_new_education_id');

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
-- The phone is load-bearing for match_reference_on_entry()'s assertion below:
-- match_identity() scores an exact name with no corroborating fact at NULL
-- confidence, so a name-only reference is invisible to EVERY caller and
-- "the single gets zero candidates" would be green for the wrong reason. With
-- a phone, the parent-side control returns a real candidate and the single's
-- empty result is attributable to RLS.
insert into public."references" (account_id, name_en, phone)
values (:sibling_fixture_account_id, 'Some Reference', '054-999-8888')
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
-- AC 2: resumes / shidduch_education — Leah's resume-adjacent facts.
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
select 'AC2: Leah reads the shidduch_education row tied to her own visible suggestion',
       exists (select 1 from public.shidduch_education where id = (select value::bigint from ids where name = 'leah_visible_education_id'));

insert into results (name, passed)
select 'AC2: Leah does NOT read the shidduch_education row tied to her own invisible ''new'' suggestion',
       not exists (select 1 from public.shidduch_education where id = (select value::bigint from ids where name = 'leah_new_education_id'));

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

-- The other half of the eight zero-row assertions, and the reason they mean
-- anything: "Leah sees zero rows in X" is equally green when X was never
-- seeded, or was seeded into a different account. One control per table,
-- read in the same run by the parent_admin who owns them, so the eight
-- denials above are attributable to the `single` role and nothing else.
insert into results (name, passed)
select 'AC5 control: the parent sees a real row in all eight zero-row tables (the single''s zeros are RLS, not an empty fixture)',
       (select count(*) from public.tasks) > 0
       and (select count(*) from public.invites) > 0
       and (select count(*) from public.date_records) > 0
       and (select count(*) from public.redts) > 0
       and (select count(*) from public.identity_signals) > 0
       and (select count(*) from public.inbox_items) > 0
       and (select count(*) from public.subscription) > 0
       and (select count(*) from public.ai_usage) > 0;

insert into results (name, passed)
select 'AC2/review#2 control: the sibling''s resume_photos row hide_resume_photo() cannot reach DOES exist for the parent',
       exists (select 1 from public.resume_photos where id = (select value::bigint from ids where name = 'rivka_photo_id'));

-- ---------------------------------------------------------------------------
-- AC 6: a single cannot reach a denied row through an RPC either. Every
-- SECURITY INVOKER domain RPC is denied to a `single` caller, and each one is
-- pinned to the SPECIFIC denial it produces — a named sqlstate and message
-- for the ones that raise, an empty result plus a parent-side control for the
-- two that deny by returning nothing. Structured as one named result per
-- function so a future definer-isation of any one of them fails a named
-- assertion — and, because the expected error is named, so does a rename, a
-- dropped function or a broken search_path.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

-- transition_shidduch() denies through the UPDATE half of RLS: its opening
-- `select … for update` is a locking read, so a row Leah can SELECT but not
-- UPDATE is simply not returned and the function raises its own "not found".
-- That message would be identical for a row that never existed, so it gets an
-- existence control of its own first — the assertion pair is "she can see it"
-- AND "the locking read still cannot reach it", which is the actual claim.
insert into results (name, passed)
select 'AC6 control: the shidduch transition_shidduch() reports as "not found" IS visible to Leah (the denial is the UPDATE policy, not a missing row)',
       exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'leah_visible_id'));

do $$
declare
  v_name constant text := 'AC6: transition_shidduch() is denied for a single — a row she can SELECT but not UPDATE is unreachable to its locking read';
  v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.transition_shidduch(v_id, 'look_into'::public.pipeline_state, 'yes'::public.pipeline_state);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(v_name, 'P0001', 'shidduch % not found', sqlstate, sqlerrm);
end $$;

-- catch_shidduch() denies by returning an EMPTY answer, not by raising: the
-- prior-suggestion and prior-date lookups both read RLS-empty tables for a
-- single. So any exception here is a real failure, never a pass — and the
-- parent-side control further down proves there was a catch to find.
do $$
declare
  v_name constant text := 'AC6: catch_shidduch() never fabricates a match for a single (identity_signals/date_records both RLS-empty)';
  v_id bigint; v_result jsonb;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  v_result := public.catch_shidduch(v_id);
  insert into results values (
    v_name,
    v_result = jsonb_build_object('has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb),
    v_result::text
  );
exception when others then
  perform pg_temp.unexpected_raise(v_name, sqlstate, sqlerrm);
end $$;

-- add_redt()/add_education()/create_shidduch()/add_resume_file()/
-- add_resume_photo() all clear their own account-scope check (Leah's context
-- IS the household) and are then stopped by the INSERT half of RLS on the
-- table they write. The expected error is therefore the row-security
-- violation for THAT table, named here so that definer-ising the function,
-- widening the policy, or breaking the function outright each fail
-- differently and visibly.
do $$
declare
  v_name constant text := 'AC6: add_redt() is denied for a single by row-level security on public.redts';
  v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_redt(v_id);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, '42501', 'new row violates row-level security policy for table "redts"', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC6: add_education() is denied for a single by row-level security on public.shidduch_education';
  v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_education(v_id);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, '42501', 'new row violates row-level security policy for table "shidduch_education"', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC6: create_shidduch() is denied for a single by row-level security on public.shidduchim';
  v_single_id bigint; v_count int;
begin
  select value::bigint into v_single_id from ids where name = 'leah_single_id';
  select count(*) into v_count from public.create_shidduch(p_single_id => v_single_id);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, '42501', 'new row violates row-level security policy for table "shidduchim"', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC6: add_resume_file() is denied for a single by row-level security on public.resumes';
  v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_resume_file(
    p_path => 'x/y.pdf', p_filename => 'y.pdf', p_mime_type => 'application/pdf', p_size => 1,
    p_shidduchim_id => v_id
  );
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, '42501', 'new row violates row-level security policy for table "resumes"', sqlstate, sqlerrm);
end $$;

-- AC 6 (review finding #2 — previously untested): add_resume_photo() against
-- Leah's OWN visible suggestion. Denied not by resume_photos itself but one
-- level up: the function's own upsert into `resumes` is refused by RLS
-- (Task 3's `<> 'single'` guard) before a resume_photos row is ever reached.
do $$
declare
  v_name constant text := 'AC6: add_resume_photo() is denied for a single by row-level security on public.resumes (one level up from resume_photos)';
  v_id bigint; v_count int;
begin
  select value::bigint into v_id from ids where name = 'leah_visible_id';
  select count(*) into v_count from public.add_resume_photo(
    p_shidduchim_id => v_id, p_path => 'x/photos/shared/x/x.jpg', p_visibility => 'shared'
  );
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, '42501', 'new row violates row-level security policy for table "resumes"', sqlstate, sqlerrm);
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
declare
  v_name constant text := 'AC6/review#2: hide_resume_photo() is denied for a single targeting a SIBLING''s photo — the row is invisible, so its own existence check raises';
  v_photo_id bigint; v_count int;
begin
  select value::bigint into v_photo_id from ids where name = 'rivka_photo_id';
  select count(*) into v_count from public.hide_resume_photo(v_photo_id);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, 'P0001', 'photo % not found in current account', sqlstate, sqlerrm);
end $$;

-- link_reference_to_shidduch() is exercised against Leah's sibling's
-- suggestion (denied to Leah under AC-1), not her own visible one: neither
-- `reference_links` nor `interactions` is this story's axis (Dev Notes,
-- "What this story deliberately does not decide" — Story 6.3's), so the
-- fence this story can actually prove here is the one it owns: `shidduchim`
-- itself denies Leah the row before the RPC ever reaches the tables it
-- writes.
do $$
declare
  v_name constant text := 'AC6: link_reference_to_shidduch() is denied for a single — its own account-scope lookup runs under her RLS and finds neither the reference nor the sibling''s shidduch';
  v_reference_id bigint; v_shidduch_id bigint; v_count int;
begin
  select value::bigint into v_reference_id from ids where name = 'reference_id';
  select value::bigint into v_shidduch_id from ids where name = 'rivka_visible_id';
  select count(*) into v_count from public.link_reference_to_shidduch(v_reference_id, v_shidduch_id);
  insert into results values (v_name, false, format('call unexpectedly succeeded, rows: %s', v_count));
exception when others then
  perform pg_temp.denied(
    v_name, 'P0001', 'reference % not found in current account', sqlstate, sqlerrm);
end $$;

-- AC 6 (review finding #2 — previously untested): match_reference_on_entry()
-- fixed target_type='reference' — its own axis is identity_signals (AD-5),
-- which IS this story's own AC-5 zero-row table. Even though `references`
-- itself has no single-role guard yet (Story 6.3's axis), the underlying
-- identity_signals row (auto-populated for "Some Reference" by
-- sync_reference_identity_signals()) is invisible to Leah, so no candidate
-- ever surfaces through this RPC.
-- Like catch_shidduch(), this one denies by returning nothing rather than by
-- raising, so any exception is a failure. The name+phone pair is the one that
-- scores 0.98 for the parent (control further down) — a name-only call scores
-- NULL for everyone and would make this assertion unfalsifiable.
do $$
declare
  v_name constant text := 'AC6: match_reference_on_entry() returns zero candidates for a single (identity_signals is RLS-empty)';
  v_count int;
begin
  select count(*) into v_count
  from public.match_reference_on_entry(p_name_en => 'Some Reference', p_phone => '054-999-8888');
  insert into results values (v_name, v_count = 0, 'rows: ' || v_count);
exception when others then
  perform pg_temp.unexpected_raise(v_name, sqlstate, sqlerrm);
end $$;

-- AC 6 (review finding #2; the expectation below was flipped from "succeeds"
-- to "denied" when Story 6.3 landed — see the two SCOPE NOTE paragraphs this
-- comment replaces, preserved in this file's history).
--
-- When Story 6.2 shipped, log_reference_call() and merge_references()
-- operated entirely through reference_links/"references", neither of which
-- carried a `single`-role guard, so both calls genuinely succeeded for Leah.
-- Asserting a denial then would have been a false green, so these two results
-- honestly pinned the behaviour of the day and said in as many words that
-- Story 6.3 "turns them red (a signal to update the expectation to
-- 'denied')". Story 6.3 landed exactly that: `and
-- public.current_member_role() <> 'single'` on both "References scoped to
-- account" (05_policies.sql) and "Reference links scoped to account".
--
-- The denial is structural, not a special case bolted onto the RPCs: neither
-- function is SECURITY DEFINER (02_functions.sql — both carry only `SET
-- search_path TO ''`), so their own `select ... into` lookups run under the
-- CALLER's RLS and simply find nothing. That is why the assertions match the
-- SPECIFIC "not found in current account" message the lookups raise rather
-- than accepting `when others`: a suite that passes on any exception is
-- equally green for a typo, a dropped function or a broken search_path, which
-- would make it worthless as a denial test.
--
-- The two parent-side controls after the identity switch below close the
-- other half. Without them, both assertions here would stay green against an
-- implementation that had deleted the fixture rows outright — a denial test
-- must prove there was something real to be denied.
do $$
declare v_link_id bigint; v_count int;
begin
  select value::bigint into v_link_id from ids where name = 'reference_link_id';
  select count(*) into v_count from public.log_reference_call(v_link_id, p_call_status => 'answered', p_what_they_said => 'test call');
  insert into results values (
    'AC6 (Story 6.3 closed this): log_reference_call() is denied for a single — reference_links is invisible to the role',
    false, 'call unexpectedly succeeded, rows: ' || v_count
  );
exception when others then
  insert into results values (
    'AC6 (Story 6.3 closed this): log_reference_call() is denied for a single — reference_links is invisible to the role',
    sqlerrm like 'reference link % not found in current account', sqlerrm
  );
end $$;

do $$
declare v_loser_id bigint; v_winner_id bigint; v_result bigint;
begin
  select value::bigint into v_loser_id from ids where name = 'reference_b_id';
  select value::bigint into v_winner_id from ids where name = 'reference_id';
  select public.merge_references(v_loser_id, v_winner_id) into v_result;
  insert into results values (
    'AC6 (Story 6.3 closed this): merge_references() is denied for a single — "references" is invisible to the role',
    false, 'call unexpectedly succeeded, winner: ' || v_result
  );
exception when others then
  insert into results values (
    'AC6 (Story 6.3 closed this): merge_references() is denied for a single — "references" is invisible to the role',
    sqlerrm like 'reference % not found in current account', sqlerrm
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
-- The second half of the two RPC denials above, read back as the parent_admin
-- who owns these rows. A denial assertion that only checks "the call raised"
-- is satisfied by an implementation with no rows at all, or with the function
-- missing; these two prove the rows were really there to be denied AND that
-- the single's two raised calls left them byte-for-byte untouched — a raise
-- after a partial write would be a far worse defect than a clean refusal.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC6 control: the reference_link the single could not log against still exists, with an empty call log (the denial was real, and wrote nothing)',
       exists (
         select 1 from public.reference_links rl
         where rl.id = (select value::bigint from ids where name = 'reference_link_id')
           and rl.call_status is null
           and coalesce(jsonb_array_length(rl.conversation_log), 0) = 0
       );

insert into results (name, passed)
select 'AC6 control: the merge the single attempted did not happen — both "references" rows survive (the denial was real, and deleted nothing)',
       (select count(*) from public."references"
         where id in (
           (select value::bigint from ids where name = 'reference_id'),
           (select value::bigint from ids where name = 'reference_b_id')
         )) = 2;

-- The other half of the two RPCs that deny by returning an EMPTY answer
-- rather than raising. Neither can be pinned by an error message, so the only
-- thing that separates "RLS hid it" from "there was nothing to find" is the
-- SAME call, on the SAME fixture, made by a role that is allowed to see it.
insert into results (name, passed)
select 'AC6 control: the same match_reference_on_entry() call returns a real candidate for the parent (the single''s zero is RLS, not an unmatchable fixture)',
       (select count(*) from public.match_reference_on_entry(
          p_name_en => 'Some Reference', p_phone => '054-999-8888')) > 0;

insert into results (name, passed)
select 'AC6 control: the same catch_shidduch() call DOES report a catch for the parent — the single''s empty answer is RLS, not a fixture with no catch in it',
       (public.catch_shidduch((select value::bigint from ids where name = 'leah_visible_id')) ->> 'has_catch')::boolean
       and jsonb_array_length(
             public.catch_shidduch((select value::bigint from ids where name = 'leah_visible_id')) -> 'suggestions'
           ) > 0;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
