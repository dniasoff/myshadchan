--
-- tasks_target_type_check widening (Story 3.8) — database test suite.
--
-- Story 3.8 widens tasks_target_type_check to accept 'single', the fourth
-- value of ENTITY_TARGET_TYPES (contract §8). This suite proves the widened
-- constraint accepts a 'single'-targeted task, that the two server-set
-- columns TasksTab.tsx never supplies (account_id via set_tasks_account_id,
-- member_id via set_member_id_default) still resolve correctly under a real
-- authenticated household context — the exact row shape the global Tasks
-- list (tasks/TasksListByDueDate.tsx) filters on — and that the two
-- already-covered rejections (the retired 'contact' value, a task with no
-- target at all) still hold after the widening.
--
-- A bare psql session has auth.uid() NULL -> current_context_id() NULL -> a
-- NOT NULL violation on account_id that fails for a reason unrelated to this
-- change, so this suite authenticates as a real household member
-- (context_rls_hardening.sql's `set local role authenticated` +
-- `set local request.jwt.claims` pattern, references_entity.sql's
-- `insert into auth.users` -> handle_new_user() bootstrap) before inserting
-- anything into tasks.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (tasks_target_types.test.ts) turns each row into a named assertion.
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
-- Arrange: one household tenant with a real member and a single.
-- handle_new_user() (02_functions.sql) bootstraps the public.members row
-- from this auth.users insert — the same mechanism references_entity.sql
-- and context_rls_hardening.sql rely on.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('7ee00000-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ttt-tasks@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('TTT Tasks Tenant') returning id as acct_a \gset
insert into ids values ('acct_a', :acct_a);

insert into public.account_members (account_id, user_id, role)
values (:acct_a, '7ee00000-1111-1111-1111-111111111111', 'parent_admin');

insert into public.singles (account_id, first_name_en, gender)
values (:acct_a, 'Rivka', 'female') returning id as single_a \gset
insert into ids values ('single_a', :single_a);

-- ---------------------------------------------------------------------------
-- Act as the household member — the same context TasksTab.tsx writes from.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"7ee00000-1111-1111-1111-111111111111","role":"authenticated"}';

-- The exact column set TasksTab.tsx's create() call sends: target_type,
-- target_id, text, due_date. Nothing else.
insert into public.tasks (target_type, target_id, text, due_date)
values ('single', :single_a, 'Follow up on the resume', now() + interval '3 days')
returning id as task_a \gset
insert into ids values ('task_a', :task_a);

insert into results (name, passed)
select '''single'' target is accepted by the widened tasks_target_type_check',
       count(*) = 1
from public.tasks where id = :task_a and target_type = 'single';

insert into results (name, passed)
select 'a single-targeted task is scoped to the caller''s household account (account_id = current_context_id())',
       t.account_id = public.current_context_id()
from public.tasks t where t.id = :task_a;

insert into results (name, passed)
select 'member_id resolves via the trigger to the caller''s own members row — the exact join the global Tasks list filters on',
       t.member_id = (select id from public.members where user_id = auth.uid())
from public.tasks t where t.id = :task_a;

insert into results (name, passed)
select 'delivery_channels keeps its in-app + email default; the client never sent it',
       t.delivery_channels = array['in_app', 'email']::text[]
from public.tasks t where t.id = :task_a;

do $$
begin
  insert into public.tasks (target_type, target_id, text) values ('contact', 1, 'A retired target type');
  insert into results values ('the retired ''contact'' target type is still rejected after the widening', false, 'no exception raised');
exception when others then
  insert into results values ('the retired ''contact'' target type is still rejected after the widening', true, sqlerrm);
end $$;

do $$
begin
  insert into public.tasks (text) values ('Task with no target at all');
  insert into results values ('a task with no target is still rejected (sync_task_target() is unaffected by the widening)', false, 'no exception raised');
exception when others then
  insert into results values ('a task with no target is still rejected (sync_task_target() is unaffected by the widening)', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
reset role;
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
