import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { PublicListing } from "./publicListingsClient";
import { translatePublicSearch } from "./publicSearchTranslate";

export interface ShadchanListingCardProps {
  listing: PublicListing;
}

/**
 * One shadchan's published listing (Story 9.1) — up to three opt-in
 * fields: name, area, contact info. Renders only what is non-null on
 * `listing`; never a placeholder for a field the publisher left off (the
 * SPEC's "Never fabricate" constraint, carried onto this public surface,
 * AC-2).
 *
 * `shadchan_name` is guaranteed non-null for any `listing_type: "shadchan"`
 * row by the `listings_shadchan_name_required` CHECK constraint
 * (`01_tables.sql`) — this still guards defensively rather than trusting
 * that invariant blindly (`.claude/rules/coding-style.md`, "never trust
 * external data"): a row without a name renders nothing rather than a
 * fabricated placeholder.
 */
export const ShadchanListingCard = ({ listing }: ShadchanListingCardProps) => {
  const name = listing.shadchan_name?.trim() || null;
  if (!name) {
    return null;
  }

  const area = listing.shadchan_area?.trim() || null;
  const contactInfo = listing.shadchan_contact_info?.trim() || null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      {(area || contactInfo) && (
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          {area && <p>{area}</p>}
          {contactInfo && (
            <p>
              {translatePublicSearch(
                "crm.public_search.shadchan_card.contact_label",
                "Contact",
              )}
              {": "}
              {contactInfo}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
};
