--
-- Family-shared tasks with assignees (Story 12.3) — database test suite.
--
-- Covers: the public.context_members view (AC-4, security_invoker and
-- cross-context isolation), the validate_task_assignee() trigger (AC-5,
-- AC-6, AC-8) and the AC-9 backfill statement replayed directly.
--
-- One login U holds a parent_admin membership of household account A and a
-- shadchan membership of shadchanus account B — the same "one login, two
-- contexts" shape household_scope_lift.sql uses, and mandatory for the same
-- reason: enforce_membership_role_matches_context() rejects any other role
-- pairing, and two DISJOINT users would never exercise
-- current_context_id()'s active-context resolution (AD-19), which is the
-- thing actually under test. A second household-A member V is the
-- archive/re-add subject for AC-6/AC-7. A third login W, active only as a
-- shadchan of B, is the "foreign member" AC-5's negative needs — someone
-- who is definitely not an active member of A.
--
-- Every raise-expecting check wraps its statement in `begin … exception
-- when others` and records the outcome in `results` rather than letting it
-- propagate — `\set ON_ERROR_STOP on` is on, so an unwrapped failing
-- statement would abort the whole script and emit no JSON report.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any
-- id a DO block below needs is shared through the `ids` temp table rather
-- than \gset (established by context_resolution.sql / household_scope_lift.sql).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- AC-4: security_invoker is set on context_members. Position-independent —
-- checked before any fixture is built, exactly like household_scope_lift.sql's
-- own AC 4(d).
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC-4: context_members carries security_invoker=on',
       reloptions is not null and 'security_invoker=on' = any(reloptions),
       coalesce(array_to_string(reloptions, ','), '(null)')
from pg_class
where relname = 'context_members';

-- ---------------------------------------------------------------------------
-- Arrange: household A (U parent_admin, V parent_admin) and shadchanus B
-- (U shadchan, W shadchan). U's first live membership (A) auto-activates;
-- adding U's second membership (B) afterward leaves A active
-- (activate_first_context_trigger only acts when the user has no live
-- active context yet). V's and W's own first memberships each activate
-- their own initial context the same way.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('a5123001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ta-u@test.local'),
  ('a5123001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ta-v@test.local'),
  ('a5123001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ta-w@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('TA Household A', 'household') returning id as acct_a \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a5123001-0000-0000-0000-000000000001', 'parent_admin', 'active')
returning id as u_am_a \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a5123001-0000-0000-0000-000000000002', 'parent_admin', 'active')
returning id as v_am_a \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'a5123001-0000-0000-0000-000000000001', 'shadchan', 'active')
returning id as u_am_b \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'a5123001-0000-0000-0000-000000000003', 'shadchan', 'active')
returning id as w_am_b \gset

insert into ids values ('u_am_a', :'u_am_a'), ('v_am_a', :'v_am_a'), ('u_am_b', :'u_am_b'), ('w_am_b', :'w_am_b');

update public.members set first_name = 'Uri', last_name = 'TaParent' where user_id = 'a5123001-0000-0000-0000-000000000001';
update public.members set first_name = 'Vera', last_name = 'TaParent' where user_id = 'a5123001-0000-0000-0000-000000000002';
update public.members set first_name = 'Wendy', last_name = 'TaShadchan' where user_id = 'a5123001-0000-0000-0000-000000000003';

