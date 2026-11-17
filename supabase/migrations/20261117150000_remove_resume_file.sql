-- Per-file Resume-tab deletion. The catalog mutation and durable Storage
-- purge enqueue are one transaction; the client owns only the Undo window.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.remove_resume_file(
  p_resume_id bigint,
  p_path text
) RETURNS SETOF public.resumes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_parent_id bigint;
  v_resume public.resumes;
  v_file jsonb;
  v_files jsonb;
  v_remaining jsonb;
begin
  if v_account_id is null
     or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'remove_resume_file requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;

  if p_resume_id is null or p_path is null or p_path = '' then
    raise exception 'resume file not found'
      using errcode = 'no_data';
  end if;

  -- Lock the shidduch parent before the resume row. Uploads take the same
  -- parent-first order, so a late catalog append cannot race this removal.
  select s.id into v_parent_id
  from public.shidduchim s
  where s.account_id = v_account_id
    and exists (
      select 1
      from public.resumes r
      where r.id = p_resume_id
        and r.account_id = v_account_id
        and r.shidduchim_id = s.id
    )
  for update;
  if v_parent_id is null then
    raise exception 'resume not found'
      using errcode = 'no_data';
  end if;
  perform public.account_storage_lock(v_account_id);

  select r.* into v_resume
  from public.resumes r
  where r.id = p_resume_id
    and r.account_id = v_account_id
    and r.shidduchim_id = v_parent_id
  for update;
  if not found then
    raise exception 'resume not found'
      using errcode = 'no_data';
  end if;

  v_files := case
    when jsonb_typeof(v_resume.files) = 'array' then v_resume.files
    else '[]'::jsonb
  end;
  select f.value into v_file
  from jsonb_array_elements(v_files) f(value)
  where f.value->>'path' = p_path
  limit 1;

  if v_file is null then
    -- A retry after this function already won is safe and does not enqueue a
    -- second object. A genuinely unknown path remains a visible no-data error.
    if exists (
      select 1
      from public.storage_purge_queue q
      where q.account_id = v_account_id
        and q.kind = 'object'
        and q.bucket = 'documents'
        and q.storage_path = p_path
    ) then
      return next v_resume;
      return;
    end if;
    raise exception 'resume file not found'
      using errcode = 'no_data';
  end if;

  if exists (
    select 1
    from public.ai_reread_attempts a
    where a.account_id = v_account_id
      and a.resume_id = v_resume.id
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  ) then
    raise exception 'Please wait: this resume is being made easy to read.'
      using errcode = '55P03';
  end if;

  if p_path !~ ('^' || v_account_id::text || '/resumes/' || v_parent_id::text || '/[^/]+$')
     or p_path ~ '(^|/)(\.\.?)($|/)'
     or p_path ~ '[*?]' then
    raise exception 'resume file path is not removable'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(f.value order by f.ordinality), '[]'::jsonb)
    into v_remaining
  from jsonb_array_elements(v_files) with ordinality f(value, ordinality)
  where f.value->>'path' is distinct from p_path;

  update public.resumes
  set files = v_remaining
  where id = v_resume.id
  returning * into v_resume;

  perform public.storage_purge_queue_object(v_account_id, 'documents', p_path);
  if not exists (
    select 1
    from public.storage_purge_queue q
    where q.account_id = v_account_id
      and q.kind = 'object'
      and q.bucket = 'documents'
      and q.storage_path = p_path
  ) then
    raise exception 'resume file cleanup could not be queued'
      using errcode = 'check_violation';
  end if;

  return next v_resume;
  return;
end;
$function$;

revoke all on function public.remove_resume_file(bigint, text) from public, anon;
grant execute on function public.remove_resume_file(bigint, text) to authenticated;
grant execute on function public.remove_resume_file(bigint, text) to service_role;
