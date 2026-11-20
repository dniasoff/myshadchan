-- Server-side undo coverage.  The graph remains the source of legal forward
-- moves; this suite proves the separate transaction-bound reverse door is
-- private, actor-bound, stale-safe, terminal-state-safe, and demo-fenced.

create temporary table results (
  name text,
  passed boolean,
  detail text
);
grant all on results to public;

insert into auth.users (id, instance_id, aud, role, email) values
  ('9f500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '9ys-one@test.local'),
  ('9f500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '9ys-two@test.local'),
  ('9f500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '9ys-single@test.local'),
  ('9f500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '9ys-pending@test.local'),
  ('9f500000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '9ys-other-account@test.local');

insert into public.accounts (name) values ('9ys Undo Household') returning id as acct \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct, '9f500000-0000-0000-0000-000000000001', 'parent_admin') returning id as member_one \gset
insert into public.account_members (account_id, user_id, role) values
  (:acct, '9f500000-0000-0000-0000-000000000002', 'parent_admin') returning id as member_two \gset
insert into public.account_members (account_id, user_id, role) values
  (:acct, '9f500000-0000-0000-0000-000000000003', 'single') returning id as member_single \gset

insert into public.accounts (name) values ('9ys Other Household') returning id as other_acct \gset
insert into public.account_members (account_id, user_id, role) values
  (:other_acct, '9f500000-0000-0000-0000-000000000005', 'parent_admin') returning id as member_other \gset

insert into public.member_state (user_id, active_account_id) values
  ('9f500000-0000-0000-0000-000000000001', :acct),
  ('9f500000-0000-0000-0000-000000000002', :acct),
  ('9f500000-0000-0000-0000-000000000005', :other_acct)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'One') returning id as single_one \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'Later') returning id as single_later \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'ForSureNot') returning id as single_for_sure_not \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'Yes') returning id as single_yes \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'No') returning id as single_no \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct, 'Undo', 'Age') returning id as single_age \gset

insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_one, :member_one) returning id as shidduch_one \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_later, :member_one) returning id as shidduch_later \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_for_sure_not, :member_one) returning id as shidduch_for_sure_not \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_yes, :member_one) returning id as shidduch_yes \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_no, :member_one) returning id as shidduch_no \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:acct, :single_age, :member_one) returning id as shidduch_age \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:other_acct, 'Undo', 'Other') returning id as single_other \gset
insert into public.shidduchim (account_id, single_id, owner_member_id)
values (:other_acct, :single_other, :member_other) returning id as shidduch_other \gset

create or replace function pg_temp.try_undo(p_id bigint)
returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  perform public.undo_shidduch(p_id);
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

create or replace function pg_temp.try_direct_update(p_id bigint)
returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  update public.shidduchim set pipeline_state = 'look_into' where id = p_id;
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

create or replace function pg_temp.try_context_insert(p_id bigint)
returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  insert into public.shidduch_stage_undo_context
    (transaction_id, shidduch_id, transition_id, actor_member_id, from_state, to_state)
  values (txid_current(), p_id, 1, 1, 'look_into', 'new');
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

create or replace function pg_temp.try_transition(
  p_id bigint,
  p_from public.pipeline_state,
  p_to public.pipeline_state
)
returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  perform public.transition_shidduch(p_id, p_from, p_to);
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

-- User one creates the history row and moves the suggestion forward.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.transition_shidduch(:shidduch_one, 'new', 'look_into') \gset

-- A different actor cannot consume user one's undo window.
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000002","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_one) \gset other_actor_
reset role;

insert into results values (
  'a second actor cannot undo another actor''s move',
  :'other_actor_raised'::boolean
    and :'other_actor_message' = format('undo is not available for shidduch %s', :shidduch_one),
  format('raised=%s message=%s', :'other_actor_raised', :'other_actor_message')
);

-- User one can undo its own move, and a second click is idempotent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.undo_shidduch(:shidduch_one);
select * from pg_temp.try_undo(:shidduch_one) \gset double_click_
reset role;

insert into results
select 'undo restores a normal move and a second click is idempotent',
       s.pipeline_state = 'new'
       and s.close_reason is null
       and :'double_click_raised'::boolean is false,
       format('state=%s close_reason=%s second_click_raised=%s', s.pipeline_state,
              coalesce(s.close_reason, '<null>'), :'double_click_raised')
from public.shidduchim s where s.id = :shidduch_one;

