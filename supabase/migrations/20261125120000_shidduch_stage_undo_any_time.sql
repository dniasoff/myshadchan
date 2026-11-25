-- 9ys follow-up: stage history can be reversed one step at a time at any
-- time. The forward history remains append-only; every reverse is linked to
-- the forward row it consumed through undo_of_id.

CREATE OR REPLACE FUNCTION "public"."undo_shidduch"("p_id" bigint) RETURNS SETOF "public"."shidduchim"
    SECURITY DEFINER
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $function$
declare
  v_account_id bigint;
  v_role text;
  v_member_id bigint;
  v_service_role boolean;
  v_shidduch_account_id bigint;
  v_shidduch_single_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_row public.shidduchim;
  v_transition public.shidduch_stage_transitions;
  v_latest public.shidduch_stage_transitions;
begin
  v_service_role := coalesce(auth.role(), '') = 'service_role';
  v_account_id := public.current_context_id();
  v_role := public.current_member_role();
  v_member_id := public.current_member_id();

  if v_account_id is null
     or (not v_service_role and (auth.uid() is null or v_role is null or v_role = 'single')) then
    raise exception 'undo is not available for shidduch %', p_id
      using errcode = 'insufficient_privilege';
  end if;

  select s.account_id, s.single_id
  into v_shidduch_account_id, v_shidduch_single_id
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Keep the same global order as account_storage_cleanup_fence(): parent
  -- rows (singles, then shidduchim) -> all related account advisory fences ->
  -- all related account rows -> the target shidduch/history rows. Collect
  -- every grant endpoint before taking any account row.
  perform 1
  from public.singles
  where account_id = v_shidduch_account_id
  order by id
  for update;
  perform 1
  from public.shidduchim
  where account_id = v_shidduch_account_id
  order by id
  for update;

  select array_agg(lock_account_id order by lock_account_id)
  into v_lock_accounts
  from (
    select distinct lock_account_id
    from (
      select v_shidduch_account_id as lock_account_id
      union all
      select v_account_id
      union all
      select g.proposer_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
      union all
      select g.grantee_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
      union all
      select g.severed_by_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
    ) as lock_accounts(lock_account_id)
    where lock_account_id is not null
  ) ordered_accounts;

  for v_lock_account_id in
    select unnest(coalesce(v_lock_accounts, array[]::bigint[]))
    order by 1
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  if not public.demo_storage_write_fence(v_account_id) then
    raise exception 'undo is not available for shidduch %', p_id
      using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id
  for update;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Re-check authorization after the locks, using the same gate as
  -- transition_shidduch(). This includes accepted edit child grants and the
  -- halachic conflict guard; it does not require the caller to be the actor
  -- who made the forward move.
  if not v_service_role then
    v_account_id := public.current_context_id();
    v_role := public.current_member_role();
    v_member_id := public.current_member_id();

    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single'
       or not public.demo_storage_write_fence(v_account_id) then
      raise exception 'undo is not available for shidduch %', p_id
        using errcode = 'insufficient_privilege';
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
        raise exception 'undo is not available for shidduch %', p_id
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if coalesce(public.shidduch_has_known_halachic_conflict(
      v_row.single_id,
      v_row.person_gender,
      v_row.kohen_status,
      v_row.marital_status
    ), false) then
      raise exception 'undo is not available for shidduch %', p_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Only forward rows that have not already been reversed are candidates.
  -- Excluding undo rows makes repeated calls walk backwards one step at a
  -- time, while the row lock serializes concurrent callers.
  select h.* into v_latest
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
    and h.undone_at is null
    and h.undo_of_id is null
  order by h.id desc
  limit 1
  for update;

  -- No history left to reverse is a safe no-op for an authorized caller.
  if not found then
    return query select * from public.shidduch_row(p_id);
    return;
  end if;

  v_transition := v_latest;

  if v_row.pipeline_state is distinct from v_transition.to_state
     or v_row.close_reason is distinct from v_transition.produced_close_reason then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  insert into public.shidduch_stage_undo_context (
    transaction_id,
    shidduch_id,
    transition_id,
    actor_member_id,
    from_state,
    to_state
  ) values (
    txid_current(),
    p_id,
    v_transition.id,
    v_member_id,
    v_transition.to_state,
    v_transition.from_state
  );

  update public.shidduchim
  set pipeline_state = v_transition.from_state,
      close_reason = v_transition.previous_close_reason
  where id = p_id
    and pipeline_state = v_transition.to_state
    and close_reason is not distinct from v_transition.produced_close_reason;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  update public.shidduch_stage_transitions
  set undone_at = clock_timestamp()
  where id = v_transition.id
    and undone_at is null;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  delete from public.shidduch_stage_undo_context
  where transaction_id = txid_current()
    and shidduch_id = p_id;

  return query select * from public.shidduch_row(p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION "public"."latest_reversible_shidduch_stage"("p_id" bigint)
RETURNS TABLE("from_state" "public"."pipeline_state", "to_state" "public"."pipeline_state")
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_role text := public.current_member_role();
  v_service_role boolean := coalesce(auth.role(), '') = 'service_role';
  v_row public.shidduchim;
begin
  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    return;
  end if;

  if not v_service_role then
    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single'
       or (
         v_row.account_id is distinct from v_account_id
         and (
           not exists (
             select 1 from public.child_grants g
             where g.status = 'accepted'
               and g.access_level = 'edit'
               and g.grantee_account_id = v_account_id
               and g.target_single_id = v_row.single_id
           )
           or v_row.account_id is distinct from (
             select g.proposer_account_id
             from public.child_grants g
             where g.status = 'accepted'
               and g.access_level = 'edit'
               and g.grantee_account_id = v_account_id
               and g.target_single_id = v_row.single_id
             limit 1
           )
         )
       )
       or coalesce(public.shidduch_has_known_halachic_conflict(
         v_row.single_id,
         v_row.person_gender,
         v_row.kohen_status,
         v_row.marital_status
       ), false) then
      return;
    end if;
  end if;

  return query
  select h.from_state, h.to_state
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
    and h.undone_at is null
    and h.undo_of_id is null
    and v_row.pipeline_state = h.to_state
    and v_row.close_reason is not distinct from h.produced_close_reason
  order by h.id desc
  limit 1;
end;
$function$;

revoke all on function public.latest_reversible_shidduch_stage(bigint) from public, anon;
grant execute on function public.latest_reversible_shidduch_stage(bigint) to authenticated;
grant execute on function public.latest_reversible_shidduch_stage(bigint) to service_role;
