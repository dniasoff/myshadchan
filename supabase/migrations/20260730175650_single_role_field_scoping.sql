drop policy "Entity files scoped to account" on "public"."entity_files";

drop policy "Interactions insertable within account and parent visibility" on "public"."interactions";

drop policy "Interactions readable within account and parent visibility" on "public"."interactions";

drop policy "Interactions updatable by author or owning role" on "public"."interactions";

drop policy "Reference links scoped to account" on "public"."reference_links";

drop policy "References scoped to account" on "public"."references";

drop policy "Shadchanim scoped to account" on "public"."shadchanim";

drop policy "Shidduchim external links scoped to account" on "public"."shidduchim_external_links";

create or replace view "public"."shidduchim_summary" as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
        CASE
            WHEN (public.current_member_role() = 'single'::text) THEN NULL::text
            ELSE s.close_reason
        END AS close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name AS shadchan_name,
    sh.name_he AS shadchan_name_he,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he,
    c.last_name_en AS single_last_name_en,
    c.last_name_he AS single_last_name_he,
    count(DISTINCT rl.id) AS nb_references,
    count(DISTINCT r.id) AS nb_redts,
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;

-- MANUAL ADJUSTMENT (see AGENTS.md). `supabase db diff` emits none of the
-- following, and it is not cosmetic.
--
-- Unlike 20260730094101_shadchan_stats_overview.sql's own MANUAL ADJUSTMENTS
-- note, `db diff` did NOT drop-and-recreate this view this time — it emitted
-- a bare `create or replace view` (above). That distinction turns out not to
-- matter: `CREATE OR REPLACE VIEW` with no `WITH (...)` clause resets
-- `security_invoker` to its default (off) rather than leaving the existing
-- setting alone. Verified by hand: applying this migration exactly as
-- generated, with no further edit, silently drops `shidduchim_summary` off
-- the `security_invoker_views.sql` guard and reopens the exact cross-account
-- leak 20260730094101's note describes — a view running as its OWNER, base-
-- table RLS never applying through it (`global_search.sql`'s cross-tenant
-- isolation check on this same view catches it too). Re-issuing this option
-- is required whenever this view's SELECT changes at all, not only on the
-- drop-and-recreate shape 20260730094101 hit.
--
-- `06_grants.sql`'s ACL survives here (a bare `CREATE OR REPLACE VIEW` does
-- not touch the underlying pg_class row's privileges the way a DROP + CREATE
-- does), confirmed by `view_grants.sql` staying green — so, unlike
-- 20260730094101's fix, no grants need re-issuing alongside this.
alter view "public"."shidduchim_summary" set (security_invoker = on);

  create policy "Shadchanim visible to single"
  on "public"."shadchanim"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text)));



  create policy "Entity files scoped to account"
  on "public"."entity_files"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Interactions insertable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



  create policy "Interactions readable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



  create policy "Interactions updatable by author or owning role"
  on "public"."interactions"
  as permissive
  for update
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR public.can_moderate_note(actor_member_id))))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR public.can_moderate_note(actor_member_id))));



  create policy "Reference links scoped to account"
  on "public"."reference_links"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "References scoped to account"
  on "public"."references"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shadchanim scoped to account"
  on "public"."shadchanim"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shidduchim external links scoped to account"
  on "public"."shidduchim_external_links"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));


drop policy "Documents resumes deletable within account" on "storage"."objects";

drop policy "Documents resumes readable within account" on "storage"."objects";

drop policy "Documents resumes writable within account" on "storage"."objects";

drop policy "Entity files deletable within account" on "storage"."objects";

drop policy "Entity files readable within account" on "storage"."objects";

drop policy "Entity files writable within account" on "storage"."objects";


  create policy "Documents resumes deletable within account"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text) AND (public.current_member_role() <> 'single'::text)));



  create policy "Documents resumes readable within account"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text) AND (public.current_member_role() <> 'single'::text)));



  create policy "Documents resumes writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text) AND (public.current_member_role() <> 'single'::text)));



  create policy "Entity files deletable within account"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'entity-files'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND (public.current_member_role() <> 'single'::text)));



  create policy "Entity files readable within account"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'entity-files'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND (public.current_member_role() <> 'single'::text)));



  create policy "Entity files writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'entity-files'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND (public.current_member_role() <> 'single'::text)));



