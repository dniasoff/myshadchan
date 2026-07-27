--
-- Context-aware authorisation (Story 2.1, AD-19) — database test suite.
--
-- Covers what this story replaced: current_context_id() resolves a user's
-- explicit, server-held active context (member_state) rather than an
-- arbitrary membership, and every RLS policy that used to read
-- current_account_id() reads it. This file is specifically about ONE user
-- holding MULTIPLE contexts — a case no earlier suite (references_entity,
-- billing_entitlement) exercises, since none of their fixtures give a
-- single user two memberships at once.
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

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
