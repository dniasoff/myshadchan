--
-- Reminder delivery (Story 12.2) — database test suite.
--
-- Covers AC-1 (idempotent enqueue), AC-2 (snooze re-arms via the due_date
-- key), AC-3 (channel is a closed enumeration), AC-4 (the backfill
-- statement's own semantics — never re-running the migration itself), AC-5
-- (the skipped/failed split, amended after Story 12.3: a null member_id
-- settles skipped, never failed), AC-6 (claim/settle's single-session
-- shape — the two-real-sessions disjoint-set proof lives in
-- reminder_delivery.test.ts, which this script cannot express inside one
-- connection), and both negative tests of AC-8 (task_notifications
-- unreachable from `authenticated`; cron_heartbeat SELECT-only).
--
-- Same conventions as message_notifications.sql: one `begin; ... rollback;`
-- transaction, a `results` table of named checks emitted as JSON,
-- `pg_temp.denied()`/`pg_temp.unexpected_raise()` for SQLSTATE-exact denial
-- proofs (never a bare `exception when others then ... pass`).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_expected_message_like text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate
      and p_actual_message like p_expected_message_like,
    format('sqlstate %s %L (expected %s matching %L)',
           p_actual_sqlstate, p_actual_message,
           p_expected_sqlstate, p_expected_message_like)
  );
end;
$$;

create function pg_temp.unexpected_raise(
  p_name text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    false,
    format('expected the call to succeed, not raise; got sqlstate %s %L',
           p_actual_sqlstate, p_actual_message)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange: one household, one shadchan book entry (every task needs a real
-- target — target_id is NOT NULL), and three real logins: an ok recipient,
-- a to-be-disabled recipient, and a to-be-removed recipient (its
-- public.members row is deleted after its task is inserted, simulating a
-- member archived after assignment — tasks.member_id is FK-less on purpose,
-- 01_tables.sql).
-- ---------------------------------------------------------------------------
delete from public.account_members;

insert into auth.users (id, instance_id, aud, role, email) values
  ('51920000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rd-ok@test.local'),
  ('51920000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rd-disabled@test.local'),
  ('51920000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rd-removed@test.local');

insert into public.accounts (name, kind) values ('Reminder Delivery Test Household', 'household')
returning id as account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '51920000-0000-0000-0000-000000000001', 'parent_admin', 'active')
returning id as ok_account_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '51920000-0000-0000-0000-000000000002', 'helper', 'active')
returning id as disabled_account_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '51920000-0000-0000-0000-000000000003', 'helper', 'active')
returning id as removed_account_member_id \gset

select id as ok_member_id from public.members where user_id = '51920000-0000-0000-0000-000000000001' \gset
select id as disabled_member_id from public.members where user_id = '51920000-0000-0000-0000-000000000002' \gset
select id as removed_member_id from public.members where user_id = '51920000-0000-0000-0000-000000000003' \gset

insert into public.shadchanim (account_id, name)
values (:account_id, 'Reminder Delivery Test Shadchan')
returning id as shadchan_id \gset

insert into ids values
  ('account_id', :account_id),
  ('shadchan_id', :shadchan_id),
  ('ok_member_id', :ok_member_id);

-- ---------------------------------------------------------------------------
-- Arrange: five tasks exercising every branch enqueue_due_task_notifications()
-- makes. Inserted as postgres (bypassing RLS) with an explicit account_id/
-- member_id — set_task_member_id_trigger only fills a NULL member_id from
-- auth.uid(), which is NULL here anyway, so the explicit values below pass
-- through unchanged.
-- ---------------------------------------------------------------------------
insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — due, ok recipient', now() - interval '1 hour', :ok_member_id, array['in_app','email'])
returning id as task_ok \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — due, unassigned', now() - interval '1 hour', null, array['in_app','email'])
returning id as task_unassigned \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — due, disabled recipient', now() - interval '1 hour', :disabled_member_id, array['in_app','email'])
returning id as task_disabled \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — due, removed recipient', now() - interval '1 hour', :removed_member_id, array['in_app','email'])
returning id as task_removed \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — not yet due', now() + interval '1 day', :ok_member_id, array['in_app','email'])
returning id as task_future \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, done_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — already done', now() - interval '1 hour', now(), :ok_member_id, array['in_app','email'])
returning id as task_done \gset

insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — in_app only, due', now() - interval '1 hour', :ok_member_id, array['in_app'])
returning id as task_no_email \gset

