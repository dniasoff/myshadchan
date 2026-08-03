--
-- Publishing a listing (Epic 9 Stories 9.1, 9.2 and 9.3) — database test
-- suite.
--
-- Story 9.1 (the `shadchan` branch) covers AC-1 through AC-8: field-by-field
-- opt-in with a real `null` (not an empty string) for anything left off, the
-- CHECK constraint behind "name required", the partial unique index behind
-- "one live listing, not a growing pile", the anon-readable snapshot itself
-- (AD-21) and its immediate disappearance on withdrawal, the two negative
-- angles behind "a household can never publish a shadchan listing", tenant
-- isolation on the authenticated-scoped policies, and the exact grant/RLS
-- shape AC-8 demands — including the fork-era `members_id_seq` gap that
-- story's migration also closes.
--
-- Story 9.2 (the `single` branch, appended below the 9.1 checks) covers its
-- own AC-2/AC-3/AC-6/AC-7/AC-8: the name-required CHECK restated for two
-- first-name columns instead of one, "only the manager may publish" from
-- every angle FR103 distinguishes (helper, plain single, and a self-manager
-- refused specifically on a SIBLING while a positive control proves the
-- SAME self-manager publishing their own record still works), the partial
-- unique index on `single_id`, anon readability, and a genuine cross-
-- household negative test proving the refusal comes from RLS itself, not
-- the composite FK (Dev Notes "Why the cross-account negative test still
-- matters despite the composite FK").
--
-- Story 9.2 review fixes (F1/F1b, F2): "Single listings update"'s `using`
-- clause now repeats the manager predicate against the OLD row (it is not
-- enough for `with check` alone to police the attacker-controlled NEW row)
-- — F1 reproduces the exact exploit this closes (a self-manager repointing
-- a SIBLING's listing's single_id at their own single_id), F1b proves the
-- mirror direction still needs `with check`'s own predicate (repointing a
-- listing the caller genuinely owns onto a single they don't manage), and
-- F2 independently exercises the UPDATE policy's own authorization (helper,
-- plain single, self-manager-on-sibling without touching single_id), which
-- until this fix could be deleted from the policy with zero test failures.
--
-- Story 9.3 (the dignity-floor lock, appended below the 9.1/9.2 checks)
-- covers AC-1 through AC-7: a single with a login withdraws their own
-- listing regardless of who published it (AC-1), that withdrawal blocks
-- republication until the single consents again (AC-2), a parent's OWN
-- withdrawal of a listing the single never touched creates no lock and
-- republishes freely (AC-3), only the single may ever clear the lock — the
-- absent DML grant on `listing_withdrawal_locks` refuses every raw
-- delete/insert/update attempt as `permission denied`, never a row-security
-- violation, and the RPC itself is a silent no-op for the wrong caller
-- (AC-4), withdrawal disappears from the anon-visible set immediately
-- (AC-5), a self-manager's own withdrawal sets no lock (AC-6), and a
-- DIFFERENT household's single can neither delete this single's listing nor
-- clear their lock (AC-7).
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

-- =============================================================================
-- Publishing a single's listing (Epic 9 Story 9.2) — the `single` branch of
-- the same table and the two RLS policies (Task 1) this story adds on top
-- of 9.1's `shadchan`-only ones.
--
-- Arrange (as postgres/superuser):
--   Household PA — four members, one per role FR103 distinguishes:
--     parent_admin (may publish for ANY single in PA), self_manager
--     (may publish ONLY the single record that is themselves, single_self),
--     helper and a plain single (neither may ever publish). Two singles:
--     single_self (member_id = the self-manager's own account_members.id)
--     and single_sibling (a second single in the SAME household, nobody's
--     own record) — AC-3's "self-manager publishing for a sibling" needs
--     exactly this shape.
--   Household PB — a second, unrelated household's parent_admin, for
--     AC-8's cross-account negative test against PA's single_sibling.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email) values
  ('59220000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-parent@test.local'),
  ('59220000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-selfmgr@test.local'),
  ('59220000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-helper@test.local'),
  ('59220000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-plain@test.local'),
  ('59220000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-crossb@test.local');

insert into public.accounts (name, kind) values ('Listings Suite Household PA', 'household') returning id as account_pa \gset
insert into public.accounts (name, kind) values ('Listings Suite Household PB', 'household') returning id as account_pb \gset

insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59220000-0000-0000-0000-000000000001', 'parent_admin')
  returning id as member_pa_parent \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59220000-0000-0000-0000-000000000002', 'self_manager')
  returning id as member_pa_self \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59220000-0000-0000-0000-000000000003', 'helper')
  returning id as member_pa_helper \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59220000-0000-0000-0000-000000000004', 'single')
  returning id as member_pa_single \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pb, '59220000-0000-0000-0000-000000000005', 'parent_admin')
  returning id as member_pb_parent \gset

