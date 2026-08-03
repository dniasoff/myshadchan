# Epic 10 Adversarial Review — Response & Triage

Date: 2026-08-03
Responding to: `_bmad-output/epic-10-adversarial-review-report-2026-08-03.md`

## Summary

The adversarial review identified six findings for Epic 10. Two findings are clear-cut and have been fixed immediately:

1. **Finding #4 (active-membership filter)** — fixed in `supabase/functions/postmark/createInboxItemFromEmail.ts`.
2. **Finding #3 (non-atomic resolve paths)** — mitigated with an `unresolved`-status guard in `useResolveInboxItem.ts` that prevents double-resolve / double-dismiss races.

The remaining four findings are either consistent with the original acceptance criteria, require product/architectural decisions larger than a review fix, or are historical and no longer actionable in code.

## Finding-by-finding response

### 1. Story 10.2 only paints a badge — no confirm path

**Status:** Disputed / works as specified.

The 10.2 story and AC deliberately treat the recovered sender as a **display hint only**. The parent "confirms" the sender by using the existing resolve form (`InboxResolveDialog.tsx`) to pick the actual single and shadchan for the redt. The `sender_needs_confirmation` flag exists to draw attention to items where the extracted sender is unreliable, not to introduce a new sender-resolution workflow.

References:

- `_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`

If product wants a dedicated "confirm sender" mini-flow, that is a new feature, not a bug in 10.2.

### 2. Linking a capture with attachments to an existing suggestion drops the attachment

**Status:** Accepted as a real gap, deferred to a follow-up story.

The gap is confirmed: `resolveAsLinkToExisting()` creates a text note and marks the inbox item resolved. The attachments stay in the `inbox_items.attachments` JSON column but become unreachable because the inbox list only surfaces `status = 'unresolved'` rows.

Fixing this correctly requires cross-bucket storage work:

- Inbox attachments live in the `attachments` bucket (`{account_id}/{uuid}{ext}`).
- `entity_files` rows reference the private `entity-files` bucket with a four-segment key grammar (`{account_id}/{target_type}/{target_id}/{uuid}{ext}`) and have their own lifecycle/purge rules.

A safe carry-forward therefore needs to either (a) copy bytes from `attachments` to `entity-files` and create matching `entity_files` rows, or (b) introduce a durable "inbox attachment reference" surface that the shidduch Files tab can read. Both options are larger than a review fix and touch Epic 3.7 / 8.5 ownership boundaries.

**Follow-up:** Recommended new story: carry inbox attachments into the linked entity (`attachments` bucket → `entity-files` bucket / `entity_files` rows). Touches Epic 3.7 / 8.5 file ownership.

### 3. Both resolve paths are non-atomic and can duplicate data on partial failure

**Status:** Partially fixed; residual risk documented.

The immediate duplication vector from double clicks / double calls is now closed: `resolveAsNewShidduch`, `resolveAsLinkToExisting`, and `dismissInboxItem` all call `assertUnresolved(item)` before mutating. If the item is already `resolved` or `dismissed`, the helper throws and makes no data-provider calls.

The deeper partial-failure risk remains:

- `createShidduch()` can succeed while the subsequent `update("inbox_items", …)` fails, leaving a dangling shidduch and an unresolved inbox item.
- `insertNoteInteraction()` can succeed while the subsequent inbox update fails, leaving a duplicate note on retry.

A true fix requires backend idempotency (e.g., deterministic idempotency keys, a single RPC that wraps the multi-step mutation, or an `inbox_items.resolution_attempt_id` lock column). These are architectural changes and will be tracked as follow-up work.

**Follow-up:** Recommended new story: backend idempotent / atomic resolve paths (e.g., deterministic idempotency keys, a single RPC, or a `resolution_attempt_id` lock column).

### 4. Email account resolver forgot the `status = 'active'` filter

**Status:** Fixed.

`resolveHouseholdAccountIdForMemberEmail()` now filters `account_members` by `.eq("status", "active")`, matching the rest of the codebase (`resolveAccountId` in `supabase/functions/_shared/resolveDemoAccount.ts`, `current_context_id()`, and the partial unique index `account_members_account_user_active_uq`).

This prevents:

- An archived second household membership from falsely tripping the "ambiguous, refuse" branch.
- An archived-only household membership from being selected as the capture target.

**Tests added in** `supabase/functions/postmark/index.test.ts`:

- `ignores ARCHIVED household memberships when resolving the account`
- `refuses (403) when the sender's only household membership is archived`

### 5. Share-target upload ordering leaks orphaned storage objects

**Status:** Accepted as a real gap, deferred to a follow-up story.

Confirmed: `ShareTarget.tsx` uploads files before creating the `inbox_items` row. If the DB insert fails after uploads succeed, the retry uploads a second set and the first set is orphaned.

Fixing this durably requires one of:

1. Create the `inbox_items` row first (without attachments), then upload into a path that includes the row ID, then update the row. This reverses the order and makes the row the durable cleanup anchor.
2. Add a storage cleanup routine / lifecycle rule that sweeps unattached objects in `attachments/` after a TTL.
3. Use a two-phase transaction (DB row + storage) with a compensating cleanup step.

Option 1 is the cleanest but changes the upload path and may affect the UI's optimistic rendering. It is larger than a review fix.

**Follow-up:** Recommended new story: reverse the share-target upload order (create `inbox_items` row first, then upload into a row-scoped storage path, then update the row) so the DB row is the durable cleanup anchor.

### 6. Story 10.1 review-fix commit bundled unrelated skill/assets payload

**Status:** Noted / historical.

Commit `b716adb` is already in `main` and deployed. It cannot be rewritten without a force-push. The finding is noted for future commit hygiene: review-fix commits should stay scoped to the story being fixed, and generated assets / skill updates should land in their own commits.

## Files changed

- `supabase/functions/postmark/createInboxItemFromEmail.ts`
- `supabase/functions/postmark/index.test.ts`
- `src/components/atomic-crm/inbox/useResolveInboxItem.ts`
- `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx`
- `_bmad-output/epic-10-adversarial-review-response.md` (this file)

## Validation

- `npx vitest run supabase/functions/postmark/index.test.ts` — new archived-membership tests should pass.
- `npx vitest run src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx` — new guard tests + existing resolve tests should pass.
- `make typecheck` — should remain green.
- Full test suite and migration-safety checks should be run before the next deploy.

## Risk register

| Finding | Severity | State | Next action |
|---|---|---|---|
| 1 — Badge-only sender UX | LOW | Disputed per spec | Product decides if a dedicated confirm flow is needed |
| 2 — Attachments lost on link-existing | MEDIUM | Deferred | New story for cross-bucket attachment carry-forward |
| 3 — Non-atomic resolve paths | MEDIUM | Partially fixed | New story for backend idempotency / atomic RPC |
| 4 — Active-membership filter | HIGH | Fixed | Deploy with next release |
| 5 — Orphaned share-target uploads | LOW/MEDIUM | Deferred | New story for upload-before-row ordering |
| 6 — Commit hygiene | LOW | Historical | Apply narrower commits going forward |
