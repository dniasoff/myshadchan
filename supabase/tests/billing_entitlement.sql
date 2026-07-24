--
-- Billing / AI entitlement (E4) — database test suite.
--
-- Covers what Epic 4 added: the subscription + ai_usage tables and the
-- server-authoritative ai_entitlement() decision. The invariants exercised here
-- only exist inside Postgres and cannot be checked through a mock:
--   * the default posture is UNENTITLED (no row, or not exactly ai/active),
--   * 'lapsed' is a graceful pause, not entitlement,
--   * the usage meter reflects ai_usage,
--   * account isolation (PRV-2): one tenant can neither READ nor FLIP another's
--     subscription, and
--   * NO client-callable path lets a member self-grant entitlement — INSERT and
--     UPDATE from the `authenticated` role are refused, which is the billing
--     bypass the retired client-side placeholder explicitly warned about.
--
-- Every check appends one row to `results`; the script emits them as JSON at the
-- end and rolls back, so it leaves nothing behind. The runner
-- (billing_entitlement.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange. Four users across three accounts plus one with no membership, so we
-- can exercise entitled / lapsed / clean / no-account in isolation from each
-- other. handle_new_user bootstraps the first user's membership; we then clear
-- and re-point memberships at this suite's own accounts (as the other suites do).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a1a1a1a1-1111-1111-1111-1111111111b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bill-a@test.local');
insert into auth.users (id, instance_id, aud, role, email)
values ('b2b2b2b2-2222-2222-2222-2222222222b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bill-b@test.local'),
       ('c3c3c3c3-3333-3333-3333-3333333333b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bill-c@test.local'),
       ('d4d4d4d4-4444-4444-4444-4444444444b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bill-nobody@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('Billing Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('Billing Tenant B') returning id as acct_b \gset
insert into public.accounts (name) values ('Billing Tenant C') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role)
values (:acct_a, 'a1a1a1a1-1111-1111-1111-1111111111b4', 'parent_admin'),
       (:acct_b, 'b2b2b2b2-2222-2222-2222-2222222222b4', 'parent_admin'),
       (:acct_c, 'c3c3c3c3-3333-3333-3333-3333333333b4', 'parent_admin');

-- Tenant A is on the paid AI tier and active, and has used 34 resumes this
-- month. Tenant B was paid but lapsed. Tenant C has no subscription row at all
-- (the free-forever default). All seeded here as the superuser test role —
-- exactly the server-only write path (service_role in production).
insert into public.subscription (account_id, plan, status, current_period_end)
values (:acct_a, 'ai', 'active', now() + interval '20 days');
insert into public.subscription (account_id, plan, status)
values (:acct_b, 'ai', 'lapsed');

insert into public.ai_usage (account_id, period, resumes_parsed)
values (:acct_a, to_char(now(), 'YYYY-MM'), 34);

-- ---------------------------------------------------------------------------
-- ai_entitlement() as tenant A — entitled, with the usage meter.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a1a1a1-1111-1111-1111-1111111111b4","role":"authenticated"}';

insert into results (name, passed)
select 'ai_entitlement: an active AI subscription is entitled',
       (public.ai_entitlement() ->> 'is_entitled')::boolean
       and (public.ai_entitlement() ->> 'plan') = 'ai'
       and (public.ai_entitlement() ->> 'status') = 'active';

insert into results (name, passed)
select 'ai_entitlement: entitled account exposes the monthly resume limit (100)',
       (public.ai_entitlement() ->> 'resumes_limit')::int = 100;

insert into results (name, passed)
select 'ai_entitlement: the usage meter reflects ai_usage for the current month',
       (public.ai_entitlement() ->> 'resumes_used')::int = 34;

insert into results (name, passed)
select 'subscription: a member sees exactly their own account row and no other',
       (select count(*) from public.subscription) = 1
       and (select count(*) from public.subscription where account_id = :acct_a) = 1;

