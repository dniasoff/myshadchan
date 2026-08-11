
  create policy "Listings readable via accepted grant"
  on "public"."listings"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = listings.single_id)))) AND (public.current_member_role() <> 'single'::text)));



