--
-- Invite-only signup with 18+ affirmation (Epic 2, Story 2.7), extended by
-- Story 2.8 (invites as the one membership mechanism), by open signup
-- (removing the invite requirement), and by the retirement of the age gate
-- itself — database test suite.
--
-- Covers: the RLS/grant posture on `invites` (AC-2's escalation case — a
-- direct `authenticated` write must be refused even when it hand-crafts a
-- privileged role and a real `invited_by`), the `handle_new_user()`
-- invite-binding rewrite (AC-6/AC-7 — binds on a matching signup, creates
-- NO membership on an unmatched or malformed one), `create_invite()`'s
-- authority/kind checks (AC-3), `get_invite_preview()`'s five-field,
-- effective-status shape (AC-4), the absence of the retired
-- `check_signup_age()` Auth Hook and its `public.signup_intents` table
-- (originally AC-5 — see that section's own comment for what they did and
-- why nothing replaces them), and (Story 2.8
-- AC-3) `revoke_invite()`'s guard cases: a non-owning caller can never
-- revoke, an already-accepted invite can never be revoked, a pending
-- invite in a different context (not the caller's active one) is invisible
-- to it entirely, and the happy path actually flips status to 'revoked'.
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

insert into ids values ('created_invite_id', :created_invite_id);

-- ---------------------------------------------------------------------------
-- Story 2.8 AC-3: revoke_invite() — a non-owning caller can never revoke;
-- an already-accepted invite can never be revoked (that member is already
-- in — removing them is Story 2.5's persona-removal path, a different
-- action for a different state); a pending invite in a DIFFERENT context
-- (not the caller's active one) is invisible to revoke_invite() entirely,
-- the same current_context_id() predicate the "Invites readable within
-- active account" SELECT policy uses, not a distinct "you don't have
-- permission" branch (05_policies.sql, revoke_invite()'s own comment); and
-- the happy path actually flips status to 'revoked'.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a002","role":"authenticated"}';

do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'created_invite_id';
  perform public.revoke_invite(v_invite_id);
  insert into results values ('revoke_invite refuses a non-owning caller (helper)', false, 'call succeeded');
exception when others then
  insert into results values ('revoke_invite refuses a non-owning caller (helper)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'a non-owning caller''s refused revoke_invite() call leaves the invite pending',
       status = 'pending'
from public.invites where id = :created_invite_id;

-- An already-accepted invite: a real member now, not "revocable".
insert into public.invites (email, account_id, role, invited_by, status, accepted_at)
values ('already-accepted@test.local', :acct_household, 'helper', :admin_membership, 'accepted', now())
returning id as accepted_invite_id \gset
insert into ids values ('accepted_invite_id', :accepted_invite_id);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'accepted_invite_id';
  perform public.revoke_invite(v_invite_id);
  insert into results values ('revoke_invite refuses an already-accepted invite', false, 'call succeeded');
exception when others then
  insert into results values ('revoke_invite refuses an already-accepted invite', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the accepted invite is left untouched by the refused revoke', status = 'accepted'
from public.invites where id = :accepted_invite_id;

-- Cross-context invisibility: a caller with a real, invite-capable active
-- membership in TWO accounts can only ever revoke_invite() in whichever one
-- is their CURRENT active context — never the other, even though they hold
-- genuine authority there too.
insert into auth.users (id, instance_id, aud, role, email)
values ('a0000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invites-crosscontext@test.local');

insert into public.accounts (name, kind) values ('Cross-Context Household', 'household') returning id as acct_crosscontext \gset

-- Inserted FIRST for this user, so activate_first_context_trigger (Story
-- 2.1) makes it their active context — the second membership below is a
-- deliberate member_state no-op while the first stays live.
insert into public.account_members (account_id, user_id, role, status)
values (:acct_crosscontext, 'a0000000-0000-0000-0000-00000000a005', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_shadchanus, 'a0000000-0000-0000-0000-00000000a005', 'shadchan', 'active');

insert into public.invites (email, account_id, role, invited_by)
values ('cross-context-target@test.local', :acct_shadchanus, 'shadchan', :shadchan_membership)
returning id as crosscontext_invite_id \gset
insert into ids values ('crosscontext_invite_id', :crosscontext_invite_id);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a005","role":"authenticated"}';

do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'crosscontext_invite_id';
  perform public.revoke_invite(v_invite_id);
  insert into results values ('revoke_invite is blind to a pending invite in a different, non-active context — even with real authority there', false, 'call succeeded');
exception when others then
  insert into results values ('revoke_invite is blind to a pending invite in a different, non-active context — even with real authority there', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the cross-context invite is left untouched (still pending)', status = 'pending'
from public.invites where id = :crosscontext_invite_id;

-- The happy path: an owning caller revoking a real pending invite in their
-- OWN current context actually flips status to 'revoked'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select public.revoke_invite(:created_invite_id);

reset role;

insert into results (name, passed)
select 'revoke_invite() sets status to revoked for an owning caller''s own pending invite',
       status = 'revoked'
from public.invites where id = :created_invite_id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'created_invite_id';
  perform public.revoke_invite(v_invite_id);
  insert into results values ('revoke_invite refuses to re-revoke an already-revoked invite', false, 'call succeeded');
exception when others then
  insert into results values ('revoke_invite refuses to re-revoke an already-revoked invite', true, sqlerrm);
end $$;

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
-- The signup age-gate is RETIRED, and these assert that it really is gone
-- rather than merely unused. It was a `before_user_created` Auth Hook,
-- check_signup_age(), that 403'd any signup which had not affirmed 18+ —
-- either directly in the email/OTP signup's user_metadata, or via a
-- short-lived public.signup_intents row, which was the ONLY way an
-- affirmation could cross a Google OAuth redirect (signInWithOAuth() cannot
-- set user_metadata). Requiring that row is what forced /register's Google
-- button to demand a typed email before redirecting, for a button whose
-- whole point is that Google already knows who you are.
--
-- The affirmation is now made by the act of creating an account and stated
-- as such in the UI (`AgeNotice`), so there is nothing left to transmit and
-- nothing left for a hook to verify. Both objects are dropped — the table
-- especially, because check_signup_age() was also its only sweeper (no
-- pg_cron in this repo), so an orphaned anon-INSERTable table with no
-- consumer would grow without bound.
--
-- .github/workflows/deploy.yml PATCHes the hosted project's hook setting
-- OFF before `db push` drops the function; a project still naming a dropped
-- function answers every signup with a GoTrue 500.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'the check_signup_age() Auth Hook function no longer exists',
       not exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'check_signup_age');

insert into results (name, passed)
select 'public.signup_intents no longer exists, so nothing anon-writable is left unswept',
       to_regclass('public.signup_intents') is null;

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
  jsonb_build_object('invite_token', :'hook_token')
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
-- Story 6.1: a single joins the household — invites.target_single_id,
-- create_invite()'s target checks, and accept_invite()'s atomic
-- singles.member_id link. Reuses this file's existing household A
-- (acct_household, admin_membership/helper_membership) and adds ONE more
-- account (household B) purely so AC-5's cross-tenant case has a genuinely
-- foreign singles.id to name.
-- ---------------------------------------------------------------------------
-- A dedicated, RLS-free temp table for the two invite tokens below (this
-- file's shared `ids` table stores bigint values only, and a uuid token has
-- to survive an identity switch to the newly-linked `single` caller — who
-- cannot read `public.invites` at all once linked, per AC-6 below — so a
-- lookup by email against the real table from inside that caller's own DO
-- block would silently resolve to no rows, not a test bug that shows up as
-- a wrong assertion).
create temp table invite_tokens (name text primary key, token uuid) on commit drop;
grant all on invite_tokens to public;

insert into public.singles (account_id, first_name_en)
values (:acct_household, 'Chana')
returning id as target_single_id \gset
insert into ids values ('target_single_id', :target_single_id);

insert into public.accounts (name, kind) values ('Invites Household B', 'household')
returning id as acct_household_b \gset

insert into public.singles (account_id, first_name_en)
values (:acct_household_b, 'Foreign Single')
returning id as foreign_single_id \gset
insert into ids values ('foreign_single_id', :foreign_single_id);

-- AC-5: a direct insert (as postgres — authenticated holds no insert grant
-- at all, proven above) naming another household's singles.id fails at the
-- composite FK, never an application check. Asserts the specific FK
-- SQLSTATE (23503), not merely "an error was raised" — a suite that passes
-- on any exception cannot tell this apart from a typo or a dropped
-- constraint.
do $$
declare v_acct bigint; v_foreign_single bigint;
begin
  select value into v_acct from ids where name = 'acct_household';
  select value into v_foreign_single from ids where name = 'foreign_single_id';
  insert into public.invites (email, account_id, role, target_single_id)
  values ('cross-tenant-target@test.local', v_acct, 'single', v_foreign_single);
  insert into results values ('AC5: an invite naming another household''s single fails the composite FK', false, 'insert succeeded');
exception when others then
  insert into results values ('AC5: an invite naming another household''s single fails the composite FK', sqlstate = '23503', sqlerrm);
end $$;

-- AC-5: role/target coupling — a non-single role with a target, and a
-- single role with no target, each fail invites_role_target_check (SQLSTATE
-- 23514), independent of create_invite()'s own named-exception mirror of
-- the same rule below.
do $$
declare v_acct bigint; v_target bigint;
begin
  select value into v_acct from ids where name = 'acct_household';
  select value into v_target from ids where name = 'target_single_id';
  insert into public.invites (email, account_id, role, target_single_id)
  values ('role-target-mismatch@test.local', v_acct, 'helper', v_target);
  insert into results values ('AC5: a non-single-role invite with a target fails invites_role_target_check', false, 'insert succeeded');
exception when others then
  insert into results values ('AC5: a non-single-role invite with a target fails invites_role_target_check', sqlstate = '23514', sqlerrm);
end $$;

do $$
declare v_acct bigint;
begin
  select value into v_acct from ids where name = 'acct_household';
  insert into public.invites (email, account_id, role)
  values ('single-no-target@test.local', v_acct, 'single');
  insert into results values ('AC5: a single-role invite with no target fails invites_role_target_check', false, 'insert succeeded');
exception when others then
  insert into results values ('AC5: a single-role invite with no target fails invites_role_target_check', sqlstate = '23514', sqlerrm);
end $$;

-- AC-2/AC-4: create_invite()'s own UX-layer mirrors of the same two rules —
-- named exceptions, not bare constraint violations — plus the "target
-- outside my account" case the composite FK alone cannot distinguish from
-- "target doesn't exist" at this layer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
begin
  perform public.create_invite('no-target@test.local', 'single');
  insert into results values ('create_invite refuses a single-role invite with no target', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses a single-role invite with no target', sqlerrm like '%single-role invite requires a target single%', sqlerrm);
end $$;

do $$
declare v_foreign_single bigint;
begin
  select value into v_foreign_single from ids where name = 'foreign_single_id';
  perform public.create_invite('foreign-target@test.local', 'single', v_foreign_single);
  insert into results values ('create_invite refuses a target single outside the caller''s account', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses a target single outside the caller''s account', sqlerrm like 'single % not found in current account', sqlerrm);
end $$;

-- The success path: two invites against the SAME still-unlinked target —
-- the second is what proves AC-4's race guard below rather than merely a
-- creation-time refusal (a naive re-check-then-accept implementation could
-- pass a pre-check and still race).
select (public.create_invite('chana-first@test.local', 'single', :target_single_id)).token as chana_first_token \gset
select (public.create_invite('chana-second@test.local', 'single', :target_single_id)).token as chana_second_token \gset

reset role;

insert into invite_tokens values
  ('chana_first', :'chana_first_token'::uuid),
  ('chana_second', :'chana_second_token'::uuid);

insert into results (name, passed)
select 'create_invite sets target_single_id on a single-role invite',
       target_single_id = :target_single_id and role = 'single'
from public.invites where token = :'chana_first_token'::uuid;

-- AC-3: acceptance creates exactly one account_members row AND, in the same
-- statement, links singles.member_id to it.
insert into auth.users (id, instance_id, aud, role, email)
values ('61810000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chana-first@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"61810000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.accept_invite(:'chana_first_token'::uuid);

reset role;

insert into results (name, passed)
select 'AC3: accept_invite() creates exactly one account_members row for the invited single',
       count(*) = 1
from public.account_members where user_id = '61810000-0000-0000-0000-000000000001';

insert into results (name, passed)
select 'AC3: accept_invite() links singles.member_id to the new membership''s id, in the same statement',
       exists (
         select 1 from public.singles s
         join public.account_members am on am.user_id = '61810000-0000-0000-0000-000000000001'
         where s.id = :target_single_id and s.member_id = am.id
       );

-- AC-4: the idempotent-retry branch is preserved for a linked single — a
-- page-reload retry by the SAME already-bound caller is still a silent
-- no-op, never an error, because it returns before this story's linking
-- code is ever reached.
set local role authenticated;
set local request.jwt.claims = '{"sub":"61810000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare v_token uuid;
begin
  select token into v_token from invite_tokens where name = 'chana_first';
  perform public.accept_invite(v_token);
  insert into results values ('AC4: a repeat accept_invite() by the same already-linked caller is still a silent no-op', true, null);
exception when others then
  insert into results values ('AC4: a repeat accept_invite() by the same already-linked caller is still a silent no-op', false, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC4: the retry did not create a second account_members row',
       count(*) = 1
from public.account_members where user_id = '61810000-0000-0000-0000-000000000001';

-- AC-4: create_invite() also refuses the now-linked target at creation
-- time (UX), independent of the race case below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
declare v_target bigint;
begin
  select value into v_target from ids where name = 'target_single_id';
  perform public.create_invite('too-late@test.local', 'single', v_target);
  insert into results values ('create_invite refuses an already-linked target at creation time', false, 'call succeeded');
exception when others then
  insert into results values ('create_invite refuses an already-linked target at creation time', sqlerrm like 'single % not found in current account', sqlerrm);
end $$;

reset role;

-- AC-4: the race case — a SECOND invite (created earlier, while the target
-- was still unlinked) accepted AFTER the first one already linked it raises
-- a named exception, and leaves BOTH the single's member_id and the second
-- invite's own status untouched (the rollback of the accepted-status claim
-- Task 3 describes) — re-selected and compared, not merely "an error was
-- raised".
insert into auth.users (id, instance_id, aud, role, email)
values ('61810000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chana-second@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"61810000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare v_token uuid;
begin
  select token into v_token from invite_tokens where name = 'chana_second';
  perform public.accept_invite(v_token);
  insert into results values ('AC4: a second invite accepted against an already-linked single raises', false, 'call succeeded');
exception when others then
  insert into results values (
    'AC4: a second invite accepted against an already-linked single raises',
    sqlerrm like 'single % is already linked to a login, or does not belong to this household',
    sqlerrm
  );
end $$;

reset role;
-- Clear the claims as well as the role, for the reason spelled out at the
-- top of the mismatched-caller block above: `reset role` restores the DB
-- role but leaves `request.jwt.claims` — a separate, transaction-scoped
-- GUC — still carrying the previous block's `sub`. The `insert into
-- public.tasks` further down this block sends no member_id, so
-- set_member_id_default() would resolve auth.uid() to that stale user,
-- who holds no active membership in :acct_household, and Story 12.3's
-- validate_task_assignee trigger would (correctly) reject the insert.
set local request.jwt.claims = '{}';

insert into results (name, passed)
select 'AC4: the already-linked single''s member_id is unchanged after the refused second acceptance',
       exists (
         select 1 from public.singles s
         join public.account_members am on am.user_id = '61810000-0000-0000-0000-000000000001'
         where s.id = :target_single_id and s.member_id = am.id
       );

insert into results (name, passed)
select 'AC4: the refused second invite is still pending — the accepted-status claim rolled back too',
       status = 'pending' and accepted_at is null
from public.invites where email = 'chana-second@test.local';

insert into results (name, passed)
select 'AC4: the refused second acceptance created no account_members row for its own caller',
       count(*) = 0
from public.account_members where user_id = '61810000-0000-0000-0000-000000000002';

-- AC-6: the newly-linked single's very first authenticated read is already
-- scoped by Stories 6.2/6.3's policies — one visible suggestion (her own,
-- look_into+shared), her own invisible 'new' suggestion stays invisible,
-- zero rows on two of 6.2's deny tables (tasks; invites — the latter
-- despite this account already holding many rows, seeded across this whole
-- file), zero rows on one of 6.3's deny tables (entity_files), and
-- own-row-only on account_members (the household now has three real
-- members: the admin, the helper, and this newly-linked single).
insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:acct_household, :target_single_id, 'Chana Visible Suggestion', 'shared', 'look_into')
returning id as chana_visible_shidduch_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:acct_household, :target_single_id, 'Chana New Suggestion', 'shared', 'new')
returning id as chana_new_shidduch_id \gset

insert into public.tasks (account_id, target_type, target_id, text)
values (:acct_household, 'shidduch', :chana_visible_shidduch_id, 'Follow up with Chana');

insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes)
values (
  :acct_household, 'shidduch', :chana_visible_shidduch_id,
  :'acct_household' || '/x/y.pdf', 'y.pdf', 'application/pdf', 1
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"61810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC6: the newly-linked single sees exactly one shidduch — her own visible suggestion',
       (select count(*) from public.shidduchim) = 1
       and exists (select 1 from public.shidduchim where id = :chana_visible_shidduch_id);

insert into results (name, passed)
select 'AC6: the newly-linked single cannot see her own invisible ''new'' suggestion',
       not exists (select 1 from public.shidduchim where id = :chana_new_shidduch_id);

insert into results (name, passed)
select 'AC6: the newly-linked single sees zero rows on tasks (6.2 deny table)',
       (select count(*) from public.tasks) = 0;

insert into results (name, passed)
select 'AC6: the newly-linked single sees zero rows on invites (6.2 denies the whole table, even though this account holds many)',
       (select count(*) from public.invites) = 0;

insert into results (name, passed)
select 'AC6: the newly-linked single sees zero rows on entity_files (6.3 deny table)',
       (select count(*) from public.entity_files) = 0;

insert into results (name, passed)
select 'AC6: the newly-linked single sees exactly her own account_members row, never the household roster',
       (select count(*) from public.account_members) = 1;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

insert into results (name, passed)
select 'AC6 control: the parent''s session sees the full household roster (this account''s other suite fixtures included) in the same test run',
       (select count(*) from public.account_members where account_id = :acct_household) = 4;

reset role;

-- ---------------------------------------------------------------------------
-- Pre-Epic-6 `role = 'single'` invites with no target: the row shape only a
-- PRODUCTION database has.
--
-- Epic 2 shipped `single` as an ordinary invitable household role two epics
-- before Story 6.1 added `target_single_id`, so real accounts carry pending
-- `single` invites with a null target. Story 6.1 deliberately added
-- `invites_role_target_check` as `not valid` (the migration-data-safety guard
-- forbids both backfilling and deleting a pre-existing row), and `not valid`
-- exempts ONLY the rows that already existed — every subsequent INSERT *and
-- UPDATE* is still checked. So `update invites set status = ...` on such a row
-- raises a bare 23514, which is what accept_invite() was given a guard for and
-- revoke_invite() was not: clicking Revoke surfaced a raw constraint violation.
--
-- Reproduced exactly the way production got there — drop the constraint,
-- insert, re-add it `not valid` — rather than by switching constraint checking
-- off wholesale, so the row is genuinely constraint-violating and genuinely
-- exempt, like its production counterpart.
alter table public.invites drop constraint invites_role_target_check;

insert into public.invites (email, account_id, role, invited_by, status)
select 'legacy-single@test.local', :acct_household, 'single', am.id, 'pending'
from public.account_members am
where am.account_id = :acct_household and am.user_id = 'a0000000-0000-0000-0000-00000000a001'
returning id as legacy_invite_id, token as legacy_invite_token \gset

alter table public.invites
  add constraint invites_role_target_check
  check (((role = 'single') = (target_single_id is not null))) not valid;

-- Through the shared `ids` / `invite_tokens` tables, never a psql variable:
-- psql does not interpolate `:name` inside a dollar-quoted `do $$ ... $$`
-- body, so every check below reads its id back out of a table (the same shape
-- every other do-block in this file uses).
insert into ids values ('legacy_invite', :legacy_invite_id);
insert into invite_tokens values ('legacy_single', :'legacy_invite_token'::uuid);

-- The mechanism, pinned first: without it the two checks below could pass for
-- the wrong reason (a constraint that had quietly stopped applying).
do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'legacy_invite';
  update public.invites set status = 'revoked' where id = v_invite_id;
  insert into results values (
    'legacy single-invite: a bare UPDATE on the pre-existing row still violates the NOT VALID constraint (the mechanism both guards exist for)',
    false, 'update succeeded — the constraint is no longer enforced on UPDATE'
  );
exception when check_violation then
  insert into results values (
    'legacy single-invite: a bare UPDATE on the pre-existing row still violates the NOT VALID constraint (the mechanism both guards exist for)',
    sqlstate = '23514', sqlstate || ' ' || sqlerrm
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000a001","role":"authenticated"}';

-- BLOCKER: revoke_invite() reached that UPDATE unguarded and raised the bare
-- 23514 at the admin. It now refuses in its own vocabulary — asserted on the
-- MESSAGE, not merely on "an error was raised", because a bare constraint
-- violation would satisfy the weaker claim.
do $$
declare v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'legacy_invite';
  perform public.revoke_invite(v_invite_id);
  insert into results values (
    'revoke_invite() refuses a pre-Epic-6 targetless single invite in its own words, never a bare 23514',
    false, 'call succeeded'
  );
exception when others then
  insert into results values (
    'revoke_invite() refuses a pre-Epic-6 targetless single invite in its own words, never a bare 23514',
    sqlerrm like '%predates single-invite targeting%', sqlstate || ' ' || sqlerrm
  );
end $$;

reset role;

insert into results (name, passed)
select 'revoke_invite()''s refusal left the legacy invite untouched — no half-written status',
       status = 'pending'
from public.invites where id = (select value from ids where name = 'legacy_invite');

-- The sibling guard accept_invite() already had, asserted in the same place so
-- the pair cannot drift apart again: the same row is equally unusable from the
-- invitee's side, and says so in the same shared vocabulary every unhonourable
-- invite gets.
insert into auth.users (id, instance_id, aud, role, email)
values ('61810000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legacy-single@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"61810000-0000-0000-0000-000000000009","role":"authenticated"}';

do $$
declare v_token uuid;
begin
  select token into v_token from invite_tokens where name = 'legacy_single';
  perform public.accept_invite(v_token);
  insert into results values (
    'accept_invite() refuses the same pre-Epic-6 targetless single invite (the sibling guard, pinned so the pair cannot drift)',
    false, 'call succeeded'
  );
exception when others then
  insert into results values (
    'accept_invite() refuses the same pre-Epic-6 targetless single invite (the sibling guard, pinned so the pair cannot drift)',
    sqlerrm like '%invalid, expired, or has already been used%', sqlstate || ' ' || sqlerrm
  );
end $$;

reset role;

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
