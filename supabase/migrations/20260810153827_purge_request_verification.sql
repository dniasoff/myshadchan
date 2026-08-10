drop policy "Service role has full access" on "public"."purge_requests";

drop policy "Anon can create purge requests" on "public"."purge_requests";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.verify_purge_request(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.purge_requests;
begin
  select * into v_row
  from public.purge_requests
  where verification_token = p_token
  for update;

  if not found then
    return jsonb_build_object('verified', false);
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('verified', false);
  end if;

  if v_row.status <> 'pending' or v_row.verified_at is not null then
    return jsonb_build_object('verified', false);
  end if;

  update public.purge_requests
  set status = 'verified', verified_at = now()
  where id = v_row.id;

  return jsonb_build_object('verified', true);
end;
$function$
;

grant insert on table "public"."purge_requests" to "anon";


  create policy "Anon can create purge requests"
  on "public"."purge_requests"
  as permissive
  for insert
  to anon
with check (((status = 'pending'::text) AND (verified_at IS NULL)));


grant usage, select on sequence public.purge_requests_id_seq to anon;

grant references, trigger, truncate on table public.purge_requests to authenticated;
grant references, trigger, truncate on table public.purge_requests to service_role;

-- verify_purge_request() is SECURITY DEFINER but must be callable by anon
-- for the public verification flow; revoke from public, grant to anon and authenticated.
revoke all on function public.verify_purge_request(text) from public;
grant execute on function public.verify_purge_request(text) to anon;
grant execute on function public.verify_purge_request(text) to authenticated;
grant execute on function public.verify_purge_request(text) to service_role;



