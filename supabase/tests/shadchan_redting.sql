--
-- In-platform redting through a connection (Epic 8 Story 8.3) — database
-- test suite.
--
-- Covers the full `redt_via_connection()` workflow: a connected shadchan
-- sends a redt -> lands as an unfiled `inbox_items` row on the connection's
-- HOUSEHOLD (never the shadchan's own account), attributed to the shadchan
-- by name -> a connection-scoped `threads`/`messages` mirror gives the
-- shadchan their own durable record (AC-5) -- plus AC-6's four negative
-- checks in order: (a) no accepted connection at all, (b) an ended
-- connection (not retroactive — the earlier item survives), (c) a
-- DIFFERENTLY-connected shadchan cannot reuse another shadchan's connection
-- id, (d) the created row stays invisible to an unrelated household, exactly
-- like every other `inbox_items` row.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (shadchan_redting.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any
-- value a DO block needs is shared through the `ids` temp table rather than
-- \gset (mirrors shadchan_connections.sql/threads_entity.sql's own
-- convention).
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
-- Denial assertions name the error they expect (threads_entity.sql's own
-- convention — see its header comment for the "exception when others then …
-- PASS" failure mode this closes).
--
--   denied()           — the call MUST raise, with THIS sqlstate and THIS
--                        message. A different failure fails the assertion.
--   unexpected_raise() — the call must NOT raise at all. Any exception fails.
-- ---------------------------------------------------------------------------
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
-- Arrange (as postgres/superuser): household A (the redt's destination),
-- household C (a wholly unrelated third party, for AC-6(d)), and two
-- shadchanus contexts S1/S2 — four disjoint logins, none carrying any
-- membership yet. S1 and S2 each get their OWN accepted connection to
-- household A: AC-6(c) needs S2 to be genuinely connected to A (just via a
-- DIFFERENT connection row), not merely a stranger.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redting-household-a@test.local'),
  ('59300000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redting-household-c@test.local'),
  ('59300000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redting-shadchan-s1@test.local'),
  ('59300000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redting-shadchan-s2@test.local');

insert into public.accounts (name, kind) values ('Redting Household A', 'household')
returning id as household_a \gset
insert into public.accounts (name, kind) values ('Redting Household C', 'household')
returning id as household_c \gset
insert into public.accounts (name, kind) values ('Redting Shadchanus S1', 'shadchanus')
returning id as shadchanus_s1 \gset
insert into public.accounts (name, kind) values ('Redting Shadchanus S2', 'shadchanus')
returning id as shadchanus_s2 \gset

insert into ids values
  ('household_a', :household_a), ('household_c', :household_c),
  ('shadchanus_s1', :shadchanus_s1), ('shadchanus_s2', :shadchanus_s2);

insert into public.account_members (account_id, user_id, role, status) values
  (:household_a, '59300000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:household_c, '59300000-0000-0000-0000-000000000002', 'parent_admin', 'active'),
  (:shadchanus_s1, '59300000-0000-0000-0000-000000000003', 'shadchan', 'active'),
  (:shadchanus_s2, '59300000-0000-0000-0000-000000000004', 'shadchan', 'active');

-- Needed later for the participant-seeding assertion (AC-5) — `\gset` needs
-- exactly one row, so this is a separate, singly-scoped select rather than
-- riding the multi-row insert above.
select id as household_a_member_id from public.account_members
where account_id = :household_a and user_id = '59300000-0000-0000-0000-000000000001' \gset
insert into ids values ('household_a_member_id', :household_a_member_id);

-- Both connections created directly (as postgres) — Story 8.2's own
-- invite/accept workflow is that story's suite's responsibility, not this
-- one's; this suite exercises redt_via_connection() against already-accepted
-- connections.
insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at)
values (:household_a, :shadchanus_s1, 'accepted', :household_a, now())
returning id as connection_a_s1 \gset
insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at)
values (:household_a, :shadchanus_s2, 'accepted', :household_a, now())
returning id as connection_a_s2 \gset

insert into ids values ('connection_a_s1', :connection_a_s1), ('connection_a_s2', :connection_a_s2);

-- ---------------------------------------------------------------------------
-- The successful path (AC-1, AC-2, AC-3, AC-5): shadchan S1 sends a redt
-- through the accepted A<->S1 connection.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000003","role":"authenticated"}';

select (public.redt_via_connection(
  :connection_a_s1, 'A suggestion for Rivky', 'Dovid Berkowitz, BMG, 24, learning well.'
)).id as redt_item_id \gset
insert into ids values ('redt_item_id', :redt_item_id);

reset role;

insert into results (name, passed)
select 'AC-2: the redt lands as an unfiled inbox_items row on the CONNECTION''S HOUSEHOLD (never the shadchan''s own account), source=shadchan, status=unresolved',
       i.account_id = :household_a
   and i.source = 'shadchan'
   and i.status = 'unresolved'
   and i.connection_id = :connection_a_s1
   and i.subject = 'A suggestion for Rivky'
   and i.raw_text = 'Dovid Berkowitz, BMG, 24, learning well.'
from public.inbox_items i where i.id = :redt_item_id;

insert into results (name, passed)
select 'AC-3: the inbox item''s sender shows the connected shadchan''s account name',
       i.sender = 'Redting Shadchanus S1'
from public.inbox_items i where i.id = :redt_item_id;

insert into results (name, passed)
select 'AC-2/AC-4: single_id/shadchan_id stay NULL on arrival — the household resolves "which single" at the confirm step, never a fast-filed row',
       i.single_id is null and i.shadchan_id is null and i.resolved_shidduchim_id is null
from public.inbox_items i where i.id = :redt_item_id;

-- AC-5: the shadchan's own durable record — a connection-scoped thread and
-- message, mirroring Epic 7's shape exactly (create_thread()/a direct
-- messages insert), never a bespoke Epic-8 table.
insert into results (name, passed)
select 'AC-5: a connection-scoped thread (subject_type=relationship, account_id NULL, connection_id set) was created for this redt',
       count(*) = 1
from public.threads t
where t.connection_id = :connection_a_s1
  and t.subject_type = 'relationship'
  and t.account_id is null;

select id as redt_thread_id from public.threads
where connection_id = :connection_a_s1 and subject_type = 'relationship' \gset
insert into ids values ('redt_thread_id', :redt_thread_id);

insert into results (name, passed)
select 'AC-5: the thread carries exactly one message, whose body is the redt''s own raw_text',
       count(*) = 1
from public.messages m
where m.thread_id = :redt_thread_id and m.body = 'Dovid Berkowitz, BMG, 24, learning well.';

insert into results (name, passed)
select 'AC-5: the thread seats BOTH the calling shadchan and the household''s active member as participants',
       bool_and(is_participant) and count(*) = 2
from (
  select exists (
    select 1 from public.account_members am
    where am.user_id = '59300000-0000-0000-0000-000000000003' and am.account_id = :shadchanus_s1
  ) as is_participant
  from public.thread_participants tp
  join public.account_members am on am.id = tp.member_id
  where tp.thread_id = :redt_thread_id and am.account_id = :shadchanus_s1
  union all
  select tp.member_id = :household_a_member_id
  from public.thread_participants tp
  where tp.thread_id = :redt_thread_id and tp.member_id = :household_a_member_id
) participants;

insert into results (name, passed)
select 'AC-5: the shadchan never gets a connection_id/account_id row scoped to the household — the mirror is connection-scoped, not a leak into inbox_items itself',
       t.account_id is null and t.connection_id = :connection_a_s1
from public.threads t where t.id = :redt_thread_id;

-- ---------------------------------------------------------------------------
-- AC-6(c): shadchan S2 IS connected to household A (via connection_a_s2,
-- its OWN accepted connection) — but cannot reuse S1's connection id even
-- so, because the caller must be an active member of THAT connection's own
-- shadchanus_account_id.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(c): shadchan S2 cannot use S1''s connection_id to redt into household A, even though S2 has its own real connection to A';
  v_connection_a_s1 bigint;
begin
  select value into v_connection_a_s1 from ids where name = 'connection_a_s1';
  perform public.redt_via_connection(v_connection_a_s1, 'S2 trying S1''s id', 'This should never land.');
  perform pg_temp.unexpected_raise(v_name, null, 'redt_via_connection unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%not an active member of this connection''s shadchanus context%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6(c): S2''s rejected attempt created no second inbox_items row in household A',
       count(*) = 1
from public.inbox_items where account_id = :household_a and source = 'shadchan';

-- ---------------------------------------------------------------------------
-- AC-6(a): no accepted connection at all — a nonexistent connection id.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(a): a shadchan with no accepted connection cannot create an inbox item (nonexistent connection id)';
begin
  perform public.redt_via_connection(999999999, 'No such connection', 'This should never land.');
  perform pg_temp.unexpected_raise(v_name, null, 'redt_via_connection unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%is not an active connection%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6(a): the rejected attempt created no inbox_items row anywhere for this raw_text',
       count(*) = 0
from public.inbox_items where raw_text = 'This should never land.';

-- ---------------------------------------------------------------------------
-- AC-6(d): the created inbox_items row is invisible to a household other
-- than the connection's own — existing inbox_items RLS (account_id =
-- current_context_id()) already guarantees this; asserted here with the new
-- source value and connection_id column present, to prove they don't loosen
-- anything.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-6(d): an unrelated household (C) reads ZERO inbox_items rows for the redt sent into household A',
       count(*) = 0
from public.inbox_items where id = :redt_item_id;

insert into results (name, passed)
select 'AC-6(d): household C''s own inbox_items view is otherwise unaffected (still zero rows — it never had any)',
       count(*) = 0
from public.inbox_items;

reset role;

-- ---------------------------------------------------------------------------
-- AC-6(b): an ENDED connection cannot be used to redt — and this is NOT
-- retroactive: the item created earlier through connection_a_s1 (while it
-- was still accepted) survives untouched.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.end_connection(:connection_a_s1)).status as ended_status \gset
insert into results (name, passed) values (
  'setup: connection_a_s1 is now ended (end_connection(), Story 8.2)', :'ended_status' = 'ended'
);

set local request.jwt.claims = '{"sub":"59300000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(b): a shadchan whose connection has ended cannot create a new inbox item through it';
  v_connection_a_s1 bigint;
begin
  select value into v_connection_a_s1 from ids where name = 'connection_a_s1';
  perform public.redt_via_connection(v_connection_a_s1, 'After the connection ended', 'This should never land.');
  perform pg_temp.unexpected_raise(v_name, null, 'redt_via_connection unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%is not an active connection%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6(b): ending a connection is not retroactive — the item created BEFORE the connection ended still exists, unresolved, source=shadchan',
       count(*) = 1
from public.inbox_items
where id = :redt_item_id and status = 'unresolved' and source = 'shadchan';

insert into results (name, passed)
select 'AC-6(b): the refused post-end attempt created no new inbox_items row',
       count(*) = 0
from public.inbox_items where raw_text = 'After the connection ended';

-- ---------------------------------------------------------------------------
-- Structural guarantees the story must not regress.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'anon holds no EXECUTE privilege on redt_via_connection',
       not has_function_privilege('anon', 'public.redt_via_connection(bigint, text, text, jsonb)', 'execute');

insert into results (name, passed)
select 'redt_via_connection was not left executable by PUBLIC',
       not has_function_privilege('public', 'public.redt_via_connection(bigint, text, text, jsonb)', 'execute');

insert into results (name, passed)
select 'authenticated CAN execute redt_via_connection (the intended caller)',
       has_function_privilege('authenticated', 'public.redt_via_connection(bigint, text, text, jsonb)', 'execute');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
