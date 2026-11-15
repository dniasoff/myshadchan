-- Fill-empty resume read: field provenance, section merge, file identity and
-- atomic charge. The transaction rolls back all fixtures at the end.
\set ON_ERROR_STOP on
begin;
create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

insert into public.accounts (name, kind)
values ('Resume read test account', 'household') returning id as account_id \gset
insert into public.subscription (account_id, plan, status)
values (:account_id, 'ai', 'active');
insert into public.singles (account_id, first_name_en)
values (:account_id, 'Read test single') returning id as single_id \gset
insert into public.shidduchim (account_id, single_id, name_en, father_en, mother_en)
values (:account_id, :single_id, 'Existing name', null, '   ')
returning id as shidduch_id \gset
insert into public.resumes (account_id, shidduchim_id, files, sections)
values (
  :account_id,
  :shidduch_id,
  '[{"path":"10/resumes/test/old.pdf","filename":"old.pdf","uploaded_at":"2026-01-01T00:00:00Z","mime_type":"application/pdf","size":8}]'::jsonb,
  '{"learningHistory":[{"label":"existing","value":"keep"}],"references":[],"additionalSections":[{"title":"Existing","items":[{"label":"keep","value":"yes"}]}]}'::jsonb
) returning id as resume_id \gset

select public.claim_ai_reread_attempt(
  :account_id, :resume_id, '20000000-0000-4000-8000-000000000001', 4::smallint
) as first_claim \gset
select (:'first_claim'::jsonb ->> 'attempt_id')::bigint as attempt_id \gset
select (:'first_claim'::jsonb ->> 'generation')::bigint as generation \gset
select public.apply_ai_resume_read(
  :account_id, :resume_id, :attempt_id, :generation,
  '10/resumes/test/old.pdf',
  '{"name_en":"Do not replace","father_en":"New father","mother_en":"New mother","age":24,"height":"5 foot 5"}'::jsonb,
  '{"fields":{"name_en":"Do not replace"}}'::jsonb,
  '{"learningHistory":[{"label":"new","value":"do not replace existing"}],"references":[{"name":"new reference"}],"additionalSections":[{"title":"New","items":[]}]}'::jsonb,
  4::smallint
) as first_apply \gset
insert into results
select 'fill-empty preserves non-empty fields and sections while filling empty values',
  (:'first_apply'::jsonb ->> 'outcome') = 'applied'
  and (select name_en from public.shidduchim where id = :shidduch_id) = 'Existing name'
  and (select father_en from public.shidduchim where id = :shidduch_id) = 'New father'
  and (select mother_en from public.shidduchim where id = :shidduch_id) = 'New mother'
  and (select age from public.shidduchim where id = :shidduch_id) = 24
  and (select sections -> 'learningHistory' from public.resumes where id = :resume_id)
      = '[{"label":"existing","value":"keep"}]'::jsonb
  and (select sections -> 'references' from public.resumes where id = :resume_id)
      = '[{"name":"new reference"}]'::jsonb
  and (select sections -> 'additionalSections' from public.resumes where id = :resume_id)
      = '[{"title":"Existing","items":[{"label":"keep","value":"yes"}]}]'::jsonb,
  :'first_apply';

update public.resumes
set files = files || '[{"path":"10/resumes/test/new.pdf","filename":"new.pdf","uploaded_at":"2026-02-01T00:00:00Z","mime_type":"application/pdf","size":8}]'::jsonb
where id = :resume_id;
select public.claim_ai_reread_attempt(
  :account_id, :resume_id, '20000000-0000-4000-8000-000000000002', 4::smallint
) as stale_claim \gset
select (:'stale_claim'::jsonb ->> 'attempt_id')::bigint as stale_attempt \gset
select (:'stale_claim'::jsonb ->> 'generation')::bigint as stale_generation \gset
select public.apply_ai_resume_read(
  :account_id, :resume_id, :stale_attempt, :stale_generation,
  '10/resumes/test/old.pdf', '{"father_en":"wrong"}'::jsonb,
  '{}'::jsonb, '{"learningHistory":[],"references":[],"additionalSections":[]}'::jsonb,
  4::smallint
) as stale_apply \gset
select public.release_ai_reread_attempt(:account_id, :stale_attempt, :stale_generation);
insert into results
select 'older file identity is rejected after a newer upload',
  (:'stale_apply'::jsonb ->> 'outcome') = 'stale_file'
  and (select father_en from public.shidduchim where id = :shidduch_id) = 'New father',
  :'stale_apply';

insert into results
select 'completed inference consumes one ledger unit',
  (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 1
  and (select status from public.ai_reread_attempts where id = :attempt_id) = 'completed',
  'completed apply is charged';

insert into results
select 'resume read RPC is service-role only',
  has_function_privilege(
    'authenticated',
    'public.apply_ai_resume_read(bigint,bigint,bigint,bigint,text,jsonb,jsonb,jsonb,smallint)',
    'execute'
  ) = false,
  'pg_proc privilege assertion';

select jsonb_agg(to_jsonb(results) order by name) from results;
rollback;
