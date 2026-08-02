--
-- Publishing a shadchan listing (Epic 9 Story 9.1) — database test suite.
--
-- Covers AC-1 through AC-8: field-by-field opt-in with a real `null` (not
-- an empty string) for anything left off, the CHECK constraint behind "name
-- required", the partial unique index behind "one live listing, not a
-- growing pile", the anon-readable snapshot itself (AD-21) and its
-- immediate disappearance on withdrawal, the two negative angles behind
-- "a household can never publish a shadchan listing", tenant isolation on
-- the authenticated-scoped policies, and the exact grant/RLS shape AC-8
-- demands — including the fork-era `members_id_seq` gap this story's
-- migration also closes.
--
-- Same conventions as every other suite here: one `begin; ... rollback;`
-- transaction, a `results` table of named checks emitted as JSON,
-- `pg_temp.denied()`/`pg_temp.unexpected_raise()` for SQLSTATE-exact denial
-- proofs (never a bare `exception when others then ... pass`), and
-- mutation-prove (row-count) assertions for a policy that filters rather
-- than raises.
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
-- on `listings` specifically — see single_field_scoping.sql's identical
-- `denied_row_security` idiom.
create function pg_temp.denied_row_security(
  p_name text, p_actual_sqlstate text, p_actual_message text
) returns void language plpgsql as $$
begin
  perform pg_temp.denied(
    p_name, '42501',
    'new row violates row-level security policy for table "listings"',
    p_actual_sqlstate, p_actual_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (as postgres/superuser).
--
--   Account A (shadchanus) — shadchan member U-A. The main positive-path
--     account: publishes, republishes, withdraws.
--   Account B (shadchanus) — shadchan member U-B. AC-2's nameless-insert
--     negative test, then a legitimate publish of its own for AC-7's
--     cross-tenant isolation check.
--   Account H (household) — parent_admin member U-H. AC-6(a): wrong KIND.
--   Account C (shadchanus) — a 'helper'-role member U-C, seeded ONLY by
--     transiently disabling enforce_membership_role_matches_context_trigger
--     (the same isolate-one-clause technique context_rls_hardening.sql
--     already uses) — this state is otherwise unreachable through any real
--     insert path, which is exactly why AC-6(b) needs it constructed
--     directly: it proves the listings policy's OWN role clause, not just
--     the trigger that (in every real case) already prevents this shape.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('51910000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-shadchan-a@test.local'),
  ('51910000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-shadchan-b@test.local'),
  ('51910000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-household-h@test.local'),
  ('51910000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-shadchanus-c@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('Listings Suite Shadchanus A', 'shadchanus') returning id as account_a \gset
insert into public.accounts (name, kind) values ('Listings Suite Shadchanus B', 'shadchanus') returning id as account_b \gset
insert into public.accounts (name, kind) values ('Listings Suite Household H', 'household') returning id as account_h \gset
insert into public.accounts (name, kind) values ('Listings Suite Shadchanus C', 'shadchanus') returning id as account_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:account_a, '51910000-0000-0000-0000-000000000001', 'shadchan')
  returning id as member_a \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_b, '51910000-0000-0000-0000-000000000002', 'shadchan')
  returning id as member_b \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_h, '51910000-0000-0000-0000-000000000003', 'parent_admin')
  returning id as member_h \gset

-- AC-6(b)'s otherwise-unreachable shape: a shadchanus-kind account whose
-- member is NOT role='shadchan'. Re-enabled immediately after, inside this
-- suite's own rolled-back transaction, exactly like
-- context_rls_hardening.sql's own disable/re-enable pair.
alter table public.account_members disable trigger enforce_membership_role_matches_context_trigger;
insert into public.account_members (account_id, user_id, role) values
  (:account_c, '51910000-0000-0000-0000-000000000004', 'helper')
  returning id as member_c \gset
alter table public.account_members enable trigger enforce_membership_role_matches_context_trigger;

insert into ids values
  ('account_a', :account_a), ('account_b', :account_b),
  ('account_h', :account_h), ('account_c', :account_c),
  ('member_a', :member_a), ('member_b', :member_b),
  ('member_h', :member_h), ('member_c', :member_c);

-- ---------------------------------------------------------------------------
-- AC-1 / AC-3: as U-A, publish with only "name" opted in — area/contact
-- stay NULL, never an empty string.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, shadchan_name)
values ('shadchan', 'Rivka the Shadchan')
returning id as listing_a \gset

reset role;
insert into ids values ('listing_a', :listing_a);

insert into results (name, passed, detail)
select 'AC-1: shadchan_area is NULL, not empty string, when never opted in',
       shadchan_area is null,
       format('shadchan_area = %L', shadchan_area)
