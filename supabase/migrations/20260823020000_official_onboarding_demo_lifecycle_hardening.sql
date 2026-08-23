-- Harden the official onboarding demo after the initial bundle migration.
-- The low-level manifest predicates are server-only; browser callers receive
-- only the caller-scoped preview predicate and sanitized delivery history.

drop index if exists public.demo_runs_active_root_idx;
create unique index demo_runs_active_root_idx on public.demo_runs (root_account_id)
  where status in ('seeding', 'active', 'clearing', 'failed');

create or replace function public.demo_root_account_for(p_account_id bigint)
returns bigint
language sql stable security definer set search_path = '' as $$
  select dr.root_account_id
  from public.demo_run_accounts dra
  join public.demo_runs dr on dr.id = dra.run_id
  where dra.account_id = p_account_id
    -- A failed run is still a live cleanup handle. Keep mapping a caller's
    -- companion context to its root until clear_demo removes the manifest.
    and dr.status in ('seeding', 'active', 'clearing', 'failed')
  order by dr.id desc
  limit 1;
$$;

create or replace function public.demo_run_for_account(p_account_id bigint default null)
returns bigint
language sql stable security definer set search_path = '' as $$
  select dra.run_id
  from public.demo_run_accounts dra
  join public.demo_runs dr on dr.id = dra.run_id
  where dra.account_id = coalesce(p_account_id, public.current_context_id())
    and dr.status in ('seeding', 'active', 'clearing', 'failed')
  order by dr.id desc
  limit 1;
$$;

create or replace function public.demo_bundle_contains_account(p_run_id bigint, p_account_id bigint)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.demo_run_accounts dra
    join public.demo_runs dr on dr.id = dra.run_id
    where dra.run_id = p_run_id
      and dra.account_id = p_account_id
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  );
$$;

create or replace function public.demo_account_is_previewable(p_account_id bigint)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.demo_bundle_contains_account(
    public.demo_run_for_account(), p_account_id
  );
$$;

create or replace function public.demo_scope_is_simulated(
  p_account_id bigint default null,
  p_connection_id bigint default null
)
returns boolean
language sql stable security definer set search_path = '' as $$
  -- If both axes are supplied they must belong to the SAME active run. The
  -- old OR-shaped predicate could mark a production account as simulated
  -- merely because its connection happened to touch a different bundle.
  select case
    when p_account_id is null and p_connection_id is null then false
    else exists (
      select 1
      from public.demo_runs dr
      where dr.status in ('seeding', 'active', 'clearing', 'failed')
        and (
          p_account_id is null
          or exists (
            select 1
            from public.demo_run_accounts dra
            where dra.run_id = dr.id and dra.account_id = p_account_id
          )
        )
        and (
          p_connection_id is null
          or exists (
            select 1
            from public.connections c
            join public.demo_run_accounts dra
              on dra.run_id = dr.id
             and dra.account_id in (c.household_account_id, c.shadchanus_account_id)
            where c.id = p_connection_id
          )
        )
    )
  end;
$$;

create or replace function public.demo_delivery_history()
returns table(event_type text, status text, simulated boolean, occurred_at timestamptz, resource text)
language sql stable security definer set search_path = '' as $$
  with current_run as (
    select public.demo_run_for_account() as run_id
  )
  select 'message'::text, mn.status, mn.simulated,
    coalesce(mn.sent_at, mn.created_at) as occurred_at, 'message'::text
  from public.message_notifications mn
  cross join current_run cr
  left join public.connections c on c.id = mn.connection_id
  where cr.run_id is not null
    and exists (
      select 1
      from public.demo_run_accounts dra
      where dra.run_id = cr.run_id
        and dra.account_id in (mn.account_id, c.household_account_id, c.shadchanus_account_id)
    )
  union all
  select 'reminder'::text, tn.status, tn.simulated,
    coalesce(tn.sent_at, tn.created_at), 'task'::text
  from public.task_notifications tn
  cross join current_run cr
  where cr.run_id is not null
    and exists (
      select 1 from public.demo_run_accounts dra
      where dra.run_id = cr.run_id and dra.account_id = tn.account_id
    )
  union all
  select 'share'::text, 'accessed'::text, sal.simulated, sal.accessed_at, sal.resource
  from public.share_access_log sal
  join public.share_links sl on sl.id = sal.share_link_id
  cross join current_run cr
  where cr.run_id is not null
    and exists (
      select 1 from public.demo_run_accounts dra
      where dra.run_id = cr.run_id and dra.account_id = sl.account_id
    )
  order by occurred_at desc;
$$;

revoke all on function public.demo_run_for_account(bigint) from public, anon, authenticated;
grant execute on function public.demo_run_for_account(bigint) to service_role;
revoke all on function public.demo_root_account_for(bigint) from public, anon, authenticated;
grant execute on function public.demo_root_account_for(bigint) to service_role;
revoke all on function public.demo_bundle_contains_account(bigint, bigint) from public, anon, authenticated;
grant execute on function public.demo_bundle_contains_account(bigint, bigint) to service_role;

revoke all on function public.demo_account_is_previewable(bigint) from public, anon;
grant execute on function public.demo_account_is_previewable(bigint) to authenticated, service_role;
revoke all on function public.demo_scope_is_simulated(bigint, bigint) from public, anon, authenticated;
grant execute on function public.demo_scope_is_simulated(bigint, bigint) to service_role;
revoke all on function public.demo_delivery_history() from public, anon;
grant execute on function public.demo_delivery_history() to authenticated, service_role;
