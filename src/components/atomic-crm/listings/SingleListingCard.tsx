import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { Listing } from "../types";
import { translatePublicSearch } from "./publicSearchTranslate";

export interface SingleListingCardProps {
  listing: Listing;
}

/**
 * One single's published listing (Story 9.2) — up to seven opt-in fields:
 * first name (en/he), age, height, community, location, summary. Renders
 * only what is non-null on `listing`, never a placeholder for a field left
 * off (AC-2), and never a photo — a listing carries none (9.1 Dev Notes,
 * "No photo on a listing").
 *
 * At least one of `single_first_name_en` / `single_first_name_he` is
 * guaranteed non-null for a `listing_type: "single"` row by the
 * `listings_single_name_required` CHECK constraint (`01_tables.sql`) —
 * still guarded defensively rather than trusted blindly, same reasoning as
 * `ShadchanListingCard`.
 */
export const SingleListingCard = ({ listing }: SingleListingCardProps) => {
  const firstNameEn = listing.single_first_name_en?.trim() || null;
  const firstNameHe = listing.single_first_name_he?.trim() || null;
  if (!firstNameEn && !firstNameHe) {
    return null;
  }

  const age = listing.single_age ?? null;
  const height = listing.single_height?.trim() || null;
  const community = listing.single_community?.trim() || null;
  const location = listing.single_location?.trim() || null;
  const summary = listing.single_summary?.trim() || null;

  const metaParts: string[] = [];
  if (age != null) {
    metaParts.push(
      `${translatePublicSearch("crm.public_search.single_card.age_label", "Age")} ${age}`,
    );
  }
  if (height) {
    metaParts.push(height);
  }
  if (community) {
    metaParts.push(community);
  }
  if (location) {
    metaParts.push(location);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {firstNameEn ?? firstNameHe}
          {firstNameEn && firstNameHe && (
            <span className="ml-2 font-normal text-muted-foreground">
              ({firstNameHe})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      {(metaParts.length > 0 || summary) && (
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          {metaParts.length > 0 && <p>{metaParts.join(" · ")}</p>}
          {summary && <p>{summary}</p>}
        </CardContent>
      )}
    </Card>
  );
};