-- Simulate the assignee being removed AFTER assignment (the FK-less,
-- validate_task_assignee-only-checks-on-write design 01_tables.sql
-- documents): task_removed's member_id now names nobody.
delete from public.members where user_id = '51920000-0000-0000-0000-000000000003';

-- Simulate the assignee being disabled AFTER assignment.
update public.members set disabled = true where user_id = '51920000-0000-0000-0000-000000000002';

insert into ids values
  ('task_ok', :task_ok),
  ('task_unassigned', :task_unassigned),
  ('task_disabled', :task_disabled),
  ('task_removed', :task_removed),
  ('task_future', :task_future),
  ('task_done', :task_done),
  ('task_no_email', :task_no_email);

-- ---------------------------------------------------------------------------
-- Act: first enqueue pass.
-- ---------------------------------------------------------------------------
select public.enqueue_due_task_notifications() as first_pass_count \gset

insert into results (name, passed, detail)
select 'enqueue_due_task_notifications(): enqueues exactly the four due, open, email-channel tasks',
       :first_pass_count = 4,
       format('returned %s', :first_pass_count);

insert into results (name, passed, detail)
select 'enqueue (AC-1): an ok, resolvable recipient settles pending with recipient_email set',
       tn.status = 'pending' and tn.recipient_email = 'rd-ok@test.local',
       format('status=%s recipient_email=%s', tn.status, tn.recipient_email)
from public.task_notifications tn
where tn.task_id = :task_ok;

insert into results (name, passed, detail)
select 'enqueue (AC-5, amended by Story 12.3): a null member_id settles skipped, never failed',
       tn.status = 'skipped' and tn.error is not null,
       format('status=%s error=%s', tn.status, tn.error)
from public.task_notifications tn
where tn.task_id = :task_unassigned;

insert into results (name, passed, detail)
select 'enqueue (AC-5): a disabled member settles failed with an explanatory error',
       tn.status = 'failed' and tn.error like '%no live or no enabled member%',
       format('status=%s error=%s', tn.status, tn.error)
from public.task_notifications tn
where tn.task_id = :task_disabled;

insert into results (name, passed, detail)
select 'enqueue (AC-5): a member removed after assignment settles failed with an explanatory error',
       tn.status = 'failed' and tn.error like '%no live or no enabled member%',
       format('status=%s error=%s', tn.status, tn.error)
from public.task_notifications tn
where tn.task_id = :task_removed;

insert into results (name, passed)
select 'enqueue: a not-yet-due task is never enqueued',
       not exists (select 1 from public.task_notifications where task_id = :task_future);

insert into results (name, passed)
select 'enqueue: an already-done task is never enqueued',
       not exists (select 1 from public.task_notifications where task_id = :task_done);

insert into results (name, passed)
select 'enqueue: a task with no email in delivery_channels is never enqueued',
       not exists (select 1 from public.task_notifications where task_id = :task_no_email);

-- ---------------------------------------------------------------------------
-- Act (AC-1): a second enqueue pass over the SAME due moment creates nothing
-- further — on conflict (task_id, channel, due_date) do nothing.
-- ---------------------------------------------------------------------------
select public.enqueue_due_task_notifications() as second_pass_count \gset

insert into results (name, passed, detail)
select 'enqueue_due_task_notifications() (AC-1): a second pass over the same due moment enqueues nothing further',
       :second_pass_count = 0,
       format('returned %s', :second_pass_count);

insert into results (name, passed)
select 'task_notifications (AC-1): exactly one row per due task after two enqueue passes',
       count(*) = 4
from public.task_notifications
where task_id in (:task_ok, :task_unassigned, :task_disabled, :task_removed);

-- ---------------------------------------------------------------------------
-- Act (AC-2): snoozing task_ok (advancing due_date, exactly what
-- useReminders.ts's snooze() does) enqueues a FRESH row at the new due_date
-- — the whole reason due_date is part of the unique key. The original row
-- (old due_date) is untouched.
-- ---------------------------------------------------------------------------
update public.tasks set due_date = now() - interval '5 minutes' where id = :task_ok;

select public.enqueue_due_task_notifications() as snooze_pass_count \gset

insert into results (name, passed, detail)
select 'enqueue (AC-2): snoozing a task (new due_date) enqueues exactly one fresh row',
       :snooze_pass_count = 1,
       format('returned %s', :snooze_pass_count);

insert into results (name, passed)
select 'task_notifications (AC-2): task_ok now carries two rows, one per due_date',
       count(*) = 2
from public.task_notifications
where task_id = :task_ok;

-- ---------------------------------------------------------------------------
-- AC-3: channel is a closed enumeration — 'push' is rejected.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'task_notifications: channel = ''push'' raises 23514';
  v_account_id bigint; v_task_id bigint;
begin
  select value into v_account_id from ids where name = 'account_id';
  select value into v_task_id from ids where name = 'task_future';
  insert into public.task_notifications (account_id, task_id, channel, due_date, status)
  values (v_account_id, v_task_id, 'push', now(), 'pending');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-4: the backfill statement's own semantics (never re-running the
-- migration) — a task that was already overdue "before the table existed"
-- settles skipped, and a later enqueue pass suppresses it forever after via
-- the same on conflict do nothing this migration statement relies on.
-- ---------------------------------------------------------------------------
insert into public.tasks (account_id, target_type, target_id, text, due_date, member_id, delivery_channels)
values (:account_id, 'shadchan', :shadchan_id, 'Follow up — pre-existing overdue backlog', now() - interval '30 days', :ok_member_id, array['in_app','email'])
returning id as task_backlog \gset

