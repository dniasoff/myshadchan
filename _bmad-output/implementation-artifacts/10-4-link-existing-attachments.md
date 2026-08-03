# Story 10.4: Carry inbox attachments into linked suggestion

Status: done

## Story

As a parent,
I want shared photos and documents that were attached to an Inbox capture to follow that capture when I link it to an existing suggestion,
so that the captured evidence stays visible on the suggestion instead of disappearing forever.

## Position in Epic 10

Follow-up to **Story 10.1** (share-target completion) and **Story 10.2** (ambiguous sender attribution). Builds on the shared `useResolveInboxItem` helper introduced in 10.1 and the `entity_files` system from Story 3.7 / 8.5.

## Acceptance Criteria

1. **When an Inbox item with `attachments` is linked to an existing shidduch, the attachments become visible on that shidduch.** The files must appear in the shidduch's Files tab, which reads through `entity_files` and `entity_files_summary`.

2. **No raw `attachments` JSON is referenced from `entity_files` after resolution.** The durable catalog is `public.entity_files` rows with `target_type = 'shidduch'` and `target_id = <the linked shidduch>`.

3. **Bucket boundary is respected.** Inbox capture attachments live in the public `attachments` bucket (`{account_id}/{uuid}{ext}`). `entity_files` lives in the private `entity-files` bucket with a four-segment key grammar (`{account_id}/{target_type}/{target_id}/{uuid}{ext}`). The implementation must copy bytes from `attachments` to `entity-files` (or move and re-key) so the row and object lifetimes match.

4. **Visibility is household-safe.** New `entity_files` rows created from a capture default to `visibility = 'shared'` so every parent and helper in the account can see them, mirroring the capture's visibility in the Inbox.

5. **Partial failure is handled without duplicates.** If the copy fails, the inbox item must stay unresolved and the user gets an error. If the copy succeeds but the inbox update fails, retrying the same link must not create duplicate `entity_files` rows for the same attachment.

6. **Non-image attachments are also supported.** MIME types, original file names, and sizes are preserved.

## Negative constraints

- Do not change the `attachments` bucket key grammar or the existing `inbox_items.attachments` schema.
- Do not copy the attachments until the user has explicitly chosen "Link to existing suggestion" — no pre-emptive copy on capture.
- Never move an object out of the `attachments` bucket before the durable `entity_files` row exists.

## Tasks / Subtasks

- [ ] **Task 1 — Storage copy helper** (AC: 3, 6)
  - Add `copyAttachmentToEntityFiles` in `supabase/functions/postmark/` or a shared module under `src/components/atomic-crm/providers/supabase/`. The helper takes an `Attachment` from an Inbox item and a target `shidduchimId`, downloads the object from `attachments`, re-uploads it to `entity-files` under `{account_id}/shidduch/{shidduchimId}/{uuid}{ext}`, and returns the new `storage_path` and metadata.
  - Use `supabaseAdmin` or the caller's scoped Supabase client as appropriate. The frontend resolve path uses the authenticated client; the function must work with RLS and the `entity_files` trigger-assigned columns (`account_id`, `uploaded_by_member_id`).

- [ ] **Task 2 — `entity_files` catalog creation** (AC: 1, 2, 4)
  - After the helper returns a new path, create an `entity_files` row through the data provider (`dataProvider.create("entity_files", ...)`), using only the columns the contract allows the client to set: `target_type: "shidduch"`, `target_id`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `visibility: "shared"`.
  - The `account_id` and `uploaded_by_member_id` must be left out (trigger-assigned) and the RLS policy must allow the insert.

- [ ] **Task 3 — Wire into `resolveAsLinkToExisting`** (AC: 1, 5)
  - In `src/components/atomic-crm/inbox/useResolveInboxItem.ts`, after the note interaction is inserted and before marking the inbox item resolved, iterate over `item.attachments`. For each attachment, call the copy helper and create the `entity_files` row. If any copy fails, throw and do NOT mark the inbox item resolved.
  - Add a guard so that re-linking the same already-resolved item is rejected (already handled by Story 10.5's `assertUnresolved` guard; ensure it composes here).

- [ ] **Task 4 — Tests** (AC: 1, 3, 5)
  - Add a unit test in `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx` that resolves a link with two attachments and asserts that `entity_files` rows were created with the correct `target_type`, `target_id`, and `storage_path` prefix.
  - Add a test that a copy failure leaves the inbox item unresolved and does not call `update("inbox_items", { status: "resolved" })`.

## Dev notes

- The existing `entity_files` upload path in `src/components/atomic-crm/providers/supabase/entityFiles.ts` uses `getSupabaseClient()` and the private `entity-files` bucket. Reuse that client's storage instance for the copy destination, but the source is the public `attachments` bucket.
- The original `attachments` storage path is in the `path` field of the `Attachment` object. The signed URL is in `src` and expires; do not rely on it for durable copy — use the `path` to download or copy via the storage API.
- The implementation should be inside the `useResolveInboxItem` module or a sibling file so the `InboxResolveDialog` and `ShareTarget` callers both get the behavior automatically.

## Dependencies

- Story 10.1's `useResolveInboxItem.ts` shared helper.
- Story 3.7 / 8.5 `entity_files` table and triggers.
- Supabase Storage `attachments` and `entity-files` buckets (07_storage.sql).

## Status

- in-progress