insert into ids values
  ('spa_account_pa', :account_pa), ('spa_account_pb', :account_pb),
  ('spa_member_pa_parent', :member_pa_parent), ('spa_member_pa_self', :member_pa_self),
  ('spa_member_pa_helper', :member_pa_helper), ('spa_member_pa_single', :member_pa_single),
  ('spa_member_pb_parent', :member_pb_parent);

-- Singles created as PA's own parent_admin (their sole active membership,
-- so PA is auto-activated). single_self.member_id points straight at the
-- self-manager's own account_members row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.singles (first_name_en, member_id)
values ('Listings Self-Managed Single', :member_pa_self)
returning id as single_self \gset

insert into public.singles (first_name_en) values ('Listings Sibling Single')
returning id as single_sibling \gset

reset role;
insert into ids values ('spa_single_self', :single_self), ('spa_single_sibling', :single_sibling);

-- -----------------------------------------------------------------------
-- AC-2: a nameless single listing (neither script opted in) is refused by
-- listings_single_name_required, not merely by the UI.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-2: a single listing with BOTH first-name columns NULL is refused by listings_single_name_required';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id) values ('single', v_single_sibling);
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%listings_single_name_required%', sqlstate, sqlerrm);
end $$;

reset role;

-- -----------------------------------------------------------------------
-- Positive path: PA's parent_admin publishes the SIBLING's listing (proves
-- "any single in the household", not merely "my own"), then republishes
-- (AC-6 — updates in place) and a raw second INSERT for the same single_id
-- is refused by the partial unique index.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, single_id, single_first_name_en)
values ('single', :single_sibling, 'Sibling One')
returning id as listing_sibling \gset

reset role;
insert into ids values ('spa_listing_sibling', :listing_sibling);

insert into results (name, passed, detail)
select 'Story 9.2 AC-1: single_community stays NULL when never opted in',
       single_community is null,
       format('single_community = %L', single_community)
from public.listings where id = :listing_sibling;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.listings set single_community = 'Yeshivish' where id = :listing_sibling;

reset role;

insert into results (name, passed)
select 'Story 9.2 AC-6: republishing (UPDATE) changes the SAME row in place',
       single_community = 'Yeshivish'
from public.listings where id = :listing_sibling;

insert into results (name, passed, detail)
select 'Story 9.2 AC-6: single_id stays unique among single-branch listings — still exactly one row for the sibling',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listings where single_id = :single_sibling and listing_type = 'single';

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-6: a second single-branch listings row for the SAME single is refused by listings_single_id_key';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_sibling, 'A Second Row');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23505', '%listings_single_id_key%', sqlstate, sqlerrm);
end $$;

reset role;

-- -----------------------------------------------------------------------
-- AC-3: only the manager may publish. Both non-manager roles refused on
-- the sibling; the self-manager refused on the sibling too (their
-- authority is scoped to THEMSELVES, not the household), then a positive
-- control proves the self-manager's own record still works — isolating
-- the refusal above as a real authority boundary, not a blanket denial of
-- every self-manager insert.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-3: a helper cannot INSERT a single listing for anyone in the household';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_sibling, 'Helper Attempt');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-3: a plain single (not self-managing) cannot INSERT a single listing for anyone in the household';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_sibling, 'Plain Single Attempt');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-3: a self-manager cannot INSERT a single listing for a SIBLING — authority is scoped to themselves only';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_sibling, 'Self-Manager Attempt On Sibling');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- -----------------------------------------------------------------------
-- F1 (Review, BLOCKING) — same session, same self-manager, deliberately
-- BEFORE the positive-control publish below: at this point the attacker
-- (member 2) has NO listing of their own yet, matching the review's exact
-- precondition ("attacker has no listing yet; realistic"). This matters —
-- if the attacker already had a live listing, `listings_single_id_key`
-- (the partial unique index) would collide and mask the RLS gap rather
-- than prove it closed, since two rows can never share a single_id either
-- way.
--
-- "Single listings update"'s `using` clause must enforce manager authority
-- against the OLD row, not merely tenant + branch — otherwise a
-- self-manager can `UPDATE ... SET single_id = <their own single>` on a
-- SIBLING's listing: `with check` alone evaluates the attacker-controlled
-- NEW row, and is satisfied once single_id points at the caller's own
-- record. Reproduces the review's exact exploit and proves it is refused
-- with zero rows affected — RLS excludes the row at `using` itself, before
-- `with check` ever sees the attacker-chosen new single_id.
-- -----------------------------------------------------------------------
with attempt as (
  update public.listings
  set single_id = :single_self
  where id = :listing_sibling
  returning id
)
select count(*) as cnt from attempt \gset f1_hijack_

