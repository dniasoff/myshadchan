create policy "Resume photos readable via accepted grant"
on "public"."resume_photos"
as permissive
for select
to authenticated
using (((visibility = 'shared'::text) AND (EXISTS ( SELECT 1
   FROM public.resumes r
  WHERE ((r.id = resume_photos.resume_id) AND (EXISTS ( SELECT 1
           FROM public.child_grants g
          WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND ((g.target_single_id = r.single_id) OR (g.target_single_id = ( SELECT s.single_id
                   FROM public.shidduchim s
                  WHERE (s.id = r.shidduchim_id)))))))))) AND (public.current_member_role() <> 'single'::text)));