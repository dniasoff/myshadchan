-- Repair the account data export, which has never worked.
--
-- Two independent defects, both pre-dating this change (the guard arrived in
-- 31a8410, 2026-08-10):
--
-- 1. `if current_user = 'postgres' then raise ...` was meant to reject
--    service_role. Inside a SECURITY DEFINER function OWNED BY postgres,
--    current_user IS postgres for every caller, so the guard always fired.
--    export_account_data, export_account_files, and
--    export_full_account_bundle (which delegates to both) therefore raised
--    insufficient_privilege unconditionally -- including for the Settings
--    "download my data" button in PrivacySection.tsx. Verified failing on
--    production and on a local stack before this change.
--
-- 2. export_account_data selected FROM three tables that do not exist:
--    public.notes (the real table is single_notes, which was otherwise
--    missing from the export entirely), public.events (date_records is the
--    only account-scoped table it can have meant), and
--    public.deletion_requests (account_deletion_requests). Each would have
--    raised 42P01 the moment the guard above was fixed, so both defects had
--    to be closed together for the feature to work at all.
--
-- Not addressed here, and reported separately: the export's hardcoded table
-- list still omits many account-scoped tables, so it is repaired but not
-- proven complete for a data-portability request.

CREATE OR REPLACE FUNCTION "public"."export_account_data"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
begin
  -- Verify an authenticated caller (not service_role). This tested
  -- `current_user = 'postgres'`, which inside a SECURITY DEFINER function
  -- OWNED BY postgres is always true -- so this export, and
  -- export_full_account_bundle which delegates to it, raised
  -- insufficient_privilege for every caller, including the Settings
  -- "download my data" button (PrivacySection.tsx). auth.uid() is the test
  -- every other function here uses and still excludes service_role, which
  -- carries no JWT.
  if auth.uid() is null then
    raise exception 'export_account_data: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.demo_assert_same_active_run(array[v_account_id], 'account export');

  -- Explicitly list each table to avoid dynamic SQL issues
  -- This is maintainable because schema changes require migrations anyway
  SELECT jsonb_set(v_result, '{accounts}', coalesce(jsonb_agg(to_jsonb(acc)), '[]'))
  FROM public.accounts acc WHERE acc.id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{singles}', coalesce(jsonb_agg(to_jsonb(s)), '[]'))
  FROM public.singles s WHERE s.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{resumes}', coalesce(jsonb_agg(to_jsonb(r)), '[]'))
  FROM public.resumes r WHERE r.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{shidduchim}', coalesce(jsonb_agg(to_jsonb(sh)), '[]'))
  FROM public.shidduchim sh WHERE sh.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{messages}', coalesce(jsonb_agg(to_jsonb(m)), '[]'))
  FROM public.messages m WHERE m.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{references}', coalesce(jsonb_agg(to_jsonb(ref)), '[]'))
  FROM public.references ref WHERE ref.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{tasks}', coalesce(jsonb_agg(to_jsonb(t)), '[]'))
  FROM public.tasks t WHERE t.account_id = v_account_id
  INTO v_result;

  -- `public.notes` has never existed; the real table is single_notes, which
  -- was otherwise absent from this export entirely.
  SELECT jsonb_set(v_result, '{single_notes}', coalesce(jsonb_agg(to_jsonb(n)), '[]'))
  FROM public.single_notes n WHERE n.account_id = v_account_id
  INTO v_result;

  -- `public.events` has never existed either. date_records is the only
  -- account-scoped table it can have meant -- the dates that actually
  -- happened -- and it is real family data, so it is exported under its own
  -- name rather than dropped.
  SELECT jsonb_set(v_result, '{date_records}', coalesce(jsonb_agg(to_jsonb(e)), '[]'))
  FROM public.date_records e WHERE e.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{medical_notes}', coalesce(jsonb_agg(to_jsonb(mn)), '[]'))
  FROM public.medical_notes mn WHERE mn.account_id = v_account_id
  INTO v_result;

  -- connections/connection_invites/child_grants are scoped by their endpoint
  -- columns; none of them has an `account_id`, so each of these selected a
  -- column that does not exist. Predicates match demo_assert_empty_account.
  SELECT jsonb_set(v_result, '{connections}', coalesce(jsonb_agg(to_jsonb(c)), '[]'))
  FROM public.connections c
  WHERE c.household_account_id = v_account_id
     OR c.shadchanus_account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{connection_invites}', coalesce(jsonb_agg(to_jsonb(ci)), '[]'))
  FROM public.connection_invites ci
  WHERE ci.inviter_account_id = v_account_id
     OR ci.accepted_by_account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{child_grants}', coalesce(jsonb_agg(to_jsonb(cg)), '[]'))
  FROM public.child_grants cg
  WHERE cg.proposer_account_id = v_account_id
     OR cg.grantee_account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{share_links}', coalesce(jsonb_agg(to_jsonb(sl)), '[]'))
  FROM public.share_links sl WHERE sl.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{account_members}', coalesce(jsonb_agg(to_jsonb(am)), '[]'))
  FROM public.account_members am WHERE am.account_id = v_account_id
  INTO v_result;

  -- purge_requests is keyed by single_name/single_email and notified_accounts,
  -- not by account_id, so it has no per-account projection; configuration
  -- (id, config) and cron_heartbeat (worker, last_run_at, ...) are global
  -- system tables and never were this customer's data. All three selected a
  -- nonexistent `account_id` column and are dropped rather than guessed at.

  SELECT jsonb_set(v_result, '{account_deletion_requests}', coalesce(jsonb_agg(to_jsonb(dr)), '[]'))
  FROM public.account_deletion_requests dr WHERE dr.account_id = v_account_id
  INTO v_result;

  -- Add remaining tables with account_id column
  SELECT jsonb_set(v_result, '{entity_files}', coalesce(jsonb_agg(to_jsonb(ef)), '[]'))
  FROM public.entity_files ef WHERE ef.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{ai_usage}', coalesce(jsonb_agg(to_jsonb(au)), '[]'))
  FROM public.ai_usage au WHERE au.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{stripe_events}', coalesce(jsonb_agg(to_jsonb(se)), '[]'))
  FROM public.stripe_events se WHERE se.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{ai_parse_attempts}', coalesce(jsonb_agg(to_jsonb(apa)), '[]'))
  FROM public.ai_parse_attempts apa WHERE apa.account_id = v_account_id
  INTO v_result;

  RETURN v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."export_account_files"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  -- Verify an authenticated caller (not service_role). This tested
  -- `current_user = 'postgres'`, which inside a SECURITY DEFINER function
  -- OWNED BY postgres is always true -- so this export, and
  -- export_full_account_bundle which delegates to it, raised
  -- insufficient_privilege for every caller, including the Settings
  -- "download my data" button (PrivacySection.tsx). auth.uid() is the test
  -- every other function here uses and still excludes service_role, which
  -- carries no JWT.
  if auth.uid() is null then
    raise exception 'export_account_files: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.demo_assert_same_active_run(
    array[public.current_context_id()],
    'file export'
  );

  -- Resume photos live in Supabase Storage at `path`, not as bytes in the
  -- database. resume_photos is (id, account_id, resume_id, path, uploaded_at,
  -- visibility, hidden_at) and has never had file_name, file_bytes or
  -- content_type, so this selected three columns that do not exist. SQL cannot
  -- read a Storage object, so the row is exported as path metadata in exactly
  -- the shape the entity_files branch below already uses.
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      rp.id,
      rp.path as filename,
      null::text as content_base64,
      null::text as content_type,
      rp.path as storage_path
    from public.resume_photos rp
    where rp.account_id = v_account_id
  ) t;
  v_result := jsonb_set(v_result, array['resume_photos'], v_rows);

  -- Entity files (attachments) - stored in Supabase Storage, export metadata + storage_path
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      ef.id,
      ef.file_name as filename,
      null as content_base64,
      ef.mime_type as content_type,
      ef.storage_path
    from public.entity_files ef
    where ef.account_id = v_account_id
  ) t;
  v_result := jsonb_set(v_result, array['entity_files'], v_rows);

  return v_result;
end;
$$;
