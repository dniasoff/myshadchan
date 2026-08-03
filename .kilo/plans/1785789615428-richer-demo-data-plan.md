# Plan: Richer Supabase + FakeRest Demo Data

## Goal
Make the demo data genuinely showcase the system by pre-seeding realistic resume attachments, photos, a rich timeline, entity files, medical notes, external links, and date records in both the Supabase `seed_demo` edge function and the FakeRest demo generator.

## Resolved Decisions
- **Scope:** Update both `supabase/functions/seed_demo/` and `src/components/atomic-crm/providers/fakerest/dataGenerator/`.
- **Image/photo source:** Bundle a small repo-local asset pack of clearly fictional portrait JPEGs and sample PDFs. No real people, no runtime image API calls.
- **Optional data:** Include medical notes, entity files, external links, and date records.

## Current Gaps
`seed_demo` currently seeds only: 2 singles, 5 shadchanim, 4 references, 12 shidduchim, 2 reference calls, 3 plain timeline notes, 4 tasks, 1 extra redt.
It seeds **zero** rows for: `resumes`, `resume_photos`, `entity_files`, `medical_notes`, `shidduchim_external_links`, `date_records`. The timeline is also almost empty (no `status_change` events, no rich call logs).

The FakeRest generator has the same shape and the same gaps.

## Asset Strategy
1. Create a new directory `supabase/functions/seed_demo/assets/`.
2. Add:
   - `portraits/` — 8 small JPEG files (~20–40 KB each, 400×400 px), clearly fictional/synthetic-looking portrait photos. Names: `rivky-stern.jpg`, `yaakov-stern.jpg`, plus 6 suggestion portraits (e.g. `ahron-klein.jpg`, `eliezer-katz.jpg`, `shira-feldman.jpg`, etc.).
   - `resumes/` — 8 small PDF files containing realistic but fictional resume text for the same people.
   - `misc/` — 2–3 small generic files for the Files tab (e.g. `family-notes.pdf`, `reference-summary.pdf`).
3. The edge function will read these files as `Uint8Array` from the deployed bundle (use `Deno.readFile` locally; for deployed functions, files must be bundled in the function directory).
4. For FakeRest, create equivalent base64 strings or small `Blob`s in `src/components/atomic-crm/providers/fakerest/dataGenerator/assets.ts` so the demo provider can build `File` objects for upload mirrors.

> **Recommendation on portrait creation:** generate the JPEGs/PDFs locally using any available tool/script, then commit the bytes. Do not add a build-time dependency on an image API.

## Implementation Tasks

### 1. Asset pack
- Create `supabase/functions/seed_demo/assets/portraits/` and `.../resumes/` and `.../misc/`.
- Generate/commit 8 portrait JPEGs and 8 resume PDFs + 2–3 misc files.
- Create `supabase/functions/seed_demo/assets/manifest.ts` that exports a map:
  ```ts
  export const ASSETS = {
    portraits: {
      rivky: () => Deno.readFile(new URL("./portraits/rivky-stern.jpg", import.meta.url)),
      ...
    },
    resumes: { ... },
    misc: { ... },
  };
  ```
- Create `src/components/atomic-crm/providers/fakerest/dataGenerator/assets.ts` with base64 or `Blob` equivalents.

### 2. Extend `seed_demo/dataset.ts`
Add new seed data structures:
- `RESUME_FILES: Array<{ suggestionKey?: string; singleKey?: string; filename: string; assetKey: string; mimeType: "application/pdf" }>`
- `RESUME_PHOTOS: Array<{ suggestionKey?: string; singleKey?: string; assetKey: string; visibility: "shared" | "private_parent" }>`
- `ENTITY_FILES: Array<{ targetType: "shidduch" | "reference"; targetKey: string; filename: string; assetKey: string; mimeType: string; visibility: "shared" | "private_parent" }>`
- `MEDICAL_NOTES: Array<{ suggestionKey: string; body: string }>`
- `EXTERNAL_LINKS: Array<{ suggestionKey: string; url: string; label: string }>`
- `DATE_RECORDS: Array<{ singleKey: string; personName: string; personLocation: string; dateOn: string; outcome: string; notes: string }>`
- Expand `TIMELINE_NOTES` from 3 to ~12 entries covering multiple shidduchim.
- Add `STATUS_CHANGES: Array<{ suggestionKey: string; from: PipelineState; to: PipelineState; body?: string; atDaysAgo: number }>` to enrich the activity feed.
- Add more `REFERENCE_LINKS` (increase from 2 to ~6) so the references list and call logs look active.

