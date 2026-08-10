-- Make create_reference_for_shidduch SECURITY DEFINER, and re-state inside it
-- the authority check that RLS was enforcing for it.
--
-- Direct INSERT on public."references" is still granted to `authenticated`
-- today, so an authenticated, provisioned, non-single member can still POST
-- straight to PostgREST and create a reference attached to no shidduch. The
-- fix for that is to revoke the grant and make this function the only door —
-- which requires it to run as DEFINER, because an invoker-rights function
-- needs the very grant being revoked.
--
-- THE TRAP THIS MIGRATION EXISTS TO AVOID: under DEFINER, RLS no longer
-- applies to this function, and the policies on "references" and
-- reference_links enforce TWO conjuncts, not one — `account_id =
-- current_context_id()` AND `current_member_role() <> 'single'`. The body
-- already re-implemented the account scope. It did NOT check the role, so
-- flipping to DEFINER alone would have let a `single` write to the reference
-- book that Story 6.3 denies them. The role check is added here in the same
-- statement, and neither check may not be removed.
--
-- No grant lines are needed: CREATE OR REPLACE FUNCTION preserves existing
-- privileges, and the signature is unchanged from migration 20260810201929.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."create_reference_for_shidduch"("p_shidduchim_id" bigint, "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_relationship" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_school" "text" DEFAULT NULL::"text", "p_grad_year" integer DEFAULT NULL::integer, "p_relationship_override" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."references"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_reference_id bigint;
  v_link_id bigint;
begin
  -- RULING 7 / R7: a reference exists only inside a shidduch's context. The
  -- two-call client path (insert, then link_reference_to_shidduch) could mint
  -- an orphan whenever the second call failed. Both inserts happen here, in
  -- one statement, so the orphan state is unreachable by construction rather
  -- than merely discouraged.
  --
  -- SECURITY DEFINER, deliberately, so that direct INSERT on "references" can
  -- be revoked from `authenticated` and this becomes the only door. That
  -- turns the two checks below from belt-and-braces into the ONLY enforcement
  -- there is: under DEFINER the RLS policies on "references" and
  -- reference_links (05_policies.sql:423-431 and :641-650) no longer apply to
  -- this function, and BOTH of their conjuncts have to be re-stated here.
  -- The account scope was already re-implemented; the role check was not, and
  -- omitting it would have let a `single` write to the reference book that
  -- Story 6.3 denies them. Do not remove either check.
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context for create_reference_for_shidduch';
  end if;

  if public.current_member_role() = 'single' then
    raise exception 'a single cannot create references'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  insert into public."references" (
    account_id, name_en, name_he, relationship, phone, school, grad_year
  ) values (
    v_account_id, p_name_en, p_name_he, p_relationship, p_phone, p_school, p_grad_year
  )
  returning id into v_reference_id;

  insert into public.reference_links (
    account_id, reference_id, shidduchim_id, call_status, relationship_override
  ) values (
    v_account_id, v_reference_id, p_shidduchim_id, 'not_started', p_relationship_override
  )
  returning id into v_link_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', v_reference_id, 'shidduch', v_link_id, 'link_created',
    null, jsonb_build_object('shidduchim_id', p_shidduchim_id)
  );

  return query select * from public."references" where id = v_reference_id;
end;
$$;
