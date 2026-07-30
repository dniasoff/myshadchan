--
-- Documents bucket + add_resume_file (Story 5.3) — database test suite.
--
-- AC 4's falsifiable claims about the new `documents` bucket: a second
-- seeded account can neither `select` nor `delete` under the first
-- account's `resumes/` prefix (a), and a path written under a NON-`resumes/`
-- prefix stays deny-by-default — unreadable even by its own account's
-- member — because no policy defines it yet (b; Story 5.4 defines
-- `photos/` next). The table-wide "no UPDATE policy on storage.objects"
-- invariant is already asserted by context_rls_hardening.sql and is not
-- re-tested here — adding a documents-scoped duplicate would just be a
-- second way for the same fact to go stale.
--
-- AC 2's falsifiable claim about `add_resume_file`: two calls append two
-- entries (never one overwriting the other), and the first entry's `path`
-- and `uploaded_at` are byte-identical after the second call — nothing
-- mutates or removes an existing array element (c/d). (e) is the same
-- account-ownership guard `add_redt`/`add_school` already carry, proven
-- here for the new function.
--
-- One login `u1` holds a `parent_admin` membership of household account A
-- and a `parent_admin` membership of household account B (active in A) —
-- the same shape context_rls_hardening.sql / entity_files.sql use, and for
-- the same reason: two disjoint users would pass without ever exercising
-- current_context_id()'s active-context resolution (AD-19).
--
-- Every check appends one row to `results`; the script emits them as JSON
-- at the end and rolls back, so it leaves nothing behind. The runner
-- (documents_storage.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any
-- id a DO block below needs is shared through the `ids` temp table rather
-- than \gset (established by context_resolution.sql / context_rls_hardening.sql
-- / household_scope_lift.sql / entity_files.sql).
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
-- Arrange: one login, two household accounts.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('df111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'df-u1@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('DF Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('DF Household B', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

-- activate_first_context_trigger activates A (u1's first live membership);
-- adding B afterward leaves A active (AC-5, context_resolution.sql).
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'df111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'df111111-1111-1111-1111-111111111111', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"df111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: u1''s active context is household A right after both memberships exist',
       public.current_context_id() = (select value::bigint from ids where name = 'acct_a');

-- One `documents` object under A's `resumes/` prefix, created while A is
-- active (mirrors the app: object key derived from current_context_id()).
insert into storage.objects (bucket_id, name, owner)
select 'documents', value || '/resumes/1/a.pdf', 'df111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_a \gset

insert into ids values ('obj_a', :'obj_a');
insert into ids values ('path_a', (select value || '/resumes/1/a.pdf' from ids where name = 'acct_a'));

-- Switch to B: one `documents` object under B's `resumes/` prefix, created
-- while B is active.
select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

insert into storage.objects (bucket_id, name, owner)
select 'documents', value || '/resumes/2/b.pdf', 'df111111-1111-1111-1111-111111111111'
from ids where name = 'acct_b'
returning id as obj_b \gset

insert into ids values ('obj_b', :'obj_b');
insert into ids values ('path_b', (select value || '/resumes/2/b.pdf' from ids where name = 'acct_b'));

-- Back to A for the (a)/(b) checks below.
select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (a) Cross-account: active in A.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(a) storage: u1 reads its own object under A''s resumes/ prefix (1 row)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

insert into results (name, passed)
select '(a) storage: u1 reads zero rows for B''s resumes/ object while active in A',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

do $$
declare v_path_b text;
begin
  select value into v_path_b from ids where name = 'path_b';
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('documents', v_path_b || '-evil.pdf', 'df111111-1111-1111-1111-111111111111');
    insert into results values ('(a) storage: an INSERT under B''s resumes/ prefix raises while active in A', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values ('(a) storage: an INSERT under B''s resumes/ prefix raises while active in A', true, sqlerrm);
  end;
end $$;

-- DELETE of B's object, with storage.allow_delete_query set so the
-- statement-level guard is not what denies it — an RLS denial, not a
-- locked door with no key (mirrors context_rls_hardening.sql's own dance).
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

reset role;
insert into results (name, passed)
select '(a) storage: u1''s DELETE attempt on B''s resumes/ object left it intact (RLS denial, not the statement guard)',
       count(*) = 1
from storage.objects where id = (select value::uuid from ids where name = 'obj_b');

-- Positive control: u1 deleting its OWN (A's) object succeeds — proves the
-- denial above is RLS and not a broken delete path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"df111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

reset role;
insert into results (name, passed)
select '(a) storage: u1 deleting its own A resumes/ object succeeds (positive control)',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"df111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (b) Deny-by-default for a non-`resumes/` prefix (AC 4's own falsifiable:
-- "an object written under a non-resumes/ prefix of documents is readable
-- by anyone"). Inserted as postgres (bypassing storage RLS, the way a
-- service-role write from Story 5.4's not-yet-built `photos/` feature
-- would) under A's OWN account prefix — even so, the account's own member
-- reads zero rows, because no policy names any prefix but `resumes/` yet.
-- ---------------------------------------------------------------------------
reset role;

insert into storage.objects (bucket_id, name, owner)
select 'documents', value || '/photos/1/p.jpg', 'df111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_photo \gset

insert into ids values ('obj_photo', :'obj_photo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"df111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select '(b) storage: a documents object under a non-resumes/ prefix is unreadable, even by its own account''s member (deny-by-default)',
       count(*) = 0
from storage.objects where id = (select value::uuid from ids where name = 'obj_photo');

-- ---------------------------------------------------------------------------
-- (c)/(d) add_resume_file: append-only (AC 2). Still active in A.
-- ---------------------------------------------------------------------------
insert into public.singles (first_name_en) values ('DF Resume Single')
returning id as single_id \gset

insert into public.shidduchim (single_id, name_en) values (:single_id, 'DF Resume Shidduch')
returning id as shidduch_id \gset

insert into ids values ('single_id', :'single_id'), ('shidduch_id', :'shidduch_id');

select public.add_resume_file(
  :shidduch_id,
  :'acct_a' || '/resumes/' || :'shidduch_id' || '/v1-resume.pdf',
  'resume-v1.pdf',
  'application/pdf',
  1000
);

insert into results (name, passed)
select '(c) add_resume_file: the first upload creates a resumes row with exactly one file entry',
       (select jsonb_array_length(files) from public.resumes where shidduchim_id = :shidduch_id) = 1;

insert into results (name, passed)
select '(c) add_resume_file: the first entry''s filename matches what was uploaded',
       (select files->0->>'filename' from public.resumes where shidduchim_id = :shidduch_id) = 'resume-v1.pdf';

insert into ids values (
  'v1_uploaded_at',
  (select files->0->>'uploaded_at' from public.resumes where shidduchim_id = :shidduch_id)
);
insert into ids values (
  'v1_path',
  (select files->0->>'path' from public.resumes where shidduchim_id = :shidduch_id)
);

select public.add_resume_file(
  :shidduch_id,
  :'acct_a' || '/resumes/' || :'shidduch_id' || '/v2-resume.pdf',
  'resume-v2.pdf',
  'application/pdf',
  2000
);

insert into results (name, passed)
select '(d) add_resume_file: a second upload appends — jsonb_array_length(files) is 2, not 1 (AC 2''s own falsifiable)',
       (select jsonb_array_length(files) from public.resumes where shidduchim_id = :shidduch_id) = 2;

insert into results (name, passed)
select '(d) add_resume_file: the first entry''s path is byte-identical after the second upload (no existing version mutated)',
       (select files->0->>'path' from public.resumes where shidduchim_id = :shidduch_id)
         = (select value from ids where name = 'v1_path');

insert into results (name, passed)
select '(d) add_resume_file: the first entry''s uploaded_at is byte-identical after the second upload',
       (select files->0->>'uploaded_at' from public.resumes where shidduchim_id = :shidduch_id)
         = (select value from ids where name = 'v1_uploaded_at');

insert into results (name, passed)
select '(d) add_resume_file: the newest entry carries the second upload''s filename',
       (select files->1->>'filename' from public.resumes where shidduchim_id = :shidduch_id) = 'resume-v2.pdf';

-- ---------------------------------------------------------------------------
-- (e) add_resume_file: account-ownership guard, same shape add_redt /
-- add_school already carry. Switch active to B; A's shidduch must not be
-- reachable.
-- ---------------------------------------------------------------------------
select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

do $$
declare v_shidduch_id bigint;
begin
  select value::bigint into v_shidduch_id from ids where name = 'shidduch_id';
  perform public.add_resume_file(v_shidduch_id, 'evil/resumes/evil/evil.pdf', 'evil.pdf', 'application/pdf', 1);
  insert into results values ('(e) add_resume_file: cannot attach a file to a foreign account''s shidduch', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(e) add_resume_file: cannot attach a file to a foreign account''s shidduch',
    sqlerrm like '%not found in current account%', sqlerrm
  );
end $$;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
