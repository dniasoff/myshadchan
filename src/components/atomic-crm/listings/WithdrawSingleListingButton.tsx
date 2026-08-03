import type { ReactElement } from "react";
import { useState } from "react";
import { useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";

import type { Single } from "../types";
import { useCurrentMemberId } from "../threads/useCurrentMemberId";
import { useListingUpsert } from "./useListingUpsert";

/**
 * Story 9.3 (AC-1): "a single with a login may always withdraw their own
 * listing, regardless of who published it" — even though 9.2 never granted
 * a plain `single` insert/update rights over that row. Self-gated on the
 * viewer's own identity (`useCurrentMemberId()` vs `single.member_id`, the
 * same shape `SingleLoginInvite.tsx` uses for its own self-gating) so
 * `settings/SingleListingSection.tsx` can mount this unconditionally per
 * row without deciding "is this the single themselves" itself — it renders
 * nothing for every other viewer, and nothing when there is no listing to
 * withdraw in the first place.
 *
 * Reuses `useListingUpsert` (not a bare `dataProvider.delete` call) so this
 * button's own `listing`/`isPending` state stays internally consistent
 * after a successful withdrawal (the hook's own `refetch()` makes the
 * button disappear once nothing is left to withdraw) — the same shape
 * `PublishSingleListingSection.tsx` already established for the `single`
 * branch.
 *
 * Deliberately reuses the SAME "Withdraw listing" copy
 * (`crm.settings.listing.*`) 9.1's `WithdrawShadchanListingButton.tsx`
 * already established, rather than a second near-identical key set — the
 * action and its outcome are identical regardless of which `listings`
 * branch it targets (`.claude/rules/coding-style.md`, DRY).
 */
export const WithdrawSingleListingButton = ({
  single,
  accountId,
}: {
  single: Single;
  accountId: Identifier;
}): ReactElement | null => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data: currentMemberId, isPending: isMemberIdPending } =
    useCurrentMemberId();
  const {
    listing,
    isPending: isListingPending,
    withdraw,
  } = useListingUpsert(accountId, "single", single.id);
  const [isSaving, setIsSaving] = useState(false);

  const isSelf =
    currentMemberId != null && single.member_id === currentMemberId;

  if (isMemberIdPending || isListingPending || !isSelf || !listing) {
    return null;
  }

  const handleClick = async () => {
    setIsSaving(true);
    try {
      await withdraw();
      notify("crm.settings.listing.withdraw_success", {
        messageArgs: { _: "Your listing has been withdrawn." },
      });
    } catch {
      notify("crm.settings.listing.withdraw_error", {
        type: "error",
        messageArgs: { _: "Couldn't withdraw your listing. Try again." },
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isSaving}
      onClick={() => void handleClick()}
    >
      {translate("crm.settings.listing.withdraw_button", {
        _: "Withdraw listing",
      })}
    </Button>
  );
};
