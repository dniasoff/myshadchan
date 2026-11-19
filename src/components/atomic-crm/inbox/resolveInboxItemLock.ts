import isEqual from "lodash/isEqual";
import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { InboxResolutionUpdateParams } from "../providers/supabase/inboxResolution";
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
      resume_transfer_path?: string;
      resume_transfer_size?: number;
      resume_transfer_state?: "pending" | "cleaned";
      claimed_from_status?: "unresolved" | "held";
      lock_acquired_at?: string;
    }
  | {
      action: "link";
      shidduchim_id: Identifier;
      note_inserted?: boolean;
      claimed_from_status?: "unresolved" | "held";
      lock_acquired_at?: string;
    }
  | {
      action: "dismiss";
      claimed_from_status?: "unresolved" | "held";
      lock_acquired_at?: string;
    }
  | {
      action: "resume_attach" | "resume_new";
      attachment_path: string;
      shidduchim_id?: Identifier;
      single_id?: Identifier;
      resolved_shidduchim_id?: Identifier;
      resume_id?: Identifier;
      resume_file_path?: string;
      resume_created?: boolean;
      read_completed?: boolean;
      lock_acquired_at?: string;
      entity_file_ids?: Identifier[];
      resume_read_request_id?: string;
      resume_read_pending?: boolean;
      claimed_from_status?: "unresolved" | "held";
    };

const MAX_LOCK_RETRIES = 3;
export const RESOLUTION_LOCK_STALE_MS = 5 * 60 * 1000;

export class ResolutionClaimLostError extends Error {
  constructor() {
    super("This Inbox item is already being handled.");
    this.name = "ResolutionClaimLostError";
  }
}

export class ResolutionTerminalError extends Error {
  constructor() {
    super("This Inbox item has already been dismissed.");
    this.name = "ResolutionTerminalError";
  }
}

type ResolutionLockDataProvider = CrmDataProvider & {
  updateInboxItemResolution?: (
    params: InboxResolutionUpdateParams,
  ) => Promise<InboxItem | null>;
};

export type ResolutionLockOptions = {
  /**
   * The statuses this action may claim from. The conditional update uses the
   * status observed on the row, so held discard/resolve claims are not sent
   * as unresolved claims. File-backed actions pass only `unresolved`.
   */
  claimFromStatuses: readonly InboxItem["status"][];
};

function lockAcquiredAt(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as { lock_acquired_at?: unknown }).lock_acquired_at;
  return typeof value === "string" ? value : undefined;
}

export function isResolutionLockStale(
  input: unknown,
  now = Date.now(),
): boolean {
  const acquiredAt = lockAcquiredAt(input);
  // Rows written before lock_acquired_at existed are legacy locks. They have
  // no liveness proof, so takeover uses an explicit NULL predicate below.
  if (!acquiredAt) return true;
  const timestamp = Date.parse(acquiredAt);
  return (
    Number.isFinite(timestamp) && now - timestamp >= RESOLUTION_LOCK_STALE_MS
  );
}

function withLockTimestamp(
  input: ResolutionInput,
  acquiredAt: string,
): Record<string, unknown> {
  return { ...input, lock_acquired_at: acquiredAt };
}

/** The live providers implement this as a conditional PostgREST-style UPDATE. */
export async function conditionalInboxUpdate(
  dataProvider: CrmDataProvider,
  params: InboxResolutionUpdateParams,
  fallbackPreviousData: InboxItem,
): Promise<InboxItem | null> {
  const provider = dataProvider as ResolutionLockDataProvider;
  if (
    !Object.prototype.hasOwnProperty.call(
      provider,
      "updateInboxItemResolution",
    ) ||
    typeof provider.updateInboxItemResolution !== "function"
  ) {
    throw new Error(
      "The Inbox resolution provider must implement updateInboxItemResolution.",
    );
  }
  // Keep the observed row in the signature so removing the CAS contract is a
  // visible test/code review change, not an accidental unused argument.
  void fallbackPreviousData;
  return provider.updateInboxItemResolution(params);
}

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
  if (
    (a.action === "resume_attach" || a.action === "resume_new") &&
    (b.action === "resume_attach" || b.action === "resume_new")
  ) {
    return (
      a.action === b.action &&
      a.attachment_path === b.attachment_path &&
      a.shidduchim_id === b.shidduchim_id &&
      a.single_id === b.single_id
    );
  }
  return false;
}

