drop policy "Account access scoped to member" on "public"."accounts";

drop policy "Account members deletable within active account" on "public"."account_members";

drop policy "Account members insertable within active account" on "public"."account_members";

drop policy "Account members readable by owner or within active account" on "public"."account_members";

drop policy "AI usage readable within account" on "public"."ai_usage";

drop policy "Date records scoped to account" on "public"."date_records";

drop policy "Identity signals readable within account" on "public"."identity_signals";

drop policy "Inbox items scoped to account" on "public"."inbox_items";

drop policy "Invites readable within active account" on "public"."invites";

drop policy "Medical notes scoped to account, parent_admin/self_manager only" on "public"."medical_notes";

drop policy "Redts scoped to account" on "public"."redts";

drop policy "Resume photos scoped to account, single sees only shared" on "public"."resume_photos";

drop policy "Resumes scoped to account" on "public"."resumes";

drop policy "Shidduch schools scoped to account" on "public"."shidduch_schools";

drop policy "Shidduchim scoped to account" on "public"."shidduchim";

drop policy "Singles scoped to account" on "public"."singles";

drop policy "Subscription readable within account" on "public"."subscription";

drop policy "Tasks scoped to account" on "public"."tasks";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.current_member_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select am.role
  from public.account_members am
  where am.id = public.current_member_id();
$function$
;

-- `db diff` never re-emits function grants — hand-added, mirroring the
-- current_member_id() grant block exactly (06_grants.sql).
revoke all on function public.current_member_role() from public, anon;
grant execute on function public.current_member_role() to authenticated;
grant execute on function public.current_member_role() to service_role;


  create policy "Accounts readable to their members"
  on "public"."accounts"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = accounts.id) AND (am.user_id = auth.uid()) AND (am.status = 'active'::text)))));



  create policy "Accounts writable by non-single members"
  on "public"."accounts"
  as permissive
  for all
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = accounts.id) AND (am.user_id = auth.uid()) AND (am.status = 'active'::text)))) AND (public.current_member_role() <> 'single'::text)))
with check (((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = accounts.id) AND (am.user_id = auth.uid()) AND (am.status = 'active'::text)))) AND (public.current_member_role() <> 'single'::text)));



  create policy "Resumes visible to single"
  on "public"."resumes"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND ((EXISTS ( SELECT 1
   FROM (public.shidduchim s
     JOIN public.singles c ON ((c.id = s.single_id)))
  WHERE ((s.id = resumes.shidduchim_id) AND (s.visibility = 'shared'::text) AND public.is_single_visible_state(s.pipeline_state) AND (c.member_id = public.current_member_id())))) OR (EXISTS ( SELECT 1
   FROM public.singles c
  WHERE ((c.id = resumes.single_id) AND (c.member_id = public.current_member_id())))))));



  create policy "Shidduch schools visible to single"
  on "public"."shidduch_schools"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (EXISTS ( SELECT 1
   FROM (public.shidduchim s
     JOIN public.singles c ON ((c.id = s.single_id)))
  WHERE ((s.id = shidduch_schools.shidduchim_id) AND (s.visibility = 'shared'::text) AND public.is_single_visible_state(s.pipeline_state) AND (c.member_id = public.current_member_id()))))));



  create policy "Shidduchim visible to single"
  on "public"."shidduchim"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (visibility = 'shared'::text) AND public.is_single_visible_state(pipeline_state) AND (EXISTS ( SELECT 1
   FROM public.singles c
  WHERE ((c.id = shidduchim.single_id) AND (c.member_id = public.current_member_id()))))));



  create policy "Singles visible to self"
  on "public"."singles"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (member_id = public.current_member_id())));



  create policy "Account members deletable within active account"
  on "public"."account_members"
  as permissive
  for delete
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Account members insertable within active account"
  on "public"."account_members"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Account members readable by owner or within active account"
  on "public"."account_members"
  as permissive
  for select
  to authenticated
using (((user_id = auth.uid()) OR ((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text))));



  create policy "AI usage readable within account"
  on "public"."ai_usage"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Date records scoped to account"
  on "public"."date_records"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Identity signals readable within account"
  on "public"."identity_signals"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Inbox items scoped to account"
  on "public"."inbox_items"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Invites readable within active account"
  on "public"."invites"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Medical notes scoped to account, parent_admin/self_manager only"
  on "public"."medical_notes"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text]))))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text]))));



  create policy "Redts scoped to account"
  on "public"."redts"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Resume photos scoped to account, single sees only shared"
  on "public"."resume_photos"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND ((visibility = 'shared'::text) OR (public.current_member_role() <> 'single'::text))))
with check (((account_id = public.current_context_id()) AND ((visibility = 'shared'::text) OR (public.current_member_role() <> 'single'::text))));



  create policy "Resumes scoped to account"
  on "public"."resumes"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shidduch schools scoped to account"
  on "public"."shidduch_schools"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shidduchim scoped to account"
  on "public"."shidduchim"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Singles scoped to account"
  on "public"."singles"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Subscription readable within account"
  on "public"."subscription"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



  create policy "Tasks scoped to account"
  on "public"."tasks"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text)));



