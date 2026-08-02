set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_thread_visibility(p_thread_id bigint, p_visibility text)
 RETURNS public.threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread public.threads;
begin
  if p_visibility not in ('open', 'private') then
    raise exception 'invalid thread visibility: %', p_visibility
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.thread_is_readable(p_thread_id) then
    raise exception 'thread % not found or not readable in current context', p_thread_id
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.member_id = public.current_member_id()
  ) then
    raise exception 'only a listed participant of this thread may change its visibility'
      using errcode = 'insufficient_privilege';
  end if;

  update public.threads
  set visibility = p_visibility
  where id = p_thread_id
  returning * into v_thread;

  return v_thread;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.thread_is_readable(p_thread_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread public.threads;
begin
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    return false;
  end if;

  -- The connection axis is unreachable to `authenticated` until Story 7.4
  -- opens it — failing closed here means 7.4 is a pure widening with
  -- nothing to un-leak.
  if v_thread.connection_id is not null then
    return false;
  end if;

  -- `is distinct from`, not `<>`: a NULL current_context_id() (no active
  -- context) must deny, not silently fall through to `true` the way a
  -- NULL-yielding `<>` comparison would inside an `if`.
  if v_thread.account_id is distinct from public.current_context_id() then
    return false;
  end if;

  -- Story 7.3 (AC-2, AC-3, AC-6): private beats scope AND beats the
  -- dignity-floor branch below — this IS the whole answer for a private
  -- thread, nothing else narrows or widens it.
  if v_thread.visibility = 'private' then
    return exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.member_id = public.current_member_id()
    );
  end if;

  if v_thread.subject_type = 'shidduch' and public.current_member_role() = 'single' then
    return exists (
      select 1
      from public.shidduchim s
      where s.id = v_thread.subject_id
        and s.visibility = 'shared'
        and public.is_single_visible_state(s.pipeline_state)
        and exists (
          select 1 from public.singles c
          where c.id = s.single_id and c.member_id = public.current_member_id()
        )
    );
  end if;

  return true;
end;
$function$
;

-- `db diff` never re-emits function grants for a NEW function signature
-- (Story 7.1's own hard-won lesson, repeated here) — hand-added, matching
-- 06_grants.sql. thread_is_readable() already carries its grants from
-- Story 7.1's migration; only set_thread_visibility() is new here.
revoke all on function public.set_thread_visibility(bigint, text) from public, anon;
grant execute on function public.set_thread_visibility(bigint, text) to authenticated;
grant execute on function public.set_thread_visibility(bigint, text) to service_role;

