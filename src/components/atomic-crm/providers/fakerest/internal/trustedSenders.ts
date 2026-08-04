import type { DataProvider, Identifier } from "ra-core";

import type { InboxItem, TrustedSender } from "../../../types";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const HELD_PAGE = { page: 1, perPage: 100 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

export type TrustSenderParams = {
  accountId: Identifier;
  email: string;
};

export type TrustSenderResult = {
  trustedSender: TrustedSender;
  releasedItemIds: Identifier[];
};

/**
 * FakeRest mirror of `providers/supabase/trustedSenders.ts#trustSenderAndRelease`
 * — same two steps, same order (trust durably recorded FIRST, held items
 * released SECOND — see that file's own doc comment for the fail-safe
 * reasoning this mirrors), same idempotency guarantee. `ra-data-fakerest`
 * has no real unique-constraint upsert, so step 1 is done by hand: look up
 * an existing `(account_id, email)` row first and reuse it, rather than
 * risking a duplicate on a retry.
 */
export async function trustSenderAndRelease(
  baseDataProvider: DataProvider,
  params: TrustSenderParams,
): Promise<TrustSenderResult> {
  const { accountId, email } = params;

  const { data: existing } = await baseDataProvider.getList<TrustedSender>(
    "trusted_senders",
    {
      filter: { account_id: accountId, email },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    },
  );

  const trustedSender: TrustedSender =
    existing[0] ??
    (
      await baseDataProvider.create<TrustedSender>("trusted_senders", {
        data: {
          account_id: accountId,
          email,
          created_at: new Date().toISOString(),
          created_by_member_id: null,
        },
      })
    ).data;

  // Matched on `sender_email` (the persisted envelope address, Epic 11
  // review-fix) — NEVER `sender`, which is the FR24-recovered ORIGINAL
  // forwarded sender and often a display name or null. See
  // `providers/supabase/trustedSenders.ts`'s own comment on this same query.
  const { data: heldItems } = await baseDataProvider.getList<InboxItem>(
    "inbox_items",
    {
      filter: { account_id: accountId, sender_email: email, status: "held" },
      pagination: HELD_PAGE,
      sort: SORT_BY_ID,
    },
  );

  if (heldItems.length > 0) {
    await baseDataProvider.updateMany("inbox_items", {
      ids: heldItems.map((item) => item.id),
      data: { status: "unresolved" },
    });
  }

  return {
    trustedSender,
    releasedItemIds: heldItems.map((item) => item.id),
  };
}
