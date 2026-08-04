--
-- Context-aware authorisation (Story 2.1, AD-19) and persona/context data
-- model (Story 2.2, AD-2) — database test suite.
--
-- Story 2.1 covers what it replaced: current_context_id() resolves a user's
-- explicit, server-held active context (member_state) rather than an
-- arbitrary membership, and every RLS policy that used to read
-- current_account_id() reads it. Story 2.2 extends this file (rather than
-- starting a third RLS suite) with: enforce_household_scope() on the 11
-- household-only domain tables (13 originally; Story 3.14 dropped
-- interactions/tasks from the set — see household_scope_lift.sql for that
-- story's own suite), enforce_membership_role_matches_context() on
-- account_members, add_persona()/my_personas() provisioning and reporting,
-- and the tightened `members` read policy. This file is specifically about
-- ONE user holding MULTIPLE contexts — a case no earlier suite
-- (references_entity, billing_entitlement) exercises, since none of their
-- fixtures give a single user two memberships at once.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (context_resolution.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange.
--
-- u1 holds membership in TWO households (A and B) — the case this story
-- exists for. u2 is a second member of household A (used to prove the
-- account_members corrected shape hides a foreign member's row once their
-- shared household stops being u1's active context). u4 owns household C,
-- which u1 holds no membership in at all. u3 never gets any membership —
-- the fail-closed case.
--
-- The very first auth.users insert in a pristine transaction bootstraps a
-- parent_admin membership (handle_new_user()); that is already covered by
-- references_entity.sql and billing_entitlement.sql, so this suite does not
-- re-assert it — it just clears the bootstrap row afterward, exactly as
-- those suites do, so the trigger checks below start from a clean slate.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('c1c1c1c1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctx-u1@test.local');

insert into auth.users (id, instance_id, aud, role, email)
values ('c2c2c2c2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctx-u2@test.local'),
       ('c3c3c3c3-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctx-u3-stranger@test.local'),
       ('c4c4c4c4-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctx-u4@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('Context Household A') returning id as acct_a \gset
insert into public.accounts (name) values ('Context Household B') returning id as acct_b \gset
insert into public.accounts (name) values ('Context Household C') returning id as acct_c \gset
insert into ids values ('acct_a', :acct_a), ('acct_b', :acct_b), ('acct_c', :acct_c);

-- ---------------------------------------------------------------------------
-- activate_first_context (AC-5): fires on u1's FIRST membership, activating
-- household A...
-- ---------------------------------------------------------------------------
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'c1c1c1c1-1111-1111-1111-111111111111', 'parent_admin', 'active');

insert into results (name, passed)
select 'activate_first_context activates a user''s first live membership',
       ms.active_account_id = :acct_a
from public.member_state ms
where ms.user_id = 'c1c1c1c1-1111-1111-1111-111111111111';

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'c2c2c2c2-2222-2222-2222-222222222222', 'helper', 'active');

-- ...and does nothing when u1 gains a SECOND membership while the first is
-- still live (AC-5: gaining a context must never silently move someone).
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'c1c1c1c1-1111-1111-1111-111111111111', 'parent_admin', 'active');

insert into results (name, passed)
select 'activate_first_context leaves a second live membership alone',
       ms.active_account_id = :acct_a
from public.member_state ms
where ms.user_id = 'c1c1c1c1-1111-1111-1111-111111111111';

insert into public.account_members (account_id, user_id, role, status)
values (:acct_c, 'c4c4c4c4-4444-4444-4444-444444444444', 'parent_admin', 'active');

-- AC-8: a duplicate ACTIVE membership in the same account is a schema error.
do $$
begin
  insert into public.account_members (account_id, user_id, role, status)
    select value, 'c1c1c1c1-1111-1111-1111-111111111111', 'parent_admin', 'active'
    from ids where name = 'acct_a';
  insert into results values ('a duplicate active membership in the same account is rejected', false, 'insert succeeded');
exception when others then
  insert into results values ('a duplicate active membership in the same account is rejected', true, sqlerrm);
end $$;

-- Domain rows: one single + one shidduch + one task per household A/B, plus
-- one single in household C (u1 holds no membership there at all).
insert into public.singles (account_id, first_name_en, gender) values (:acct_a, 'Leah', 'female') returning id as single_a \gset
insert into public.singles (account_id, first_name_en, gender) values (:acct_b, 'Rivka', 'female') returning id as single_b \gset
insert into public.singles (account_id, first_name_en, gender) values (:acct_c, 'Chana', 'female') returning id as single_c \gset
insert into ids values ('single_a', :single_a), ('single_b', :single_b), ('single_c', :single_c);

insert into public.shidduchim (account_id, single_id, name_en) values (:acct_a, :single_a, 'Yosef Klein') returning id as shid_a \gset
insert into public.shidduchim (account_id, single_id, name_en) values (:acct_b, :single_b, 'Dovid Weiss') returning id as shid_b \gset
insert into ids values ('shid_a', :shid_a), ('shid_b', :shid_b);

insert into public.tasks (account_id, target_type, target_id, text) values (:acct_a, 'shidduch', :shid_a, 'Task A');
insert into public.tasks (account_id, target_type, target_id, text) values (:acct_b, 'shidduch', :shid_b, 'Task B');

-- ---------------------------------------------------------------------------
-- AC-11 case 1, half A: u1 acting with active context = household A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1c1c1c1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'current_context_id resolves to the caller''s active context (A)',
       public.current_context_id() = :acct_a;

insert into results (name, passed)
select 'active context A: singles shows only household A''s single',
       (select count(*) from public.singles where id = :single_a) = 1
   and (select count(*) from public.singles where id = :single_b) = 0
   and (select count(*) from public.singles where id = :single_c) = 0;

insert into results (name, passed)
select 'active context A: shidduchim shows only household A''s shidduch',
       (select count(*) from public.shidduchim where id = :shid_a) = 1
   and (select count(*) from public.shidduchim where id = :shid_b) = 0;

insert into results (name, passed)
select 'active context A: tasks shows only household A''s task',
       (select count(*) from public.tasks where target_id = :shid_a and target_type = 'shidduch') = 1
   and (select count(*) from public.tasks where target_id = :shid_b and target_type = 'shidduch') = 0;

-- AC-7: accounts shows every context the caller holds ANY membership in
-- (active or not) — a strict superset of "the currently active one" — but
-- never a third account they hold no membership in at all.
-- accounts' policy reads account_members from inside itself; that is only
-- safe because account_members's own policy never reads accounts back. A
-- plain select must succeed outright, not merely filter, or a future edit
-- that makes account_members read accounts too would surface as
-- "infinite recursion detected in policy for relation" here first.
do $$
begin
  perform count(*) from public.accounts;
  insert into results values ('a plain select on accounts succeeds without infinite recursion', true);
exception when others then
  insert into results values ('a plain select on accounts succeeds without infinite recursion', false, sqlerrm);
end $$;

insert into results (name, passed)
select 'AC-7: accounts shows both of the caller''s contexts, active or not',
       (select count(*) from public.accounts where id in (:acct_a, :acct_b)) = 2
   and (select count(*) from public.accounts where id = :acct_c) = 0;

insert into results (name, passed)
select 'AC-7''s broader accounts read does not leak the inactive context''s domain rows',
       (select count(*) from public.singles where id = :single_b) = 0
   and (select count(*) from public.shidduchim where id = :shid_b) = 0
   and (select count(*) from public.tasks where target_id = :shid_b and target_type = 'shidduch') = 0;

-- AC-7: account_members always shows the caller's OWN rows (every context),
-- plus a foreign member's row only inside the currently active context.
insert into results (name, passed)
select 'AC-7: account_members shows the caller''s own membership in both contexts',
       count(*) = 2
from public.account_members
where user_id = 'c1c1c1c1-1111-1111-1111-111111111111';

insert into results (name, passed)
select 'AC-7: account_members shows a foreign member''s row inside the ACTIVE context',
       count(*) = 1
from public.account_members
where user_id = 'c2c2c2c2-2222-2222-2222-222222222222';

insert into results (name, passed)
select 'AC-7: account_members never shows a membership in a third, unrelated account',
       count(*) = 0
from public.account_members
where account_id = :acct_c;

-- ---------------------------------------------------------------------------
-- Review finding #1 (BLOCKER, post-review hardening): account_members'
-- INSERT/UPDATE stay scoped to the caller's ACTIVE context only. The
-- `user_id = auth.uid()` disjunct that widens SELECT must NOT also widen
-- writes — otherwise any authenticated caller could INSERT (or UPDATE their
-- way into) a membership row in an account they do not belong to, then
-- legitimately set_active_context() into it. u1 is still active in household
-- A here; household C is a foreign account u1 holds no membership in at all.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.account_members (account_id, user_id, role, status)
  values ((select value from ids where name = 'acct_c'), 'c1c1c1c1-1111-1111-1111-111111111111', 'parent_admin', 'active');
  insert into results values ('a caller cannot INSERT their own membership into a foreign (non-active) account', false, 'insert succeeded');
exception when others then
  insert into results values ('a caller cannot INSERT their own membership into a foreign (non-active) account', true, sqlerrm);
end $$;

do $$
begin
  update public.account_members set account_id = (select value from ids where name = 'acct_c')
  where user_id = 'c1c1c1c1-1111-1111-1111-111111111111'
    and account_id = (select value from ids where name = 'acct_a');
  insert into results values ('a caller cannot UPDATE their own membership row''s account_id to a foreign account', false, 'update succeeded');
exception when others then
  insert into results values ('a caller cannot UPDATE their own membership row''s account_id to a foreign account', true, sqlerrm);
end $$;

insert into results (name, passed)
select 'the exploit never planted a membership row in the foreign account',
       count(*) = 0
from public.account_members
where account_id = :acct_c and user_id = 'c1c1c1c1-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- AC-4/AC-11: switch to household B via the validated function.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'current_context_id resolves to the caller''s active context (B) after switching',
       public.current_context_id() = :acct_b;

insert into results (name, passed)
select 'active context B: singles shows only household B''s single',
       (select count(*) from public.singles where id = :single_b) = 1
   and (select count(*) from public.singles where id = :single_a) = 0;

insert into results (name, passed)
select 'active context B: shidduchim shows only household B''s shidduch',
       (select count(*) from public.shidduchim where id = :shid_b) = 1
   and (select count(*) from public.shidduchim where id = :shid_a) = 0;

insert into results (name, passed)
select 'active context B: tasks shows only household B''s task',
       (select count(*) from public.tasks where target_id = :shid_b and target_type = 'shidduch') = 1
   and (select count(*) from public.tasks where target_id = :shid_a and target_type = 'shidduch') = 0;

insert into results (name, passed)
select 'AC-7: accounts read is unaffected by which context is active',
       (select count(*) from public.accounts where id in (:acct_a, :acct_b)) = 2
   and (select count(*) from public.accounts where id = :acct_c) = 0;

insert into results (name, passed)
select 'AC-7: a foreign member''s row disappears once their household stops being active',
       count(*) = 0
from public.account_members
where user_id = 'c2c2c2c2-2222-2222-2222-222222222222';

insert into results (name, passed)
select 'AC-7: the caller''s own membership rows remain visible regardless of which is active',
       count(*) = 2
from public.account_members
where user_id = 'c1c1c1c1-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- AC-11 case 2: set_active_context on an account the caller holds no
-- membership in raises, and leaves member_state unchanged.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.set_active_context((select value from ids where name = 'acct_c'));
  insert into results values ('set_active_context refuses an account the caller does not belong to', false, 'no exception raised');
exception when others then
  insert into results values ('set_active_context refuses an account the caller does not belong to',
    sqlerrm like '%no active membership of account%', sqlerrm);
end $$;

insert into results (name, passed)
select 'a refused set_active_context call leaves member_state unchanged',
       public.current_context_id() = :acct_b;

insert into results (name, passed)
select 'a refused set_active_context call never makes the third account visible',
       (select count(*) from public.accounts where id = :acct_c) = 0;

-- ---------------------------------------------------------------------------
-- AC-3: member_state cannot be written directly, only through
-- set_active_context() / activate_context_for().
-- ---------------------------------------------------------------------------
do $$
begin
  update public.member_state set active_account_id = (select value from ids where name = 'acct_a')
  where user_id = auth.uid();
  insert into results values ('member_state cannot be UPDATEd directly by authenticated', false, 'update succeeded');
exception when others then
  insert into results values ('member_state cannot be UPDATEd directly by authenticated', true, sqlerrm);
end $$;

do $$
begin
  insert into public.member_state (user_id, active_account_id)
  values ('c3c3c3c3-3333-3333-3333-333333333333', (select value from ids where name = 'acct_a'));
  insert into results values ('member_state cannot be INSERTed directly by authenticated', false, 'insert succeeded');
exception when others then
  insert into results values ('member_state cannot be INSERTed directly by authenticated', true, sqlerrm);
end $$;

-- activate_context_for() is the private writer: no client role may call it
-- directly, only set_active_context() / the trigger (both SECURITY DEFINER).
do $$
begin
  perform public.activate_context_for(auth.uid(), (select value from ids where name = 'acct_a'));
  insert into results values ('activate_context_for cannot be called directly by authenticated', false, 'call succeeded');
exception when others then
  insert into results values ('activate_context_for cannot be called directly by authenticated', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-11 case 3: a freshly authenticated user with no account_members row at
-- all resolves to NO context, not account #1 and not an error.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c3c3c3c3-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select 'an unprovisioned user resolves current_context_id to NULL, not any account',
       public.current_context_id() is null;

insert into results (name, passed) select 'unprovisioned user sees no accounts at all', count(*) = 0 from public.accounts;
insert into results (name, passed) select 'unprovisioned user sees no account_members at all', count(*) = 0 from public.account_members;
insert into results (name, passed) select 'unprovisioned user sees no singles', count(*) = 0 from public.singles;
insert into results (name, passed) select 'unprovisioned user sees no shidduchim', count(*) = 0 from public.shidduchim;
insert into results (name, passed) select 'unprovisioned user sees no tasks', count(*) = 0 from public.tasks;

do $$
begin
  insert into public.singles (first_name_en) values ('Planted by a stranger');
  insert into results values ('an unprovisioned user cannot create anything', false, 'insert succeeded');
exception when others then
  insert into results values ('an unprovisioned user cannot create anything', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Structural guarantees this story must not regress.
-- ---------------------------------------------------------------------------
reset role;

insert into results (name, passed)
select 'RLS is enabled on member_state', c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'member_state';

insert into results (name, passed)
select 'member_state has exactly one policy, SELECT-only', count(*) = 1
from pg_policies
where schemaname = 'public' and tablename = 'member_state' and cmd = 'SELECT';

insert into results (name, passed)
select 'anon holds no privilege at all on member_state',
       not exists (
         select 1
         from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where n.nspname = 'public' and c.relname = 'member_state'
           and a.grantee = 'anon'::regrole::oid
       );

insert into results (name, passed)
select 'anon cannot execute current_context_id, set_active_context or activate_first_context',
       bool_and(not has_function_privilege('anon', p.oid, 'execute'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_context_id', 'set_active_context', 'activate_first_context', 'activate_context_for');

insert into results (name, passed)
select 'authenticated cannot execute activate_context_for (only service_role can)',
       not has_function_privilege('authenticated', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'activate_context_for';

insert into results (name, passed)
select 'the resolver current_account_id() no longer exists',
       to_regproc('public.current_account_id') is null;

-- =====================================================================
-- Story 2.4 — my_contexts() (AC-5).
-- =====================================================================
-- Reuses this suite's own u1/u4 fixtures (above) rather than building new
-- ones: my_contexts() reads exactly the same account_members/accounts rows
-- current_context_id() and the AC-7 accounts/account_members RLS shapes
-- above already prove visible to the caller. u1 is still authenticated with
-- context B active (the switch at "AC-4/AC-11: switch to household B" above
-- is the last write to member_state before this point).
--
-- Review finding #5 (should-fix): every fixture membership above is
-- status = 'active', so deleting my_contexts()'s `and am.status = 'active'`
-- clause would fail no check. u1 also holds an ARCHIVED membership of a
-- fourth household (D) — inserted here, while still running with the
-- elevated role, exactly like acct_a/b/c's own fixtures above — to pin that
-- the filter is load-bearing, not just true by accident.
--
-- Story 2.5 note: this fixture originally used the placeholder literal
-- 'revoked', which predates account_members_status_check (AC-6) and would
-- now be rejected outright — 'archived' is both schema-valid and the exact
-- real-world value this suite needs to prove my_contexts()/current_context_id()
-- ignore once Story 2.5 ships persona removal.
-- ---------------------------------------------------------------------------
insert into public.accounts (name) values ('Context Household D (archived)') returning id as acct_d \gset
insert into ids values ('acct_d', :acct_d);
insert into public.account_members (account_id, user_id, role, status)
values (:acct_d, 'c1c1c1c1-1111-1111-1111-111111111111', 'helper', 'archived');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1c1c1c1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'my_contexts() reports exactly the caller''s two contexts, never a third the caller holds no membership in',
       (select count(*) from public.my_contexts()) = 2
   and (select count(*) from public.my_contexts() where account_id = :acct_a) = 1
   and (select count(*) from public.my_contexts() where account_id = :acct_b) = 1
   and (select count(*) from public.my_contexts() where account_id = :acct_c) = 0;

insert into results (name, passed)
select 'my_contexts() excludes an ARCHIVED membership (pins the status = ''active'' filter itself, not just its usual outcome)',
       (select count(*) from public.my_contexts() where account_id = :acct_d) = 0;

insert into results (name, passed)
select 'my_contexts() flags the currently active context true and the other false',
       (select is_active from public.my_contexts() where account_id = :acct_b) = true
   and (select is_active from public.my_contexts() where account_id = :acct_a) = false;

insert into results (name, passed)
select 'my_contexts() reports each context''s kind and the caller''s own role there',
       (select kind from public.my_contexts() where account_id = :acct_a) = 'household'
   and (select role from public.my_contexts() where account_id = :acct_a) = 'parent_admin';

set local request.jwt.claims = '{"sub":"c3c3c3c3-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select 'my_contexts() returns no rows for an unprovisioned user (a stranger''s context never appears, from their own side either)',
       (select count(*) from public.my_contexts()) = 0;

reset role;

-- Review finding #6 (note, 2.4 review): a fail-closed current_context_id()
-- (member_state.active_account_id IS NULL) must never turn is_active into
-- SQL NULL — types.ts declares MyContext.is_active as `boolean`, and NULL
-- would violate that contract even though the UI happens to survive it via
-- `?? contexts[0]`. u4 holds exactly one active membership (household C);
-- force member_state back to NULL for u4 directly (elevated role — the
-- same write authenticated is blocked from making, proven above) to pin
-- that my_contexts() reports false, not NULL, in that state.
update public.member_state set active_account_id = null
where user_id = 'c4c4c4c4-4444-4444-4444-444444444444';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c4c4c4c4-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed)
select 'my_contexts() reports is_active = false, never NULL, when current_context_id() fails closed',
       (select is_active from public.my_contexts() where account_id = :acct_c) is not distinct from false;

reset role;

insert into results (name, passed)
select 'my_contexts() is SECURITY INVOKER, not SECURITY DEFINER (relies on AC-7''s widened accounts/account_members SELECT policies, not its own bypass)',
       not p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'my_contexts';

insert into results (name, passed)
select 'anon cannot execute my_contexts()',
       not has_function_privilege('anon', 'public.my_contexts()', 'execute');

-- =====================================================================
-- Story 2.2 — Persona and context data model.
-- =====================================================================
-- Fresh users/accounts, independent of the Story 2.1 fixtures above (which
-- have already been switched, promoted and role-reset by this point) so
-- these checks start from a clean, predictable state.

reset role;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('d1d1d1d1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-owner@test.local', null),
       ('d2d2d2d2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-helper@test.local', null),
       ('d3d3d3d3-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-invited-single@test.local', null),
       ('d4d4d4d4-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-single-shadchan@test.local', null),
       ('d5d5d5d5-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-outsider@test.local', null),
       ('e1e1e1e1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-parent-then-single@test.local', null),
       ('e2e2e2e2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-single-then-parent@test.local', null),
       ('f1f1f1f1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-named@test.local', '{"given_name":"Devora"}'::jsonb);

-- ---------------------------------------------------------------------------
-- Review finding #2 (should-fix, post-review hardening): add_persona() fails
-- closed when called with no authenticated caller (auth.uid() is NULL)
-- rather than silently provisioning an orphan account/membership.
-- service_role holds EXECUTE (06_grants.sql) for legitimate server-side
-- callers, so a caller-less invocation must be rejected by the function
-- body itself, not by the grant.
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
begin
  perform public.add_persona('parent');
  insert into results values ('add_persona rejects a call with no authenticated caller (auth.uid() is NULL)', false, 'no exception raised');
exception when others then
  insert into results values ('add_persona rejects a call with no authenticated caller (auth.uid() is NULL)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the NULL-caller add_persona attempt never created an orphan (user_id IS NULL) account_members row',
       not exists (select 1 from public.account_members where user_id is null);

-- ---------------------------------------------------------------------------
-- Review finding #5 (should-fix): anon cannot execute any of Story 2.2's 5
-- new functions — the exact class of regression the story's own Debug Log
-- already recorded db diff silently dropping once (all 5 REVOKE/GRANT
-- statements were missing from the first generated migration).
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'anon cannot execute any of the 5 new Story 2.2 functions (add_persona, my_personas, enforce_household_scope, enforce_membership_role_matches_context, is_owning_membership_role)',
       bool_and(not has_function_privilege('anon', p.oid, 'execute'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_persona', 'my_personas', 'enforce_household_scope', 'enforce_membership_role_matches_context', 'is_owning_membership_role');

-- ---------------------------------------------------------------------------
-- AC-3: enforce_household_scope() rejects a shadchanus-kind account_id on
-- every one of the 11 household-only domain tables (13 originally; Story
-- 3.14 dropped interactions/tasks from the set — household_scope_lift.sql
-- proves the two departed tables now accept it instead). The BEFORE ROW
-- trigger raises before any other column/FK constraint is ever checked, so a
-- minimal (account_id)-only insert is enough to prove it — no other column
-- needs to be valid, because the raise aborts the statement before those
-- checks run.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('Persona Test Shadchanus', 'shadchanus') returning id as acct_shad \gset
insert into ids values ('acct_shad', :acct_shad);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'singles', 'shadchanim', 'references', 'shidduchim', 'resumes',
    'reference_links', 'date_records', 'redts', 'shidduch_schools',
    'identity_signals', 'inbox_items'
  ];
  v_shad_id bigint;
  v_raised boolean;
  v_detail text;
begin
  select value into v_shad_id from ids where name = 'acct_shad';

  foreach v_table in array v_tables loop
    v_raised := false;
    v_detail := null;
    begin
      execute format('insert into public.%I (account_id) values (%L)', v_table, v_shad_id);
    exception when others then
      v_raised := true;
      v_detail := sqlerrm;
    end;
    -- Review finding #3: asserting v_raised alone is vacuous for tables that
    -- also have a mandatory non-defaulted column besides account_id (7 of
    -- the 11 today — recounted, not assumed, after Story 3.14 removed
    -- interactions/tasks, both of which were among the original 9 of 13:
    -- interactions.target_type/target_id and tasks.target_id are not null,
    -- [Source: 01_tables.sql]) — a NOT NULL/CHECK violation on THAT column
    -- raises just as happily as enforce_household_scope() would, so the
    -- assertion passed even with the trigger removed entirely (verified by
    -- hand). Matching the exact message enforce_household_scope() raises
    -- (02_functions.sql) ties the assertion to the trigger actually firing,
    -- not to some other constraint incidentally rejecting the same row.
    insert into results (name, passed, detail)
    values (
      format('AC-3: enforce_household_scope rejects a shadchanus-kind account_id on %s', v_table),
      v_raised and v_detail like '%is not a household-kind account%',
      v_detail
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Story 3.14 replacement checks (AC 6): the loop above only ever proves a
-- REJECTION, so removing interactions/tasks from v_tables drops the only
-- coverage of what the trigger now does for them — nothing, on purpose.
-- These two prove the positive: enforce_household_scope() no longer rejects
-- a shadchanus-kind account_id on either table. household_scope_lift.sql
-- covers the full AC 4/AC 5 behaviour (isolation, message-matching
-- negatives); these are narrowly the "no longer rejects" fact, kept here so
-- this file's own trigger-count/loop story stays self-contained.
-- ---------------------------------------------------------------------------
do $$
declare
  v_shad_id bigint;
begin
  select value into v_shad_id from ids where name = 'acct_shad';
  insert into public.tasks (account_id, target_type, target_id)
    values (v_shad_id, 'reference', 1);
  insert into results values (
    'Story 3.14: enforce_household_scope no longer rejects a shadchanus-kind account_id on tasks',
    true, null
  );
exception when others then
  insert into results values (
    'Story 3.14: enforce_household_scope no longer rejects a shadchanus-kind account_id on tasks',
    false, sqlerrm
  );
end $$;

do $$
declare
  v_shad_id bigint;
begin
  select value into v_shad_id from ids where name = 'acct_shad';
  insert into public.interactions (account_id, target_type, target_id, scope)
    values (v_shad_id, 'reference', 1, 'account');
  insert into results values (
    'Story 3.14: enforce_household_scope no longer rejects a shadchanus-kind account_id on interactions',
    true, null
  );
exception when others then
  insert into results values (
    'Story 3.14: enforce_household_scope no longer rejects a shadchanus-kind account_id on interactions',
    false, sqlerrm
  );
end $$;

insert into results (name, passed)
select 'AC-3: enforce_household_scope is attached to exactly 15 tables',
       (select count(*) from pg_trigger where tgfoid = 'public.enforce_household_scope'::regproc and not tgisinternal) = 15;

insert into results (name, passed)
select 'AC-3a: validate_singles_household_scope sorts after every set_/sync_ BEFORE trigger on singles',
       (
         select tgname from pg_trigger
         where tgrelid = 'public.singles'::regclass and not tgisinternal and tgtype & 2 = 2
         order by tgname desc
         limit 1
       ) = 'validate_singles_household_scope';

insert into results (name, passed)
select 'AC-4: enforce_household_scope is NOT attached to subscription or ai_usage',
       not exists (
         select 1 from pg_trigger t
         where t.tgfoid = 'public.enforce_household_scope'::regproc
           and not t.tgisinternal
           and t.tgrelid in ('public.subscription'::regclass, 'public.ai_usage'::regclass)
       );

insert into results (name, passed)
select 'AC-4: subscription and ai_usage carry the documented carve-out comment',
       obj_description('public.subscription'::regclass, 'pg_class') is not null
   and obj_description('public.ai_usage'::regclass, 'pg_class') is not null;

-- ---------------------------------------------------------------------------
-- AC-3a: the ordering proof — an ordinary authenticated insert with NO
-- account_id supplied still succeeds on all 11 household-only tables while
-- the caller's active context is a household (set_account_id_default() runs
-- first, enforce_household_scope() validates the value it set, never a
-- NULL). interactions/tasks are inserted here too (below) and still checked
-- for the same account_id-ordering fact, just under their own Story 3.14
-- check — enforce_household_scope() no longer runs on either, so they no
-- longer belong to THIS check's "household-only" conjunction.
-- ---------------------------------------------------------------------------
reset role;

insert into public.accounts (name, kind) values ('Persona Household Owner', 'household') returning id as acct_owner \gset
insert into ids values ('acct_owner', :acct_owner);

insert into public.account_members (account_id, user_id, role, status)
values (:acct_owner, 'd1d1d1d1-1111-1111-1111-111111111111', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1d1d1d1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.singles (first_name_en) values ('AC-3a Single') returning id as ac3a_single \gset
insert into public."references" (name_en) values ('AC-3a Reference') returning id as ac3a_reference \gset
insert into public.shadchanim (name) values ('AC-3a Shadchan') returning id as ac3a_shadchan \gset
insert into public.shidduchim (single_id, name_en) values (:ac3a_single, 'AC-3a Shidduch') returning id as ac3a_shidduch \gset
insert into public.resumes (shidduchim_id) values (:ac3a_shidduch) returning id as ac3a_resume \gset
insert into public.reference_links (reference_id) values (:ac3a_reference) returning id as ac3a_link \gset
insert into public.date_records (single_id) values (:ac3a_single) returning id as ac3a_date_record \gset
insert into public.redts (shidduchim_id) values (:ac3a_shidduch) returning id as ac3a_redt \gset
insert into public.shidduch_schools (shidduchim_id) values (:ac3a_shidduch) returning id as ac3a_school \gset
insert into public.interactions (target_type, target_id) values ('reference', :ac3a_reference) returning id as ac3a_interaction \gset
-- identity_signals is deliberately SELECT-only for authenticated
-- (06_grants.sql) — written only by the SECURITY DEFINER sync triggers, so
-- the account_id-ordering proof for this table rides the row
-- sync_reference_identity_signals() auto-creates for the reference insert
-- above, rather than a direct client insert (which would 403 on the grant,
-- not on anything this story changed).
select id as ac3a_signal from public.identity_signals where target_type = 'reference' and target_id = :ac3a_reference \gset
insert into public.inbox_items (source) values ('upload') returning id as ac3a_inbox \gset
insert into public.tasks (target_type, target_id, text) values ('reference', :ac3a_reference, 'AC-3a Task') returning id as ac3a_task \gset

insert into results (name, passed)
select 'AC-3a: all 11 household-only tables accept an insert with no account_id while the active context is a household (trigger ordering proof)',
       (select count(*) from public.singles where id = :ac3a_single and account_id = :acct_owner) = 1
   and (select count(*) from public."references" where id = :ac3a_reference and account_id = :acct_owner) = 1
   and (select count(*) from public.shadchanim where id = :ac3a_shadchan and account_id = :acct_owner) = 1
   and (select count(*) from public.shidduchim where id = :ac3a_shidduch and account_id = :acct_owner) = 1
   and (select count(*) from public.resumes where id = :ac3a_resume and account_id = :acct_owner) = 1
   and (select count(*) from public.reference_links where id = :ac3a_link and account_id = :acct_owner) = 1
   and (select count(*) from public.date_records where id = :ac3a_date_record and account_id = :acct_owner) = 1
   and (select count(*) from public.redts where id = :ac3a_redt and account_id = :acct_owner) = 1
   and (select count(*) from public.shidduch_schools where id = :ac3a_school and account_id = :acct_owner) = 1
   and (select count(*) from public.identity_signals where id = :ac3a_signal and account_id = :acct_owner) = 1
   and (select count(*) from public.inbox_items where id = :ac3a_inbox and account_id = :acct_owner) = 1;

-- Story 3.14: interactions/tasks no longer carry a validate_*_household_scope
-- trigger, so they no longer belong to the "household-only" conjunction
-- above — but set_account_id_default() still runs on both (it was never the
-- trigger this story removed), and this is the only proof of that fact left
-- in this file once the two tables leave the AC-3/AC-3a loops. Deleting
-- these two inserts (rather than just re-homing their assertion) would
-- silently drop that coverage.
insert into results (name, passed)
select 'Story 3.14: set_account_id_default() still populates account_id on interactions and tasks now that no household-scope trigger follows it',
       (select count(*) from public.interactions where id = :ac3a_interaction and account_id = :acct_owner) = 1
   and (select count(*) from public.tasks where id = :ac3a_task and account_id = :acct_owner) = 1;

-- ---------------------------------------------------------------------------
-- AC-2: single is a valid account_members role.
-- ---------------------------------------------------------------------------
reset role;

insert into public.account_members (account_id, user_id, role, status)
values (:acct_owner, 'd3d3d3d3-3333-3333-3333-333333333333', 'single', 'active')
returning id as d3_membership \gset
insert into ids values ('d3_membership', :d3_membership);

insert into public.singles (account_id, member_id, first_name_en)
values (:acct_owner, :d3_membership, 'Invited Single');

insert into results (name, passed)
select 'AC-2: a single-role account_members row is a valid insert',
       exists (
         select 1 from public.account_members
         where user_id = 'd3d3d3d3-3333-3333-3333-333333333333' and role = 'single' and status = 'active'
       );

-- ---------------------------------------------------------------------------
-- AC-5: a shadchan-role membership may only exist on a shadchanus-kind
-- account, and every other role only on a household-kind account — both
-- directions, on INSERT.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.account_members (account_id, user_id, role, status)
  values ((select value from ids where name = 'acct_owner'), 'd5d5d5d5-5555-5555-5555-555555555555', 'shadchan', 'active');
  insert into results values ('AC-5: a shadchan-role membership on a household-kind account is rejected', false, 'insert succeeded');
exception when others then
  insert into results values ('AC-5: a shadchan-role membership on a household-kind account is rejected', true, sqlerrm);
end $$;

do $$
begin
  insert into public.account_members (account_id, user_id, role, status)
  values ((select value from ids where name = 'acct_shad'), 'd5d5d5d5-5555-5555-5555-555555555555', 'parent_admin', 'active');
  insert into results values ('AC-5: a parent_admin-role membership on a shadchanus-kind account is rejected', false, 'insert succeeded');
exception when others then
  insert into results values ('AC-5: a parent_admin-role membership on a shadchanus-kind account is rejected', true, sqlerrm);
end $$;

-- AC-5 on UPDATE too: a role CHANGE on an existing membership is checked,
-- not just the initial insert. d2 is set up here as a legitimate helper of
-- acct_owner (reused below for the AC-6 non-owning-membership test).
insert into public.account_members (account_id, user_id, role, status)
values (:acct_owner, 'd2d2d2d2-2222-2222-2222-222222222222', 'helper', 'active');

do $$
begin
  update public.account_members
  set role = 'shadchan'
  where user_id = 'd2d2d2d2-2222-2222-2222-222222222222'
    and account_id = (select value from ids where name = 'acct_owner');
  insert into results values ('AC-5: changing an existing membership''s role to shadchan on a household account is rejected (fires on UPDATE too)', false, 'update succeeded');
exception when others then
  insert into results values ('AC-5: changing an existing membership''s role to shadchan on a household account is rejected (fires on UPDATE too)', true, sqlerrm);
end $$;

insert into results (name, passed)
select 'AC-5: the rejected role changes never persisted',
       (select role from public.account_members where user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and account_id = (select value from ids where name = 'acct_owner')) = 'helper'
   and (select count(*) from public.account_members where user_id = 'd5d5d5d5-5555-5555-5555-555555555555') = 0;

-- ---------------------------------------------------------------------------
-- AC-6: add_persona() — the two non-owning-membership negative cases.
-- ---------------------------------------------------------------------------

-- A helper-only caller ticking `parent` gets a NEW household, never a
-- promotion of the helped family's membership.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d2d2d2d2-2222-2222-2222-222222222222","role":"authenticated"}';

select public.add_persona('parent');

insert into results (name, passed)
select 'AC-6: a helper-only caller ticking parent gets a NEW household, never a promotion',
       (select count(*) from public.account_members where user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and status = 'active' and role = 'parent_admin') = 1
   and (select count(distinct account_id) from public.account_members where user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and status = 'active') = 2
   and (select role from public.account_members where user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and account_id = (select value from ids where name = 'acct_owner')) = 'helper';

insert into results (name, passed)
select 'Review finding #4: add_persona falls back to ''My Account'' (not literal "Pending''s Family") when the caller''s first_name is still the unset ''Pending'' placeholder',
       (
         select a.name from public.accounts a
         join public.account_members am on am.account_id = a.id
         where am.user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and am.role = 'parent_admin' and am.status = 'active'
       ) = 'My Account';

-- Positive case for the same fix: a caller with a real first_name (set here
-- via raw_user_meta_data ->> 'given_name', handle_new_user()'s normal path)
-- still gets a named household, proving the nullif() guard only ever
-- swallows the literal placeholder, never a genuine name.
set local request.jwt.claims = '{"sub":"f1f1f1f1-1111-1111-1111-111111111111","role":"authenticated"}';

select public.add_persona('parent');

insert into results (name, passed)
select 'Review finding #4: add_persona still derives the household name from a real first_name',
       (
         select a.name from public.accounts a
         join public.account_members am on am.account_id = a.id
         where am.user_id = 'f1f1f1f1-1111-1111-1111-111111111111' and am.role = 'parent_admin' and am.status = 'active'
       ) = 'Devora''s Family';

-- An invited single-role member ticking `single` is a no-op, never a second
-- household.
set local request.jwt.claims = '{"sub":"d3d3d3d3-3333-3333-3333-333333333333","role":"authenticated"}';

select public.add_persona('single');

insert into results (name, passed)
select 'AC-6: an invited single-role member ticking single is a no-op, never a second household',
       (select count(distinct account_id) from public.account_members where user_id = 'd3d3d3d3-3333-3333-3333-333333333333' and status = 'active') = 1
   and (select count(*) from public.singles s join public.account_members am on am.id = s.member_id where am.user_id = 'd3d3d3d3-3333-3333-3333-333333333333') = 1;

-- ---------------------------------------------------------------------------
-- Review finding #1 (should-fix, CLOSED): a single-role member cannot
-- self-promote to parent_admin via a raw PostgREST UPDATE. d3 is still
-- single-role/active from the fixture above. UPDATE is withheld entirely
-- from authenticated at the grant layer (06_grants.sql) — the failure is a
-- permission-denied at the grant, not the (removed) UPDATE policy.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.account_members set role = 'parent_admin'
  where user_id = 'd3d3d3d3-3333-3333-3333-333333333333';
  insert into results values ('a single-role member cannot self-promote to parent_admin via a raw UPDATE', false, 'update succeeded');
exception when others then
  insert into results values ('a single-role member cannot self-promote to parent_admin via a raw UPDATE', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the self-promotion attempt never persisted',
       (select role from public.account_members where user_id = 'd3d3d3d3-3333-3333-3333-333333333333' and status = 'active') = 'single';

insert into results (name, passed)
select 'account_members carries no UPDATE policy at all (the fix removed it rather than narrowing it)',
       not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'account_members' and cmd = 'UPDATE'
       );

set local role authenticated;

-- ---------------------------------------------------------------------------
-- AC-6: single with no existing membership creates a self_manager household,
-- and a login can hold both a household and a separate shadchanus context.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"d4d4d4d4-4444-4444-4444-444444444444","role":"authenticated"}';

select public.add_persona('single');

insert into results (name, passed)
select 'AC-6: single persona with no existing membership creates a self_manager household and a singles row pointing at it',
       (
         select count(*) from public.account_members am
         join public.singles s on s.member_id = am.id
         where am.user_id = 'd4d4d4d4-4444-4444-4444-444444444444' and am.role = 'self_manager' and am.status = 'active'
       ) = 1;

select public.add_persona('shadchan');

insert into results (name, passed)
select 'AC-6/Dev Notes: a login can hold both a household (self_manager) and a separate shadchanus context',
       (
         select count(distinct a.kind) from public.account_members am
         join public.accounts a on a.id = am.account_id
         where am.user_id = 'd4d4d4d4-4444-4444-4444-444444444444' and am.status = 'active'
       ) = 2;

select public.add_persona('shadchan');

insert into results (name, passed)
select 'AC-6: add_persona(shadchan) is idempotent — calling it twice creates only one shadchanus account',
       (select count(*) from public.account_members where user_id = 'd4d4d4d4-4444-4444-4444-444444444444' and role = 'shadchan' and status = 'active') = 1;

-- ---------------------------------------------------------------------------
-- AC-7: ticking both single and parent yields ONE household, not two — both
-- orders.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e1e1e1e1-1111-1111-1111-111111111111","role":"authenticated"}';

select public.add_persona('parent');
select public.add_persona('single');

insert into results (name, passed)
select 'AC-7: parent then single yields exactly one household with one owning membership',
       (select count(distinct account_id) from public.account_members where user_id = 'e1e1e1e1-1111-1111-1111-111111111111' and status = 'active') = 1
   and (select count(*) from public.account_members where user_id = 'e1e1e1e1-1111-1111-1111-111111111111' and status = 'active' and role = 'parent_admin') = 1
   and (select count(*) from public.singles s join public.account_members am on am.id = s.member_id where am.user_id = 'e1e1e1e1-1111-1111-1111-111111111111') = 1;

-- AC-6 idempotency: calling the same personas again changes nothing.
select public.add_persona('parent');
select public.add_persona('single');

insert into results (name, passed)
select 'AC-6: add_persona(parent) and add_persona(single) are both idempotent for the same caller',
       (select count(distinct account_id) from public.account_members where user_id = 'e1e1e1e1-1111-1111-1111-111111111111' and status = 'active') = 1
   and (select count(*) from public.singles s join public.account_members am on am.id = s.member_id where am.user_id = 'e1e1e1e1-1111-1111-1111-111111111111') = 1;

set local request.jwt.claims = '{"sub":"e2e2e2e2-2222-2222-2222-222222222222","role":"authenticated"}';

select public.add_persona('single');
select public.add_persona('parent');

insert into results (name, passed)
select 'AC-7: single then parent promotes the same self_manager household to parent_admin rather than creating a second one',
       (select count(distinct account_id) from public.account_members where user_id = 'e2e2e2e2-2222-2222-2222-222222222222' and status = 'active') = 1
   and (select count(*) from public.account_members where user_id = 'e2e2e2e2-2222-2222-2222-222222222222' and status = 'active' and role = 'parent_admin') = 1
   and (select count(*) from public.singles s join public.account_members am on am.id = s.member_id where am.user_id = 'e2e2e2e2-2222-2222-2222-222222222222') = 1;

-- ---------------------------------------------------------------------------
-- AC-8: my_personas() — output shape, matching AC-6's no-op predicates.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-8: my_personas() takes no arguments (the signature is the only guard against cross-user use)',
       pg_get_function_identity_arguments('public.my_personas'::regproc) = '';

set local request.jwt.claims = '{"sub":"e1e1e1e1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8: my_personas() reports both parent and single for a user holding both in the same household',
       (select count(*) from public.my_personas() where persona = 'parent') = 1
   and (select count(*) from public.my_personas() where persona = 'single') = 1
   and (select count(distinct account_id) from public.my_personas()) = 1
   and (select account_kind from public.my_personas() where persona = 'parent') = 'household';

set local request.jwt.claims = '{"sub":"d4d4d4d4-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8: my_personas() reports single (via self_manager) and shadchan for a login holding both contexts',
       (select count(*) from public.my_personas() where persona = 'single') = 1
   and (select count(*) from public.my_personas() where persona = 'shadchan') = 1
   and (select account_kind from public.my_personas() where persona = 'shadchan') = 'shadchanus';

set local request.jwt.claims = '{"sub":"d3d3d3d3-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8: my_personas() reports single for an invited single-role member (covers the third role case)',
       (select count(*) from public.my_personas() where persona = 'single') = 1
   and (select count(*) from public.my_personas() where persona = 'parent') = 0
   and (select count(*) from public.my_personas() where persona = 'shadchan') = 0;

-- ---------------------------------------------------------------------------
-- AC-9/AC-10: members profile visibility — own row, co-member within the
-- active account, and the cross-household negative test.
-- ---------------------------------------------------------------------------
reset role;

insert into public.accounts (name, kind) values ('Persona Outsider Household', 'household') returning id as acct_outsider \gset
insert into ids values ('acct_outsider', :acct_outsider);

insert into public.account_members (account_id, user_id, role, status)
values (:acct_outsider, 'd5d5d5d5-5555-5555-5555-555555555555', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1d1d1d1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9: a caller can always read their own members row',
       (select count(*) from public.members where user_id = 'd1d1d1d1-1111-1111-1111-111111111111') = 1;

insert into results (name, passed)
select 'AC-9: a caller can read a co-member''s profile within their currently active account',
       (select count(*) from public.members where user_id = 'd2d2d2d2-2222-2222-2222-222222222222') = 1;

insert into results (name, passed)
select 'AC-9/AC-10: a member of household A cannot read the profile row of a member who belongs only to household B',
       (select count(*) from public.members where user_id = 'd5d5d5d5-5555-5555-5555-555555555555') = 0;

reset role;

insert into results (name, passed)
select 'AC-9: members no longer has the old using(true) read policy',
       not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'members' and qual = 'true'
       );

-- =====================================================================
-- Story 2.5 — Personas change over a lifetime (remove_persona()).
-- =====================================================================
-- Fresh users/accounts, independent of every fixture above. Each scenario
-- builds its own fixture directly as superuser (reset role — same pattern
-- as the Story 2.2 section), then `set local role authenticated` + the
-- caller's own JWT claim exercises remove_persona() as that user would.
-- Inside a `do $$ ... $$` block, values are read back through the `ids`
-- temp table rather than a psql `:var` — the established convention in this
-- file for exactly that context.

reset role;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('faaaaaa1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r1@test.local', null),
  ('faaaaaa2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r2@test.local', null),
  ('faaaaaa3-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r3-admin@test.local', null),
  ('faaaaaa4-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r4-invited-single@test.local', null),
  ('faaaaaa5-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r5@test.local', null),
  ('faaaaaa6-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r6@test.local', null),
  ('faaaaaa7-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r7@test.local', null),
  ('faaaaaa8-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r8-admin1@test.local', null),
  ('faaaaaa9-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r9-admin2@test.local', null),
  ('fbbbbbb0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r10-dual-household@test.local', null),
  ('fbbbbbb1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r11-references-only@test.local', null),
  ('fbbbbbb2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-remove-r12-paused-single@test.local', null);

-- ---------------------------------------------------------------------------
-- AC-6: the check constraint this story adds rejects any status outside
-- active/archived.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R-Status-Check Household', 'household') returning id as r_status_house \gset
insert into ids values ('r_status_house', :r_status_house);

do $$
begin
  insert into public.account_members (account_id, user_id, role, status)
  values ((select value from ids where name = 'r_status_house'), null, 'helper', 'bogus');
  insert into results values ('AC-6: account_members_status_check rejects a status outside active/archived', false, 'insert succeeded');
exception when others then
  insert into results values ('AC-6: account_members_status_check rejects a status outside active/archived', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- r1: shadchan + parent — AC-2/AC-7 shadchan removal, the dangling-context
-- handoff to a remaining membership, the handoff to NULL once none remain,
-- and idempotent no-ops on both personas once already archived.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R1 Household', 'household') returning id as r1_house \gset
insert into public.accounts (kind) values ('shadchanus') returning id as r1_shad \gset

insert into public.account_members (account_id, user_id, role, status)
values (:r1_house, 'faaaaaa1-1111-1111-1111-111111111111', 'parent_admin', 'active')
returning id as r1_house_membership \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r1_shad, 'faaaaaa1-1111-1111-1111-111111111111', 'shadchan', 'active')
returning id as r1_shad_membership \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa1-1111-1111-1111-111111111111","role":"authenticated"}';

-- activate_first_context_trigger only auto-activates the FIRST membership
-- (r1_house); switch to the shadchanus context explicitly so removing it is
-- the one that dangles the active context.
select public.set_active_context(:r1_shad);

select public.remove_persona('shadchan');

insert into results (name, passed)
select 'AC-2: removing shadchan archives that membership',
       (select status from public.account_members where id = :r1_shad_membership) = 'archived';

insert into results (name, passed)
select 'AC-7: removing the active shadchan context hands off to the caller''s remaining membership',
       public.current_context_id() = :r1_house;

-- r1's only remaining membership (r1_house, parent_admin) has no dependents
-- and no single persona attached — archives outright, and since it was just
-- handed the active context above, this is also r1's LAST membership.
select public.remove_persona('parent');

insert into results (name, passed)
select 'AC-2: removing parent with no dependents and no single held archives the membership outright',
       (select status from public.account_members where id = :r1_house_membership) = 'archived';

insert into results (name, passed)
select 'AC-7: archiving the caller''s last remaining membership clears the active context to NULL, never a stale value',
       public.current_context_id() is null;

insert into results (name, passed)
select 'AC-8: my_personas() reports zero personas once both are removed',
       (select count(*) from public.my_personas()) = 0;

-- Idempotency: calling remove_persona() again on already-archived personas
-- raises nothing and changes nothing (mirrors add_persona()'s own idiom).
select public.remove_persona('shadchan');
select public.remove_persona('parent');

insert into results (name, passed)
select 'remove_persona is idempotent — re-calling it on an already-archived persona is a silent no-op',
       (select count(*) from public.account_members
        where user_id = 'faaaaaa1-1111-1111-1111-111111111111' and status = 'active') = 0;

-- ---------------------------------------------------------------------------
-- r2: single is the caller's ONLY persona — AC-5's "only persona" guard.
-- ---------------------------------------------------------------------------
reset role;

insert into public.accounts (name, kind) values ('R2 Household', 'household') returning id as r2_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r2_house, 'faaaaaa2-2222-2222-2222-222222222222', 'self_manager', 'active')
returning id as r2_membership \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r2_house, :r2_membership, 'R2 Self', 'active')
returning id as r2_single \gset
insert into ids values ('r2_single', :r2_single), ('r2_membership', :r2_membership);

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa2-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('single');
  insert into results values ('AC-5: removing your only persona (single) is refused, not silently accepted', false, 'no exception raised');
exception when others then
  insert into results values ('AC-5: removing your only persona (single) is refused, not silently accepted',
    sqlerrm like '%cannot remove your only persona%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused only-persona removal changed nothing',
       (select status from public.singles where id = (select value from ids where name = 'r2_single')) = 'active'
   and (select status from public.account_members where id = (select value from ids where name = 'r2_membership')) = 'active';

-- ---------------------------------------------------------------------------
-- r3 (admin) + r4 (invited single, non-owning) — AC-5's "ask your household
-- admin" guard: an invited single-role member's record is managed by the
-- household's admin, never self-archived.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R3-R4 Household', 'household') returning id as r34_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r34_house, 'faaaaaa3-3333-3333-3333-333333333333', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:r34_house, 'faaaaaa4-4444-4444-4444-444444444444', 'single', 'active')
returning id as r4_membership \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r34_house, :r4_membership, 'R4 Invited', 'active')
returning id as r4_single \gset
insert into ids values ('r4_single', :r4_single);

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa4-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('single');
  insert into results values ('AC-5: an invited single-role member cannot self-archive a record their household admin manages', false, 'no exception raised');
exception when others then
  insert into results values ('AC-5: an invited single-role member cannot self-archive a record their household admin manages',
    sqlerrm like '%ask your household admin%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused non-owning single removal changed nothing',
       (select status from public.singles where id = (select value from ids where name = 'r4_single')) = 'active';

-- ---------------------------------------------------------------------------
-- r5: parent + single in the SAME household — successful single removal
-- (archives, never deletes), the AC-1 re-add round trip against the now-
-- archived row, and the parent demote-to-self_manager path (role only,
-- never account_id).
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R5 Household', 'household') returning id as r5_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r5_house, 'faaaaaa5-5555-5555-5555-555555555555', 'parent_admin', 'active')
returning id as r5_membership \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r5_house, :r5_membership, 'R5 Self', 'active')
returning id as r5_single \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa5-5555-5555-5555-555555555555","role":"authenticated"}';

select public.remove_persona('single');

insert into results (name, passed)
select 'AC-3: removing single archives the singles row (status only) — it still exists, never deleted',
       (select count(*) from public.singles where id = :r5_single) = 1
   and (select status from public.singles where id = :r5_single) = 'archived';

insert into results (name, passed)
select 'after removing single, my_personas() no longer reports it but still reports parent',
       (select count(*) from public.my_personas() where persona = 'single') = 0
   and (select count(*) from public.my_personas() where persona = 'parent') = 1;

-- AC-1's round trip: re-adding single after removal must create a fresh
-- active row, not silently no-op against the now-archived one (the
-- s.status = 'active' fix to add_persona()/my_personas() above).
select public.add_persona('single');

insert into results (name, passed)
select 'AC-1: re-adding single after removal creates a fresh active singles row rather than staying no-op''d against the archived one',
       (select count(*) from public.my_personas() where persona = 'single') = 1
   and (select count(*) from public.singles where member_id = :r5_membership and status = 'active') = 1
   and (select count(*) from public.singles where member_id = :r5_membership) = 2;

-- The parent-demote path: r5 still holds single (freshly re-added) in this
-- same household, with no other dependents and no other admin — the guard
-- does not fire, so this demotes rather than raising.
select public.remove_persona('parent');

insert into results (name, passed)
select 'AC-2: removing parent while the caller still holds single in the same household demotes role only, never account_id, and never archives',
       (select role from public.account_members where id = :r5_membership) = 'self_manager'
   and (select status from public.account_members where id = :r5_membership) = 'active'
   and (select account_id from public.account_members where id = :r5_membership) = :r5_house;

-- ---------------------------------------------------------------------------
-- r6: sole admin of a household with an unmanaged dependent single (no login
-- of their own) and no other admin — AC-2's dependents guard.
-- ---------------------------------------------------------------------------
reset role;

insert into public.accounts (name, kind) values ('R6 Household', 'household') returning id as r6_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r6_house, 'faaaaaa6-6666-6666-6666-666666666666', 'parent_admin', 'active')
returning id as r6_membership \gset
insert into public.singles (account_id, first_name_en, status)
values (:r6_house, 'R6 Dependent', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa6-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('parent');
  insert into results values ('AC-2: removing the sole admin of a household with an unmanaged dependent and no other admin is refused', false, 'no exception raised');
exception when others then
  insert into results values ('AC-2: removing the sole admin of a household with an unmanaged dependent and no other admin is refused',
    sqlerrm like '%cannot remove parent%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused parent removal changed nothing',
       (select status from public.account_members where id = :r6_membership) = 'active'
   and (select role from public.account_members where id = :r6_membership) = 'parent_admin';

-- ---------------------------------------------------------------------------
-- r7: sole admin who ALSO holds their own single persona, plus an unmanaged
-- dependent and no other admin — the dependents guard is checked BEFORE the
-- demote branch, so holding single yourself does not bypass it.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R7 Household', 'household') returning id as r7_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r7_house, 'faaaaaa7-7777-7777-7777-777777777777', 'parent_admin', 'active')
returning id as r7_membership \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r7_house, :r7_membership, 'R7 Self', 'active');
insert into public.singles (account_id, first_name_en, status)
values (:r7_house, 'R7 Dependent', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa7-7777-7777-7777-777777777777","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('parent');
  insert into results values ('AC-2: the dependents guard is checked before the demote branch — holding single yourself does not bypass it', false, 'no exception raised');
exception when others then
  insert into results values ('AC-2: the dependents guard is checked before the demote branch — holding single yourself does not bypass it',
    sqlerrm like '%cannot remove parent%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the blocked demote-path attempt left the membership fully unchanged (still parent_admin, still active)',
       (select role from public.account_members where id = :r7_membership) = 'parent_admin'
   and (select status from public.account_members where id = :r7_membership) = 'active';

-- ---------------------------------------------------------------------------
-- r8 + r9: two-admin household with real domain data — AC-4 (a remaining
-- parent_admin keeps full access after another member's persona is
-- archived) and AC-3 (archiving deletes nothing — the rows still exist,
-- unchanged, under the now-archived context).
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R8-R9 Household', 'household') returning id as r89_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r89_house, 'faaaaaa8-8888-8888-8888-888888888888', 'parent_admin', 'active')
returning id as r8_membership \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r89_house, 'faaaaaa9-9999-9999-9999-999999999999', 'parent_admin', 'active')
returning id as r9_membership \gset

insert into public.singles (account_id, first_name_en, status) values (:r89_house, 'R89 Single', 'active') returning id as r89_single \gset
insert into public.shidduchim (account_id, single_id, name_en) values (:r89_house, :r89_single, 'R89 Shidduch') returning id as r89_shidduch \gset
insert into public."references" (account_id, name_en) values (:r89_house, 'R89 Reference') returning id as r89_reference \gset
insert into public.interactions (account_id, target_type, target_id) values (:r89_house, 'reference', :r89_reference) returning id as r89_interaction \gset
insert into public.redts (account_id, shidduchim_id) values (:r89_house, :r89_shidduch) returning id as r89_redt \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"faaaaaa8-8888-8888-8888-888888888888","role":"authenticated"}';

-- r89_single is an unmanaged dependent (no member_id), but r9 remains as a
-- second active parent_admin, so the dependents guard does NOT fire — this
-- pins the "no OTHER admin" half of the predicate, not just its "no other
-- singles" half (already covered by r1/r5 above).
select public.remove_persona('parent');

insert into results (name, passed)
select 'AC-2: removing parent with another admin present and unmanaged dependents archives the membership outright (the guard needs BOTH conditions)',
       (select status from public.account_members where id = :r8_membership) = 'archived';

insert into results (name, passed)
select 'AC-7: r8''s own active context clears to NULL after archiving their sole membership',
       public.current_context_id() is null;

-- Review finding #4: the actual invariant "archive = revoke", pinned as a
-- negative test — r8's membership is now archived and their active context
-- is NULL, so RLS must show them ZERO rows of the household they just left,
-- not merely "current_context_id() is null" in isolation.
insert into results (name, passed)
select 'review finding #4: r8 (now archived) reads zero singles/shidduchim/references from the household they just left',
       (select count(*) from public.singles where id = :r89_single) = 0
   and (select count(*) from public.shidduchim where id = :r89_shidduch) = 0
   and (select count(*) from public."references" where id = :r89_reference) = 0;

set local request.jwt.claims = '{"sub":"faaaaaa9-9999-9999-9999-999999999999","role":"authenticated"}';

insert into results (name, passed)
select 'AC-4: a remaining parent_admin still reads the household''s singles/shidduchim/references/interactions/redts fully after another member''s persona is archived',
       (select count(*) from public.singles where id = :r89_single) = 1
   and (select count(*) from public.shidduchim where id = :r89_shidduch) = 1
   and (select count(*) from public."references" where id = :r89_reference) = 1
   and (select count(*) from public.interactions where id = :r89_interaction) = 1
   and (select count(*) from public.redts where id = :r89_redt) = 1;

reset role;

insert into results (name, passed)
select 'AC-3: archiving a persona deletes nothing — the household''s domain rows all still exist, unchanged',
       (select count(*) from public.singles where id = :r89_single and first_name_en = 'R89 Single') = 1
   and (select count(*) from public.shidduchim where id = :r89_shidduch and name_en = 'R89 Shidduch') = 1
   and (select count(*) from public."references" where id = :r89_reference and name_en = 'R89 Reference') = 1
   and (select count(*) from public.interactions where id = :r89_interaction) = 1
   and (select count(*) from public.redts where id = :r89_redt) = 1;

insert into results (name, passed)
select 'AC-3: remove_persona() contains zero DELETE statements (every removal is a status/role transition)',
       prosrc not ilike '%delete from%'
from pg_proc
where proname = 'remove_persona';

-- ---------------------------------------------------------------------------
-- r10: review finding #3 — a user who is BOTH a self-managed single in one
-- household AND an invited (non-owning) single-role member in another must
-- always get their OWN (owning) record archived, never the non-owning one,
-- regardless of which singles row happens to have the lower id.
-- household Y's (non-owning) single is inserted FIRST, deliberately giving
-- it the lower id, so the pre-fix `order by s.id limit 1` would have picked
-- it and wrongly raised "ask your household admin" for a record the caller
-- does own elsewhere.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R10 Household Y (invited)', 'household') returning id as r10_house_y \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r10_house_y, 'fbbbbbb0-0000-0000-0000-000000000000', 'single', 'active')
returning id as r10_membership_y \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r10_house_y, :r10_membership_y, 'R10 Invited', 'active')
returning id as r10_single_y \gset

insert into public.accounts (name, kind) values ('R10 Household X (own)', 'household') returning id as r10_house_x \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r10_house_x, 'fbbbbbb0-0000-0000-0000-000000000000', 'self_manager', 'active')
returning id as r10_membership_x \gset
insert into public.singles (account_id, member_id, first_name_en, status)
values (:r10_house_x, :r10_membership_x, 'R10 Self', 'active')
returning id as r10_single_x \gset

insert into results (name, passed)
select 'setup sanity: household Y''s (non-owning) single has the lower id, exercising the pre-fix ordering bug',
       :r10_single_y < :r10_single_x;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fbbbbbb0-0000-0000-0000-000000000000","role":"authenticated"}';

select public.remove_persona('single');

reset role;

-- Checked as superuser (not the still-authenticated fbbbbbb0): fbbbbbb0's
-- active context is household Y (the FIRST membership auto-activated by
-- activate_first_context_trigger), so an RLS-scoped read here would only
-- ever see household Y's rows and silently miss whatever remove_persona()
-- did to household X's row.
insert into results (name, passed)
select 'review finding #3: removing single archives the caller''s OWN (owning) record, not the lower-id non-owning one',
       (select status from public.singles where id = :r10_single_x) = 'archived'
   and (select status from public.singles where id = :r10_single_y) = 'active';

-- ---------------------------------------------------------------------------
-- r11: review finding #1 (BLOCKER) — a household holding only a reference
-- (no singles at all) bypassed the old dependents guard unconditionally,
-- since that guard only ever counted `singles`. Sole admin, no dependents,
-- no other admin: the new account-scoped orphan guard must refuse.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R11 Household', 'household') returning id as r11_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r11_house, 'fbbbbbb1-1111-1111-1111-111111111111', 'parent_admin', 'active')
returning id as r11_membership \gset
insert into public."references" (account_id, name_en) values (:r11_house, 'R11 Reference') returning id as r11_reference \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"fbbbbbb1-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('parent');
  insert into results values ('review finding #1: removing the sole member of a household holding only a reference (no singles) is refused, not silently accepted', false, 'no exception raised');
exception when others then
  insert into results values ('review finding #1: removing the sole member of a household holding only a reference (no singles) is refused, not silently accepted',
    sqlerrm like '%cannot remove your last active membership%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused r11 removal changed nothing — membership still active, reference still there',
       (select status from public.account_members where id = :r11_membership) = 'active'
   and (select count(*) from public."references" where id = :r11_reference) = 1;

-- ---------------------------------------------------------------------------
-- r12: review finding #1 (BLOCKER) — a household whose only single is
-- `paused` (a first-class UI status, not `active`) bypassed the old
-- dependents guard too, since that guard's count filtered `status =
-- 'active'`. Sole admin, no other admin: the new orphan guard must refuse
-- regardless of the single's status.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('R12 Household', 'household') returning id as r12_house \gset
insert into public.account_members (account_id, user_id, role, status)
values (:r12_house, 'fbbbbbb2-2222-2222-2222-222222222222', 'parent_admin', 'active')
returning id as r12_membership \gset
insert into public.singles (account_id, first_name_en, status)
values (:r12_house, 'R12 Paused Dependent', 'paused') returning id as r12_single \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"fbbbbbb2-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  perform public.remove_persona('parent');
  insert into results values ('review finding #1: removing the sole admin of a household whose only single is paused (not active) is refused, not silently accepted', false, 'no exception raised');
exception when others then
  insert into results values ('review finding #1: removing the sole admin of a household whose only single is paused (not active) is refused, not silently accepted',
    sqlerrm like '%cannot remove your last active membership%', sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused r12 removal changed nothing — membership still active, paused single still there, unchanged',
       (select status from public.account_members where id = :r12_membership) = 'active'
   and (select status from public.singles where id = :r12_single) = 'paused';

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
