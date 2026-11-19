-- 6o9: 5xr revoked the base-table UPDATE privilege that the invoker RPC
-- relied on. Keep shidduchim RPC-only and move the pre-5xr update policy into
-- the function before the SECURITY DEFINER write.
CREATE OR REPLACE FUNCTION "public"."transition_shidduch"("p_id" bigint, "p_from" "public"."pipeline_state", "p_to" "public"."pipeline_state", "p_close_reason" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."shidduchim"
    SECURITY DEFINER
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_role text;
  v_service_role boolean;
  v_current public.pipeline_state;
  v_close_reason text;
  v_row public.shidduchim;
begin
  v_service_role := coalesce(auth.role(), '') = 'service_role';
  v_account_id := public.current_context_id();
  v_role := public.current_member_role();

  -- 5xr deliberately removed authenticated INSERT/DELETE/UPDATE on the base
  -- table. SECURITY DEFINER is the RPC-only write door; these checks restate
  -- the old UPDATE RLS policy before the definer writes, so the door does not
  -- widen account, role, grant, or halachic visibility.
  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  if not v_service_role then
    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single' then
      raise exception 'shidduch % not found', p_id;
    end if;

    if v_row.account_id is distinct from v_account_id then
      if not exists (
        select 1 from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
      ) or v_row.account_id is distinct from (
        select g.proposer_account_id
        from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
        limit 1
      ) then
        raise exception 'shidduch % not found', p_id;
      end if;
    end if;

    if coalesce(public.shidduch_has_known_halachic_conflict(
      v_row.single_id,
      v_row.person_gender,
      v_row.kohen_status,
      v_row.marital_status
    ), false) then
      raise exception 'shidduch % not found', p_id;
    end if;
  end if;

  -- Lock and re-read after the policy-equivalent checks. account_id is
  -- immutable to authenticated callers, and the trigger still enforces the
  -- legal transition graph on the locked row.
  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id
  for update;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Re-evaluate the policy-equivalent authorization while holding the row
  -- lock. A grant, membership role, or account association may have changed
  -- while the first check waited for this lock.
  if not v_service_role then
    v_account_id := public.current_context_id();
    v_role := public.current_member_role();
    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single' then
      raise exception 'shidduch % not found', p_id;
    end if;

    if v_row.account_id is distinct from v_account_id then
      if not exists (
        select 1 from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
      ) or v_row.account_id is distinct from (
        select g.proposer_account_id
        from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
        limit 1
      ) then
        raise exception 'shidduch % not found', p_id;
      end if;
    end if;

    if coalesce(public.shidduch_has_known_halachic_conflict(
      v_row.single_id,
      v_row.person_gender,
      v_row.kohen_status,
      v_row.marital_status
    ), false) then
      raise exception 'shidduch % not found', p_id;
    end if;
  end if;

  v_current := v_row.pipeline_state;

  if v_current is distinct from p_from then
    raise exception 'stale transition: shidduch % is in state %, not %', p_id, v_current, p_from
      using errcode = 'serialization_failure';
  end if;

  if p_from is not distinct from p_to then
    return query select * from public.shidduch_row(p_id);
    return;
  end if;

  if not exists (
    select 1 from public.pipeline_transitions t
    where t.from_state = p_from and t.to_state = p_to
  ) then
    raise exception 'illegal pipeline transition: % -> %', p_from, p_to
      using errcode = 'check_violation';
  end if;

  -- SECURITY DEFINER can read the protected close_reason value directly.
  -- shidduch_row() remains the return projection, preserving its existing
  -- account-scoped close_reason behavior for accepted child grants.
  v_close_reason := v_row.close_reason;

  update public.shidduchim
  set pipeline_state = p_to,
      close_reason = case
        when p_to in ('for_sure_not', 'yes', 'unsure', 'no') then coalesce(p_close_reason, v_close_reason)
        else null
      end
  where id = p_id;

  if not found then
    return;
  end if;

  return query select * from public.shidduch_row(p_id);
end;
$$;

-- The RPC is the only authenticated stage-change door. Re-state its ACL here
-- so a deployed database converges even when this is the only pending file.
revoke all on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) from public, anon;
grant execute on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) to authenticated;
grant execute on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) to service_role;

revoke insert, delete, update on table public.shidduchim from public, anon, authenticated;
grant update (index) on table public.shidduchim to authenticated;
