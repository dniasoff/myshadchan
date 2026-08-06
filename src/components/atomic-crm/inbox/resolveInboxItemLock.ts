import isEqual from "lodash/isEqual";
import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, InboxAttachment, InboxItem } from "../types";

/**
 * Story 10.5's client-side compare-and-swap lock protocol, extracted out of
 * `useResolveInboxItem.ts` (coding-style.md's ~400-line typical ceiling —
 * this module was already past it before Finding 16/17's fixes, both of
 * which added further explanatory comment; the lock protocol below is a
 * cohesive, self-contained unit on its own, so it moves out rather than the
 * file growing further). `useResolveInboxItem.ts` re-exports `ResumeDraft`
 * for backward compatibility — nothing outside this pair of files imports it
 * today, but the hook's own public surface stays unchanged either way.
 */

/**
 * Story 11.2: optional resume draft captured by the parse Worker. When
 * present, `resolveAsNewShidduch` also creates a `resumes` row attached to
 * the new shidduch so the original attachment and extracted draft are kept.
 */
export type ResumeDraft = {
  attachment: InboxAttachment;
  rawDraft: unknown;
  sections: unknown;
};

/**
 * Story 10.5: idempotency token + stashed inputs for the resolve window.
 * Stored on `inbox_items.resolution_input` as JSONB so a retry can complete
 * a partially-failed resolve without re-running domain mutations.
 */
export type ResolutionInput =
  | {
      action: "new";
      input: CreateShidduchInput;
      resolved_shidduchim_id?: Identifier;
      resume_draft?: ResumeDraft;
      resume_created?: boolean;
    }
  | {
      action: "link";
      shidduchim_id: Identifier;
      note_inserted?: boolean;
    }
  | {
      action: "dismiss";
    };

const MAX_LOCK_RETRIES = 3;

export function generateAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * Review fix (Finding 17, Epic 11 adversarial review): this used to compare
 * only `single_id` / `shadchan_id` / `origin` / the resume attachment's
 * *path* — so a retry whose NAME, DATE, PIPELINE STATE, extracted sections,
 * or raw draft differed from the in-progress attempt was still judged
 * "compatible" and allowed to take over the lock.
 *
 * That mattered because a takeover does not re-derive the record it
 * overlays: `resolveAsNewShidduch` (`useResolveInboxItem.ts`), once
 * `resolved_shidduchim_id` is already stashed from an earlier attempt, skips
 * `createShidduch` entirely and just re-fetches the shidduch THAT earlier
 * attempt created — the retry's own field values are read only for this
 * compatibility check, then discarded. A parent who edited the form and
 * retried (or re-ran auto-fill and got a different extraction) would
 * therefore see "Filed as a suggestion" while the persisted record silently
 * kept the FIRST attempt's stale values — a record whose parts came from a
 * different extraction than the one the user just confirmed, with no error
 * and no indication anything was dropped.
 *
 * Comparing the full `input` (every field the created record would carry)
 * and the full `resume_draft` (not just its attachment path) makes a
 * materially different retry INCOMPATIBLE instead, using the exact
 * mechanism this file already has for any other conflicting resolution: it
 * throws below, and `InboxResolveDialog.tsx` / `ShareTarget.tsx` surface
 * that as a visible `notify(..., { type: "error" })` rather than a false
 * success. An ordinary crash-retry — the case this lock protocol exists
 * for — resubmits identical values and is unaffected: `isEqual` on two
 * structurally identical objects is `true`, same as the narrower check was.
 */
function inputsAreCompatible(a: ResolutionInput, b: ResolutionInput): boolean {
  if (a.action !== b.action) return false;
  if (a.action === "dismiss" && b.action === "dismiss") return true;
  if (a.action === "new" && b.action === "new") {
    return isEqual(a.input, b.input) && isEqual(a.resume_draft, b.resume_draft);
  }
  if (a.action === "link" && b.action === "link") {
    return a.shidduchim_id === b.shidduchim_id;
  }
  return false;
}

/**
 * Acquire the resolve lock for an inbox item. Returns the current row state.
 *
 * Protocol:
 *   1. Try to move `unresolved` -> `resolving` with our attempt id + input.
 *   2. If that fails (status changed concurrently), fetch the current row.
 *   3. If the item is already `resolved` or `dismissed`, return it as a
 *      no-op (idempotent).
 *   4. If the item is `resolving` with the SAME attempt id or a COMPATIBLE
 *      input, take over the lock and return the row.
 *   5. If the item is `resolving` with a different, incompatible attempt,
 *      throw — another resolution is in flight.
 *   6. If the item is somehow still `unresolved` (race), retry a bounded
 *      number of times.
 *
 * This is client-side compare-and-swap. It is not strictly serializable
 * against concurrent callers, but it closes the double-click / double-call
 * and partial-retry duplication vectors that matter in practice. A future
 * backend RPC can tighten the guarantee.
 */
export async function acquireResolutionLock(
  dataProvider: CrmDataProvider,
  item: InboxItem,
  attemptId: string,
  input: ResolutionInput,
  retryCount = 0,
): Promise<InboxItem> {
  const { data: current } = await dataProvider.getOne<InboxItem>(
    "inbox_items",
    { id: item.id },
  );
  if (!current) {
    throw new Error(`Inbox item ${item.id} not found`);
  }

  if (current.status === "resolved" || current.status === "dismissed") {
    return current;
  }

  if (current.status === "resolving") {
    const currentInput = (current.resolution_input ?? {}) as ResolutionInput;
    const sameAttempt = current.resolution_attempt_id === attemptId;
    const compatible = inputsAreCompatible(input, currentInput);

    if (sameAttempt || compatible) {
      // Review fix (Story 11.2 review, "also fix #2"): a takeover from a
      // genuinely new top-level call (a fresh `attemptId` — every call
      // generates one, so `sameAttempt` is never true across two separate
      // invocations) used to persist `input` verbatim, discarding whatever
      // progress the PREVIOUS attempt had already stashed on `currentInput`
      // (`resolved_shidduchim_id`, `note_inserted`, `resume_created`). That
      // silently defeated every one of this file's stashed-progress guards
      // on exactly the "crash mid-resolve, retry" case they exist for: the
      // retry would see a blank slate and redo the already-completed
      // mutation. `input` never carries those progress keys at all (they
      // are added later, after the mutation they guard succeeds), so
      // spreading `currentInput` first and `input` on top updates the
      // caller's current intent while preserving any progress key `input`
      // doesn't set.
      const { data } = await dataProvider.update<InboxItem>("inbox_items", {
        id: item.id,
        data: {
          resolution_attempt_id: attemptId,
          resolution_input: {
            ...currentInput,
            ...input,
          } as Record<string, unknown>,
        },
        previousData: current,
      });
      return data ?? current;
    }

    throw new Error(
      `Another resolution is already in progress for inbox item ${item.id}.`,
    );
  }

  // current.status === "unresolved": try to acquire the lock.
  try {
    const { data } = await dataProvider.update<InboxItem>("inbox_items", {
      id: item.id,
      data: {
        status: "resolving",
        resolution_attempt_id: attemptId,
        resolution_input: input as Record<string, unknown>,
      },
      previousData: current,
    });
    return data ?? current;
  } catch {
    if (retryCount >= MAX_LOCK_RETRIES) {
      throw new Error(
        `Could not acquire resolution lock for inbox item ${item.id}`,
      );
    }
    return acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      input,
      retryCount + 1,
    );
  }
}

export function finalizePayload(
  status: "resolved" | "dismissed",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status,
    resolution_attempt_id: null,
    resolution_input: null,
    ...extra,
  };
}
