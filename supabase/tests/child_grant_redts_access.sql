--
-- Standing guard: consuming an ACCEPTED child grant to read `public.redts`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. This is RLS increment 7 of the child_grants plan (Epic 14):
-- a grantee household that has accepted a grant for a proposer's single may
-- SELECT that single's redts rows through the policy "Redts readable via
-- accepted grant" (05_policies.sql). Unlike increment 6 (shidduch_education),
-- this table carries NO visibility/pipeline_state columns and NO existing
-- single-facing narrowing to mirror — a redt is candid parent/shadchan
-- commentary that a single never sees, so nothing needs to be deliberately
-- NOT-copied here; the grant policy needs only the clean single-hop join
-- redts.shidduchim_id -> shidduchim.single_id -> accepted child_grants.
--
-- THE SHADCHAN_ID ASSERTION is (c) below and is this increment's point: the
-- grant policy returns `shadchan_id` AS-IS (not nulled/hidden). A fixture
-- with a real, non-null shadchan_id is required so "returns as-is" is
-- distinguishable from "silently nulled" — a NULL shadchan_id in the source
-- would make the assertion vacuous.
--
-- The `status = 'accepted'` conjunct is LITERAL: sever_child_grant()
-- (02_functions.sql) sets status = 'severed' but never NULLs
-- grantee_account_id, so keying on the id column alone would leak. The grant
-- is driven pending -> accepted so the proof is a real lifecycle, and the
-- non-accepted fixture carries a POPULATED grantee_account_id.
--
-- (d) pins the read-only-structural boundary mirrored on every prior
-- increment: the grant opens read for the grantee HOUSEHOLD's owning members,
-- not for that household's own single-persona members.
--
-- Story 13.x (access tiers) adds (e)-(i): UPDATE permission via the new
-- "Redts updatable via accepted edit grant" policy — same shape as the
-- shidduch_education mirror (child_grant_shidduch_education_access.sql):
--   (e) a READ-tier accepted grantee (the same grant driven above, default
--       access_level = 'read') cannot UPDATE — 0 rows, silent USING filter.
--   (f) a COMMENT-tier accepted grantee cannot UPDATE either.
--   (g) an EDIT-tier accepted grantee (parent_admin) CAN UPDATE, and the
--       written value persists.
--   (h) a HELPER-role member of the SAME edit-tier grantee account cannot.
--   (i) the account_id-repointing attack (`UPDATE ... SET account_id =
--       <their own account>`) is denied by `with check`'s second conjunct —
--       wrapped in an exception handler since a `with check` failure on a
--       row that already passed `using` makes Postgres RAISE, not silently
--       filter (the "Single listings update" F1 precedent, 05_policies.sql).
--
-- The runner is child_grant_redts_access.test.ts.
--

create temporary table results (
  name text,
  passed boolean,
  detail text
) on commit drop;
grant all on results to public;

