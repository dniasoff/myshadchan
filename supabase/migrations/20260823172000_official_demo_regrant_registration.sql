-- Active demo regrant registration override.

-- 20260823172000

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."regrant_child_grant"("p_grant_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_old_grant public.child_grants;
  v_new_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_run_id bigint;
  v_token text;
begin
  select * into v_old_grant from public.child_grants where id = p_grant_id for update;
  select account_id into v_target_account_id
  from public.singles where id = v_old_grant.target_single_id;
  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_old_grant.proposer_account_id
     or v_target_account_id is null
     or not exists (
       select 1 from public.account_members am
       where am.account_id = v_actor_account_id and am.user_id = auth.uid()
         and am.status = 'active' and am.role in ('parent_admin', 'self_manager')
     ) then
    raise exception 'child grant % not found or not authorized to re-grant', p_grant_id;
  end if;
  if v_old_grant.status not in ('severed', 'revoked', 'expired') then
    raise exception 'child grant % cannot be re-granted (status %)', p_grant_id, v_old_grant.status
      using errcode = 'check_violation';
  end if;

  -- An active demo regrant is an interaction on a manifest-owned graph.  The
  -- actor and both endpoints must resolve to the same run before the new row
  -- is inserted; the row and manifest receipt then commit together.
  select dr.id into v_run_id
  from public.demo_runs dr
  join public.demo_run_accounts dra on dra.run_id = dr.id
  where dr.status = 'active' and dra.account_id = v_actor_account_id
  order by dr.id desc limit 1;
  if v_run_id is not null then
    perform public.demo_assert_same_active_run(
      array[v_actor_account_id, v_old_grant.proposer_account_id, v_target_account_id],
      'child grant re-grant'
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at, access_level
  ) values (
    v_old_grant.proposer_account_id, v_old_grant.target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days',
    v_old_grant.access_level
  ) returning * into v_new_grant;
  if v_run_id is not null then
    insert into public.demo_run_resources (run_id, resource_type, resource_id)
    values (v_run_id, 'child_grant', v_new_grant.id);
  end if;
  return v_token;
end;
$$;

set check_function_bodies = on;
