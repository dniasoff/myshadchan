---
baseline_commit: 9d3157a
---

# Story 5.3: Resume tab with version history

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the resume stored with its versions,
so that I always have the newest and can see what changed.

## Position in Epic 5

Depends on **5.1** (which registers the shidduch descriptor and leaves `resume` in
`pendingTabs` for this story to claim — `5-1:44-52` states that hand-off explicitly).

Nothing in the current codebase implements this today: `public.resumes` is shaped but not built
(`supabase/schemas/01_tables.sql:309-319`, whose own comment reads *"1:1 with a shidduch (resume
detail is Epic-3; the table is shaped now)"* — the detail work has since been re-planned into
this epic), there is no `resumes` React resource, no upload UI, and the FakeRest generator seeds
`db.resumes = [] as Resume[]` (`providers/fakerest/dataGenerator/shidduchim.ts:404`). This is
genuinely greenfield — verified by `grep -rln "resumes" src/components/atomic-crm`, whose 14 hits
are type definitions, the billing usage-meter strings, landing copy, i18n catalogue entries and
empty FakeRest scaffolding. None of it is a UI.

`Resume.files` is `unknown` today (`types.ts:424-432`); this story gives it a shape.

## Why a new `documents` bucket — the argument, re-ratified

**This section replaces an earlier premise that was false.** An earlier draft of this story
opened by asserting that the `attachments` bucket is public and unscoped and that this story had
to close that hole. **It does not, because the hole is already closed.** At HEAD,
`supabase/schemas/07_storage.sql:19` runs
`update storage.buckets set public = false where id = 'attachments'` and `:25-44` carry three
account-scoped policies keyed on `(storage.foldername(name))[1] = public.current_context_id()::text`;
`providers/supabase/dataProvider.ts:800-819` writes `${accountId}/${crypto.randomUUID()}${fileExt}`
and returns `createSignedUrl(…, ATTACHMENT_URL_TTL_SECONDS)` under the comment *"Signed, expiring
URL — never a public one (AD-9, PRV-5, PRV-8)"*. **Do not "harden" `attachments`. Do not touch it
or its three policies at all.**

The `documents` bucket is still the right call, but on **Story 5.4's** grounds, not on a security
gap. State the real argument, because it is the only thing that keeps a later reader from
"simplifying" this story onto an existing bucket and silently breaking 5.4:

1. **Postgres storage policies are permissive — they OR together.** A policy can only ever *add*
   access to `storage.objects`. Once a bucket carries an account-wide select policy, no later
   policy can take reads away from a member of that account.
2. **Both existing private buckets carry exactly such a policy.** `attachments`
   (`07_storage.sql:25-30`) and `entity-files` (`07_storage.sql:72-77`) each grant select to any
   authenticated caller whose active context matches the object's first path segment — *every*
   member of the account, regardless of role.
3. **Story 5.4 needs stricter-than-account reads.** Its AC-4 requires that a `single`-role member
   of the same account cannot reach a `private_parent` photo *at the storage layer*, not merely
   through table RLS. That is unachievable in a bucket whose account-wide select policy already
   grants them the object, and narrowing `entity-files`' policy would change the shipped Files
   tab's behaviour for every existing file — out of scope for both stories.
4. **Therefore a third bucket, `documents`, whose every policy is written from scratch**, with
   unknown prefixes deny-by-default. This story defines only the `resumes/` prefix; 5.4 defines
   `photos/` on top of a keyspace no broader policy already covers.

**Rejected alternative, recorded so it is not re-proposed:** put resumes in `entity-files` and
only photos in `documents`. That splits the bucket's creation into 5.4 (which already depends on
this story for it), loses the single `{account}/{kind}/…` prefix grammar shared by the two, and
would additionally require every resume version to become a first-class `entity_files` row with
that table's four-segment key grammar and purge trigger (`01_tables.sql:584-626`,
`07_storage.sql:46-67`) — a different lifetime owner from this story's append-only
`resumes.files` log. Net: no simplification, one more seam.