insert into results (name, passed, detail)
select 'F1: a self-manager with no listing of their own cannot repoint a SIBLING''s listing''s single_id at their own single_id (the "using" clause refuses at the OLD row before "with check" ever sees the attacker-controlled NEW row)',
       :f1_hijack_cnt = 0,
       format('rows updated: %s', :f1_hijack_cnt);

-- Positive control, same session: the self-manager publishing THEIR OWN
-- record succeeds — proves the refusal just above is FR103's authority
-- boundary specifically, not a blanket refusal of every self-manager write.
insert into public.listings (listing_type, single_id, single_first_name_en)
values ('single', :single_self, 'Self-Managed Publisher')
returning id as listing_self \gset

reset role;
insert into ids values ('spa_listing_self', :listing_self);

insert into results (name, passed, detail)
select 'F1: the sibling''s listing is untouched by the refused repoint attempt (single_id and single_community unchanged)',
       single_id = :single_sibling and single_community = 'Yeshivish',
       format('single_id=%s single_community=%L', single_id, single_community)
from public.listings where id = :listing_sibling;

insert into results (name, passed)
select 'Story 9.2 AC-3 control: the self-manager CAN publish their OWN record (single_self) — the sibling refusal above is a real authority boundary, not a blanket denial',
       single_first_name_en = 'Self-Managed Publisher'
from public.listings where id = :listing_self;

insert into results (name, passed, detail)
select 'Story 9.2 AC-3: none of the three refused attempts left a row behind for the sibling beyond the one legitimate row already there',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listings where single_id = :single_sibling;

-- -----------------------------------------------------------------------
-- F2 (Review): the UPDATE policy's own authorization must be exercised
-- independently of the INSERT policy's — a helper, a plain single, and a
-- self-manager targeting a SIBLING (WITHOUT touching single_id at all)
-- must each be refused when attempting to change an already-published
-- single-branch listing they do not manage. A positive control (the
-- self-manager updating their OWN listing) proves the fix does not also
-- block the legitimate case.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000003","role":"authenticated"}';

with attempt as (
  update public.listings set single_community = 'Hijacked by Helper'
  where id = (select value from ids where name = 'spa_listing_sibling')
  returning id
)
select count(*) as cnt from attempt \gset f2_helper_

reset role;

insert into results (name, passed, detail)
select 'F2: a helper cannot UPDATE a single-branch listing (sibling''s) even without touching single_id',
       :f2_helper_cnt = 0,
       format('rows updated: %s', :f2_helper_cnt);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000004","role":"authenticated"}';

with attempt as (
  update public.listings set single_community = 'Hijacked by Plain Single'
  where id = (select value from ids where name = 'spa_listing_sibling')
  returning id
)
select count(*) as cnt from attempt \gset f2_plain_

reset role;

insert into results (name, passed, detail)
select 'F2: a plain single (not self-managing) cannot UPDATE a single-branch listing (sibling''s)',
       :f2_plain_cnt = 0,
       format('rows updated: %s', :f2_plain_cnt);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000002","role":"authenticated"}';

with attempt as (
  update public.listings set single_community = 'Hijacked by Self-Manager'
  where id = (select value from ids where name = 'spa_listing_sibling')
  returning id
)
select count(*) as cnt from attempt \gset f2_selfmgr_

insert into results (name, passed, detail)
select 'F2: a self-manager cannot UPDATE a SIBLING''s listing without repointing single_id either — authority is scoped to their own record only',
       :f2_selfmgr_cnt = 0,
       format('rows updated: %s', :f2_selfmgr_cnt);

-- Positive control, same session: the self-manager updating THEIR OWN
-- listing still succeeds after the "using"-clause fix — the refusals above
-- are a real authority boundary, not a regression that blocks every
-- self-manager UPDATE.
update public.listings set single_height = 'Tall (self-update)'
where id = (select value from ids where name = 'spa_listing_self');

reset role;

insert into results (name, passed, detail)
select 'F2 control: the self-manager CAN still UPDATE their OWN listing (single_self) after the "using"-clause fix',
       single_height = 'Tall (self-update)',
       format('single_height=%L', single_height)
from public.listings where id = (select value from ids where name = 'spa_listing_self');

insert into results (name, passed, detail)
select 'F2: none of the three refused UPDATE attempts (helper, plain single, self-manager-on-sibling) changed the sibling''s listing',
       single_community = 'Yeshivish',
       format('single_community=%L', single_community)
from public.listings where id = (select value from ids where name = 'spa_listing_sibling');

-- -----------------------------------------------------------------------
-- F1b (Review, BLOCKING) — the MIRROR direction of F1: "with check" must
-- independently refuse a self-manager repointing a listing they already
-- legitimately own (single_self) onto a single they do NOT manage (the
-- sibling). "using" alone would let this UPDATE reach the row (it is
-- genuinely theirs), so this is the one case where "with check"'s own
-- manager predicate — not "using"'s — is the only thing standing between
-- the caller and the write. Proves neither clause is redundant with the
-- other; both are load-bearing.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000002","role":"authenticated"}';

