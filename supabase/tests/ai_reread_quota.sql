-- B2a re-read ledger: idempotency, one-flight, quota release/fencing and
-- service-role-only access. Every assertion runs in one transaction and the
-- final rollback leaves the local database unchanged.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

insert into public.accounts (name, kind)
values ('Re-read quota test account', 'household')
returning id as account_id \gset
insert into public.subscription (account_id, plan, status)
values (:account_id, 'ai', 'active');
insert into public.singles (account_id, first_name_en)
values (:account_id, 'Re-read test single')
returning id as single_id \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:account_id, :single_id, 'Re-read test shidduch')
returning id as shidduch_id \gset
insert into public.resumes (account_id, shidduchim_id, files, sections)
values (
  :account_id,
  :shidduch_id,
  '[{"path":"10/resumes/test/current.pdf","filename":"current.pdf","uploaded_at":"2026-01-01T00:00:00Z","mime_type":"application/pdf","size":8}]'::jsonb,
  '{"learningHistory":[{"label":"old","value":"keep"}],"references":[],"additionalSections":[]}'::jsonb
)
returning id as resume_id \gset

-- Fresh claim, same-key replay while live, and a different-key single-flight
-- conflict must all leave exactly one meter unit reserved.
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000001', 4::smallint) as claim_one \gset
insert into results
select 'fresh claim reserves one unit',
  (:'claim_one'::jsonb ->> 'outcome') = 'reserved'
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 1,
  :'claim_one';
select (:'claim_one'::jsonb ->> 'attempt_id')::bigint as attempt_id \gset
select (:'claim_one'::jsonb ->> 'generation')::bigint as generation_one \gset

select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000001', 4::smallint) as same_live \gset
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000002', 4::smallint) as other_live \gset
insert into results
select 'same request is in progress without a second charge',
  (:'same_live'::jsonb ->> 'outcome') = 'in_progress'
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 1,
  :'same_live';
insert into results
select 'different request is busy without a second charge',
  (:'other_live'::jsonb ->> 'outcome') = 'busy'
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 1,
  :'other_live';

select public.complete_ai_reread_attempt(:account_id, :attempt_id, :generation_one, 4::smallint) as completed \gset
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000001', 4::smallint) as replayed \gset
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000001', 3::smallint) as replayed_old_schema \gset
insert into results
select 'completed request replays without a second charge',
  (:'completed'::jsonb ->> 'outcome') = 'applied'
  and (:'replayed'::jsonb ->> 'outcome') = 'replayed'
  and (:'replayed_old_schema'::jsonb ->> 'outcome') = 'replayed'
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 1,
  :'replayed';

-- Release refunds exactly once; retrying the failed request creates generation
-- two and reserves one new unit, reusing the same ledger key.
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000003', 4::smallint) as claim_two \gset
select (:'claim_two'::jsonb ->> 'attempt_id')::bigint as attempt_two \gset
select (:'claim_two'::jsonb ->> 'generation')::bigint as generation_two \gset
select public.release_ai_reread_attempt(:account_id, :attempt_two, :generation_two) as released_two \gset
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000003', 4::smallint) as reclaimed_failed \gset
insert into results
select 'release refunds and failed same-key retry is one new unit',
  (:'released_two'::jsonb ->> 'outcome') = 'applied'
  and (:'reclaimed_failed'::jsonb ->> 'outcome') = 'reserved'
  and (:'reclaimed_failed'::jsonb ->> 'generation')::bigint = :generation_two + 1
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 2,
  :'reclaimed_failed';
select (:'reclaimed_failed'::jsonb ->> 'generation')::bigint as generation_three \gset
select public.release_ai_reread_attempt(:account_id, :attempt_two, :generation_three) as released_three \gset

-- An expired lease is taken over by a new request without charging again;
-- the old generation cannot release the new generation's reservation.
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000004', 4::smallint) as claim_four \gset
select (:'claim_four'::jsonb ->> 'attempt_id')::bigint as attempt_four \gset
select (:'claim_four'::jsonb ->> 'generation')::bigint as generation_four \gset
update public.ai_reread_attempts
set lease_expires_at = now() - interval '1 minute'
where id = :attempt_four;
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000005', 4::smallint) as stale_takeover \gset
select (:'stale_takeover'::jsonb ->> 'generation')::bigint as generation_five \gset
select public.release_ai_reread_attempt(:account_id, :attempt_four, :generation_four) as old_release \gset
insert into results
select 'stale takeover is free and fences the old generation',
  (:'stale_takeover'::jsonb ->> 'outcome') = 'reserved'
  and :generation_five = :generation_four + 1
  and (:'old_release'::jsonb ->> 'outcome') = 'superseded'
  and (select resumes_parsed from public.ai_usage where account_id = :account_id and period = to_char(now(), 'YYYY-MM')) = 2,
  :'stale_takeover';