select m.id as u_mid from public.members m where m.user_id = 'a5123001-0000-0000-0000-000000000001' \gset
select m.id as v_mid from public.members m where m.user_id = 'a5123001-0000-0000-0000-000000000002' \gset
select m.id as w_mid from public.members m where m.user_id = 'a5123001-0000-0000-0000-000000000003' \gset
insert into ids values ('u_mid', :'u_mid'), ('v_mid', :'v_mid'), ('w_mid', :'w_mid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5123001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: U''s active context is household A right after both memberships exist',
       public.current_context_id() = :acct_a;

-- ---------------------------------------------------------------------------
-- AC-4: context_members while active in A returns A's two active members
-- (U, V) and zero rows for B.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC-4: context_members active in A returns exactly A''s 2 active members',
       (select count(*) from public.context_members) = 2,
       format('count=%s', (select count(*) from public.context_members));

insert into results (name, passed)
select 'AC-4: context_members active in A returns zero rows for B',
       (select count(*) from public.context_members where account_id = :acct_b) = 0;

insert into results (name, passed)
select 'AC-4: context_members active in A includes both U and V ids',
       (select count(*) from public.context_members where id in (:u_mid, :v_mid)) = 2;

-- ---------------------------------------------------------------------------
-- AC-4: the mirror — switch to B, context_members now returns B's 2 active
-- members (U, W) and zero rows for A.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'AC-4: context_members active in B returns exactly B''s 2 active members',
       (select count(*) from public.context_members) = 2;

insert into results (name, passed)
select 'AC-4: context_members active in B returns zero rows for A',
       (select count(*) from public.context_members where account_id = :acct_a) = 0;

insert into results (name, passed)
select 'AC-4: context_members active in B includes both U and W ids',
       (select count(*) from public.context_members where id in (:u_mid, :w_mid)) = 2;

-- Back to A for the assignment tests below.
select public.set_active_context(:acct_a);

-- ---------------------------------------------------------------------------
-- Fixture: a legitimate task in A assigned to V.
-- ---------------------------------------------------------------------------
insert into public.tasks (target_type, target_id, text, member_id)
values ('reference', 1, 'TA task assigned to V', :v_mid)
returning id as task_v_id \gset
insert into ids values ('task_v_id', :'task_v_id');

-- ---------------------------------------------------------------------------
-- AC-5: an INSERT assigning to W (active only in B, not in A) raises
-- check_violation and no row is written.
-- ---------------------------------------------------------------------------
do $$
declare
  v_w_mid bigint;
  v_count_before int;
  v_count_after int;
begin
  select value::bigint into v_w_mid from ids where name = 'w_mid';
  select count(*) into v_count_before from public.tasks;

  insert into public.tasks (target_type, target_id, text, member_id)
    values ('reference', 1, 'TA evil task (should never land)', v_w_mid);

  insert into results values (
    'AC-5: insert with member_id = a non-member of A raises check_violation',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  select count(*) into v_count_after from public.tasks;
  insert into results values (
    'AC-5: insert with member_id = a non-member of A raises check_violation',
    sqlstate = '23514' and v_count_after = v_count_before,
    format('sqlstate=%s count_before=%s count_after=%s', sqlstate, v_count_before, v_count_after)
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC-5: an UPDATE re-assigning the same task to W raises check_violation and
-- the row's member_id is left unchanged (still V).
-- ---------------------------------------------------------------------------
do $$
declare
  v_w_mid bigint;
  v_task_id bigint;
begin
  select value::bigint into v_w_mid from ids where name = 'w_mid';
  select value::bigint into v_task_id from ids where name = 'task_v_id';

  update public.tasks set member_id = v_w_mid where id = v_task_id;

  insert into results values (
    'AC-5: update reassigning to a non-member of A raises check_violation',
    false, 'update unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC-5: update reassigning to a non-member of A raises check_violation',
    sqlstate = '23514', sqlstate
  );
end $$;

insert into results (name, passed, detail)
select 'AC-5: the task''s member_id is unchanged after the rejected update (still V)',
       (select member_id from public.tasks where id = :task_v_id) = :v_mid,
       format('member_id=%s', (select member_id from public.tasks where id = :task_v_id));

-- ---------------------------------------------------------------------------
-- AC-6: archive V's membership, then completing the task (a done_date write
-- that touches neither member_id nor account_id) still succeeds — the
-- trigger's `update of member_id, account_id` column list means it never
-- fires for this write.
-- ---------------------------------------------------------------------------
reset role;
update public.account_members set status = 'archived' where id = (select value::bigint from ids where name = 'v_am_a');

insert into results (name, passed)
select 'Arrange: V''s A membership is now archived',
       (select status from public.account_members where id = (select value::bigint from ids where name = 'v_am_a')) = 'archived';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5123001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-6: context_members active in A no longer includes the archived V',
       (select count(*) from public.context_members where id = :v_mid) = 0;

do $$
declare
  v_task_id bigint;
begin
  select value::bigint into v_task_id from ids where name = 'task_v_id';
  update public.tasks set done_date = now() where id = v_task_id;
  insert into results values (
    'AC-6: completing a task whose assignee was archived still succeeds',
    (select done_date from public.tasks where id = v_task_id) is not null,
    'done_date set'
  );
exception when others then
  insert into results values (
    'AC-6: completing a task whose assignee was archived still succeeds',
    false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC-7: re-add V (a NEW account_members row — id is re-minted, never
-- reused). The task's member_id (public.members.id) is untouched by any of
-- this, and context_members resolves it back to the same name.
-- ---------------------------------------------------------------------------
reset role;
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a5123001-0000-0000-0000-000000000002', 'parent_admin', 'active')
returning id as v_am_a_new \gset
insert into ids values ('v_am_a_new', :'v_am_a_new');

insert into results (name, passed, detail)
select 'AC-7: V''s re-added account_members.id differs from the archived one',
       (select value::bigint from ids where name = 'v_am_a_new')
         <> (select value::bigint from ids where name = 'v_am_a'),
       format('old=%s new=%s',
         (select value from ids where name = 'v_am_a'),
         (select value from ids where name = 'v_am_a_new'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5123001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-7: the task''s member_id is still V''s (stable) members.id after the round-trip',
       (select member_id from public.tasks where id = :task_v_id) = :v_mid;

insert into results (name, passed, detail)
select 'AC-7: context_members resolves V''s id back to the same name after re-adding',
       (select full_name from public.context_members where id = :v_mid) = 'Vera TaParent',
       coalesce((select full_name from public.context_members where id = :v_mid), '(no row)');

-- ---------------------------------------------------------------------------
-- AC-8: tasks are not household-only. Active in shadchanus B, assigning a
-- task to another active B member (W) succeeds.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

do $$
declare
  v_w_mid bigint;
  v_id bigint;
  v_account_id bigint;
begin
  select value::bigint into v_w_mid from ids where name = 'w_mid';
  insert into public.tasks (target_type, target_id, text, member_id)
    values ('reference', 1, 'TA task assigned to W in shadchanus B', v_w_mid)
    returning id, account_id into v_id, v_account_id;
  insert into results values (
    'AC-8: assigning a task to an active member while active in a shadchanus context succeeds',
    v_account_id = (select value::bigint from ids where name = 'acct_b'),
    format('account_id=%s', v_account_id)
  );
exception when others then
  insert into results values (
    'AC-8: assigning a task to an active member while active in a shadchanus context succeeds',
    false, sqlerrm
  );
end $$;

reset role;

-- Same catalog query household_scope_lift.sql's AC 4(d) uses: this story's
-- new validate_task_assignee trigger must not have been misrouted onto
-- enforce_household_scope, and tasks/interactions must still be absent from
-- that trigger's attachment set.
insert into results (name, passed, detail)
select 'AC-8: enforce_household_scope is still not attached to tasks or interactions',
       not exists (
         select 1 from pg_trigger
         where tgfoid = 'public.enforce_household_scope'::regproc
           and not tgisinternal
           and tgrelid in ('public.tasks'::regclass, 'public.interactions'::regclass)
       ),
       format('attached to %s tables total',
         (select count(*) from pg_trigger where tgfoid = 'public.enforce_household_scope'::regproc and not tgisinternal));

-- ---------------------------------------------------------------------------
-- Epic 12 review fix (R5): a GLOBALLY disabled member (members.disabled =
-- true) — active membership, active context, but disabled — is neither
-- pickable in context_members (the roster) nor assignable through
-- validate_task_assignee(): the delivery queue's own enabled-member
-- definition (is_deliverable_member(), 02_functions.sql), and this is now
-- the SAME predicate the roster and the write-time guard use. Before this
-- fix, neither checked `disabled` at all — a disabled account passed both
-- gates and only failed once a reminder for them actually came due.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('a5123001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ta-x-disabled@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a5123001-0000-0000-0000-000000000004', 'helper', 'active')
returning id as x_am_a \gset

update public.members set first_name = 'Xena', last_name = 'TaDisabled', disabled = true
where user_id = 'a5123001-0000-0000-0000-000000000004';

select m.id as x_mid from public.members m where m.user_id = 'a5123001-0000-0000-0000-000000000004' \gset
insert into ids values ('x_am_a', :'x_am_a'), ('x_mid', :'x_mid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5123001-0000-0000-0000-000000000001","role":"authenticated"}';

select public.set_active_context(:acct_a);

insert into results (name, passed, detail)
select 'R5: context_members active in A excludes a globally disabled member despite an active membership',
       (select count(*) from public.context_members where id = :x_mid) = 0,
       format('count=%s', (select count(*) from public.context_members where id = :x_mid));

do $$
declare
  v_x_mid bigint;
  v_count_before int;
  v_count_after int;
begin
  select value::bigint into v_x_mid from ids where name = 'x_mid';
  select count(*) into v_count_before from public.tasks;

  insert into public.tasks (target_type, target_id, text, member_id)
    values ('reference', 1, 'TA task assigned to disabled X (should never land)', v_x_mid);

  insert into results values (
    'R5: insert with member_id = a globally disabled (but active-membership) member raises check_violation',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  select count(*) into v_count_after from public.tasks;
  insert into results values (
    'R5: insert with member_id = a globally disabled (but active-membership) member raises check_violation',
    sqlstate = '23514' and v_count_after = v_count_before,
    format('sqlstate=%s count_before=%s count_after=%s', sqlstate, v_count_before, v_count_after)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- AC-9: replay the exact backfill statement from the migration. The trigger
-- makes it impossible to plant an unresolvable member_id through ordinary
-- DML, so the trigger is disabled just long enough to plant one row with an
-- unresolvable member_id and one row with a valid one, mirroring the
-- pre-migration state the real backfill ran against.
-- ---------------------------------------------------------------------------
alter table public.tasks disable trigger validate_task_assignee;

insert into public.tasks (account_id, target_type, target_id, text, member_id)
values (:acct_a, 'reference', 1, 'TA AC-9 unresolvable (should be nulled)', :w_mid)
returning id as task_ac9_bad_id \gset
insert into ids values ('task_ac9_bad_id', :'task_ac9_bad_id');

insert into public.tasks (account_id, target_type, target_id, text, member_id)
values (:acct_a, 'reference', 1, 'TA AC-9 valid (should be left alone)', :u_mid)
returning id as task_ac9_valid_id \gset
insert into ids values ('task_ac9_valid_id', :'task_ac9_valid_id');

alter table public.tasks enable trigger validate_task_assignee;

-- Story 12.3 AC-9: the exact statement hand-added to the generated
-- migration, replayed verbatim.
update public.tasks t
set member_id = null
where t.member_id is not null
  and not exists (
    select 1
    from public.account_members am
      join public.members m on m.user_id = am.user_id
    where m.id = t.member_id
      and am.account_id = t.account_id
      and am.status = 'active'
  );

insert into results (name, passed, detail)
select 'AC-9: the backfill nulls the unresolvable row''s member_id',
       (select member_id from public.tasks where id = (select value::bigint from ids where name = 'task_ac9_bad_id')) is null,
       format('member_id=%s', (select member_id from public.tasks where id = (select value::bigint from ids where name = 'task_ac9_bad_id')));

insert into results (name, passed, detail)
select 'AC-9: the backfill leaves the valid row''s member_id alone',
       (select member_id from public.tasks where id = (select value::bigint from ids where name = 'task_ac9_valid_id')) = :u_mid,
       format('member_id=%s', (select member_id from public.tasks where id = (select value::bigint from ids where name = 'task_ac9_valid_id')));

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
