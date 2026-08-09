alter table "public"."singles" add constraint "singles_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text]))) not valid;

alter table "public"."singles" validate constraint "singles_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.remove_persona_admin(p_target_account_member_id bigint, p_target_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_account_id bigint;
  v_caller_role text;
  v_caller_membership_id bigint;
  v_target_membership public.account_members;
  v_target_single_id bigint;
  v_target_single_member_id bigint;
  v_holds_single boolean;
  v_other_singles_count int;
  v_other_admins_count int;
  v_archived_account_id bigint;
  v_was_active boolean;
  v_new_active_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'remove_persona_admin requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_target_type not in ('member', 'single') then
    raise exception 'unknown target_type: %', p_target_type
      using errcode = 'invalid_parameter_value';
  end if;

  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no active context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Caller must be parent_admin in this account
  select am.id, am.role into v_caller_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = v_user_id
    and am.status = 'active'
  order by am.id
  limit 1;

  if v_caller_membership_id is null or v_caller_role <> 'parent_admin' then
    raise exception 'only a parent_admin may remove another person'
      using errcode = 'insufficient_privilege';
  end if;

  -- Target must be in the same account
  select * into v_target_membership
  from public.account_members
  where id = p_target_account_member_id
    and account_id = v_account_id;

  if not found then
    raise exception 'target membership % not found in this household', p_target_account_member_id
      using errcode = 'check_violation';
  end if;

  -- Cannot remove yourself via this path (use remove_persona() instead)
  if v_target_membership.user_id = v_user_id then
    raise exception 'use remove_persona() to remove your own persona'
      using errcode = 'check_violation';
  end if;

  -- member branch: archive the target's account_members row
  if p_target_type = 'member' then
    if v_target_membership.status = 'active' then
      -- Refuse if this would orphan the account (reuse guard_persona_removal)
      perform public.guard_persona_removal(v_target_membership.id, v_account_id);
      update public.account_members set status = 'archived' where id = v_target_membership.id;
      v_archived_account_id := v_account_id;
    end if;
  end if;

  -- single branch: archive the target's singles row (if they have one linked to this membership)
  if p_target_type = 'single' then
    select s.id, s.member_id into v_target_single_id, v_target_single_member_id
    from public.singles s
    where s.member_id = v_target_membership.id
      and s.account_id = v_account_id
      and s.status = 'active'
    order by s.id
    limit 1;

    if v_target_single_id is not null then
      -- If the target membership holds a single, check the parent guard
      -- (cannot remove parent_admin if other active singles exist and no other admin)
      select exists (
        select 1 from public.singles
        where member_id = v_target_membership.id and status = 'active'
      ) into v_holds_single;

      select count(*) into v_other_singles_count
      from public.singles
      where account_id = v_account_id
        and status = 'active'
        and member_id is distinct from v_target_membership.id;

      select count(*) into v_other_admins_count
      from public.account_members
      where account_id = v_account_id
        and status = 'active'
        and role = 'parent_admin'
        and id <> v_caller_membership_id;

      if v_other_singles_count > 0 and v_other_admins_count = 0 then
        raise exception 'cannot remove single — no other admin manages this household''s other singles'
          using errcode = 'check_violation';
      end if;

      update public.singles set status = 'archived' where id = v_target_single_id;
    end if;
  end if;

  -- AC-7: if a membership was just archived and it was the target's active
  -- context, we do NOT switch the target's context here — the target's own
  -- member_state is theirs to manage. We only handle the CALLER's context
  -- handoff if the caller archived their own membership (which this function
  -- prevents above). The target's context will naturally fail closed on their
  -- next request (current_context_id() requires status='active').
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_persona_admin(p_target_account_member_id bigint, p_target_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_account_id bigint;
  v_caller_role text;
  v_caller_membership_id bigint;
  v_target_membership public.account_members;
  v_target_single_id bigint;
begin
  if v_user_id is null then
    raise exception 'restore_persona_admin requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_target_type not in ('member', 'single') then
    raise exception 'unknown target_type: %', p_target_type
      using errcode = 'invalid_parameter_value';
  end if;

  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no active context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Caller must be parent_admin in this account
  select am.id, am.role into v_caller_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = v_user_id
    and am.status = 'active'
  order by am.id
  limit 1;

  if v_caller_membership_id is null or v_caller_role <> 'parent_admin' then
    raise exception 'only a parent_admin may restore a person'
      using errcode = 'insufficient_privilege';
  end if;

  -- Target must be in the same account
  select * into v_target_membership
  from public.account_members
  where id = p_target_account_member_id
    and account_id = v_account_id;

  if not found then
    raise exception 'target membership % not found in this household', p_target_account_member_id
      using errcode = 'check_violation';
  end if;

  -- member branch: restore the target's account_members row
  if p_target_type = 'member' then
    if v_target_membership.status = 'archived' then
      update public.account_members set status = 'active' where id = v_target_membership.id;
      -- Also restore any singles row linked to this membership
      update public.singles
      set status = 'active'
      where member_id = v_target_membership.id
        and account_id = v_account_id
        and status = 'archived';
    end if;
  end if;

  -- single branch: restore the target's singles row
  if p_target_type = 'single' then
    select s.id into v_target_single_id
    from public.singles s
    where s.member_id = v_target_membership.id
      and s.account_id = v_account_id
      and s.status = 'archived'
    order by s.id
    limit 1;

    if v_target_single_id is not null then
      update public.singles set status = 'active' where id = v_target_single_id;
    end if;
  end if;
end;
$function$
;


