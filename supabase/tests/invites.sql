--
-- Invite-only signup with 18+ affirmation (Epic 2, Story 2.7) — database test suite.
--
-- Covers: the RLS/grant posture on `invites` (AC-2's escalation case — a
-- direct `authenticated` write must be refused even when it hand-crafts a
-- privileged role and a real `invited_by`), the `handle_new_user()`
-- invite-binding rewrite (AC-6/AC-7 — binds on a matching signup, creates
-- NO membership on an unmatched or malformed one), `create_invite()`'s
-- authority/kind checks (AC-3), `get_invite_preview()`'s five-field,
-- effective-status shape (AC-4), and `check_signup_invite()`'s Auth Hook
-- contract (AC-5 — verified against the real event shape empirically
-- confirmed by running the stack, see story 2.7's Dev Notes).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (invites.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

delete from public.account_members;

-- ---------------------------------------------------------------------------
-- Arrange: a household (tenant A) with a parent_admin and a helper, and a
-- shadchanus (tenant B) with a shadchan. AC-3's authority/kind checks need
-- both context kinds and a non-owning role available to refuse.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a0000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invites-admin@test.local'),
       ('a0000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invites-helper@test.local'),
       ('a0000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invites-shadchan@test.local');

insert into public.accounts (name, kind) values ('Invites Household', 'household') returning id as acct_household \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_shadchanus \gset
insert into ids values ('acct_household', :acct_household), ('acct_shadchanus', :acct_shadchanus);

insert into public.account_members (account_id, user_id, role, status)
values (:acct_household, 'a0000000-0000-0000-0000-00000000a001', 'parent_admin', 'active')
returning id as admin_membership \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct_household, 'a0000000-0000-0000-0000-00000000a002', 'helper', 'active')
returning id as helper_membership \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct_shadchanus, 'a0000000-0000-0000-0000-00000000a003', 'shadchan', 'active')
returning id as shadchan_membership \gset

insert into ids values
  ('admin_membership', :admin_membership),
  ('helper_membership', :helper_membership),
  ('shadchan_membership', :shadchan_membership);

-- ---------------------------------------------------------------------------
-- AC-2: service_role can seed a genesis invite (invited_by null) — the
-- platform-ops runbook this story's Dev Notes describe. `authenticated`
-- cannot write the table at all, in any shape, including the escalation
-- case: a helper (non-owning role) hand-crafting a parent_admin invite with
-- a real invited_by, which a permissive `with check` insert policy would
-- have let through.
-- ---------------------------------------------------------------------------
insert into public.invites (email, account_id, role, invited_by)
values ('genesis@test.local', :acct_household, 'parent_admin', null)
returning id as genesis_invite_id \gset
insert into ids values ('genesis_invite_id', :genesis_invite_id);

insert into results (name, passed)
select 'service_role can insert a genesis invite with invited_by null', count(*) = 1
from public.invites where id = :genesis_invite_id;

insert into results (name, passed)
select 'authenticated holds SELECT but no INSERT/UPDATE/DELETE grant on invites',
       has_table_privilege('authenticated', 'public.invites', 'select')
   and not has_table_privilege('authenticated', 'public.invites', 'insert')
   and not has_table_privilege('authenticated', 'public.invites', 'update')
   and not has_table_privilege('authenticated', 'public.invites', 'delete')
   and not has_table_privilege('authenticated', 'public.invites', 'truncate');

insert into results (name, passed)
select 'anon holds no privilege at all on invites',
       not has_table_privilege('anon', 'public.invites', 'select')
   and not has_table_privilege('anon', 'public.invites', 'insert');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a002","role":"authenticated"}';

do $$
begin
  insert into public.invites (email, account_id, role)
  values ('escalation-no-invited-by@test.local', 1, 'single');
  insert into results values ('authenticated cannot insert an invite (no invited_by)', false, 'insert succeeded');
exception when others then
  insert into results values ('authenticated cannot insert an invite (no invited_by)', true, sqlerrm);
end $$;

do $$
declare v_acct bigint; v_helper bigint;
begin
  select value into v_acct from ids where name = 'acct_household';
  select value into v_helper from ids where name = 'helper_membership';
  insert into public.invites (email, account_id, role, invited_by)
  values ('escalation@test.local', v_acct, 'parent_admin', v_helper);
  insert into results values ('a helper cannot PostgREST-insert a parent_admin invite (AC-2 escalation case)', false, 'insert succeeded');
exception when others then
  insert into results values ('a helper cannot PostgREST-insert a parent_admin invite (AC-2 escalation case)', true, sqlerrm);
