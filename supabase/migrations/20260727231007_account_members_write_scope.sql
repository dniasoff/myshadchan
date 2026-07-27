drop policy "Account members scoped to account" on "public"."account_members";


  create policy "Account members deletable within active account"
  on "public"."account_members"
  as permissive
  for delete
  to authenticated
using ((account_id = public.current_context_id()));



  create policy "Account members insertable within active account"
  on "public"."account_members"
  as permissive
  for insert
  to authenticated
with check ((account_id = public.current_context_id()));



  create policy "Account members readable by owner or within active account"
  on "public"."account_members"
  as permissive
  for select
  to authenticated
using (((user_id = auth.uid()) OR (account_id = public.current_context_id())));



  create policy "Account members updatable within active account"
  on "public"."account_members"
  as permissive
  for update
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



