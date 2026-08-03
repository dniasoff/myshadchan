--
-- inbox_items (Epic 2 / Story 10.3) — database test suite.
--
-- No SQL-level test existed for this table before this story despite it
-- holding captured personal content (redts, attachments, sender email) —
-- `supabase/tests/` had suites for references_entity, shidduch_catch,
-- billing_entitlement and 27 others, none for inbox_items. Covers what the
-- table-level RLS policy ("Inbox items scoped to account", 05_policies.sql)
-- and the inbound-email webhook's service_role identity both rely on:
--   (a) an account's client reads only its own rows, never another
--       account's, through the base table;
--   (b) that same client cannot INSERT or UPDATE a row so it carries
--       another account's account_id (the with-check half of the policy —
--       an insert defaults account_id via set_account_id_default(), which
--       only fills a NULL, so a client-supplied value reaches the
--       with-check unmodified and must be caught there);
--   (c) service_role — the webhook's own identity, since it calls
--       supabaseAdmin, which never carries a caller JWT — can insert
--       regardless of RLS, into ANY account, which is exactly what makes
--       captures for accounts the webhook itself has no session for
--       possible at all.
--
-- inbox_items also carries a SEPARATE guard, validate_inbox_items_household_
-- scope (04_triggers.sql), which fires before the policy is consulted and —
-- because it relies on the caller's own RLS-limited view of `accounts` —
-- already denies a cross-account write on its own, masking whether the
-- policy would too. The "(b)"/"(c)" checks below assert real,
-- both-layers-active production behaviour; the "(b-isolated)"/"(c-isolated)"
-- checks that follow each one disable that trigger for a single statement, so
-- the RLS policy is the only thing left that can deny the write — see review
-- finding F3 in this story's history for why that distinction is
-- load-bearing.
--
-- Each isolated check has been watched to FAIL, and the falsifying mutation
-- is NOT the same for the two. Stating that precisely matters more than the
-- tidier claim that one mutation covers both:
--
--   (b-isolated), INSERT — falsified by `alter policy … with check (true)`
--       alone. Verified: that check, and only that check, goes red.
--   (c-isolated), UPDATE — NOT falsified by `with check (true)` alone. It
--       needs `alter policy … using (true) with check (true)`, because for a
--       `for all` policy Postgres evaluates the USING expression against the
--       NEW row on UPDATE as well as the old one; with the with-check
--       neutered, USING alone still raises "new row violates row-level
--       security policy". (c-isolated) therefore pins "the POLICY denies this
--       UPDATE" — not "the with-check clause specifically does", which is why
--       its result name below says policy, not with-check.
--
-- The non-isolated (b)/(c) pair survives every one of those mutations,
-- because the trigger denies the write no matter what the policy says. That
-- is precisely why the isolated pair had to exist.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (inbox_items.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: two household accounts, one parent_admin login each. Both
-- household-kind (the default) — this suite is about ACCOUNT isolation, not
-- the household/shadchanus split household_scope_lift.sql already covers.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-a@test.local'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-b@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('Inbox Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('Inbox Household B', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a1111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'b2222222-2222-2222-2222-222222222222', 'parent_admin', 'active');

-- A's own capture, filed through a real authenticated insert (the app's own
-- POST /inbox_items path — account_id defaults from current_context_id()).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.inbox_items (source, raw_text)
values ('upload', 'Household A capture')
returning id as item_a \gset

reset role;
insert into ids values ('item_a', :'item_a');

-- B's own capture, same shape.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into public.inbox_items (source, raw_text)
values ('upload', 'Household B capture')
returning id as item_b \gset

reset role;
insert into ids values ('item_b', :'item_b');

-- ---------------------------------------------------------------------------
-- (a) SELECT isolation, as account A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select '(a) account A''s client reads exactly its own inbox_items row',
       (select count(*) from public.inbox_items) = 1
   and (select count(*) from public.inbox_items where id = (select value::bigint from ids where name = 'item_a')) = 1;

insert into results (name, passed)
select '(a) account A''s client reads zero of account B''s inbox_items rows',
       (select count(*) from public.inbox_items where id = (select value::bigint from ids where name = 'item_b')) = 0;

