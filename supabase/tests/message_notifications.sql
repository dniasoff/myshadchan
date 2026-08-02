--
-- Notification delivery (Epic 7 Story 7.5) — database test suite.
--
-- Covers AC-2, AC-4 through AC-13: the fan-out trigger's skipped/failed/push
-- split on both scope axes, the NULL-sender case (AC-7), the closed channel
-- and scope enumerations (AC-6, AC-8), the delete cascade (AC-8),
-- mark_thread_read()'s own-row-only write (AC-2), message_notifications'
-- total unreachability from `authenticated` (AC-11), push_subscriptions'
-- auth.uid()-keyed RLS (AC-12), claim/settle (AC-9 single-session shape —
-- the two-real-sessions proof lives in message_notifications.test.ts, which
-- this script cannot express inside one connection), and every new
-- function's grant boundary.
--
-- A separate file from threads_entity.sql (a distinct concern, and both stay
-- closer to the coding-style guidance this way) but the same conventions:
-- one `begin; ... rollback;` transaction, a `results` table of named checks
-- emitted as JSON, `pg_temp.denied()`/`unexpected_raise()` for SQLSTATE-exact
-- denial proofs (never a bare `exception when others then ... pass`).
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
-- Arrange (as postgres/superuser). One household (account A), one shadchanus
-- account (account B) with an accepted connection between them, and one
-- account-scoped `relationship` thread in A carrying every recipient shape
-- AC-4/AC-5 distinguishes. `relationship` (subject_id null) needs no
-- shidduchim/singles row at all — this suite is not about the pipeline.
-- ---------------------------------------------------------------------------
delete from public.account_members;

insert into auth.users (id, instance_id, aud, role, email) values
  ('51900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-sender@test.local'),
  ('51900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-ok@test.local'),
  ('51900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-push@test.local'),
  ('51900000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-disabled@test.local'),
  ('51900000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-no-members-row@test.local'),
  ('51900000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-shadchan@test.local');

insert into public.accounts (name, kind) values ('Notifications Test Household', 'household')
returning id as household_account_id \gset

insert into public.accounts (name, kind) values ('Notifications Test Shadchanus', 'shadchanus')
returning id as shadchanus_account_id \gset

insert into public.connections (household_account_id, shadchanus_account_id, status)
values (:household_account_id, :shadchanus_account_id, 'accepted')
returning id as connection_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, '51900000-0000-0000-0000-000000000001', 'parent_admin', 'active')
returning id as sender_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, '51900000-0000-0000-0000-000000000002', 'helper', 'active')
returning id as ok_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, '51900000-0000-0000-0000-000000000003', 'helper', 'active')
returning id as push_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, '51900000-0000-0000-0000-000000000004', 'helper', 'active')
returning id as disabled_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, '51900000-0000-0000-0000-000000000005', 'helper', 'active')
returning id as no_members_row_member_id \gset

-- AC-4's `skipped` case: an invited-but-not-accepted membership, modelled
-- exactly as the column comment says — a non-null account_members row whose
-- user_id is null (01_tables.sql:201's nullability, not a deleted user).
insert into public.account_members (account_id, user_id, role, status)
values (:household_account_id, null, 'helper', 'active')
returning id as no_login_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:shadchanus_account_id, '51900000-0000-0000-0000-000000000006', 'shadchan', 'active')
returning id as shadchan_member_id \gset

-- psql does not interpolate :variables inside dollar-quoted DO blocks below,
-- so every id a DO block needs travels through this table instead (the same
-- shape threads_entity.sql uses for the identical reason).
insert into ids values
  ('household_account_id', :household_account_id),
  ('connection_id', :connection_id),
  ('ok_member_id', :ok_member_id);

-- The "failed — no live public.members row" branch: a real login whose
-- members row has since been removed (independent of account_members, which
-- FKs to auth.users, never to members).
delete from public.members where user_id = '51900000-0000-0000-0000-000000000005';

-- The "failed — disabled member" branch.
update public.members set disabled = true where user_id = '51900000-0000-0000-0000-000000000004';

-- push_member_id is the ONLY recipient with a registered device (AC-5).
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values (:push_member_id, 'https://push.example.test/ep-1', 'p256dh-key', 'auth-key');

-- The account-scoped thread and its participants (sender + all five
-- recipients). Inserted directly (not through create_thread()) — this suite
-- is about the fan-out trigger, not thread creation, which 7.1-7.4 already
-- cover.
insert into public.threads (account_id, connection_id, subject_type, subject_id, visibility)
values (:household_account_id, null, 'relationship', null, 'open')
returning id as thread1 \gset

