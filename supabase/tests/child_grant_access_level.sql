--
-- Standing guard: the 3-tier access_level ladder on child_grants — creation,
-- persistence, regrant carry-forward, preview disclosure, and the
-- update_child_grant_access RPC's proposer-only / accepted-only / value
-- guard — database suite.
--
-- WHY IT EXISTS. access_level ('read' < 'comment' < 'edit', each tier a
-- superset of the one below) is new surface stacked onto the existing grant
-- lifecycle: create_child_grant gained a third parameter, regrant_child_grant
-- now carries the severed grant's level forward instead of silently
-- resetting it to 'read', preview_child_grant discloses it to an acceptor
-- BEFORE they accept (a consent-integrity requirement, not decoration), and
-- update_child_grant_access is an entirely new RPC. The access-tier RLS
-- policies consume this column for interactions commentary and the two edit
-- tables; this suite pins the RPC layer, the CHECK constraint, and the new
-- function's grants, while the sibling suites pin those policy boundaries.
--
-- The runner is child_grant_access_level.test.ts.
--

create temporary table results (
  name text,
  passed boolean,
  detail text
) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange: a proposing household (A), a grantee household (B), and an
-- unrelated household (C) — every one a parent_admin, so every RPC's role
-- guard is satisfied by construction and each test below narrows down from
-- there (wrong account, wrong status, wrong value).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('ca0a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cga-proposer@test.local'),
  ('ca0a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cga-grantee@test.local'),
  ('ca0a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cga-stranger@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGA Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGA Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGA Stranger') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, 'ca0a0000-0000-0000-0000-000000000001', 'parent_admin'),
  (:acct_b, 'ca0a0000-0000-0000-0000-000000000002', 'parent_admin'),
  (:acct_c, 'ca0a0000-0000-0000-0000-000000000003', 'parent_admin');

insert into public.member_state (user_id, active_account_id) values
  ('ca0a0000-0000-0000-0000-000000000001', :acct_a),
  ('ca0a0000-0000-0000-0000-000000000002', :acct_b),
  ('ca0a0000-0000-0000-0000-000000000003', :acct_c)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Access', 'Level') returning id as single_a \gset

-- Section (4) below accepts 4 grants concurrently, all proposer=A,
-- grantee=B — child_grants_live_triple_idx is a unique index on
-- (proposer_account_id, target_single_id, grantee_account_id) WHERE
-- status='accepted', so those 4 need 4 DISTINCT singles or the second
-- accept_child_grant collides on the first's still-live triple.
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Update', 'Ok') returning id as single_upd_ok \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Update', 'Grantee') returning id as single_upd_grantee \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Update', 'Stranger') returning id as single_upd_stranger \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Update', 'Invalid') returning id as single_upd_invalid \gset

-- ---------------------------------------------------------------------------
-- Two `pg_temp` helpers so an expected-exception call can take a psql
-- variable as one of its arguments. `:variable` substitution happens on the
-- psql input BEFORE it reaches the server, but it does NOT reach inside a
-- dollar-quoted `do $$ ... $$` body (proven empirically — a bare `:id` inside
-- one is a literal, unsubstituted token and fails with a syntax error, not a
-- substitution). A CALL SITE is not inside dollar-quoting, so wrapping the
-- try/catch in a real function and passing the id as an ordinary argument
-- sidesteps the problem entirely. Returns SQLSTATE too, not just "did it
-- raise", so the invalid-access-level scenarios can assert the SPECIFIC
-- check_violation rather than any error at all.
-- ---------------------------------------------------------------------------
-- NOTE: the no-exception branch sets sqlstate_code/message to '' rather than
-- NULL on purpose — \gset UNSETS a psql variable entirely when a column is
-- NULL, and an unset variable used later as `:'name'` is a silent
-- mis-substitution, not a loud failure. Keeping every column always a
-- defined string means a broken/skipped check still shows up as an honest
-- "no exception was raised" / sqlstate='' assertion failure.
create or replace function pg_temp.try_create_child_grant(
  p_single_id bigint, p_email text, p_access_level text
) returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  perform public.create_child_grant(p_single_id, p_email, p_access_level);
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

create or replace function pg_temp.try_update_child_grant_access(
  p_grant_id bigint, p_access_level text
) returns table(raised boolean, sqlstate_code text, message text)
language plpgsql as $$
begin
  perform public.update_child_grant_access(p_grant_id, p_access_level);
  raised := false; sqlstate_code := ''; message := 'no exception was raised';
  return next;
exception when others then
  raised := true; sqlstate_code := sqlstate; message := sqlerrm;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- (1) create_child_grant persists each of the 3 access_level values, and
-- rejects a 4th. All four calls run as the proposer.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_child_grant(:single_a, 'grantee-read@test.local') as token_read \gset
select public.create_child_grant(:single_a, 'grantee-comment@test.local', 'comment') as token_comment \gset
select public.create_child_grant(:single_a, 'grantee-edit@test.local', 'edit') as token_edit \gset

select * from pg_temp.try_create_child_grant(:single_a, 'grantee-bad@test.local', 'delete') \gset bad_

reset role;

