# Story 10.5: Atomic idempotency for inbox resolution

Status: in-progress

## Story

As a parent,
I want the system to resolve an Inbox item exactly once even if the network flakes or I click twice,
so that I never end up with duplicate suggestions or duplicate notes from the same capture.

## Position in Epic 10

Follow-up to **Story 10.1**. Hardens the shared `useResolveInboxItem` helper so that its three resolution paths are idempotent and, where possible, atomic.

## Acceptance Criteria

1. **Double-click / double-call never duplicates domain data.** Calling `resolveAsNewShidduch`, `resolveAsLinkToExisting`, or `dismissInboxItem` twice on the same inbox item must not create a second shidduch, a second note, or a second `dismissed` update.

2. **Status guard is the first line of defense.** The helper already rejects calls when `item.status !== "unresolved"` (shipped as a partial fix). This story makes that contract durable and tested across all three paths.

3. **Partial-failure retries are safe.** If a resolve operation is interrupted after the first durable write (e.g., `createShidduch` succeeded but the inbox update failed), retrying the same item with the same `resolution_attempt_id` must not create another shidduch or note. It should observe the work already done and complete the remaining step(s).

4. **Distinct attempts are not collapsed.** A retry with a different `resolution_attempt_id` while the item is in `resolving` status must be rejected, not silently merged into the first attempt.

5. **`dismiss` is idempotent too.** A second dismiss call returns success (or the existing dismissed state) without error.

## Negative constraints

- Do not introduce distributed locks or external state beyond the `inbox_items` row.
- Do not change the public `resolveAsNewShidduch` / `resolveAsLinkToExisting` / `dismissInboxItem` signatures unless necessary.
- The client-side `resolution_attempt_id` must be generated per call, not per session, so accidental reuse is impossible.

## Tasks / Subtasks

- [ ] **Task 1 — Schema change** (AC: 3, 4)
  - Add `resolution_attempt_id text` and `resolution_input jsonb` columns to `public.inbox_items` at the physical tail. The columns are nullable and only used during the resolving window.
  - Generate a migration with `npx supabase db diff --local -f add_inbox_items_resolution_attempt` and run it.

- [ ] **Task 2 — Idempotency protocol** (AC: 3, 4)
  - Update `useResolveInboxItem.ts`:
    - Generate a `resolution_attempt_id` (crypto.randomUUID) at the start of each resolve call.
    - First, attempt to `update("inbox_items", { status: "resolving", resolution_attempt_id, resolution_input })` with `previousData: item` where `item.status === "unresolved"`. If it fails because the row is already `resolving` or `resolved`, inspect the current row:
      - If `status === "resolved"` or `"dismissed"`, return the existing result (no-op for idempotency).
      - If `status === "resolving"` and `resolution_attempt_id === ours`, continue the interrupted attempt.
      - If `status === "resolving"` and `resolution_attempt_id !== ours`, throw "Another resolution is in progress".
    - Execute the domain mutation (`createShidduch`, `insertNoteInteraction`, or nothing for dismiss).
    - Finalize the inbox item to `resolved` or `dismissed`, storing the linked `resolved_shidduchim_id` and clearing `resolution_attempt_id` and `resolution_input`.
  - For `resolveAsNewShidduch`, `resolution_input` should store the `CreateShidduchInput` so a retry can reconstruct the same creation if needed, or at least recognize that the already-created shidduch belongs to this attempt. For `resolveAsLinkToExisting`, store the chosen `shidduchimId`.

- [ ] **Task 3 — Recovery from existing created shidduch on retry** (AC: 3)
  - If `status === "resolving"` and `resolution_input` contains the prior input, but the helper cannot prove the shidduch was created (e.g., the `createShidduch` call timed out), the retry must either:
    - Find the previously created shidduch by a deterministic idempotency key, OR
    - Re-run `createShidduch` with a client-side idempotency token that the backend can de-duplicate.
  - For this story, the simpler acceptable path is: after `createShidduch` succeeds, the next inbox update stores the created id in `resolution_input`. On retry, if `resolution_input.resolved_shidduchim_id` exists, skip `createShidduch` and go straight to finalization. This requires the first update to happen before `createShidduch`, which changes the ordering: mark `resolving` + input first, then create, then finalize.

- [ ] **Task 4 — Dismiss path** (AC: 5)
  - `dismissInboxItem` first marks `resolving` with `resolution_input = { action: "dismiss" }`, then finalizes to `dismissed`. Second calls with the same or different attempt id return the dismissed state without updating again.

- [ ] **Task 5 — Tests** (AC: 1, 2, 3, 4, 5)
  - Add tests in `useResolveInboxItem.test.tsx` for:
    - Double `resolveAsNewShidduch` creates exactly one shidduch.
    - Retry with the same `resolution_attempt_id` after a simulated create success + inbox-update failure completes the finalize step without creating a second shidduch.
    - Retry with a different `resolution_attempt_id` while `resolving` throws.
    - Double `dismiss` returns the existing dismissed state.

## Dev notes

- The `resolution_attempt_id` and `resolution_input` columns are intentionally nullable and only written during the resolve window. They do not affect the Inbox list or card rendering.
- The `previousData` parameter on the `update` calls is the key to the status guard: react-admin data providers translate it into a conditional update that fails if the row changed concurrently.
- For the backend, this story does NOT require a stored procedure. The protocol is client-side, relying on the row's status and attempt id as a linearizable compare-and-swap. If the backend needs stricter guarantees later, the same columns can be used by an RPC.

## Dependencies

- Story 10.1's `useResolveInboxItem.ts` shared helper.
- `public.inbox_items` table (already has `status` and the `InboxItem` type).

## Status

- in-progress
