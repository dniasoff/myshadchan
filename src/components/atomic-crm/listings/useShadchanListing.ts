import type { Identifier } from "ra-core";

import type { Listing } from "../types";
import { useListingUpsert } from "./useListingUpsert";

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
 * Story 9.2 (Task 5, DRY): the create-vs-update decision itself now lives
 * in the shared `useListingUpsert` hook — this wrapper's own job is just
 * mapping `ShadchanListingFields`' camelCase shape onto the `shadchan_*`
 * columns and restating AC-2's name-required guard as defense-in-depth
 * (`PublishShadchanListingSection.tsx` already refuses client-side before
 * ever calling this; this is the same rule, so a caller of this hook
 * directly can never reach the network with a payload the database's own
 * `listings_shadchan_name_required` CHECK would refuse anyway).
 */
export const useShadchanListing = (
  accountId: Identifier | undefined,
): UseShadchanListingResult => {
  const { listing, isPending, upsert, withdraw } = useListingUpsert(
    accountId,
    "shadchan",
  );

  const publish = async (fields: ShadchanListingFields): Promise<void> => {
    if (fields.name == null || fields.name.trim() === "") {
      throw new Error("a shadchan listing requires a name");
    }

    await upsert({
      shadchan_name: fields.name.trim(),
      shadchan_area: fields.area,
      shadchan_contact_info: fields.contactInfo,
    });
  };

  return { listing, isPending, publish, withdraw };
};