insert into results (name, passed, detail)
values (
  'create_child_grant rejects an invalid access_level',
  :'bad_raised'::boolean and :'bad_sqlstate_code' = '23514',
  format('raised=%s sqlstate=%s message=%s', :'bad_raised', :'bad_sqlstate_code', :'bad_message')
);

insert into results (name, passed, detail)
select 'create_child_grant with no explicit access_level defaults to read',
       count(*) = 1 and bool_and(access_level = 'read'),
       format('rows=%s access_level=%s', count(*), string_agg(access_level, ','))
from public.child_grants
where token_hash = encode(extensions.digest(:'token_read', 'sha256'), 'hex');

insert into results (name, passed, detail)
select 'create_child_grant persists access_level = comment',
       count(*) = 1 and bool_and(access_level = 'comment'),
       format('rows=%s access_level=%s', count(*), string_agg(access_level, ','))
from public.child_grants
where token_hash = encode(extensions.digest(:'token_comment', 'sha256'), 'hex');

insert into results (name, passed, detail)
select 'create_child_grant persists access_level = edit',
       count(*) = 1 and bool_and(access_level = 'edit'),
       format('rows=%s access_level=%s', count(*), string_agg(access_level, ','))
from public.child_grants
where token_hash = encode(extensions.digest(:'token_edit', 'sha256'), 'hex');

-- ---------------------------------------------------------------------------
-- (2) regrant_child_grant carries the OLD (severed) grant's access_level
-- forward — it must NOT silently reset to 'read'. Driven through the real
-- lifecycle: create ('edit') -> accept (as grantee) -> sever (as proposer)
-- -> regrant (as proposer).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_child_grant(:single_a, 'grantee-regrant@test.local', 'edit') as token_regrant \gset

reset role;

select id as grant_regrant_id
from public.child_grants
where token_hash = encode(extensions.digest(:'token_regrant', 'sha256'), 'hex') \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000002","role":"authenticated"}';

select public.accept_child_grant(:'token_regrant');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.sever_child_grant(:grant_regrant_id);
select public.regrant_child_grant(:grant_regrant_id) as token_regrant_2 \gset

reset role;

insert into results (name, passed, detail)
select 'regrant_child_grant carries the severed grant''s access_level forward (not reset to read)',
       count(*) = 1 and bool_and(access_level = 'edit') and bool_and(id <> :grant_regrant_id) and bool_and(status = 'pending'),
       format('rows=%s access_level=%s id=%s status=%s (old id was %s)',
              count(*), string_agg(access_level, ','), string_agg(id::text, ','), string_agg(status, ','), :grant_regrant_id)
from public.child_grants
where token_hash = encode(extensions.digest(:'token_regrant_2', 'sha256'), 'hex');

-- ---------------------------------------------------------------------------
-- (3) preview_child_grant discloses access_level to an acceptor BEFORE they
-- accept — a consent-integrity requirement, not decoration.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_child_grant(:single_a, 'grantee-preview@test.local', 'comment') as token_preview \gset

reset role;

insert into results (name, passed, detail)
select 'preview_child_grant returns access_level so an acceptor is told what they are about to grant',
       count(*) = 1 and bool_and(access_level = 'comment') and bool_and(status = 'pending'),
       format('rows=%s access_level=%s status=%s', count(*), string_agg(access_level, ','), string_agg(status, ','))
from public.preview_child_grant(:'token_preview');

-- ---------------------------------------------------------------------------
-- (4) update_child_grant_access — proposer-only, accepted-only, validated
-- value. Five independent grants, one scenario each, so a rejection in one
-- can never be masked by a mutation left over from another.
-- ---------------------------------------------------------------------------

-- Helper shape repeated 5x below: create as proposer (access_level='read'),
-- look up its id, accept as grantee (except the "still pending" scenario).
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.create_child_grant(:single_upd_ok, 'grantee-upd-ok@test.local') as token_upd_ok \gset
select public.create_child_grant(:single_upd_grantee, 'grantee-upd-grantee@test.local') as token_upd_grantee \gset
select public.create_child_grant(:single_upd_stranger, 'grantee-upd-stranger@test.local') as token_upd_stranger \gset
select public.create_child_grant(:single_a, 'grantee-upd-pending@test.local') as token_upd_pending \gset
select public.create_child_grant(:single_upd_invalid, 'grantee-upd-invalid@test.local') as token_upd_invalid \gset

reset role;

select id as grant_upd_ok_id from public.child_grants
where token_hash = encode(extensions.digest(:'token_upd_ok', 'sha256'), 'hex') \gset
select id as grant_upd_grantee_id from public.child_grants
where token_hash = encode(extensions.digest(:'token_upd_grantee', 'sha256'), 'hex') \gset
select id as grant_upd_stranger_id from public.child_grants
where token_hash = encode(extensions.digest(:'token_upd_stranger', 'sha256'), 'hex') \gset
select id as grant_upd_pending_id from public.child_grants
where token_hash = encode(extensions.digest(:'token_upd_pending', 'sha256'), 'hex') \gset
select id as grant_upd_invalid_id from public.child_grants
where token_hash = encode(extensions.digest(:'token_upd_invalid', 'sha256'), 'hex') \gset

