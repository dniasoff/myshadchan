--
-- Revocable share links (Epic 9 Story 9.5) — database test suite.
--
-- Covers AC-2 (the token is a forced server-side secret, never
-- client-chosen, at insert AND on every subsequent update — the only column
-- `authenticated` may ever touch is `revoked_at`), AC-6's one-way half (a
-- revoked link can never be un-revoked), AC-9 (cross-account refused on
-- select/update against `share_links` and select against
-- `share_access_log`; a same-household `helper` and plain `single` refused
-- select/insert/update; a `self_manager` refused for a SIBLING's
-- `single_id`), and AC-10 (`share_links`/`share_access_log` are never
-- anon-reachable via PostgREST, on any verb, on either table).
--
-- Same conventions as every other suite here (`listings.sql`'s own idiom):
-- one `begin; ... rollback;` transaction, a `results` table of named checks
-- emitted as JSON, `pg_temp.denied()`/`pg_temp.unexpected_raise()` for
-- SQLSTATE-exact denial proofs (never a bare `exception when others then
-- ... pass`), and mutation-prove (row-count) assertions for a policy that
-- filters rather than raises.
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
-- on `share_links` specifically — see `listings.sql`'s identical
-- `denied_row_security` idiom.
create function pg_temp.denied_row_security(
  p_name text, p_actual_sqlstate text, p_actual_message text
) returns void language plpgsql as $$
begin
  perform pg_temp.denied(
    p_name, '42501',
    'new row violates row-level security policy for table "share_links"',
    p_actual_sqlstate, p_actual_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (as postgres/superuser).
--
--   Household PA — parent_admin (U1), self_manager (U2, linked to
--     single_self), helper (U3), plain single (U4). Two singles:
--     single_self (self-manager's own record) and single_sibling (a second
--     single in the SAME household, nobody's own record) — the AC-9
--     self-manager-on-sibling negative test needs exactly this shape.
--   Household PB — a second, unrelated household's parent_admin (U5), for
--     AC-9's genuine cross-account negative test.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59550000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sharelinks-pa-parent@test.local'),
  ('59550000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sharelinks-pa-selfmgr@test.local'),
  ('59550000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sharelinks-pa-helper@test.local'),
  ('59550000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sharelinks-pa-single@test.local'),
  ('59550000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sharelinks-pb-parent@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('Share Links Household PA', 'household') returning id as account_pa \gset
insert into public.accounts (name, kind) values ('Share Links Household PB', 'household') returning id as account_pb \gset

insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59550000-0000-0000-0000-000000000001', 'parent_admin')
  returning id as member_pa_parent \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59550000-0000-0000-0000-000000000002', 'self_manager')
  returning id as member_pa_self \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59550000-0000-0000-0000-000000000003', 'helper')
  returning id as member_pa_helper \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pa, '59550000-0000-0000-0000-000000000004', 'single')
  returning id as member_pa_single \gset
insert into public.account_members (account_id, user_id, role) values
  (:account_pb, '59550000-0000-0000-0000-000000000005', 'parent_admin')
  returning id as member_pb_parent \gset

insert into ids values
  ('account_pa', :account_pa), ('account_pb', :account_pb),
  ('member_pa_parent', :member_pa_parent), ('member_pa_self', :member_pa_self),
  ('member_pa_helper', :member_pa_helper), ('member_pa_single', :member_pa_single),
  ('member_pb_parent', :member_pb_parent);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.singles (first_name_en, member_id)
values ('Share Links Self Managed', :member_pa_self)
returning id as single_self \gset

insert into public.singles (first_name_en) values ('Share Links Sibling')
returning id as single_sibling \gset

reset role;
insert into ids values ('single_self', :single_self), ('single_sibling', :single_sibling);

-- ---------------------------------------------------------------------------
-- AC-1 / AC-2 (positive path + the CSPRNG guarantee): PA's parent_admin
-- creates a link for the sibling single, deliberately supplying a
-- client-chosen `token` — the trigger overwrites it regardless.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.share_links (single_id, token, include_photo, expires_at)
values (:single_sibling, 'attacker-supplied-token', false, now() + interval '7 days')
returning id as link_a \gset

reset role;
insert into ids values ('link_a', :link_a);

insert into results (name, passed, detail)
select 'AC-1: a share link is created for the manager-chosen single',
       single_id = :single_sibling,
       format('single_id=%s', single_id)
from public.share_links where id = :link_a;

insert into results (name, passed, detail)
select 'AC-2: the trigger overwrote the client-supplied token — it is NOT the attacker-chosen value',
       token <> 'attacker-supplied-token',
       format('token=%L', token)
from public.share_links where id = :link_a;

insert into results (name, passed, detail)
select 'AC-2: the server-set token is a real CSPRNG value — 48 lowercase hex characters (192 bits)',
       token ~ '^[0-9a-f]{48}$',
       format('token=%L', token)
from public.share_links where id = :link_a;

insert into results (name, passed)
select 'AC-1(server-set): account_id resolves to the caller''s own active context, never client-supplied',
       account_id = :account_pa
from public.share_links where id = :link_a;

-- A second create for the SAME single — no partial unique index constrains
-- this (unlike `listings`), so a subject may have SEVERAL outstanding share
-- links at once, deliberately: each is independently revocable.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.share_links (single_id, expires_at)
values (:single_sibling, now() + interval '30 days')
returning id as link_a2, token as link_a2_token \gset

reset role;
insert into ids values ('link_a2', :link_a2);

insert into results (name, passed, detail)
select 'AC-2: two links for the same single get two DIFFERENT tokens',
       token <> :'link_a2_token',
       format('link_a token=%L link_a2 token=%L', token, :'link_a2_token')
from public.share_links where id = :link_a;

-- ---------------------------------------------------------------------------
-- AC-2: the only column `authenticated` may UPDATE is `revoked_at`. Every
-- other column is refused by the column-level grant itself (insufficient_
-- privilege, 42501) — checked both as a live attempted UPDATE and as the
-- has_column_privilege() truth table Task 8 names explicitly.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-2: an authenticated UPDATE touching token is refused by the column-level grant';
  v_link_a bigint;
begin
  select value into v_link_a from ids where name = 'link_a';
  update public.share_links set token = 'hijacked' where id = v_link_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when insufficient_privilege then
  insert into results values (v_name, true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-2: an authenticated UPDATE touching single_id is refused by the column-level grant';
  v_link_a bigint;
  v_single_self bigint;
begin
  select value into v_link_a from ids where name = 'link_a';
  select value into v_single_self from ids where name = 'single_self';
  update public.share_links set single_id = v_single_self where id = v_link_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when insufficient_privilege then
  insert into results values (v_name, true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-2: an authenticated UPDATE touching include_photo is refused by the column-level grant';
  v_link_a bigint;
begin
  select value into v_link_a from ids where name = 'link_a';
  update public.share_links set include_photo = true where id = v_link_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when insufficient_privilege then
  insert into results values (v_name, true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-2: an authenticated UPDATE touching expires_at is refused by the column-level grant';
  v_link_a bigint;
begin
  select value into v_link_a from ids where name = 'link_a';
  update public.share_links set expires_at = now() + interval '1 day' where id = v_link_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when insufficient_privilege then
  insert into results values (v_name, true, sqlstate || ' ' || sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-2: none of the four refused UPDATE attempts changed the row',
       token !~ 'hijacked'
       and single_id = :single_sibling
       and include_photo = false
from public.share_links where id = :link_a;

do $$
declare
  v_missing text;
begin
  select string_agg(col, ', ') into v_missing
  from unnest(array['token', 'single_id', 'include_photo', 'expires_at']) as col
  where has_column_privilege('authenticated', 'public.share_links'::regclass, col, 'UPDATE');

  insert into results (name, passed, detail)
  values (
    'AC-2: authenticated holds NO update privilege on token/single_id/include_photo/expires_at',
    v_missing is null,
    format('columns still updatable: %s', coalesce(v_missing, 'none'))
  );
end $$;

insert into results (name, passed)
select 'AC-2/Task-2: authenticated DOES hold update privilege on revoked_at (the one legitimate column)',
       has_column_privilege('authenticated', 'public.share_links'::regclass, 'revoked_at', 'UPDATE');

insert into results (name, passed)
select 'AC-2: authenticated holds NO table-level UPDATE on share_links (column-level only)',
       not has_table_privilege('authenticated', 'public.share_links', 'update');

-- ---------------------------------------------------------------------------
-- AC-6: revocation is immediate and ONE-WAY. Revoking (the one legitimate
-- update) succeeds; un-revoking is refused by the trigger.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.share_links set revoked_at = now() where id = :link_a;

reset role;

insert into results (name, passed)
select 'AC-6: revoking sets revoked_at',
       revoked_at is not null
from public.share_links where id = :link_a;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6: un-revoking a revoked link (revoked_at back to null) is refused by the trigger';
  v_link_a bigint;
begin
  select value into v_link_a from ids where name = 'link_a';
  update public.share_links set revoked_at = null where id = v_link_a;
  perform pg_temp.unexpected_raise(v_name, null, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', '%cannot be un-revoked%', sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-6: the refused un-revoke attempt left revoked_at untouched (still set)',
       revoked_at is not null
from public.share_links where id = :link_a;

-- Revoking again (already revoked, same value) is a legal no-op — the
-- trigger only refuses when the NEW value actually DIFFERS from the OLD one
-- (`is distinct from`), not merely touching the column at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

with attempt as (
  update public.share_links set revoked_at = revoked_at where id = :link_a returning id
)
select count(*) as cnt from attempt \gset re_revoke_

reset role;

insert into results (name, passed, detail)
select 'AC-6: setting revoked_at to its OWN current value again is not refused by the trigger (same value, not a real change)',
       :re_revoke_cnt = 1,
       format('rows updated: %s', :re_revoke_cnt);

-- ---------------------------------------------------------------------------
-- AC-9: cross-account and cross-role negative tests.
-- ---------------------------------------------------------------------------

-- (a) A DIFFERENT household's parent_admin (PB) cannot select, revoke, or
--     read the access log for PA's link.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000005","role":"authenticated"}';

select count(*) as cnt from public.share_links where id = :link_a2 \gset cross_select_

insert into results (name, passed, detail)
select 'AC-9: a DIFFERENT household''s parent_admin''s SELECT of PA''s link returns zero rows',
       :cross_select_cnt = 0,
       format('rows visible: %s', :cross_select_cnt);

with attempt as (
  update public.share_links set revoked_at = now() where id = :link_a2 returning id
)
select count(*) as cnt from attempt \gset cross_update_

insert into results (name, passed, detail)
select 'AC-9: a DIFFERENT household''s parent_admin''s revoke attempt on PA''s link affects zero rows',
       :cross_update_cnt = 0,
       format('rows updated: %s', :cross_update_cnt);

-- Refused by RLS itself (42501), not merely the composite FK — the
-- `single_id in (select ... where account_id = current_context_id())`
-- clause this suite's own first run found missing and this story's schema
-- now carries (05_policies.sql's own comment on the hardening).
do $$
declare
  v_name constant text := 'AC-9: a DIFFERENT household''s parent_admin cannot INSERT a share link naming PA''s single — refused by RLS, not the composite FK';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'single_sibling';
  insert into public.share_links (single_id, expires_at)
  values (v_single_sibling, now() + interval '7 days');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select 'AC-9: link_a2 is untouched by every refused cross-account attempt',
       revoked_at is null
from public.share_links where id = :link_a2;

-- (b) PA's own non-managing roles (helper, plain single) are refused
--     select/insert/update, even within their OWN household.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000003","role":"authenticated"}';

select count(*) as cnt from public.share_links where id = :link_a2 \gset helper_select_

insert into results (name, passed, detail)
select 'AC-9: a helper (same household) SELECTing an existing link returns zero rows',
       :helper_select_cnt = 0,
       format('rows visible: %s', :helper_select_cnt);

do $$
declare
  v_name constant text := 'AC-9: a helper cannot INSERT a share link for any single in the household';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'single_sibling';
  insert into public.share_links (single_id, expires_at)
  values (v_single_sibling, now() + interval '7 days');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

with attempt as (
  update public.share_links set revoked_at = now() where id = :link_a2 returning id
)
select count(*) as cnt from attempt \gset helper_update_

insert into results (name, passed, detail)
select 'AC-9: a helper''s revoke attempt on an existing link affects zero rows',
       :helper_update_cnt = 0,
       format('rows updated: %s', :helper_update_cnt);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000004","role":"authenticated"}';

select count(*) as cnt from public.share_links where id = :link_a2 \gset plain_select_

insert into results (name, passed, detail)
select 'AC-9: a plain single (same household, not self-managing) SELECTing an existing link returns zero rows',
       :plain_select_cnt = 0,
       format('rows visible: %s', :plain_select_cnt);

do $$
declare
  v_name constant text := 'AC-9: a plain single cannot INSERT a share link for any single in the household';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'single_sibling';
  insert into public.share_links (single_id, expires_at)
  values (v_single_sibling, now() + interval '7 days');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

with attempt as (
  update public.share_links set revoked_at = now() where id = :link_a2 returning id
)
select count(*) as cnt from attempt \gset plain_update_

insert into results (name, passed, detail)
select 'AC-9: a plain single''s revoke attempt on an existing link affects zero rows',
       :plain_update_cnt = 0,
       format('rows updated: %s', :plain_update_cnt);

reset role;

-- (c) A self_manager may create a link for THEMSELVES, but is refused for a
--     SIBLING's single_id — authority is scoped to their own record only,
--     mirroring FR103's identical boundary on `listings`.
set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-9: a self_manager cannot create a share link for a SIBLING''s single_id';
  v_single_sibling bigint;
begin
  select value into v_single_sibling from ids where name = 'single_sibling';
  insert into public.share_links (single_id, expires_at)
  values (v_single_sibling, now() + interval '7 days');
  perform pg_temp.unexpected_raise(v_name, null, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- Positive control, same session: the self-manager creating a link for
-- THEIR OWN record succeeds — proves the refusal above is a real authority
-- boundary, not a blanket denial of every self-manager insert.
insert into public.share_links (single_id, expires_at)
values (:single_self, now() + interval '7 days')
returning id as link_self \gset

reset role;
insert into ids values ('link_self', :link_self);

insert into results (name, passed)
select 'AC-9 control: the self-manager CAN create a share link for THEIR OWN single_id',
       single_id = :single_self
from public.share_links where id = :link_self;

insert into results (name, passed, detail)
select 'AC-9: none of the refused cross-role/cross-account INSERT attempts left an extra row for single_sibling beyond the two already created',
       count(*) = 2,
       format('rows: %s', count(*))
from public.share_links where single_id = :single_sibling;

-- (d) share_access_log: PB's parent_admin cannot see PA's log even for a
--     row that genuinely exists (seeded directly, as postgres — the ONLY
--     real writer is the share/ Worker's service-role key, which bypasses
--     RLS entirely; this is the SQL suite's own stand-in for that write).
insert into public.share_access_log (share_link_id, resource, duration_ms)
values (:link_a2, 'profile', 42)
returning id as access_log_row \gset

insert into ids values ('access_log_row', :access_log_row);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000005","role":"authenticated"}';

select count(*) as cnt from public.share_access_log where share_link_id = :link_a2 \gset cross_log_select_

insert into results (name, passed, detail)
select 'AC-9: a DIFFERENT household''s parent_admin cannot SELECT PA''s share_access_log rows',
       :cross_log_select_cnt = 0,
       format('rows visible: %s', :cross_log_select_cnt);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000003","role":"authenticated"}';

select count(*) as cnt from public.share_access_log where share_link_id = :link_a2 \gset helper_log_select_

insert into results (name, passed, detail)
select 'AC-9: a helper (same household, non-managing) cannot SELECT the access log either',
       :helper_log_select_cnt = 0,
       format('rows visible: %s', :helper_log_select_cnt);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"59550000-0000-0000-0000-000000000001","role":"authenticated"}';

select count(*) as cnt from public.share_access_log where share_link_id = :link_a2 \gset manager_log_select_

insert into results (name, passed, detail)
select 'AC-8/AC-9 control: PA''s OWN parent_admin CAN SELECT the access log for their own link',
       :manager_log_select_cnt = 1,
       format('rows visible: %s', :manager_log_select_cnt);

reset role;

-- ---------------------------------------------------------------------------
-- AC-10: share_links / share_access_log are never anon-reachable via
-- PostgREST, on ANY verb, on EITHER table — the direct counterpart to the
-- retired token-portal's own suite and its "anon has NO privilege on the
-- portal's token table" checks (Epic 1 Story 1.4 — that suite is gone;
-- read it from git history).
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-10: anon holds NO select on share_links',
       not has_table_privilege('anon', 'public.share_links', 'select');
insert into results (name, passed)
select 'AC-10: anon holds NO insert on share_links',
       not has_table_privilege('anon', 'public.share_links', 'insert');
insert into results (name, passed)
select 'AC-10: anon holds NO update on share_links',
       not has_table_privilege('anon', 'public.share_links', 'update');
insert into results (name, passed)
select 'AC-10: anon holds NO delete on share_links',
       not has_table_privilege('anon', 'public.share_links', 'delete');
insert into results (name, passed)
select 'AC-10: anon holds NO truncate on share_links (TRUNCATE bypasses RLS)',
       not has_table_privilege('anon', 'public.share_links', 'truncate');
insert into results (name, passed)
select 'AC-10: anon holds NO references/trigger on share_links',
       not has_table_privilege('anon', 'public.share_links', 'references')
       and not has_table_privilege('anon', 'public.share_links', 'trigger');
insert into results (name, passed)
select 'AC-10: anon holds NO sequence privilege on share_links_id_seq',
       not has_sequence_privilege('anon', 'public.share_links_id_seq', 'usage')
       and not has_sequence_privilege('anon', 'public.share_links_id_seq', 'select');

insert into results (name, passed)
select 'AC-10: anon holds NO select on share_access_log',
       not has_table_privilege('anon', 'public.share_access_log', 'select');
insert into results (name, passed)
select 'AC-10: anon holds NO insert on share_access_log',
       not has_table_privilege('anon', 'public.share_access_log', 'insert');
insert into results (name, passed)
select 'AC-10: anon holds NO update on share_access_log',
       not has_table_privilege('anon', 'public.share_access_log', 'update');
insert into results (name, passed)
select 'AC-10: anon holds NO delete on share_access_log',
       not has_table_privilege('anon', 'public.share_access_log', 'delete');
insert into results (name, passed)
select 'AC-10: anon holds NO truncate on share_access_log',
       not has_table_privilege('anon', 'public.share_access_log', 'truncate');
insert into results (name, passed)
select 'AC-10: anon holds NO sequence privilege on share_access_log_id_seq',
       not has_sequence_privilege('anon', 'public.share_access_log_id_seq', 'usage')
       and not has_sequence_privilege('anon', 'public.share_access_log_id_seq', 'select');

-- Task 3's own hand-check, pinned as a real assertion too: FORCE ROW LEVEL
-- SECURITY on both tables (AD-1 — unconditional, regardless of who might
-- carry BYPASSRLS).
insert into results (name, passed)
select 'AD-1: rowsecurity and forcerowsecurity are both true on public.share_links',
       relrowsecurity and relforcerowsecurity
from pg_class where oid = 'public.share_links'::regclass;

insert into results (name, passed)
select 'AD-1: rowsecurity and forcerowsecurity are both true on public.share_access_log',
       relrowsecurity and relforcerowsecurity
from pg_class where oid = 'public.share_access_log'::regclass;

-- No insert/update/delete grant for authenticated on share_access_log at
-- all (Task 2: "the ONLY writer of this table is the share/ Worker") —
-- select-only.
insert into results (name, passed)
select 'Task 2: authenticated holds select on share_access_log, and NOTHING else',
       has_table_privilege('authenticated', 'public.share_access_log', 'select')
       and not has_table_privilege('authenticated', 'public.share_access_log', 'insert')
       and not has_table_privilege('authenticated', 'public.share_access_log', 'update')
       and not has_table_privilege('authenticated', 'public.share_access_log', 'delete');

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
