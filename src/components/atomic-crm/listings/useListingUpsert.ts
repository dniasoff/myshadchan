import { useDataProvider, useGetList } from "ra-core";
import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { Listing, ListingType } from "../types";

export interface UseListingUpsertResult {
  /** The subject's own live listing row for this branch, or `null` when
   * none has been published yet. */
  listing: Listing | null;
  isPending: boolean;
  /**
   * Create-or-update in one call: an existing row is updated in place
   * (partial unique index makes "one live listing, not a growing pile"
   * true at the database — `listings_shadchan_account_id_key` for the
   * `shadchan` branch, `listings_single_id_key` for the `single` branch);
   * otherwise a new row is created. `fields` is written as given —
   * verbatim, no defaulting or normalization — so each branch's own
   * required-field guard (the UI-level mirror of its own CHECK constraint:
   * `listings_shadchan_name_required` / `listings_single_name_required`)
   * stays that branch's own component's job, not this shared hook's.
   */
  upsert: (fields: Partial<Listing>) => Promise<void>;
  /**
   * Deletes the row outright — never a soft-delete/flag.
   *
   * Story 9.3 shipped the `single` branch's own "Single listings delete"
   * RLS policy (three roles admitted — `parent_admin`, `self_manager`, and
   * a plain `single` acting on their own record, `05_policies.sql`'s own
   * comment), so this now succeeds for every branch whenever the caller is
   * one of those roles. A caller RLS still refuses rejects rather than
   * resolving: the dataProvider's DELETE request sends `Accept:
   * application/vnd.pgrst.object+json` (`@raphiniert/ra-data-postgrest`),
   * which requires PostgREST to return exactly one row — RLS excluding the
   * row makes PostgREST return zero, which PostgREST itself turns into an
   * error response. `WithdrawSingleListingButton.tsx` is the single's own
   * caller of this for the `single` branch (Story 9.3, AC-1); the
   * manager's own withdrawal path is not this story's frontend scope
   * (Task 7's own "AC: 1, 4" note) and still has no UI caller as of this
   * story.
   */
  withdraw: () => Promise<void>;
}

/**
 * Story 9.2's extraction of Story 9.1's own upsert branch (`.claude/rules/
 * coding-style.md`, DRY) — the "does a live row already exist for this
 * subject? update it; otherwise create it" decision, shared by both
 * `listing_type` branches rather than copy-pasted a second time.
 * `useShadchanListing.ts` is now a thin wrapper over this for the
 * `shadchan` branch (no subject beyond the account itself);
 * `PublishSingleListingSection.tsx` calls this directly for the `single`
 * branch, threading the single's own id as `subjectId`.
 *
 * `getList` rather than `getOne`: there is no natural id to `getOne` with
 * before a listing exists, and each branch's own partial unique index
 * guarantees at most one live row per subject, so `perPage: 1` is exact,
 * not an approximation.
 */
export const useListingUpsert = (
  accountId: Identifier | undefined,
  listingType: ListingType,
  subjectId?: Identifier | null,
): UseListingUpsertResult => {
  const dataProvider = useDataProvider<CrmDataProvider>();

  const filter: Record<string, unknown> = {
    account_id: accountId,
    listing_type: listingType,
  };
  if (subjectId != null) {
    filter.single_id = subjectId;
  }

  const { data, isPending, refetch } = useGetList<Listing>(
    "listings",
    {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
      filter,
    },
    { enabled: accountId != null },
  );

  const listing = data?.[0] ?? null;

  const upsert = async (fields: Partial<Listing>): Promise<void> => {
    if (accountId == null) {
      throw new Error(
        `no active context to publish a ${listingType} listing for`,
      );
    }

    const data: Record<string, unknown> = {
      listing_type: listingType,
      ...fields,
    };
    // subjectId is deliberately applied AFTER the caller's own fields, so a
    // `single` branch caller can never accidentally overwrite it — this
    // hook, not the form, is the one source of truth for which subject a
    // write targets.
    if (subjectId != null) {
      data.single_id = subjectId;
    }

    if (listing) {
      await dataProvider.update("listings", {
        id: listing.id,
        data,
        previousData: listing,
      });
    } else {
      // account_id is deliberately omitted — set_listings_account_id
      // (04_triggers.sql) server-stamps it from current_context_id(), the
      // same "never trust a client-sent account_id" posture every other
      // shidduchim-domain create in this codebase follows.
      await dataProvider.create("listings", { data });
    }
    await refetch();
  };

  const withdraw = async (): Promise<void> => {
    if (!listing) return;
    await dataProvider.delete("listings", {
      id: listing.id,
      previousData: listing,
    });
    await refetch();
  };

  return { listing, isPending, upsert, withdraw };
};
