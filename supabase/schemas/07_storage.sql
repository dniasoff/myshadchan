--
-- Storage
-- This file declares storage bucket policies.
--

-- The `attachments` bucket holds resumes and photos — PRV-1's highest-sensitivity
-- data. It is PRIVATE and account-scoped by object-key prefix.
--
-- Inherited from the Atomic CRM fork, this bucket was `public = true` with a single
-- unscoped policy (`for select to authenticated using (bucket_id = 'attachments')`),
-- so any authenticated user of any account could read any object — and, the bucket
-- being public, so could an anonymous caller who knew or guessed a key. Keys were
-- `Math.random()`, which is not a secret. That violated AD-1 (cross-account leaks = 0),
-- AD-9 (no public URLs), PRV-5 and PRV-8.
--
-- Every object key MUST be `{account_id}/{random}`; the policies below scope on that
-- first path segment. `service_role` (the inbound-email worker) bypasses RLS and is
-- responsible for writing the correct prefix.
update storage.buckets set public = false where id = 'attachments';

drop policy if exists "Attachments 1mt4rzk_0" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_1" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_3" on storage.objects;

create policy "Attachments readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );

create policy "Attachments writable within account" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );

create policy "Attachments deletable within account" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );
