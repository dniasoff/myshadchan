import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { PublishableSingleListingFields, Single } from "../types";
import { ListingToggleField } from "./ListingToggleField";
import { useListingUpsert } from "./useListingUpsert";

function PublishSingleListingSkeleton(): ReactElement {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

/**
 * Story 9.2 (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6): the field-by-field publish
 * form for a single's listing — seven independent, default-off toggles
 * (Dev Notes "Field set decision": first name in English/Hebrew, age,
 * height, community, location, and a free-text summary), a Publish action
 * that refuses client-side unless at least one first-name script is opted
 * in (AC-2, mirrored server-side by `listings_single_name_required`).
 *
 * Deliberately offers no other field — the pipeline state, shidduch
 * history, private/parent notes, reference call content, diligence
 * progress, dating history and medical notes are not present as options at
 * all (AC-4), and there is no household-level "publish us" action anywhere
 * near this form (AC-5). It also offers NO withdrawal action (Story 9.3's —
 * there is no "Single listings delete" RLS policy for this branch yet) and
 * NO photo control of any kind, not even a disabled placeholder (a listing
 * never carries a photo; see 9.1 Dev Notes "No photo on a listing").
 *
 * Rendered inside a per-single Dialog from
 * `settings/SingleListingSection.tsx`, which owns "who may act on this
 * row" (FR103) — this component is authorization-agnostic; Task 1's two
 * `Single listings insert`/`update` RLS policies are the real boundary
 * either way.
 */
export const PublishSingleListingSection = ({
  single,
  accountId,
}: {
  single: Single;
  accountId: Identifier;
}): ReactElement => {
  const translate = useTranslate();
  const notify = useNotify();
  const { listing, isPending, upsert } = useListingUpsert(
    accountId,
    "single",
    single.id,
  );

  // Seeds the form from whatever is already published, exactly once — the
  // same `ref`-guarded-by-a-flag effect PublishShadchanListingSection.tsx
  // uses, for the same reason (this data arrives asynchronously, and a
  // post-publish refetch must never clobber what the caller is mid-typing).
  const [initialized, setInitialized] = useState(false);
  const [firstNameEnOn, setFirstNameEnOn] = useState(false);
  const [firstNameEn, setFirstNameEn] = useState("");
  const [firstNameHeOn, setFirstNameHeOn] = useState(false);
  const [firstNameHe, setFirstNameHe] = useState("");
  const [ageOn, setAgeOn] = useState(false);
  const [age, setAge] = useState("");
  const [heightOn, setHeightOn] = useState(false);
  const [height, setHeight] = useState("");
  const [communityOn, setCommunityOn] = useState(false);
  const [community, setCommunity] = useState("");
  const [locationOn, setLocationOn] = useState(false);
  const [location, setLocation] = useState("");
  const [summaryOn, setSummaryOn] = useState(false);
  const [summary, setSummary] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialized || isPending) return;
    setFirstNameEnOn(listing?.single_first_name_en != null);
    setFirstNameEn(listing?.single_first_name_en ?? "");
    setFirstNameHeOn(listing?.single_first_name_he != null);
    setFirstNameHe(listing?.single_first_name_he ?? "");
    setAgeOn(listing?.single_age != null);
    setAge(listing?.single_age != null ? String(listing.single_age) : "");
    setHeightOn(listing?.single_height != null);
    setHeight(listing?.single_height ?? "");
    setCommunityOn(listing?.single_community != null);
    setCommunity(listing?.single_community ?? "");
    setLocationOn(listing?.single_location != null);
    setLocation(listing?.single_location ?? "");
    setSummaryOn(listing?.single_summary != null);
    setSummary(listing?.single_summary ?? "");
    setInitialized(true);
  }, [initialized, isPending, listing]);

  if (isPending && !initialized) {
    return <PublishSingleListingSkeleton />;
  }

  const handlePublish = async () => {
    // AC-2: refused client-side, before any network call, unless at least
    // one first-name script is opted in with real text —
    // listings_single_name_required is the server-side half of this rule.
    const hasEnglishName = firstNameEnOn && firstNameEn.trim() !== "";
    const hasHebrewName = firstNameHeOn && firstNameHe.trim() !== "";
    if (!hasEnglishName && !hasHebrewName) {
      notify("crm.settings.single_listing_form.name_required_error", {
        type: "error",
        messageArgs: {
          _: "Turn on an English or Hebrew first name and enter it before publishing.",
        },
      });
      return;
    }

    const parsedAge =
      ageOn && age.trim() !== "" ? Number.parseInt(age.trim(), 10) : null;

    setIsSaving(true);
    try {
      const fields: PublishableSingleListingFields = {
        single_first_name_en: hasEnglishName ? firstNameEn.trim() : null,
        single_first_name_he: hasHebrewName ? firstNameHe.trim() : null,
        // AC-1: a field left off (or emptied) is never written as stale
        // text — null, not "", and never NaN when the input is non-numeric.
        single_age:
          parsedAge != null && !Number.isNaN(parsedAge) ? parsedAge : null,
        single_height: heightOn && height.trim() !== "" ? height.trim() : null,
        single_community:
          communityOn && community.trim() !== "" ? community.trim() : null,
        single_location:
          locationOn && location.trim() !== "" ? location.trim() : null,
        single_summary:
          summaryOn && summary.trim() !== "" ? summary.trim() : null,
      };
      await upsert(fields);
      notify("crm.settings.single_listing_form.publish_success", {
        messageArgs: { _: "The listing is live." },
      });
    } catch {
      notify("crm.settings.single_listing_form.publish_error", {
        type: "error",
        messageArgs: { _: "Couldn't publish the listing. Try again." },
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <ListingToggleField
        id="single-listing-first-name-en"
        label={translate(
          "crm.settings.single_listing_form.first_name_en_label",
          {
            _: "First name (English)",
          },
        )}
        checked={firstNameEnOn}
        onCheckedChange={setFirstNameEnOn}
        value={firstNameEn}
        onValueChange={setFirstNameEn}
        placeholder={translate(
          "crm.settings.single_listing_form.first_name_en_placeholder",
          { _: "How shadchanim should see their first name" },
        )}
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-first-name-he"
        label={translate(
          "crm.settings.single_listing_form.first_name_he_label",
          {
            _: "First name (Hebrew)",
          },
        )}
        checked={firstNameHeOn}
        onCheckedChange={setFirstNameHeOn}
        value={firstNameHe}
        onValueChange={setFirstNameHe}
        placeholder={translate(
          "crm.settings.single_listing_form.first_name_he_placeholder",
          { _: "שם פרטי" },
        )}
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-age"
        label={translate("crm.settings.single_listing_form.age_label", {
          _: "Age",
        })}
        checked={ageOn}
        onCheckedChange={setAgeOn}
        value={age}
        onValueChange={setAge}
        placeholder={translate(
          "crm.settings.single_listing_form.age_placeholder",
          {
            _: "e.g. 24",
          },
        )}
        inputType="number"
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-height"
        label={translate("crm.settings.single_listing_form.height_label", {
          _: "Height",
        })}
        checked={heightOn}
        onCheckedChange={setHeightOn}
        value={height}
        onValueChange={setHeight}
        placeholder={translate(
          "crm.settings.single_listing_form.height_placeholder",
          { _: "e.g. 5'6\"" },
        )}
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-community"
        label={translate("crm.settings.single_listing_form.community_label", {
          _: "Community",
        })}
        checked={communityOn}
        onCheckedChange={setCommunityOn}
        value={community}
        onValueChange={setCommunity}
        placeholder={translate(
          "crm.settings.single_listing_form.community_placeholder",
          { _: "e.g. Yeshivish, Modern Orthodox" },
        )}
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-location"
        label={translate("crm.settings.single_listing_form.location_label", {
          _: "Location",
        })}
        checked={locationOn}
        onCheckedChange={setLocationOn}
        value={location}
        onValueChange={setLocation}
        placeholder={translate(
          "crm.settings.single_listing_form.location_placeholder",
          { _: "e.g. Lakewood, NJ" },
        )}
        disabled={isSaving}
      />
      <ListingToggleField
        id="single-listing-summary"
        label={translate("crm.settings.single_listing_form.summary_label", {
          _: "Summary",
        })}
        checked={summaryOn}
        onCheckedChange={setSummaryOn}
        value={summary}
        onValueChange={setSummary}
        placeholder={translate(
          "crm.settings.single_listing_form.summary_placeholder",
          { _: "Anything the fixed fields above don't capture" },
        )}
        multiline
        disabled={isSaving}
      />

      <Button
        type="button"
        onClick={() => void handlePublish()}
        disabled={isSaving}
        className="w-full"
      >
        {translate(
          listing
            ? "crm.settings.single_listing_form.update_button"
            : "crm.settings.single_listing_form.publish_button",
          { _: listing ? "Update listing" : "Publish listing" },
        )}
      </Button>
    </div>
  );
};
