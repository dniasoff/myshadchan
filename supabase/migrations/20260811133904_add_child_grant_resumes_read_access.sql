
  create policy "Resumes readable via accepted grant"
  on "public"."resumes"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND ((g.target_single_id = resumes.single_id) OR (g.target_single_id = ( SELECT s.single_id
           FROM public.shidduchim s
          WHERE (s.id = resumes.shidduchim_id))))))) AND (public.current_member_role() <> 'single'::text)));



