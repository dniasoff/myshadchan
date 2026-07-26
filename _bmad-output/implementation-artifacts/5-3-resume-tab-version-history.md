# Story 5.3: Resume tab with version history

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the resume stored with its versions,
so that I always have the newest and can see what changed.

## Position in Epic 5

Depends on **5.1** (the `resume` tab slot). Nothing in the current codebase implements this
today: `public.resumes` is "shaped but not built" (its own schema comment), there is no `resumes`
React resource, no upload UI, and `db.resumes = []` in FakeRest. This is genuinely greenfield —
verified by `grep -rln "resumes\b" src/components/atomic-crm` returning only type definitions,
a billing usage-meter string, and empty FakeRest scaffolding, none of it a UI.

## A pre-existing security gap this story must close before adding sensitive uploads

`storage.objects` policies for the `attachments` bucket (`supabase/schemas/07_storage.sql`) are
`to authenticated using (true)` / `with check (true)` — **any authenticated user, in any
account, can read, write or delete any file in that bucket.** `uploadToBucket()`
(`providers/supabase/dataProvider.ts:809`) writes to a flat, unprefixed path
(`${random}${ext}`), so there is no account partition to even retrofit a path-based policy onto.

This story is the first to put account-private, sensitive content (a resume) into storage. Per
`.claude/rules/security-triggers.md` ("File system operations" and "Supabase RLS policies" are
both explicit triggers), this is not optional cleanup — it blocks this story's own AC-4. The
fix is scoped narrowly so it cannot regress the two existing legitimate `attachments` users
(the config/branding logo and the member avatar, both `uploadToBucket()` callers that survive
Epic 1's `sales`→`members` rename): **a new, separate storage bucket**, `documents`, used only by
Resume (this story), Photo (5.4) and generic Files (5.6's wiring into Epic 3's files component).
`attachments` and its existing policies are untouched — zero blast radius on the logo/avatar
paths.

## Acceptance Criteria

1. **Given** a suggestion with a resume, **when** I open Resume, **then** I can view, download
   and upload a new version; previous versions remain listed with their upload dates, newest
   shown first by default.
2. **Given** an existing version, **when** a new one is uploaded, **then** no existing version's
   file path, filename or upload date is ever mutated or removed — appends only, enforced
   server-side (not by a client-side read-modify-write of the JSON array, which would race under
   concurrent uploads).
3. **Given** a suggestion with no resume yet, **when** I open Resume, **then** I see an empty
   state with only an upload action — no fabricated content.
4. **Given** the new `documents` storage bucket, **when** a file is uploaded, **then** it is
   stored under `{account_id}/resumes/{shidduchim_id}/{uuid}-{filename}`, and storage RLS permits
   select/insert/update/delete only to members of that `account_id`. **Negative test:** a second
   seeded account cannot read, list or delete a path under the first account's prefix.
5. **Given** a download, **when** it is requested, **then** the client receives a short-lived
   signed URL (existing `createSignedUrl` pattern) — never a public or permanently valid URL.

## Tasks / Subtasks

- [ ] **Task 1 — Storage bucket and RLS** (AC: 4)
  - [ ] `supabase/schemas/07_storage.sql`: create the `documents` bucket
        (`insert into storage.buckets (id, name, public) values ('documents', 'documents', false)`)
        and 4 policies (select/insert/update/delete) scoped by
        `(storage.foldername(name))[1] = public.current_account_id()::text` — the standard
        Supabase per-folder RLS idiom. Do **not** touch the existing `attachments` bucket or its
        3 policies.
  - [ ] Generate + hand-check the migration exactly as for any policy change (`db diff` on
        storage objects is often incomplete — verify the 4 policies exist in the generated file
        before applying).
  - [ ] Add the negative test from AC-4 to `supabase/tests/` (new file, e.g.
        `supabase/tests/documents_storage.sql`): seed two accounts, upload a path under each,
        assert account A's client cannot `select`/`delete` account B's path.
- [ ] **Task 2 — Server-side append (no client read-modify-write)** (AC: 2)
  - [ ] New SQL function `public.add_resume_file(p_shidduchim_id bigint, p_path text,
        p_filename text, p_mime_type text, p_size bigint)` in `supabase/schemas/02_functions.sql`:
        validates the shidduch belongs to `current_account_id()`, upserts the `resumes` row
        (creating it on first upload), and does
        `files = coalesce(files, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('path', p_path, 'filename', p_filename, 'uploaded_at', now(), 'uploaded_by', <member id>, 'mime_type', p_mime_type, 'size', p_size))` —
        atomically, so two concurrent uploads cannot silently overwrite each other's entry.
  - [ ] Grant `execute` to `authenticated`, follow the existing RPC comment/doc-block convention
        (see `add_redt`/`add_school`/`log_reference_call` immediately above/below it in
        `02_functions.sql` for the house style).
- [ ] **Task 3 — Frontend** (AC: 1, 3, 5)
  - [ ] New folder `src/components/atomic-crm/resumes/` (a resume is its own domain, shared by
        the shidduch and — Story 5.8 — the single; do not nest it inside `shidduchim/`).
  - [ ] `ResumeVersionList.tsx`: renders `resumes.files` newest-first (sort client-side by
        `uploaded_at desc` — the array is append-only, not stored sorted); each entry links a
        signed download URL fetched on demand (do not pre-sign every entry on list load).
  - [ ] `ResumeUpload.tsx`: file picker → upload to `documents` bucket at the AC-4 path → call
        `add_resume_file`. Add the matching `CrmDataProvider` custom method
        `uploadResumeFile({ shidduchimId, file }): Promise<Resume>` in
        `providers/supabase/dataProvider.ts`, mirroring the existing `addRedt`/`addSchool`
        method shape (thin wrapper over the RPC).
  - [ ] Mirror in `providers/fakerest/dataProvider.ts` (AD-10: every custom method is kept in
        sync in both providers).
  - [ ] Wire the `resume` tab (from 5.1's descriptor) to render `ResumeVersionList` +
        `ResumeUpload`.
- [ ] **Task 4 — Types and tests**
  - [ ] `types.ts`: add a `ResumeFileVersion` type (`path`, `filename`, `uploaded_at`,
        `uploaded_by`, `mime_type`, `size`) and change `Resume.files` from `unknown` to
        `ResumeFileVersion[] | null`.
  - [ ] Component tests for `ResumeVersionList`/`ResumeUpload` (empty/loading/error states per
        `.claude/rules/testing.md`); a DB test for `add_resume_file`'s append behaviour
        (`supabase/tests/`).

## Dev Notes

### Reuse — extend, do not fork

`uploadToBucket()` (`providers/supabase/dataProvider.ts:809`) is the existing generic upload
helper (used today by the config logo and the member avatar). Its unscoped, flat-path design is
exactly what AC-4 forbids for a resume, so this story does **not** call it as-is — write a
resume-specific upload path that targets the `documents` bucket with the account-scoped prefix.
Do not modify `uploadToBucket()` itself or its callers; that would touch the logo/avatar flow
this story has no reason to change.

### Why a server-side append function, not a client PATCH

A client that reads `resumes.files`, appends in JS, and `PATCH`es the whole array back loses a
concurrent upload under a classic read-modify-write race (two tabs, two uploads, last write
wins — silently deleting the other version, the exact thing AC-2 forbids). `add_resume_file`
does the append inside one statement, server-side, closing that race — the same reasoning
`log_reference_call` already applies to `reference_links.conversation_log`
(`supabase/schemas/02_functions.sql:1493`, "append-only and lives in a jsonb column"). Follow
that function's shape (RPC name, `search_path ''`, account-ownership check, `raise exception` on
a bad target) rather than inventing a new convention.

### AD-9 scope boundary — stated so it is not silently expanded later

AD-9 specifies R2 + a Worker-proxied stream (no raw/pre-signed URL ever reaches a recipient,
`share_access_log` on every request) as the target architecture for user media. No epic in the
current 1–11 list stands up the Cloudflare Workers layer. This story stays on Supabase Storage
signed URLs (60-second expiry, matching the existing `createSignedUrl` call in
`uploadToBucket`) as the pragmatic interim for **internal, authenticated viewing within the
household's own session** — a materially different threat model from handing a link to an
external recipient. Full AD-9 compliance (proxied streaming, revocation, access logging) is
Epic 9's concern when a resume is shared *outside* the account (Story 9.5, revocable share
links) — this story does not attempt it and must not be read as having satisfied AD-9.

### Project Structure Notes

- New directory `src/components/atomic-crm/resumes/`, following the existing one-folder-per-domain
  convention.
- `resumes` is not registered as a `<Resource>` in the route manifest — it has no list/show route
  of its own (matching how `children_summary`/`reference_links` are read via `useGetList` without
  a `<Resource>` entry). Data access is via the dataProvider directly.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.3]
- [Source: ARCHITECTURE-SPINE.md#AD-9] — media storage target architecture and this story's
  documented scope boundary against it.
- [Source: ARCHITECTURE-SPINE.md#AD-10] — dataProvider custom-method seam; keep FakeRest in sync.
- [Source: .claude/rules/security-triggers.md] — file-system-operation and RLS-policy triggers
  this story satisfies.
- [Source: supabase/schemas/02_functions.sql#log_reference_call] — append-only jsonb pattern this
  story's `add_resume_file` follows.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
