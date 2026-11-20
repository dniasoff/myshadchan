-- Archive shadchanim without breaking suggestion provenance or dependent links.
-- Archived rows are hidden by RLS and active read-path filters; account deletion
-- remains the only hard purge path.

alter table public.shadchanim
    add column if not exists archived_at timestamp with time zone;

drop policy if exists "Shadchanim scoped to account" on public.shadchanim;
drop policy if exists "Shadchanim insert scoped to account" on public.shadchanim;
drop policy if exists "Shadchanim update scoped to account" on public.shadchanim;
create policy "Shadchanim scoped to account" on public.shadchanim
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and archived_at is null
        and public.current_member_role() <> 'single'
    );

create policy "Shadchanim insert scoped to account" on public.shadchanim
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and archived_at is null
        and public.current_member_role() <> 'single'
    );

create policy "Shadchanim update scoped to account" on public.shadchanim
    for update to authenticated
    using (
        account_id = public.current_context_id()
        and archived_at is null
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and archived_at is null
        and public.current_member_role() <> 'single'
    );

drop policy if exists "Shadchanim visible to single" on public.shadchanim;
create policy "Shadchanim visible to single" on public.shadchanim
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and archived_at is null
        and public.current_member_role() = 'single'
    );

-- Shadchan lifecycle is archive-only. The row and all of its links remain
-- restorable; active read paths and reminder label lookups exclude archived
-- rows. The account advisory fence is taken before the shadchan row lock so
-- this path shares the parent-first lifecycle order with account deletion.
CREATE OR REPLACE FUNCTION public.archive_shadchan(p_id bigint)
RETURNS SETOF public.shadchanim
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shadchanim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'archive_shadchan requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.account_storage_lock(v_account_id);
  select s.* into v_row
  from public.shadchanim s
  where s.id = p_id and s.account_id = v_account_id
  for update;

  if not found then
    raise exception 'shadchan not found'
      using errcode = 'P0002';
  end if;
  if v_row.archived_at is not null then
    raise exception 'shadchan is already archived'
      using errcode = 'check_violation';
  end if;

  update public.shadchanim
  set archived_at = clock_timestamp()
  where id = p_id and account_id = v_account_id;

  -- Pending or leased reminder rows must not reach the mail worker while the
  -- target is archived. Restore below changes these rows back to pending so
  -- an Undo re-arms the same due task without creating a duplicate row.
  update public.task_notifications tn
  set status = 'skipped',
      error = 'shadchan archived',
      claimed_at = null,
      next_attempt_at = null
  from public.tasks t
  where tn.task_id = t.id
    and t.account_id = v_account_id
    and t.target_type = 'shadchan'
    and t.target_id = p_id
    and tn.account_id = v_account_id
    and tn.status in ('pending', 'sending');

  return query select * from public.shadchanim
  where id = p_id and account_id = v_account_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.restore_shadchan(p_id bigint)
RETURNS SETOF public.shadchanim
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shadchanim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'restore_shadchan requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.account_storage_lock(v_account_id);
  select s.* into v_row
  from public.shadchanim s
  where s.id = p_id and s.account_id = v_account_id
  for update;

  if not found then
    raise exception 'shadchan not found'
      using errcode = 'P0002';
  end if;

  -- Restore is intentionally idempotent: a repeated Undo is a harmless
  -- success, while an archive attempt above reports its already-archived
  -- state clearly to the caller.
  if v_row.archived_at is not null then
    update public.shadchanim
    set archived_at = null
    where id = p_id and account_id = v_account_id;

    update public.task_notifications tn
    set status = 'pending',
        error = null,
        claimed_at = null,
        next_attempt_at = null
    from public.tasks t
    where tn.task_id = t.id
      and t.account_id = v_account_id
      and t.target_type = 'shadchan'
      and t.target_id = p_id
      and tn.account_id = v_account_id
      and tn.status = 'skipped'
      and tn.error = 'shadchan archived';
  end if;

  return query select * from public.shadchanim
  where id = p_id and account_id = v_account_id;
end;
$$;