insert into ids values ('task_backlog', :task_backlog);

-- The exact statement 20260806223744_reminder_delivery.sql hand-adds after
-- create table, verbatim.
insert into public.task_notifications
  (account_id, task_id, channel, due_date, status, error)
select t.account_id, t.id, 'email', t.due_date, 'skipped',
       'pre-delivery backlog suppressed by the migration that introduced this table'
from public.tasks t
where t.done_date is null
  and t.due_date is not null
  and t.due_date <= now()
  and 'email' = any (t.delivery_channels)
  and t.id = :task_backlog
on conflict do nothing;

insert into results (name, passed, detail)
select 'AC-4 backfill: the pre-existing overdue task settles exactly one skipped row',
       count(*) = 1 and bool_and(status = 'skipped'),
       format('rows=%s', count(*))
from public.task_notifications
where task_id = :task_backlog;

select public.enqueue_due_task_notifications() as backlog_enqueue_count \gset

insert into results (name, passed, detail)
select 'AC-4 backfill: a later enqueue pass suppresses the backlog task forever after (on conflict do nothing)',
       count(*) = 1,
       format('rows for task_backlog after a second enqueue pass: %s', count(*))
from public.task_notifications
where task_id = :task_backlog;

-- ---------------------------------------------------------------------------
-- AC-1, AC-6 (single-session shape): claim_due_task_notifications() claims
-- pending rows, moves them to sending with attempts incremented, and joins
-- through to the real task text/target. The two-real-sessions disjoint-set
-- proof lives in reminder_delivery.test.ts.
-- ---------------------------------------------------------------------------
select * from public.claim_due_task_notifications(1) \gset claim1_

insert into ids values ('claim1_id', :claim1_id);

insert into results (name, passed, detail)
select 'claim_due_task_notifications(): claims exactly p_limit row(s), moved to sending with attempts incremented',
       tn.status = 'sending' and tn.attempts = 1,
       format('status=%s attempts=%s', tn.status, tn.attempts)
from public.task_notifications tn
where tn.id = :claim1_id;

insert into results (name, passed, detail)
select 'claim_due_task_notifications(): returns the real task text/target for the claimed row',
       :'claim1_task_text' = t.text and :'claim1_target_type' = 'shadchan' and :claim1_target_id = t.target_id,
       format('claim1_task_text=%L real_text=%L claim1_target_type=%L claim1_target_id=%s real_target_id=%s',
              :'claim1_task_text', t.text, :'claim1_target_type', :claim1_target_id, t.target_id)
from public.task_notifications tn
join public.tasks t on t.id = tn.task_id
where tn.id = :claim1_id;

-- Drain every remaining pending row so the settle tests below consume
-- specific rows by id without a leftover pending row confusing later checks.
select count(*) as drained_count from public.claim_due_task_notifications(50) \gset

-- ---------------------------------------------------------------------------
-- AC-1, AC-6: settle_task_notification()'s status/transition guards.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'settle_task_notification(): an out-of-enum status raises invalid_parameter_value';
  v_id bigint;
begin
  select value into v_id from ids where name = 'claim1_id';
  perform public.settle_task_notification(v_id, 'bogus');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '22023', '%', sqlstate, sqlerrm);
end $$;

select public.settle_task_notification(:claim1_id, 'sent');

insert into results (name, passed, detail)
select 'settle_task_notification(): a sending row settles sent, with sent_at set',
       tn.status = 'sent' and tn.sent_at is not null,
       format('status=%s sent_at=%s', tn.status, tn.sent_at)
from public.task_notifications tn where tn.id = :claim1_id;