-- The forward graph still refuses a back edge, and a stale from-state is
-- distinct from an illegal edge. These are mutation-power checks: removing
-- either guard makes its corresponding assertion false.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select * from pg_temp.try_transition(:shidduch_one, 'new', 'yes') \gset back_edge_
select * from pg_temp.try_transition(:shidduch_one, 'look_into', 'yes') \gset stale_from_
reset role;

insert into results values (
  'illegal pipeline back edge is refused',
  :'back_edge_raised'::boolean
    and :'back_edge_sqlstate_code' = '23514'
    and :'back_edge_message' = 'illegal pipeline transition: new -> yes',
  format('raised=%s sqlstate=%s message=%s', :'back_edge_raised', :'back_edge_sqlstate_code', :'back_edge_message')
);
insert into results values (
  'stale transition from-state is refused',
  :'stale_from_raised'::boolean
    and :'stale_from_sqlstate_code' = '40001'
    and :'stale_from_message' = format('stale transition: shidduch %s is in state new, not look_into', :shidduch_one),
  format('raised=%s sqlstate=%s message=%s', :'stale_from_raised', :'stale_from_sqlstate_code', :'stale_from_message')
);

-- A later move by another actor makes the earlier actor's undo stale.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.transition_shidduch(:shidduch_later, 'new', 'look_into');
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.transition_shidduch(:shidduch_later, 'look_into', 'yes', 'later actor');
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_later) \gset later_move_
reset role;

insert into results values (
  'undo after a later move is refused',
  :'later_move_raised'::boolean
    and :'later_move_message' = format('undo is not available for shidduch %s', :shidduch_later),
  format('raised=%s message=%s', :'later_move_raised', :'later_move_message')
);

-- The age guard is independent of actor and current-state checks.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.transition_shidduch(:shidduch_age, 'new', 'look_into');
reset role;
update public.shidduch_stage_transitions
set created_at = clock_timestamp() - interval '16 seconds'
where shidduch_id = :shidduch_age;
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_age) \gset aged_move_
reset role;

insert into results values (
  'undo outside the ten-second window plus grace is refused',
  :'aged_move_raised'::boolean
    and :'aged_move_message' = format('undo is not available for shidduch %s', :shidduch_age),
  format('raised=%s message=%s', :'aged_move_raised', :'aged_move_message')
);

-- Terminal transitions restore both the prior state and the prior close reason.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.transition_shidduch(:shidduch_for_sure_not, 'new', 'for_sure_not', 'not a fit');
select public.undo_shidduch(:shidduch_for_sure_not);
select public.transition_shidduch(:shidduch_yes, 'new', 'look_into');
select public.transition_shidduch(:shidduch_yes, 'look_into', 'yes', 'yes reason');
select public.undo_shidduch(:shidduch_yes);
select public.transition_shidduch(:shidduch_no, 'new', 'look_into');
select public.transition_shidduch(:shidduch_no, 'look_into', 'no', 'no reason');
select public.undo_shidduch(:shidduch_no);
reset role;

insert into results
select 'for_sure_not undo restores the prior state and close reason',
       pipeline_state = 'new' and close_reason is null,
       format('state=%s close_reason=%s', pipeline_state, coalesce(close_reason, '<null>'))
from public.shidduchim where id = :shidduch_for_sure_not;
insert into results
select 'yes undo restores the prior state and close reason',
       pipeline_state = 'look_into' and close_reason is null,
       format('state=%s close_reason=%s', pipeline_state, coalesce(close_reason, '<null>'))
from public.shidduchim where id = :shidduch_yes;
insert into results
select 'no undo restores the prior state and close reason',
       pipeline_state = 'look_into' and close_reason is null,
       format('state=%s close_reason=%s', pipeline_state, coalesce(close_reason, '<null>'))
from public.shidduchim where id = :shidduch_no;

-- The raw table writer and the transaction-bound context are not client doors.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select * from pg_temp.try_direct_update(:shidduch_one) \gset direct_update_
select * from pg_temp.try_context_insert(:shidduch_one) \gset forged_context_
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select * from pg_temp.try_context_insert(:shidduch_one) \gset anon_context_
reset role;

insert into results values (
  'authenticated direct UPDATE remains refused',
  :'direct_update_raised'::boolean,
  format('raised=%s sqlstate=%s message=%s', :'direct_update_raised', :'direct_update_sqlstate_code', :'direct_update_message')
);
insert into results values (
  'authenticated and anon cannot forge undo context',
  :'forged_context_raised'::boolean and :'anon_context_raised'::boolean,
  format('authenticated=%s anon=%s', :'forged_context_raised', :'anon_context_raised')
);