end $$;

do $$
declare v_genesis_invite_id bigint;
begin
  select value into v_genesis_invite_id from ids where name = 'genesis_invite_id';
  update public.invites set status = 'accepted', role = 'parent_admin' where id = v_genesis_invite_id;
  insert into results values ('authenticated cannot update an invite (status or role)', false, 'update succeeded');
exception when others then
  insert into results values ('authenticated cannot update an invite (status or role)', true, sqlerrm);
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

insert into results (name, passed)
select 'a member reads their own account''s invites', count(*) >= 1
from public.invites where account_id = :acct_household;

insert into results (name, passed)
select 'a member cannot read another account''s invites', count(*) = 0
from public.invites where account_id = :acct_shadchanus;

reset role;

-- ---------------------------------------------------------------------------
-- AC-3: role_authority() — the concrete "role <= inviter authority" mapping.
-- ---------------------------------------------------------------------------
insert into results (name, passed) values
  ('role_authority: parent_admin = 3', public.role_authority('parent_admin') = 3),
  ('role_authority: self_manager = 2', public.role_authority('self_manager') = 2),
  ('role_authority: helper = 1', public.role_authority('helper') = 1),
  ('role_authority: single = 1', public.role_authority('single') = 1),
  ('role_authority: shadchan = 1', public.role_authority('shadchan') = 1);

-- ---------------------------------------------------------------------------
-- AC-3: create_invite() — a non-owning caller (helper) may never invite,
-- regardless of the role requested.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a002","role":"authenticated"}';

