--
-- Consent-based connection (Epic 8 Story 8.2) — database test suite.
--
-- Covers the full workflow: create_connection_invite() -> preview
-- (by any authenticated caller, never just the parties) ->
-- accept_connection_invite() -> the household's own book entry ->
-- end_connection(), plus AC-6's six negative checks in order: (a) a
-- third-party household cannot read the connection, (b) an unrelated
-- shadchan cannot end it, (c) same-kind acceptance is rejected and creates
-- no row, (d) an expired or revoked invite cannot be accepted, (e)
-- accepting the same invite twice yields exactly one connections row, (f)
-- a direct insert/update on connections and connection_invites as
-- authenticated is refused.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (shadchan_connections.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any
-- value a DO block needs is shared through the `ids`/`tokens` temp tables
-- rather than \gset (mirrors references_entity.sql / threads_entity.sql's
-- own convention).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
create temp table tokens (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;
grant all on tokens to public;

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
-- Arrange (as postgres/superuser): two households (A, C) and two shadchanus
-- contexts (S, S2) — four disjoint logins, none carrying any membership yet
-- (Story 2.7 AC-7 replaced the old first-user bootstrap, so a bare signup
-- gets none).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connections-household-a@test.local'),
  ('59200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connections-household-c@test.local'),
  ('59200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connections-shadchan-s@test.local'),
  ('59200000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connections-shadchan-s2@test.local');

insert into public.accounts (name, kind) values ('Connections Household A', 'household')
returning id as household_a \gset
insert into public.accounts (name, kind) values ('Connections Household C', 'household')
returning id as household_c \gset
insert into public.accounts (name, kind) values ('Connections Shadchanus S', 'shadchanus')
returning id as shadchanus_s \gset
insert into public.accounts (name, kind) values ('Connections Shadchanus S2', 'shadchanus')
returning id as shadchanus_s2 \gset

insert into ids values
  ('household_a', :household_a), ('household_c', :household_c),
  ('shadchanus_s', :shadchanus_s), ('shadchanus_s2', :shadchanus_s2);

insert into public.account_members (account_id, user_id, role, status) values
  (:household_a, '59200000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:household_c, '59200000-0000-0000-0000-000000000002', 'parent_admin', 'active'),
  (:shadchanus_s, '59200000-0000-0000-0000-000000000003', 'shadchan', 'active'),
  (:shadchanus_s2, '59200000-0000-0000-0000-000000000004', 'shadchan', 'active');

-- ---------------------------------------------------------------------------
-- Act as household A. create_connection_invite() (Task 3, AC-1/AC-2).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_connection_invite() as token_a_to_s \gset
insert into tokens values ('token_a_to_s', :'token_a_to_s');

insert into results (name, passed)
select 'create_connection_invite: exactly one pending invite is created, inviter_account_id/inviter_kind server-set',
       count(*) = 1
from public.connection_invites
where inviter_account_id = :household_a and inviter_kind = 'household' and status = 'pending';

insert into results (name, passed)
select 'create_connection_invite: the raw token is never stored — token_hash is a 64-char hex digest, not the token itself',
       length(ci.token_hash) = 64 and ci.token_hash <> :'token_a_to_s'
from public.connection_invites ci
where ci.inviter_account_id = :household_a;

-- The issuer has no way to read the raw token back through the table — only
-- the one-time return value above carries it.
insert into results (name, passed)
select 'connection_invites never exposes a usable token through a table read',
       not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'connection_invites'
           and column_name = 'token'
       );

-- ---------------------------------------------------------------------------
-- preview_connection_invite() (Task 3): any authenticated caller (here,
-- household C — a stranger to this invite) sees who is inviting, never the
-- token or ids.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'preview_connection_invite: shows the inviter''s name and kind to ANY authenticated caller',
       p.inviter_name = 'Connections Household A' and p.inviter_kind = 'household' and p.status = 'pending'
from public.preview_connection_invite(:'token_a_to_s') p;

insert into results (name, passed)
select 'preview_connection_invite: an unknown token resolves to an empty set, never an error',
       count(*) = 0
from public.preview_connection_invite('not-a-real-token');

-- ---------------------------------------------------------------------------
-- AC-4 / AC-6(c): same-kind acceptance is rejected and creates no row.
-- Household C (another household) tries to accept household A's invite.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'AC-4/AC-6(c): a household cannot accept another household''s invite (same kind on both sides)';
  v_token text;
begin
  select value into v_token from tokens where name = 'token_a_to_s';
  perform public.accept_connection_invite(v_token);
  perform pg_temp.unexpected_raise(v_name, null, 'accept unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%not two of the same kind%', sqlstate, sqlerrm);
end $$;

-- `reset role` for these two: household C (the caller above) is party to
-- neither row, so RLS would hide a wrongly-created connection/invite from
-- it too — that coincidence would make "count(*) = 0" pass even if the
-- rejection had a bug, which is not a real check. Reading as postgres (RLS
-- bypassed) is the only way this asserts the GLOBAL truth.
reset role;

insert into results (name, passed)
select 'AC-6(c): the rejected same-kind acceptance created no connections row', count(*) = 0
from public.connections;

insert into results (name, passed)
select 'AC-6(c): the invite is still pending after the rejected same-kind attempt', ci.status = 'pending'
from public.connection_invites ci where ci.inviter_account_id = :household_a;

-- ---------------------------------------------------------------------------
-- The real accept: shadchanus S (opposite kind) accepts household A's
-- invite (AC-1, AC-4). Steps 4-6 of accept_connection_invite() in one call.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';

select (public.accept_connection_invite(:'token_a_to_s')).id as connection_a_s \gset
insert into ids values ('connection_a_s', :connection_a_s);

insert into results (name, passed)
select 'accept_connection_invite: creates exactly one connections row, correctly sided',
       c.household_account_id = :household_a
   and c.shadchanus_account_id = :shadchanus_s
   and c.status = 'accepted'
   and c.proposed_by_account_id = :household_a
   and c.accepted_at is not null
from public.connections c where c.id = :connection_a_s;

-- `reset role`: the invite is scoped to its ISSUER (household A), not the
-- acceptor (S) whose claims are still active — S has no SELECT path to
-- connection_invites at all (05_policies.sql scopes it to
-- inviter_account_id), so this must read as postgres to see the burned
-- invite; likewise shadchanim is scoped to household A, not S.
reset role;

insert into results (name, passed)
select 'accept_connection_invite: burns the invite (status = accepted, accepted_by_account_id = the acceptor)',
       ci.status = 'accepted' and ci.accepted_by_account_id = :shadchanus_s and ci.accepted_at is not null
from public.connection_invites ci where ci.inviter_account_id = :household_a;

insert into results (name, passed)
select 'accept_connection_invite: seeds the household''s own book entry (Shadchan 360, Story 5.9), named from the shadchanus account',
       count(*) = 1
from public.shadchanim s
where s.account_id = :household_a
  and s.connection_id = :connection_a_s
  and s.name = 'Connections Shadchanus S';

-- ---------------------------------------------------------------------------
-- AC-6(e): accepting the SAME invite twice does not create a second row —
-- the second call must raise (the invite is no longer pending), not
-- silently succeed again.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(e): accepting the same invite a second time is refused, not silently repeated';
  v_token text;
begin
  select value into v_token from tokens where name = 'token_a_to_s';
  perform public.accept_connection_invite(v_token);
  perform pg_temp.unexpected_raise(v_name, null, 'second accept unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%invalid, expired, or has already been used%', sqlstate, sqlerrm);
end $$;

insert into results (name, passed)
select 'AC-6(e): exactly one connections row exists for this pair after the repeat attempt', count(*) = 1
from public.connections
where household_account_id = :household_a and shadchanus_account_id = :shadchanus_s;

-- ---------------------------------------------------------------------------
-- AC-6(d): a revoked invite cannot be accepted. Household A issues a
-- second invite and revokes it before anyone accepts.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_connection_invite() as token_a_revoked \gset
insert into tokens values ('token_a_revoked', :'token_a_revoked');

select id as invite_a_revoked from public.connection_invites
where inviter_account_id = :household_a and status = 'pending'
  and token_hash = encode(extensions.digest(:'token_a_revoked', 'sha256'), 'hex') \gset
insert into ids values ('invite_a_revoked', :invite_a_revoked);

select public.revoke_connection_invite(:invite_a_revoked);

insert into results (name, passed)
select 'revoke_connection_invite: flips status to revoked, stamps revoked_at', ci.status = 'revoked' and ci.revoked_at is not null
from public.connection_invites ci where ci.id = :invite_a_revoked;

do $$
declare
  v_name constant text := 'revoke_connection_invite: revoking an already-revoked invite is refused';
  v_invite_id bigint;
begin
  select value into v_invite_id from ids where name = 'invite_a_revoked';
  perform public.revoke_connection_invite(v_invite_id);
  perform pg_temp.unexpected_raise(v_name, null, 'second revoke unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%is not pending%', sqlstate, sqlerrm);
end $$;

set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(d): a revoked invite cannot be accepted';
  v_token text;
begin
  select value into v_token from tokens where name = 'token_a_revoked';
  perform public.accept_connection_invite(v_token);
  perform pg_temp.unexpected_raise(v_name, null, 'accepting a revoked invite unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%invalid, expired, or has already been used%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-6(d), continued: an EXPIRED invite cannot be accepted either. Backdate
-- a third invite's expires_at as postgres (authenticated holds no UPDATE
-- grant on connection_invites at all — see the (f) check further down).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_connection_invite() as token_a_expired \gset
insert into tokens values ('token_a_expired', :'token_a_expired');

reset role;

update public.connection_invites
set expires_at = now() - interval '1 minute'
where inviter_account_id = :household_a
  and token_hash = encode(extensions.digest(:'token_a_expired', 'sha256'), 'hex');

set local role authenticated;
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'preview_connection_invite: an expired invite resolves to an empty set too, indistinguishable from unknown/revoked', count(*) = 0
from public.preview_connection_invite(:'token_a_expired');

do $$
declare
  v_name constant text := 'AC-6(d): an expired invite cannot be accepted';
  v_token text;
begin
  select value into v_token from tokens where name = 'token_a_expired';
  perform public.accept_connection_invite(v_token);
  perform pg_temp.unexpected_raise(v_name, null, 'accepting an expired invite unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%invalid, expired, or has already been used%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-6(a): a member of household C (party to no connection with shadchan S)
-- cannot read the connections row between household A and shadchan S.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-6(a)/AC-5: a third-party household cannot read a connection it is not party to', count(*) = 0
from public.connections where id = :connection_a_s;

-- ---------------------------------------------------------------------------
-- AC-6(b): a member of shadchanus account S2 cannot call end_connection() on
-- the A<->S connection.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(b): an unrelated shadchan (S2) cannot end a connection it is not party to';
  v_connection_id bigint;
begin
  select value into v_connection_id from ids where name = 'connection_a_s';
  perform public.end_connection(v_connection_id);
  perform pg_temp.unexpected_raise(v_name, null, 'end_connection unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', '%not found%', sqlstate, sqlerrm);
end $$;

-- Switched to household A's claims BEFORE this read (not S2's, still active
-- above): A is party to the connection and S2 is not, so checking as S2
-- would have this read hidden by RLS regardless of whether the refused end
-- attempt above left it untouched — the same false-positive-by-invisibility
-- trap the AC-6(c)/accept_connection_invite checks above hit.
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-6(b): the connection is still accepted after the refused end attempt', c.status = 'accepted'
from public.connections c where c.id = :connection_a_s;

-- ---------------------------------------------------------------------------
-- AC-3: either side may end an accepted connection — household A ends it.
-- ---------------------------------------------------------------------------
select (public.end_connection(:connection_a_s)).status as ended_status \gset

insert into results (name, passed) values
  ('end_connection: flips status to ended', :'ended_status' = 'ended');

insert into results (name, passed)
select 'end_connection: stamps ended_at and ended_by_account_id (the caller''s own context)',
       c.ended_at is not null and c.ended_by_account_id = :household_a
from public.connections c where c.id = :connection_a_s;

do $$
declare
  v_name constant text := 'AC-3 / "What ending does and does not do": ending an already-ended connection is refused';
  v_connection_id bigint;
begin
  select value into v_connection_id from ids where name = 'connection_a_s';
  perform public.end_connection(v_connection_id);
  perform pg_temp.unexpected_raise(v_name, null, 'second end_connection unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%has already ended%', sqlstate, sqlerrm);
end $$;

insert into results (name, passed)
select 'ending is not retroactive: the household''s shadchanim book entry survives the ended connection',
       count(*) = 1
from public.shadchanim s where s.account_id = :household_a and s.connection_id = :connection_a_s;

-- ---------------------------------------------------------------------------
-- Reconnection after an end is a NEW invite/accept cycle producing a NEW
-- row — the live-pair partial index (01_tables.sql) permits it once the
-- prior row is ended.
-- ---------------------------------------------------------------------------
select public.create_connection_invite() as token_a_to_s_again \gset

set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';

select (public.accept_connection_invite(:'token_a_to_s_again')).id as connection_a_s_2 \gset
insert into ids values ('connection_a_s_2', :connection_a_s_2);

insert into results (name, passed) values (
  'reconnecting after an end creates a NEW connections row, not a reactivation of the old one',
  :connection_a_s_2 <> :connection_a_s
);

insert into results (name, passed)
select 'both the ended and the reconnected rows survive as history for the same pair', count(*) = 2
from public.connections
where household_account_id = :household_a and shadchanus_account_id = :shadchanus_s;

-- Restore household A's claims for the grant-layer checks below.
set local request.jwt.claims = '{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- AC-1 / AC-6(f): the no-client-write posture holds after this story's
-- grants — a direct insert/update on connections and connection_invites as
-- authenticated is refused at the GRANT layer (42501), not merely by RLS.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'AC-6(f): an authenticated client cannot INSERT into public.connections directly';
  v_household_a bigint;
  v_shadchanus_s bigint;
begin
  select value into v_household_a from ids where name = 'household_a';
  select value into v_shadchanus_s from ids where name = 'shadchanus_s';
  insert into public.connections (household_account_id, shadchanus_account_id, proposed_by_account_id)
  values (v_household_a, v_shadchanus_s, v_household_a);
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table connections', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-6(f): an authenticated client cannot UPDATE public.connections directly';
  v_connection_id bigint;
begin
  select value into v_connection_id from ids where name = 'connection_a_s_2';
  update public.connections set status = 'ended' where id = v_connection_id;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table connections', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-6(f): an authenticated client cannot INSERT into public.connection_invites directly';
  v_household_a bigint;
begin
  select value into v_household_a from ids where name = 'household_a';
  insert into public.connection_invites (inviter_account_id, inviter_kind, token_hash, expires_at)
  values (v_household_a, 'household', 'deadbeef', now() + interval '7 days');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table connection_invites', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-6(f): an authenticated client cannot UPDATE public.connection_invites directly';
  v_household_a bigint;
  v_invite_id bigint;
begin
  select value into v_household_a from ids where name = 'household_a';
  select id into v_invite_id from public.connection_invites where inviter_account_id = v_household_a limit 1;
  update public.connection_invites set status = 'accepted' where id = v_invite_id;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table connection_invites', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-1: shadchanim.connection_id is not client-writable (06_grants.sql's
-- column-list grant omits it) — a household cannot self-link its own book
-- entry to a connection it can already read, forging a "connected" badge
-- without going through consent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'AC-1: a client cannot set shadchanim.connection_id directly on INSERT';
  v_connection_id bigint;
begin
  select value into v_connection_id from ids where name = 'connection_a_s_2';
  insert into public.shadchanim (name, connection_id) values ('Self-linked shadchan', v_connection_id);
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table shadchanim', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-1: a client cannot set shadchanim.connection_id directly on UPDATE';
  v_connection_id bigint;
  v_shadchan_id bigint;
begin
  select value into v_connection_id from ids where name = 'connection_a_s_2';
  insert into public.shadchanim (name) values ('Plain shadchan, no connection')
  returning id into v_shadchan_id;
  update public.shadchanim set connection_id = v_connection_id where id = v_shadchan_id;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table shadchanim', sqlstate, sqlerrm);
end $$;

-- A hand-entered shadchan (no connection) is still fully writable on every
-- OTHER column — the column-list grant narrows one column, not the table.
do $$
declare
  v_shadchan_id bigint;
begin
  insert into public.shadchanim (name, location) values ('Ordinary shadchan', 'Lakewood')
  returning id into v_shadchan_id;
  update public.shadchanim set location = 'Monsey' where id = v_shadchan_id;
  insert into results values (
    'a hand-entered shadchan (no connection) is still fully writable on every other column',
    (select location from public.shadchanim where id = v_shadchan_id) = 'Monsey'
  );
exception when others then
  insert into results values (
    'a hand-entered shadchan (no connection) is still fully writable on every other column',
    false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- Structural guarantees the story must not regress.
-- ---------------------------------------------------------------------------
reset role;

insert into results (name, passed)
select 'RLS is enabled AND forced on connection_invites', c.relrowsecurity and c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'connection_invites';

insert into results (name, passed)
select 'anon holds no privilege of any kind on connection_invites',
       not exists (
         select 1
         from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where n.nspname = 'public' and c.relname = 'connection_invites'
           and a.grantee = 'anon'::regrole::oid
       );

insert into results (name, passed)
select 'anon cannot execute any of the five consent-workflow functions',
       bool_and(not has_function_privilege('anon', p.oid, 'execute'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_connection_invite', 'revoke_connection_invite',
    'preview_connection_invite', 'accept_connection_invite', 'end_connection'
  );

insert into results (name, passed)
select 'none of the five consent-workflow functions was left executable by PUBLIC', count(*) = 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proacl is null
  and p.proname in (
    'create_connection_invite', 'revoke_connection_invite',
    'preview_connection_invite', 'accept_connection_invite', 'end_connection'
  );

insert into results (name, passed)
select 'authenticated cannot TRUNCATE connection_invites (bypasses RLS)',
       not has_table_privilege('authenticated', 'public.connection_invites', 'TRUNCATE');

insert into results (name, passed)
select 'authenticated cannot advance the connection_invites sequence',
       not has_sequence_privilege('authenticated', 'public.connection_invites_id_seq', 'USAGE');

insert into results (name, passed)
select 'a connections row''s ended flag is always internally consistent (connections_ended_consistency)',
       bool_and((status = 'ended') = (ended_at is not null))
from public.connections;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
