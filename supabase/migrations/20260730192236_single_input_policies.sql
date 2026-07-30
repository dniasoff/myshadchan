drop policy "Interactions insertable within account and parent visibility" on "public"."interactions";

drop policy "Interactions updatable by author or owning role" on "public"."interactions";


  create policy "Single adds input on a visible suggestion"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (kind = 'single_input'::text) AND (actor_member_id = public.current_member_id()) AND (target_type = 'shidduch'::text) AND (scope = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM (public.shidduchim s
     JOIN public.singles c ON ((c.id = s.single_id)))
  WHERE ((s.id = interactions.target_id) AND (s.visibility = 'shared'::text) AND public.is_single_visible_state(s.pipeline_state) AND (c.member_id = public.current_member_id()))))));



  create policy "Single reads own input"
  on "public"."interactions"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (kind = 'single_input'::text) AND (actor_member_id = public.current_member_id())));



  create policy "Interactions insertable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (kind <> 'single_input'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
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
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR ((kind = 'note'::text) AND public.can_moderate_note(actor_member_id)))))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR ((kind = 'note'::text) AND public.can_moderate_note(actor_member_id)))));



