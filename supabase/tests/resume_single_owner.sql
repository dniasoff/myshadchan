--
-- Single-owned resumes (Story 5.8, AC 2) — database test suite.
--
-- Story 5.3 shaped `resumes` as 1:1 with a shidduch only. Story 5.8 widens
-- it to ALSO be 1:1 with a single — "the resume I send out to shadchanim,"
-- attached to the single directly rather than through any one suggested
-- match. This suite is the AC-2 falsifiable: `resumes_owner_check` rejects
-- a row with both `shidduchim_id`/`single_id` set or neither, and the old
-- single, whole-table `resumes_shidduchim_id_key unique (shidduchim_id)`
-- becomes two PARTIAL unique indexes — one per owner column — so at most
-- one resume per shidduch AND at most one resume per single, independently.
--
-- `add_resume_file()`/`add_resume_photo()` are exercised through their
-- widened signatures (Task 4): `p_single_id` as an alternative to
-- `p_shidduchim_id`, both defaulted, moved after the always-required
-- parameters — every call below uses named notation so it is immune to any
-- future reorder (documents_storage.sql / resume_photos.sql do the same).
--
-- Two household accounts (A, B) and one login (u1, active in A) — the
-- account-ownership guard (e) needs a second account to prove a single's
-- resume cannot be minted from outside its own account, and RLS itself is
-- already the subject of documents_storage.sql / resume_photos.sql, so this
-- suite does not re-derive it with a second role.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (resume_single_owner.test.ts) turns each row into a named assertion.
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
values
  ('e8111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rso-admin@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('RSO Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('RSO Household B (foreign)', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e8111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'e8111111-1111-1111-1111-111111111111', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e8111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.singles (first_name_en) values ('RSO Single Person')
returning id as single_id \gset

insert into public.shidduchim (single_id, name_en) values (:single_id, 'RSO Shidduch')
returning id as shidduch_id \gset

insert into public.singles (first_name_en) values ('RSO Second Single')
returning id as single_id_2 \gset

insert into ids values
  ('single_id', :'single_id'),
  ('shidduch_id', :'shidduch_id'),
  ('single_id_2', :'single_id_2');

-- ---------------------------------------------------------------------------
-- (a) resumes_owner_check: both columns set is rejected.
-- ---------------------------------------------------------------------------
do $$
declare
  v_acct bigint;
  v_shidduch bigint;
  v_single bigint;
begin
  select value::bigint into v_acct from ids where name = 'acct_a';
  select value::bigint into v_shidduch from ids where name = 'shidduch_id';
  select value::bigint into v_single from ids where name = 'single_id';
  insert into public.resumes (account_id, shidduchim_id, single_id)
  values (v_acct, v_shidduch, v_single);
  insert into results values ('(a) resumes_owner_check: rejects a row with BOTH shidduchim_id and single_id set', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(a) resumes_owner_check: rejects a row with BOTH shidduchim_id and single_id set',
    sqlerrm like '%resumes_owner_check%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (b) resumes_owner_check: neither column set is rejected.
-- ---------------------------------------------------------------------------
do $$
declare v_acct bigint;
begin
  select value::bigint into v_acct from ids where name = 'acct_a';
  insert into public.resumes (account_id) values (v_acct);
  insert into results values ('(b) resumes_owner_check: rejects a row with NEITHER shidduchim_id nor single_id set', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(b) resumes_owner_check: rejects a row with NEITHER shidduchim_id nor single_id set',
    sqlerrm like '%resumes_owner_check%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (c) add_resume_file(p_single_id => …): creates a single-owned resumes row.
-- ---------------------------------------------------------------------------
select public.add_resume_file(
  p_single_id => :single_id,
  p_path => :'acct_a' || '/resumes/single-' || :'single_id' || '/v1-resume.pdf',
  p_filename => 'single-resume-v1.pdf',
  p_mime_type => 'application/pdf',
  p_size => 1000
);

insert into results (name, passed)
select '(c) add_resume_file(p_single_id): creates exactly one resumes row for the single',
       (select count(*) from public.resumes where single_id = :single_id) = 1;

insert into results (name, passed)
select '(c) add_resume_file(p_single_id): the row''s shidduchim_id is null',
       (select shidduchim_id is null from public.resumes where single_id = :single_id);

insert into results (name, passed)
select '(c) add_resume_file(p_single_id): the first entry''s filename matches what was uploaded',
       (select files->0->>'filename' from public.resumes where single_id = :single_id) = 'single-resume-v1.pdf';

-- ---------------------------------------------------------------------------
-- (d) add_resume_file(p_single_id => …) a second time: appends, does not
-- create a second resumes row (same append-only contract as the shidduch
-- side, documents_storage.sql AC 2).
-- ---------------------------------------------------------------------------
select public.add_resume_file(
  p_single_id => :single_id,
  p_path => :'acct_a' || '/resumes/single-' || :'single_id' || '/v2-resume.pdf',
  p_filename => 'single-resume-v2.pdf',
  p_mime_type => 'application/pdf',
  p_size => 2000
);

insert into results (name, passed)
select '(d) add_resume_file(p_single_id): a second upload appends — jsonb_array_length(files) is 2, not 1',
       (select jsonb_array_length(files) from public.resumes where single_id = :single_id) = 2;

insert into results (name, passed)
select '(d) add_resume_file(p_single_id): still exactly one resumes row for the single, not two',
       (select count(*) from public.resumes where single_id = :single_id) = 1;

-- ---------------------------------------------------------------------------
-- (e) add_resume_file: exactly-one-of guard at the RPC layer (mirrors the
-- table's own resumes_owner_check, but this is the function's own explicit
-- raise, reachable before any INSERT is attempted).
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.add_resume_file(
    p_path => 'x/y.pdf', p_filename => 'y.pdf', p_mime_type => 'application/pdf', p_size => 1
  );
  insert into results values ('(e) add_resume_file: rejects a call with NEITHER p_shidduchim_id nor p_single_id', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(e) add_resume_file: rejects a call with NEITHER p_shidduchim_id nor p_single_id',
    sqlerrm like '%exactly one of p_shidduchim_id/p_single_id%', sqlerrm
  );
end $$;

do $$
begin
  perform public.add_resume_file(
    p_shidduchim_id => (select value::bigint from ids where name = 'shidduch_id'),
    p_single_id => (select value::bigint from ids where name = 'single_id'),
    p_path => 'x/y.pdf', p_filename => 'y.pdf', p_mime_type => 'application/pdf', p_size => 1
  );
  insert into results values ('(e) add_resume_file: rejects a call with BOTH p_shidduchim_id and p_single_id', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(e) add_resume_file: rejects a call with BOTH p_shidduchim_id and p_single_id',
    sqlerrm like '%exactly one of p_shidduchim_id/p_single_id%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (f) add_resume_file: the account-ownership guard, same shape as the
-- shidduch side (documents_storage.sql (e)). Switch active to B; A's single
-- must not be reachable.
-- ---------------------------------------------------------------------------
select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

do $$
declare v_single_id bigint;
begin
  select value::bigint into v_single_id from ids where name = 'single_id';
  perform public.add_resume_file(
    p_single_id => v_single_id,
    p_path => 'evil/resumes/evil/evil.pdf', p_filename => 'evil.pdf', p_mime_type => 'application/pdf', p_size => 1
  );
  insert into results values ('(f) add_resume_file: cannot attach a file to a foreign account''s single', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(f) add_resume_file: cannot attach a file to a foreign account''s single',
    sqlerrm like '%not found in current account%', sqlerrm
  );
end $$;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (g) add_resume_photo(p_single_id => …): upserts the SAME single-owned
-- resumes row add_resume_file created above (mirrors add_resume_photo's own
-- upsert-the-parent-row contract, resume_photos.sql (f)), then inserts a
-- resume_photos row.
-- ---------------------------------------------------------------------------
select public.add_resume_photo(
  p_single_id => :single_id,
  p_path => :'acct_a' || '/photos/shared/single-' || :'single_id' || '/p1.jpg',
  p_visibility => 'shared'
);

insert into results (name, passed)
select '(g) add_resume_photo(p_single_id): upserts — still exactly one resumes row for the single, not two',
       (select count(*) from public.resumes where single_id = :single_id) = 1;

insert into results (name, passed)
select '(g) add_resume_photo(p_single_id): creates one resume_photos row against that resume',
       (select count(*) from public.resume_photos rp
          join public.resumes r on r.id = rp.resume_id
        where r.single_id = :single_id) = 1;

-- ---------------------------------------------------------------------------
-- (h) resumes_single_id_key (partial unique index): a second, DIRECT insert
-- for the SAME single is rejected — a single gets at most one resumes row,
-- exactly like a shidduch (documents_storage.sql relies on
-- resumes_shidduchim_id_key for the same property on the other side).
-- ---------------------------------------------------------------------------
do $$
declare v_acct bigint;
begin
  select value::bigint into v_acct from ids where name = 'acct_a';
  insert into public.resumes (account_id, single_id) values (v_acct, (select value::bigint from ids where name = 'single_id'));
  insert into results values ('(h) resumes_single_id_key: rejects a second resumes row for the same single', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(h) resumes_single_id_key: rejects a second resumes row for the same single',
    sqlerrm like '%resumes_single_id_key%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (i) resumes_single_id_key is PARTIAL: a second single may still get its
-- own, independent resumes row — the index must not collapse every
-- single_id-having row into one slot.
-- ---------------------------------------------------------------------------
insert into public.resumes (account_id, single_id)
values ((select value::bigint from ids where name = 'acct_a'), (select value::bigint from ids where name = 'single_id_2'));

insert into results (name, passed)
select '(i) resumes_single_id_key is partial: a second, different single gets its own resumes row',
       (select count(*) from public.resumes where single_id = :single_id_2) = 1;

-- ---------------------------------------------------------------------------
-- (j) resumes_shidduchim_id_key (partial unique index) still holds — the
-- shidduch side of the story's Task 3, unaffected by widening to singles.
-- The shidduch has no resumes row yet (only p_single_id calls ran above),
-- so the first insert here is the positive control; the second, duplicate
-- insert is the negative one.
-- ---------------------------------------------------------------------------
insert into public.resumes (account_id, shidduchim_id)
values ((select value::bigint from ids where name = 'acct_a'), (select value::bigint from ids where name = 'shidduch_id'));

do $$
declare v_acct bigint;
begin
  select value::bigint into v_acct from ids where name = 'acct_a';
  insert into public.resumes (account_id, shidduchim_id) values (v_acct, (select value::bigint from ids where name = 'shidduch_id'));
  insert into results values ('(j) resumes_shidduchim_id_key: still rejects a second resumes row for the same shidduch', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(j) resumes_shidduchim_id_key: still rejects a second resumes row for the same shidduch',
    sqlerrm like '%resumes_shidduchim_id_key%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