create temporary table ids (k text primary key, v bigint) on commit drop;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: a proposing household (A) that grants its single to a receiving
-- household (B), plus an unrelated household (C) and a single-role member
-- inside B (to pin the read-only-structural boundary in (d)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-stranger@test.local'),
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-grantee-single@test.local'),
  ('1eeee555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-grantee-comment@test.local'),
  ('1fffff66-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-grantee-edit@test.local'),
  ('1a777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgrt-grantee-edit-helper@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGRT Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGRT Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGRT Stranger') returning id as acct_c \gset
-- (e)-(i): dedicated households for the two OTHER access tiers, same
-- reasoning as the shidduch_education mirror.
insert into public.accounts (name) values ('CGRT Grantee Comment') returning id as acct_d \gset
insert into public.accounts (name) values ('CGRT Grantee Edit') returning id as acct_e \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '1a111111-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, '1bbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, '1ccccc33-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_b, '1dddd444-4444-4444-4444-444444444444', 'single'),
  (:acct_d, '1eeee555-5555-5555-5555-555555555555', 'parent_admin'),
  (:acct_e, '1fffff66-6666-6666-6666-666666666666', 'parent_admin'),
  (:acct_e, '1a777777-7777-7777-7777-777777777777', 'helper');

insert into public.member_state (user_id, active_account_id) values
  ('1a111111-1111-1111-1111-111111111111', :acct_a),
  ('1bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('1ccccc33-3333-3333-3333-333333333333', :acct_c),
  ('1dddd444-4444-4444-4444-444444444444', :acct_b),
  ('1eeee555-5555-5555-5555-555555555555', :acct_d),
  ('1fffff66-6666-6666-6666-666666666666', :acct_e),
  ('1a777777-7777-7777-7777-777777777777', :acct_e)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into ids values ('acct_a', :acct_a);
insert into ids values ('acct_d', :acct_d);
insert into ids values ('acct_e', :acct_e);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset

insert into ids values ('single_a', :single_a);

-- A shadchan attached to the proposer household, so (c) can SET a real,
-- non-null shadchan_id on the redt. The exact shadchan identity is
-- immaterial; what matters is that the redt carries a NON-NULL shadchan_id
-- and that an accepted grantee reads that same value back.
insert into public.shadchanim (account_id, name)
values (:acct_a, 'Granted Test Shadchan') returning id as shadchan_x \gset

insert into ids values ('shadchan_x', :shadchan_x);

-- The proposer's shidduch row for the granted single.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state)
values
  (:acct_a, :single_a, 'Granted Shidduch', 'shared', 'look_into')
returning id as shidduch_a \gset

insert into ids values ('shidduch_a', :shidduch_a);

-- The target redt row, with a NON-NULL shadchan_id so (c) is non-vacuous:
-- "returns as-is" must be provable against a value that could otherwise be
-- confused with a silent-null.
insert into public.redts (account_id, shidduchim_id, shadchan_id, note)
values (:acct_a, :shidduch_a, :shadchan_x, 'Granted redt note')
returning id as redt_a \gset

insert into ids values ('redt_a', :redt_a);

-- One grant, driven through its true lifecycle in this test. grantee_account_id
-- stays POPULATED from the first insert onward — the leak-prone shape the
-- status='accepted' conjunct exists to close — so no assertion ever depends on
-- the id column accidentally being null.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgrt-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- Two more grants for the SAME target single, already 'accepted' from
-- insert: one comment-tier (acct_d), one edit-tier (acct_e). Used by (e)-(i)
-- below.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgrt-test-hash-comment', 'accepted', now() + interval '30 days', :acct_d, now(), 'comment')
returning id as grant_row_comment \gset

insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgrt-test-hash-edit', 'accepted', now() + interval '30 days', :acct_e, now(), 'edit')
returning id as grant_row_edit \gset

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) cannot select the
-- target single's redt row — by id, or in a list scan over the shidduch.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot read the target redt by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.redts
where id = (select v from ids where k = 'redt_a');

insert into results (name, passed, detail)
select 'stranger sees zero redts rows for the target shidduch in a list scan',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.redts
where shidduchim_id = (select v from ids where k = 'shidduch_a');

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so a pending status must
-- still return zero.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the target single while the grant is pending (status not accepted)',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.redts
where shidduchim_id = (select v from ids where k = 'shidduch_a');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (b) positive, (c) the shadchan_id
-- passthrough, and (d) the single-role boundary can be exercised against a
-- LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (b) POSITIVE: the accepted grantee (parent_admin, the owning role) sees the
-- target redt by id and in a list scan over the granted single's shidduch.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the target redt by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.redts
where id = (select v from ids where k = 'redt_a');

insert into results (name, passed, detail)
select 'accepted grantee sees the target redt for the granted single in a list scan',
       count(*) = 1,
       format('rows = %s (expected exactly the one granted redt)', count(*))
from public.redts
where shidduchim_id = (select v from ids where k = 'shidduch_a');

-- ---------------------------------------------------------------------------
-- (c) THE SHADCHAN_ID ASSERTION: the SAME accepted grantee, reading that redt
-- row, gets back the REAL, non-null shadchan_id set in the arrange phase. This
-- proves the column passes through the grant policy unmodified (not NULL, not
-- hidden). A null shadchan_id in the source data would make "returns as-is"
-- indistinguishable from "silently nulled" — it is populated here precisely to
-- force the distinction.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee reads the real, non-null shadchan_id through the grant',
       count(*) = 1,
       format('rows = %s (expected one row carrying the real non-null shadchan_id)', count(*))
from public.redts
where id = (select v from ids where k = 'redt_a')
  and shadchan_id is not null
  and shadchan_id = (select v from ids where k = 'shadchan_x');

-- ---------------------------------------------------------------------------
-- (d) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero redts rows for the granted single — the grant opens read for
-- the household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household still sees zero by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.redts
where id = (select v from ids where k = 'redt_a');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees no granted redt in a list',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.redts
where shidduchim_id = (select v from ids where k = 'shidduch_a');

reset role;

-- ---------------------------------------------------------------------------
-- (e) NEGATIVE: the READ-tier accepted grantee (grant_row, default
-- access_level = 'read') cannot UPDATE — 0 rows, silent USING filter.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.redts
  set note = 'read-tier grantee attempted edit'
  where id = (select v from ids where k = 'redt_a');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(e) a READ-tier accepted grantee cannot UPDATE redts -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (f) NEGATIVE: the COMMENT-tier accepted grantee cannot UPDATE either.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1eeee555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.redts
  set note = 'comment-tier grantee attempted edit'
  where id = (select v from ids where k = 'redt_a');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(f) a COMMENT-tier accepted grantee cannot UPDATE redts -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (g) POSITIVE: the EDIT-tier accepted grantee (parent_admin) CAN UPDATE, and
-- the written value persists. Deliberately does NOT touch account_id in the
-- SET list — see the shidduch_education mirror's identical comment on why
-- (enforce_household_scope()'s column-specific BEFORE trigger).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1fffff66-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.redts
  set note = 'edit-tier grantee edit'
  where id = (select v from ids where k = 'redt_a');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(g) an EDIT-tier accepted grantee CAN UPDATE redts -> 1 row',
    v_rows = 1,
    format('rows = %s (expected 1)', v_rows)
  );
end $$;

insert into results (name, passed, detail)
select '(g) the written value persists and is readable back by the same edit-tier grantee',
       count(*) = 1,
       format('rows = %s (expected 1 row with the new note)', count(*))
from public.redts
where id = (select v from ids where k = 'redt_a')
  and note = 'edit-tier grantee edit';

reset role;

insert into results (name, passed, detail)
select '(g) the row''s account_id is still the PROPOSER''s account after a legitimate field-only edit',
       account_id = (select v from ids where k = 'acct_a'),
       format('account_id = %s (expected acct_a = %s)', account_id, (select v from ids where k = 'acct_a'))
from public.redts
where id = (select v from ids where k = 'redt_a');

-- ---------------------------------------------------------------------------
-- (h) NEGATIVE: a HELPER-role member of the SAME edit-tier grantee account
-- cannot UPDATE — the edit tier's role gate is tighter than every other
-- grant-consuming policy in this file.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a777777-7777-7777-7777-777777777777","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.redts
  set note = 'helper attempted edit'
  where id = (select v from ids where k = 'redt_a');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(h) a HELPER member of an edit-tier grantee account cannot UPDATE redts -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (i) ATTACK: the edit-tier grantee's OLD row passes `using`, so `UPDATE ...
-- SET account_id = <their own account>` reaches `with check` — and its
-- second conjunct denies it. Wrapped in an exception handler (see the
-- shidduch_education mirror's identical comment for why a `with check`
-- failure raises rather than silently filtering).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1fffff66-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.redts
  set account_id = (select v from ids where k = 'acct_e')
  where id = (select v from ids where k = 'redt_a');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(i) the account_id-repointing attack does not silently succeed (0 rows, no error)',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
exception when others then
  insert into results (name, passed, detail)
  values (
    '(i) the account_id-repointing attack does not silently succeed (0 rows, no error)',
    true,
    format('UPDATE raised as expected (with check denied the NEW row): %s', sqlerrm)
  );
end $$;

reset role;

insert into results (name, passed, detail)
select '(i) the row''s account_id is still the PROPOSER''s account after the attack attempt',
       account_id = (select v from ids where k = 'acct_a'),
       format('account_id = %s (expected acct_a = %s, NOT the attacker''s acct_e = %s)',
              account_id, (select v from ids where k = 'acct_a'), (select v from ids where k = 'acct_e'))
from public.redts
where id = (select v from ids where k = 'redt_a');

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;