-- A single role and a pending/no-active-context login are both denied before
-- the history lookup, even when the target belongs to the same household.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000003","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_one) \gset single_role_
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000004","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_one) \gset pending_role_
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select * from pg_temp.try_undo(:shidduch_one) \gset anon_undo_
reset role;

insert into results values (
  'single, pending, and anonymous callers cannot undo',
  :'single_role_raised'::boolean
    and :'single_role_message' = format('undo is not available for shidduch %s', :shidduch_one)
    and :'pending_role_raised'::boolean
    and :'pending_role_message' = format('undo is not available for shidduch %s', :shidduch_one)
    and :'anon_undo_raised'::boolean
    and :'anon_undo_sqlstate_code' = '42501'
    and :'anon_undo_message' = 'permission denied for function undo_shidduch',
  format('single=%s pending=%s anon=%s anon_sqlstate=%s', :'single_role_raised', :'pending_role_raised', :'anon_undo_raised', :'anon_undo_sqlstate_code')
);

-- A member of another account cannot consume a history row, even though that
-- member is an otherwise authorized parent_admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000005","role":"authenticated"}';
select public.transition_shidduch(:shidduch_other, 'new', 'look_into');
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000002","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_other) \gset wrong_account_
reset role;

insert into results values (
  'a member of another account cannot undo this history row',
  :'wrong_account_raised'::boolean
    and :'wrong_account_sqlstate_code' = '42501'
    and :'wrong_account_message' = format('undo is not available for shidduch %s', :shidduch_other),
  format('raised=%s sqlstate=%s message=%s', :'wrong_account_raised', :'wrong_account_sqlstate_code', :'wrong_account_message')
);

-- The history read policy is account-scoped as well: a manager can inspect
-- their own account's history, but cannot use the table as a cross-account
-- existence oracle. This is intentionally a direct RLS assertion, separate
-- from the SECURITY DEFINER undo authorization above.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into results
select 'stage history select is account scoped',
       exists (
         select 1 from public.shidduch_stage_transitions
         where account_id = :acct
       )
       and not exists (
         select 1 from public.shidduch_stage_transitions
         where account_id = :other_acct
       ),
       format('own_rows=%s other_rows=%s',
              (select count(*) from public.shidduch_stage_transitions where account_id = :acct),
              (select count(*) from public.shidduch_stage_transitions where account_id = :other_acct));
reset role;

-- An account in the clearing phase is fenced even when its member is otherwise
-- authorized.  This is the same lifecycle fence used by customer writes.
insert into public.demo_runs (root_account_id, status)
values (:acct, 'clearing') returning id as run_id \gset
insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values (:run_id, :acct, 'primary-household', 'household', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000001","role":"authenticated"}';
select * from pg_temp.try_undo(:shidduch_later) \gset fenced_
reset role;

insert into results values (
  'demo clearing fence refuses undo',
  :'fenced_raised'::boolean
    and :'fenced_sqlstate_code' = '42501'
    and :'fenced_message' = format('undo is not available for shidduch %s', :shidduch_later),
  format('raised=%s sqlstate=%s message=%s', :'fenced_raised', :'fenced_sqlstate_code', :'fenced_message')
);

-- The account purge path must remove the server-owned history with the
-- account, not leave an account_id-bearing orphan behind. The FK cascade is
-- intentional; this assertion keeps that ownership contract executable.
set local role authenticated;
set local request.jwt.claims = '{"sub":"9f500000-0000-0000-0000-000000000005","role":"authenticated"}';
select public.delete_account_data(:other_acct, '9f500000-0000-0000-0000-000000000005'::uuid, false);
set local role postgres;
insert into results
select 'account purge removes stage history rows',
       not exists (
         select 1 from public.shidduch_stage_transitions
         where account_id = :other_acct
       )
       and not exists (
         select 1 from public.shidduch_stage_undo_context c
         where exists (
           select 1 from public.shidduchim s
           where s.id = c.shidduch_id
             and s.account_id = :other_acct
         )
       ),
       format('history_rows=%s context_rows=%s',
              (select count(*) from public.shidduch_stage_transitions where account_id = :other_acct),
              (select count(*) from public.shidduch_stage_undo_context c
               where exists (
                 select 1 from public.shidduchim s
                 where s.id = c.shidduch_id
                   and s.account_id = :other_acct
               )));
reset role;

select json_agg(row_to_json(results) order by name) from results;