insert into public.thread_participants (account_id, connection_id, thread_id, member_id) values
  (:household_account_id, null, :thread1, :sender_member_id),
  (:household_account_id, null, :thread1, :ok_member_id),
  (:household_account_id, null, :thread1, :push_member_id),
  (:household_account_id, null, :thread1, :disabled_member_id),
  (:household_account_id, null, :thread1, :no_members_row_member_id),
  (:household_account_id, null, :thread1, :no_login_member_id);

-- The connection-scoped thread (AC-8's other axis): one participant from
-- each side.
insert into public.threads (account_id, connection_id, subject_type, subject_id, visibility)
values (null, :connection_id, 'relationship', null, 'open')
returning id as thread2 \gset

insert into public.thread_participants (account_id, connection_id, thread_id, member_id) values
  (null, :connection_id, :thread2, :ok_member_id),
  (null, :connection_id, :thread2, :shadchan_member_id);

-- ---------------------------------------------------------------------------
-- Act: message 1, sent by a real, authenticated sender who is a listed
-- participant of thread1 — set_message_defaults() (02_functions.sql) stamps
-- sender_member_id from current_member_id() itself, so this exercises the
-- SAME real INSERT policy/trigger path a client uses, not a shortcut.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.messages (thread_id, body) values (:thread1, 'Any updates?')
returning id as message1 \gset

reset role;

insert into ids values ('message1', :message1);

insert into results (name, passed)
select 'fan-out (AC-7): the sender is never notified about their own message',
       not exists (
         select 1 from public.message_notifications
         where message_id = :message1 and recipient_member_id = :sender_member_id
       );

insert into results (name, passed, detail)
select 'fan-out (AC-4): a resolvable, enabled email settles pending with recipient_email set',
       mn.status = 'pending' and mn.recipient_email = 'mn-ok@test.local',
       format('status=%s recipient_email=%s', mn.status, mn.recipient_email)
from public.message_notifications mn
where mn.message_id = :message1 and mn.recipient_member_id = :ok_member_id and mn.channel = 'email';

insert into results (name, passed, detail)
select 'fan-out (AC-4): account_members.user_id null settles skipped, not failed',
       mn.status = 'skipped' and mn.error is not null,
       format('status=%s error=%s', mn.status, mn.error)
from public.message_notifications mn
where mn.message_id = :message1 and mn.recipient_member_id = :no_login_member_id and mn.channel = 'email';

insert into results (name, passed, detail)
select 'fan-out (AC-4): a disabled member settles failed with an explanatory error',
       mn.status = 'failed' and mn.error like '%disabled%',
       format('status=%s error=%s', mn.status, mn.error)
from public.message_notifications mn
where mn.message_id = :message1 and mn.recipient_member_id = :disabled_member_id and mn.channel = 'email';

insert into results (name, passed, detail)
select 'fan-out (AC-4): a login with no live members row settles failed with an explanatory error',
       mn.status = 'failed' and mn.error like '%no public.members row%',
       format('status=%s error=%s', mn.status, mn.error)
from public.message_notifications mn
where mn.message_id = :message1 and mn.recipient_member_id = :no_members_row_member_id and mn.channel = 'email';

insert into results (name, passed)
select 'fan-out (AC-5): a recipient with a push_subscriptions row also gets a pending push row',
       count(*) = 1
from public.message_notifications
where message_id = :message1 and recipient_member_id = :push_member_id and channel = 'push' and status = 'pending';

insert into results (name, passed)
select 'fan-out (AC-5): a recipient with no push_subscriptions row gets no push row',
       not exists (
         select 1 from public.message_notifications
         where message_id = :message1 and recipient_member_id = :ok_member_id and channel = 'push'
       );

insert into results (name, passed)
select 'fan-out (AC-8): every queued row for an account-scoped message carries that account_id and a null connection_id',
       count(*) = 6 and every(account_id = :household_account_id) and every(connection_id is null)
from public.message_notifications
where message_id = :message1;

-- ---------------------------------------------------------------------------
-- Act: message 2, inserted with NO auth context at all (postgres/superuser).
-- `reset role` alone is not enough — `request.jwt.claims` is a plain GUC set
-- by `set local` above and outlives a role reset for the rest of this
-- transaction, so it must be cleared explicitly or auth.uid() would still
-- resolve to the previous sender. With it actually cleared,
-- current_member_id() resolves to NULL, so sender_member_id is NULL — AC-7's
-- own falsifiable claim: `is distinct from`, not `<>`, so this must still
-- queue a row for every participant, including the one who would otherwise
-- have been excluded as the sender.
-- ---------------------------------------------------------------------------
reset request.jwt.claims;

insert into public.messages (account_id, connection_id, thread_id, sender_member_id, body)
values (:household_account_id, null, :thread1, null, 'Service note')
returning id as message2 \gset

-- All SIX thread1 participants qualify — `member_id is distinct from NULL`
-- is true for every real id, including the account that would otherwise
-- have been excluded as the sender.
insert into results (name, passed, detail)
select 'fan-out (AC-7): a NULL sender_member_id still queues a row for every participant, including the would-be sender (is distinct from, not <>)',
       count(distinct recipient_member_id) = 6,
       format('recipients notified: %s', count(distinct recipient_member_id))
from public.message_notifications
where message_id = :message2 and channel = 'email';

-- ---------------------------------------------------------------------------
-- Act: message 3, on the CONNECTION-scoped thread — AC-8's other axis.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000006","role":"authenticated"}';

insert into public.messages (thread_id, body) values (:thread2, 'Checking in from the shadchanus side')
returning id as message3 \gset

reset role;

insert into results (name, passed, detail)
select 'fan-out (AC-8): a connection-scoped message''s notification carries connection_id and a null account_id',
       mn.account_id is null and mn.connection_id = :connection_id,
       format('account_id=%s connection_id=%s', mn.account_id, mn.connection_id)
from public.message_notifications mn
where mn.message_id = :message3 and mn.recipient_member_id = :ok_member_id and mn.channel = 'email';

-- ---------------------------------------------------------------------------
-- AC-6: channel is a closed enumeration.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'message_notifications: channel = ''sms'' raises 23514';
  v_account_id bigint; v_message_id bigint; v_recipient_id bigint;
begin
  select value into v_account_id from ids where name = 'household_account_id';
  select value into v_message_id from ids where name = 'message1';
  select value into v_recipient_id from ids where name = 'ok_member_id';
  insert into public.message_notifications (account_id, message_id, recipient_member_id, channel)
  values (v_account_id, v_message_id, v_recipient_id, 'sms');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-8: the scope XOR, both broken shapes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'message_notifications: both scope columns set raises 23514';
  v_account_id bigint; v_connection_id bigint; v_message_id bigint; v_recipient_id bigint;
begin
  select value into v_account_id from ids where name = 'household_account_id';
  select value into v_connection_id from ids where name = 'connection_id';
  select value into v_message_id from ids where name = 'message1';
  select value into v_recipient_id from ids where name = 'ok_member_id';
  insert into public.message_notifications (account_id, connection_id, message_id, recipient_member_id, channel)
  values (v_account_id, v_connection_id, v_message_id, v_recipient_id, 'email');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'message_notifications: neither scope column set raises 23514';
  v_message_id bigint; v_recipient_id bigint;
begin
  select value into v_message_id from ids where name = 'message1';
  select value into v_recipient_id from ids where name = 'ok_member_id';
  insert into public.message_notifications (account_id, connection_id, message_id, recipient_member_id, channel)
  values (null, null, v_message_id, v_recipient_id, 'email');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-8: deleting a message deletes its notifications.
-- ---------------------------------------------------------------------------
delete from public.messages where id = :message1;

insert into results (name, passed)
select 'message_notifications: deleting a message deletes its notifications',
       not exists (select 1 from public.message_notifications where message_id = :message1);

-- ---------------------------------------------------------------------------
-- AC-9 (single-session shape): claim_message_notifications() claims exactly
-- p_limit rows, in 'sending', with attempts incremented, joined through to
-- the underlying thread/message. The two-real-sessions disjoint-set proof
-- (the part of AC-9 this single connection cannot express) lives in
-- message_notifications.test.ts.
-- ---------------------------------------------------------------------------
select * from public.claim_message_notifications(1) \gset claim1_

insert into ids values ('claim1_id', :claim1_id);

insert into results (name, passed, detail)
select 'claim_message_notifications(): claims exactly p_limit row(s), moved to sending with attempts incremented',
       mn.status = 'sending' and mn.attempts = 1,
       format('status=%s attempts=%s', mn.status, mn.attempts)
from public.message_notifications mn
where mn.id = :claim1_id;

-- Re-derived independently from the claimed row's own message_id/thread_id,
-- rather than trusted blindly, so this also proves the function's SELECT
-- picked the right join targets, not merely that some row exists.
insert into results (name, passed, detail)
select 'claim_message_notifications(): returns the real thread_id, message body and subject for the claimed row',
       :claim1_thread_id = t.id and :'claim1_message_body' = m.body and :'claim1_subject_type' = t.subject_type,
       format('claim1_thread_id=%s real_thread_id=%s claim1_subject_type=%s real_subject_type=%s',
              :claim1_thread_id, t.id, :'claim1_subject_type', t.subject_type)
from public.message_notifications mn
join public.messages m on m.id = mn.message_id
join public.threads t on t.id = m.thread_id
where mn.id = :claim1_id;

-- ---------------------------------------------------------------------------
-- Review fix (Story 7.5 F4): claim_message_notifications() carries the
-- recipient's push_subscriptions payload for a `push` row and none for an
-- `email` row. Before this fix the function returned no subscription data
-- at all, so a claimed push row could never actually be sent to — AC-10
-- forbids the Worker reading push_subscriptions itself to get one. Drains
-- every remaining pending row (message2's five plus message3's two — well
-- under the p_limit ceiling), so this must run before settle's tests below
-- start consuming specific rows by id.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'claim_message_notifications(): a push row carries its recipient''s push_subscriptions payload; an email row carries none',
       bool_and(
         case when c.channel = 'push'
           then c.push_subscriptions is not null
                and jsonb_array_length(c.push_subscriptions) = 1
                and c.push_subscriptions @> jsonb_build_array(
                  jsonb_build_object(
                    'endpoint', 'https://push.example.test/ep-1',
                    'p256dh', 'p256dh-key',
                    'auth', 'auth-key'
                  )
                )
           else c.push_subscriptions is null
         end
       ),
       string_agg(format('id=%s channel=%s push_subscriptions=%s', c.id, c.channel, c.push_subscriptions), '; ')
from public.claim_message_notifications(20) c;

-- Sanity: the aggregate above is not vacuously true because zero rows were
-- claimed, and at least one of each channel was actually exercised.
insert into results (name, passed, detail)
select 'claim_message_notifications(): the push-payload check above exercised both a push row and an email row',
       count(*) filter (where mn.channel = 'push') >= 1 and count(*) filter (where mn.channel = 'email') >= 1,
       format('push=%s email=%s',
              count(*) filter (where mn.channel = 'push'),
              count(*) filter (where mn.channel = 'email'))
from public.message_notifications mn
where mn.status = 'sending' and mn.id <> :claim1_id;

-- ---------------------------------------------------------------------------
-- AC-9: settle_message_notification()'s status/transition guards.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'settle_message_notification(): an out-of-enum status raises invalid_parameter_value';
  v_id bigint;
begin
  select value into v_id from ids where name = 'claim1_id';
  perform public.settle_message_notification(v_id, 'bogus');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '22023', '%', sqlstate, sqlerrm);
