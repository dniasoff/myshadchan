-- 9ys follow-up: serialize every undo caller/owner pair in one account order.
-- The preceding parent-first repair still took the target owner account before
-- demo_storage_write_fence() took the caller account. Reciprocal accepted edit
-- grants could therefore hold those two account locks in opposite order.

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
  v_lock_account_id bigint;
  v_row public.shidduchim;
  v_transition public.shidduch_stage_transitions;
  v_latest public.shidduch_stage_transitions;
  v_original_id bigint;
begin
  v_service_role := coalesce(auth.role(), '') = 'service_role';
  v_account_id := public.current_context_id();
  v_role := public.current_member_role();
  v_member_id := public.current_member_id();

  -- A missing active context includes anonymous and pending memberships.  The
  -- demo fence below is shared with other customer writes: a clearing/expired
  -- demo must not accept a stale browser undo.
  if v_account_id is null
     or (not v_service_role and (auth.uid() is null or v_role is null or v_role = 'single')) then
    raise exception 'undo is not available for shidduch %', p_id
      using errcode = 'insufficient_privilege';
  end if;

  select s.account_id into v_shidduch_account_id
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Match account_storage_cleanup_fence(): all target-account parent rows
  -- (singles, then shidduchim in id order) come before any account lock. This
  -- preserves the purge/undo order. Once those parents are held, take both
  -- the caller and owner account locks in ascending id order. The FOR UPDATE
  -- account lock is the strongest mode needed by either side, so the later
  -- demo fence's FOR KEY SHARE is re-entrant and cannot create an owner/caller
  -- lock cycle.
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

  for v_lock_account_id in
    select lock_account_id
    from (
      values (v_shidduch_account_id), (v_account_id)
    ) as lock_accounts(lock_account_id)
    where lock_account_id is not null
    group by lock_account_id
    order by lock_account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
    perform 1
    from public.accounts a
    where a.id = v_lock_account_id
    for update;
  end loop;

  -- demo_storage_write_fence() takes the caller account row FOR KEY SHARE. It
  -- runs after the parent-first locks and after both account rows are already
  -- held FOR UPDATE, so it cannot invert the deterministic account order.
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

  -- Re-read the caller and authorization while holding both locks.  This is
  -- intentionally the same owner/accepted-edit-grant/halachic gate as
  -- transition_shidduch(), not a broader "can see the row" check.
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

  -- The latest history row must be this actor's still-live move.  Looking at
  -- the global latest row, rather than merely this actor's latest row, makes a
  -- move by another device or actor stale-safe as well.
  select h.* into v_latest
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
  order by h.id desc
  limit 1
  for update;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  -- A repeated request after a completed undo is harmless and returns the
  -- already-restored row.  It never opens a second reverse transition.
  if v_latest.undo_of_id is not null then
    if v_latest.actor_member_id is not distinct from v_member_id then
      return query select * from public.shidduch_row(p_id);
      return;
    end if;
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  v_transition := v_latest;

  if v_transition.actor_member_id is distinct from v_member_id
     or v_transition.undone_at is not null
     or v_transition.created_at < clock_timestamp() - interval '15 seconds'
     or v_row.pipeline_state is distinct from v_transition.to_state
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

revoke all on function public.undo_shidduch(bigint) from public, anon;
grant execute on function public.undo_shidduch(bigint) to authenticated;
grant execute on function public.undo_shidduch(bigint) to service_role;