from public.listings where id = :listing_a;

insert into results (name, passed, detail)
select 'AC-1: shadchan_contact_info is NULL, not empty string, when never opted in',
       shadchan_contact_info is null,
       format('shadchan_contact_info = %L', shadchan_contact_info)
from public.listings where id = :listing_a;

insert into results (name, passed)
select 'AC-1/AC-1(server-set): account_id resolves to the caller''s own active context, never client-supplied',
       account_id = :account_a
from public.listings where id = :listing_a;

-- AC-3: republishing (an UPDATE, the client's own upsert path) changes the
-- SAME row in place — never a second row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.listings
   set shadchan_area = 'Lakewood and nearby'
 where id = :listing_a;

reset role;

insert into results (name, passed)
select 'AC-3: republishing updates the existing row (area now set)',
       shadchan_area = 'Lakewood and nearby'
from public.listings where id = :listing_a;

insert into results (name, passed, detail)
select 'AC-3: account_id stays unique among shadchan-branch listings — still exactly one row for account A',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listings where account_id = :account_a and listing_type = 'shadchan';

-- AC-3 (the OTHER half): a raw second INSERT for the same account — not
-- going through the client's own update branch — is refused by the
-- database itself (the partial unique index), not merely avoided by
-- well-behaved client code.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-3: a second shadchan-branch listings row for the SAME account is refused by the partial unique index';
begin
  insert into public.listings (listing_type, shadchan_name) values ('shadchan', 'A Second Row');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23505', '%listings_shadchan_account_id_key%', sqlstate, sqlerrm);
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- AC-2: as U-B (fresh, nothing published yet), a nameless shadchan listing
-- is refused by the CHECK constraint, not merely by the UI.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-2: a shadchan listing with shadchan_name NULL is refused by listings_shadchan_name_required';
begin
  insert into public.listings (listing_type, shadchan_name) values ('shadchan', null);
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%listings_shadchan_name_required%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed, detail)
select 'AC-2: the refused nameless insert left zero rows for account B',
       count(*) = 0,
       format('rows: %s', count(*))
from public.listings where account_id = :account_b;

-- U-B now publishes for real (AC-7 below needs a second, genuinely
-- published tenant to isolate against).
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.listings (listing_type, shadchan_name)
values ('shadchan', 'Shimon the Shadchan')
returning id as listing_b \gset

reset role;
insert into ids values ('listing_b', :listing_b);

-- ---------------------------------------------------------------------------
-- AC-4 / AC-5: the anon-readable snapshot itself (AD-21) and its immediate
-- disappearance on withdrawal. The exact query from this story's own Dev
-- Notes "The anon verification query", scoped to this suite's own two rows
-- so it is deterministic regardless of anything else the dev database
-- happens to hold.
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into results (name, passed, detail)
select 'AC-4: an anon SELECT reaches account A''s published listing (name + area, contact still off)',
       count(*) filter (
         where shadchan_name = 'Rivka the Shadchan'
           and shadchan_area = 'Lakewood and nearby'
           and shadchan_contact_info is null
       ) = 1,
       format('matching rows: %s', count(*))
from public.listings
where listing_type = 'shadchan' and id in (:listing_a, :listing_b);

insert into results (name, passed)
select 'AC-4: an anon SELECT reaches account B''s published listing too',
       count(*) = 1
from public.listings where id = :listing_b;

reset role;

-- Withdraw account A's listing (AC-5) — a real DELETE, as its own owner.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000001","role":"authenticated"}';

with attempt as (
  delete from public.listings where id = :listing_a returning id
)
select count(*) as cnt from attempt \gset withdraw_

insert into results (name, passed, detail)
select 'AC-5: withdrawing deletes the row outright (not soft-deleted, not flagged)',
       :withdraw_cnt = 1,
       format('rows deleted: %s', :withdraw_cnt);

reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into results (name, passed, detail)
select 'AC-5: the withdrawn listing is immediately gone from the anon-visible set',
       count(*) = 0,
       format('rows still visible: %s', count(*))
from public.listings where id = :listing_a;

insert into results (name, passed)
select 'AC-5: withdrawal did not touch account B''s still-published listing',
       count(*) = 1
from public.listings where id = :listing_b;

reset role;

-- ---------------------------------------------------------------------------
-- AC-6: a household account can never publish a shadchan listing — both
-- angles, as two separate, independently-reasoned checks.
-- ---------------------------------------------------------------------------

-- (a) wrong KIND: U-H's own account is household, not shadchanus.
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(a): a household-kind account''s member cannot INSERT a shadchan listing — wrong kind';
  v_account_h bigint;
