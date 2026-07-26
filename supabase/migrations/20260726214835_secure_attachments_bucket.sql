-- SECURITY FIX. The `attachments` bucket — resumes and photos, PRV-1's most
-- sensitive data — shipped from the Atomic CRM fork as `public = true` with a single
-- unscoped policy, so any authenticated user of any account could read any object and
-- an anonymous caller could too. Object keys were `Math.random()`, not a secret.
-- Violated AD-1 (cross-account leaks = 0), AD-9 (no public URLs), PRV-5, PRV-8.
--
-- `supabase db diff` does not diff `storage.buckets` rows, so this line is hand-added
-- and is the load-bearing half of the fix — without it the bucket stays public and the
-- policies below are moot.
update storage.buckets set public = false where id = 'attachments';

drop policy "Attachments 1mt4rzk_0" on "storage"."objects";

drop policy "Attachments 1mt4rzk_1" on "storage"."objects";

drop policy "Attachments 1mt4rzk_3" on "storage"."objects";


  create policy "Attachments deletable within account"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_account_id())::text)));



  create policy "Attachments readable within account"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_account_id())::text)));



  create policy "Attachments writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_account_id())::text)));



