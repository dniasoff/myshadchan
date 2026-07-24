--
-- Dedupe "catch" engine (E3) — database test suite.
--
-- Covers what Epic 3 added: the shidduchim_catch_summary view (the board chip's
-- catch_count) and the catch_shidduch() RPC. The invariants exercised here only
-- exist inside Postgres — the shared identity matcher's gate (name + at least one
-- corroborator, never name-only), Hebrew/English variant folding, the FR11 rule
-- that age is never a matching signal, account isolation (PRV-2), and honest
-- prior-dating discovery — so they cannot be meaningfully checked through a mock.
--
-- Every check appends one row to `results`; the script emits them as JSON at the
-- end and rolls back, so it leaves nothing behind. The runner
-- (shidduch_catch.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange. Two tenants that must never catch each other (PRV-2). handle_new_user
-- bootstraps the FIRST user's membership; we then clear and re-point memberships
-- at this suite's own accounts, exactly like the references suite.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a1a1a1a1-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catch-a@test.local');
insert into auth.users (id, instance_id, aud, role, email)
values ('b2b2b2b2-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catch-b@test.local'),
       ('c3c3c3c3-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catch-nobody@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('Catch Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('Catch Tenant B') returning id as acct_b \gset

insert into public.account_members (account_id, user_id, role)
values (:acct_a, 'a1a1a1a1-1111-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, 'b2b2b2b2-2222-2222-2222-222222222222', 'parent_admin');

-- Tenant A: two children so a catch can cross children in the same family.
insert into public.children (account_id, first_name_en, gender)
values (:acct_a, 'Leah', 'female') returning id as child_leah \gset
insert into public.children (account_id, first_name_en, gender)
values (:acct_a, 'Rivka', 'female') returning id as child_rivka \gset

-- The same boy, suggested for both children, spelled two ways (Chaim / Haim) and
-- corroborated by the same parents + seminary -> a catch each way.
insert into public.shidduchim (account_id, child_id, name_en, parents_en, seminary_en, age)
values (:acct_a, :child_leah, 'Chaim Cohen', 'Yaakov Cohen', 'Yeshivas Ohr', 24)
returning id as shid_chaim \gset
insert into public.shidduchim (account_id, child_id, name_en, parents_en, seminary_en, age)
values (:acct_a, :child_rivka, 'Haim Cohen', 'Yaakov Cohen', 'Yeshivas Ohr', 25)
returning id as shid_haim \gset

-- A solo suggestion with a unique name -> never a catch.
insert into public.shidduchim (account_id, child_id, name_en, parents_en, seminary_en)
values (:acct_a, :child_leah, 'Shloime Klein', 'Berel Klein', 'Mir')
returning id as shid_solo \gset

-- Same exact name as shid_chaim but nothing else shared -> name-only, NOT a catch.
insert into public.shidduchim (account_id, child_id, name_en, parents_en, seminary_en)
values (:acct_a, :child_leah, 'Chaim Cohen', 'Shimon Berger', 'Ponovezh')
returning id as shid_nameonly \gset

-- Two suggestions sharing an exact name AND an age, but no real corroborator:
-- age must never be the signal that ties them (FR11).
insert into public.shidduchim (account_id, child_id, name_en, parents_en, age)
values (:acct_a, :child_leah, 'Yosef Stern', 'Avi Stern', 22)
returning id as shid_age1 \gset
insert into public.shidduchim (account_id, child_id, name_en, parents_en, age)
values (:acct_a, :child_rivka, 'Yosef Stern', 'Dovid Frank', 22)
returning id as shid_age2 \gset

-- Honest prior dating: one date record for the same person WITH a corroborator
-- (seminary), one with only the name.
insert into public.date_records (account_id, child_id, person_name_en, person_seminary, outcome, date_on)
values (:acct_a, :child_leah, 'Chaim Cohen', 'Yeshivas Ohr', 'no_second_date', '2026-01-10')
returning id as date_corrob \gset
insert into public.date_records (account_id, child_id, person_name_en, outcome, date_on)
values (:acct_a, :child_leah, 'Chaim Cohen', 'ended', '2025-12-01')
returning id as date_nameonly \gset

-- Tenant B: an IDENTICAL person. Must never appear in tenant A's catches.
insert into public.children (account_id, first_name_en, gender)
values (:acct_b, 'Miriam', 'female') returning id as child_b \gset
insert into public.shidduchim (account_id, child_id, name_en, parents_en, seminary_en)
values (:acct_b, :child_b, 'Chaim Cohen', 'Yaakov Cohen', 'Yeshivas Ohr')
returning id as shid_b \gset

-- ---------------------------------------------------------------------------
-- shidduchim_catch_summary / shidduchim_summary.catch_count (the board chip)
-- ---------------------------------------------------------------------------
insert into results (name, passed) values
  ('catch view: a variant name + shared seminary catches both ways',
   (select catch_count from public.shidduchim_summary where id = :shid_chaim) = 1
   and (select catch_count from public.shidduchim_summary where id = :shid_haim) = 1),
  ('catch view: a solo unique-name suggestion has no catch',
   (select catch_count from public.shidduchim_summary where id = :shid_solo) = 0),
  ('catch view: an exact name with no corroborator is NOT a catch',
   (select catch_count from public.shidduchim_summary where id = :shid_nameonly) = 0),
  ('catch view: age is never the corroborator (FR11)',
   (select catch_count from public.shidduchim_summary where id = :shid_age1) = 0
   and (select catch_count from public.shidduchim_summary where id = :shid_age2) = 0),
  ('catch view: an identical person in another tenant is never counted (PRV-2)',
   (select catch_count from public.shidduchim_summary where id = :shid_chaim) = 1);

-- ---------------------------------------------------------------------------
-- catch_shidduch() as tenant A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a1a1a1-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'catch_shidduch: reports a catch for the variant-spelled suggestion',
       (public.catch_shidduch(:shid_haim) ->> 'has_catch')::boolean;

insert into results (name, passed)
select 'catch_shidduch: surfaces the prior suggestion of the same person',
       exists (
         select 1 from jsonb_array_elements(public.catch_shidduch(:shid_haim) -> 'suggestions') e
         where (e ->> 'prior_shidduchim_id')::bigint = :shid_chaim
       );

insert into results (name, passed)
select 'catch_shidduch: never returns the row itself',
       not exists (
         select 1 from jsonb_array_elements(public.catch_shidduch(:shid_haim) -> 'suggestions') e
         where (e ->> 'prior_shidduchim_id')::bigint = :shid_haim
       );

insert into results (name, passed)
select 'catch_shidduch: shows the deciding facts, not just a score',
       exists (
         select 1
         from jsonb_array_elements(public.catch_shidduch(:shid_haim) -> 'suggestions') e,
              jsonb_array_elements(e -> 'deciding_facts') f
         where f ->> 'signal' = 'name'
       );

insert into results (name, passed)
select 'catch_shidduch: an exact name with no corroborator catches nothing',
       jsonb_array_length(public.catch_shidduch(:shid_nameonly) -> 'suggestions') = 0;

insert into results (name, passed)
select 'catch_shidduch: age alone (FR11) catches nothing',
       jsonb_array_length(public.catch_shidduch(:shid_age1) -> 'suggestions') = 0;

insert into results (name, passed)
select 'catch_shidduch: a corroborated prior date is surfaced honestly',
       exists (
         select 1 from jsonb_array_elements(public.catch_shidduch(:shid_haim) -> 'dates') e
         where (e ->> 'date_record_id')::bigint = :date_corrob
       );

insert into results (name, passed)
select 'catch_shidduch: a name-only prior date is NOT fabricated into a match',
       not exists (
         select 1 from jsonb_array_elements(public.catch_shidduch(:shid_haim) -> 'dates') e
         where (e ->> 'date_record_id')::bigint = :date_nameonly
       );

reset role;

-- ---------------------------------------------------------------------------
-- catch_shidduch() as tenant B — must never reach tenant A's identical person.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2b2b2b2-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'catch_shidduch: identity is never pooled across accounts (PRV-2)',
       jsonb_array_length(public.catch_shidduch(:shid_b) -> 'suggestions') = 0
       and not (public.catch_shidduch(:shid_b) ->> 'has_catch')::boolean;

reset role;

-- ---------------------------------------------------------------------------
-- catch_shidduch() with no account context fails closed, never errors.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3c3c3c3-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select 'catch_shidduch: a caller with no membership gets an empty catch, not an error',
       public.catch_shidduch(:shid_chaim) = jsonb_build_object(
         'has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb
       );

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
