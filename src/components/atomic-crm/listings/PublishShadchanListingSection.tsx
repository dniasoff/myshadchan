import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { SectionLabel } from "../settings/SectionLabel";
import { useShadchanListing } from "./useShadchanListing";
import { WithdrawShadchanListingButton } from "./WithdrawShadchanListingButton";

/** One opt-in row: a `Switch` gating whether the field is published at all,
 * plus its value control — shared by all three toggles (AC-1) so a fourth
 * one never needs its own markup. */
function ListingToggleField({
  id,
  label,
  checked,
  onCheckedChange,
  value,
  onValueChange,
  placeholder,
  multiline = false,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  disabled: boolean;
}): ReactElement {
  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onValueChange(event.target.value);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </div>
      {checked ? (
        multiline ? (
          <Textarea
            aria-label={label}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            rows={2}
            disabled={disabled}
          />
        ) : (
          <Input
            aria-label={label}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
          />
        )
      ) : null}
    </div>
  );
}

function PublishShadchanListingSkeleton(): ReactElement {
  const translate = useTranslate();
  return (
    <div>
      {/* A `<Skeleton>` renders a `<div>`; `SectionLabel` renders a `<p>`,
          which cannot contain one — the title stays plain text here rather
          than shimmering. */}
      <SectionLabel>
        {translate("crm.settings.listing.title", {
          _: "Publish my listing",
        })}
      </SectionLabel>
      <div className="space-y-3 rounded-lg border p-4" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

/**
 * Story 9.1 (AC-1 through AC-5): the "Publish my listing" settings panel —
 * three independent, default-off toggles (name, area, how to reach), a
 * Publish action that refuses client-side when name is not opted in (AC-2,
 * mirrored server-side by `listings_shadchan_name_required`), and a
 * Withdraw action once a listing exists (AC-5). Rendered only for a
 * `shadchanus` active context — the caller (`settings/ShadchanListingSection.tsx`)
 * owns that gate, not this component, so this component can be unit-tested
 * with a bare `accountId` and no context-switching setup.
 *
 * All data-fetch/upsert logic lives in `useShadchanListing.ts` — this
 * component is deliberately just the form.
 */
export const PublishShadchanListingSection = ({
  accountId,
}: {
  accountId: Identifier;
}): ReactElement => {
  const translate = useTranslate();
  const notify = useNotify();
  const { listing, isPending, publish, withdraw } =
    useShadchanListing(accountId);

  // Seeds the form from whatever is already published, exactly once — a
  // `ref`-guarded effect rather than plain `useState(listing?.field)`
  // initializers, because those only run on first mount and this data
  // arrives asynchronously. Runs again for nothing after `initialized`
  // flips true, so a post-publish refetch never clobbers what the caller is
  // mid-typing.
  const [initialized, setInitialized] = useState(false);
  const [nameOn, setNameOn] = useState(false);
  const [name, setName] = useState("");
  const [areaOn, setAreaOn] = useState(false);
  const [area, setArea] = useState("");
  const [contactOn, setContactOn] = useState(false);
  const [contact, setContact] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialized || isPending) return;
    setNameOn(listing?.shadchan_name != null);
    setName(listing?.shadchan_name ?? "");
    setAreaOn(listing?.shadchan_area != null);
    setArea(listing?.shadchan_area ?? "");
    setContactOn(listing?.shadchan_contact_info != null);
    setContact(listing?.shadchan_contact_info ?? "");
    setInitialized(true);
  }, [initialized, isPending, listing]);

  if (isPending && !initialized) {
    return <PublishShadchanListingSkeleton />;
  }

  const handlePublish = async () => {
    // AC-2: refused client-side, before any network call, when "name" is
    // not opted in with real text — the CHECK constraint is the server-side
    // half of this same rule.
    if (!nameOn || name.trim() === "") {
      notify("crm.settings.listing.name_required_error", {
        type: "error",
        messageArgs: {
          _: 'Turn on "Name" and enter a name before publishing.',
        },
      });
      return;
    }

    setIsSaving(true);
    try {
      await publish({
        name: name.trim(),
        // AC-1: a field left off is never written — null, not "".
        area: areaOn && area.trim() !== "" ? area.trim() : null,
        contactInfo: contactOn && contact.trim() !== "" ? contact.trim() : null,
      });
      notify("crm.settings.listing.publish_success", {
        messageArgs: { _: "Your listing is live." },
      });
    } catch {
      notify("crm.settings.listing.publish_error", {
        type: "error",
        messageArgs: { _: "Couldn't publish your listing. Try again." },
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleWithdraw = async () => {
    await withdraw();
    notify("crm.settings.listing.withdraw_success", {
      messageArgs: { _: "Your listing has been withdrawn." },
    });
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.listing.title", {
          _: "Publish my listing",
        })}
      </SectionLabel>
      <div className="space-y-4 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          {translate("crm.settings.listing.description", {
            _: "Choose what families can find about you, field by field. Nothing is shown until you turn it on.",
          })}
        </p>

        <ListingToggleField
          id="listing-name"
          label={translate("crm.settings.listing.name_label", {
            _: "Name",
          })}
          checked={nameOn}
          onCheckedChange={setNameOn}
          value={name}
          onValueChange={setName}
          placeholder={translate("crm.settings.listing.name_placeholder", {
            _: "How families should see your name",
          })}
          disabled={isSaving}
        />
        <ListingToggleField
          id="listing-area"
          label={translate("crm.settings.listing.area_label", {
            _: "Area",
          })}
          checked={areaOn}
          onCheckedChange={setAreaOn}
          value={area}
          onValueChange={setArea}
          placeholder={translate("crm.settings.listing.area_placeholder", {
            _: "e.g. Lakewood and nearby",
          })}
          disabled={isSaving}
        />
        <ListingToggleField
          id="listing-contact"
          label={translate("crm.settings.listing.contact_label", {
            _: "How to reach me",
          })}
          checked={contactOn}
          onCheckedChange={setContactOn}
          value={contact}
          onValueChange={setContact}
          placeholder={translate("crm.settings.listing.contact_placeholder", {
            _: "Phone, email, or however you prefer to be reached",
          })}
          multiline
          disabled={isSaving}
        />

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
          <Button
            type="button"
            onClick={() => void handlePublish()}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {translate(
              listing
                ? "crm.settings.listing.update_button"
                : "crm.settings.listing.publish_button",
              { _: listing ? "Update listing" : "Publish my listing" },
            )}
          </Button>
          {listing ? (
            <WithdrawShadchanListingButton
              isPending={isSaving}
              onWithdraw={handleWithdraw}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
