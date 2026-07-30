-- Story 5.7 review fix (finding F2): widens the UPDATE policy's
-- author-or-owning-role escape from `kind <> 'note'` to `kind not in
-- ('note', 'single_input')`, mirrored in interactions_summary.can_moderate
-- (05_policies.sql / 03_views.sql carry the full reasoning). Unlike
-- 20260729052308's note (`CREATE OR REPLACE VIEW does not itself clear an
-- already-set security_invoker reloption`), that was NOT reproduced here —
-- verified live that this `create or replace view` DID drop
-- interactions_summary's `security_invoker=on` reloption, so the `alter
-- view ... set (security_invoker = on)` below is required, not merely
-- defensive.
drop policy "Interactions updatable by author or owning role" on "public"."interactions";

create or replace view "public"."interactions_summary" as  SELECT i.id,
    i.account_id,
    i.created_at,
    i.target_type,
    i.target_id,
    i.scope,
    i.reference_link_id,
    i.actor_member_id,
    i.kind,
    i.body,
    i.metadata,
    i.deleted_at,
    NULLIF(btrim(((COALESCE(m.first_name, ''::text) || ' '::text) || COALESCE(m.last_name, ''::text))), ''::text) AS author_name,
    ((i.kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR public.can_moderate_note(i.actor_member_id)) AS can_moderate
   FROM ((public.interactions i
     LEFT JOIN public.account_members am ON ((am.id = i.actor_member_id)))
     LEFT JOIN public.members m ON ((m.user_id = am.user_id)));

alter view "public"."interactions_summary" set (security_invoker = on);


  create policy "Interactions updatable by author or owning role"
  on "public"."interactions"
  as permissive
  for update
  to authenticated
using (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR public.can_moderate_note(actor_member_id))))
with check (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR public.can_moderate_note(actor_member_id))));