-- A late duplicate settle must not resurrect an already-finished row.
select public.settle_task_notification(:claim1_id, 'failed', 'late duplicate settle');

insert into results (name, passed, detail)
select 'settle_task_notification(): a late duplicate settle cannot resurrect an already-finished row',
       tn.status = 'sent' and tn.error is null,
       format('status=%s error=%s', tn.status, tn.error)
from public.task_notifications tn where tn.id = :claim1_id;

-- ---------------------------------------------------------------------------
-- AC-9: record_cron_heartbeat()'s bounded-code enforcement.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'record_cron_heartbeat(): an out-of-enum error code raises invalid_parameter_value';
begin
  perform public.record_cron_heartbeat('cron', 'some raw provider text');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '22023', '%', sqlstate, sqlerrm);
end $$;

select public.record_cron_heartbeat('cron', null);

insert into results (name, passed, detail)
select 'record_cron_heartbeat(): a null error code records a healthy heartbeat (last_ok_at set)',
       ch.last_ok_at is not null and ch.last_error is null,
       format('last_ok_at=%s last_error=%s', ch.last_ok_at, ch.last_error)
from public.cron_heartbeat ch where ch.worker = 'cron';

select public.record_cron_heartbeat('cron', 'transport_failed');

insert into results (name, passed, detail)
select 'record_cron_heartbeat(): a bounded error code is accepted and last_ok_at is left untouched',
       ch.last_error = 'transport_failed' and ch.last_ok_at is not null,
       format('last_error=%s last_ok_at=%s', ch.last_error, ch.last_ok_at)
from public.cron_heartbeat ch where ch.worker = 'cron';

-- ---------------------------------------------------------------------------
-- AC-8: task_notifications is unreachable from `authenticated` — no grant at
-- all, so even a bare SELECT is a hard permission denial. cron_heartbeat, by
-- contrast, IS readable (AC-9) but has no write path for `authenticated`.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51920000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name text := 'task_notifications: an authenticated client cannot SELECT — no grant at all (AC-8)';
begin
  perform count(*) from public.task_notifications;
  insert into results values (v_name, false, 'select unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'task_notifications: an authenticated client cannot INSERT (AC-8)';
  v_account_id bigint; v_task_id bigint;
begin
  select value into v_account_id from ids where name = 'account_id';
  select value into v_task_id from ids where name = 'task_future';
  insert into public.task_notifications (account_id, task_id, channel, due_date, status)
  values (v_account_id, v_task_id, 'email', now(), 'pending');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'task_notifications: an authenticated client cannot UPDATE (AC-8)';
  v_id bigint;
begin
  select value into v_id from ids where name = 'claim1_id';
  update public.task_notifications set status = 'pending' where id = v_id;
  insert into results values (v_name, false, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'task_notifications: an authenticated client cannot DELETE (AC-8)';
  v_id bigint;
begin
  select value into v_id from ids where name = 'claim1_id';
  delete from public.task_notifications where id = v_id;
  insert into results values (v_name, false, 'delete unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'claim_due_task_notifications(): revoked from authenticated (AC-8)';
begin
  perform public.claim_due_task_notifications(1);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'settle_task_notification(): revoked from authenticated (AC-8)';
begin
  perform public.settle_task_notification(1, 'sent');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'enqueue_due_task_notifications(): revoked from authenticated (AC-8)';
begin
  perform public.enqueue_due_task_notifications();
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'record_cron_heartbeat(): revoked from authenticated (AC-9)';
begin
  perform public.record_cron_heartbeat('cron', null);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

-- cron_heartbeat: SELECT succeeds (AC-9's whole point), but no write path.
insert into results (name, passed)
select 'cron_heartbeat (AC-9): an authenticated client CAN select the heartbeat row',
       count(*) = 1
from public.cron_heartbeat where worker = 'cron';

do $$
declare
  v_name text := 'cron_heartbeat: an authenticated client cannot INSERT (no write policy, AC-9)';
begin
  insert into public.cron_heartbeat (worker) values ('forged');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'cron_heartbeat: an authenticated client cannot UPDATE (no write policy, AC-9)';
begin
  update public.cron_heartbeat set last_error = null where worker = 'cron';
  insert into results values (v_name, false, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'cron_heartbeat: an authenticated client cannot DELETE (no write policy, AC-9)';
begin
  delete from public.cron_heartbeat where worker = 'cron';
  insert into results values (v_name, false, 'delete unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report and roll back — this suite leaves nothing behind.
-- ---------------------------------------------------------------------------
select json_agg(row_to_json(results)) from results;

rollback;
