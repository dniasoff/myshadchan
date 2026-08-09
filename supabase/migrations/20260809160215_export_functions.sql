-- Story 14.3 (NFR-10, PRV-2): Export all tenant data for an account
-- These functions support the full export bundle that includes every tenant
-- table and all files (resumes, photos, attachments) as bytes.
-- ============================================================================

-- Get all tenant tables that have an account_id column.
-- This derives the export scope from the schema rather than hardcoding.
CREATE OR REPLACE FUNCTION "public"."get_tenant_tables"() RETURNS TABLE(
  table_name text,
  column_name text
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return query
  select c.relname::text as table_name, a.attname::text as column_name
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname = 'account_id'
    and a.attnum > 0
    and not a.attisdropped
    and c.relname not in (
      'subscription', 'ai_usage', 'stripe_events', 'ai_parse_attempts',
      'cron_heartbeat', 'configuration', 'entity_files'
    )
  order by c.relname;
end;
$$;

-- Export all data for the current account across all tenant tables.
-- Returns JSONB with one key per table containing an array of rows.
-- Uses explicit table list to avoid dynamic SQL issues with to_jsonb()
CREATE OR REPLACE FUNCTION "public"."export_account_data"() RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
begin
  -- Verify authenticated caller (not service_role)
  if current_user = 'postgres' then
    raise exception 'export_account_data: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

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

  SELECT jsonb_set(v_result, '{notes}', coalesce(jsonb_agg(to_jsonb(n)), '[]'))
  FROM public.notes n WHERE n.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{events}', coalesce(jsonb_agg(to_jsonb(e)), '[]'))
  FROM public.events e WHERE e.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{medical_notes}', coalesce(jsonb_agg(to_jsonb(mn)), '[]'))
  FROM public.medical_notes mn WHERE mn.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{connections}', coalesce(jsonb_agg(to_jsonb(c)), '[]'))
  FROM public.connections c WHERE c.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{connection_invites}', coalesce(jsonb_agg(to_jsonb(ci)), '[]'))
  FROM public.connection_invites ci WHERE ci.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{child_grants}', coalesce(jsonb_agg(to_jsonb(cg)), '[]'))
  FROM public.child_grants cg WHERE cg.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{share_links}', coalesce(jsonb_agg(to_jsonb(sl)), '[]'))
  FROM public.share_links sl WHERE sl.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{account_members}', coalesce(jsonb_agg(to_jsonb(am)), '[]'))
  FROM public.account_members am WHERE am.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{purge_requests}', coalesce(jsonb_agg(to_jsonb(pr)), '[]'))
  FROM public.purge_requests pr WHERE pr.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{deletion_requests}', coalesce(jsonb_agg(to_jsonb(dr)), '[]'))
  FROM public.deletion_requests dr WHERE dr.account_id = v_account_id
  INTO v_result;

  -- Add remaining tables with account_id column
  SELECT jsonb_set(v_result, '{entity_files}', coalesce(jsonb_agg(to_jsonb(ef)), '[]'))
  FROM public.entity_files ef WHERE ef.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{configuration}', coalesce(jsonb_agg(to_jsonb(c)), '[]'))
  FROM public.configuration c WHERE c.account_id = v_account_id
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

  SELECT jsonb_set(v_result, '{cron_heartbeat}', coalesce(jsonb_agg(to_jsonb(ch)), '[]'))
  FROM public.cron_heartbeat ch WHERE ch.account_id = v_account_id
  INTO v_result;

  RETURN v_result;
end;
$$;

-- Export files (resumes, photos, attachments) as base64-encoded bytes.
-- Returns JSONB with one key per file table containing array of {id, filename, content_base64, content_type, storage_path}.
-- Note: entity_files are stored in Supabase Storage; only metadata + storage_path are exported.
-- Resume photos have file_bytes stored directly in the database.
CREATE OR REPLACE FUNCTION "public"."export_account_files"() RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  -- Verify authenticated caller
  if current_user = 'postgres' then
    raise exception 'export_account_files: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  -- Resume photos (have file_bytes in DB)
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      rp.id,
      rp.file_name as filename,
      encode(rp.file_bytes, 'base64') as content_base64,
      rp.content_type,
      null as storage_path
    from public.resume_photos rp
    join public.resumes r on r.id = rp.resume_id
    where r.account_id = v_account_id
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

-- Combined export: data + files in one call.
CREATE OR REPLACE FUNCTION "public"."export_full_account_bundle"() RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_data jsonb;
  v_files jsonb;
  v_bundle jsonb;
begin
  v_data := public.export_account_data();
  v_files := public.export_account_files();
  v_bundle := jsonb_build_object(
    'exported_at', now(),
    'account_id', public.current_context_id(),
    'data', v_data,
    'files', v_files
  );
  return v_bundle;
end;
$$;