**Why `documents` gets no UPDATE policy — a load-bearing constraint, not symmetry.**
`supabase/tests/context_rls_hardening.sql:141-146` asserts, **table-wide on `storage.objects`**,
that no policy with `cmd in ('UPDATE','ALL')` exists, and `:130-139` calls it *"a real,
load-bearing invariant … an UPDATE policy scoped only by bucket, without also re-deriving the
prefix check, is exactly the shape that would let a tenant move an object's key across the
account boundary."* `07_storage.sql:61-67` records the same reasoning for `entity-files`.
**A fourth (UPDATE) policy on `documents` turns that suite red.** Three policies —
select/insert/delete — is the shipped pattern and the correct one here: a resume is versioned by
*inserting* a new object, never by mutating an existing one. 5.4's photo policies stop at the
same three.

## Acceptance Criteria

1. **Given** a shidduch with a resume, **when** I open Resume, **then** I can view, download
   and upload a new version; previous versions remain listed with their upload dates, newest
   shown first by default.
   **Fails when:** the list renders in insertion order, or an older version disappears from the
   list after a new upload.
2. **Given** an existing version, **when** a new one is uploaded, **then** no existing version's
   file path, filename or upload date is ever mutated or removed — appends only, enforced
   server-side (not by a client-side read-modify-write of the JSON array, which would race under
   concurrent uploads).
   **Fails when:** the DB test in Task 4 issues two `add_resume_file` calls inside overlapping
   transactions and `jsonb_array_length(files)` is 1 rather than 2, or any client code path
   `PATCH`es `resumes.files` wholesale.
3. **Given** a shidduch with no resume yet, **when** I open Resume, **then** I see an empty
   state with only an upload action — no fabricated content.
   **Fails when:** the tab renders a placeholder row, a skeleton that never resolves, or an
   error because no `resumes` row exists.
4. **Given** the new `documents` storage bucket, **when** a file is uploaded, **then** it is
   stored under `{account_id}/resumes/{shidduchim_id}/{uuid}-{filename}`, and storage RLS grants
   **select, insert and delete — and only those three — to members of that `account_id`, and
   only under the `resumes/` second-level prefix**. Other prefixes stay deny-by-default for
   Story 5.4 to define. **No UPDATE policy is added** (see the section above).
   **Fails when:** (a) a second seeded account can `select`, `list` or `delete` a path under the
   first account's prefix; (b) an object written under a non-`resumes/` prefix of `documents` is
   readable by anyone; (c) `supabase/tests/context_rls_hardening.sql:141-146` reports
   `storage: no UPDATE-applicable policy exists on storage.objects` as failed — which it will
   the moment a fourth policy is added.
5. **Given** a download, **when** it is requested, **then** the client receives a short-lived
   signed URL minted per click and never persisted — never a public URL, and never one written
   back onto a record.
   **Fails when:** `getPublicUrl` appears anywhere in this story's diff, or a signed URL is
   stored in `resumes.files`.
