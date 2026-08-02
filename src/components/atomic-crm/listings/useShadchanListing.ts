import { useDataProvider, useGetList } from "ra-core";
import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { Listing } from "../types";

/** The three opt-in fields Story 9.1 ships (FR101) — `null` means the
 * publisher never turned that toggle on, never an empty string (AC-1). */
export interface ShadchanListingFields {
  name: string | null;
  area: string | null;
  contactInfo: string | null;
}

export interface UseShadchanListingResult {
  /** The account's own published `shadchan`-branch listing, or `null` when
   * none has been published yet. */
  listing: Listing | null;
  isPending: boolean;
  /**
   * Create-or-update in one call (AC-3): a first publish inserts, a
   * republish updates the SAME row in place — the partial unique index
   * (`listings_shadchan_account_id_key`) is what makes "one live listing,
   * not a growing pile" true at the database; this is just the client
   * picking the right verb. Refuses client-side (AC-2) before either verb
   * runs, mirroring the `listings_shadchan_name_required` CHECK constraint
   * so a caller can never reach the network with a payload the database
   * would refuse anyway.
   */
  publish: (fields: ShadchanListingFields) => Promise<void>;
  /** Deletes the row outright (AC-5) — never a soft-delete/flag. */
  withdraw: () => Promise<void>;
}

/**
 * Story 9.1's data-access seam for the "Publish my listing" settings panel —
 * kept separate from `PublishShadchanListingSection.tsx` so that component
 * stays a small, focused form (`.claude/rules/coding-style.md`).
 *
 * `getList` rather than `getOne`: there is no natural id to `getOne` with
 * before a listing exists, and `listings_shadchan_account_id_key` (the
 * partial unique index) guarantees at most one `shadchan`-branch row per
 * account, so `perPage: 1` is exact, not an approximation.
 */
export const useShadchanListing = (
  accountId: Identifier | undefined,
): UseShadchanListingResult => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data, isPending, refetch } = useGetList<Listing>(
    "listings",
    {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
      filter: { account_id: accountId, listing_type: "shadchan" },
    },
    { enabled: accountId != null },
  );

  const listing = data?.[0] ?? null;

  const publish = async (fields: ShadchanListingFields): Promise<void> => {
    if (accountId == null) {
      throw new Error("no active shadchanus context to publish a listing for");
    }
    // AC-2, defense-in-depth: the same refusal PublishShadchanListingSection
    // already applies before calling this, restated here so this function
    // can never reach the network with a payload the database's own
    // `listings_shadchan_name_required` CHECK would refuse anyway.
    if (fields.name == null || fields.name.trim() === "") {
      throw new Error("a shadchan listing requires a name");
    }

    const data = {
      listing_type: "shadchan" as const,
      shadchan_name: fields.name.trim(),
      shadchan_area: fields.area,
      shadchan_contact_info: fields.contactInfo,
    };

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
      // shidduchim-domain create in this codebase follows (see
      // medical_notes/shidduchim_external_links).
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

  return { listing, isPending, publish, withdraw };
};
