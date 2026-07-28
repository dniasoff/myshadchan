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
    coalesce(am.account_id = public.current_context_id(), false) as is_active
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid() and am.status = 'active';
$function$
;


