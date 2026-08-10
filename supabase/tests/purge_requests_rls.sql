--
-- purge_requests row-level security (Story 14.4 / PRV-11) — database suite.
--
-- The table exists, its policies applied and its function created when the
-- migration landed, but the RLS PREDICATES had never been evaluated by an
-- authenticated or anon session. Creation succeeding says nothing about who
-- can read/write what; this file is the difference.
--
-- The feature is one sentence: a person who is in the system but never signed
-- up must be able to ask to be removed. The public-facing form submits as
-- anon, which must be able to INSERT a pending row but never read, update, or
-- delete any row. Verification happens via a token emailed to the person,
-- checked by verify_purge_request() which must be callable by anon and
-- authenticated alike.
--
-- Every negative assertion ships with a control proving the withheld row
-- really existed, read back as postgres (superuser, RLS bypassed) rather than
-- through the policy being tested.
--
-- Denial style follows single_row_scoping.sql: a handler that records a PASS
-- for any exception cannot tell "the policy refused me" from "the call blew
-- up", so both write denials below match the specific sqlstate (42501) rather
-- than accepting `when others`.
--
-- Run via: npm run test:unit:db  (needs a stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate,
    format('sqlstate %s %L (expected %s)',
           p_actual_sqlstate, p_actual_message, p_expected_sqlstate)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange: a test account and single for context (seeded as postgres).
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('Purge Test Household', 'household')
returning id as test_account_id \gset

insert into public.singles (account_id, first_name_en, gender)
values (:test_account_id, 'Test Single', 'female')
returning id as test_single_id \gset

-- ---------------------------------------------------------------------------
-- 1. anon CAN insert a pending request (with check constrains status/verified_at)
-- ---------------------------------------------------------------------------
set local role anon;

insert into public.purge_requests (single_name, single_email, verification_token)
values ('Test Single', 'test@example.com', 'test-token-123');

-- Get the generated ID via sequence (anon has USAGE, SELECT on sequence)
insert into ids (name, value)
select 'pending_request_id', currval('public.purge_requests_id_seq')::text;

reset role;

-- Capture the token for later tests (as postgres)
insert into ids (name, value)
select 'pending_request_token', verification_token
from public.purge_requests
where single_name = 'Test Single' and single_email = 'test@example.com'
order by requested_at desc
limit 1;

-- Control: the row exists and has correct initial state
insert into results (name, passed)
select 'CONTROL: pending row exists with status=pending and verified_at=NULL',
       exists (
         select 1 from public.purge_requests
         where id = (select value::bigint from ids where name = 'pending_request_id')
           and status = 'pending'
           and verified_at is null
       );

-- ---------------------------------------------------------------------------
-- 2. anon CANNOT select any purge_requests row
-- ---------------------------------------------------------------------------
set local role anon;

do $$
begin
  begin
    perform 1 from public.purge_requests;
    insert into results values (
      'anon CANNOT select purge_requests (any row)',
      false,
      'select succeeded; RLS should have denied'
    );
  exception when others then
    perform pg_temp.denied(
      'anon CANNOT select purge_requests (any row)',
      '42501', sqlstate, sqlerrm
    );
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. anon CANNOT update a purge_requests row
-- ---------------------------------------------------------------------------
set local role anon;

do $$
declare v_id bigint;
begin
  select value::bigint into v_id from ids where name = 'pending_request_id';
  begin
    update public.purge_requests set status = 'verified' where id = v_id;
    insert into results values (
      'anon CANNOT update purge_requests',
      false,
      'update succeeded; RLS should have denied'
    );
  exception when others then
    perform pg_temp.denied(
      'anon CANNOT update purge_requests',
      '42501', sqlstate, sqlerrm
    );
  end;
end;
$$;

reset role;

-- Control: row still exists unchanged
insert into results (name, passed)
select 'CONTROL: after anon UPDATE attempt, row still exists with status=pending',
       exists (
         select 1 from public.purge_requests
         where id = (select value::bigint from ids where name = 'pending_request_id')
           and status = 'pending'
       );

-- ---------------------------------------------------------------------------
-- 4. anon CANNOT delete a purge_requests row
-- ---------------------------------------------------------------------------
set local role anon;

do $$
declare v_id bigint;
begin
  select value::bigint into v_id from ids where name = 'pending_request_id';
  begin
    delete from public.purge_requests where id = v_id;
    insert into results values (
      'anon CANNOT delete purge_requests',
      false,
      'delete succeeded; RLS should have denied'
    );
  exception when others then
    perform pg_temp.denied(
      'anon CANNOT delete purge_requests',
      '42501', sqlstate, sqlerrm
    );
  end;
end;
$$;

reset role;

-- Control: row still exists
insert into results (name, passed)
select 'CONTROL: after anon DELETE attempt, row still exists',
       exists (
         select 1 from public.purge_requests
         where id = (select value::bigint from ids where name = 'pending_request_id')
       );

-- ---------------------------------------------------------------------------
-- 5. verify_purge_request with a bad token returns {"verified": false}
--    (same shape as expired/already-verified — no token oracle)
-- ---------------------------------------------------------------------------
do $$
declare v_result jsonb;
begin
  select public.verify_purge_request('bad-token-that-does-not-exist') into v_result;
  insert into results (name, passed)
  select 'verify_purge_request with bad token returns verified=false',
         v_result = jsonb_build_object('verified', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. verify_purge_request with an expired token returns {"verified": false}
-- ---------------------------------------------------------------------------
-- Create an expired row (seeded as postgres)
insert into public.purge_requests (single_name, single_email, status, verification_token, expires_at, verified_at)
values ('Expired Single', 'expired@example.com', 'pending', 'expired-token-123', now() - interval '1 day', null)
returning id as expired_id \gset

do $$
declare v_result jsonb;
begin
  select public.verify_purge_request('expired-token-123') into v_result;
  insert into results (name, passed)
  select 'verify_purge_request with expired token returns verified=false',
         v_result = jsonb_build_object('verified', false);
end;
$$;

-- Control: expired row still exists and is NOT marked verified
insert into results (name, passed)
select 'CONTROL: expired row still exists and status=pending (not verified)',
       exists (
         select 1 from public.purge_requests
         where id = :expired_id
           and status = 'pending'
           and verified_at is null
       );

-- ---------------------------------------------------------------------------
-- 7. verify_purge_request with an already-verified token returns {"verified": false}
-- ---------------------------------------------------------------------------
-- Create an already-verified row
insert into public.purge_requests (single_name, single_email, status, verification_token, expires_at, verified_at)
values ('Verified Single', 'verified@example.com', 'verified', 'already-verified-token', now() + interval '7 days', now())
returning id as verified_id \gset

do $$
declare v_result jsonb;
begin
  select public.verify_purge_request('already-verified-token') into v_result;
  insert into results (name, passed)
  select 'verify_purge_request with already-verified token returns verified=false',
         v_result = jsonb_build_object('verified', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. verify_purge_request with a good token returns {"verified": true}
--    and marks the row verified
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_result jsonb;
  v_id bigint;
begin
  select value::bigint into v_id    from ids where name = 'pending_request_id';
  select value        into v_token  from ids where name = 'pending_request_token';

  select public.verify_purge_request(v_token) into v_result;

  insert into results (name, passed)
  select 'verify_purge_request with good token returns verified=true',
         v_result = jsonb_build_object('verified', true);

  -- Control: row is now marked verified
  insert into results (name, passed)
  select 'CONTROL: after successful verify, row status=verified and verified_at is set',
         exists (
           select 1 from public.purge_requests
           where id = v_id
             and status = 'verified'
             and verified_at is not null
         );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Second call with same good token returns {"verified": false} (already verified)
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_result jsonb;
begin
  select value into v_token from ids where name = 'pending_request_token';
  select public.verify_purge_request(v_token) into v_result;

  insert into results (name, passed)
  select 'verify_purge_request called twice with same token returns verified=false on second call',
         v_result = jsonb_build_object('verified', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. authenticated CANNOT select purge_requests (no policy grants this)
-- ---------------------------------------------------------------------------
-- Need an authenticated user context - create a temp user and membership
insert into auth.users (id, instance_id, aud, role, email)
values ('51840000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-test-user@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:test_account_id, '51840000-0000-0000-0000-000000000001', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51840000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from public.purge_requests;
    insert into results values (
      'authenticated CANNOT select purge_requests (no policy grants read)',
      false,
      'select succeeded; no policy should allow this'
    );
  exception when others then
    perform pg_temp.denied(
      'authenticated CANNOT select purge_requests (no policy grants read)',
      '42501', sqlstate, sqlerrm
    );
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;