-- Unlike F1/F2 above, "using" genuinely admits this row (it is the caller's
-- own), so the refusal here is a "with check" violation — an explicit RLS
-- error (42501), not a silent 0-row exclusion — hence the exception-catching
-- form rather than the row-count form used above.
do $$
declare
  v_name constant text := 'F1b: a self-manager cannot repoint THEIR OWN listing''s single_id onto the SIBLING they do not manage ("with check" refuses the attacker-controlled NEW row even though "using" allows reaching a row they legitimately own)';
  v_listing_self bigint;
  v_single_sibling bigint;
begin
  select value into v_listing_self from ids where name = 'spa_listing_self';
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  update public.listings set single_id = v_single_sibling where id = v_listing_self;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed, detail)
select 'F1b: the self-manager''s own listing (single_self) is untouched by the refused reverse-repoint attempt',
       single_id = (select value from ids where name = 'spa_single_self'),
       format('single_id=%s', single_id)
from public.listings where id = (select value from ids where name = 'spa_listing_self');

-- -----------------------------------------------------------------------
-- AC-7: the single-branch listing is anon-readable too — opted-in fields
-- come back, opted-out fields stay null.
-- -----------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into results (name, passed, detail)
select 'Story 9.2 AC-7: an anon SELECT reaches the single-branch listing''s opted-in fields (name, community) and leaves height NULL',
       count(*) filter (
         where single_first_name_en = 'Sibling One'
           and single_community = 'Yeshivish'
           and single_height is null
       ) = 1,
       format('matching rows: %s', count(*))
from public.listings where id = :listing_sibling;

reset role;

-- -----------------------------------------------------------------------
-- AC-8: household PB's own parent_admin — a genuine cross-account caller —
-- can never publish, update, or read-as-owner a listing belonging to a
-- single in household PA. The refusal must come from RLS (42501) itself,
-- not surface as the composite FK's constraint-violation instead (Dev
-- Notes "Why the cross-account negative test still matters despite the
-- composite FK").
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.2 AC-8: a DIFFERENT household''s parent_admin cannot INSERT a listing naming PA''s single — refused by RLS, not the composite FK';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_sibling, 'Cross-Account Hijack');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

with attempt as (
  update public.listings set single_community = 'Hijacked by PB'
  where id = (select value from ids where name = 'spa_listing_sibling')
  returning id
)
select count(*) as cnt from attempt \gset cross_update_

insert into results (name, passed, detail)
select 'Story 9.2 AC-8: a DIFFERENT household''s parent_admin''s UPDATE of PA''s single listing affects zero rows',
       :cross_update_cnt = 0,
       format('rows updated: %s', :cross_update_cnt);

select count(*) as cnt from public.listings
where id = (select value from ids where name = 'spa_listing_sibling') \gset cross_select_

insert into results (name, passed, detail)
select 'Story 9.2 AC-8: a DIFFERENT household''s parent_admin''s read-as-owner SELECT of PA''s single listing returns zero rows',
       :cross_select_cnt = 0,
       format('rows visible: %s', :cross_select_cnt);

reset role;

insert into results (name, passed)
select 'Story 9.2 AC-8: PA''s single listing is untouched by every refused cross-account attempt',
       single_community = 'Yeshivish'
from public.listings where id = :listing_sibling;

-- =============================================================================
-- A single controls their own listing (Epic 9 Story 9.3) — the dignity-floor
-- lock: "Single listings delete", the withdrawal-lock trigger
-- (lock_listing_on_single_withdrawal), the sole-consent RPC
-- (consent_to_republish_listing()), and the amended "Single listings insert"
-- policy that checks it.
--
-- Reuses household PA/PB from Story 9.2's own Arrange above rather than
-- re-seeding a third pair of households — PA already has one member per
-- role FR103 distinguishes. This section only:
--   - links PA's existing plain-`single` member (member_pa_single) to a
--     `singles` row of their own (single_login) — the "single with a login"
--     subject S that AC-1 through AC-4 exercise;
--   - adds ONE new PB member with role `single` (member_pb_single /
--     single_login_pb) for AC-7's cross-account negative test.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email) values
  ('59220000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-pb-login@test.local');

insert into public.account_members (account_id, user_id, role) values
  (:account_pb, '59220000-0000-0000-0000-000000000006', 'single')
  returning id as member_pb_single \gset

insert into ids values ('s93_member_pb_single', :member_pb_single);

-- single_login: PA's plain single member (member_pa_single, role 'single')
-- gets their own singles row, member_id pointing straight back at their own
-- account_members row — the same shape single_self already established for
-- the self-manager above.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.singles (first_name_en, member_id)
values ('Listings Login Single', :member_pa_single)
returning id as single_login \gset

