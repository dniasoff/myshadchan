-- Actor-authenticated listing inserts use return=minimal while an official
-- demo run is seeding. Resolve their IDs through the exact marked service
-- lease instead of widening active-only browser listing preview.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.resolve_demo_listing_id(
  p_run_id bigint,
  p_lease_token text,
  p_account_id bigint,
  p_listing_type text,
  p_single_id bigint,
  p_published_by_member_id bigint
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_headers jsonb;
  v_run public.demo_runs%rowtype;
  v_listing_count integer;
  v_listing_id bigint;
begin
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  if coalesce(auth.role(), '') <> 'service_role'
     or p_run_id is null
     or p_lease_token is null
     or p_account_id is null
     or p_published_by_member_id is null
     or p_listing_type not in ('shadchan', 'single')
     or (p_listing_type = 'single' and p_single_id is null)
     or (p_listing_type = 'shadchan' and p_single_id is not null)
     or coalesce(v_headers->>'x-demo-run-id', '') <> p_run_id::text
     or coalesce(v_headers->>'x-demo-lease-token', '') <> p_lease_token then
    raise exception 'demo listing resolution requires the exact seed service lease'
      using errcode = 'insufficient_privilege';
  end if;

  select dr.* into strict v_run
  from public.demo_runs dr
  where dr.id = p_run_id
    and dr.lease_token = p_lease_token
    and dr.operation = 'seed'
    and dr.status = 'seeding'
    and dr.lease_expires_at > clock_timestamp()
    and exists (
      select 1
      from public.demo_run_accounts dra
      where dra.run_id = dr.id and dra.account_id = p_account_id
    );

  select count(*), min(l.id)
  into v_listing_count, v_listing_id
  from public.listings l
  where l.account_id = p_account_id
    and l.listing_type = p_listing_type
    and l.single_id is not distinct from p_single_id
    and l.published_by_member_id = p_published_by_member_id
    and exists (
      select 1
      from public.account_members am
      where am.id = p_published_by_member_id
        and am.account_id = p_account_id
        and am.status = 'active'
    )
    and exists (
      select 1
      from public.accounts a
      where a.id = p_account_id
        and ((p_listing_type = 'shadchan' and a.kind = 'shadchanus')
          or (p_listing_type = 'single' and a.kind = 'household'))
    )
    and (p_listing_type = 'shadchan' or exists (
      select 1
      from public.singles s
      where s.id = p_single_id and s.account_id = p_account_id
    ));

  if v_listing_count = 0 then
    raise exception 'demo listing was not found for the exact seed context'
      using errcode = 'check_violation';
  elsif v_listing_count > 1 then
    raise exception 'demo listing resolution was ambiguous'
      using errcode = 'cardinality_violation';
  end if;

  perform public.assert_demo_resource_ownership(
    p_run_id, 'listing', v_listing_id, true
  );
  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (p_run_id, 'listing', v_listing_id)
  on conflict (run_id, resource_type, resource_id) do nothing;

  return v_listing_id;
exception
  when no_data_found then
    raise exception 'demo seed lease or account ownership was not found'
      using errcode = 'insufficient_privilege';
end;
$function$
;

revoke all on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) to service_role;