-- Accept all but grant_upd_pending (that one must stay pending on purpose).
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000002","role":"authenticated"}';

select public.accept_child_grant(:'token_upd_ok');
select public.accept_child_grant(:'token_upd_grantee');
select public.accept_child_grant(:'token_upd_stranger');
select public.accept_child_grant(:'token_upd_invalid');

reset role;

-- (4a) POSITIVE: the proposer upgrades an accepted grant's access_level.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.update_child_grant_access(:grant_upd_ok_id, 'edit');

reset role;

insert into results (name, passed, detail)
select 'update_child_grant_access lets the proposer change access_level on an accepted grant',
       count(*) = 1 and bool_and(access_level = 'edit'),
       format('rows=%s access_level=%s', count(*), string_agg(access_level, ','))
from public.child_grants
where id = :grant_upd_ok_id;

-- (4b) NEGATIVE: the grantee (not the proposer) is rejected, and the row is
-- left unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000002","role":"authenticated"}';

select * from pg_temp.try_update_child_grant_access(:grant_upd_grantee_id, 'edit') \gset g4b_

reset role;

insert into results (name, passed, detail)
values (
  'update_child_grant_access rejects the grantee (not the proposer)',
  :'g4b_raised'::boolean,
  format('raised=%s message=%s', :'g4b_raised', :'g4b_message')
);

insert into results (name, passed, detail)
select 'update_child_grant_access: grantee''s rejected call left access_level unchanged',
       count(*) = 1 and bool_and(access_level = 'read'),
       format('rows=%s access_level=%s (expected still read)', count(*), string_agg(access_level, ','))
from public.child_grants
where id = :grant_upd_grantee_id;

-- (4c) NEGATIVE: an unrelated household (stranger) is rejected, and the row
-- is left unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000003","role":"authenticated"}';

select * from pg_temp.try_update_child_grant_access(:grant_upd_stranger_id, 'edit') \gset g4c_

reset role;

insert into results (name, passed, detail)
values (
  'update_child_grant_access rejects a stranger',
  :'g4c_raised'::boolean,
  format('raised=%s message=%s', :'g4c_raised', :'g4c_message')
);

insert into results (name, passed, detail)
select 'update_child_grant_access: stranger''s rejected call left access_level unchanged',
       count(*) = 1 and bool_and(access_level = 'read'),
       format('rows=%s access_level=%s (expected still read)', count(*), string_agg(access_level, ','))
from public.child_grants
where id = :grant_upd_stranger_id;

-- (4d) NEGATIVE: a still-pending grant is rejected (only 'accepted' may be
-- changed), and the row is left unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select * from pg_temp.try_update_child_grant_access(:grant_upd_pending_id, 'edit') \gset g4d_

reset role;

insert into results (name, passed, detail)
values (
  'update_child_grant_access rejects a non-accepted (pending) grant',
  :'g4d_raised'::boolean,
  format('raised=%s message=%s', :'g4d_raised', :'g4d_message')
);

insert into results (name, passed, detail)
select 'update_child_grant_access: pending grant''s rejected call left access_level unchanged',
       count(*) = 1 and bool_and(access_level = 'read') and bool_and(status = 'pending'),
       format('rows=%s access_level=%s status=%s (expected still read/pending)',
              count(*), string_agg(access_level, ','), string_agg(status, ','))
from public.child_grants
where id = :grant_upd_pending_id;

-- (4e) NEGATIVE: an invalid access_level value is rejected even for the
-- proposer on an accepted grant, and the row is left unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca0a0000-0000-0000-0000-000000000001","role":"authenticated"}';

select * from pg_temp.try_update_child_grant_access(:grant_upd_invalid_id, 'delete') \gset g4e_

reset role;

insert into results (name, passed, detail)
values (
  'update_child_grant_access rejects an invalid access_level value',
  :'g4e_raised'::boolean and :'g4e_sqlstate_code' = '23514',
  format('raised=%s sqlstate=%s message=%s', :'g4e_raised', :'g4e_sqlstate_code', :'g4e_message')
);

insert into results (name, passed, detail)
select 'update_child_grant_access: invalid-value rejected call left access_level unchanged',
       count(*) = 1 and bool_and(access_level = 'read'),
       format('rows=%s access_level=%s (expected still read)', count(*), string_agg(access_level, ','))
from public.child_grants
where id = :grant_upd_invalid_id;

-- ---------------------------------------------------------------------------
-- Grants: update_child_grant_access follows this file's real convention
-- (unlike its five siblings — see 06_grants.sql's comment on that gap).
-- anon must never execute it.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'authenticated holds EXECUTE on update_child_grant_access; anon does not',
       has_function_privilege('authenticated', 'public.update_child_grant_access(bigint, text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.update_child_grant_access(bigint, text)', 'EXECUTE'),
       format('authenticated=%s anon=%s',
              has_function_privilege('authenticated', 'public.update_child_grant_access(bigint, text)', 'EXECUTE'),
              has_function_privilege('anon', 'public.update_child_grant_access(bigint, text)', 'EXECUTE'));

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
