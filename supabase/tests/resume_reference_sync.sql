-- Resume reference reconciliation — populated-tenant proof.
--
-- Every assertion is inside one transaction and the runner rolls it back. The
-- fixture deliberately contains existing diligence data, duplicate identities,
-- an ambiguous phone, and the same person on two suggestions.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('77777777-7777-4777-8777-777777777701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resume-sync-parent@test.local'),
  ('77777777-7777-4777-8777-777777777702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resume-sync-single@test.local');

delete from public.account_members;

insert into public.accounts (name, kind)
values ('Resume sync fixture', 'household')
returning id as account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '77777777-7777-4777-8777-777777777701', 'parent_admin', 'active')
returning id as parent_member_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '77777777-7777-4777-8777-777777777702', 'single', 'active')
returning id as single_member_id \gset

insert into public.singles (account_id, first_name_en, gender, member_id)
values (:account_id, 'Fixture single', 'female', :single_member_id)
returning id as single_id \gset

insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Resume sync suggestion A')
returning id as shidduch_a_id \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Resume sync suggestion B')
returning id as shidduch_b_id \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Resume sync suggestion C')
returning id as shidduch_c_id \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Resume sync suggestion D')
returning id as shidduch_d_id \gset

insert into public."references" (account_id, name_en, relationship, phone)
values (:account_id, 'Rachel Cohen', 'old relationship', '555-111-2222')
returning id as existing_reference_id \gset
insert into public."references" (account_id, name_en, relationship, phone)
values (:account_id, 'Duplicate One', 'friend', '555-333-4444')
returning id as ambiguous_reference_a_id \gset
insert into public."references" (account_id, name_en, relationship, phone)
values (:account_id, 'Duplicate Two', 'friend', '555-333-4444')
returning id as ambiguous_reference_b_id \gset
insert into public."references" (account_id, name_en, relationship, phone)
values (:account_id, 'Conflicting Person', 'friend', '555-555-6666')
returning id as conflicting_reference_id \gset

insert into public.reference_links (
  account_id, reference_id, shidduchim_id, call_status, what_they_said,
  conversation_log, relationship_override
)
values (
  :account_id, :existing_reference_id, :shidduch_a_id, 'answered',
  'Existing note must survive', '[{"text":"Existing log"}]'::jsonb,
  'Existing override'
)
returning id as existing_link_id \gset
insert into public.interactions (
  account_id, target_type, target_id, scope, reference_link_id, kind, body
)
values (
  :account_id, 'reference', :existing_reference_id, 'shidduch',
  :existing_link_id, 'call_logged', 'Existing interaction must survive'
);

insert into public.resumes (account_id, shidduchim_id, sections)
values (
  :account_id,
  :shidduch_a_id,
  jsonb_build_object(
    'references', jsonb_build_array(
      jsonb_build_object('name', 'Rachel Cohen', 'relationship', 'new relationship', 'phone', '(555) 111-2222'),
      jsonb_build_object('name', 'New Person', 'relationship', 'teacher', 'phone', '555-777-8888'),
      jsonb_build_object('name', 'New Person', 'relationship', 'duplicate', 'phone', '555-777-8888'),
      jsonb_build_object('name', 'No Phone', 'relationship', 'neighbor', 'phone', ''),
      jsonb_build_object('name', 'Ambiguous Candidate', 'relationship', 'friend', 'phone', '555-333-4444'),
      jsonb_build_object('name', 'Wrong Name', 'relationship', 'friend', 'phone', '555-555-6666'),
      jsonb_build_object('name', 'Malformed Phone', 'relationship', 'junk', 'phone', 'not a phone'),
      jsonb_build_object('name', '', 'relationship', 'junk', 'phone', '555-999-0000')
    )
  )
)
returning id as resume_a_id \gset

insert into public.resumes (account_id, shidduchim_id, sections)
values (
  :account_id,
  :shidduch_b_id,
  jsonb_build_object(
    'references', jsonb_build_array(
      jsonb_build_object('name', 'Rachel Cohen', 'relationship', 'different suggestion', 'phone', '5551112222')
    )
  )
)
returning id as resume_b_id \gset