6. **Given** the shidduch descriptor, **when** this story lands, **then** `"resume"` has moved
   **out of `shidduchim/entityDescriptor.ts`'s `pendingTabs` and into its `tabs`** in the same
   diff, and `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row has been updated to
   match.
   **Fails, loudly:** leaving the key in *both* arrays raises `tab-key-duplicated`
   (`entity360/ad24Conformance.ts:520-527`) and fails
   `npx vitest run src/components/atomic-crm/entity360`.
   **Fails, silently — the more likely mistake:** building `ResumeVersionList`/`ResumeUpload` and
   never editing the descriptor at all. `keys(tabs) ∪ pendingTabs` still equals the canonical row,
   so the validator says nothing (`ad24Conformance.ts:571-590`) — and the tab simply never renders,
   failing AC-1 with a green build. The guard test's own hand-off note (b)
   (`entity360/ad24Conformance.guard.test.ts:37-38`) states the rule: *"A story that builds a tab
   moves that key from `pendingTabs` into `tabs` in the same diff it lands."*

## Tasks / Subtasks

- [x] **Task 1 — Storage bucket and RLS** (AC: 4)
  - [x] `supabase/schemas/07_storage.sql`: create the `documents` bucket
        (`insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
        on conflict (id) do nothing;` — match the `entity-files` idiom at `:68-70`) and **exactly
        3 policies (select / insert / delete — never update)** scoped by
        `bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_context_id()::text
        and (storage.foldername(name))[2] = 'resumes'`. **Both halves of the predicate are
        required:** without the `bucket_id` guard the folder predicate applies to every other
        bucket's objects too (`07_storage.sql:56-59`).
        **`current_context_id()`, never `current_account_id()`:** the latter no longer exists
        (Epic 2 Story 2.1 deleted it), so a policy naming it fails to apply.
        **Do not touch the existing `attachments` or `entity-files` buckets or their policies.**
  - [x] Carry a comment block above the new bucket in the shape of `07_storage.sql:46-67`,
        recording (a) why this is a third bucket rather than reuse — the permissive-OR argument
        above — and (b) that the absence of an UPDATE policy is deliberate and asserted by
        `supabase/tests/context_rls_hardening.sql:141-146`.
  - [x] **Correct two now-stale prose claims in the same diff.** `07_storage.sql:6-7` says *"The
        `attachments` bucket holds resumes and photos"* and
        `supabase/tests/context_rls_hardening.sql:8-11` repeats it. After this story and 5.4 that
        is false — resumes and photos live in `documents`. Reword both; do not change any policy
        while doing it.
  - [x] Generate + hand-check the migration exactly as for any policy change (`db diff` over
        storage objects is often incomplete — verify all 3 policies and the bucket insert exist
        in the generated file before applying).
  - [x] Add the AC-4 negative test as a **new pair**, `supabase/tests/documents_storage.sql` +
        `supabase/tests/documents_storage.test.ts`. Every `.sql` suite in that directory has a
        paired `.test.ts` runner — 13 pairs at HEAD, no exceptions; copy `entity_files.test.ts`'s shape
        (it shells `psql` via `dbSuiteHelpers.ts`'s `DB_URL`/`bailIfDbUnreachable` and turns each
        emitted result row into a named test). Seed two accounts, write a path under each, assert
        account A's client can neither `select` nor `delete` account B's path, and that a path
        under a non-`resumes/` prefix is unreadable by its own writer.
- [x] **Task 2 — Server-side append (no client read-modify-write)** (AC: 2)
  - [x] New SQL function `public.add_resume_file(p_shidduchim_id bigint, p_path text,
        p_filename text, p_mime_type text, p_size bigint)` in `supabase/schemas/02_functions.sql`:
        validates the shidduch belongs to `current_context_id()`, upserts the `resumes` row
        (creating it on first upload — note `resumes_shidduchim_id_key unique (shidduchim_id)`
        at `01_tables.sql:703-704` makes that a clean `on conflict`), and does
        `files = coalesce(files, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('path', p_path, 'filename', p_filename, 'uploaded_at', now(), 'uploaded_by', public.current_member_id(), 'mime_type', p_mime_type, 'size', p_size))` —
        atomically, so two concurrent uploads cannot silently overwrite each other's entry.
        `current_member_id()` (`02_functions.sql:242`) is the shipped caller-resolution function
        — reuse it, do not re-derive the member lookup inline.
  - [x] **`supabase/schemas/06_grants.sql`, not `02_functions.sql`** — every function's
        `revoke all … from public, anon` + `grant execute … to authenticated, service_role`
        triple lives in the grants file (see `06_grants.sql:226-241` for the shape). A function
        added without its grant block is reachable by nobody. Follow the doc-comment convention
        of `add_redt` / `add_school` / `log_reference_call` (`02_functions.sql:2288`) for the
        function itself.
- [x] **Task 3 — Frontend and the tab mount** (AC: 1, 3, 5, 6)
  - [x] New folder `src/components/atomic-crm/resumes/` (a resume is its own domain, shared by
        the shidduch and — Story 5.8 — the single; do not nest it inside `shidduchim/`).
  - [x] `ResumeTab.tsx`: the descriptor's `resume` tab entry point — reads the shidduch via
        `useRecordContext()` and composes `ResumeVersionList` + `ResumeUpload` (plus AC-3's empty
        state). It is what the descriptor's `render` returns; without it the `render: () =>
        <ResumeTab />` below names a component nothing creates.
  - [x] `ResumeVersionList.tsx`: renders `resumes.files` newest-first (sort client-side by
        `uploaded_at desc` — the array is append-only, not stored sorted); each entry links a
        signed download URL fetched **on demand, per click** (do not pre-sign every entry on list
        load — `providers/supabase/entityFiles.ts:23-27` is the shipped precedent, and its TTL
        constant `ENTITY_FILE_URL_TTL_SECONDS = 60` is the right order of magnitude for a
        per-click URL).
  - [x] `ResumeUpload.tsx`: file picker → upload to `documents` at the AC-4 path → call
        `add_resume_file`. Add the matching `CrmDataProvider` custom method
        `uploadResumeFile({ shidduchimId, file }): Promise<Resume>` in
        `providers/supabase/dataProvider.ts` (which is where `CrmDataProvider` is declared;
        `providers/types.ts:1` only re-exports it), mirroring `addRedt` /`addSchool`
        (`dataProvider.ts:191-223`) — a thin wrapper over the RPC.
  - [x] Mirror in `providers/fakerest/dataProvider.ts` (AD-10: every custom method is kept in
        sync in both providers; see `:808-880` for the existing three).
  - [x] **Move the tab key.** In `shidduchim/entityDescriptor.ts`: add
        `{ key: "resume", render: () => <ResumeTab /> }` to `tabs` **in canonical position**
        (`resume` follows `overview` — `ad24Conformance.ts:216-229`) and **delete `"resume"` from
        `pendingTabs`**. Do **not** add a `label`: "Resume" is already the i18n default
        (`entity360/tabKeys.ts:49`, `providers/commons/englishCrmMessages.ts:389`), and an
        override would require a "why THIS entity deviates" comment
        (`entity360/entityDescriptor.ts:97-105`) for a deviation that does not exist.
  - [x] **`render` is arity-zero** (`entityDescriptor.ts:106-112`). The tab component reaches the
        shidduch through `useRecordContext()` — `EntityShow` mounts inside `ShowBase`, so a
        `RecordContext` always exists. Do not thread the record in as a prop, and do not add a
        prop to the descriptor to carry it.
  - [x] Update `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row (`:36-50`) — the
        `pendingTabs` literal loses `"resume"`. Note the file's blanket
        `expect(descriptor?.tabs).toEqual([])` at `:94` also goes red for `shidduchim` once 5.1
        lands; if 5.1 has not already reshaped that assertion, reshape it here rather than
        deleting it.
