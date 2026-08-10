set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shidduch_diligence_progress(p_shidduchim_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total bigint;
  v_contacted bigint;
begin
  select count(*) into v_total
  from public.reference_links
  where account_id = public.current_context_id()
    and shidduchim_id = p_shidduchim_id;

  select count(*) into v_contacted
  from public.reference_links
  where account_id = public.current_context_id()
    and shidduchim_id = p_shidduchim_id
    and call_status = 'answered';

  return jsonb_build_object(
    'contacted', v_contacted,
    'total', v_total,
    'outstanding', v_total - v_contacted
  );
end;
$function$
;

revoke all on function public.shidduch_diligence_progress(bigint) from public;
revoke all on function public.shidduch_diligence_progress(bigint) from anon;
grant execute on function public.shidduch_diligence_progress(bigint) to authenticated;
grant execute on function public.shidduch_diligence_progress(bigint) to service_role;