create or replace function public.add_redt(
  p_shidduchim_id bigint,
  p_shadchan_id bigint default null,
  p_redt_date date default null,
  p_note text default null
) returns setof public.shidduchim
language plpgsql
set search_path to ''
as $$
declare
  v_account_id bigint;
  v_shidduch_id bigint;
  v_shadchan_archived_at timestamp with time zone;
begin
  v_account_id := public.current_context_id();

  -- Preserve the table RLS denial before taking a locking read. A single can
  -- see this shidduch through its SELECT policy, but cannot lock it; the
  -- explicit denial keeps that authorization contract ahead of the fence.
  if public.current_member_role() = 'single' then
    raise exception 'new row violates row-level security policy for table "redts"'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lifecycle writers use one parent-first order: parent rows, account
  -- advisory lock, then the shadchan row and child rows.
  select s.id into v_shidduch_id
  from public.shidduchim s
  where s.id = p_shidduchim_id
    and s.account_id = v_account_id
  for share;

  if not found then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  perform public.account_storage_lock(v_account_id);

  if p_shadchan_id is not null then
    select s.archived_at into v_shadchan_archived_at
    from public.shadchanim s
    where s.id = p_shadchan_id
      and s.account_id = v_account_id
    for share;

    if not found or v_shadchan_archived_at is not null then
      raise exception 'shadchan % not found in current account', p_shadchan_id;
    end if;
  end if;

  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date, note)
  values (v_account_id, p_shidduchim_id, p_shadchan_id, coalesce(p_redt_date, current_date), p_note);

  return query select * from public.shidduch_row(p_shidduchim_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_shidduch"("p_single_id" bigint, "p_shadchan_id" bigint DEFAULT NULL::bigint, "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_father_en" "text" DEFAULT NULL::"text", "p_father_he" "text" DEFAULT NULL::"text", "p_mother_en" "text" DEFAULT NULL::"text", "p_mother_he" "text" DEFAULT NULL::"text", "p_dob" "date" DEFAULT NULL::"date", "p_background" "text" DEFAULT NULL::"text", "p_marital_status" "text" DEFAULT NULL::"text", "p_existing_children_note" "text" DEFAULT NULL::"text", "p_seminary_en" "text" DEFAULT NULL::"text", "p_seminary_he" "text" DEFAULT NULL::"text", "p_shul_en" "text" DEFAULT NULL::"text", "p_shul_he" "text" DEFAULT NULL::"text", "p_location_en" "text" DEFAULT NULL::"text", "p_location_he" "text" DEFAULT NULL::"text", "p_age" integer DEFAULT NULL::integer, "p_height" "text" DEFAULT NULL::"text", "p_origin" "text" DEFAULT 'manual'::"text", "p_initial_state" "public"."pipeline_state" DEFAULT 'new'::"public"."pipeline_state", "p_visibility" "text" DEFAULT 'shared'::"text", "p_redt_date" "date" DEFAULT NULL::"date", "p_person_gender" "text" DEFAULT NULL::"text", "p_kohen_status" "text" DEFAULT 'unknown'::"text", "p_suggested_by_name" "text" DEFAULT NULL::"text", "p_suggested_by_phone" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."shidduchim"
    SECURITY DEFINER
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_single_id bigint;
  v_owner_member_id bigint;
  v_id bigint;
  v_redt_date date;
  v_gender text;
  v_shadchan_archived_at timestamp with time zone;
begin
  v_account_id := public.current_context_id();
  if public.current_member_role() = 'single' then
    raise exception 'new row violates row-level security policy for table "shidduchim"'
      using errcode = 'insufficient_privilege';
  end if;
  if v_account_id is null then
    raise exception 'no account context for create_shidduch (no account exists)';
  end if;

  if p_initial_state not in ('new', 'look_into', 'not_sure', 'for_sure_not') then
    raise exception 'invalid initial pipeline_state: % (decision states are reachable only from look_into)', p_initial_state
      using errcode = 'check_violation';
  end if;

  -- Lifecycle writers use one parent-first order: parent rows, account
  -- advisory lock, then the shadchan row and child rows.
  select c.id into v_single_id
  from public.singles c
  where c.id = p_single_id
    and c.account_id = v_account_id
  for share;

  if not found then
    raise exception 'single % not found in current account', p_single_id;
  end if;

  perform public.account_storage_lock(v_account_id);

  if p_shadchan_id is not null then
    select s.archived_at into v_shadchan_archived_at
    from public.shadchanim s
    where s.id = p_shadchan_id
      and s.account_id = v_account_id
    for share;

    if not found or v_shadchan_archived_at is not null then
      raise exception 'shadchan % not found in current account', p_shadchan_id;
    end if;
  end if;

  select am.id into v_owner_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  v_redt_date := coalesce(p_redt_date, current_date);

  insert into public.shidduchim (
    account_id, single_id, shadchan_id,
    name_en, name_he,
    father_en, father_he, mother_en, mother_he,
    dob, background, marital_status, existing_children_note,
    seminary_en, seminary_he,
    shul_en, shul_he, location_en, location_he,
    age, height,
    pipeline_state, first_suggested_by, first_suggested_at, redt_date,
    origin, owner_member_id, visibility,
    person_gender, kohen_status, suggested_by_name, suggested_by_phone
  ) values (
    v_account_id, p_single_id, p_shadchan_id,
    p_name_en, p_name_he,
    p_father_en, p_father_he, p_mother_en, p_mother_he,
    p_dob, p_background, p_marital_status, p_existing_children_note,
    p_seminary_en, p_seminary_he,
    p_shul_en, p_shul_he, p_location_en, p_location_he,
    p_age, p_height,
    p_initial_state, p_shadchan_id, v_redt_date, v_redt_date,
    p_origin, v_owner_member_id, p_visibility,
    p_person_gender, p_kohen_status, p_suggested_by_name, p_suggested_by_phone
  )
  returning id into v_id;

  -- The first redt event. The refresh trigger keeps shidduchim.redt_date etc.
  -- in sync as more redts are added.
  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date)
  values (v_account_id, v_id, p_shadchan_id, v_redt_date);

  -- Record the headline seminary/yeshiva as the first education entry. The
  -- prospect is the opposite gender of the single (a match for a girl is a
  -- boy -> yeshiva; a match for a boy is a girl -> seminary). Additional
  -- education entries via add_education().
  if p_seminary_en is not null or p_seminary_he is not null then
    select gender into v_gender from public.singles where id = p_single_id;
    insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en, name_he)
    values (
      v_account_id, v_id,
      case when v_gender = 'male' then 'seminary' else 'yeshiva' end,
      p_seminary_en, p_seminary_he
    );
  end if;

  return query select * from public.shidduch_row(v_id);
