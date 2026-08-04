import type { Identifier } from "ra-core";

import type { TrustedSender } from "../../types";
import { getSupabaseClient } from "./supabase";

export type TrustSenderParams = {
  accountId: Identifier;
  email: string;
};

export type TrustSenderResult = {
  trustedSender: TrustedSender;
  /** ids of every OTHER `held` item from this same sender that was released
   * alongside the one being reviewed — empty when there were none. */
  releasedItemIds: Identifier[];
};

/**
 * The "TRUST SENDER" action (Epic 11): vouch for an address for this
 * household, then release every `held` item already waiting from it —
 * mirrors `NeedsReviewDialog.tsx`'s own doc comment for the full design
 * discussion.
 *
 * ATOMICITY (no schema change available — see the story's own notes): this
 * is two writes, run client-side in the order that fails SAFE rather than
 * inside one server transaction:
 *
 *   1. Upsert `trusted_senders` first.
 *   2. Release the `held` rows second.
 *
 * If the process dies between them, the partial state is "sender trusted,
 * items still `held`" — never the other way around. That is the safer half
 * to be caught in: the items stay visibly gated in the Needs-review tab
 * (nothing leaks into the working inbox on the strength of an unrecorded
 * trust decision), the sender IS already trusted for every future email
 * (classifySender() at the ingest Worker checks this same table, so new
 * mail from this address stops being held immediately), and a retry of
 * this exact function — or simply reopening the item and pressing Trust
 * again — finishes the job. The reverse order would risk the opposite: an
 * unrecognized sender's mail released into the working inbox before the
 * trust decision was durably recorded, which is the one thing the whole
 * "Needs review" design exists to prevent.
 *
 * IDEMPOTENCY: both steps are safe to repeat.
 *   - Step 1 is an upsert on `(account_id, email)` (`trusted_senders`'s own
 *     unique constraint) — a retry after a successful insert updates the
 *     same row in place rather than raising a 23505 conflict, and still
 *     returns it via `.select()`.
 *   - Step 2 is a single `UPDATE ... WHERE status = 'held'` — a retry after
 *     a successful release matches zero rows and changes nothing.
 * Neither step needs the resolve-window lock/stash protocol
 * `inbox/useResolveInboxItem.ts` uses for `createShidduch()` (which has no
 * natural idempotency key of its own); a plain upsert + scoped UPDATE
 * already has one.
 */
export async function trustSenderAndRelease(
  params: TrustSenderParams,
): Promise<TrustSenderResult> {
  const { accountId, email } = params;

  const { data: trustedSender, error: trustError } = await getSupabaseClient()
    .from("trusted_senders")
    .upsert(
      { account_id: accountId, email },
      { onConflict: "account_id,email" },
    )
    .select()
    .single();
  if (trustError || !trustedSender) {
    console.error("trustSender.error", trustError);
    throw new Error(trustError?.message || "Failed to trust that sender");
  }

  const { data: releasedRows, error: releaseError } = await getSupabaseClient()
    .from("inbox_items")
    .update({ status: "unresolved" })
    .eq("account_id", accountId)
    // Matched on `sender_email` (the persisted envelope address, Epic 11
    // review-fix) — NEVER `sender`, which is the FR24-recovered ORIGINAL
    // forwarded sender and often a display name or null. `email` here is
    // always an envelope address (NeedsReviewDialog.tsx only offers Trust
    // when `item.sender_email` is set), so matching on anything else would
    // silently fail to release the very item the user just trusted.
    .eq("sender_email", email)
    .eq("status", "held")
    .select("id");
  if (releaseError) {
    console.error("trustSender.release.error", releaseError);
    // Deliberately NOT `releaseError.message || "…"`: the raw PostgREST
    // message alone ("network error", a permission error, …) would drop the
    // one fact that actually matters to whoever reads this — the trust
    // step above already committed, so this is the recoverable "sender
    // trusted, items still held" partial state, not a fresh failure.
    throw new Error(
      "Trusted the sender, but couldn't release their held mail. Refresh to try again.",
    );
  }

  return {
    trustedSender: trustedSender as TrustedSender,
    releasedItemIds: (releasedRows ?? []).map(
      (row) => (row as { id: Identifier }).id,
    ),
  };
}
