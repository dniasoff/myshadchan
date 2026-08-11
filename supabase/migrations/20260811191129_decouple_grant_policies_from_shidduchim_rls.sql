drop policy "Redts readable via accepted grant" on "public"."redts";

drop policy "Resume photos readable via accepted grant" on "public"."resume_photos";

drop policy "Resumes readable via accepted grant" on "public"."resumes";

drop policy "Shidduch education readable via accepted grant" on "public"."shidduch_education";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shidduch_single_id(p_shidduchim_id bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.single_id
  from public.shidduchim s
  where s.id = p_shidduchim_id;
$function$
;

revoke all on function public.shidduch_single_id(bigint) from public, anon;
grant execute on function public.shidduch_single_id(bigint) to authenticated;
grant execute on function public.shidduch_single_id(bigint) to service_role;


  create policy "Redts readable via accepted grant"
  on "public"."redts"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(redts.shidduchim_id))))) AND (public.current_member_role() <> 'single'::text)));



  create policy "Resume photos readable via accepted grant"
  on "public"."resume_photos"
  as permissive
  for select
  to authenticated
using (((visibility = 'shared'::text) AND (EXISTS ( SELECT 1
   FROM public.resumes r
  WHERE ((r.id = resume_photos.resume_id) AND (EXISTS ( SELECT 1
           FROM public.child_grants g
          WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND ((g.target_single_id = r.single_id) OR (g.target_single_id = public.shidduch_single_id(r.shidduchim_id))))))))) AND (public.current_member_role() <> 'single'::text)));



  create policy "Resumes readable via accepted grant"
  on "public"."resumes"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND ((g.target_single_id = resumes.single_id) OR (g.target_single_id = public.shidduch_single_id(resumes.shidduchim_id)))))) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shidduch education readable via accepted grant"
  on "public"."shidduch_education"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(shidduch_education.shidduchim_id))))) AND (public.current_member_role() <> 'single'::text)));



