-- The read-state RPC takes a parent FOR SHARE lock before checking the AI
-- lease. PostgreSQL requires a function containing that lock to be VOLATILE;
-- keeping the lock preserves the lifecycle writers' parent-first order.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shidduch_read_in_progress(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_parent_id bigint;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    return false;
  end if;
  select s.id into v_parent_id
  from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for share;
  if v_parent_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.ai_reread_attempts a
    join public.resumes r on r.id = a.resume_id
    where r.shidduchim_id = p_id
      and r.account_id = v_account_id
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  );
end;
$$;

revoke all on function public.shidduch_read_in_progress(bigint) from public, anon;
grant execute on function public.shidduch_read_in_progress(bigint) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resume_read_in_progress(p_resume_id bigint, p_path text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_resume_id bigint;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager')
     or p_resume_id is null or p_path is null then
    return false;
  end if;
  select r.id into v_resume_id
  from public.resumes r
  where r.id = p_resume_id and r.account_id = v_account_id
  for share;
  if v_resume_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.ai_reread_attempts a
    where a.resume_id = v_resume_id
      and (a.file_identity is null or a.file_identity = p_path)
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  );
end;
$$;

revoke all on function public.resume_read_in_progress(bigint, text) from public, anon;
grant execute on function public.resume_read_in_progress(bigint, text) to authenticated, service_role;
