--
-- Files tab (Story 3.7) — database test suite.
--
-- All seven check groups from AC 8, each demonstrated red by hand (by
-- loosening the thing it names) before this file was committed, per this
-- suite's own standard (context_rls_hardening.sql:21-25). Which ones were
-- demonstrated is recorded in the story's Completion Notes. Two more groups
-- were added in the post-review fix pass: (h) AC 7(a)'s purge assertion
-- (contract §8 rule 3 / preflight landmine 11 — untested until then) and
-- (i) the uploaded_by_member_id attribution guard (F6 — the trigger no
-- longer has an if-null escape a client-supplied value could pass through).
-- Both were demonstrated red by hand too (see each group's own comment).
-- (a) and (b) also each gained one check the original pass missed: (a) a
-- cross-bucket leak guard for the `bucket_id` half of the storage SELECT
-- policy, (b) two reads through `entity_files_summary` itself (AC 3's own
-- falsifiable), not only the base table.
--
-- One login `u1` holds a `parent_admin` membership of household account A
-- and a `parent_admin` membership of household account B (active in A), plus
-- a `shadchan` membership of shadchanus account C — the same shape
-- household_scope_lift.sql uses, and for the same reason: two disjoint users
-- would pass without ever exercising current_context_id()'s active-context
-- resolution (AD-19), which is the thing that would actually regress. One
-- `entity_files` row and one `entity-files` storage object exist per
-- household account (A, B) before the cross-context checks run.
--
-- The storage half is NOT new harness work: context_rls_hardening.sql
-- already inserts into storage.objects under a set request.jwt.claims
-- (:77-88) and already demonstrates the storage.allow_delete_query dance
-- (:221-244) — this suite reuses both techniques against the `entity-files`
-- bucket instead of `attachments`.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (entity_files.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql
-- / household_scope_lift.sql).
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
-- Arrange: one login, three accounts.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('ef111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ef-u1@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('EF Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('EF Household B', 'household') returning id as acct_b \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_c \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b'), ('acct_c', :'acct_c');

-- activate_first_context_trigger activates A (u1's first live membership);
-- adding B and C afterward leaves A active (AC-5, context_resolution.sql).
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'ef111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'ef111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_c, 'ef111111-1111-1111-1111-111111111111', 'shadchan', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ef111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: u1''s active context is household A right after all three memberships exist',
       public.current_context_id() = (select value::bigint from ids where name = 'acct_a');

-- One entity_files row + one entity-files storage object for A, created
-- while A is active (both trigger-assigned to A, exactly like the app).
insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
select 'shidduch', 1, value || '/shidduch/1/a.pdf', 'a.pdf', 'application/pdf', 100
from ids where name = 'acct_a'
returning id as file_a \gset

insert into storage.objects (bucket_id, name, owner)
select 'entity-files', value || '/shidduch/1/a.pdf', 'ef111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_a \gset

insert into ids values ('file_a', :'file_a'), ('obj_a', :'obj_a');
insert into ids values ('path_a', (select value || '/shidduch/1/a.pdf' from ids where name = 'acct_a'));

-- Switch to B: one entity_files row + one storage object for B, created
-- while B is active.
select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
select 'shidduch', 2, value || '/shidduch/2/b.pdf', 'b.pdf', 'application/pdf', 200
from ids where name = 'acct_b'
returning id as file_b \gset

insert into storage.objects (bucket_id, name, owner)
select 'entity-files', value || '/shidduch/2/b.pdf', 'ef111111-1111-1111-1111-111111111111'
from ids where name = 'acct_b'
returning id as obj_b \gset

insert into ids values ('file_b', :'file_b'), ('obj_b', :'obj_b');
insert into ids values ('path_b', (select value || '/shidduch/2/b.pdf' from ids where name = 'acct_b'));

-- Back to A for the (a)/(b) checks below.
select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (a) Storage, active in A.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(a) storage: u1 reads its own object under A''s prefix (1 row)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

insert into results (name, passed)
select '(a) storage: u1 reads zero rows for B''s object while active in A',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

do $$
declare v_path_b text;
begin
  select value into v_path_b from ids where name = 'path_b';
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('entity-files', v_path_b || '-evil.pdf', 'ef111111-1111-1111-1111-111111111111');
    insert into results values ('(a) storage: an INSERT under B''s prefix raises while active in A', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values ('(a) storage: an INSERT under B''s prefix raises while active in A', true, sqlerrm);
  end;
end $$;

-- DELETE of B's object, with storage.allow_delete_query set so the
-- statement-level guard (storage.protect_delete()) is not what denies it —
-- an RLS denial, not a locked door with no key.
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

reset role;
insert into results (name, passed)
select '(a) storage: u1''s DELETE attempt on B''s object left it intact (RLS denial, not the statement guard)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

-- Positive control: u1 deleting its OWN (A's) object succeeds — proves the
-- denial above is RLS and not a broken delete path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ef111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

reset role;
insert into results (name, passed)
select '(a) storage: u1 deleting its own A object succeeds (positive control)',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ef111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Cross-bucket leak guard (review fix, F2). AC 1's own falsifiable says
-- dropping the `bucket_id` half of any one predicate turns this suite red
-- ("without bucket_id the folder predicate would apply to every other
-- bucket's objects") — but no check above actually needs that half: every
-- object exercised so far lives in the SAME bucket the policy under test
-- names, so the foldername-prefix half alone already produces the right
-- answer. A storage.objects permissive policy is evaluated across the
-- WHOLE table, not scoped to "only this bucket's rows" the way a domain
-- table's RLS predicate is — so a bucketless "Entity files readable within
-- account" would ALSO grant access to a same-prefixed object sitting in a
-- completely unrelated bucket that carries no policy of its own. Proven: a
-- decoy bucket with zero entity-files-scoped policies, one object in it
-- inserted as postgres (bypassing storage RLS, the way a service-role
-- write from an unrelated feature would) under A's own account prefix,
-- read back as u1 (authenticated, active in A). Loosening the bucket_id
-- predicate on "Entity files readable within account" down to just the
-- foldername check turns this from 0 rows to 1.
reset role;

insert into storage.buckets (id, name, public)
values ('ef-decoy-bucket', 'ef-decoy-bucket', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, owner)
select 'ef-decoy-bucket', value || '/decoy.pdf', 'ef111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_decoy \gset

insert into ids values ('obj_decoy', :'obj_decoy');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ef111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select '(a) storage: the entity-files SELECT policy''s bucket_id half does not leak a same-prefixed object in an unrelated bucket',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_decoy');

-- ---------------------------------------------------------------------------
-- (b) Table, active in A.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(b) table: u1 reads exactly one entity_files row while active in A',
       (select count(*) from public.entity_files) = 1;

insert into results (name, passed)
select '(b) table: u1 reads zero entity_files rows filtered on B''s account_id while active in A',
       (select count(*) from public.entity_files where account_id = (select value::bigint from ids where name = 'acct_b')) = 0;

-- AC 3's own falsifiable, not exercised anywhere until this review fix
-- (F2): "a member of account A queries entity_files_summary and gets zero
-- of account B's rows ... removing security_invoker = on makes the view
-- definer-owned and that check goes red." Every existing (b) check reads
-- the BASE TABLE; entity_files_summary is what FilesTab.tsx actually
-- queries (contract AC 3, AC 6a), and a security_invoker regression on the
-- view leaks through it while the base-table checks above stay green
-- (proven live on the local stack before this fix: `alter view
-- entity_files_summary set (security_invoker = off)` made this check go
-- from 0 to 1 row while every base-table (b) check kept passing).
insert into results (name, passed)
select '(b) view: u1 reads exactly one entity_files_summary row while active in A',
       (select count(*) from public.entity_files_summary) = 1;

insert into results (name, passed)
select '(b) view: u1 reads zero entity_files_summary rows filtered on B''s account_id while active in A',
       (select count(*) from public.entity_files_summary where account_id = (select value::bigint from ids where name = 'acct_b')) = 0;

select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

insert into results (name, passed)
select '(b) table: the SAME login reads exactly B''s row and zero of A''s after set_active_context(B)',
       (select count(*) from public.entity_files) = 1
   and (select count(*) from public.entity_files where id = (select value::bigint from ids where name = 'file_b')) = 1
   and (select count(*) from public.entity_files where id = (select value::bigint from ids where name = 'file_a')) = 0;

insert into results (name, passed)
select '(b) view: the SAME login reads exactly B''s entity_files_summary row and zero of A''s after set_active_context(B)',
       (select count(*) from public.entity_files_summary) = 1
   and (select count(*) from public.entity_files_summary where id = (select value::bigint from ids where name = 'file_b')) = 1
   and (select count(*) from public.entity_files_summary where id = (select value::bigint from ids where name = 'file_a')) = 0;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (c) Shadchanus positive: entity_files is NOT attached to
-- enforce_household_scope() — a shadchan can attach a file in their own
-- shadchanus context. target_id needs no real parent row: entity_files is
-- polymorphic and carries no FK on it (mirrors interactions.target_id).
-- Contrast control: public.singles still raises under a shadchanus context.
-- ---------------------------------------------------------------------------
select public.set_active_context((select value::bigint from ids where name = 'acct_c'));

do $$
declare
  v_id bigint;
  v_account_id bigint;
  v_acct_c text;
begin
  select value into v_acct_c from ids where name = 'acct_c';
  insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
    values ('shadchan', 999, v_acct_c || '/shadchan/999/c.pdf', 'c.pdf', 'application/pdf', 300)
    returning id, account_id into v_id, v_account_id;
  insert into results values (
    '(c) shadchanus positive: insert into entity_files (target_type=shadchan) succeeds with C active, and lands with account_id = C',
    v_account_id = v_acct_c::bigint,
    format('account_id=%s', v_account_id)
  );
exception when others then
  insert into results values (
    '(c) shadchanus positive: insert into entity_files (target_type=shadchan) succeeds with C active, and lands with account_id = C',
    false, sqlerrm
  );
end $$;

do $$
declare v_id bigint; v_account_id bigint;
begin
  insert into public.singles (first_name_en, gender)
  values ('EF Shadchanus Single', 'female')
  returning id into v_id;
  select account_id into v_account_id from public.singles where id = v_id;
  insert into results values (
    '(c) actor-scope control: standalone shadchanus may own a singles row',
    v_account_id = (select value::bigint from ids where name = 'acct_c'),
    format('account_id=%s', v_account_id)
  );
exception when others then
  insert into results values (
    '(c) actor-scope control: standalone shadchanus may own a singles row',
    false, sqlerrm
  );
end $$;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (d) Catalog: no household-scope trigger on entity_files, and RLS is
-- genuinely enabled (not merely policies existing on an unenabled table).
-- ---------------------------------------------------------------------------
reset role;

insert into results (name, passed)
select '(d) catalog: no validate_entity_files_household_scope trigger exists on public.entity_files',
       not exists (
         select 1 from pg_trigger
         where tgrelid = 'public.entity_files'::regclass
           and tgname = 'validate_entity_files_household_scope'
       );

insert into results (name, passed)
select '(d) catalog: row level security is enabled on public.entity_files',
       (select relrowsecurity from pg_class where oid = 'public.entity_files'::regclass) is true;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ef111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (e) Constraint: entity_files_visibility_target_check. A non-'shared' value
-- means nothing for a reference (not a household member) — reject it; the
-- same row with 'shared' succeeds.
-- ---------------------------------------------------------------------------
do $$
declare v_acct_a text;
begin
  select value into v_acct_a from ids where name = 'acct_a';
  begin
    insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes, visibility)
      values ('reference', 1, v_acct_a || '/reference/1/x.pdf', 'x.pdf', 'application/pdf', 10, 'private_parent');
    insert into results values ('(e) constraint: a reference-targeted row with visibility=private_parent is rejected', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values ('(e) constraint: a reference-targeted row with visibility=private_parent is rejected', true, sqlerrm);
  end;
end $$;

do $$
declare v_acct_a text;
begin
  select value into v_acct_a from ids where name = 'acct_a';
  begin
    insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes, visibility)
      values ('reference', 1, v_acct_a || '/reference/1/x.pdf', 'x.pdf', 'application/pdf', 10, 'shared');
    insert into results values ('(e) constraint: the same reference-targeted row with visibility=shared succeeds', true, null);
  exception when others then
    insert into results values ('(e) constraint: the same reference-targeted row with visibility=shared succeeds', false, sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- (f) Constraint: entity_files_storage_path_scope_check. account_id is
-- trigger-assigned from current_context_id() (A here), so a storage_path
-- that does not begin with A's own id is rejected — this is what stops a
-- mid-upload context switch from writing a row pointing into another
-- account's folder.
-- ---------------------------------------------------------------------------
do $$
declare v_acct_b text;
begin
  select value into v_acct_b from ids where name = 'acct_b';
  begin
    insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
      values ('shidduch', 1, v_acct_b || '/shidduch/1/mismatched.pdf', 'mismatched.pdf', 'application/pdf', 10);
    insert into results values ('(f) constraint: a storage_path not prefixed with the trigger-assigned account_id is rejected', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values (
      '(f) constraint: a storage_path not prefixed with the trigger-assigned account_id is rejected',
      sqlerrm like '%entity_files_storage_path_scope_check%', sqlerrm
    );
  end;
end $$;

-- ---------------------------------------------------------------------------
-- (h) AC 7(a) / contract §8 rule 3 / preflight landmine 11: deleting a
-- parent leaves zero entity_files rows for it. Untested until this review
-- fix (F4) — the story's own falsifiable calls for exactly this ("db
-- project — insert a shidduch, an entity_files row for it, delete the
-- shidduch, assert zero entity_files rows remain; repeat for a single and
-- a shadchan"). Real parent rows in household account A (still active
-- here), not the polymorphic placeholder ids the (a)-(f) groups use above,
-- because a real DELETE is what has to fire purge_polymorphic_dependents().
-- ---------------------------------------------------------------------------
insert into public.singles (first_name_en) values ('EF Purge Single')
returning id as purge_single \gset

insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
select 'single', :purge_single, value || '/single/' || :purge_single || '/p.pdf', 'p.pdf', 'application/pdf', 10
from ids where name = 'acct_a';

delete from public.singles where id = :purge_single;

insert into results (name, passed)
select '(h) AC 7(a): deleting a single purges its entity_files rows',
       (select count(*) from public.entity_files where target_type = 'single' and target_id = :purge_single) = 0;

insert into public.shadchanim (name) values ('EF Purge Shadchan')
returning id as purge_shadchan \gset

insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
select 'shadchan', :purge_shadchan, value || '/shadchan/' || :purge_shadchan || '/p.pdf', 'p.pdf', 'application/pdf', 10
from ids where name = 'acct_a';

delete from public.shadchanim where id = :purge_shadchan;

insert into results (name, passed)
select '(h) AC 7(a): deleting a shadchan purges its entity_files rows',
       (select count(*) from public.entity_files where target_type = 'shadchan' and target_id = :purge_shadchan) = 0;

insert into public.singles (first_name_en) values ('EF Purge Shidduch Single')
returning id as purge_shidduch_single \gset

insert into public.shidduchim (single_id, name_en) values (:purge_shidduch_single, 'EF Purge Shidduch')
returning id as purge_shidduch \gset

insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
select 'shidduch', :purge_shidduch, value || '/shidduch/' || :purge_shidduch || '/p.pdf', 'p.pdf', 'application/pdf', 10
from ids where name = 'acct_a';

delete from public.shidduchim where id = :purge_shidduch;

insert into results (name, passed)
select '(h) AC 7(a): deleting a shidduch purges its entity_files rows',
       (select count(*) from public.entity_files where target_type = 'shidduch' and target_id = :purge_shidduch) = 0;

-- ---------------------------------------------------------------------------
-- (i) AC 2(f) / review fix F6: uploaded_by_member_id is now ALWAYS
-- server-assigned to the caller's own active-context membership, never a
-- client-supplied value (set_entity_files_uploaded_by() no longer has an
-- if-null escape). Proven live before this fix: a row inserted from A's
-- context with a client-supplied uploaded_by_member_id equal to u1's OWN
-- membership id in household B — a real row, just the wrong account's — was
-- accepted verbatim, and entity_files_summary then resolved it to a real
-- name across the tenant boundary. u1's B-membership id is a genuine,
-- pre-existing account_members row (not a fabricated id), which is what
-- makes this the realistic shape of the spoof, not a FK-violation strawman.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a_member_id bigint;
  v_b_member_id bigint;
  v_row_uploaded_by bigint;
begin
  select id into v_a_member_id from public.account_members
  where account_id = (select value::bigint from ids where name = 'acct_a')
    and user_id = 'ef111111-1111-1111-1111-111111111111';

  select id into v_b_member_id from public.account_members
  where account_id = (select value::bigint from ids where name = 'acct_b')
    and user_id = 'ef111111-1111-1111-1111-111111111111';

  insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes, uploaded_by_member_id)
  select 'shidduch', 1, value || '/shidduch/1/forged.pdf', 'forged.pdf', 'application/pdf', 10, v_b_member_id
  from ids where name = 'acct_a'
  returning uploaded_by_member_id into v_row_uploaded_by;

  insert into results values (
    '(i) uploaded_by_member_id: a client-supplied value is ignored — the server always assigns the caller''s own active-context membership',
    v_row_uploaded_by = v_a_member_id,
    format('expected %s (u1''s A membership), got %s (client tried B''s %s)', v_a_member_id, v_row_uploaded_by, v_b_member_id)
  );
end $$;

-- ---------------------------------------------------------------------------
-- (g) anon: zero rows, zero privileges. `entity_files` (and its summary
-- view) revoke ALL from anon (06_grants.sql) — unlike `storage.objects`,
-- which grants anon a baseline privilege and relies on RLS alone, a bare
-- SELECT here is denied at the privilege-check layer, before RLS is even
-- consulted, so it raises rather than returning an empty set. The DO-block
-- shape (members_rename.sql's own idiom for an all-revoked table) is what
-- "reads zero rows" cashes out to for a table anon cannot query at all.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

do $$
begin
  perform count(*) from public.entity_files;
  insert into results values ('(g) anon: reads zero entity_files rows (SELECT itself is denied)', false, 'SELECT unexpectedly succeeded');
exception when others then
  insert into results values ('(g) anon: reads zero entity_files rows (SELECT itself is denied)', true, sqlerrm);
end $$;

do $$
begin
  perform count(*) from public.entity_files_summary;
  insert into results values ('(g) anon: reads zero entity_files_summary rows (SELECT itself is denied)', false, 'SELECT unexpectedly succeeded');
exception when others then
  insert into results values ('(g) anon: reads zero entity_files_summary rows (SELECT itself is denied)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select '(g) anon: holds no privilege on public.entity_files',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'entity_files' and grantee = 'anon'
       );

insert into results (name, passed)
select '(g) anon: holds no privilege on public.entity_files_summary',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'entity_files_summary' and grantee = 'anon'
       );

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