end $$;

select public.settle_message_notification(:claim1_id, 'sent');

insert into results (name, passed, detail)
select 'settle_message_notification(): a sending row settles sent, with sent_at set',
       mn.status = 'sent' and mn.sent_at is not null,
       format('status=%s sent_at=%s', mn.status, mn.sent_at)
from public.message_notifications mn where mn.id = :claim1_id;

-- A late duplicate settle must not resurrect an already-finished row (it is
-- no longer 'sending', so the guarded UPDATE affects zero rows).
select public.settle_message_notification(:claim1_id, 'failed', 'late duplicate settle');

insert into results (name, passed, detail)
select 'settle_message_notification(): a late duplicate settle cannot resurrect an already-finished row',
       mn.status = 'sent' and mn.error is null,
       format('status=%s error=%s', mn.status, mn.error)
from public.message_notifications mn where mn.id = :claim1_id;

-- ---------------------------------------------------------------------------
-- AC-2: mark_thread_read() touches only the caller's own row.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000002","role":"authenticated"}';

select (public.mark_thread_read(:thread1)).last_read_at is not null as marked \gset

-- psql's \gset stores boolean columns as 't'/'f' (boolout's text form, not
-- the word "true") — cast back to boolean rather than string-compare it.
insert into results (name, passed)
select 'mark_thread_read(): a real participant''s own last_read_at moves to now()', :'marked'::boolean;