### 3. Update `seed_demo/index.ts`
After the existing seed steps, add:
1. **Resume files** — for each resume entry:
   - Read PDF bytes from asset manifest.
   - Upload to `documents` bucket at `${accountId}/resumes/${ownerSegment}/${uuid}-${filename}` using `supabaseAdmin.storage` (or user client? see Notes below).
   - Call `add_resume_file` RPC with the path, filename, mime type, size.
2. **Resume photos** — for each photo entry:
   - Upload JPEG to `documents` bucket at `${accountId}/photos/${visibility}/${ownerSegment}/${uuid}-${filename}`.
   - Call `add_resume_photo` RPC.
3. **Entity files** — for each file entry:
   - Upload to `entity-files` bucket at `${accountId}/${targetType}/${targetId}/${uuid}${ext}`.
   - Insert row into `entity_files` with `storage_path`, `file_name`, `mime_type`, `size_bytes`, `visibility`, `uploaded_by_member_id`.
4. **Medical notes** — insert rows into `medical_notes` (target a few shidduchim).
5. **External links** — insert rows into `shidduchim_external_links`.
6. **Date records** — insert rows into `date_records` for closed shidduchim.
7. **Timeline enrichment** — insert `status_change` interactions and additional `note`/`call_logged` interactions.

> **Upload client choice:** The edge function currently builds a user-scoped client for row inserts so RLS and account_id triggers resolve correctly. Storage uploads do not need the user client if the function uses `supabaseAdmin` and constructs the correct account-prefixed path. However, the existing `add_resume_file`/`add_resume_photo` RPCs are SECURITY INVOKER and use `current_context_id()`, so they must be called with the user-scoped client. Therefore:
> - Upload bytes with `supabaseAdmin.storage` (service role) to the correct path.
> - Register the catalog row via the user-scoped client (`db.rpc('add_resume_file', ...)` / `db.rpc('add_resume_photo', ...)`).
> - For `entity_files`, insert the row directly with the user-scoped client (trigger sets `account_id`).

### 4. Update `clear_demo/index.ts`
Currently `clear_demo` deletes tenant rows but leaves orphaned objects in Storage. Because this plan adds files, update `clear_demo` to clean up storage **before** deleting rows:
1. Collect all `resumes.files[].path` and all `resume_photos.path` for the account.
2. Collect all `entity_files.storage_path` for the account.
3. Delete those objects from the `documents` and `entity-files` buckets using `supabaseAdmin.storage.from(...).remove([...])`.
4. Then run the existing FK-safe row deletion order.

### 5. Update FakeRest generator
- Add `assets.ts` with `Blob`/base64 versions of the same files.
- In `dataGenerator/index.ts` or a new helper, after `generateReferencesDomain(db)`:
  1. Attach resume files using the existing `uploadResumeFile` mirror.
  2. Attach resume photos using the existing `uploadResumePhoto` mirror.
  3. Attach entity files using the existing `uploadEntityFile` mirror.
  4. Insert medical notes, external links, date records directly into `db`.
  5. Insert enriched timeline interactions into `db.interactions`.
- Ensure deterministic IDs so existing component tests that assert exact counts/ids are not broken. Prefer appending new rows at the end of arrays and updating `db.interactions` in bulk after all other data is created.

### 6. Update existing tests if counts change
- Search for tests that assert `db.interactions.length`, `db.tasks.length`, etc., especially in `ActivityTab.test.tsx`, `NotesTab.test.tsx`, `FilesTab.test.tsx`, `ReferenceTimeline.tsx` tests, and shidduchim board tests.
- If the FakeRest generator changes row counts, update those assertions or move the new data to a deterministic late-ID range that does not collide with hardcoded test expectations.

## Data Enrichment Details (recommended seeding)

### Resume files
Attach PDFs to:
- Rivky Stern (single)
- Yaakov Stern (single)
- 6 suggested shidduchim: Ahron Klein, Eliezer Katz, Yosef Mandel, Esther Malka Weiss, Devora Leah Gross, Shira Feldman.