select public.release_ai_reread_attempt(:account_id, :attempt_four, :generation_five);

-- A full active entitlement refuses without leaving an attempt row behind.
select public.ai_monthly_resume_limit() as monthly_limit \gset
insert into public.ai_usage (account_id, period, resumes_parsed)
values (:account_id, to_char(now(), 'YYYY-MM'), :monthly_limit)
on conflict (account_id, period) do update set resumes_parsed = excluded.resumes_parsed;
select public.claim_ai_reread_attempt(:account_id, :resume_id, '10000000-0000-4000-8000-000000000006', 4::smallint) as no_allowance \gset
insert into results
select 'no allowance leaves no ledger row',
  (:'no_allowance'::jsonb ->> 'outcome') = 'no_allowance'
  and not exists (
    select 1 from public.ai_reread_attempts
    where account_id = :account_id
      and request_id = '10000000-0000-4000-8000-000000000006'
  ),
  :'no_allowance';

-- The trigger fires on the sections update, but a byte-identical references
-- array does not alter canonical reference state. The shidduch is real so the
-- trigger cannot be dismissed as an invalid-row exception.
insert into public."references" (account_id, name_en, relationship, phone)
values (:account_id, 'Existing Reference', 'friend', '555-0100')
returning id as reference_id \gset
insert into public.reference_links
  (account_id, reference_id, shidduchim_id, resume_id, call_status, what_they_said, conversation_log)
values (:account_id, :reference_id, :shidduch_id, :resume_id, 'answered', 'keep this note', '{"events":1}'::jsonb)
returning id as link_id \gset
update public.resumes
set sections = sections || '{"additionalSections":[{"title":"Work","items":[]}]}'::jsonb
where id = :resume_id;
insert into results
select 'sections update leaves canonical references, statuses, notes and links unchanged',
  (select count(*) from public."references" where id = :reference_id) = 1
  and (select count(*) from public.reference_links where id = :link_id) = 1
  and (select call_status from public.reference_links where id = :link_id) = 'answered'
  and (select what_they_said from public.reference_links where id = :link_id) = 'keep this note'
  and (select conversation_log from public.reference_links where id = :link_id) = '{"events":1}'::jsonb
  and (select sections -> 'references' from public.resumes where id = :resume_id) = '[]'::jsonb,
  'reference sync no-op';

-- No client path: FORCE RLS, zero policies, no direct table privileges and no
-- execute privilege for the three SECURITY DEFINER RPCs.
insert into results
select 'ledger is FORCE RLS with no policies',
  (select relforcerowsecurity from pg_class where oid = 'public.ai_reread_attempts'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_reread_attempts'),
  'pg_class / pg_policies';

select gen_random_uuid() as test_user_id \gset
insert into auth.users (id, instance_id, aud, role, email)
values (:'test_user_id'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reread-quota-perm@test.local');
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, :'test_user_id'::uuid, 'parent_admin', 'active');
set local role authenticated;
set local request.jwt.claims = '{"sub":":test_user_id","role":"authenticated"}';
do $$
begin
  begin
    perform public.claim_ai_reread_attempt(1, 1, '10000000-0000-4000-8000-000000000007', 4::smallint);
    insert into results values ('authenticated cannot execute re-read claim', false, 'unexpected success');
  exception when insufficient_privilege then
    insert into results values ('authenticated cannot execute re-read claim', true, sqlerrm);
  end;
  begin
    perform count(*) from public.ai_reread_attempts;
    insert into results values ('authenticated cannot select re-read ledger', false, 'unexpected success');
  exception when insufficient_privilege then
    insert into results values ('authenticated cannot select re-read ledger', true, sqlerrm);
  end;
end $$;
reset role;

select jsonb_agg(to_jsonb(results) order by name) from results;
rollback;