reset role;
insert into ids values ('s93_single_login', :single_login);

-- single_login_pb: PB's own "single with a login" — S2 for AC-7's
-- cross-account negative test, in a DIFFERENT household from single_login.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000005","role":"authenticated"}';

insert into public.singles (first_name_en, member_id)
values ('Listings Login Single PB', :member_pb_single)
returning id as single_login_pb \gset

reset role;
insert into ids values ('s93_single_login_pb', :single_login_pb);

-- PA's parent_admin publishes single_login's listing — the row S is about
-- to withdraw (AC-1).
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, single_id, single_first_name_en)
values ('single', :single_login, 'Login Single, Published By Parent')
returning id as listing_login \gset

reset role;
insert into ids values ('s93_listing_login', :listing_login);

-- -----------------------------------------------------------------------
-- AC-1: a single with a login may always withdraw their own listing,
-- regardless of who published it — S never had insert/update rights over
-- this row (9.2 never granted plain `single` those), but the new "Single
-- listings delete" policy's second EXISTS branch admits them.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000004","role":"authenticated"}';

with attempt as (
  delete from public.listings where id = :listing_login returning id
)
select count(*) as cnt from attempt \gset s93_ac1_

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-1: a single with a login (role single) deletes their OWN listing even though they never had insert/update rights over it',
       :s93_ac1_cnt = 1,
       format('rows deleted: %s', :s93_ac1_cnt);

-- AC-5: the same immediate-disappearance mechanism as 9.1 AC-5, exercised
-- specifically for the single's own withdrawal.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into results (name, passed, detail)
select 'Story 9.3 AC-5: the single''s own withdrawal removes the listing from the anon-visible set immediately',
       count(*) = 0,
       format('rows still visible: %s', count(*))
from public.listings where id = :listing_login;

reset role;

insert into results (name, passed, detail)
select 'Story 9.3: the withdrawal-lock trigger created exactly one lock row for single_login (role single, own withdrawal)',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_login;

insert into results (name, passed)
select 'Story 9.3: the lock row''s account_id matches PA''s household, not some other tenant',
       account_id = :account_pa
from public.listing_withdrawal_locks where single_id = :single_login;

-- -----------------------------------------------------------------------
-- AC-2: withdrawal by the single blocks republication until the single
-- consents again — the amended "Single listings insert" policy's added
-- `not exists (... listing_withdrawal_locks ...)` clause.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.3 AC-2: the parent_admin''s republish attempt for the locked single is refused by RLS (not merely discouraged in the UI)';
  v_single_login bigint;
begin
  select value into v_single_login from ids where name = 's93_single_login';
  insert into public.listings (listing_type, single_id, single_first_name_en)
  values ('single', v_single_login, 'Republish Attempt While Locked');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-2: the refused republish attempt left zero rows for single_login',
       count(*) = 0,
       format('rows: %s', count(*))
from public.listings where single_id = :single_login;

-- -----------------------------------------------------------------------
-- AC-3: the lock is set only by the single's OWN withdrawal, never by a
-- parent's — single_sibling was never touched by any single (Story 9.2's
-- own listing_sibling row, still live and republished there). PA's
-- parent_admin withdraws it themselves, then republishes immediately — no
-- lock, no refusal.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

with attempt as (
  delete from public.listings where id = :listing_sibling returning id
)
select count(*) as cnt from attempt \gset s93_ac3_withdraw_

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-3: parent_admin can withdraw a listing about a single who never touched it',
       :s93_ac3_withdraw_cnt = 1,
       format('rows deleted: %s', :s93_ac3_withdraw_cnt);

insert into results (name, passed, detail)
select 'Story 9.3 AC-3: withdrawing a listing THE PARENT published themselves creates NO lock row for that single',
       count(*) = 0,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_sibling;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, single_id, single_first_name_en)
values ('single', :single_sibling, 'Republished Immediately By Parent')
returning id as listing_sibling2 \gset

reset role;
insert into ids values ('s93_listing_sibling2', :listing_sibling2);

insert into results (name, passed)
select 'Story 9.3 AC-3: the parent_admin''s immediate republish succeeds — a parent withdrawing their own publication is NOT the protected case',
       single_first_name_en = 'Republished Immediately By Parent'
from public.listings where id = :listing_sibling2;

-- -----------------------------------------------------------------------
-- Review fix (F1, BLOCKING): the dignity-floor lock (AC-2) must survive an
-- UPDATE that REPOINTS an unlocked listing onto the locked single, not
-- only a plain re-INSERT (already proven above). `using` alone cannot
-- catch this — it only ever evaluates the OLD row (listing_sibling2,
-- unlocked, PA-managed), so the amended "Single listings update" WITH
-- CHECK clause (mirroring the insert policy's own lock check, evaluated
-- against the NEW row) is the only place this is refused. Positive
-- control first: an ordinary update of the SAME unlocked listing (no
-- single_id repoint) must still succeed — the fix must not overreach.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