### Resume photos
Attach photos to:
- Rivky Stern (single) — `shared`
- Yaakov Stern (single) — `shared`
- 4 suggested shidduchim: Ahron Klein (`shared`), Eliezer Katz (`shared`), Shira Feldman (`private_parent`), Devora Leah Gross (`shared`).

### Entity files
Attach to:
- Shidduch Ahron Klein: `family-notes.pdf` (`shared`)
- Shidduch Eliezer Katz: `reference-summary.pdf` (`shared`)
- Reference Rabbi Avrohom Stein: `stein-notes.pdf` (`shared`)

### Medical notes
- On Eliezer Katz shidduch: "No concerns noted. Routine check with family doctor completed."
- On Shira Feldman shidduch: "Allergy to penicillin disclosed; not a concern for shidduch."

### External links
- Eliezer Katz: `https://example-shidduch-site.com/profile/eliezer-katz` (label: "Shidduch profile")
- Devora Leah Gross: `https://example-shidduch-site.com/profile/devora-leah-gross` (label: "Shidduch profile")

### Date records
- Yaakov Stern + "Bracha Gold" — date 30 days ago, outcome "no", notes "Nice girl, ages didn't work out."
- Rivky Stern + "Binyomin Reiss" — date 35 days ago, outcome "no", notes "Different hashkafos."

### Timeline enrichment
Add ~12 interactions total, including:
- `status_change` for every shidduch that moved from `look_into` → `yes`/`unsure`/`no`.
- `note` entries with realistic parent/shadchan notes on several shidduchim.
- `call_logged` entries for reference calls beyond the current 2.
- Keep existing `link_created` interactions (already created by `link_reference_to_shidduch`).

## Validation Steps
1. Run local Supabase stack:
   ```bash
   npx supabase start
   npx supabase functions serve seed_demo clear_demo
   ```
2. Clear and re-seed a test account:
   ```bash
   curl -X POST http://localhost:54321/functions/v1/clear_demo -H "Authorization: Bearer <token>"
   curl -X POST http://localhost:54321/functions/v1/seed_demo -H "Authorization: Bearer <token>"
   ```
3. Verify in the Supabase dashboard or via SQL:
   - `select count(*) from resumes;` → 8
   - `select count(*) from resume_photos;` → 6
   - `select count(*) from entity_files;` → 3
   - `select count(*) from medical_notes;` → 2
   - `select count(*) from shidduchim_external_links;` → 2
   - `select count(*) from date_records;` → 2
   - `select count(*) from interactions;` → ~18–22
4. Open the SPA against the local stack and confirm:
   - Resume tab shows PDF list with working download.
   - Photo tab shows images with reveal/visibility.
   - Files tab shows attached files.
   - Medical tab shows notes for admin users.
   - Activity tab shows a rich timeline.
5. Run `clear_demo` and verify Storage buckets `documents` and `entity-files` have no leftover objects for the account.
6. Run FakeRest demo (`npm run dev:demo`) and confirm the same tabs render populated data.
7. Run unit tests (`npm run test:unit:app`) and fix any broken assertions caused by changed seed counts.

## Risks & Mitigations
- **Storage path mismatch:** If the upload path and the path passed to `add_resume_file`/`add_resume_photo` differ, the file will be unreadable. Mitigation: use one shared helper that builds the path and passes it to both storage upload and the RPC.
- **Deno file access in deployed edge functions:** Files inside `supabase/functions/seed_demo/assets/` are deployed with the function and are readable with `Deno.readFile` relative to `import.meta.url`. Verify by serving locally first.
- **clear_demo orphan files:** Without storage cleanup, repeated seed/clear cycles will accumulate orphan objects. Mitigation: implement storage cleanup in `clear_demo` as described.
- **Tests with hardcoded IDs/counts:** The FakeRest generator is used as a shared fixture by many tests. Mitigation: keep new rows deterministic and append-only; grep for `.length` assertions on seeded arrays.
- **Medical notes visibility:** `medical_notes` RLS restricts to `parent_admin`/`self_manager`. The demo login in FakeRest is `administrator: true`, member role `parent_admin`. Verify the seeded account member has role `parent_admin` (it already does in `shidduchim.ts`).

## Open Questions (none remaining)
All major design decisions are resolved above.
