-- Official onboarding demo preview is active-only.
-- The manifest predicates remain broad so failed/seeding/clearing bundles can
-- still be resolved and cleaned up, but browser callers must never preview a
-- run outside its fully active state or across bundle boundaries.

create or replace function public.demo_account_is_previewable(p_account_id bigint)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.demo_run_accounts caller_scope
    join public.demo_runs dr on dr.id = caller_scope.run_id
    join public.demo_run_accounts target_scope
      on target_scope.run_id = dr.id
     and target_scope.account_id = p_account_id
    where caller_scope.account_id = public.current_context_id()
      and dr.status = 'active'
  );
$$;
