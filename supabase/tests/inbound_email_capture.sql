--
-- Inbound email capture (Epic 11) — database test suite.
--
-- The schema commit that introduced this feature (per-household
-- `accounts.inbound_email_token`, the `trusted_senders` allowlist table, and
-- the `held` inbox_items status) shipped with +1 test overall — no dedicated
-- coverage. This suite closes that gap. Covers:
--
--   - `inbound_email_token` is auto-generated on a household account INSERT,
--     and is exactly 12 lowercase hex characters (48 bits) — the shortened
--     shape (see 02_functions.sql's own comment for why entropy is not
--     load-bearing here: an unknown sender's mail is held for review
--     regardless of how the address was found).
--   - a client-supplied token on INSERT is overwritten, not honored — the
--     trigger is unconditional, mirroring set_share_link_token_defaults()'s
--     own `new.token` line.
--   - a shadchanus-kind account always gets NULL, and
--     accounts_inbound_email_token_kind_check rejects both wrong
--     combinations directly (not merely relying on the trigger to prevent
--     them from ever arising).
--   - accounts_inbound_email_token_key (the unique index) rejects a
--     duplicate token.
--   - trusted_senders RLS: scoped to the caller's own account (a DIFFERENT
--     household can neither select nor insert), and the `single` role is
--     denied entirely, even within its own household — the same boundary
--     inbox_items draws for the same trust domain (05_policies.sql's own
--     comment).
--   - trusted_senders_account_id_email_key (the (account_id, email) unique
--     key) is per-household, not global: the SAME address can be trusted by
--     TWO different households independently, and rejects only a genuine
--     duplicate within ONE household.
--
-- Same conventions as every other suite here (`share_links.sql`'s own
-- idiom): one `begin; ... rollback;` transaction, a `results` table of named
-- checks emitted as JSON, `pg_temp.denied()` for SQLSTATE-exact denial
-- proofs (never a bare `exception when others then ... pass`), and row-count
-- assertions for a policy that filters rather than raises.
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

-- Every RLS-refused INSERT in this file is a row-security violation (42501)
-- on `trusted_senders` specifically — see `share_links.sql`'s identical
-- `denied_row_security` idiom.
create function pg_temp.denied_row_security(
  p_name text, p_actual_sqlstate text, p_actual_message text
) returns void language plpgsql as $$
begin
  perform pg_temp.denied(
    p_name, '42501',
    'new row violates row-level security policy for table "trusted_senders"',
    p_actual_sqlstate, p_actual_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (as postgres/superuser).
--
--   Household A — parent_admin (U1), a 'single'-role member (U2, denied
--     trusted_senders entirely — same boundary as inbox_items).
--   Household B — a second, unrelated household's parent_admin (U3), for the
--     genuine cross-account negative test.
--   A shadchanus-kind account (no membership needed) — for the
--     kind-correspondence CHECK constraint checks below.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('11bb0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbound-a-parent@test.local'),
  ('11bb0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbound-a-single@test.local'),
  ('11bb0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbound-b-parent@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('Inbound Capture Household A', 'household') returning id as account_a \gset
insert into public.accounts (name, kind) values ('Inbound Capture Household B', 'household') returning id as account_b \gset
insert into public.accounts (name, kind) values ('Inbound Capture Shadchanus C', 'shadchanus') returning id as account_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:account_a, '11bb0000-0000-0000-0000-000000000001', 'parent_admin')
  returning id as member_a_parent \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_a, '11bb0000-0000-0000-0000-000000000002', 'single')
  returning id as member_a_single \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_b, '11bb0000-0000-0000-0000-000000000003', 'parent_admin')
  returning id as member_b_parent \gset

insert into ids values
  ('account_a', :account_a), ('account_b', :account_b), ('account_c', :account_c),
  ('member_a_parent', :member_a_parent), ('member_a_single', :member_a_single),
  ('member_b_parent', :member_b_parent);

-- ---------------------------------------------------------------------------
-- accounts.inbound_email_token — generation, format, and the unconditional
-- overwrite.
-- ---------------------------------------------------------------------------

insert into results (name, passed, detail)
select 'a new household account is auto-assigned an inbound_email_token',
       inbound_email_token is not null,
       format('inbound_email_token=%L', inbound_email_token)
from public.accounts where id = :account_a;

insert into results (name, passed, detail)
select 'the auto-assigned token is 12 lowercase hex characters (48 bits) — the shortened shape, not the old 48-char/192-bit one',
       inbound_email_token::text ~ '^[0-9a-f]{12}$',
       format('inbound_email_token=%L (length %s)', inbound_email_token, length(inbound_email_token::text))
from public.accounts where id = :account_a;