end;
$$;

create or replace view public.shidduchim_summary with (security_invoker = on) as
select
    s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
    s.pipeline_state,
    case
        when first_sh.id is not null and first_sh.archived_at is null
            then s.first_suggested_by
    end as first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    public.shidduch_close_reason(s.id) as close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    case when sh.archived_at is null then sh.name end as shadchan_name,
    case when sh.archived_at is null then sh.name_he end as shadchan_name_he,
    c.first_name_en as single_first_name_en,
    c.first_name_he as single_first_name_he,
    c.last_name_en as single_last_name_en,
    c.last_name_he as single_last_name_he,
    count(distinct rl.id) as nb_references,
    count(distinct r.id) as nb_redts,
    coalesce(max(cat.catch_count), 0) as catch_count,
    s.person_gender,
    s.kohen_status,
    s.archived_at,
    s.suggested_by_name,
    s.suggested_by_phone
from public.shidduchim s
    left join public.shadchanim sh on sh.id = s.shadchan_id
    left join public.shadchanim first_sh on first_sh.id = s.first_suggested_by
    left join public.singles c on c.id = s.single_id
    left join public.reference_links rl on rl.shidduchim_id = s.id
    left join public.redts r on r.shidduchim_id = s.id
    left join public.shidduchim_catch_summary cat on cat.shidduchim_id = s.id
where not coalesce(
    public.shidduch_has_known_halachic_conflict(
        s.single_id,
        s.person_gender,
        s.kohen_status,
        s.marital_status
    ),
    false
)
group by s.id, sh.archived_at, sh.name, sh.name_he, first_sh.id, first_sh.archived_at,
    c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;

