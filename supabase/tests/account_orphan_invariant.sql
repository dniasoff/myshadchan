-- Proof for the no-orphan invariant.
--
-- An account with no ACTIVE membership is unreachable forever, so the product
-- must never commit one. This suite proves both halves: the code paths delete
-- such an account (or keep it reachable), and the database REJECTS the state
-- if a future path forgets.
--
-- The constraint triggers are DEFERRABLE INITIALLY DEFERRED, so they fire at
-- COMMIT -- and every suite in this directory runs inside `begin; ... rollback;`,
-- which means a naive test would never fire them once and would pass whether
-- or not they exist. Each negative case therefore forces the check with
-- `set constraints all immediate` and restores `deferred` afterwards.
\set ON_ERROR_STOP on
begin;

create temporary table orphan_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on orphan_checks to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('0a1a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orphan-owner@test.invalid'),
  ('0a1a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orphan-other@test.invalid');

create or replace function pg_temp.new_household(p_label text, p_user uuid, p_demo boolean default false)
  returns bigint language plpgsql as $fn$
declare v_acct bigint;
begin
  insert into public.accounts (name, kind, demo) values (p_label, 'household', false) returning id into v_acct;
  insert into public.account_members (account_id, user_id, role, status)
  values (v_acct, p_user, 'parent_admin', 'active');
  if p_demo then
    update public.accounts set demo = true where id = v_acct;
  end if;
  return v_acct;
end $fn$;

-- ============================================================ THE INVARIANT
-- 1. Archiving an account's last active membership is REJECTED at the check.
select pg_temp.new_household('orphan reject hh', '0a1a0000-0000-0000-0000-000000000001') as reject_acct \gset
do $$
begin
  update public.account_members set status = 'archived' where account_id = (select id from public.accounts where name = 'orphan reject hh');
  set constraints all immediate;
  insert into orphan_checks values ('archiving the last active membership is REJECTED', false, 'commit-time check did not fire');
exception when check_violation then
  insert into orphan_checks values ('archiving the last active membership is REJECTED', true, sqlerrm);