insert into results (name, passed, detail)
select 'two household accounts get two DIFFERENT tokens',
       a.inbound_email_token <> b.inbound_email_token,
       format('a=%L b=%L', a.inbound_email_token, b.inbound_email_token)
from public.accounts a, public.accounts b
where a.id = :account_a and b.id = :account_b;

insert into results (name, passed, detail)
select 'a shadchanus-kind account has NO inbound_email_token',
       inbound_email_token is null,
       format('inbound_email_token=%L', inbound_email_token)
from public.accounts where id = :account_c;

-- A client-supplied token on INSERT must never be honored — the trigger
-- overwrites it unconditionally, the same invariant set_share_link_token_
-- defaults() enforces for share_links' own `token` column.
insert into public.accounts (name, kind, inbound_email_token)
values ('Inbound Capture Household D (attacker-supplied token)', 'household', 'attacker-supplied-token-value')
returning id as account_d \gset

insert into ids values ('account_d', :account_d);

insert into results (name, passed, detail)
select 'a client-supplied inbound_email_token on INSERT is overwritten, not honored',
       inbound_email_token <> 'attacker-supplied-token-value',
       format('inbound_email_token=%L', inbound_email_token)
from public.accounts where id = :account_d;

insert into results (name, passed, detail)
select 'the overwritten token is still a real 12-hex-char CSPRNG value, not merely rejected-but-kept',
       inbound_email_token::text ~ '^[0-9a-f]{12}$',
       format('inbound_email_token=%L', inbound_email_token)
from public.accounts where id = :account_d;

-- ---------------------------------------------------------------------------
-- accounts_inbound_email_token_kind_check — the kind-correspondence CHECK
-- constraint, exercised directly (not merely relied on through the trigger).
-- ---------------------------------------------------------------------------

do $$
declare
  v_name constant text := 'the CHECK constraint rejects a shadchanus account explicitly given a non-null token';
begin
  insert into public.accounts (name, kind, inbound_email_token)
  values ('Inbound Capture Bad Shadchanus', 'shadchanus', 'should-not-be-allowed');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when check_violation then
  perform pg_temp.denied(v_name, '23514', '%accounts_inbound_email_token_kind_check%', sqlstate, sqlerrm);
end $$;

-- The trigger only ever fires BEFORE INSERT, so a later UPDATE forcing a
-- household row's token to NULL is the CHECK constraint's own
-- responsibility, independent of any INSERT-time path.
do $$
declare
  v_name constant text := 'the CHECK constraint rejects a household account forced to a NULL token by UPDATE';
  v_account_a bigint;
begin
  select value into v_account_a from ids where name = 'account_a';
  update public.accounts set inbound_email_token = null where id = v_account_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when check_violation then
  perform pg_temp.denied(v_name, '23514', '%accounts_inbound_email_token_kind_check%', sqlstate, sqlerrm);
end $$;

insert into results (name, passed, detail)
select 'the refused UPDATE left account_a''s token untouched (still non-null)',
       inbound_email_token is not null,
       format('inbound_email_token=%L', inbound_email_token)
from public.accounts where id = :account_a;

-- accounts_inbound_email_token_key — the unique index, exercised directly.
-- The trigger only ever mints a fresh CSPRNG value on INSERT (a collision is
-- astronomically unlikely), so the only way to prove the index itself
-- refuses a duplicate is to force one via UPDATE.
do $$
declare
  v_name constant text := 'the unique index rejects a household account UPDATEd to another account''s existing token';
  v_account_a bigint;
  v_account_b_token public.accounts.inbound_email_token%type;
