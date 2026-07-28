--
-- Rename sales -> members (Epic 1, Story 1.2) — database test suite.
--
-- Proves the rename actually happened at the catalog level (not just "grep
-- found nothing"): the old relation/function names are gone, the new ones
-- exist, set_member_id_default() still populates tasks.member_id from the
-- caller, handle_new_user() still inserts a public.members row (Story 2.7
-- rewrote its membership branch to bind from an invite instead of
-- bootstrapping the first user — see supabase/tests/invites.sql for that
-- suite), and — the mandatory negative test for an RLS/grant-touching
-- change — anon still cannot read public.members.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (members_rename.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Structural proof: positive proof of deletion (to_regclass/to_regproc return
-- NULL for a relation/function that no longer exists), not merely an absence
-- of grep hits.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'public.sales no longer exists', to_regclass('public.sales') is null;

insert into results (name, passed)
select 'public.members exists', to_regclass('public.members') is not null;

insert into results (name, passed)
select 'public.set_sales_id_default() no longer exists',
       to_regproc('public.set_sales_id_default') is null;

insert into results (name, passed)
select 'public.set_member_id_default() exists',
       to_regproc('public.set_member_id_default') is not null;

insert into results (name, passed)
select 'no relation in schema public is named sales%',
       not exists (
         select 1 from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname like 'sales%'
       );

-- ---------------------------------------------------------------------------
-- Negative RLS/grant check (mandatory for an RLS-touching change): anon
-- cannot read public.members. Two angles — the catalog privilege check, and a
-- live attempted SELECT as the anon role — so a regression that widens the
-- grant is caught even if one check has a blind spot.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'anon holds no SELECT/INSERT/UPDATE/DELETE grant on public.members',
       not has_table_privilege('anon', 'public.members', 'select')
       and not has_table_privilege('anon', 'public.members', 'insert')
       and not has_table_privilege('anon', 'public.members', 'update')
       and not has_table_privilege('anon', 'public.members', 'delete');

set local role anon;

do $$
begin
  begin
    perform count(*) from public.members;
    insert into results (name, passed, detail)
      values ('anon cannot SELECT from public.members', false, 'SELECT unexpectedly succeeded');
  exception when others then
    insert into results (name, passed, detail)
      values ('anon cannot SELECT from public.members', true, sqlerrm);
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Arrange. A fresh auth user with no pre-existing membership and no invite
-- token, so handle_new_user()'s AC-7 fallback (no matching invite -> no
-- membership at all, replacing the fork's deleted "first user" bootstrap) is
-- exercised deterministically rather than being an artifact of whatever the
-- dev database already holds. Cleared first, as the other db suites do.
-- ---------------------------------------------------------------------------
delete from public.account_members;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'e5e5e5e5-5555-5555-5555-555555555512',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'members-rename@test.local',
  '{"first_name":"Rename","last_name":"Test"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- handle_new_user(): inserts a public.members row for the new auth user.
-- Story 2.7 (AC-7) deleted the fork's "first user bootstraps the tenant"
-- branch this suite used to assert here — a signup with no invite_token now
-- gets NO account_members row at all, proven below instead of the old
-- bootstrap (see supabase/tests/invites.sql for the full invite-binding
-- suite, including the matching-invite success case).
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'handle_new_user() inserts a public.members row for the new auth user',
       exists (
         select 1 from public.members
         where user_id = 'e5e5e5e5-5555-5555-5555-555555555512'
           and first_name = 'Rename' and last_name = 'Test'
       );

insert into results (name, passed)
select 'handle_new_user() gets NO membership for a signup with no invite (AC-7 replaces the old first-user bootstrap)',
       not exists (
         select 1 from public.account_members
         where user_id = 'e5e5e5e5-5555-5555-5555-555555555512'
       );

-- ---------------------------------------------------------------------------
-- set_member_id_default(): a task inserted by this user gets member_id
-- populated from auth.uid() — never left null, never client-settable.
-- Story 2.7 removed the first-user bootstrap, so this user needs an explicit
-- household membership before it can insert anything account-scoped
-- (tasks.account_id fails closed on a NULL current_context_id()) — that
-- membership is arranged directly here, not through handle_new_user(), since
-- provisioning-via-invite is a separate concern already covered end to end
-- by supabase/tests/invites.sql.
-- ---------------------------------------------------------------------------
insert into public.accounts (name) values ('Rename Test Account') returning id as rename_acct \gset
insert into public.account_members (account_id, user_id, role, status)
values (:rename_acct, 'e5e5e5e5-5555-5555-5555-555555555512', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5e5e5e5-5555-5555-5555-555555555512","role":"authenticated"}';

insert into public.tasks (type, text, due_date, target_type, target_id)
values ('call', 'Follow up', now(), 'shadchan', 1)
returning member_id as new_task_member_id \gset

reset role;

insert into results (name, passed)
select 'set_member_id_default() populates tasks.member_id from auth.uid()',
       :new_task_member_id = (
         select id from public.members
         where user_id = 'e5e5e5e5-5555-5555-5555-555555555512'
       );

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
