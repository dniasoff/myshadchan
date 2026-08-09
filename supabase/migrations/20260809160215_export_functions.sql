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
CREATE OR REPLACE FUNCTION "public"."export_account_data"() RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
  v_table record;
  v_query text;
  v_rows jsonb;
begin
  -- Verify authenticated caller (not service_role)
  if current_user = 'postgres' then
    raise exception 'export_account_data: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  for v_table in select * from public.get_tenant_tables() loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where account_id = $1) t',
      v_table.table_name
    ) into v_rows using v_account_id;
    v_result := jsonb_set(v_result, array[v_table.table_name], v_rows);
  end loop;

  return v_result;
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