- [x] **Task 4 — Types, i18n and tests**
  - [x] `types.ts`: add a `ResumeFileVersion` type (`path`, `filename`, `uploaded_at`,
        `uploaded_by`, `mime_type`, `size`) and change `Resume.files` (`:427`) from `unknown` to
        `ResumeFileVersion[] | null`.
  - [x] **Both i18n catalogues** — `providers/commons/englishCrmMessages.ts` **and**
        `frenchCrmMessages.ts` — for this story's content strings (empty state, upload button,
        version-row labels, error notifications). `i18nProvider` runs `allowMissing: true`, so a
        key added only to English falls back silently and is never caught by a test. **No
        `crm.entity360.tab.*` key is needed** — all 15 tab labels already ship
        (`englishCrmMessages.ts:381-397`).
  - [x] Component tests for `ResumeVersionList` / `ResumeUpload` covering empty, loading and
        error states (`.claude/rules/testing.md`). **Stack:** `vitest-browser-react`'s `render`
        in Chromium, with `CoreAdminContext` + `TestMemoryRouter` from `ra-core` and the FakeRest
        provider — copy `entity360/tabs/FilesTab.test.tsx:1-16`. **React Testing Library is not a
        dependency of this repo**; do not import `@testing-library/react`.
  - [x] A DB test for `add_resume_file`'s append behaviour, in the
        `supabase/tests/documents_storage.{sql,test.ts}` pair from Task 1 (or its own pair — but
        a `.sql` file without a `.test.ts` runner never executes).
  - [x] `make typecheck && npm run lint && make test`, plus `npm run test:unit:db` (needs
        `make start`) — the last is the only thing that runs Task 1's negative test and
        `context_rls_hardening`.

## Dev Notes

### Files this story touches that are easy to miss

`supabase/schemas/06_grants.sql` (Task 2 — function grants do not live in `02_functions.sql`);
`supabase/tests/documents_storage.test.ts` (a `.sql` suite with no paired runner is never
executed); `supabase/schemas/07_storage.sql:6-7` and `supabase/tests/context_rls_hardening.sql:8-11`
(prose that becomes false); `entity360/registry.stubs.test.ts` (pinned `pendingTabs` row);
`registry.json` (`scripts/generate-registry.mjs` globs every non-test source file under
`src/components/atomic-crm/**`, so the new `resumes/` folder mutates it; `.husky/pre-commit`
regenerates); both i18n catalogues; `types.ts`.

### Reuse — extend, do not fork

