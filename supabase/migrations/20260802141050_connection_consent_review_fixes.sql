-- Story 8.2 review fixes (F4, F5): `end_connection()` and
-- `revoke_connection_invite()` used to accept ANY active membership of a
-- party/the inviter, while `end_connection()` separately stamped
-- `ended_by_account_id` from `current_context_id()` — two different notions
-- of "who is acting" in one statement, proven live to let a caller acting
-- under an unrelated active context end (or revoke) a connection/invite
-- belonging to an account they merely also hold a membership in. Both now
-- require the caller's ACTIVE CONTEXT itself to be the party/the inviter,
-- matching every sibling writer's own "active member of
-- current_context_id()" idiom and the FakeRest mirrors, which already
-- required this (`providers/fakerest/internal/connections.ts`). Generated
-- by `supabase db diff` — no hand edits.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.end_connection(p_connection_id bigint)
 RETURNS public.connections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_connection public.connections;
  v_actor_account_id bigint := public.current_context_id();
begin
  select * into v_connection from public.connections where id = p_connection_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id not in (v_connection.household_account_id, v_connection.shadchanus_account_id)
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'connection % not found', p_connection_id;
  end if;

  if v_connection.status = 'ended' then
    raise exception 'connection % has already ended', p_connection_id
      using errcode = 'check_violation';
  end if;

  update public.connections
  set status = 'ended', ended_at = now(), ended_by_account_id = v_actor_account_id
  where id = p_connection_id
  returning * into v_connection;

  return v_connection;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_connection_invite(p_invite_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.connection_invites;
  v_actor_account_id bigint := public.current_context_id();
begin
  select * into v_invite from public.connection_invites where id = p_invite_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_invite.inviter_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'connection invite % not found', p_invite_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'connection invite % is not pending (status %)', p_invite_id, v_invite.status
      using errcode = 'check_violation';
  end if;

  update public.connection_invites
  set status = 'revoked', revoked_at = now()
  where id = p_invite_id;
end;
$function$
;


