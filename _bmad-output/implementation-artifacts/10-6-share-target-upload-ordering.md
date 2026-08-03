# Story 10.6: Share-target upload ordering (row before storage)

Status: done

## Story

As a parent sharing a photo or document into the app,
I want the Inbox row to be created before the file is uploaded,
so that a failed upload does not leave an orphaned storage object with no Inbox row to clean it up.

## Position in Epic 10

Follow-up to **Story 10.1** (share-target completion). Hardens the `ShareTarget.tsx` capture flow so storage objects are always owned by a durable Inbox row.

## Acceptance Criteria

1. **Create the Inbox row first.** `ShareTarget.tsx` must create the `inbox_items` row (with `raw_text`, `source`, `status: "unresolved"`, but no `attachments`) before uploading any files.

2. **Upload into a row-scoped path.** After the row exists, upload shared files into the `attachments` bucket under a path that includes the inbox item id: `{account_id}/inbox/{inbox_item_id}/{uuid}{ext}`.

3. **Update the row with attachment metadata.** After all uploads succeed, update the same `inbox_items` row with the `attachments` JSON array. If any upload fails, the row stays in the DB with no attachments; the user sees an error and can retry.

4. **Retry reuses the same row.** If the user retries after a partial upload, `getOrCreateInboxItem` must return the same existing row and attach the newly uploaded files to it, not create a second row.

5. **Old-format paths still open.** Existing rows created before this story (with legacy `{account_id}/{uuid}{ext}` paths) must still render and open correctly. This means the storage RLS policies and read paths cannot require the new `inbox/` segment.

6. **No orphaned objects on DB failure.** If the final update to write attachments back to the row fails, the uploaded objects are still owned by the row id in their path and can be recovered; the retry will re-upload or attach them, but the original object is not anonymous.

## Negative constraints

- Do not delete the `attachments` bucket or change its public/private status.
- Do not change the `Attachment` type schema (the row still stores `title`, `type`, `path`, `src`).
- The new `path` must remain readable by the existing attachment URL re-signing code.

## Tasks / Subtasks

- [ ] **Task 1 — Update `uploadSharedFiles` helper** (AC: 2)
  - In `src/components/atomic-crm/inbox/ShareTarget.tsx`, modify `uploadSharedFiles` to accept the created `inboxItemId` and build the storage path as `{account_id}/inbox/{inboxItemId}/{uuid}{ext}`.
  - The account id comes from the current context (same source the existing helper uses, e.g., `current_context_id()` or a data-provider lookup).

- [ ] **Task 2 — Reverse `createInboxItem` ordering** (AC: 1, 4, 6)
  - Refactor `createInboxItem` in `ShareTarget.tsx`:
    1. Create the `inbox_items` row with `attachments: null`.
    2. If `files` exist, call `uploadSharedFiles(files, item.id)`.
    3. Update the same row with `attachments`.
  - If step 1 fails, no storage objects are uploaded.
  - If step 2 fails, the row exists but has no attachments; the error is shown and the retry path uses the same row.
  - If step 3 fails, the objects are row-scoped and the retry can re-attach them.

- [ ] **Task 3 — Retry path** (AC: 4)
  - `getOrCreateInboxItem` already caches the created promise. Ensure that after a failure, the next call reuses the same row. The existing cache behavior handles this if the row creation succeeded; verify that the upload/update steps do not break the cache contract.
  - If a row exists but has no attachments (upload failed), the retry should attempt the upload again and then update the row.

- [ ] **Task 4 — Tests** (AC: 1, 2, 3, 5)
  - Add tests in `ShareTarget.test.tsx` (or the relevant share-target test file) for:
    - Row is created before storage upload is called.
    - Upload path contains the row id.
    - Row update after upload carries the attachment metadata.
    - A failed upload leaves the row unresolved with no attachments.

- [ ] **Task 5 — Backward compatibility** (AC: 5)
  - Confirm that the attachment URL builder and any RLS policies on `attachments` do not enforce the new `inbox/` segment. The old and new paths are both valid objects.

## Dev notes

- The existing helper `uploadSharedFiles` likely uses `supabase.storage.from("attachments").upload(...)` with a path like `${accountId}/${uuid}${ext}`. Change it to `${accountId}/inbox/${inboxItemId}/${uuid}${ext}`.
- The `attachments` bucket is public, so the URL builder just needs the object path; no new signing logic is required.
- Because the row id is now part of the object path, a cleanup routine could later enumerate all objects under `{accountId}/inbox/{inboxItemId}/` and remove them if the row is deleted. That cleanup routine is out of scope for this story.

## Dependencies

- Story 10.1's `ShareTarget.tsx` and `getOrCreateInboxItem` cache.
- `public.inbox_items` table and `attachments` bucket.

## Status

- in-progress