/**
 * Acquire the resolve lock for an inbox item. Returns the current row state.
 *
 * The live provider turns every transition into one conditional PostgREST
 * UPDATE and returns the affected row. An empty result means this caller lost
 * the race and must not perform a domain mutation. Stale takeover is
 * conditional on the exact old attempt and lock timestamp, so an old caller
 * cannot steal a newer lock.
 */
export async function acquireResolutionLock(
  dataProvider: CrmDataProvider,
  item: InboxItem,
  attemptId: string,
  input: ResolutionInput,
  options: ResolutionLockOptions,
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
    if (sameAttempt) {
      // A caller retrying the same request may reuse a fresh lock, but a stale
      // lock must never be renewed by its old owner. The caller must mint a
      // new attempt id so the conditional takeover fences the crashed owner.
      if (!isResolutionLockStale(currentInput)) return current;
      throw new ResolutionClaimLostError();
    }
    if (!inputsAreCompatible(input, currentInput)) {
      throw new ResolutionClaimLostError();
    }
    if (!isResolutionLockStale(currentInput))
      throw new ResolutionClaimLostError();

    const previousLockAcquiredAt = lockAcquiredAt(currentInput);
    const now = new Date().toISOString();
    const claimed = await conditionalInboxUpdate(
      dataProvider,
      {
        id: item.id,
        status: "resolving",
        expectedResolutionAttemptId: current.resolution_attempt_id ?? undefined,
        expectedLockAcquiredAt: previousLockAcquiredAt,
        expectedLockAcquiredAtIsNull: previousLockAcquiredAt === undefined,
        ...(previousLockAcquiredAt
          ? {
              staleBefore: new Date(
                Date.now() - RESOLUTION_LOCK_STALE_MS,
              ).toISOString(),
            }
          : {}),
        data: {
          resolution_attempt_id: attemptId,
          resolution_input: withLockTimestamp(
            { ...currentInput, ...input } as ResolutionInput,
            now,
          ),
        },
      },
      current,
    );
    if (claimed) return claimed;
    if (retryCount >= MAX_LOCK_RETRIES) throw new ResolutionClaimLostError();
    return acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      input,
      options,
      retryCount + 1,
    );
  }

  if (!options.claimFromStatuses.includes(current.status)) {
    throw new ResolutionClaimLostError();
  }

  const preservedInput = (current.resolution_input ?? {}) as ResolutionInput;
  const nextInput =
    Object.keys(preservedInput).length > 0 &&
    inputsAreCompatible(input, preservedInput)
      ? ({ ...preservedInput, ...input } as ResolutionInput)
      : input;

  // Claim from the exact status observed above. Needs Review actions claim
  // `held`; they must never be rewritten as an `unresolved` claim.
  const claimed = await conditionalInboxUpdate(
    dataProvider,
    {
      id: item.id,
      status: current.status,
      data: {
        status: "resolving",
        resolution_attempt_id: attemptId,
        // A failed attempt is released back to the status it was claimed
        // from while preserving its progress. Reuse that compatible stash so
        // a retry keeps the already-created suggestion/resume instead of
        // starting over.
        resolution_input: withLockTimestamp(
          {
            ...nextInput,
            claimed_from_status: current.status,
          } as ResolutionInput,
          new Date().toISOString(),
        ),
      },
    },
    current,
  );
  if (claimed) return claimed;
  if (retryCount >= MAX_LOCK_RETRIES) throw new ResolutionClaimLostError();
  return acquireResolutionLock(
    dataProvider,
    item,
    attemptId,
    input,
    options,
    retryCount + 1,
  );
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
