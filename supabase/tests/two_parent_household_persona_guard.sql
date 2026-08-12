--
-- add_persona('single') two-parent-household guard — database test suite.
--
-- Closes a gap in add_persona()'s `p_persona = 'single'` branch
-- (02_functions.sql): when the caller already holds an active OWNING
-- membership (public.is_owning_membership_role() — parent_admin or
-- self_manager), that branch attached a brand-new `singles` row directly to
-- the caller's own membership, in the same account, with NO check on how
-- many other parent-tier members that account already had. A `parent_admin`
-- in a real 2-parent household could therefore get their own self-managed
-- shidduch profile, which the product's domain model forbids outright: "if
-- there are 2 parents they cannot have a shidduch profile" (see the
-- household-sharing-model notes). `self_manager` exists specifically for a
-- SINGLE-parent household where that one parent IS the shidduch candidate —
-- a 2-parent household should never be able to reach that state.
--
-- Covers:
--   Scenario A (the bug): a REAL 2-parent household — parent A creates the
--   household via add_persona('parent'), then invites parent B as a SECOND
--   parent_admin via create_invite('parent_admin')/accept_invite() (the
--   real, and only, way an account ever gains a second owning member) —
--   then EITHER parent calling add_persona('single') must be REFUSED, and
--   must leave no partial state behind.
--   Scenario B (must keep working): a genuine solo-parent household (one
--   parent_admin, no second owning member) calling add_persona('single')
--   still succeeds and attaches the new singles row to their own membership
--   — the currently-working path (count=1) this fix must not break.
--   Scenario C (must keep working): an existing self_manager re-ticking
--   add_persona('single') still hits the idempotent no-op branch and never
--   reaches the guarded path at all.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (two_parent_household_persona_guard.test.ts) turns each row into a named
-- assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

delete from public.account_members;

-- ---------------------------------------------------------------------------
-- Scenario A arrange: a REAL 2-parent household via add_persona('parent') +
-- create_invite('parent_admin') + accept_invite() — the only path that ever
-- puts a second owning member into an account (02_functions.sql).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('51830000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two-parent-a@test.local'),
  ('51830000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two-parent-b@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.add_persona('parent');

select am.id as parent_a_member_id, am.account_id as two_parent_account_id
from public.account_members am
where am.user_id = '51830000-0000-0000-0000-000000000001' and am.status = 'active'
\gset

select (public.create_invite('two-parent-b@test.local', 'parent_admin')).token as parent_b_token \gset

reset role;
set local request.jwt.claims = '{}';

set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000002","role":"authenticated"}';

select public.accept_invite(:'parent_b_token'::uuid);

reset role;
set local request.jwt.claims = '{}';

select am.id as parent_b_member_id
from public.account_members am
where am.user_id = '51830000-0000-0000-0000-000000000002' and am.status = 'active'
\gset

insert into results (name, passed, detail)
select
  'arrange: household now has TWO active parent-tier (owning) members — a real 2-parent household, not a hypothetical',
  (select count(*) from public.account_members
     where account_id = :two_parent_account_id and status = 'active'
       and public.is_owning_membership_role(role)) = 2,
  format('owning member count=%s',
    (select count(*) from public.account_members
       where account_id = :two_parent_account_id and status = 'active'
         and public.is_owning_membership_role(role)));

-- ---------------------------------------------------------------------------
-- Scenario A act/assert: parent A's add_persona('single') must be REFUSED.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.add_persona('single');
  insert into results values (
    'a parent_admin in a 2-parent household calling add_persona(''single'') is REFUSED, not silently given a self-managed shidduch profile',
    false, 'call unexpectedly succeeded — a 2-parent household got a self-managed singles profile'
  );
exception when others then
  insert into results values (
    'a parent_admin in a 2-parent household calling add_persona(''single'') is REFUSED, not silently given a self-managed shidduch profile',
    sqlerrm like '%2-parent household%' and sqlstate = '23514', sqlerrm || ' [' || sqlstate || ']'
  );
end $$;

reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
select
  'after the refused call, parent A''s own membership is still parent_admin, unchanged (no partial promotion/attachment)',
  exists (select 1 from public.account_members where id = :parent_a_member_id and role = 'parent_admin' and status = 'active'),
  'parent_a role check';

insert into results (name, passed, detail)
select
  'after the refused call, no singles row was attached to parent A''s membership',
  not exists (select 1 from public.singles where member_id = :parent_a_member_id),
  format('singles rows for parent A member_id=%s',
    (select count(*) from public.singles where member_id = :parent_a_member_id));

-- Symmetric check: parent B (the invited second parent) is refused exactly
-- the same way — the guard is not specific to whichever parent founded the
-- household.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.add_persona('single');
  insert into results values (
    'symmetric: parent B (the invited second parent_admin) calling add_persona(''single'') is REFUSED too, not just the household''s founder',
    false, 'call unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'symmetric: parent B (the invited second parent_admin) calling add_persona(''single'') is REFUSED too, not just the household''s founder',
    sqlerrm like '%2-parent household%' and sqlstate = '23514', sqlerrm || ' [' || sqlstate || ']'
  );
end $$;

reset role;
set local request.jwt.claims = '{}';

-- ---------------------------------------------------------------------------
-- Scenario B: a genuine SOLO-parent household (one parent_admin, no second
-- owning member) — add_persona('single') must still succeed and attach the
-- new singles row to the caller's own membership. This is the currently-
-- working path (path 2, owning-member count=1) the fix must not break.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('51830000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'solo-parent@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000003","role":"authenticated"}';

select public.add_persona('parent');

select am.id as solo_parent_member_id, am.account_id as solo_parent_account_id
from public.account_members am
where am.user_id = '51830000-0000-0000-0000-000000000003' and am.status = 'active'
\gset

select public.add_persona('single');

reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
select
  'regression: a solo parent_admin (the only owning member of their household) can still successfully call add_persona(''single'') — the currently-working case must keep working',
  exists (
    select 1 from public.singles
    where member_id = :solo_parent_member_id and account_id = :solo_parent_account_id
  ),
  format('singles rows for solo parent member_id=%s',
    (select count(*) from public.singles where member_id = :solo_parent_member_id));

insert into results (name, passed, detail)
select
  'regression: the solo parent''s membership role is untouched (still parent_admin) — attaching a singles row never rewrites role',
  exists (select 1 from public.account_members where id = :solo_parent_member_id and role = 'parent_admin' and status = 'active'),
  'solo parent role check';

-- ---------------------------------------------------------------------------
-- Scenario C: an existing self_manager (a household of exactly one, created
-- fresh via add_persona('single')) re-ticking add_persona('single') still
-- hits the idempotent no-op branch — never reaches the guarded path at all.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('51830000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self-manager-retick@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51830000-0000-0000-0000-000000000004","role":"authenticated"}';

select public.add_persona('single');

select am.id as retick_member_id
from public.account_members am
where am.user_id = '51830000-0000-0000-0000-000000000004' and am.status = 'active'
\gset

-- Second call: must remain a silent no-op, not raise.
select public.add_persona('single');

reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
select
  'regression: a solo self_manager re-calling add_persona(''single'') stays a silent no-op (exactly one singles row, never raises)',
  (select count(*) from public.singles where member_id = :retick_member_id) = 1,
  format('singles rows for retick member_id=%s',
    (select count(*) from public.singles where member_id = :retick_member_id));

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
