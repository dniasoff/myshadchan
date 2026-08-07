drop function if exists "public"."record_cron_heartbeat"(p_worker text, p_error text);

drop function if exists "public"."settle_task_notification"(p_id bigint, p_status text, p_error text);

drop function if exists "public"."claim_due_task_notifications"(p_limit integer);

alter table "public"."cron_heartbeat" add column "last_failed_count" integer not null default 0;

alter table "public"."task_notifications" add column "claimed_at" timestamp with time zone;

alter table "public"."task_notifications" add column "next_attempt_at" timestamp with time zone;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_deliverable_member(p_member_id bigint, p_account_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.members m
      join public.account_members am on am.user_id = m.user_id
    where m.id = p_member_id
      and am.account_id = p_account_id
      and am.status = 'active'
      and m.disabled = false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.record_cron_heartbeat(p_worker text, p_error text DEFAULT NULL::text, p_failed_count integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_error is not null and p_error not in ('rpc_failed', 'transport_failed', 'unknown') then
    raise exception 'invalid cron_heartbeat error code: %', p_error
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.cron_heartbeat (worker, last_run_at, last_ok_at, last_error, last_failed_count)
  values (
    p_worker, now(),
    case when p_error is null then now() else null end,
    p_error,
    case when p_error is null then coalesce(p_failed_count, 0) else 0 end
  )
  on conflict (worker) do update
    set last_run_at = now(),
        last_ok_at = case when p_error is null then now() else public.cron_heartbeat.last_ok_at end,
        last_error = p_error,
        last_failed_count = case
          when p_error is null then coalesce(p_failed_count, 0)
          else public.cron_heartbeat.last_failed_count
        end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_task_notification(p_id bigint, p_status text, p_error text DEFAULT NULL::text, p_next_attempt_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_claimed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_status not in ('sent', 'failed', 'pending') then
    raise exception 'invalid task_notification status: %', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.task_notifications
  set status = p_status,
      error = p_error,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      next_attempt_at = case when p_status = 'pending' then p_next_attempt_at else null end,
      claimed_at = case when p_status = 'pending' then null else claimed_at end
  where id = p_id
    and status = 'sending'
    and (p_claimed_at is null or claimed_at = p_claimed_at);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_due_task_notifications(p_limit integer)
 RETURNS TABLE(id bigint, task_id bigint, account_id bigint, recipient_email text, task_text text, due_date timestamp with time zone, target_type text, target_id bigint, attempts integer, claimed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.enqueue_due_task_notifications();

  return query
  with claimed as (
    update public.task_notifications tn
    set status = 'sending', attempts = tn.attempts + 1, claimed_at = now()
    where tn.id in (
      select tn2.id from public.task_notifications tn2
      where (
        tn2.status = 'pending'
        and (tn2.next_attempt_at is null or tn2.next_attempt_at <= now())
      ) or (
        tn2.status = 'sending'
        and tn2.claimed_at < now() - interval '10 minutes'
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
    claimed.claimed_at
  from claimed
  join public.tasks t on t.id = claimed.task_id;
end;
$function$
;

-- `supabase db diff` (migra) generated this statement WITHOUT restating
-- `WITH (security_invoker = on)`, because the view already carried it and
-- only its WHERE clause changed. VERIFIED DANGEROUS: `CREATE OR REPLACE
-- VIEW` does NOT preserve reloptions across a replace that omits them — it
-- silently CLEARS security_invoker back to its (definer-like) default,
-- exactly the trap AGENTS.md's "COLUMN-ORDER TRAP" section warns this diff
-- tool sets for any view it rewrites. Restated by hand; 03_views.sql (the
-- source of truth) already declares it, so this migration is what was
-- missing, not the schema.
create or replace view "public"."context_members" with (security_invoker = on) as  SELECT m.id,
    am.account_id,
    am.user_id,
    am.role,
    NULLIF(btrim(((COALESCE(m.first_name, ''::text) || ' '::text) || COALESCE(m.last_name, ''::text))), ''::text) AS full_name,
    (am.user_id = auth.uid()) AS is_self
   FROM (public.account_members am
     JOIN public.members m ON ((m.user_id = am.user_id)))
  WHERE ((am.status = 'active'::text) AND (am.account_id = public.current_context_id()) AND public.is_deliverable_member(m.id, am.account_id));


CREATE OR REPLACE FUNCTION public.enqueue_due_task_notifications(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with candidates as (
    select
      t.id as task_id,
      t.account_id,
      t.due_date,
      m.email::text as recipient_email,
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
  ),
  inserted as (
    insert into public.task_notifications (account_id, task_id, channel, due_date, status, recipient_email, error)
    select candidates.account_id, candidates.task_id, 'email', candidates.due_date, candidates.status, candidates.recipient_email, candidates.error
    from candidates
    on conflict (task_id, channel, due_date) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_task_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.member_id is null then
    return new;
  end if;

  if not public.is_deliverable_member(new.member_id, new.account_id) then
    raise exception 'member % is not an active, enabled member of account %',
      new.member_id, new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;



-- `supabase db diff` (migra) drops and recreates a function whose OUT/return
-- shape or argument list changed rather than doing an in-place ALTER — see
-- the `drop function` statements above — and a dropped-and-recreated
-- function starts with WHATEVER the default-privilege ACL for its creating
-- role grants (verified: role `postgres`'s default ACL for schema `public`
-- functions is executed-by-`postgres`-only, no auto-grant to anon/
-- authenticated/service_role), NOT the previous object's grants. `db diff`
-- does not emit GRANT/REVOKE statements for this migration at all, so the
-- four functions below need theirs restated by hand, verbatim against
-- 06_grants.sql, or the cron Worker's service_role client loses EXECUTE the
-- moment this migration lands.
revoke all on function public.claim_due_task_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_task_notifications(integer) to service_role;

revoke all on function public.settle_task_notification(bigint, text, text, timestamp with time zone, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.settle_task_notification(bigint, text, text, timestamp with time zone, timestamp with time zone) to service_role;

revoke all on function public.record_cron_heartbeat(text, text, integer) from public, anon, authenticated;
grant execute on function public.record_cron_heartbeat(text, text, integer) to service_role;

revoke all on function public.is_deliverable_member(bigint, bigint) from public, anon;
grant execute on function public.is_deliverable_member(bigint, bigint) to authenticated;
grant execute on function public.is_deliverable_member(bigint, bigint) to service_role;
