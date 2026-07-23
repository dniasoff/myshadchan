alter table "public"."accounts" add column "demo" boolean not null default false;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.current_account_demo()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_account_id()),
    false
  );
$function$
;

revoke all on function public.current_account_demo() from public, anon;
grant execute on function public.current_account_demo() to authenticated;
grant execute on function public.current_account_demo() to service_role;


