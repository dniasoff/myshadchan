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

-- Story 3.7: a second private bucket for entity_files objects (the Files
-- tab). `attachments` above is already private and account-scoped — this is
-- not a security fix, it is a second capability with its own lifetime owner
-- (a first-class entity_files row with its own purge trigger, not a URL
-- written back onto a record) and its own key grammar
-- (`{account_id}/{target_type}/{target_id}/{uuid}{ext}`, four segments, so a
-- target's objects can be enumerated and removed as a unit — see
-- providers/supabase/dataProvider.ts's `removeEntityFileObjects`).
--
-- The three policies below are the `attachments` policies immediately above,
-- copied with the bucket id swapped — the correct template, not a
-- counter-example. Both halves of every predicate are required: without the
-- `bucket_id` guard, the folder predicate would apply to every other
-- bucket's objects too.
--
-- Deliberately ONLY select/insert/delete — NO update policy, and that is
-- load-bearing: supabase/tests/context_rls_hardening.sql asserts, table-wide,
-- that no UPDATE-applicable policy exists on storage.objects at all. An
-- UPDATE policy scoped only by bucket, without re-deriving the prefix check,
-- is exactly the shape that lets a tenant rename an object across the
-- account boundary. "Replace" is delete + upload (FilesTab.tsx), never an
-- object rename.
insert into storage.buckets (id, name, public)
values ('entity-files', 'entity-files', false)
on conflict (id) do nothing;

create policy "Entity files readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'entity-files'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );

create policy "Entity files writable within account" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'entity-files'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );

create policy "Entity files deletable within account" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'entity-files'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );
