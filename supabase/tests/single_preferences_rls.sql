--
-- single_preferences row-level security (Story 16.1 / FR67) — database suite.
--
-- The table was created, its policies applied and its composite FK exercised
-- when the migration landed, but the two RLS PREDICATES had never been
-- evaluated by an authenticated session with a real role. Creation succeeding
-- says nothing about who can read what; this file is the difference.
--
-- The feature is one sentence: a single writes preferences in her own words
-- and chooses per row whether whoever manages her process may read it. So the
-- assertion that carries the whole feature is the NEGATIVE one — a manager
-- must NOT see a row with visible_to_manager = false.
--
-- That assertion is only meaningful if a hidden row existed and was withheld.
-- A manager who selects and gets one row proves nothing on its own: an empty
-- fixture, a broken join or a table that failed to seed all produce the same
-- number. Every negative below therefore ships with a control that proves the
-- withheld row was really there, read back as postgres (superuser, RLS
-- bypassed) rather than through the policy being tested.
--
-- Arrange uses the shared "two siblings, one household" fixture
-- (dbSuiteHelpers.ts, siblingHouseholdFixtureSql()), spliced in by
-- single_preferences_rls.test.ts BEFORE this file: one household, one
-- parent_admin, and two `single` logins (Leah, Rivka) each linked to their own
-- singles row. This file adds Leah's two preferences (one shared, one hidden),
-- one of Rivka's, and a SECOND household whose parent_admin is the outsider —
-- deliberately a manager in their own account, so the cross-tenant checks
-- prove that holding the manager role is not sufficient without the account
-- scope.
--
-- Denial style follows single_row_scoping.sql: a handler that records a PASS
-- for any exception cannot tell "the policy refused me" from "the call blew
-- up", so both write denials below match the specific sqlstate (42501) rather
-- than accepting `when others`.
--
-- Run via: npm run test:unit:db  (needs a stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate,
    format('sqlstate %s %L (expected %s)',
           p_actual_sqlstate, p_actual_message, p_expected_sqlstate)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange: a second household, whose parent_admin is the outsider.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('51830000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'prefs-outsider-parent@test.local');

insert into public.accounts (name, kind) values ('Preferences Outsider Household', 'household')
returning id as outsider_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:outsider_account_id, '51830000-0000-0000-0000-000000000001', 'parent_admin', 'active');

-- ---------------------------------------------------------------------------
-- Arrange: Leah writes her own preferences, through the policy, as herself.
-- Doing the seeding as Leah rather than as postgres means the "a single can
-- write her own rows" half of policy 1 is exercised by the arrangement itself
-- — if the with-check were wrong, this file would fail here rather than
-- reporting a green suite built on superuser-inserted rows.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.single_preferences (single_id, body, visible_to_manager)
values (:sibling_fixture_leah_single_id, 'Leah shared: I want someone who learns.', true)
returning id as leah_shared_id \gset

insert into public.single_preferences (single_id, body, visible_to_manager)
values (:sibling_fixture_leah_single_id, 'Leah hidden: something I am not ready to say out loud.', false)
returning id as leah_hidden_id \gset

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into public.single_preferences (single_id, body, visible_to_manager)
values (:sibling_fixture_rivka_single_id, 'Rivka shared: I want to stay near my family.', true)
returning id as rivka_shared_id \gset

reset role;

insert into ids values
  ('leah_shared_id', :'leah_shared_id'),
  ('leah_hidden_id', :'leah_hidden_id'),
  ('rivka_shared_id', :'rivka_shared_id');

-- Control for every negative below: as postgres (RLS bypassed) all three rows
-- exist, and Leah's hidden row really is hidden-flagged. If this check ever
-- fails, every "sees nothing" assertion further down is vacuous.
insert into results (name, passed)
select 'CONTROL: all three preference rows exist and Leah''s hidden row is flagged not-visible (without this, every negative below is vacuous)',
       (select count(*) from public.single_preferences) = 3
   and (select visible_to_manager from public.single_preferences where id = :leah_hidden_id) = false
   and (select visible_to_manager from public.single_preferences where id = :leah_shared_id) = true;

-- ---------------------------------------------------------------------------
-- 1. The single sees her own rows — BOTH the shared and the hidden one.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'Leah sees exactly her own two preferences — visibility_to_manager does not hide a row from its author',
       (select count(*) from public.single_preferences) = 2;

insert into results (name, passed)
select 'Leah sees her HIDDEN row (the flag governs the manager''s read, not hers)',
       exists (select 1 from public.single_preferences where id = (select value::bigint from ids where name = 'leah_hidden_id'));

insert into results (name, passed)
select 'Leah does NOT see her sibling Rivka''s preference — same household, same role, different single',
       not exists (select 1 from public.single_preferences where id = (select value::bigint from ids where name = 'rivka_shared_id'));

-- ---------------------------------------------------------------------------
-- 2 + 3. The manager sees the shared row and NOT the hidden one.
--        This pair is the feature.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'The parent_admin''s role resolves to parent_admin (arrangement check for the two assertions below)',
       public.current_member_role() = 'parent_admin';

insert into results (name, passed)
select 'parent_admin SEES Leah''s shared preference',
       exists (select 1 from public.single_preferences where id = (select value::bigint from ids where name = 'leah_shared_id'));

insert into results (name, passed)
select 'parent_admin does NOT see Leah''s hidden preference — THE feature; the row exists (see CONTROL) and is withheld by visible_to_manager',
       not exists (select 1 from public.single_preferences where id = (select value::bigint from ids where name = 'leah_hidden_id'));

insert into results (name, passed)
select 'parent_admin sees exactly the two shared rows in the household (Leah''s and Rivka''s), never three',
       (select count(*) from public.single_preferences) = 2;

-- ---------------------------------------------------------------------------
-- 4. A different household sees nothing — even holding the manager role, and
--    even naming a valid row id directly.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'The outsider IS a parent_admin — so the two checks below test account scope, not role',
       public.current_member_role() = 'parent_admin';

insert into results (name, passed)
select 'A parent_admin in ANOTHER household sees no preferences at all',
       (select count(*) from public.single_preferences) = 0;

insert into results (name, passed)
select 'That outsider gets zero rows even when naming Leah''s SHARED row by id — the id is not an oracle',
       not exists (select 1 from public.single_preferences where id = (select value::bigint from ids where name = 'leah_shared_id'));

-- ---------------------------------------------------------------------------
-- 5. Writes. The manager's policy is SELECT-only, and the single's with-check
--    stops her naming somebody else's single_id.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare v_single_id bigint;
begin
  select value::bigint into v_single_id from ids where name = 'leah_shared_id';
  begin
    insert into public.single_preferences (account_id, single_id, body)
    values (public.current_context_id(),
            (select single_id from public.single_preferences where id = v_single_id),
            'A manager putting words in her mouth.');
    insert into results values (
      'parent_admin CANNOT insert a preference on a single''s behalf', false,
      'the insert succeeded; the manager policy is SELECT-only and policy 1''s with-check should have refused');
  exception when others then
    perform pg_temp.denied('parent_admin CANNOT insert a preference on a single''s behalf', '42501', sqlstate, sqlerrm);
  end;
end;
$$;

-- UPDATE and DELETE deny by matching zero rows rather than raising, so each is
-- paired with a read-back proving the row survived unchanged.
do $$
declare
  v_id bigint;
  v_rows integer;
begin
  select value::bigint into v_id from ids where name = 'leah_shared_id';

  update public.single_preferences set body = 'rewritten by the manager' where id = v_id;
  get diagnostics v_rows = row_count;
  insert into results values (
    'parent_admin''s UPDATE of a shared preference affects zero rows',
    v_rows = 0, format('row_count = %s', v_rows));

  delete from public.single_preferences where id = v_id;
  get diagnostics v_rows = row_count;
  insert into results values (
    'parent_admin''s DELETE of a shared preference affects zero rows',
    v_rows = 0, format('row_count = %s', v_rows));
end;
$$;

reset role;

insert into results (name, passed)
select 'CONTROL: after both attempts the shared row still exists with its original text (the two zero-row results above were refusals, not no-ops on a missing row)',
       (select body from public.single_preferences where id = :leah_shared_id)
         = 'Leah shared: I want someone who learns.';

-- The with-check that the composite FK cannot catch: Rivka's single_id is in
-- the SAME account, so the FK is satisfied and only RLS stands between Leah
-- and writing a preference into her sibling's record.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare v_rivka_single_id bigint;
begin
  select single_id into v_rivka_single_id
  from public.single_preferences
  where id = (select value::bigint from ids where name = 'rivka_shared_id');
  begin
    insert into public.single_preferences (single_id, body)
    values (v_rivka_single_id, 'Leah writing into Rivka''s preferences.');
    insert into results values (
      'A single CANNOT write a preference naming another single''s single_id (same account, so the composite FK permits it — only the with-check refuses)',
      false, 'the insert succeeded; policy 1''s with-check should have refused');
  exception when others then
    perform pg_temp.denied(
      'A single CANNOT write a preference naming another single''s single_id (same account, so the composite FK permits it — only the with-check refuses)',
      '42501', sqlstate, sqlerrm);
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
