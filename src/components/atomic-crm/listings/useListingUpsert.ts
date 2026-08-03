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
   * Review note (F3): the `single` branch has no "Single listings delete"
   * RLS policy yet (deliberate — Story 9.3 owns the dignity-floor lock and
   * writes it); calling this for a `single`-branch subject before 9.3 lands
   * does NOT silently report success on a no-op delete. The dataProvider's
   * DELETE request sends `Accept: application/vnd.pgrst.object+json`
   * (`@raphiniert/ra-data-postgrest`), which requires PostgREST to return
   * exactly one row — RLS excluding all rows (no matching policy) makes
   * PostgREST return zero, which PostgREST itself turns into an error
   * response, so this promise rejects rather than resolving. No caller
   * exercises this path today: `PublishSingleListingSection.tsx` never
   * renders a withdraw control for the `single` branch (Task 5's own
   * requirement) — but see the deploy-sequencing note where this hook is
   * consumed, since a caller added ahead of 9.3 would see every attempt
   * fail, not silently no-op.
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
