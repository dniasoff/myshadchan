-- Keep unfinished demo runs recoverable while making the browser listing
-- preview active-only. The broad boolean is sanitized and caller-scoped for
-- the banner; the separate preview gate is the only browser-facing listing
-- capability check.

create or replace function public.current_account_demo()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_context_id()),
    false
  ) or public.demo_account_in_active_run(public.current_context_id());
$$;

create or replace function public.current_account_demo_previewable()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.demo_account_is_previewable(public.current_context_id());
$$;

revoke all on function public.current_account_demo_previewable() from public, anon;
grant execute on function public.current_account_demo_previewable() to authenticated, service_role;
