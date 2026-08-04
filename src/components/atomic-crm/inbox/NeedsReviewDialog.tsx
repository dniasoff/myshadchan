import { useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { InboxItem } from "../types";
import { InboxCapturePreview } from "./InboxCapturePreview";
import { looksLikeEmail } from "./looksLikeEmail";
import { useResolveInboxItem } from "./useResolveInboxItem";

/**
 * Reviewing a `held` item (Epic 11 "Needs review" tab) — a DIFFERENT
 * decision from `InboxResolveDialog.tsx`'s "which single / which shadchan
 * is this for": here the question is only "do we trust whoever sent this".
 * TRUST vouches for the sender AND releases it (and every other `held` item
 * from the same address) into the working inbox, where it can then be
 * resolved normally; DISCARD marks just this item `dismissed`, reusing
 * `useResolveInboxItem`'s existing dismiss path unchanged.
 *
 * WHY "Trust sender" IS SOMETIMES UNAVAILABLE: `inbox_items.sender` is the
 * FR24-recovered ORIGINAL sender for a forwarded email (`workers/ingest/
 * forwardedSender.ts`), not necessarily the actual envelope address the
 * ingest Worker classified — for a DIRECT (non-forwarded) email it is
 * `null` outright, and even when set it may be a bare display name (e.g.
 * "Mrs. Feldman") rather than an address. `trusted_senders.email` only
 * means something when it IS an address, so this dialog only offers Trust
 * when `item.sender` passes `looksLikeEmail()` — otherwise it explains why
 * and leaves Discard as the only action. This is a real, named limitation
 * of the current data model, not a UI choice — see this feature's own
 * report for the follow-up (a dedicated `sender_email` column, populated
 * from the true envelope address at ingest) that would close it properly.
 */
export const NeedsReviewDialog = ({
  item,
  open,
  onClose,
}: {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { dismissInboxItem } = useResolveInboxItem();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  // One shared busy STATE gates both buttons (mirrors InboxResolveDialog.tsx's
  // own review-fix comment: Trust and Discard both act on this same item,
  // and without that a double-click could send two competing resolutions
  // for it) — but tracks WHICH action is in flight too, so only the button
  // actually pressed shows a "…ing" label; the other just disables.
  const [busyAction, setBusyAction] = useState<"trust" | "discard" | null>(
    null,
  );
  const isBusy = busyAction !== null;

  const senderEmail =
    item.account_id != null && looksLikeEmail(item.sender) ? item.sender : null;

  const handleTrust = async () => {
    if (!senderEmail || item.account_id == null) return;
    setBusyAction("trust");
    try {
      const result = await dataProvider.trustSender({
        accountId: item.account_id,
        email: senderEmail,
      });
      const othersReleased = result.releasedItemIds.filter(
        (id: Identifier) => String(id) !== String(item.id),
      ).length;
      notify(
        othersReleased > 0
          ? translate("crm.inbox.needsReview.trustedWithReleased", {
              _: "Trusted — this and %{smart_count} other waiting item are now in your Inbox |||| Trusted — this and %{smart_count} other waiting items are now in your Inbox",
              smart_count: othersReleased,
            })
          : translate("crm.inbox.needsReview.trusted", {
              _: "Trusted — this is now in your Inbox",
            }),
        { type: "info" },
      );
      refresh();
      onClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.inbox.needsReview.trustError", {
              _: "Couldn't trust that sender. Try again.",
            }),
        { type: "error" },
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscard = async () => {
    setBusyAction("discard");
    try {
      await dismissInboxItem(item);
      notify(
        translate("crm.inbox.needsReview.discarded", {
          _: "Discarded — nothing was filed",
        }),
        { type: "info" },
      );
      refresh();
      onClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.inbox.needsReview.discardError", {
              _: "Couldn't discard that",
            }),
        { type: "error" },
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={
          "top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-2xl " +
          "bg-popover border-border shadow-lg " +
          "dark:bg-[var(--glass-bg)] dark:backdrop-blur-[var(--glass-blur)] dark:border-[var(--glass-border)]"
        }
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            {translate("crm.inbox.needsReview.dialogTitle", {
              _: "Review this sender",
            })}
          </DialogTitle>
          <DialogDescription>
            {translate("crm.inbox.needsReview.dialogDescription", {
              _: "This arrived from someone we don't yet recognize for this household. Trusting them lets this — and anything else already waiting from the same address — into your working inbox.",
            })}
          </DialogDescription>
        </DialogHeader>

        <InboxCapturePreview item={item} />

        {!senderEmail ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.inbox.needsReview.senderUnknownNotice", {
              _: "We don't have a clear email address for this sender yet, so there's no address to trust. You can still discard this item.",
            })}
          </p>
        ) : null}

        <div className="flex flex-row justify-between gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === "discard"
              ? translate("crm.inbox.needsReview.discarding", {
                  _: "Discarding…",
                })
              : translate("crm.inbox.needsReview.discard", {
                  _: "Discard",
                })}
          </button>
          {senderEmail ? (
            <Button type="button" onClick={handleTrust} disabled={isBusy}>
              {busyAction === "trust"
                ? translate("crm.inbox.needsReview.trusting", {
                    _: "Trusting…",
                  })
                : translate("crm.inbox.needsReview.trustSender", {
                    _: "Trust sender",
                  })}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