with attempt as (
  update public.listings set single_age = 24
  where id = :listing_sibling2
  returning id
)
select count(*) as cnt from attempt \gset s93_f1_control_

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 F1 control: an ordinary UPDATE of an unlocked single''s listing (no single_id repoint) still succeeds',
       :s93_f1_control_cnt = 1,
       format('rows updated: %s', :s93_f1_control_cnt);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.3 F1: a parent_admin cannot UPDATE-repoint an unlocked sibling listing onto a LOCKED single — the dignity floor survives UPDATE, not just INSERT';
  v_listing_sibling2 bigint;
  v_single_login bigint;
begin
  select value into v_listing_sibling2 from ids where name = 's93_listing_sibling2';
  select value into v_single_login from ids where name = 's93_single_login';
  update public.listings
  set single_id = v_single_login, single_first_name_en = 'Attacker Repoint While Locked'
  where id = v_listing_sibling2;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 F1: the refused repoint left listing_sibling2 pointing at the ORIGINAL (unlocked) single, untouched',
       single_id = :single_sibling and single_first_name_en <> 'Attacker Repoint While Locked',
       format('single_id=%s first_name=%s', single_id, single_first_name_en)
from public.listings where id = :listing_sibling2;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Filters/selects only anon's own granted columns (id, single_first_name_en)
-- — never single_id, which anon has no column grant on at all (9.1 F6; the
-- `?single_id=eq.…` oracle the review's own "Verified clean" section
-- confirms is closed). The listing anon sees at this id must still be the
-- ORIGINAL sibling's name, never the attacker's repoint text — the same
-- fact the PA-role check above just proved, now re-proved from anon's own
-- narrower, publicly-facing vantage point.
insert into results (name, passed, detail)
select 'Story 9.3 F1: anon sees the ORIGINAL (unlocked) listing at that id, not the attacker''s repoint — no leak occurred',
       single_first_name_en <> 'Attacker Repoint While Locked',
       format('single_first_name_en=%s', single_first_name_en)
from public.listings where id = :listing_sibling2;

reset role;

-- -----------------------------------------------------------------------
-- AC-4 (raw DML refused): only the single may clear the lock — never the
-- parent, never any other role, via raw DML. `authenticated` holds NO DML
-- grant on the lock table at all (select only), so every attempt below
-- raises "permission denied for table listing_withdrawal_locks" (42501),
-- not a row-security violation — the absent grant IS the boundary.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.3 AC-4: a parent_admin''s raw DELETE on listing_withdrawal_locks is refused — no DML grant exists for authenticated at all';
  v_single_login bigint;
