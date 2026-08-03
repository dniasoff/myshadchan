# Epic 10 Adversarial Review — Response & Triage

Date: 2026-08-03
Responding to: `_bmad-output/epic-10-adversarial-review-report-2026-08-03.md`

## Summary

The adversarial review identified six findings for Epic 10. **All actionable findings have now been fixed:**

1. **Finding #4 (active-membership filter)** — fixed in `supabase/functions/postmark/createInboxItemFromEmail.ts`.
2. **Finding #3 (non-atomic resolve paths)** — fixed with an idempotency protocol in `useResolveInboxItem.ts` and new `resolution_attempt_id` / `resolution_input` columns.
3. **Finding #2 (attachments lost on link-existing)** — fixed by copying inbox attachments into `entity_files` on the linked shidduch.
4. **Finding #5 (orphaned share-target uploads)** — fixed by creating the `inbox_items` row before uploading files into a row-scoped path.

The remaining two findings are either consistent with the spec or historical:

- #1 is disputed as works-per-spec.
- #6 is a historical commit-hygiene note.

## Finding-by-finding response

### 1. Story 10.2 only paints a badge — no confirm path

**Status:** Disputed / works as specified.

The 10.2 story and AC deliberately treat the recovered sender as a **display hint only**. The parent "confirms" the sender by using the existing resolve form (`InboxResolveDialog.tsx`) to pick the actual single and shadchan for the redt. The `sender_needs_confirmation` flag exists to draw attention to items where the extracted sender is unreliable, not to introduce a new sender-resolution workflow.

References:

- `_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`

If product wants a dedicated "confirm sender" mini-flow, that is a new feature, not a bug in 10.2.

### 2. Linking a capture with attachments to an existing suggestion drops the attachment

**Status:** Fixed.

`resolveAsLinkToExisting()` now copies each `inbox_items.attachments` entry into the `entity-files` bucket and creates a matching `entity_files` row with `target_type = 'shidduch'` and `target_id = <linked shidduch>`. The files then appear on the shidduch's Files tab.

Implementation:

- `src/components/atomic-crm/providers/supabase/inboxAttachments.ts`: new `copyInboxAttachmentsToEntityFiles()` helper downloads from `attachments`, re-uploads to `entity-files`, and creates the catalog row.
- `src/components/atomic-crm/providers/fakerest/internal/inboxAttachments.ts`: FakeRest mirror that registers the existing attachment URL under a new entity-files-style key.
- `src/components/atomic-crm/inbox/useResolveInboxItem.ts`: `resolveAsLinkToExisting()` calls the copy helper before finalizing.
- Tests in `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx` verify the helper is invoked with the correct target.

### 3. Both resolve paths are non-atomic and can duplicate data on partial failure

**Status:** Fixed.

A client-side idempotency protocol now guards all three resolution paths:

- `useResolveInboxItem.ts` generates a `resolution_attempt_id` per call.
- It first moves the inbox item to `status = 'resolving'` and stashes the inputs in `resolution_input`.
- After each domain mutation (`createShidduch`, `insertNoteInteraction`), progress is stashed so a retry can skip already-completed work.
- Finalization moves the item to `resolved` or `dismissed` and clears the attempt columns.
- Retries on already-resolved/dismissed items are no-ops; retries on incompatible in-progress resolutions throw.

Schema changes:

- `supabase/schemas/01_tables.sql`: added `resolution_attempt_id text` and `resolution_input jsonb` at the physical tail of `inbox_items`.
- `supabase/migrations/20260803202059_add_inbox_items_resolution_attempt.sql`.
- `supabase/schemas/01_tables.sql`: added `'resolving'` to the `inbox_items_status_check`.
- `supabase/migrations/20260803203410_add_inbox_items_resolving_status.sql`.

Tests in `useResolveInboxItem.test.tsx` cover double-click idempotency, partial-failure resume, takeover of compatible locks, and rejection of incompatible locks.

### 4. Email account resolver forgot the `status = 'active'` filter

**Status:** Fixed.

`resolveHouseholdAccountIdForMemberEmail()` now filters `account_members` by `.eq("status", "active")`, matching the rest of the codebase. Tests in `supabase/functions/postmark/index.test.ts` cover archived second memberships and archived-only memberships.

### 5. Share-target upload ordering leaks orphaned storage objects

**Status:** Fixed.

`ShareTarget.tsx` now:

1. Creates the `inbox_items` row first (with `attachments: null`).
2. Uploads any shared files into `{accountId}/inbox/{inboxItemId}/{uuid}{ext}`.
3. Updates the same row with the attachment metadata.

If the DB create fails, no storage objects are uploaded. If an upload fails, the row exists and can be retried. `uploadToBucket()` gained an optional `pathPrefix` parameter to support the row-scoped key without changing other callers.

### 6. Story 10.1 review-fix commit bundled unrelated skill/assets payload

**Status:** Noted / historical.

Commit `b716adb` is already in `main` and deployed. It cannot be rewritten without a force-push. The finding is noted for future commit hygiene: review-fix commits should stay scoped to the story being fixed, and generated assets / skill updates should land in their own commits.

## Files changed

- `supabase/functions/postmark/createInboxItemFromEmail.ts`
- `supabase/functions/postmark/index.test.ts`
- `supabase/schemas/01_tables.sql`
- `supabase/migrations/20260803202059_add_inbox_items_resolution_attempt.sql`
- `supabase/migrations/20260803203410_add_inbox_items_resolving_status.sql`
- `src/components/atomic-crm/inbox/useResolveInboxItem.ts`
- `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx`
- `src/components/atomic-crm/inbox/InboxResolveDialog.test.tsx`
- `src/components/atomic-crm/inbox/ShareTarget.tsx`
- `src/components/atomic-crm/providers/supabase/inboxAttachments.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/internal/inboxAttachments.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`
- `src/components/atomic-crm/types.ts`
- `_bmad-output/epic-10-adversarial-review-response.md` (this file)
- `_bmad-output/implementation-artifacts/10-4-link-existing-attachments.md`
- `_bmad-output/implementation-artifacts/10-5-atomic-inbox-resolution.md`
- `_bmad-output/implementation-artifacts/10-6-share-target-upload-ordering.md`

## Validation

- `make typecheck` — green.
- `make test` — 3451 tests passed.
- `make check-migration-safety` — passed.
- `npm run test:unit:db -- column_order` — passed.
- Epic 10 e2e suite (`share-target.spec.ts`, `email-ingress.spec.ts`) — 10/10 passed.
- `make lint` — only pre-existing unrelated Prettier warnings in `.agents/skills/**` and `.kilo/agent-manager.json`.

## Risk register

| Finding | Severity | State | Next action |
|---|---|---|---|
| 1 — Badge-only sender UX | LOW | Disputed per spec | Product decides if a dedicated confirm flow is needed |
| 2 — Attachments lost on link-existing | MEDIUM | Fixed | Deploy with next release |
| 3 — Non-atomic resolve paths | MEDIUM | Fixed | Deploy with next release |
| 4 — Active-membership filter | HIGH | Fixed | Deploy with next release |
| 5 — Orphaned share-target uploads | LOW/MEDIUM | Fixed | Deploy with next release |
| 6 — Commit hygiene | LOW | Historical | Apply narrower commits going forward |
