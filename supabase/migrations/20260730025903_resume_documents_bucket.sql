-- Story 5.3: the `add_resume_file` RPC (the sole write path into
-- resumes.files, AC 2) and the new `documents` storage bucket + its three
-- resumes/-scoped policies (AC 4).
--
-- MANUAL ADJUSTMENTS (see AGENTS.md). `supabase db diff` over storage
-- objects is often incomplete:
-- 1. It did not emit the `insert into storage.buckets (...) values
--    ('documents', ...)` statement at all, even though 07_storage.sql
--    declares it — hand-added below, in the same position (before the
--    policies that reference the bucket) as 07_storage.sql itself.
-- 2. The raw diff also re-emitted the unrelated `reference_links_summary`,
--    `shadchan_stats`, `shidduchim_summary` and `singles_summary` views
--    (drop + recreate, with `security_invoker` stripped, per this repo's
--    known `db diff`-and-views quirk). This story does not touch any of
--    those four views or their base tables, so that pair of statements was
--    removed rather than carried — recreating them here would be a no-op
--    at best and, since `db diff` never re-emits `security_invoker`, an RLS
--    regression at worst if that half were forgotten.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_resume_file(p_shidduchim_id bigint, p_path text, p_filename text, p_mime_type text, p_size bigint)
 RETURNS SETOF public.resumes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', p_filename,
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', p_mime_type,
    'size', p_size
  );

  return query
  insert into public.resumes (account_id, shidduchim_id, files)
  values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
  on conflict (shidduchim_id) do update
    set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
  returning *;
end;
$function$
;

revoke all on function public.add_resume_file(bigint, text, text, text, bigint) from public, anon;
grant execute on function public.add_resume_file(bigint, text, text, text, bigint) to authenticated;
grant execute on function public.add_resume_file(bigint, text, text, text, bigint) to service_role;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "Documents resumes readable within account"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text)));

create policy "Documents resumes writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text)));

create policy "Documents resumes deletable within account"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text)));