insert into results (name, passed)
select 'subscription: a member cannot READ another account''s subscription (PRV-2)',
       (select count(*) from public.subscription where account_id = :acct_b) = 0;

-- A member cannot self-grant by INSERTing a fresh entitled row for their own
-- account: the authenticated role has no INSERT privilege at all. (The unique
-- account_id would also refuse it, but permission is checked first — this proves
-- the grant, not the constraint.)
do $$
begin
  begin
    insert into public.subscription (account_id, plan, status)
      select public.current_account_id(), 'ai', 'active';
    insert into results (name, passed, detail)
      values ('subscription: a member cannot self-grant via INSERT', false, 'INSERT unexpectedly succeeded');
  exception when others then
    insert into results (name, passed, detail)
      values ('subscription: a member cannot self-grant via INSERT', true, sqlerrm);
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- ai_entitlement() as tenant B — lapsed is a graceful pause, NOT entitlement,
-- and a member cannot flip their own lapsed row back to active.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2b2b2b2-2222-2222-2222-2222222222b4","role":"authenticated"}';

insert into results (name, passed)
select 'ai_entitlement: a lapsed subscription is NOT entitled (graceful pause)',
       not (public.ai_entitlement() ->> 'is_entitled')::boolean
       and (public.ai_entitlement() ->> 'status') = 'lapsed'
       and (public.ai_entitlement() ->> 'resumes_limit')::int = 0;

-- The self-grant attack: "I have a lapsed row, let me just set it active."
do $$
begin
  begin
    update public.subscription
      set status = 'active', plan = 'ai'
      where account_id = public.current_account_id();
    insert into results (name, passed, detail)
      values ('subscription: a member cannot self-grant via UPDATE', false, 'UPDATE unexpectedly succeeded');
  exception when others then
    insert into results (name, passed, detail)
      values ('subscription: a member cannot self-grant via UPDATE', true, sqlerrm);
  end;
end $$;

insert into results (name, passed)
select 'ai_entitlement: entitlement stays false after a self-grant attempt',
       not (public.ai_entitlement() ->> 'is_entitled')::boolean;

insert into results (name, passed)
select 'subscription: a member cannot READ tenant A''s row from tenant B (PRV-2)',
       (select count(*) from public.subscription where account_id = :acct_a) = 0;

reset role;

-- ---------------------------------------------------------------------------
-- ai_entitlement() as tenant C — no subscription row = the free-forever
-- default: not entitled, plan free, status none, no meter.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3c3c3c3-3333-3333-3333-3333333333b4","role":"authenticated"}';

insert into results (name, passed)
select 'ai_entitlement: an account with no subscription row is free and unentitled',
       not (public.ai_entitlement() ->> 'is_entitled')::boolean
       and (public.ai_entitlement() ->> 'plan') = 'free'
       and (public.ai_entitlement() ->> 'status') = 'none'
       and (public.ai_entitlement() ->> 'resumes_used')::int = 0
       and (public.ai_entitlement() ->> 'resumes_limit')::int = 0;

reset role;

-- ---------------------------------------------------------------------------
-- ai_entitlement() with no account context fails closed to free, never errors.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"d4d4d4d4-4444-4444-4444-4444444444b4","role":"authenticated"}';

insert into results (name, passed)
select 'ai_entitlement: a caller with no membership gets the free default, not an error',
       public.ai_entitlement() = jsonb_build_object(
         'is_entitled', false,
         'plan', 'free',
         'status', 'none',
         'resumes_used', 0,
         'resumes_limit', 0
       );

reset role;

-- Confirm no self-grant attempt actually wrote anything: still exactly the two
-- rows we seeded as the server (A active, B lapsed), none added or flipped.
insert into results (name, passed)
select 'subscription: the ledger is unchanged after every self-grant attempt',
       (select count(*) from public.subscription) = 2
       and (select status from public.subscription where account_id = :acct_b) = 'lapsed';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
