-- S17 / RULING 7 R7: make the orphan reference unreachable by construction.
--
-- ReferenceCreate.tsx inserts a reference and then calls
-- link_reference_to_shidduch as a SECOND round trip. A failure between the
-- two leaves a reference attached to no shidduch, and nothing in the schema
-- forbids that state: reference_links.shidduchim_id is nullable, no
-- constraint requires a link to exist, and no trigger reaps a reference
-- whose last link is removed. The /references screen exists as an
-- orphan-cleanup surface precisely because this already happens.
--
-- create_reference_for_shidduch performs both inserts in one statement, so
-- the orphan state becomes unreachable rather than merely discouraged.
-- Invoker rights, matching link_reference_to_shidduch: the RLS `with check`
-- on both tables must apply to the caller, never be bypassed.
--
-- THE GRANTS AT THE BOTTOM ARE LOAD-BEARING AND migra DOES NOT GENERATE
-- THEM. PostgreSQL grants EXECUTE on a new function to PUBLIC by default,
-- so shipping the generated diff alone would leave `anon` holding execute
-- on a tenant write path. That is the same defect class as the anon
-- TRUNCATE grant caught earlier in this programme, and it is why this file
-- is hand-completed rather than taken from `db diff` as-is.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."create_reference_for_shidduch"("p_shidduchim_id" bigint, "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_relationship" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_school" "text" DEFAULT NULL::"text", "p_grad_year" integer DEFAULT NULL::integer, "p_relationship_override" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."references"
    LANGUAGE "plpgsql"
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
  -- than merely discouraged. Invoker rights, like its sibling below: the RLS
  -- `with check` on both tables must apply to the caller, not be bypassed.
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context for create_reference_for_shidduch';
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

revoke all on function public.create_reference_for_shidduch(bigint, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.create_reference_for_shidduch(bigint, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.create_reference_for_shidduch(bigint, text, text, text, text, text, integer, text) to service_role;
