set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.accept_demo_invite(p_run_id bigint, p_lease_token text, p_token uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_headers jsonb;
  v_invite public.invites;
  v_actor_email text;
  v_membership_id bigint;
begin
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  if coalesce(auth.role(), '') <> 'service_role'
     or p_run_id is null
     or p_lease_token is null
     or p_token is null
     or p_actor_user_id is null
     or coalesce(v_headers->>'x-demo-run-id', v_headers->>'X-Demo-Run-Id', '') <> p_run_id::text
     or coalesce(v_headers->>'x-demo-lease-token', v_headers->>'X-Demo-Lease-Token', '') <> p_lease_token
     or not public.demo_seed_service_authorized() then
    raise exception 'demo invite acceptance requires the exact seed service lease'
      using errcode = 'insufficient_privilege';
  end if;

  select i.* into v_invite
  from public.invites i
  where i.token = p_token;

  if not found then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.demo_run_accounts dra
    where dra.run_id = p_run_id and dra.account_id = v_invite.account_id
  ) then
    raise exception 'demo invite does not belong to the exact seed run'
      using errcode = 'check_violation';
  end if;

  select email into v_actor_email
  from auth.users
  where id = p_actor_user_id;
  if v_actor_email is null or lower(v_actor_email) <> lower(v_invite.email) then
    raise exception 'demo invite actor email does not match the invite'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.demo_run_users dru
    where dru.run_id = p_run_id and dru.user_id = p_actor_user_id
  ) then
    raise exception 'demo invite actor is not registered in the exact seed run'
      using errcode = 'check_violation';
  end if;

  if v_invite.status = 'accepted' and exists (
    select 1 from public.account_members
    where account_id = v_invite.account_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    return;
  end if;

  if v_invite.expires_at <= clock_timestamp() then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if v_invite.role = 'single' and v_invite.target_single_id is null then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  perform public.demo_assert_same_active_run(
    array[v_invite.account_id],
    'demo membership invite acceptance'
  );

  update public.invites
  set status = 'accepted', accepted_at = now()
  where id = v_invite.id
    and status = 'pending'
    and expires_at > clock_timestamp();

  if not found then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  insert into public.account_members (account_id, user_id, role, invited_by, status)
  values (v_invite.account_id, p_actor_user_id, v_invite.role, v_invite.invited_by, 'active')
  returning id into v_membership_id;

  if v_invite.target_single_id is not null then
    update public.singles
    set member_id = v_membership_id
    where id = v_invite.target_single_id
      and account_id = v_invite.account_id
      and member_id is null;

    if not found then
      raise exception 'single % is already linked to a login, or does not belong to this household', v_invite.target_single_id
        using errcode = 'check_violation';
    end if;
  end if;
end;
$function$
;

revoke all on function public.accept_demo_invite(bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_demo_invite(bigint, text, uuid, uuid) to service_role;