`uploadToBucket()` (`providers/supabase/dataProvider.ts:765-831`) is the existing generic upload
helper, used by the config logo and the member avatar. It is **correct and secure** — account-
prefixed CSPRNG key, private bucket, signed URL — but it is hard-wired to `ATTACHMENTS_BUCKET`
and to a two-segment key, so it cannot express this story's `{account}/resumes/{shidduch}/…`
grammar. Write a resume-specific upload path against `documents`, modelled on
`providers/supabase/entityFiles.ts` (the closest precedent: a second bucket, its own key grammar,
its own per-click TTL). **Do not modify `uploadToBucket()` or its callers** — that would touch the
logo/avatar flow this story has no reason to change.

### Why a server-side append function, not a client PATCH

A client that reads `resumes.files`, appends in JS, and `PATCH`es the whole array back loses a
concurrent upload under a classic read-modify-write race (two tabs, two uploads, last write
wins — silently deleting the other version, the exact thing AC-2 forbids). `add_resume_file`
does the append inside one statement, server-side, closing that race — the same reasoning
`log_reference_call` already applies to `reference_links.conversation_log`
(`supabase/schemas/02_functions.sql:2288`, whose comment at `:2322` reads *"The log is append-only
and lives in a jsonb column"*). Follow that function's shape (RPC name, `search_path ''`,
account-ownership check, `raise exception` on a bad target) rather than inventing a new
convention.

### AD-9 scope boundary — stated so it is not silently expanded later

AD-9 specifies R2 + a Worker-proxied stream (no raw/pre-signed URL ever reaches a recipient,
`share_access_log` on every request) as the target architecture for user media. No epic in the
current 1–11 list stands up the Cloudflare Workers layer. This story stays on Supabase Storage
signed URLs as the pragmatic interim for **internal, authenticated viewing within the household's
own session** — a materially different threat model from handing a link to an external recipient.
Use a short, per-click TTL in the shape of `ENTITY_FILE_URL_TTL_SECONDS = 60`
(`providers/supabase/entityFiles.ts:18`), **not** `ATTACHMENT_URL_TTL_SECONDS`
(`dataProvider.ts:745`, which is `60 * 60` — one hour — because that one is written onto a record
and re-read later; this one is consumed immediately). Full AD-9 compliance (proxied streaming,
revocation, access logging) is Epic 9's concern when a resume is shared *outside* the account
(Story 9.5, revocable share links) — this story does not attempt it and must not be read as
having satisfied AD-9.

### Project Structure Notes

- New directory `src/components/atomic-crm/resumes/`, following the existing one-folder-per-domain
  convention.
- `resumes` is not registered as a `<Resource>` in the route manifest — it has no list/show route
  of its own (matching how `reference_links` is read via `useGetList` without a `<Resource>`
  entry). Data access is via the dataProvider directly, and the tab is mounted through the
  shidduch descriptor, not through a route.
- **No household-scope trigger question arises here.** This story adds no table:
  `public.resumes` already exists and already carries both `set_resumes_account_id` and
  `validate_resumes_household_scope` (`04_triggers.sql:218-220`), so
  `supabase/tests/household_scope_lift.sql:56-64`'s `= 11` literal (`:58`) is untouched. (Stories 5.4,
  5.5 and 5.6 each *do* add a table and must each bump it — that is their problem, not this
  story's, and only one of them can be in flight at a time.)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.3]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9 — :98-101] —
  media storage target architecture and this story's documented scope boundary against it.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10 — :103-106] —
  the dataProvider is the single CRUD seam; keep FakeRest in sync.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — :57-60] —
  isolation is enforced in Postgres; RLS on `current_context_id()`.
- [Source: supabase/schemas/07_storage.sql:19-44] — `attachments` is already private and
  account-scoped. This story does not change it.
- [Source: supabase/schemas/07_storage.sql:46-91] — the `entity-files` bucket: the template for a
  second private bucket, and the "deliberately no UPDATE policy" precedent (`:61-67`).
- [Source: supabase/tests/context_rls_hardening.sql:130-146] — the table-wide no-UPDATE-policy
  invariant on `storage.objects` that caps this story at three policies.
- [Source: supabase/schemas/02_functions.sql:2288-2330 (`log_reference_call`)] — the append-only
  jsonb pattern `add_resume_file` follows.
- [Source: supabase/schemas/06_grants.sql:226-241] — where a new function's grants go.
- [Source: src/components/atomic-crm/entity360/entityDescriptor.ts:94-115] — `EntityTabDescriptor`:
  `label` optional, `render` arity-zero.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts:32-48] — hand-off
  note (b): a story that builds a tab moves its key in the same diff.