do $$
begin
  perform public.create_invite('nobody@test.local', 'single');
  insert into results values ('create_invite refuses a non-owning caller (helper)', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses a non-owning caller (helper)', true, sqlerrm);
end $$;

reset role;

-- AC-3: authority — a shadchan (authority 1) may never invite a parent_admin
-- (authority 3), even though a shadchan IS an owning-invite-capable role.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a003","role":"authenticated"}';

do $$
begin
  perform public.create_invite('nobody@test.local', 'parent_admin');
  insert into results values ('create_invite refuses granting authority above the caller''s own', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses granting authority above the caller''s own', true, sqlerrm);
end $$;

-- AC-3: kind mismatch, direction 2 — a shadchan-role account (shadchanus)
-- can only ever invite `shadchan`, never `helper` (authority 1 <= 1 would
-- otherwise pass the authority check alone).
do $$
begin
  perform public.create_invite('nobody@test.local', 'helper');
  insert into results values ('create_invite refuses a non-shadchan role from a shadchanus context', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses a non-shadchan role from a shadchanus context', true, sqlerrm);
end $$;

reset role;

-- AC-3: kind mismatch, direction 1 — a household account can never invite a
-- `shadchan`, even from its own parent_admin (authority 1 <= 3 would
-- otherwise pass the authority check alone).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
begin
  perform public.create_invite('nobody@test.local', 'shadchan');
  insert into results values ('create_invite refuses a shadchan-role invite from a household context', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses a shadchan-role invite from a household context', true, sqlerrm);
end $$;

-- AC-3: the success path — invited_by comes from the caller's own
-- membership, never a parameter.
select (public.create_invite('new-helper@test.local', 'helper')).id as created_invite_id \gset

insert into results (name, passed)
select 'create_invite sets invited_by from the caller''s own membership, never a parameter',
       invited_by = :admin_membership and account_id = :acct_household and role = 'helper' and status = 'pending'
from public.invites where id = :created_invite_id;

reset role;

-- ---------------------------------------------------------------------------
-- AC-4: get_invite_preview() — anon-callable, exactly the five named fields,
-- and an effective status that folds an unexpired-but-past-`expires_at`
-- `pending` row to `expired` for display.
-- ---------------------------------------------------------------------------
insert into public.invites (email, account_id, role, invited_by)
values ('hook-probe@test.local', :acct_household, 'helper', :admin_membership)
returning token as hook_token \gset

insert into public.invites (email, account_id, role, invited_by, expires_at)
values ('expired-preview@test.local', :acct_household, 'helper', :admin_membership, now() - interval '1 day')
returning id as expired_invite_id, token as expired_token \gset

set local role anon;

insert into results (name, passed)
select 'anon can call get_invite_preview and sees only the five named fields',
       p.email = 'hook-probe@test.local' and p.role = 'helper' and p.status = 'pending' and p.account_name = 'Invites Household'
from public.get_invite_preview(:'hook_token'::uuid) p;

insert into results (name, passed)
select 'get_invite_preview reports a pending-but-past-expiry invite as expired',
       p.status = 'expired'
from public.get_invite_preview(:'expired_token'::uuid) p;

reset role;

-- ---------------------------------------------------------------------------
-- AC-5: check_signup_invite() — the Auth Hook contract, exercised directly
-- (event shape verified empirically against the running stack, see Dev
-- Notes). Allow returns `{}`; refuse returns `{"error": {"http_code", ...}}`.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'check_signup_invite allows a valid, unexpired, pending invite with age affirmed',
       public.check_signup_invite(jsonb_build_object(
         'user', jsonb_build_object(
           'email', 'hook-probe@test.local',
           'user_metadata', jsonb_build_object('invite_token', :'hook_token', 'age_affirmed', true)
         )
       )) = '{}'::jsonb;

insert into results (name, passed)
select 'check_signup_invite rejects with a 403 when age is not affirmed',
       (public.check_signup_invite(jsonb_build_object(
         'user', jsonb_build_object(
           'email', 'hook-probe@test.local',
           'user_metadata', jsonb_build_object('invite_token', :'hook_token', 'age_affirmed', false)
         )
       )) -> 'error' ->> 'http_code')::int = 403;

insert into results (name, passed)
select 'check_signup_invite rejects an unmatched email for a real token',
       public.check_signup_invite(jsonb_build_object(
         'user', jsonb_build_object(
           'email', 'someone-else@test.local',
           'user_metadata', jsonb_build_object('invite_token', :'hook_token', 'age_affirmed', true)
         )
       )) ? 'error';

insert into results (name, passed)
select 'check_signup_invite rejects a malformed invite_token without crashing',
       public.check_signup_invite(jsonb_build_object(
         'user', jsonb_build_object(
           'email', 'hook-probe@test.local',
           'user_metadata', jsonb_build_object('invite_token', 'not-a-uuid', 'age_affirmed', true)
         )
       )) ? 'error';

insert into results (name, passed)
select 'check_signup_invite rejects an expired invite even with the right email and affirmation',
       public.check_signup_invite(jsonb_build_object(
         'user', jsonb_build_object(
           'email', 'expired-preview@test.local',
           'user_metadata', jsonb_build_object('invite_token', :'expired_token', 'age_affirmed', true)
         )
       )) ? 'error';

insert into results (name, passed)
select 'check_signup_invite is unreachable by anon or authenticated directly',
       not has_function_privilege('anon', 'public.check_signup_invite(jsonb)', 'execute')
   and not has_function_privilege('authenticated', 'public.check_signup_invite(jsonb)', 'execute');

insert into results (name, passed)
select 'check_signup_invite is reachable by supabase_auth_admin (the GoTrue hook role)',
       has_function_privilege('supabase_auth_admin', 'public.check_signup_invite(jsonb)', 'execute');

-- ---------------------------------------------------------------------------
-- AC-6/AC-7 + review finding #4: handle_new_user() creates ONLY the members
-- profile row, never a membership — binding moved to accept_invite(),
-- gated on a real verified session (auth.uid()), not on the bare `/otp`
-- request that used to fire it via an AFTER INSERT trigger on auth.users.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'b0000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'hook-probe@test.local',
  jsonb_build_object('invite_token', :'hook_token', 'age_affirmed', true)
);

insert into results (name, passed)
select 'handle_new_user() creates the members profile row on signup',
       exists (select 1 from public.members where user_id = 'b0000000-0000-0000-0000-00000000b001');

insert into results (name, passed)
select 'handle_new_user() does NOT bind a membership at signup, even with a valid invite_token in metadata (review finding #4)',
       not exists (
         select 1 from public.account_members
         where user_id = 'b0000000-0000-0000-0000-00000000b001'
       );

insert into results (name, passed)
select 'the invite is still pending after signup alone, not yet accepted (review finding #4)',
       status = 'pending' and accepted_at is null
from public.invites where email = 'hook-probe@test.local';

insert into auth.users (id, instance_id, aud, role, email)
values ('c0000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-invite@test.local');

insert into results (name, passed)
select 'a signup with no invite_token at all gets NO membership (AC-7 fallback replaces the old first-user bootstrap)', count(*) = 0
from public.account_members where user_id = 'c0000000-0000-0000-0000-00000000c001';

-- ---------------------------------------------------------------------------
-- Review finding #4: accept_invite() — the ONLY place a membership is ever
-- bound. Requires a real authenticated caller (auth.uid()), and re-validates
-- the token AND the caller's own email against the invite (finding #3's
-- fix lives here: no code path can bind a membership from a bare token
-- anymore, only this definer function, and only for the session's own
-- email).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-00000000b001","role":"authenticated"}';

select public.accept_invite(:'hook_token'::uuid);

reset role;

insert into results (name, passed)
select 'accept_invite() binds the invite''s account_id/role/invited_by for the matching, authenticated caller',
       exists (
         select 1 from public.account_members
         where user_id = 'b0000000-0000-0000-0000-00000000b001'
           and account_id = :acct_household
           and role = 'helper'
           and status = 'active'
           and invited_by = :admin_membership
       );

insert into results (name, passed)
select 'the invite is marked accepted with a timestamp once accept_invite() succeeds',
       status = 'accepted' and accepted_at is not null
from public.invites where email = 'hook-probe@test.local';

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-00000000b001","role":"authenticated"}';

-- Note: `do $$ ... $$` blocks are dollar-quoted, so psql's `:'var'`
-- interpolation does NOT reach inside them (confirmed against the running
-- local stack) — every lookup below fetches its token from `public.invites`
-- by the email this script itself assigned, matching the existing
-- do-block convention above (the `ids` temp table for bigint values).
do $$
declare
  v_token uuid;
begin
  select token into v_token from public.invites where email = 'hook-probe@test.local';
  perform public.accept_invite(v_token);
  insert into results values ('accept_invite() is idempotent for a retry by the same already-bound caller', true, null);
exception when others then
  insert into results values ('accept_invite() is idempotent for a retry by the same already-bound caller', false, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'a retried accept_invite() call does not create a second account_members row',
       count(*) = 1
from public.account_members where user_id = 'b0000000-0000-0000-0000-00000000b001';

insert into auth.users (id, instance_id, aud, role, email)
values ('c0000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'someone-else@test.local');

insert into public.invites (email, account_id, role, invited_by)
values ('mismatch-probe@test.local', :acct_household, 'helper', :admin_membership)
returning token as mismatch_token \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000c004","role":"authenticated"}';

do $$
declare
  v_token uuid;
begin
  select token into v_token from public.invites where email = 'mismatch-probe@test.local';
  perform public.accept_invite(v_token);
  insert into results values ('accept_invite() refuses a caller whose own email does not match the invite (review finding #3)', false, 'call succeeded');
exception when others then
  insert into results values ('accept_invite() refuses a caller whose own email does not match the invite (review finding #3)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the mismatched-caller invite is left untouched (still pending)',
       status = 'pending' and accepted_at is null
from public.invites where token = :'mismatch_token'::uuid;

-- Explicit claims with NO "sub" (not merely `reset role`, which only
-- resets the DB role — `request.jwt.claims` is a separate, transaction-
-- scoped GUC that would otherwise still carry the previous block's stale
-- claims and silently mis-attribute this call to c004's session).
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';

do $$
declare
  v_token uuid;
begin
  select token into v_token from public.invites where email = 'hook-probe@test.local';
  perform public.accept_invite(v_token);
  insert into results values ('accept_invite() refuses an unauthenticated caller', false, 'call succeeded');
exception when others then
  insert into results values ('accept_invite() refuses an unauthenticated caller', true, sqlerrm);
end $$;

reset role;

insert into auth.users (id, instance_id, aud, role, email)
values (
  'c0000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'expired-preview@test.local'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000c003","role":"authenticated"}';

do $$
declare
  v_token uuid;
begin
  select token into v_token from public.invites where email = 'expired-preview@test.local';
  perform public.accept_invite(v_token);
  insert into results values ('accept_invite() refuses an expired invite even for the matching email (defense in depth)', false, 'call succeeded');
exception when others then
  insert into results values ('accept_invite() refuses an expired invite even for the matching email (defense in depth)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the expired invite is left untouched (still pending in storage, not silently accepted)',
       status = 'pending' and accepted_at is null
from public.invites where id = :expired_invite_id;

-- ---------------------------------------------------------------------------
-- AC-8/AC-9: structural regression guards — the last surviving definer view
-- and the admin-only write path are gone, at the catalog level.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'is_admin() no longer exists', to_regproc('public.is_admin') is null;

insert into results (name, passed)
select 'init_state view no longer exists', to_regclass('public.init_state') is null;

insert into results (name, passed)
select 'configuration has no insert/update policy left (service-role-only writes)',
       not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'configuration'
           and cmd in ('INSERT', 'UPDATE', 'ALL')
       );

insert into results (name, passed)
select 'configuration keeps its read policy for authenticated',
       exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'configuration' and cmd = 'SELECT'
       );

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
