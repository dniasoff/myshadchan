drop policy "Share links manager scoped" on "public"."share_links";


  create policy "Share links manager scoped"
  on "public"."share_links"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (single_id IN ( SELECT s.id
   FROM public.singles s
  WHERE (s.account_id = public.current_context_id()))) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'self_manager'::text) AND (s.id = share_links.single_id)))))))
with check (((account_id = public.current_context_id()) AND (single_id IN ( SELECT s.id
   FROM public.singles s
  WHERE (s.account_id = public.current_context_id()))) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'self_manager'::text) AND (s.id = share_links.single_id)))))));



