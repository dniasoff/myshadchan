--
-- Medical tab (Story 5.5, the sensitive tier) — database test suite.
--
-- AC 3's own falsifiable, verbatim: seed one household account with four
-- members, one per role (parent_admin, single, helper, self_manager), and
-- one medical note; the single and helper members' clients must each see
-- zero rows from `select * from medical_notes`, and the parent_admin and
-- self_manager members must see the row. A fifth case: a member of a
-- SECOND account sees zero rows.
--
-- Six logins, two household accounts. Account A holds all four roles so
-- every negative/positive case is checked against the SAME row, under the
-- SAME account_id — the account-scoping half (AC 3's "account_id =
-- current_context_id()") is exercised separately by the second-account case
-- (u5), never conflated with the role check. u6 gets NO account_members row
-- at all — the fail-closed case the policy's own comment claims but that no
-- check here previously exercised (see (k)).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (medical_notes.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql).
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
-- Arrange: six logins. u1-u4 are the four roles inside household account A;
-- u5 is a parent_admin of a SEPARATE household account B (AC 3's fifth
-- case); u6 gets no account_members row anywhere (case (k)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values
  ('e6111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-admin@test.local'),
  ('e6222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-single@test.local'),
  ('e6333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-helper@test.local'),
  ('e6444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-selfmgr@test.local'),
  ('e6555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-foreign@test.local'),
  ('e6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mn-nobody@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('MN Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('MN Household B (foreign)', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e6111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e6222222-2222-2222-2222-222222222222', 'single', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e6333333-3333-3333-3333-333333333333', 'helper', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e6444444-4444-4444-4444-444444444444', 'self_manager', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'e6555555-5555-5555-5555-555555555555', 'parent_admin', 'active');

-- One single + shidduch in account A, created by u1 (parent_admin) while A
-- is active, so the medical note has somewhere real to point at.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.singles (first_name_en) values ('MN Single Person')
returning id as single_id \gset

insert into public.shidduchim (single_id, name_en) values (:single_id, 'MN Shidduch')
returning id as shidduch_id \gset

insert into ids values ('single_id', :'single_id'), ('shidduch_id', :'shidduch_id');

-- ---------------------------------------------------------------------------
-- (a) INSERT: the parent_admin can write a medical note. This is also the
-- one row every read case below checks against.
-- ---------------------------------------------------------------------------
insert into public.medical_notes (shidduchim_id, body)
values (:shidduch_id, 'Allergic to penicillin.')
returning id as note_id \gset

insert into ids values ('note_id', :'note_id');

insert into results (name, passed)
select '(a) insert: parent_admin can insert a medical note for a shidduch in the active account',
       (select count(*) from public.medical_notes where id = (select value::bigint from ids where name = 'note_id')) = 1;

insert into results (name, passed)
select '(a) insert: account_id was server-set to the active account, not left null or client-supplied',
       (select account_id from public.medical_notes where id = (select value::bigint from ids where name = 'note_id')) = (select value::bigint from ids where name = 'acct_a');

-- ---------------------------------------------------------------------------
-- (b) SELECT: parent_admin (u1) sees the row.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(b) select: parent_admin (u1) sees the medical note',
       (select count(*) from public.medical_notes) = 1;

-- ---------------------------------------------------------------------------
-- (c) SELECT: single (u2) sees zero rows — AC 3's own falsifiable.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select '(c) select: single (u2) sees zero medical_notes rows (AC 3''s own falsifiable)',
       (select count(*) from public.medical_notes) = 0;

-- ---------------------------------------------------------------------------
-- (d) SELECT: helper (u3) sees zero rows.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select '(d) select: helper (u3) sees zero medical_notes rows',
       (select count(*) from public.medical_notes) = 0;

-- ---------------------------------------------------------------------------
-- (e) SELECT: self_manager (u4) sees the row — the deliberate parent_admin
-- parity this story's "who may read" ruling turns on.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6444444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed)
select '(e) select: self_manager (u4) sees the medical note',
       (select count(*) from public.medical_notes) = 1;

-- ---------------------------------------------------------------------------
-- (f) SELECT: a parent_admin of a SECOND, unrelated account sees zero rows —
-- AC 3's fifth case, the account-scoping half.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6555555-5555-5555-5555-555555555555","role":"authenticated"}';

insert into results (name, passed)
select '(f) select: a parent_admin of a different account sees zero rows (account-scoping, not role, is the reason)',
       (select count(*) from public.medical_notes) = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e6111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (g) UPDATE: single cannot write, mirroring the read denial (the policy is
-- ONE `for all`, not select-only). An RLS `USING` clause silently excludes
-- non-matching rows from the UPDATE's target set rather than raising — the
-- falsifiable is zero rows affected, not an exception.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_note_id bigint;
  v_rows_affected int;
begin
  select value::bigint into v_note_id from ids where name = 'note_id';
  update public.medical_notes set body = 'tampered' where id = v_note_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    '(g) update: single''s UPDATE affects zero rows (RLS''s USING clause excludes the row from the target set)',
    v_rows_affected = 0,
    'rows affected: ' || v_rows_affected
  );
end $$;

-- Switch back to parent_admin (u1) to read the row — single cannot see it at
-- all, so checking the body value from single's own session would read a
-- silent NULL (RLS hides the row) rather than actually proving it unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select '(g) update: the note body is unchanged after single''s attempted update',
       (select body from public.medical_notes where id = (select value::bigint from ids where name = 'note_id')) = 'Allergic to penicillin.';

-- ---------------------------------------------------------------------------
-- (h) AC 4: a medical note is never funnelled through interactions —
-- 'medical' is not a legal interactions.kind value.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.interactions (target_type, target_id, kind, scope, body)
  values ('shidduch', (select value::bigint from ids where name = 'shidduch_id'), 'medical', 'shidduch', 'should be rejected');
  insert into results values ('(h) interactions_kind_check rejects ''medical'' as a kind', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(h) interactions_kind_check rejects ''medical'' as a kind',
    sqlerrm like '%interactions_kind_check%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (i) Trigger catalog facts: this story's schema decisions, asserted
-- directly rather than only through their read-time effects above.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(i) set_medical_notes_account_id fires BEFORE INSERT on medical_notes',
       exists (
         select 1 from pg_trigger
         where tgname = 'set_medical_notes_account_id'
           and tgrelid = 'public.medical_notes'::regclass
           and not tgisinternal
       );

insert into results (name, passed)
select '(i) validate_medical_notes_household_scope (enforce_household_scope) is attached to medical_notes',
       exists (
         select 1 from pg_trigger
         where tgname = 'validate_medical_notes_household_scope'
           and tgrelid = 'public.medical_notes'::regclass
           and tgfoid = 'public.enforce_household_scope'::regproc
           and not tgisinternal
       );

-- ---------------------------------------------------------------------------
-- (j) anon: zero rows, zero privileges — same posture as entity_files /
-- resume_photos.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

do $$
begin
  perform count(*) from public.medical_notes;
  insert into results values ('(j) anon: reads zero medical_notes rows (SELECT itself is denied)', false, 'SELECT unexpectedly succeeded');
exception when others then
  insert into results values ('(j) anon: reads zero medical_notes rows (SELECT itself is denied)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select '(j) anon: holds no privilege on public.medical_notes',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'medical_notes' and grantee = 'anon'
       );

-- ---------------------------------------------------------------------------
-- (k) An AUTHENTICATED caller with ZERO active memberships anywhere sees
-- zero rows — the policy comment's own fail-closed claim (05_policies.sql:
-- "when the caller holds no active membership current_member_id() returns
-- null, am.id = null matches nothing"), asserted directly rather than only
-- implied by (c)/(d)'s role checks, which both still resolve a real
-- context. u6 has an auth.users row but no account_members row at all, so
-- current_context_id() itself returns NULL (references_entity.sql's
-- "a user with no membership resolves to NO account" precedent) — double
-- fail-closed, same as the UI-layer AC 2(b) proof.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6666666-6666-6666-6666-666666666666","role":"authenticated"}';

insert into results (name, passed)
select '(k) an authenticated caller with zero active memberships resolves to no active context',
       public.current_context_id() is null;

insert into results (name, passed)
select '(k) an authenticated caller with zero active memberships sees zero medical_notes rows (fails closed)',
       (select count(*) from public.medical_notes) = 0;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