insert into public.resumes (account_id, shidduchim_id, sections)
values (:account_id, :shidduch_c_id, '{}'::jsonb)
returning id as resume_c_id \gset

insert into public.resumes (account_id, shidduchim_id, sections)
values (
  :account_id,
  :shidduch_d_id,
  jsonb_build_object(
    'references', (
      select jsonb_agg(
        jsonb_build_object('name', '', 'relationship', 'hostile', 'phone', 'not a phone')
        order by n
      )
      from generate_series(1, 10000) as hostile(n)
    )
  )
)
returning id as hostile_resume_id \gset

insert into ids (name, value)
values
  ('resume_a_id', :resume_a_id),
  ('resume_b_id', :resume_b_id),
  ('resume_c_id', :resume_c_id),
  ('hostile_resume_id', :hostile_resume_id);

insert into results (name, passed)
select 'insert trigger reconciles parsed references', count(*) = 3
from public.reference_links
where account_id = :account_id and shidduchim_id = :shidduch_a_id;

insert into results (name, passed)
select 'insert trigger reconciles the second suggestion', count(*) = 1
from public.reference_links
where account_id = :account_id and shidduchim_id = :shidduch_b_id;

-- The public RPC follows the active account and role, not caller-supplied data.
set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-7777-4777-8777-777777777701","role":"authenticated"}';

select public.sync_resume_references(:resume_a_id) as first_result \gset
select public.sync_resume_references(:resume_a_id) as second_result \gset
select public.sync_resume_references(:resume_b_id) as second_suggestion_result \gset
select public.sync_resume_references(:hostile_resume_id) as hostile_result \gset

insert into results (name, passed, detail)
select 'new reference and link are created once',
       count(*) = 1,
       jsonb_build_object('references', count(*))::text
from public."references"
where account_id = :account_id and name_norm_en = 'new person';

insert into results (name, passed)
select 'duplicate parsed item does not create another identity', count(*) = 1
from public."references"
where account_id = :account_id and name_norm_en = 'new person';

insert into results (name, passed)
select 'duplicate parsed item does not create another link', count(*) = 1
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.account_id = :account_id
  and rl.shidduchim_id = :shidduch_a_id
  and r.name_norm_en = 'new person';

insert into results (name, passed)
select 'valid no-phone reference is created', count(*) = 1
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.account_id = :account_id
  and rl.shidduchim_id = :shidduch_a_id
  and r.name_norm_en = 'no phone';

insert into results (name, passed)
select 'exact name and phone reuses the existing identity', count(*) = 1
from public."references" r
where r.id = :existing_reference_id;

insert into results (name, passed)
select 'existing link status note log and relationship survive',
       rl.call_status = 'answered'
       and rl.what_they_said = 'Existing note must survive'
       and rl.conversation_log = '[{"text":"Existing log"}]'::jsonb
       and rl.relationship_override = 'Existing override'
from public.reference_links rl
where rl.id = :existing_link_id;

insert into results (name, passed)
select 'existing interaction survives', count(*) = 1
from public.interactions
where reference_link_id = :existing_link_id
  and body = 'Existing interaction must survive';

insert into results (name, passed)
select 'same identity gets an independent link for the second suggestion', count(*) = 2
from public.reference_links rl
where rl.account_id = :account_id and rl.reference_id = :existing_reference_id;

insert into results (name, passed)
select 'ambiguous phone candidate remains unlinked',
       count(*) = 0
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.shidduchim_id = :shidduch_a_id
  and r.name_norm_en = 'ambiguous candidate';

insert into results (name, passed)
select 'conflicting phone candidate remains unlinked', count(*) = 0
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.shidduchim_id = :shidduch_a_id
  and r.name_norm_en = 'wrong name';

