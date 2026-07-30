-- Story 5.8, Task 3/Task 4 — resumes gains a single owner alongside its
-- existing shidduch owner, and add_resume_file()/add_resume_photo() are
-- widened to accept either.
--
-- MANUAL ADJUSTMENTS (contract with the migration workflow — see this
-- story's Dev Notes "Migration workflow" and the 20260724112600 precedent):
--
-- 1. The raw `supabase db diff` output for this change ALSO proposed
--    `drop view` / `create or replace view` for `reference_links_summary`,
--    `shadchan_stats`, `shidduchim_summary` and `singles_summary` — none of
--    which reference `resumes` (`grep -n "resumes" supabase/schemas/03_views.sql`
--    returns nothing, confirming Task 3's own claim). Reproduced against the
--    pre-story tree too, so it is PRE-EXISTING `db diff` drift, not caused by
--    this change. Deliberately dropped from this migration rather than
--    applied: `db diff` never re-emits `with (security_invoker = on)`
--    (confirmed live: `pg_class.reloptions` on all four already reads
--    `{security_invoker=on}` in the local database), so a DROP + CREATE OR
--    REPLACE here would have silently produced four RLS-bypassing views —
--    exactly the failure the 20260724112600 migration's own manual-
--    adjustments note exists to prevent. Out of this story's scope either
--    way (Task 3: "no view work").
-- 2. `06_grants.sql`'s revoke/grant triples for `add_resume_file`/
--    `add_resume_photo` are re-issued below, in this same migration:
--    widening either function's argument list is a signature change, which
--    `supabase db diff` implements as DROP FUNCTION + CREATE FUNCTION — and
--    a dropped function takes its grants with it.

alter table "public"."resumes" drop constraint "resumes_shidduchim_id_key";

drop function if exists "public"."add_resume_file"(p_shidduchim_id bigint, p_path text, p_filename text, p_mime_type text, p_size bigint);

drop function if exists "public"."add_resume_photo"(p_shidduchim_id bigint, p_path text, p_visibility text);

drop index if exists "public"."resumes_shidduchim_id_key";

alter table "public"."resumes" add column "single_id" bigint;

alter table "public"."resumes" alter column "shidduchim_id" drop not null;

CREATE UNIQUE INDEX resumes_single_id_key ON public.resumes USING btree (single_id) WHERE (single_id IS NOT NULL);

CREATE UNIQUE INDEX resumes_shidduchim_id_key ON public.resumes USING btree (shidduchim_id) WHERE (shidduchim_id IS NOT NULL);

alter table "public"."resumes" add constraint "resumes_owner_check" CHECK (((shidduchim_id IS NOT NULL) <> (single_id IS NOT NULL))) not valid;

alter table "public"."resumes" validate constraint "resumes_owner_check";

alter table "public"."resumes" add constraint "resumes_single_id_fkey" FOREIGN KEY (account_id, single_id) REFERENCES public.singles(account_id, id) ON DELETE CASCADE not valid;

alter table "public"."resumes" validate constraint "resumes_single_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_resume_file(p_path text, p_filename text, p_mime_type text, p_size bigint, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF public.resumes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_context_id();

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', p_filename,
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', p_mime_type,
    'size', p_size
  );

  if p_shidduchim_id is not null then
    return query
    insert into public.resumes (account_id, shidduchim_id, files)
    values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
    on conflict (shidduchim_id) where shidduchim_id is not null do update
      set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
    returning *;
  else
    return query
    insert into public.resumes (account_id, single_id, files)
    values (v_account_id, p_single_id, jsonb_build_array(v_entry))
    on conflict (single_id) where single_id is not null do update
      set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
    returning *;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_resume_photo(p_path text, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_visibility text DEFAULT 'shared'::text)
 RETURNS SETOF public.resume_photos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_resume_id bigint;
begin
  v_account_id := public.current_context_id();

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;

    insert into public.resumes (account_id, shidduchim_id)
    values (v_account_id, p_shidduchim_id)
    on conflict (shidduchim_id) where shidduchim_id is not null
      do update set shidduchim_id = excluded.shidduchim_id
    returning id into v_resume_id;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;

    insert into public.resumes (account_id, single_id)
    values (v_account_id, p_single_id)
    on conflict (single_id) where single_id is not null
      do update set single_id = excluded.single_id
    returning id into v_resume_id;
  end if;

  return query
  insert into public.resume_photos (account_id, resume_id, path, visibility)
  values (v_account_id, v_resume_id, p_path, coalesce(p_visibility, 'shared'))
  returning *;
end;
$function$
;

-- MANUAL ADJUSTMENT 2 (see header): re-issue the grants both signature-
-- changed functions lost when `db diff` dropped and recreated them.
revoke all on function public.add_resume_file(text, text, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint) to authenticated;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint) to service_role;

revoke all on function public.add_resume_photo(text, bigint, bigint, text) from public, anon;
grant execute on function public.add_resume_photo(text, bigint, bigint, text) to authenticated;
grant execute on function public.add_resume_photo(text, bigint, bigint, text) to service_role;
