-- Proof for discard_completed_demo_onboarding_root: the husk a release clear
-- leaves behind is deleted when onboarding restarts, and is NOT deleted on any
-- of the paths where deleting it could take a real household with it.
--
-- Every scenario drives the PRODUCTION path -- `prepare_demo_onboarding()`
-- called as `authenticated` -- rather than the helper directly, so the grant,
-- the SECURITY DEFINER hop and the fail-open wrapper are all exercised. The
-- last two checks pin the grant itself.
\set ON_ERROR_STOP on
begin;

create temporary table discard_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on discard_checks to public;

create or replace function pg_temp.as_user(p_user uuid) returns void
  language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $fn$;

-- Every scenario gets its own caller and its own husk.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('d1500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-green@test.invalid'),
  ('d1500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-nonempty@test.invalid'),
  ('d1500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-foreign@test.invalid'),
  ('d1500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-run@test.invalid'),
  ('d1500000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-pointer@test.invalid'),
  ('d1500000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-live@test.invalid'),
  ('d1500000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'discard-other@test.invalid');

-- A husk in exactly the shape a release clear leaves: retained household,
-- demo flag released, sole bootstrap membership archived, no run, empty.
create or replace function pg_temp.make_husk(p_user uuid, p_label text)
  returns bigint language plpgsql as $fn$
declare v_acct bigint;
begin
  insert into public.accounts (name, kind, demo)
  values (p_label, 'household', false) returning id into v_acct;
  insert into public.account_members (account_id, user_id, role, status)
  values (v_acct, p_user, 'parent_admin', 'archived');
  insert into public.demo_onboarding_intents (user_id, state, account_id, attempts)
  values (p_user, 'completed', v_acct, 1);
  delete from public.member_state where user_id = p_user;
  return v_acct;
end $fn$;

-- ---------------------------------------------------------------- GREEN
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000001', 'discard green husk') as green_acct \gset
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000001');
select public.prepare_demo_onboarding() as green_result \gset
reset role;

insert into discard_checks
select 'a released husk is deleted when onboarding restarts',
  not exists (select 1 from public.accounts where id = :'green_acct')
  and not exists (select 1 from public.account_members where account_id = :'green_acct'),
  'account ' || :'green_acct';

insert into discard_checks
select 'the restart still reports pending so the customer can retry',
  (:'green_result'::jsonb ->> 'state') = 'pending'
  and (:'green_result'::jsonb ->> 'account_id') is null,
  :'green_result';

-- ------------------------------------------------- RED: account not empty
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000002', 'discard nonempty husk') as nonempty_acct \gset
insert into public.singles (account_id, first_name_en, gender, status)
values (:'nonempty_acct', 'Leftover', 'female', 'active');
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000002');
select public.prepare_demo_onboarding() as nonempty_result \gset
reset role;

insert into discard_checks
select 'an account still holding data is NOT deleted',
  exists (select 1 from public.accounts where id = :'nonempty_acct'),
  'account ' || :'nonempty_acct';

insert into discard_checks
select 'a husk that cannot be discarded still does not block the retry',
  (:'nonempty_result'::jsonb ->> 'state') = 'pending',
  :'nonempty_result';

-- ------------------------------------------ RED: somebody else's membership
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000003', 'discard foreign husk') as foreign_acct \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'foreign_acct', 'd1500000-0000-0000-0000-000000000099', 'parent_admin', 'archived');
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000003');
select public.prepare_demo_onboarding();
reset role;

insert into discard_checks
select 'an account carrying another user''s membership is NOT deleted',
  exists (select 1 from public.accounts where id = :'foreign_acct')
  and exists (select 1 from public.account_members
              where account_id = :'foreign_acct'
                and user_id = 'd1500000-0000-0000-0000-000000000099'),
  'account ' || :'foreign_acct';

-- ------------------------------------------------- RED: a run references it
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000004', 'discard run husk') as run_acct \gset
insert into public.demo_runs (root_account_id, status, seed_version, lease_epoch)
values (:'run_acct', 'cleared', 'discard-test', 1);
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000004');
select public.prepare_demo_onboarding();
reset role;

insert into discard_checks
select 'an account any demo run still references is NOT deleted',
  exists (select 1 from public.accounts where id = :'run_acct'),
  'account ' || :'run_acct';

-- --------------------------------------- RED: it is somebody's live context
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000005', 'discard pointer husk') as pointer_acct \gset
insert into public.member_state (user_id, active_account_id)
values ('d1500000-0000-0000-0000-000000000099', :'pointer_acct')
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000005');
select public.prepare_demo_onboarding();
reset role;

-- Was: "is NOT deleted". A stale active-context pointer is now REPAIRED
-- rather than treated as a reason to strand the account: the husk has no
-- active membership, so current_context_id() already fails closed for that
-- user and the pointer can never resolve. Refusing on it would have left an
-- orphan the constraint trigger then rejects -- a state that is neither
-- disposable nor legal. Only a LIVE membership blocks disposal now, which
-- check "an established customer's live household" below covers.
insert into discard_checks
select 'a stale active-context pointer is repaired, not a reason to strand it',
  not exists (select 1 from public.accounts where id = :'pointer_acct')
  and exists (
    select 1 from public.member_state
    where user_id = 'd1500000-0000-0000-0000-000000000099'
      and active_account_id is null
  ),
  'account ' || :'pointer_acct';

-- ------------------------------------------ RED: caller is an active member
select pg_temp.make_husk('d1500000-0000-0000-0000-000000000006', 'discard live husk') as live_acct \gset
update public.account_members set status = 'active'
where account_id = :'live_acct' and user_id = 'd1500000-0000-0000-0000-000000000006';
set local role authenticated;
select pg_temp.as_user('d1500000-0000-0000-0000-000000000006');
select public.prepare_demo_onboarding() as live_result \gset
reset role;

insert into discard_checks
select 'an established customer''s live household is NOT deleted or reset',
  exists (select 1 from public.accounts where id = :'live_acct')
  and (:'live_result'::jsonb ->> 'state') = 'completed',
  :'live_result';

-- ------------------------------------------------------------ the grant
select has_function_privilege('authenticated',
  'public.discard_completed_demo_onboarding_root()', 'execute') as authed_exec \gset
select has_function_privilege('anon',
  'public.discard_completed_demo_onboarding_root()', 'execute') as anon_exec \gset

insert into discard_checks
select 'no client role may call the discard helper directly',
  not :'authed_exec'::boolean and not :'anon_exec'::boolean,
  'authenticated=' || :'authed_exec' || ' anon=' || :'anon_exec';

insert into discard_checks
select 'service_role may call it',
  has_function_privilege('service_role',
    'public.discard_completed_demo_onboarding_root()', 'execute');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from discard_checks;

rollback;