insert into results (name, passed)
select 'blank-name candidate remains unlinked', count(*) = 0
from public."references" r
where r.account_id = :account_id and r.name_norm_en = 'junk';

insert into results (name, passed)
select 'malformed non-empty phone remains unlinked', count(*) = 0
from public."references" r
where r.account_id = :account_id and r.name_norm_en = 'malformed phone';

insert into results (name, passed, detail)
select 'hostile 10k input is capped before validation',
       ((:'hostile_result'::jsonb ->> 'skipped_invalid')::integer = 10000),
       :'hostile_result';

insert into results (name, passed)
select 'rerun changes no existing link count',
       count(*) = 3
from public.reference_links
where account_id = :account_id and shidduchim_id = :shidduch_a_id;

insert into results (name, passed)
select 'new links are marked with the sync source and resume id',
       count(*) = 3
from public.reference_links rl
join public.interactions i on i.reference_link_id = rl.id
where rl.resume_id in (:resume_a_id, :resume_b_id)
  and i.kind = 'link_created'
  and i.metadata ->> 'source' = 'resume_reference_sync';

update public.resumes
set sections = jsonb_build_object(
  'references', jsonb_build_array(
    jsonb_build_object('name', 'Updated Person', 'relationship', 'teacher', 'phone', '555-888-9999')
  )
)
where id = :resume_c_id;

select count(*) as update_link_count
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.account_id = :account_id
  and rl.shidduchim_id = :shidduch_c_id
  and r.name_norm_en = 'updated person' \gset

update public.resumes
set sections = sections
where id = :resume_c_id;

insert into results (name, passed)
select 'changed sections trigger reconciles once and unchanged sections no-op',
       :'update_link_count' = '1'
       and (select count(*)
            from public.reference_links rl
            join public."references" r on r.id = rl.reference_id
            where rl.account_id = :account_id
              and rl.shidduchim_id = :shidduch_c_id
              and r.name_norm_en = 'updated person') = 1;

-- A single may still read the resume document but may not invoke this candid
-- reconciliation RPC or receive its reference content.
set local request.jwt.claims = '{"sub":"77777777-7777-4777-8777-777777777702","role":"authenticated"}';
do $$
declare
  v_resume_id bigint;
begin
  select value into v_resume_id from ids where name = 'resume_a_id';
  perform public.sync_resume_references(v_resume_id);
  insert into results values ('single cannot reconcile resume references', false, 'RPC unexpectedly succeeded');
exception when others then
  insert into results values ('single cannot reconcile resume references', sqlstate = '42501', sqlerrm);
end $$;

-- Replace the internal routine only inside this rolled-back proof transaction.
-- The trigger must swallow the exception and let the resume update commit.
set local role postgres;
create or replace function public.reconcile_resume_references_for_account(
  p_resume_id bigint, p_account_id bigint
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
begin
  raise exception 'intentional trigger isolation probe';
end;
$$;

update public.resumes
set sections = sections
where id = :resume_c_id;

insert into results (name, passed)
select 'unchanged sections update is a trigger no-op',
       sections -> 'references' -> 0 ->> 'name' = 'Updated Person'
from public.resumes
where id = :resume_c_id;

update public.resumes
set sections = jsonb_build_object(
  'references', jsonb_build_array(
    jsonb_build_object('name', 'Trigger Exception Candidate', 'relationship', 'probe', 'phone', '555-000-1111')
  )
)
where id = :resume_c_id;

insert into results (name, passed)
select 'trigger exception does not roll back the resume write',
       sections -> 'references' -> 0 ->> 'name' = 'Trigger Exception Candidate'
from public.resumes
where id = :resume_c_id;

insert into results (name, passed)
select 'trigger exception does not create a partial link', count(*) = 0
from public.reference_links rl
join public."references" r on r.id = rl.reference_id
where rl.account_id = :account_id
  and rl.shidduchim_id = :shidduch_c_id
  and r.name_norm_en = 'trigger exception candidate';

select json_agg(row_to_json(results) order by name) from results;
rollback;
