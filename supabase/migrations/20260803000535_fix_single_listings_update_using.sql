drop policy "Single listings update" on "public"."listings";


  create policy "Single listings update"
  on "public"."listings"
  as permissive
  for update
  to authenticated
using (((listing_type = 'single'::text) AND (account_id = public.current_context_id()) AND (single_id IN ( SELECT s.id
   FROM public.singles s
  WHERE (s.account_id = public.current_context_id()))) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = public.current_context_id()) AND (a.kind = 'household'::text)))) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'self_manager'::text) AND (s.id = listings.single_id)))))))
with check (((listing_type = 'single'::text) AND (account_id = public.current_context_id()) AND (single_id IN ( SELECT s.id
   FROM public.singles s
  WHERE (s.account_id = public.current_context_id()))) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = public.current_context_id()) AND (a.kind = 'household'::text)))) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'self_manager'::text) AND (s.id = listings.single_id)))))));