begin
  select value into v_account_h from ids where name = 'account_h';
  insert into public.listings (listing_type, account_id, shadchan_name)
  values ('shadchan', v_account_h, 'X');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6(a): confirms the actual reason — account H is NOT shadchanus-kind',
       not exists (select 1 from public.accounts where id = :account_h and kind = 'shadchanus');

-- (b) wrong ROLE: U-C's account IS shadchanus, but their own role is
-- 'helper', not 'shadchan' — the otherwise-unreachable shape Arrange built
-- by disabling enforce_membership_role_matches_context_trigger for one
-- insert. Isolates the policy's role clause specifically, independent of
-- the kind clause (which is satisfied this time).
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6(b): a shadchanus-kind account''s NON-shadchan-role member cannot INSERT a shadchan listing — wrong role';
  v_account_c bigint;
begin
  select value into v_account_c from ids where name = 'account_c';
  insert into public.listings (listing_type, account_id, shadchan_name)
  values ('shadchan', v_account_c, 'X');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6(b): confirms the actual reason — account C IS shadchanus-kind (the kind clause alone would have passed)',
       exists (select 1 from public.accounts where id = :account_c and kind = 'shadchanus');

insert into results (name, passed)
select 'AC-6(b): confirms the actual reason — U-C''s own membership role is NOT shadchan',
       not exists (
         select 1 from public.account_members
         where account_id = :account_c and user_id = '51910000-0000-0000-0000-000000000004' and role = 'shadchan'
       );

insert into results (name, passed, detail)
select 'AC-6: neither refused attempt left a row behind',
       count(*) = 0,
       format('rows: %s', count(*))
from public.listings where account_id in (:account_h, :account_c);

-- ---------------------------------------------------------------------------
-- AC-7: tenant isolation on the AUTHENTICATED-scoped policies (never the
-- anon one, which is intentionally `using (true)`). U-B attempts to read,
-- update and delete A's listing... except A's own row was withdrawn above
-- (AC-5), so republish it here as U-A specifically to give AC-7 a live
-- target — a withdrawn row proves nothing about read/write isolation on a
-- LIVE row.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, shadchan_name)
values ('shadchan', 'Rivka the Shadchan, Republished')
returning id as listing_a2 \gset

reset role;
insert into ids values ('listing_a2', :listing_a2);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51910000-0000-0000-0000-000000000002","role":"authenticated"}';

select count(*) as cnt from public.listings where id = :listing_a2 \gset other_select_

insert into results (name, passed, detail)
select 'AC-7: B''s SELECT of A''s live listing (authenticated policy) returns zero rows',
       :other_select_cnt = 0,
       format('rows visible: %s', :other_select_cnt);

with attempt as (
  update public.listings set shadchan_name = 'Hijacked by B' where id = :listing_a2 returning id
)
select count(*) as cnt from attempt \gset other_update_

insert into results (name, passed, detail)
select 'AC-7: B''s UPDATE of A''s live listing (authenticated policy) affects zero rows',
       :other_update_cnt = 0,
       format('rows updated: %s', :other_update_cnt);

with attempt as (
  delete from public.listings where id = :listing_a2 returning id
)
select count(*) as cnt from attempt \gset other_delete_

insert into results (name, passed, detail)
select 'AC-7: B''s DELETE of A''s live listing (authenticated policy) affects zero rows',
       :other_delete_cnt = 0,
       format('rows deleted: %s', :other_delete_cnt);

reset role;

insert into results (name, passed)
select 'AC-7: A''s listing is untouched by every refused cross-tenant attempt',
       shadchan_name = 'Rivka the Shadchan, Republished'
from public.listings where id = :listing_a2;

-- ---------------------------------------------------------------------------
-- AC-8: grants are exactly as narrow as AD-1 demands.
-- ---------------------------------------------------------------------------

-- Review finding F6: `anon`'s SELECT is an ENUMERATED column grant, not the
-- whole table, so `has_table_privilege('anon', ..., 'select')` (the old
-- check) now correctly reads FALSE — Postgres only reports the table-level
-- privilege there, and `anon` never holds it. The real claim is column-shaped
-- and two-sided, exactly like `public.shidduchim`'s close_reason guard in
-- single_field_scoping.sql: every column except the three internal
-- identifiers is readable, and those three are not — a column added to
-- `listings` without a matching grant, or one of the three re-granted, fails
-- here.
do $$
declare
  v_missing text;
  v_leaked text;