- [Source: .claude/rules/security-triggers.md] — file-system-operation and RLS-policy triggers;
  dispatch SECURITY-REVIEWER on this diff.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow), STACK_ID=3 / STACK_OWNER=5-3.

### Debug Log References

- `npx supabase db diff --local` was run twice (once before any schema edit, once after) to
  fingerprint a pre-existing, unrelated diff artifact: even with zero changes, `db diff` re-emits a
  drop+recreate of `reference_links_summary` / `shadchan_stats` / `shidduchim_summary` /
  `singles_summary` (security_invoker stripped, per the repo's known `db diff`-and-views quirk —
  already documented and hand-fixed once in 5-2's migration). Confirmed reproducible independent of
  this story's changes, so the generated migration excludes those four statements entirely rather
  than re-doing unrelated work; the post-change diff was re-verified to contain nothing else besides
  the same pre-existing noise.
- `db diff` did not emit the `insert into storage.buckets (...) values ('documents', ...)` statement
  at all (the story's own warning: "db diff over storage objects is often incomplete") — hand-added
  in the same position 07_storage.sql itself uses.
- `supabase migration up --local` applied the new migration cleanly; `npm run test:unit:db` (16
  files, 496 tests) passed afterward, including `context_rls_hardening` (the table-wide no-UPDATE-
  policy invariant this story could have broken) and the new `documents_storage` suite (15 checks).

### Completion Notes List

- Storage: added the `documents` bucket (private) with exactly 3 policies (select/insert/delete,
  scoped to `bucket_id = 'documents' AND [1] = current_context_id() AND [2] = 'resumes'`) — no UPDATE
  policy, verified `context_rls_hardening.sql`'s table-wide invariant stays green. Corrected the two
  stale "attachments holds resumes and photos" prose comments (07_storage.sql, context_rls_hardening.sql)
  without touching either bucket's policies.
- DB function: `add_resume_file(p_shidduchim_id, p_path, p_filename, p_mime_type, p_size)` —
  SECURITY INVOKER, account-ownership check, upserts `resumes` on `shidduchim_id` conflict and
  appends to `files` inside the `ON CONFLICT ... DO UPDATE`'s own row-locked read (never a
  client-supplied stale value), so two calls append two entries rather than one overwriting the
  other. Grants added to `06_grants.sql` (not `02_functions.sql`).
- New `documents_storage.{sql,test.ts}` pair (15 checks): cross-account SELECT/INSERT/DELETE denial
  under the `resumes/` prefix, deny-by-default for a non-`resumes/` prefix (Story 5.4's future
  `photos/` prefix stays untouched), `add_resume_file`'s append-only behaviour (two calls -> array
  length 2, first entry's `path`/`uploaded_at` byte-identical afterward), and the same
  account-ownership guard `add_redt`/`add_school` already carry.
- Frontend: new `resumes/` domain folder (`ResumeTab`, `ResumeUpload`, `ResumeVersionList`) —
  `ResumeTab` is the descriptor's `render` target, arity-zero, reaching the shidduch via
  `useRecordContext()`. `ResumeVersionList` reads the shidduch's single `resumes` row and sorts
  `files` newest-first client-side (append-only, not stored sorted); AC-3's empty state covers both
  "no `resumes` row yet" and "row exists with an empty `files` array". Download mints a signed URL
  per click via a new `signResumeFileUrl` custom method (60s TTL, matching `ENTITY_FILE_URL_TTL_SECONDS`'s
  order of magnitude, never `ATTACHMENT_URL_TTL_SECONDS`).
- Provider: `providers/supabase/resumes.ts` (`uploadResumeFile`, `signResumeFileUrl`, modelled on
  `entityFiles.ts`) wired into `dataProvider.ts`'s custom-methods overlay; mirrored in
  `providers/fakerest/internal/resumes.ts` + `providers/fakerest/dataProvider.ts` (AD-10) with its
  own blob-URL map, separate from `entityFileBlobUrls`.
- Descriptor: `shidduchim/entityDescriptor.tsx` — `{ key: "resume", render: () => <ResumeTab /> }`
  added to `tabs` in canonical position (after `overview`), `"resume"` removed from `pendingTabs`,
  in the same diff. `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row updated to match
  (`tabs` gains `resume`, `pendingTabs` loses it) — 5.1 had already reshaped this file into
  `describe.each`, so no further reshape was needed (the story's own hedge).
- Types: `ResumeFileVersion` added; `Resume.files` widened from `unknown` to
  `ResumeFileVersion[] | null`.
- i18n: `crm.entity360.resume.*` (empty/error/upload/uploadError/download/downloadError) added to
  both `englishCrmMessages.ts` and `frenchCrmMessages.ts`. No `crm.entity360.tab.*` key needed
  ("Resume" was already the shipped default).
- Tests: `ResumeUpload.test.tsx`, `ResumeVersionList.test.tsx` (loading/empty/error/ordering/signed-
  URL-per-click), and `ResumeTab.test.tsx` (a real FakeRest round trip proving `useRefresh()`'s
  global invalidation makes an upload show up in the sibling list, and that a second upload appends
  rather than replaces).
- Gates run and green: `make typecheck`, `npm run lint` (0 warnings), `npx vitest run` (187 files /
  1927 tests), `make build`, `npx prettier --check .` (no new file flagged — all pre-existing
  warnings are in `doc/`, `.github/`, `.lintstagedrc`, none touched by this story),
  `check-retired-names`, `check-suppressions`, `check-route-convention`,
  `check-tailwind-arbitrary-var` (all `EXIT=0`), `npm run test:unit:db` (16 files / 496 tests,
  including the new suite), `supabase db diff --local` (hand-verified, see Debug Log).
  `make test STACK_ID=3` was also run: the DB project's suites report skipped (this story required
  no e2e/browser flow, so no `make start-app-e2e`/`start-supabase-e2e` stack was started under
  STACK_ID 3 — `bailIfDbUnreachable` skips gracefully outside CI); DB coverage was independently
  confirmed via `npm run test:unit:db` against the local dev Supabase stack instead.
- Not done / deferred, by design: no `useLatestResumeFile` extraction — Story 5.7's own task text
  (`5-7-shidduch-right-rail.md` Task 3) defers that extraction to itself ("if it does not already
  exist as a reusable function"), so building it here would be scope creep the pre-flight brief's
  §8 warns against.

### File List

- `supabase/schemas/07_storage.sql` (new `documents` bucket + 3 policies; stale prose corrected)
- `supabase/schemas/02_functions.sql` (`add_resume_file`)
- `supabase/schemas/06_grants.sql` (`add_resume_file` grants)
- `supabase/tests/context_rls_hardening.sql` (stale prose corrected, no policy change)
- `supabase/tests/documents_storage.sql` (new)
- `supabase/tests/documents_storage.test.ts` (new)
- `supabase/migrations/20260730025903_resume_documents_bucket.sql` (new)
- `src/components/atomic-crm/types.ts` (`ResumeFileVersion`, `Resume.files` widened)
- `src/components/atomic-crm/resumes/ResumeTab.tsx` (new)
- `src/components/atomic-crm/resumes/ResumeTab.test.tsx` (new)
- `src/components/atomic-crm/resumes/ResumeUpload.tsx` (new)
- `src/components/atomic-crm/resumes/ResumeUpload.test.tsx` (new)
- `src/components/atomic-crm/resumes/ResumeVersionList.tsx` (new)
- `src/components/atomic-crm/resumes/ResumeVersionList.test.tsx` (new)
- `src/components/atomic-crm/providers/supabase/resumes.ts` (new)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` (wires `uploadResumeFile` /
  `signResumeFileUrl`)
- `src/components/atomic-crm/providers/fakerest/internal/resumes.ts` (new)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (AD-10 mirror wiring)
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` (`resume` moved into `tabs`)
- `src/components/atomic-crm/entity360/registry.stubs.test.ts` (pinned `shidduchim` row updated)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (`crm.entity360.resume.*`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (`crm.entity360.resume.*`)
- `registry.json` (regenerated — 4 new source files)

## Change Log

- 2026-07-30: Story implemented — `documents` storage bucket (3 policies, no UPDATE),
  `add_resume_file()` server-side append function, `resumes/` frontend domain (ResumeTab /
  ResumeUpload / ResumeVersionList), `resume` moved from `pendingTabs` into `tabs` on the
  `shidduchim` descriptor. All gates green (typecheck, lint, full unit suite, DB suite, build,
  prettier, four CI guards). Status -> review.
