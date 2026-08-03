import type { ReactElement } from "react";
import { useState } from "react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import type { ListingWithdrawalLock, Single } from "../types";
import { useCurrentMemberId } from "../threads/useCurrentMemberId";

const LOCK_LIST_PARAMS = {
  pagination: { page: 1, perPage: 1 },
  sort: { field: "id", order: "ASC" as const },
};

/**
 * Story 9.3 (AC-4): "only the single may clear the lock — never the
 * parent, never any other role." Shown to the single ONLY — gated on BOTH
 * the viewer's own identity (member_id match, the same self-gating shape
 * `WithdrawSingleListingButton.tsx` uses) AND their role (`single` or
 * `self_manager`) — never a `parent_admin`, even one whose `member_id`
 * somehow matched. This double gate is defense in depth, not the real
 * boundary: `consent_to_republish_listing()`'s own role check
 * (02_functions.sql) is what actually refuses a wrong caller, fail-closed
 * (a silent no-op, never an exception) rather than by this button simply
 * not rendering — a missing button is not a security boundary
 * (`.claude/rules/security-triggers.md`).
 *
 * Renders nothing unless a `listing_withdrawal_locks` row genuinely exists
 * for this single in this account — the table's own `select`-only grant
 * (06_grants.sql) is what makes this read possible for any household
 * member; only the DML that would clear it is withheld.
 */
export const ConsentToRepublishButton = ({
  single,
  accountId,
}: {
  single: Single;
  accountId: Identifier;
}): ReactElement | null => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { role } = useViewerRole();
  const { data: currentMemberId, isPending: isMemberIdPending } =
    useCurrentMemberId();
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: locks,
    isPending: isLocksPending,
    refetch,
  } = useGetList<ListingWithdrawalLock>("listing_withdrawal_locks", {
    ...LOCK_LIST_PARAMS,
    filter: { single_id: single.id, account_id: accountId },
  });

  const isSelf =
    currentMemberId != null && single.member_id === currentMemberId;
  const isSingleRole = role === "single" || role === "self_manager";
  const isLocked = (locks?.length ?? 0) > 0;

  if (
    isMemberIdPending ||
    isLocksPending ||
    !isSelf ||
    !isSingleRole ||
    !isLocked
  ) {
    return null;
  }

  const handleClick = async () => {
    setIsSaving(true);
    try {
      await dataProvider.consentToRepublishListing(single.id);
      await refetch();
      notify("crm.settings.listing.consent_success", {
        messageArgs: {
          _: "You've consented — this listing can be republished.",
        },
      });
    } catch {
      notify("crm.settings.listing.consent_error", {
        type: "error",
        messageArgs: { _: "Couldn't process your consent. Try again." },
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
      {translate("crm.settings.listing.consent_button", {
        _: "Allow republishing",
      })}
    </Button>
  );
};
