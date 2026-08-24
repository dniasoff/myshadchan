-- Proof for the 18+ affirmation: what it records, that it records it once,
-- and that no caller can affirm on anyone else's behalf.
--
-- Every scenario drives the PRODUCTION path — the two RPCs called as
-- `authenticated`, with the members row created the way a real signup creates
-- it (handle_new_user() on the auth.users insert), not hand-built.
\set ON_ERROR_STOP on
begin;

create temporary table age_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on age_checks to public;

create or replace function pg_temp.as_user(p_user uuid) returns void
  language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $fn$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('a9e10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'age-first@test.invalid', '{"first_name":"Age","last_name":"First"}'::jsonb),
  ('a9e10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'age-second@test.invalid', '{"first_name":"Age","last_name":"Second"}'::jsonb);

insert into age_checks
select 'a real signup gets a members row with no affirmation on it',
  (select count(*) from public.members
   where user_id in ('a9e10000-0000-0000-0000-000000000001',
                     'a9e10000-0000-0000-0000-000000000002')
     and age_affirmed_at is null) = 2;

-- ------------------------------------------------------------ PENDING
set local role authenticated;
select pg_temp.as_user('a9e10000-0000-0000-0000-000000000001');
select public.age_affirmation_pending() as pending_before \gset

insert into age_checks
select 'a login that has never affirmed is reported pending',
  :'pending_before'::boolean;

-- ----------------------------------------------------------- AFFIRMING
select public.affirm_age() as first_affirmed_at \gset
select public.age_affirmation_pending() as pending_after \gset

insert into age_checks
select 'affirming records a timestamp and clears the ask',
  :'first_affirmed_at' is not null and not :'pending_after'::boolean,
  :'first_affirmed_at';

-- Idempotent: WHEN it was asked is part of the record, so a double-submit,
-- a retry or a second tab must not move it forward.
select public.affirm_age() as second_affirmed_at \gset

insert into age_checks
select 'affirming twice keeps the original timestamp, never a fresh one',
  :'first_affirmed_at' = :'second_affirmed_at',
  :'first_affirmed_at' || ' vs ' || :'second_affirmed_at';

-- ------------------------------------------------ SCOPED TO THE CALLER
-- Read the other login's row with RLS out of the way: as `authenticated`,
-- user 001 legitimately cannot see user 002's members row at all ("Members
-- readable by self or within active account"), so the subquery would return
-- NULL and the check would be asserting nothing.
reset role;
insert into age_checks
select 'affirming one login leaves every other login still pending',
  (select age_affirmed_at is null from public.members
   where user_id = 'a9e10000-0000-0000-0000-000000000002');

set local role authenticated;
select pg_temp.as_user('a9e10000-0000-0000-0000-000000000002');
insert into age_checks
select 'the second login is reported pending on its own reading',
  public.age_affirmation_pending();

-- ------------------------------------------------------- UNAUTHENTICATED
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform public.affirm_age();
  insert into age_checks values
    ('an unauthenticated caller cannot affirm', false, 'it was allowed');
exception when insufficient_privilege then
  insert into age_checks values
    ('an unauthenticated caller cannot affirm', true, sqlerrm);
when others then
  insert into age_checks values
    ('an unauthenticated caller cannot affirm', false, sqlstate || ' ' || sqlerrm);
end $$;

-- ...and is never REPORTED pending either: an affirmation that could not be
-- recorded must not be asked for, or the caller is stranded in a screen whose
-- only button cannot succeed.
insert into age_checks
select 'a caller with no member record is not asked to affirm',
  public.age_affirmation_pending() is false;

reset role;

-- ------------------------------------------------------------- GRANTS
insert into age_checks
select 'anon may call neither function',
  not has_function_privilege('anon', 'public.affirm_age()', 'execute')
  and not has_function_privilege('anon', 'public.age_affirmation_pending()', 'execute');

insert into age_checks
select 'authenticated may call both — they are scoped to auth.uid()',
  has_function_privilege('authenticated', 'public.affirm_age()', 'execute')
  and has_function_privilege('authenticated', 'public.age_affirmation_pending()', 'execute');

insert into age_checks
select 'neither function takes an account or user parameter',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('affirm_age', 'age_affirmation_pending')
     and p.pronargs = 0) = 2;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from age_checks;

rollback;