reset role;

insert into results (name, passed, detail)
select 'mark_thread_read(): every OTHER participant''s last_read_at is untouched',
       count(*) filter (where last_read_at is not null) = 0,
       format('non-null count: %s', count(*) filter (where last_read_at is not null))
from public.thread_participants
where thread_id = :thread1 and member_id <> :ok_member_id;

-- push_member_id is a participant of thread1, NOT thread2 (only ok_member_id
-- and shadchan_member_id are) — calling mark_thread_read(thread2) as them
-- must affect zero rows (contract §13 rule 4: asserted by row count, not by
-- a raised error).
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000003","role":"authenticated"}';

select (public.mark_thread_read(:thread2)).id is null as no_row_touched \gset

insert into results (name, passed)
select 'mark_thread_read(): a non-participant of the named thread touches zero rows', :'no_row_touched'::boolean;

reset role;

-- ---------------------------------------------------------------------------
-- AC-11: message_notifications is unreachable from `authenticated` — no
-- grant at all, so even a bare SELECT is a hard permission denial (stricter
-- than an RLS-filtered empty result, and unreachable through PostgREST
-- either way).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name text := 'message_notifications: an authenticated client cannot SELECT — no grant at all (AC-11)';
begin
  perform count(*) from public.message_notifications;
  insert into results values (v_name, false, 'select unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'claim_message_notifications(): revoked from authenticated (AC-10)';
begin
  perform public.claim_message_notifications(1);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name text := 'settle_message_notification(): revoked from authenticated (AC-10)';
begin
  -- The grant check happens before the function body ever runs, so an
  -- arbitrary id is enough — this proves the boundary, not the row logic.
  perform public.settle_message_notification(1, 'sent');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- AC-12: push_subscriptions is keyed on auth.uid(), never current_member_id().
-- ok_member_id registers a device; push_member_id (a DIFFERENT member, same
-- household) must not be able to read, update or delete it.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values (:ok_member_id, 'https://push.example.test/ep-owner', 'k', 'a')
returning id as owned_subscription_id \gset

reset role;

insert into ids values ('owned_subscription_id', :owned_subscription_id);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000003","role":"authenticated"}';

select count(*) as cnt from public.push_subscriptions where id = :owned_subscription_id \gset other_read_

insert into results (name, passed, detail)
select 'push_subscriptions (AC-12): a different member''s SELECT of my subscription returns zero rows',
       :other_read_cnt = 0,
       format('rows visible: %s', :other_read_cnt);

with attempt as (
  delete from public.push_subscriptions where id = :owned_subscription_id returning id
)
select count(*) as cnt from attempt \gset other_delete_

insert into results (name, passed, detail)
select 'push_subscriptions (AC-12): a different member''s DELETE of my subscription affects zero rows',
       :other_delete_cnt = 0,
       format('rows deleted: %s', :other_delete_cnt);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name constant text := 'push_subscriptions (AC-12): no UPDATE grant for authenticated at all — replace via delete+insert';
  v_id bigint;
begin
  select value into v_id from ids where name = 'owned_subscription_id';
  update public.push_subscriptions set endpoint = 'https://push.example.test/rewritten' where id = v_id;
  insert into results values (v_name, false, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'push_subscriptions (AC-12): the owning member can still read their own subscription',
       count(*) = 1
from public.push_subscriptions where id = :owned_subscription_id;

-- ---------------------------------------------------------------------------
-- delete_push_subscription_by_endpoint() — the sweep's self-healing path.
-- ---------------------------------------------------------------------------
select public.delete_push_subscription_by_endpoint('https://push.example.test/ep-1');

insert into results (name, passed)
select 'delete_push_subscription_by_endpoint(): removes the matching row',
       not exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.test/ep-1');

-- A second call on an endpoint that no longer exists must not raise.
select public.delete_push_subscription_by_endpoint('https://push.example.test/ep-1');

insert into results (name, passed)
select 'delete_push_subscription_by_endpoint(): a second call on the same endpoint is a silent no-op', true;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51900000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name text := 'delete_push_subscription_by_endpoint(): revoked from authenticated (AC-10)';
begin
  perform public.delete_push_subscription_by_endpoint('https://push.example.test/ep-owner');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report and roll back — this suite leaves nothing behind.
-- ---------------------------------------------------------------------------
select json_agg(row_to_json(results)) from results;

rollback;
