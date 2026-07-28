set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_invite_capable_role(p_role text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_role in ('parent_admin', 'self_manager', 'shadchan');
$function$
;

revoke all on function public.is_invite_capable_role(text) from public, anon;

grant execute on function public.is_invite_capable_role(text) to authenticated;

grant execute on function public.is_invite_capable_role(text) to service_role;

CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_caller_role text;
  v_invite public.invites;
begin
  v_account_id := public.current_context_id();

  select i.* into v_invite
  from public.invites i
  where i.id = p_invite_id and i.account_id = v_account_id;

  if not found then
    raise exception 'invite % not found in current context', p_invite_id;
  end if;

  select am.role into v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = auth.uid()
    and am.status = 'active';

  if v_caller_role is null or not public.is_invite_capable_role(v_caller_role) then
    raise exception 'role % may not revoke invites', v_caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite % is not pending (status %)', p_invite_id, v_invite.status
      using errcode = 'check_violation';
  end if;

  update public.invites set status = 'revoked' where id = p_invite_id;
end;
$function$
;

revoke all on function public.revoke_invite(bigint) from public, anon;

grant execute on function public.revoke_invite(bigint) to authenticated;

grant execute on function public.revoke_invite(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.create_invite(p_email text, p_role text)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_membership_id bigint;
  v_caller_role text;
  v_account_kind text;
  v_invite public.invites;
begin
  v_account_id := public.current_context_id();

  select am.id, am.role into v_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = auth.uid()
    and am.status = 'active';

  if v_membership_id is null then
    raise exception 'no active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_invite_capable_role(v_caller_role) then
    raise exception 'role % may not send invites', v_caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if public.role_authority(p_role) > public.role_authority(v_caller_role) then
    raise exception 'cannot invite role % above your own authority', p_role
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_account_kind from public.accounts where id = v_account_id;

  if v_account_kind = 'household' and p_role not in ('parent_admin', 'helper', 'single') then
    raise exception 'role % is not invitable into a household-kind account', p_role
      using errcode = 'check_violation';
  end if;

  if v_account_kind = 'shadchanus' and p_role <> 'shadchan' then
    raise exception 'role % is not invitable into a shadchanus-kind account', p_role
      using errcode = 'check_violation';
  end if;

  insert into public.invites (email, account_id, role, invited_by)
  values (p_email, v_account_id, p_role, v_membership_id)
  returning * into v_invite;

  return v_invite;
end;
$function$
;


