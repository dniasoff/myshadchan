--
-- Rename sales -> members (Epic 1, Story 1.2) — database test suite.
--
-- Proves the rename actually happened at the catalog level (not just "grep
-- found nothing"): the old relation/function names are gone, the new ones
-- exist, set_member_id_default() still populates tasks.member_id from the
-- caller, handle_new_user() still inserts a public.members row and
-- bootstraps the first user's account_members row, and — the mandatory
-- negative test for an RLS/grant-touching change — anon still cannot read
-- public.members.
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
-- Arrange. A fresh auth user with no pre-existing membership, so
-- handle_new_user()'s "first user" account_members bootstrap branch is
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
-- handle_new_user(): inserts a public.members row for the new auth user, and
-- bootstraps that user's account_members row since it is the first one.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'handle_new_user() inserts a public.members row for the new auth user',
       exists (
         select 1 from public.members
         where user_id = 'e5e5e5e5-5555-5555-5555-555555555512'
           and first_name = 'Rename' and last_name = 'Test'
       );

insert into results (name, passed)
select 'handle_new_user() bootstraps the first user''s account_members row',
       exists (
         select 1 from public.account_members
         where user_id = 'e5e5e5e5-5555-5555-5555-555555555512'
           and role = 'parent_admin' and status = 'active'
       );

-- ---------------------------------------------------------------------------
-- set_member_id_default(): a task inserted by this user gets member_id
-- populated from auth.uid() — never left null, never client-settable.
-- ---------------------------------------------------------------------------
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