create or replace view public.shadchan_stats with (security_invoker = on) as
select
    sh.id,
    sh.account_id,
    count(s.id) filter (where s.archived_at is null) as nb_suggestions,
    count(s.id) filter (where s.archived_at is null and s.pipeline_state <> 'new') as nb_progressed,
    count(s.id) filter (where s.archived_at is null and s.pipeline_state = 'yes') as nb_reached_yes,
    max(s.redt_date) filter (where s.archived_at is null) as last_redt_date,
    count(distinct s.single_id) filter (
        where s.archived_at is null
          and s.pipeline_state in ('new', 'look_into', 'not_sure')
    ) as nb_open_singles
from public.shadchanim sh
    left join public.shidduchim s on s.shadchan_id = sh.id
where sh.archived_at is null
group by sh.id;

-- Do not enqueue or claim reminders whose polymorphic target is an archived
-- shadchan. The archive/restore RPCs move existing queue rows between skipped
-- and pending so Undo re-arms a due task without creating a duplicate.
CREATE OR REPLACE FUNCTION "public"."enqueue_due_task_notifications"("p_now" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count integer;
  v_account_id bigint;
  v_shadchan_id bigint;
begin
  -- Lifecycle lock order is account advisory fence -> shadchan row lock.
  -- Lock every due account before rebuilding candidates so archive cannot
  -- commit a target transition in the middle of this enqueue operation.
  for v_account_id in
    select distinct t.account_id
    from public.tasks t
    where t.done_date is null
      and t.due_date is not null
      and t.due_date <= p_now
      and 'email' = any (t.delivery_channels)
    order by t.account_id
  loop
    perform public.account_storage_lock(v_account_id);
    for v_shadchan_id in
      select distinct t.target_id
      from public.tasks t
      where t.account_id = v_account_id
        and t.done_date is null
        and t.due_date is not null
        and t.due_date <= p_now
        and 'email' = any (t.delivery_channels)
        and t.target_type = 'shadchan'
        and t.target_id is not null
      order by t.target_id
    loop
      perform 1
      from public.shadchanim sh
      where sh.id = v_shadchan_id
        and sh.account_id = v_account_id
      for share;
    end loop;
  end loop;

  with candidates as (
    select
      t.id as task_id,
      t.account_id,
      t.due_date,
      m.email::text as recipient_email,
      public.demo_scope_is_simulated(t.account_id, null) as simulated,
      case
        when t.member_id is null then 'skipped'
        when m.email is null then 'failed'
        else 'pending'
      end as status,
      case
        when t.member_id is null then 'unassigned — no member_id set (deliberate, not a delivery failure)'
        when m.email is null then 'member_id names no live or no enabled member of this task''s own account'
        else null
      end as error
    from public.tasks t
    left join public.members m
      on m.id = t.member_id and public.is_deliverable_member(m.id, t.account_id)
    where t.done_date is null
      and t.due_date is not null
      and t.due_date <= p_now
      and 'email' = any (t.delivery_channels)
      and (
        t.target_type <> 'shadchan'
        or exists (
          select 1
          from public.shadchanim sh
          where sh.id = t.target_id
            and sh.account_id = t.account_id
            and sh.archived_at is null
        )
      )
  ),
  inserted as (
    insert into public.task_notifications (account_id, task_id, channel, due_date, status, recipient_email, error, simulated, sent_at)
    select candidates.account_id, candidates.task_id, 'email', candidates.due_date,
      case when candidates.simulated then 'sent' else candidates.status end,
      candidates.recipient_email,
      case when candidates.simulated then 'simulated demo delivery' else candidates.error end,
      candidates.simulated,
      case when candidates.simulated then now() else null end
    from candidates
    on conflict (task_id, channel, due_date) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."claim_due_task_notifications"("p_limit" integer) RETURNS TABLE("id" bigint, "task_id" bigint, "account_id" bigint, "recipient_email" "text", "task_text" "text", "due_date" timestamp with time zone, "target_type" "text", "target_id" bigint, "attempts" integer, "claimed_at" timestamp with time zone, "simulated" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_shadchan_id bigint;
begin
  perform public.enqueue_due_task_notifications();

  -- Lifecycle lock order is account advisory fence -> shadchan row lock.
  -- Archive/restore take the same locks before changing either the target or
  -- its reminder rows. Holding the row share lock through this transaction
  -- makes the active-target check below the pre-send linearization point.
  for v_account_id in
    select distinct tn2.account_id
    from public.task_notifications tn2
    where (
      (
        tn2.status = 'pending'
        and (tn2.next_attempt_at is null or tn2.next_attempt_at <= now())
      ) or (
        tn2.status = 'sending'
        and tn2.claimed_at < now() - interval '10 minutes'
      )
    )
      and tn2.simulated is not true
      and not public.demo_scope_is_simulated(tn2.account_id, null)
    order by tn2.account_id
  loop
    perform public.account_storage_lock(v_account_id);
    for v_shadchan_id in
      select distinct t2.target_id
      from public.task_notifications tn2
      join public.tasks t2 on t2.id = tn2.task_id
      where tn2.account_id = v_account_id
        and (
          (
            tn2.status = 'pending'
            and (tn2.next_attempt_at is null or tn2.next_attempt_at <= now())
          ) or (
            tn2.status = 'sending'
            and tn2.claimed_at < now() - interval '10 minutes'
          )
        )
        and tn2.simulated is not true
        and not public.demo_scope_is_simulated(tn2.account_id, null)
        and t2.target_type = 'shadchan'
        and t2.target_id is not null
      order by t2.target_id
    loop
      perform 1
      from public.shadchanim sh
      where sh.id = v_shadchan_id
        and sh.account_id = v_account_id
      for share;
    end loop;
  end loop;

  return query
  with claimed as (
    update public.task_notifications tn
    set status = 'sending', attempts = tn.attempts + 1, claimed_at = now()
    where tn.id in (
      select tn2.id from public.task_notifications tn2
      where (
        (
          tn2.status = 'pending'
          and (tn2.next_attempt_at is null or tn2.next_attempt_at <= now())
        ) or (
          tn2.status = 'sending'
          and tn2.claimed_at < now() - interval '10 minutes'
        )
        )
        and tn2.simulated is not true
        and not public.demo_scope_is_simulated(tn2.account_id, null)
        -- Re-check the target while setting `sending`, under the lifecycle
        -- locks above; a row returned here is active at the send hand-off.
        and (
          not exists (
            select 1
            from public.tasks t2
            where t2.id = tn2.task_id
              and t2.target_type = 'shadchan'
          )
          or exists (
            select 1
            from public.tasks t2
            join public.shadchanim sh on sh.id = t2.target_id
            where t2.id = tn2.task_id
              and t2.target_type = 'shadchan'
              and sh.account_id = t2.account_id
              and sh.archived_at is null
          )
        )
      order by tn2.created_at
      limit p_limit
      for update skip locked
    )
    returning tn.*
  )
  select
    claimed.id,
    claimed.task_id,
    claimed.account_id,
    claimed.recipient_email,
    t.text,
    claimed.due_date,
    t.target_type,
    t.target_id,
    claimed.attempts,
    claimed.claimed_at,
    claimed.simulated
  from claimed
  join public.tasks t on t.id = claimed.task_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.account_storage_cleanup_fence(p_account_id bigint)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  -- Account deletion uses parent rows (singles, then shidduchim, ascending
  -- id) -> advisory fence -> account row. This is the single global order
  -- for storage writers.
  perform 1
  from public.singles
  where account_id = p_account_id
  order by id
  for update;
  perform 1
  from public.shidduchim
  where account_id = p_account_id
  order by id
  for update;
  perform public.account_storage_lock(p_account_id);
  if not exists (select 1 from public.accounts where id = p_account_id) then
    return true;
  end if;
  return not exists (
    select 1 from public.storage_purge_queue where account_id = p_account_id
  ) and not exists (
    select 1
    from storage.objects
    where bucket_id in ('documents', 'entity-files', 'attachments')
      and (name = p_account_id::text or name like p_account_id::text || '/%')
  );
end;
$$;

-- Shadchan removal is archive-only for authenticated clients. Account
-- deletion remains the service-role purge path and is not affected by this
-- column-level fence.
revoke delete on table public.shadchanim from authenticated;

revoke all on function public.archive_shadchan(bigint) from public, anon;
grant execute on function public.archive_shadchan(bigint) to authenticated, service_role;
revoke all on function public.restore_shadchan(bigint) from public, anon;
grant execute on function public.restore_shadchan(bigint) to authenticated, service_role;