begin
  select value into v_single_login from ids where name = 's93_single_login';
  delete from public.listing_withdrawal_locks where single_id = v_single_login;
  perform pg_temp.unexpected_raise(v_name, null, 'delete unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%permission denied for table listing_withdrawal_locks%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'Story 9.3 AC-4: a parent_admin''s raw INSERT (forging a lock) on listing_withdrawal_locks is refused — no DML grant exists for authenticated at all';
  v_account_pa bigint;
  v_single_sibling bigint;
begin
  select value into v_account_pa from ids where name = 'spa_account_pa';
  select value into v_single_sibling from ids where name = 'spa_single_sibling';
  insert into public.listing_withdrawal_locks (account_id, single_id) values (v_account_pa, v_single_sibling);
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%permission denied for table listing_withdrawal_locks%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'Story 9.3 AC-4: a parent_admin''s raw UPDATE on listing_withdrawal_locks is refused — no DML grant exists for authenticated at all';
  v_single_login bigint;
begin
  select value into v_single_login from ids where name = 's93_single_login';
  update public.listing_withdrawal_locks set locked_at = now() where single_id = v_single_login;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%permission denied for table listing_withdrawal_locks%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-4: the lock row for single_login survived every refused raw DML attempt untouched',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_login;

insert into results (name, passed)
select 'Story 9.3 AC-4: authenticated holds no INSERT/UPDATE/DELETE/TRUNCATE on listing_withdrawal_locks',
       not has_table_privilege('authenticated', 'public.listing_withdrawal_locks', 'insert')
       and not has_table_privilege('authenticated', 'public.listing_withdrawal_locks', 'update')
       and not has_table_privilege('authenticated', 'public.listing_withdrawal_locks', 'delete')
       and not has_table_privilege('authenticated', 'public.listing_withdrawal_locks', 'truncate');

insert into results (name, passed)
select 'Story 9.3 AC-4: authenticated holds SELECT on listing_withdrawal_locks (the manager''s UI can show "locked" honestly)',
       has_table_privilege('authenticated', 'public.listing_withdrawal_locks', 'select');

insert into results (name, passed)
select 'Story 9.3 AC-4: anon holds NO privilege at all on listing_withdrawal_locks',
       not has_table_privilege('anon', 'public.listing_withdrawal_locks', 'select')
       and not has_table_privilege('anon', 'public.listing_withdrawal_locks', 'insert')
       and not has_table_privilege('anon', 'public.listing_withdrawal_locks', 'update')
       and not has_table_privilege('anon', 'public.listing_withdrawal_locks', 'delete');

insert into results (name, passed)
select 'Story 9.3 AC-4: rowsecurity and forcerowsecurity are both true on listing_withdrawal_locks',
       relrowsecurity and relforcerowsecurity
from pg_class where oid = 'public.listing_withdrawal_locks'::regclass;

insert into results (name, passed, detail)
select 'Story 9.3 Task 5: exactly one "Single listings insert" policy exists on listings (drop+recreate did not leave two)',
       count(*) = 1,
       format('count: %s', count(*))
from pg_policies where schemaname = 'public' and tablename = 'listings' and policyname = 'Single listings insert';

insert into results (name, passed, detail)
select 'Story 9.3 Task 4: exactly one "Single listings delete" policy exists on listings',
       count(*) = 1,
       format('count: %s', count(*))
from pg_policies where schemaname = 'public' and tablename = 'listings' and policyname = 'Single listings delete';

-- -----------------------------------------------------------------------
-- AC-4 (RPC, wrong caller): consent_to_republish_listing() called by a
-- parent_admin (not the single) is a SILENT no-op, not an error — the
-- function fails closed rather than raising, and the lock row must still
-- exist afterward.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.consent_to_republish_listing(:single_login);

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-4: consent_to_republish_listing() called by a parent_admin (wrong caller) is a silent no-op — the lock row still exists afterward',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_login;

insert into results (name, passed)
select 'Story 9.3 AC-4: anon holds NO execute on consent_to_republish_listing',
       not has_function_privilege('anon', 'public.consent_to_republish_listing(bigint)', 'execute');

insert into results (name, passed)
select 'Story 9.3 AC-4: authenticated holds execute on consent_to_republish_listing',
       has_function_privilege('authenticated', 'public.consent_to_republish_listing(bigint)', 'execute');

-- -----------------------------------------------------------------------
-- AC-7: cross-account — S2 (single_login_pb, household PB) may act freely
-- over their OWN record, but neither deleting S1's listing nor clearing
-- S1's lock reaches across the household boundary.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000006","role":"authenticated"}';

with attempt as (
  delete from public.listings where id = :listing_sibling2 returning id
)
select count(*) as cnt from attempt \gset s93_ac7_delete_

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-7: a DIFFERENT household''s single (S2) cannot delete S1''s listing — 0 rows affected, not an error',
       :s93_ac7_delete_cnt = 0,
       format('rows deleted: %s', :s93_ac7_delete_cnt);

insert into results (name, passed)
select 'Story 9.3 AC-7: PA''s listing is untouched by S2''s refused cross-account delete',
       single_first_name_en = 'Republished Immediately By Parent'
from public.listings where id = :listing_sibling2;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
declare
  v_name constant text := 'Story 9.3 AC-7: a DIFFERENT household''s single (S2)''s raw DELETE attempt on S1''s lock is refused — no DML grant, regardless of account';
  v_single_login bigint;
begin
  select value into v_single_login from ids where name = 's93_single_login';
  delete from public.listing_withdrawal_locks where single_id = v_single_login;
  perform pg_temp.unexpected_raise(v_name, null, 'delete unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%permission denied for table listing_withdrawal_locks%', sqlstate, sqlerrm);
end $$;

select public.consent_to_republish_listing(:single_login);

reset role;

insert into results (name, passed, detail)
-- Review fix (F4): "scoped to S2's OWN active account" undersells WHY this
-- specific call is refused — S2 and S1 are two DISJOINT logins, so the
-- identity-binding subquery's own `s.member_id = am.id` join already
-- refuses this on its own (mutation-proved), independent of the account
-- clause. The F4 block below (after AC-6) isolates the account-scoping
-- clause itself with a genuine dual-membership login.
select 'Story 9.3 AC-7: S2''s consent_to_republish_listing() call for S1''s single is a no-op — S1''s lock survives',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_login;

-- -----------------------------------------------------------------------
-- AC-4 (positive) / AC-2 (tail): the single themselves clears their own
-- lock, and only then does the parent's republish succeed.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000004","role":"authenticated"}';

select public.consent_to_republish_listing(:single_login);

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-4: the single''s own consent_to_republish_listing() call clears their lock',
       count(*) = 0,
       format('rows remaining: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_login;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.listings (listing_type, single_id, single_first_name_en)
values ('single', :single_login, 'Republished After Consent')
returning id as listing_login2 \gset

reset role;
insert into ids values ('s93_listing_login2', :listing_login2);

insert into results (name, passed)
select 'Story 9.3 AC-2: once the single consents, the parent_admin''s republish succeeds',
       single_first_name_en = 'Republished After Consent'
from public.listings where id = :listing_login2;

-- -----------------------------------------------------------------------
-- AC-6: a self-manager's own withdrawal needs no lock and does not set
-- one — there is no separate manager to protect against.
-- -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000002","role":"authenticated"}';

with attempt as (
  delete from public.listings where id = :listing_self returning id
)
select count(*) as cnt from attempt \gset s93_ac6_

reset role;

insert into results (name, passed, detail)
select 'Story 9.3 AC-6: a self-manager withdraws their own listing successfully',
       :s93_ac6_cnt = 1,
       format('rows deleted: %s', :s93_ac6_cnt);

insert into results (name, passed, detail)
select 'Story 9.3 AC-6: no lock row is created for a self-manager''s own withdrawal (no separate manager to protect against)',
       count(*) = 0,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_self;

-- -----------------------------------------------------------------------
-- Review fix (F4): consent_to_republish_listing()'s account-scoping clause
-- (`ll.account_id = current_context_id()`) gets its own dedicated negative
-- test. The AC-7 check above (S2, a DISJOINT login with only one
-- membership) is refused entirely by the identity-binding subquery's own
-- `s.member_id = am.id` join — mutation-proved: removing the account
-- clause alone still leaves that check green, so it never actually
-- exercises this clause.
--
-- Nothing in the schema ties a `singles` row's `member_id` to an
-- account_members row IN THE SAME ACCOUNT as `singles.account_id` — the FK
-- is a bare `references account_members(id)` (01_tables.sql), no composite
-- match against `singles.account_id`. So a single CAN end up linked to a
-- membership in a DIFFERENT account than its own — exactly the kind of
-- schema-legal-but-otherwise-unreachable shape this suite's own AC-6(b)
-- precedent constructs directly to prove a policy clause in isolation
-- (05_policies.sql's comment on that same technique, echoed above). Built
-- here with a genuine DUAL-membership login — one auth.uid() holding real,
-- active memberships in BOTH PA and PB, per the `epic3-api-contract.md` /
-- Story 8.4 convention this file's own header already names — not two
-- disjoint logins.
-- -----------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59220000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listings-single-dualmember@test.local');

insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59220000-0000-0000-0000-000000000007', 'single')
  returning id as member_dual_pa \gset

insert into public.account_members (account_id, user_id, role) values
  (:account_pb, '59220000-0000-0000-0000-000000000007', 'single')
  returning id as member_dual_pb \gset

-- The single itself: genuinely homed in PA (an ordinary insert via PA's own
-- parent_admin, exactly like every other single row in this suite), member_id
-- initially pointing at the dual-membership login's OWN, legitimate PA
-- membership.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.singles (first_name_en, member_id)
values ('Dual Membership Test Single', :member_dual_pa)
returning id as single_dual \gset

reset role;

-- As postgres (table owner — RLS never applies to it regardless of FORCE
-- ROW LEVEL SECURITY): repoint member_id onto the SAME login's OTHER (PB)
-- membership. `account_id` is untouched (still PA), so the lock's own
-- composite FK is satisfied either way — this is the "broken link" shape
-- described above, constructed directly rather than through any app path.
update public.singles set member_id = :member_dual_pb where id = :single_dual;

-- A lock as if this single had genuinely withdrawn — inserted directly
-- (postgres bypasses the absent authenticated DML grant), the same way
-- AC-4's own raw-DML probes construct state directly rather than via the
-- trigger.
insert into public.listing_withdrawal_locks (account_id, single_id)
values (:account_pa, :single_dual);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59220000-0000-0000-0000-000000000007","role":"authenticated"}';

select public.set_active_context(:account_pb);

insert into results (name, passed)
select 'Story 9.3 F4 sanity: the dual-membership caller''s active context is genuinely PB (not PA) before the consent call',
       public.current_context_id() = :account_pb;

select public.consent_to_republish_listing(:single_dual);

reset role;

-- With current_context_id() = PB, the identity-binding subquery ALONE
-- would already match (member_dual_pb IS the single's member_id, role
-- 'single', account_id = PB) — the ONLY thing standing between this call
-- and clearing PA's lock is the outer `ll.account_id = current_context_id()`
-- clause, since the lock's real account_id is PA, not PB.
insert into results (name, passed, detail)
select 'Story 9.3 F4: consent_to_republish_listing()''s account-scoping clause refuses a caller whose OWN (PB) membership matches the single''s member_id, when the single''s LOCK lives in a DIFFERENT account (PA) than the caller''s active context — the lock survives',
       count(*) = 1,
       format('rows: %s', count(*))
from public.listing_withdrawal_locks where single_id = :single_dual;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
