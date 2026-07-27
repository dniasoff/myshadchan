--
-- Context-aware authorisation (Story 2.1, AD-19) and persona/context data
-- model (Story 2.2, AD-2) — database test suite.
--
-- Story 2.1 covers what it replaced: current_context_id() resolves a user's
-- explicit, server-held active context (member_state) rather than an
-- arbitrary membership, and every RLS policy that used to read
-- current_account_id() reads it. Story 2.2 extends this file (rather than
-- starting a third RLS suite) with: enforce_household_scope() on the 13
-- household-only domain tables, enforce_membership_role_matches_context() on
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
-- Story 2.2 — Persona and context data model.
-- =====================================================================
-- Fresh users/accounts, independent of the Story 2.1 fixtures above (which
-- have already been switched, promoted and role-reset by this point) so
-- these checks start from a clean, predictable state.

reset role;

insert into auth.users (id, instance_id, aud, role, email)
values ('d1d1d1d1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-owner@test.local'),
       ('d2d2d2d2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-helper@test.local'),
       ('d3d3d3d3-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-invited-single@test.local'),
       ('d4d4d4d4-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-single-shadchan@test.local'),
       ('d5d5d5d5-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-outsider@test.local'),
       ('e1e1e1e1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-parent-then-single@test.local'),
       ('e2e2e2e2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'persona-single-then-parent@test.local');

-- ---------------------------------------------------------------------------
-- AC-3: enforce_household_scope() rejects a shadchanus-kind account_id on
-- every one of the 13 household-only domain tables. The BEFORE ROW trigger
-- raises before any other column/FK constraint is ever checked, so a minimal
-- (account_id)-only insert is enough to prove it — no other column needs to
-- be valid, because the raise aborts the statement before those checks run.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('Persona Test Shadchanus', 'shadchanus') returning id as acct_shad \gset
insert into ids values ('acct_shad', :acct_shad);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'singles', 'shadchanim', 'references', 'shidduchim', 'resumes',
    'reference_links', 'date_records', 'redts', 'shidduch_schools',
    'interactions', 'identity_signals', 'inbox_items', 'tasks'
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
    insert into results (name, passed, detail)
    values (
      format('AC-3: enforce_household_scope rejects a shadchanus-kind account_id on %s', v_table),
      v_raised,
      v_detail
    );
  end loop;
end $$;

insert into results (name, passed)
select 'AC-3: enforce_household_scope is attached to exactly 13 tables',
       (select count(*) from pg_trigger where tgfoid = 'public.enforce_household_scope'::regproc and not tgisinternal) = 13;

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
-- account_id supplied still succeeds on all 13 tables while the caller's
-- active context is a household (set_account_id_default() runs first,
-- enforce_household_scope() validates the value it set, never a NULL).
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
select 'AC-3a: all 13 household-only tables accept an insert with no account_id while the active context is a household (trigger ordering proof)',
       (select count(*) from public.singles where id = :ac3a_single and account_id = :acct_owner) = 1
   and (select count(*) from public."references" where id = :ac3a_reference and account_id = :acct_owner) = 1
   and (select count(*) from public.shadchanim where id = :ac3a_shadchan and account_id = :acct_owner) = 1
   and (select count(*) from public.shidduchim where id = :ac3a_shidduch and account_id = :acct_owner) = 1
   and (select count(*) from public.resumes where id = :ac3a_resume and account_id = :acct_owner) = 1
   and (select count(*) from public.reference_links where id = :ac3a_link and account_id = :acct_owner) = 1
   and (select count(*) from public.date_records where id = :ac3a_date_record and account_id = :acct_owner) = 1
   and (select count(*) from public.redts where id = :ac3a_redt and account_id = :acct_owner) = 1
   and (select count(*) from public.shidduch_schools where id = :ac3a_school and account_id = :acct_owner) = 1
   and (select count(*) from public.interactions where id = :ac3a_interaction and account_id = :acct_owner) = 1
   and (select count(*) from public.identity_signals where id = :ac3a_signal and account_id = :acct_owner) = 1
   and (select count(*) from public.inbox_items where id = :ac3a_inbox and account_id = :acct_owner) = 1
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
select 'add_persona defaults the new household''s name from the caller''s first_name',
       (
         select a.name from public.accounts a
         join public.account_members am on am.account_id = a.id
         where am.user_id = 'd2d2d2d2-2222-2222-2222-222222222222' and am.role = 'parent_admin' and am.status = 'active'
       ) = 'Pending''s Family';

-- An invited single-role member ticking `single` is a no-op, never a second
-- household.
set local request.jwt.claims = '{"sub":"d3d3d3d3-3333-3333-3333-333333333333","role":"authenticated"}';

select public.add_persona('single');

insert into results (name, passed)
select 'AC-6: an invited single-role member ticking single is a no-op, never a second household',
       (select count(distinct account_id) from public.account_members where user_id = 'd3d3d3d3-3333-3333-3333-333333333333' and status = 'active') = 1
   and (select count(*) from public.singles s join public.account_members am on am.id = s.member_id where am.user_id = 'd3d3d3d3-3333-3333-3333-333333333333') = 1;

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

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
