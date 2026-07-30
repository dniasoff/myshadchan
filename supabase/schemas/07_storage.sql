--
-- Storage
-- This file declares storage bucket policies.
--

-- The `attachments` bucket is a private, account-scoped bucket for general
-- account assets (the config logo, member avatars). It used to hold resumes
-- and photos too; Story 5.3 moved resumes to the `documents` bucket below
-- (Story 5.4 moves photos there as well) — see that bucket's own comment for
-- why a resume/photo needs a bucket `attachments`' account-wide policies
-- cannot retrofit.
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

-- Story 5.3: a THIRD private bucket, `documents`, for resumes (this story's
-- `resumes/` prefix) and — Story 5.4 — photos (a `photos/` prefix). Not a
-- security fix for `attachments` or `entity-files` (both are already
-- private and account-scoped): a new capability with stricter-than-account
-- read rules a permissive policy on either existing bucket cannot retrofit.
--
-- Postgres storage policies are permissive — they OR together. A policy can
-- only ever ADD access; it can never take it away. `attachments` and
-- `entity-files` each already carry an account-wide SELECT policy (every
-- member of the account, any role), so no later, narrower policy on either
-- of THOSE buckets could ever produce a stricter-than-account read for a
-- future prefix. Story 5.4's AC-4 needs exactly that (a `single`-role member
-- must not reach a `private_parent` photo at the storage layer), which is
-- only achievable in a bucket whose every policy is written from scratch —
-- hence a third bucket, with every prefix except the ones explicitly
-- defined below staying deny-by-default.
--
-- This story defines only the `resumes/` second-level prefix. Both halves
-- of every predicate are required: the `bucket_id` guard (or the folder
-- predicate would apply to every other bucket's objects too, exactly like
-- `entity-files`' own comment above) AND the `(storage.foldername(name))[2]
-- = 'resumes'` guard (or a future `photos/` prefix, added in Story 5.4,
-- would inherit these same three policies rather than getting its own).
--
-- Deliberately ONLY select/insert/delete — NO update policy, and (as for
-- `entity-files` above) that is load-bearing:
-- supabase/tests/context_rls_hardening.sql asserts, table-wide, that no
-- UPDATE-applicable policy exists on storage.objects at all. A resume is
-- versioned by INSERTING a new object and appending to `resumes.files`
-- (public.add_resume_file) — never by mutating or renaming an existing one.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "Documents resumes readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'resumes'
    );

create policy "Documents resumes writable within account" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'resumes'
    );

create policy "Documents resumes deletable within account" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'resumes'
    );

-- Story 5.4: the `photos/` second-level prefix on the SAME `documents`
-- bucket (this story's whole reason for that bucket's existence — see the
-- comment above). Key grammar:
-- `{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`, or
-- (Story 5.8) `{account_id}/photos/{visibility}/single-{single_id}/{uuid}-{filename}`
-- for a single's own resume — the visibility is segment [3] either way,
-- because storage policies can only reason about
-- storage.foldername(name), never about a resume_photos row (AC-4). Without
-- this, resume_photos' table RLS (05_policies.sql) is decorative: a
-- `single`-role member could read the row (learning nothing useful) but
-- could just as easily be handed a signed URL if the OBJECT itself were not
-- also gated by the same role check.
--
-- Deliberately ONLY select/insert/delete — NO update policy (AC-6, same
-- load-bearing invariant `entity-files`/`documents resumes` above already
-- carry, asserted table-wide by
-- supabase/tests/context_rls_hardening.sql): a photo's visibility is fixed
-- at upload time; changing it means hide (hide_resume_photo) + re-upload,
-- never an in-place object rename.
create policy "Documents photos readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'photos'
        and (
            (storage.foldername(name))[3] = 'shared'
            or exists (
                select 1 from public.account_members am
                where am.id = public.current_member_id() and am.role <> 'single'
            )
        )
    );

create policy "Documents photos writable within account" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'photos'
        and (storage.foldername(name))[3] in ('shared', 'private_parent')
    );

create policy "Documents photos deletable within account" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'photos'
        and (storage.foldername(name))[3] in ('shared', 'private_parent')
    );