begin
  select value into v_account_a from ids where name = 'account_a';
  select inbound_email_token into v_account_b_token from public.accounts
   where id = (select value from ids where name = 'account_b');

  update public.accounts set inbound_email_token = v_account_b_token where id = v_account_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when unique_violation then
  perform pg_temp.denied(v_name, '23505', '%accounts_inbound_email_token_key%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- trusted_senders — RLS scoping to account, 'single'-role denial, and the
-- (account_id, email) unique key.
-- ---------------------------------------------------------------------------

-- Account A's own parent_admin creates a trust row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.trusted_senders (account_id, email)
values (:account_a, 'seminary.office@example.test')
returning id as trust_a \gset

reset role;
insert into ids values ('trust_a', :trust_a);

insert into results (name, passed)
select 'a parent_admin can create a trusted_senders row for their OWN account',
       account_id = :account_a
from public.trusted_senders where id = :trust_a;

-- Account B's own parent_admin trusts the SAME address independently — the
-- (account_id, email) unique key is per-household, not global.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into public.trusted_senders (account_id, email)
values (:account_b, 'seminary.office@example.test')
returning id as trust_b \gset

reset role;
insert into ids values ('trust_b', :trust_b);

insert into results (name, passed, detail)
select '(account_id, email) unique constraint allows the SAME address to be trusted by TWO different households independently',
       :trust_b <> :trust_a,
       format('trust_a=%s trust_b=%s (same email, different accounts)', :trust_a, :trust_b);

-- The genuine negative: a SECOND trust row for the SAME account and the SAME
-- address is refused.
do $$
declare
  v_name constant text := 'the (account_id, email) unique constraint rejects a DUPLICATE trust row for the SAME account';
  v_account_a bigint;
begin
  select value into v_account_a from ids where name = 'account_a';
  insert into public.trusted_senders (account_id, email) values (v_account_a, 'seminary.office@example.test');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when unique_violation then
  perform pg_temp.denied(v_name, '23505', '%trusted_senders_account_id_email_key%', sqlstate, sqlerrm);
end $$;

-- (a) Cross-account: B's parent_admin can neither see nor insert against A's
--     account.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000003","role":"authenticated"}';

select count(*) as cnt from public.trusted_senders where account_id = :account_a \gset cross_select_

insert into results (name, passed, detail)
select 'a DIFFERENT household''s parent_admin cannot SELECT another account''s trusted_senders rows',
       :cross_select_cnt = 0,
       format('rows visible: %s', :cross_select_cnt);

-- trusted_senders also carries validate_trusted_senders_household_scope
-- (04_triggers.sql), which fires BEFORE the RLS policy is ever consulted
-- and — because it queries `accounts` under the CALLER's own RLS-limited
-- view — already denies this cross-account write on its own (it cannot see
-- account_a's row at all from B's session, so it raises "not a
-- household-kind account", a masking false-negative message), same shape as
-- inbox_items.sql's documented (b)/(b-isolated) pair. This check proves real
-- production behaviour (either layer denies); the isolated check right
-- after it, with the trigger disabled, proves the RLS policy specifically.
do $$
declare
  v_name constant text := 'a DIFFERENT household''s parent_admin cannot INSERT a trusted_senders row naming another account''s account_id (production''s normal state, both layers active)';
  v_account_a bigint;
begin
  select value into v_account_a from ids where name = 'account_a';
  insert into public.trusted_senders (account_id, email) values (v_account_a, 'cross-account-attempt@example.test');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    v_name,
    sqlerrm like '%is not a household-kind account%' or sqlerrm like '%row-level security policy%',
    sqlstate || ' ' || sqlerrm
  );
end $$;

reset role;
alter table public.trusted_senders disable trigger validate_trusted_senders_household_scope;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := '(isolated) with the household-scope trigger disabled, trusted_senders'' own RLS policy alone rejects an INSERT naming another account''s account_id';
  v_account_a bigint;
begin
  select value into v_account_a from ids where name = 'account_a';
  insert into public.trusted_senders (account_id, email) values (v_account_a, 'cross-account-attempt-isolated@example.test');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;
alter table public.trusted_senders enable trigger validate_trusted_senders_household_scope;

insert into results (name, passed)
select 'account_a''s trusted_senders row count is unaffected by the refused cross-account attempts',
       count(*) = 1
from public.trusted_senders where account_id = :account_a;

-- (b) 'single'-role member of A is denied entirely, even within their OWN
--     household.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000002","role":"authenticated"}';

select count(*) as cnt from public.trusted_senders where account_id = :account_a \gset single_select_

insert into results (name, passed, detail)
select 'a ''single''-role member SELECTing their OWN account''s trusted_senders returns zero rows',
       :single_select_cnt = 0,
       format('rows visible: %s', :single_select_cnt);

do $$
declare
  v_name constant text := 'a ''single''-role member cannot INSERT a trusted_senders row even for their OWN account';
  v_account_a bigint;
begin
  select value into v_account_a from ids where name = 'account_a';
  insert into public.trusted_senders (account_id, email) values (v_account_a, 'single-role-attempt@example.test');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'the refused ''single''-role insert left account_a''s trusted_senders row count unchanged (still 1)',
       count(*) = 1
from public.trusted_senders where account_id = :account_a;

-- Positive control, same account: the parent_admin can still SELECT the row
-- — proves the 'single'-role denial above is a real role boundary, not RLS
-- breaking reads for everyone on this table.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11bb0000-0000-0000-0000-000000000001","role":"authenticated"}';

select count(*) as cnt from public.trusted_senders where account_id = :account_a \gset control_select_

insert into results (name, passed, detail)
select 'control: account_a''s OWN parent_admin CAN select their trusted_senders row',
       :control_select_cnt = 1,
       format('rows visible: %s', :control_select_cnt);

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
