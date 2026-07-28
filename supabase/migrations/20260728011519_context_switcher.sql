set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.my_contexts()
 RETURNS TABLE(account_id bigint, kind text, name text, role text, is_active boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    am.account_id,
    a.kind,
    a.name,
    am.role,
    am.account_id = public.current_context_id() as is_active
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid() and am.status = 'active';
$function$
;

-- Function grants (Story 2.4, AC-6). `supabase db diff` did not emit these —
-- consistent with Story 2.1's finding that the generated migration never
-- picks up function-level GRANT/REVOKE — so they are hand-added here,
-- matching the file's own revoke-then-grant pattern verbatim (06_grants.sql).
revoke all on function public.my_contexts() from public, anon;

grant execute on function public.my_contexts() to authenticated;

grant execute on function public.my_contexts() to service_role;