insert into results (name, passed)
select '(a) account A''s client reads zero rows filtered directly on B''s account_id',
       (select count(*) from public.inbox_items where account_id = (select value::bigint from ids where name = 'acct_b')) = 0;

-- ---------------------------------------------------------------------------
-- (b) INSERT with-check: A cannot file a capture into B's account. The
-- explicit account_id survives set_account_id_default() (which only fills a
-- NULL) and must be caught by the policy's own with-check.
--
-- Review finding F3 (this story): inbox_items ALSO carries
-- validate_inbox_items_household_scope (04_triggers.sql), a BEFORE trigger
-- that fires first and — relying on A's own RLS-limited view of `accounts`
-- ("Accounts readable to their members" hides B's row from A entirely,
-- since A holds no membership there) — already raises "account % is not a
-- household-kind account" before the WITH CHECK clause is ever consulted.
-- The two checks below therefore prove only that SOMETHING denies the
-- write: mutation-tested against `with check (true)` on this policy, they
-- still pass, because the trigger denies it regardless of what the policy
-- says. That is real production behaviour (both layers are live in
-- production) and worth asserting on its own, but it is NOT proof the
-- with-check itself works — the isolated (b-isolated) check further down,
-- with the trigger disabled, is what actually proves that.
-- ---------------------------------------------------------------------------
do $$
declare v_acct_b bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  insert into public.inbox_items (account_id, source, raw_text)
  values (v_acct_b, 'upload', 'cross-account insert attempt');
  insert into results values ('(b) account A''s client cannot INSERT a row carrying account B''s account_id (production''s normal state, both layers active)', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(b) account A''s client cannot INSERT a row carrying account B''s account_id (production''s normal state, both layers active)',
    sqlerrm like '%is not a household-kind account%' or sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

-- Positive control: the same shape, A's own account_id, succeeds — proves
-- the denial above is a genuine account_id check, not a broken INSERT path
-- in general.
do $$
declare v_acct_a bigint;
begin
  select value::bigint into v_acct_a from ids where name = 'acct_a';
  insert into public.inbox_items (account_id, source, raw_text)
  values (v_acct_a, 'upload', 'same-account insert, positive control');
  insert into results values ('(b) positive control: account A''s client CAN insert a row explicitly carrying its OWN account_id', true, null);
exception when others then
  insert into results values ('(b) positive control: account A''s client CAN insert a row explicitly carrying its OWN account_id', false, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- (b-isolated) The WITH CHECK clause ALONE: validate_inbox_items_household_scope
-- disabled for these two statements only, re-enabled immediately after —
-- inside this suite's own rolled-back transaction, mirroring
-- context_rls_hardening.sql's identical isolation of this same table/trigger
-- pair. With the trigger out of the way, an explicit foreign account_id can
-- only be caught by the RLS with-check itself, so THIS check — unlike the
-- pair above — really is falsified by `with check (true)` (mutation-tested).
-- Matches the specific Postgres RLS message only, not "when others" — a
-- differently-shaped failure (e.g. a constraint violation) must not read as
-- a pass here.
-- ---------------------------------------------------------------------------
reset role;
alter table public.inbox_items disable trigger validate_inbox_items_household_scope;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare v_acct_b bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  insert into public.inbox_items (account_id, source, raw_text)
  values (v_acct_b, 'upload', 'cross-account insert attempt, household-scope trigger disabled');
  insert into results values ('(b-isolated) with the household-scope trigger disabled, inbox_items'' own WITH CHECK alone rejects an explicit foreign account_id on INSERT', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(b-isolated) with the household-scope trigger disabled, inbox_items'' own WITH CHECK alone rejects an explicit foreign account_id on INSERT',
    sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

reset role;
alter table public.inbox_items enable trigger validate_inbox_items_household_scope;

-- ---------------------------------------------------------------------------
-- (c) UPDATE with-check: A cannot move its own row into B's account. Same
-- two-layer situation as (b): the trigger also fires on `update of
-- account_id`, so the pair below proves real denial (either layer), and the
-- isolated check after it proves the with-check specifically.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_acct_b bigint;
  v_item_a bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  select value::bigint into v_item_a from ids where name = 'item_a';
  update public.inbox_items set account_id = v_acct_b where id = v_item_a;
  insert into results values ('(c) account A''s client cannot UPDATE its own row to carry account B''s account_id (production''s normal state, both layers active)', false, 'update unexpectedly succeeded');
exception when others then
  insert into results values (
    '(c) account A''s client cannot UPDATE its own row to carry account B''s account_id (production''s normal state, both layers active)',
    sqlerrm like '%is not a household-kind account%' or sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

insert into results (name, passed)
select '(c) the targeted row still belongs to account A after the denied UPDATE attempt',
       (select account_id from public.inbox_items where id = (select value::bigint from ids where name = 'item_a'))
         = (select value::bigint from ids where name = 'acct_a');

-- ---------------------------------------------------------------------------
-- (c-isolated) The RLS POLICY ALONE, on UPDATE — same trigger isolation as
-- (b-isolated) above, but a deliberately weaker claim, and the wording is not
-- an accident.
--
-- (b-isolated) can say "the with-check clause"; this one cannot. Postgres
-- evaluates a `for all` policy's USING expression against the NEW row on
-- UPDATE as well as the old one, so with `with check (true)` in force this
-- UPDATE is still refused — by USING — with the same "new row violates
-- row-level security policy" message. Measured, not assumed:
--   `with check (true)`              -> UPDATE still DENIED
--   `using (true) with check (true)` -> UPDATE SUCCEEDS
-- So the honest claim is "the policy refuses to let A move a row into B",
-- which is the property that actually protects the data. Naming the
-- with-check specifically here would be an overclaim that no mutation of the
-- with-check alone can falsify.
-- ---------------------------------------------------------------------------
reset role;
alter table public.inbox_items disable trigger validate_inbox_items_household_scope;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_acct_b bigint;
  v_item_a bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  select value::bigint into v_item_a from ids where name = 'item_a';
  update public.inbox_items set account_id = v_acct_b where id = v_item_a;
  insert into results values ('(c-isolated) with the household-scope trigger disabled, inbox_items'' own RLS POLICY alone rejects an UPDATE moving a row to a foreign account_id', false, 'update unexpectedly succeeded');
exception when others then
  insert into results values (
    '(c-isolated) with the household-scope trigger disabled, inbox_items'' own RLS POLICY alone rejects an UPDATE moving a row to a foreign account_id',
    sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

reset role;
alter table public.inbox_items enable trigger validate_inbox_items_household_scope;

-- ---------------------------------------------------------------------------
-- (c-resolve) UPDATE side of the resolve path: A cannot move B's row to
-- 'resolved' under the USING clause. Story 11.2 extends the resolve flow,
-- so the USING side (not just with-check) needs the same cross-account
-- protection.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_item_b bigint;
begin
  select value::bigint into v_item_b from ids where name = 'item_b';
  update public.inbox_items set status = 'resolved' where id = v_item_b;
  insert into results values ('(c-resolve) account A''s client cannot UPDATE account B''s inbox item to resolved (USING side)', false, 'update unexpectedly succeeded');
exception when others then
  insert into results values (
    '(c-resolve) account A''s client cannot UPDATE account B''s inbox item to resolved (USING side)',
    sqlerrm like '%is not a household-kind account%' or sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (d) service_role bypasses RLS entirely — the webhook's own identity
-- (supabaseAdmin never carries a caller JWT). Inserts into account B while
-- no user session for B is active anywhere in this script.
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare v_acct_b bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  insert into public.inbox_items (account_id, source, raw_text, sender)
  values (v_acct_b, 'email', 'service_role capture', 'someone@example.com');
  insert into results values ('(d) service_role can insert into ANY account regardless of RLS (the webhook path)', true, null);
exception when others then
  insert into results values ('(d) service_role can insert into ANY account regardless of RLS (the webhook path)', false, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select '(d) the service_role-inserted row is really there, account-scoped to B',
       (select count(*) from public.inbox_items
        where account_id = (select value::bigint from ids where name = 'acct_b')
          and source = 'email' and sender = 'someone@example.com') = 1;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
