drop function if exists "public"."create_child_grant"(p_target_single_id bigint, p_grantee_email text);

drop function if exists "public"."preview_child_grant"(p_token text);

alter table "public"."child_grants" add column "access_level" text not null default 'read'::text;

alter table "public"."child_grants" add constraint "child_grants_access_level_check" CHECK ((access_level = ANY (ARRAY['read'::text, 'comment'::text, 'edit'::text]))) not valid;

alter table "public"."child_grants" validate constraint "child_grants_access_level_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_child_grant(p_target_single_id bigint, p_grantee_email text, p_access_level text DEFAULT 'read'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposer_account_id bigint := public.current_context_id();
  v_proposer_kind text;
  v_token text;
  v_single public.singles;
  v_member_role text;
begin
  -- Validated early, ahead of the authorization checks below: a malformed
  -- access_level is a caller bug, not an authorization question, and the
  -- CHECK constraint on child_grants would otherwise report it as an opaque
  -- constraint-violation instead of this clear message.
  if p_access_level not in ('read', 'comment', 'edit') then
    raise exception 'access_level must be one of read, comment, edit (got %)', p_access_level
      using errcode = 'check_violation';
  end if;

  -- Caller must be an active member of the current context with owning role
  if v_proposer_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_proposer_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'create_child_grant requires an active parent_admin or self_manager membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Current context must be a household (grants are household-to-household)
  select kind into v_proposer_kind from public.accounts where id = v_proposer_account_id;
  if v_proposer_kind <> 'household' then
    raise exception 'grants can only be proposed from a household context'
      using errcode = 'check_violation';
  end if;

  -- Target single must exist and belong to the proposer's account
  select * into v_single
  from public.singles
  where id = p_target_single_id
    and account_id = v_proposer_account_id;

  if not found then
    raise exception 'single % not found in this household', p_target_single_id
      using errcode = 'check_violation';
  end if;

  -- Generate token and store hash
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at, access_level
  ) values (
    v_proposer_account_id, p_target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days',
    p_access_level
  );

  return v_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_child_grant_access(p_grant_id bigint, p_access_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
begin
  if p_access_level not in ('read', 'comment', 'edit') then
    raise exception 'access_level must be one of read, comment, edit (got %)', p_access_level
      using errcode = 'check_violation';
  end if;

  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'accepted' then
    raise exception 'child grant % is not accepted (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set access_level = p_access_level
  where id = p_grant_id;
end;
$function$
;

revoke all on function public.update_child_grant_access(bigint, text) from public, anon;
grant execute on function public.update_child_grant_access(bigint, text) to authenticated;
grant execute on function public.update_child_grant_access(bigint, text) to service_role;


CREATE OR REPLACE FUNCTION public.preview_child_grant(p_token text)
 RETURNS TABLE(proposer_name text, target_single_name_en text, target_single_name_he text, status text, expires_at timestamp with time zone, access_level text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.name, s.first_name_en, s.first_name_he, cg.status, cg.expires_at, cg.access_level
  from public.child_grants cg
  join public.accounts a on a.id = cg.proposer_account_id
  join public.singles s on s.id = cg.target_single_id and s.account_id = cg.proposer_account_id
  where cg.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and cg.status = 'pending'
    and cg.expires_at > now();
$function$
;

CREATE OR REPLACE FUNCTION public.regrant_child_grant(p_grant_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_token text;
begin
  select * into v_old_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_old_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found or not authorized to re-grant', p_grant_id;
  end if;

  if v_old_grant.status not in ('severed', 'revoked', 'expired') then
    raise exception 'child grant % cannot be re-granted (status %)', p_grant_id, v_old_grant.status
      using errcode = 'check_violation';
  end if;

  -- Generate new token for the re-grant
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at, access_level
  ) values (
    v_old_grant.proposer_account_id, v_old_grant.target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days',
    v_old_grant.access_level
  );

  return v_token;
end;
$function$
;


