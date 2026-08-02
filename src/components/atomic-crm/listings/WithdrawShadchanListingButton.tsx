import type { ReactElement } from "react";
import { useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

/**
 * Story 9.1 (AC-5): withdrawal deletes the row outright — not soft-deleted,
 * not flagged — and the moment it is gone, `anon`'s `select` on
 * `public.listings` returns zero rows for this account (the same `using
 * (true)` policy that made it visible in the first place has nothing left
 * to show). `onWithdrawn` is the caller's own hook's `withdraw()`
 * (`useShadchanListing.ts`) — kept a plain callback prop rather than this
 * component owning the hook itself, so `PublishShadchanListingSection.tsx`
 * stays the single source of truth for "is there a listing right now".
 */
export const WithdrawShadchanListingButton = ({
  isPending,
  onWithdraw,
}: {
  isPending: boolean;
  onWithdraw: () => Promise<void>;
}): ReactElement => {
  const translate = useTranslate();
  const notify = useNotify();

  const handleClick = async () => {
    try {
      await onWithdraw();
    } catch {
      notify("crm.settings.listing.withdraw_error", {
        type: "error",
        messageArgs: { _: "Couldn't withdraw your listing. Try again." },
      });
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => void handleClick()}
    >
      {translate("crm.settings.listing.withdraw_button", {
        _: "Withdraw listing",
      })}
    </Button>
  );
};