when others then
  insert into orphan_checks values ('archiving the last active membership is REJECTED', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- 2. Deleting it outright is rejected the same way (the DELETE arm).
do $$
begin
  delete from public.account_members where account_id = (select id from public.accounts where name = 'orphan reject hh');
  set constraints all immediate;
  insert into orphan_checks values ('deleting the last active membership is REJECTED', false, 'commit-time check did not fire');
exception when check_violation then
  insert into orphan_checks values ('deleting the last active membership is REJECTED', true, sqlerrm);
when others then
  insert into orphan_checks values ('deleting the last active membership is REJECTED', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- 3. Creating an account with no membership at all is rejected (the other
--    way into the state, which a members-only trigger cannot see).
do $$
begin
  insert into public.accounts (name, kind) values ('orphan bare hh', 'household');
  set constraints all immediate;
  insert into orphan_checks values ('creating an account with no membership is REJECTED', false, 'commit-time check did not fire');
exception when check_violation then
  insert into orphan_checks values ('creating an account with no membership is REJECTED', true, sqlerrm);
when others then
  insert into orphan_checks values ('creating an account with no membership is REJECTED', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- 4. ...but an account is legitimately memberless MID-transaction, which is
--    why the triggers are deferred. add_persona() inserts the account, then
--    the membership; an immediate check would break every signup.
do $$
declare v_acct bigint;
begin
  insert into public.accounts (name, kind) values ('orphan two-step hh', 'household') returning id into v_acct;
  insert into public.account_members (account_id, user_id, role, status)
  values (v_acct, '0a1a0000-0000-0000-0000-000000000002', 'parent_admin', 'active');
  set constraints all immediate;
  insert into orphan_checks values ('an account memberless only mid-transaction is ACCEPTED', true, 'account ' || v_acct);
exception when others then
  insert into orphan_checks values ('an account memberless only mid-transaction is ACCEPTED', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- 5. A demo account is exempt while flagged: its graph is half-built for many
--    transactions and its run manifest owns the cleanup. The exemption lifts
--    when the flag is released, which is the transition that used to leak.
select pg_temp.new_household('orphan demo hh', '0a1a0000-0000-0000-0000-000000000002', true) as demo_acct \gset
do $$
begin
  update public.account_members set status = 'archived' where account_id = (select id from public.accounts where name = 'orphan demo hh');
  set constraints all immediate;
  insert into orphan_checks values ('a flagged demo account is EXEMPT while its lifecycle owns it', true, null);
exception when others then
  insert into orphan_checks values ('a flagged demo account is EXEMPT while its lifecycle owns it', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- 6. ...and releasing the flag on that same memberless account is rejected --
--    the exact shape finalize_demo_clear() used to commit.
do $$
begin
  update public.accounts set demo = false where name = 'orphan demo hh';
  set constraints all immediate;
  insert into orphan_checks values ('releasing the demo flag on a memberless account is REJECTED', false, 'commit-time check did not fire');
exception when check_violation then
  insert into orphan_checks values ('releasing the demo flag on a memberless account is REJECTED', true, sqlerrm);
when others then
  insert into orphan_checks values ('releasing the demo flag on a memberless account is REJECTED', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- ============================================================== THE DISPOSER
-- 7. It deletes a memberless, empty account, and releases -- rather than
--    cascades away -- the two references that must outlive it.
select pg_temp.new_household('orphan dispose hh', '0a1a0000-0000-0000-0000-000000000001') as dispose_acct \gset
insert into public.demo_onboarding_intents (user_id, account_id, state, attempts)
values ('0a1a0000-0000-0000-0000-000000000001', :'dispose_acct', 'completed', 2);
insert into public.member_state (user_id, active_account_id)
values ('0a1a0000-0000-0000-0000-000000000001', :'dispose_acct')
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
update public.account_members set status = 'archived' where account_id = :'dispose_acct';
select public.dispose_orphaned_account(:'dispose_acct') as disposed \gset

insert into orphan_checks
select 'dispose deletes a memberless empty account and its archived rows',
  :'disposed'::boolean
  and not exists (select 1 from public.accounts where id = :'dispose_acct')
  and not exists (select 1 from public.account_members where account_id = :'dispose_acct');

insert into orphan_checks
select 'the caller''s onboarding intent SURVIVES with its attempts counter',
  exists (
    select 1 from public.demo_onboarding_intents
    where user_id = '0a1a0000-0000-0000-0000-000000000001'
      and account_id is null and attempts = 2
  );

insert into orphan_checks
select 'the active-context pointer is released, not left dangling',
  exists (
    select 1 from public.member_state
    where user_id = '0a1a0000-0000-0000-0000-000000000001' and active_account_id is null
  );

-- 8. It REFUSES an account that still holds a live membership.
select pg_temp.new_household('orphan live hh', '0a1a0000-0000-0000-0000-000000000002') as live_acct \gset
insert into orphan_checks
select 'dispose REFUSES an account that still has a live member',
  public.dispose_orphaned_account(:'live_acct') is false
  and exists (select 1 from public.accounts where id = :'live_acct');

-- 9. It REFUSES on the fence account_has_domain_data() does not cover. A
--    subscription is the server-authoritative AI entitlement record; the old
--    guard let an account holding only this one be orphaned.
select pg_temp.new_household('orphan billing hh', '0a1a0000-0000-0000-0000-000000000001') as billing_acct \gset
insert into public.subscription (account_id, plan, status) values (:'billing_acct', 'ai', 'active');
update public.account_members set status = 'archived' where account_id = :'billing_acct';
insert into orphan_checks
select 'dispose REFUSES an account holding only a subscription',
  public.dispose_orphaned_account(:'billing_acct') is false
  and exists (select 1 from public.accounts where id = :'billing_acct')
  and exists (select 1 from public.subscription where account_id = :'billing_acct');
update public.account_members set status = 'active' where account_id = :'billing_acct';

-- 10. The guard now asks that same question, so the two outcomes are
--     exhaustive: an account it refuses to orphan is one the disposer would
--     also refuse. Under the old account_has_domain_data() test this passed
--     and produced an orphan holding a real subscription.
do $$
declare v_membership bigint;
begin
  select id into v_membership from public.account_members
  where account_id = (select id from public.accounts where name = 'orphan billing hh');
  perform public.guard_persona_removal(v_membership, (select id from public.accounts where name = 'orphan billing hh'));
  insert into orphan_checks values ('guard_persona_removal REFUSES to orphan a billing account', false, 'guard allowed it');
exception when check_violation then
  insert into orphan_checks values ('guard_persona_removal REFUSES to orphan a billing account', true, sqlerrm);
end $$;

-- ============================================== CATALOG-DERIVED COMPLETENESS
-- 11. Every account-scoped base table must be named in the fence. Derived
--     from the catalog, never hand-listed: a table added by a future story is
--     covered from the moment it exists, whether or not that story's author
--     knows this fence is here. A table that deliberately does NOT block is
--     named in the function's own prose, with its reason.
do $$
declare
  -- Both halves of the fence: account_is_disposable() delegates the domain
  -- tables to account_has_domain_data(), so checking only the former reports
  -- covered tables as missing. The union is the real fence.
  v_def text := pg_get_functiondef('public.account_is_disposable(bigint)'::regprocedure)
             || pg_get_functiondef('public.account_has_domain_data(bigint)'::regprocedure);
  v_missing text[];
begin
  select array_agg(distinct c.relname order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname in (
      'account_id', 'household_account_id', 'shadchanus_account_id',
      'proposer_account_id', 'grantee_account_id', 'inviter_account_id',
      'accepted_by_account_id', 'root_account_id'
    )
    and position(c.relname in v_def) = 0;

  insert into orphan_checks
  values ('every account-scoped table is named in the disposability fence',
          v_missing is null,
          coalesce(array_to_string(v_missing, ', '), 'all covered'));
end $$;

-- ================================================== THE DEMO ENDS: NO HUSK
-- The production shape. finalize_demo_clear() ran on every successful clear
-- and committed exactly the state check 6 above now rejects: bootstrap
-- membership archived, `demo` released, root RETAINED and unreachable. A
-- fresh root was built on the next demo, so the husks accumulated forever.
create or replace function pg_temp.clearing_run(p_label text, p_user uuid, p_token text)
  returns bigint language plpgsql as $fn$
declare v_acct bigint; v_run bigint;
begin
  v_acct := pg_temp.new_household(p_label, p_user, true);
  insert into public.member_state (user_id, active_account_id) values (p_user, v_acct)
    on conflict (user_id) do update set active_account_id = excluded.active_account_id;
  insert into public.demo_runs (
    root_account_id, status, seed_version, lease_epoch,
    lease_token, lease_expires_at, operation, original_root_name
  )
  values (v_acct, 'clearing', 'official-onboarding-v1', 1,
          p_token, now() + interval '1 hour', 'clear', p_label)
  returning id into v_run;
  insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
  values (v_run, v_acct, 'primary-household', 'household', true);
  insert into public.demo_run_member_state (run_id, user_id, original_active_account_id, original_updated_at)
  values (v_run, p_user, v_acct, now());
  return v_run;
end $fn$;

select pg_temp.clearing_run('orphan release hh', '0a1a0000-0000-0000-0000-000000000001', 'orphan-release-lease') as release_run \gset
select root_account_id as release_acct from public.demo_runs where id = :'release_run' \gset
select public.finalize_demo_clear(:'release_run', 'orphan-release-lease', true, true, '0a1a0000-0000-0000-0000-000000000001') as release_result \gset

insert into orphan_checks
select 'a release clear DELETES the root household instead of stranding it',
  not exists (select 1 from public.accounts where id = :'release_acct')
  and not exists (select 1 from public.account_members where account_id = :'release_acct'),
  :'release_result';

-- The state finalize just committed must itself satisfy the invariant. If it
-- had retained the root, this is where it would fail.
do $$
begin
  set constraints all immediate;
  insert into orphan_checks values ('the post-clear state satisfies the invariant', true, null);
exception when others then
  insert into orphan_checks values ('the post-clear state satisfies the invariant', false, sqlstate || ' ' || sqlerrm);
end $$;
set constraints all deferred;

-- Retry idempotency is the sharp edge: clear succeeds, the response is lost,
-- the client calls clear_demo again, and it must still answer "already
-- cleared" from the ledger -- now with the root account GONE. The receipt
-- carries no FK for exactly this reason.
insert into orphan_checks
select 'a lost clear response is still answerable once the root is deleted',
  public.get_demo_release_receipt('0a1a0000-0000-0000-0000-000000000001') is not null
  and (public.get_demo_release_receipt('0a1a0000-0000-0000-0000-000000000001') ->> 'root_account_id')::bigint = :'release_acct'::bigint;

-- ...and the reseed path must NOT delete it: admin_reseed clears with
-- p_release_demo = false because it is about to seed the same root again.
select pg_temp.clearing_run('orphan reseed hh', '0a1a0000-0000-0000-0000-000000000002', 'orphan-reseed-lease') as reseed_run \gset
select root_account_id as reseed_acct from public.demo_runs where id = :'reseed_run' \gset
select public.finalize_demo_clear(:'reseed_run', 'orphan-reseed-lease', false, false, '0a1a0000-0000-0000-0000-000000000002');

insert into orphan_checks
select 'a reseed clear KEEPS the root, with its membership still live',
  exists (select 1 from public.accounts where id = :'reseed_acct' and demo is true)
  and exists (
    select 1 from public.account_members
    where account_id = :'reseed_acct' and status = 'active'
  );

-- The guard must not be blinded by the RLS on its own subject: `accounts`
-- and `account_members` are FORCE row level security, and a SECURITY INVOKER
-- trigger reading them would see a hidden active membership as an orphan and
-- a hidden account as already-deleted.
insert into orphan_checks
select 'the invariant reads its subject without RLS filtering it',
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assert_account_not_orphaned');

-- ==================================================================== GRANTS
insert into orphan_checks
select 'no client role may delete an account through the disposer',
  not has_function_privilege('authenticated', 'public.dispose_orphaned_account(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.dispose_orphaned_account(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.account_is_disposable(bigint)', 'execute')
  and has_function_privilege('service_role', 'public.dispose_orphaned_account(bigint)', 'execute');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from orphan_checks;

rollback;