begin
  select string_agg(a.attname, ', ' order by a.attnum) into v_missing
  from pg_attribute a
  where a.attrelid = 'public.listings'::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('account_id', 'single_id', 'published_by_member_id')
    and not has_column_privilege('anon', a.attrelid, a.attname, 'SELECT');

  select string_agg(col, ', ') into v_leaked
  from unnest(array['account_id', 'single_id', 'published_by_member_id']) as col
  where has_column_privilege('anon', 'public.listings'::regclass, col, 'SELECT');

  insert into results (name, passed, detail)
  values (
    'AC-8/F6: anon''s column grant on listings covers every field EXCEPT account_id/single_id/published_by_member_id',
    v_missing is null and v_leaked is null,
    format('ungranted=%s leaked=%s', coalesce(v_missing, 'none'), coalesce(v_leaked, 'none'))
  );
end $$;

insert into results (name, passed)
select 'AC-8: anon holds NO table-level SELECT on listings (column-level only)',
       not has_table_privilege('anon', 'public.listings', 'select');
insert into results (name, passed)
select 'AC-8: anon holds NO insert on listings', not has_table_privilege('anon', 'public.listings', 'insert');
insert into results (name, passed)
select 'AC-8: anon holds NO update on listings', not has_table_privilege('anon', 'public.listings', 'update');
insert into results (name, passed)
select 'AC-8: anon holds NO delete on listings', not has_table_privilege('anon', 'public.listings', 'delete');
insert into results (name, passed)
select 'AC-8/F1: anon holds NO truncate on listings (TRUNCATE bypasses RLS)',
       not has_table_privilege('anon', 'public.listings', 'truncate');
insert into results (name, passed)
select 'AC-8: anon holds NO sequence privilege on listings_id_seq',
       not has_sequence_privilege('anon', 'public.listings_id_seq', 'usage')
       and not has_sequence_privilege('anon', 'public.listings_id_seq', 'select');

insert into results (name, passed)
select 'AC-8: authenticated holds select/insert/update/delete on listings',
       has_table_privilege('authenticated', 'public.listings', 'select')
       and has_table_privilege('authenticated', 'public.listings', 'insert')
       and has_table_privilege('authenticated', 'public.listings', 'update')
       and has_table_privilege('authenticated', 'public.listings', 'delete');

-- Review finding F1/F2 (BLOCKING): the fork's default privileges attach
-- REFERENCES/TRIGGER/TRUNCATE to `authenticated` on every new table, and the
-- old suite only ever asserted the four DML verbs were PRESENT — it never
-- asserted the other three were ABSENT, so `grant truncate on table
-- public.listings to authenticated` (already true before this fix) left the
-- suite green. TRUNCATE bypasses ROW LEVEL SECURITY: one statement from any
-- authenticated session would empty every shadchan's and single's listing
-- across every tenant at once. Mirrors invites.sql's own
-- `not has_table_privilege(..., 'truncate')` idiom.
insert into results (name, passed)
select 'AC-8/F1/F2: authenticated holds NO truncate on listings (TRUNCATE bypasses RLS)',
       not has_table_privilege('authenticated', 'public.listings', 'truncate');
insert into results (name, passed)
select 'AC-8/F1: authenticated holds NO references/trigger on listings (fork-era default-privilege leftovers)',
       not has_table_privilege('authenticated', 'public.listings', 'references')
       and not has_table_privilege('authenticated', 'public.listings', 'trigger');

-- Review finding F4: the sequence grants 06_grants.sql has always declared
-- (`usage, select` to `authenticated`) never reached the database because
-- `db diff` does not emit sequence grants and the identity column's implicit
-- sequence does not inherit them from the schema's default privileges either
-- — this is the check that would have caught it.
insert into results (name, passed)
select 'AC-8/F4: authenticated holds usage+select on listings_id_seq',
       has_sequence_privilege('authenticated', 'public.listings_id_seq', 'usage')
       and has_sequence_privilege('authenticated', 'public.listings_id_seq', 'select');

insert into results (name, passed)
select 'AC-8: rowsecurity and forcerowsecurity are both true on public.listings',
       relrowsecurity and relforcerowsecurity
from pg_class where oid = 'public.listings'::regclass;

-- The fork-era gap this story's migration also closes (Dev Notes "Closing a
-- narrower, pre-existing AD-1 gap while this file is open") — the reason
-- AC-8's "anon holds select and nothing else" is checkable at all, not
-- merely asserted about `listings` in isolation.
insert into results (name, passed)
select 'AC-8: anon no longer holds any privilege on members_id_seq (fork-era gap closed)',
       not has_sequence_privilege('anon', 'public.members_id_seq', 'usage');

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
