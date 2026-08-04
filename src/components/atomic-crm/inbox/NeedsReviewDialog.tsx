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
 * TRUST IS GATED ON `sender_email`, NOT `sender`: `inbox_items.sender_email`
 * is the persisted SMTP envelope sender (`workers/ingest/
 * buildInboxItemRow.ts`) — a real address, always populated for any item
 * ingested since that column existed. `inbox_items.sender` is a DIFFERENT
 * field, the FR24-recovered ORIGINAL sender for a forwarded email
 * (`workers/ingest/forwardedSender.ts`) — `null` outright for a direct
 * email, and even when set it may be a bare display name (e.g.
 * "Mrs. Feldman"). `trusted_senders.email` needs a real address, so Trust
 * uses `sender_email`, never `sender`. The one remaining gap is an item
 * ingested BEFORE `sender_email` existed: it has `sender_email: null`, so
 * this dialog offers Discard only and explains why, rather than showing a
 * dead Trust button. `sender` is still shown (via `InboxCapturePreview`) as
 * useful context for deciding whether to trust — it just no longer gates
 * the button.
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

  const trustableSenderEmail =
    item.account_id != null && item.sender_email != null
      ? item.sender_email
      : null;

  const handleTrust = async () => {
    if (!trustableSenderEmail || item.account_id == null) return;
    setBusyAction("trust");
    try {
      const result = await dataProvider.trustSender({
        accountId: item.account_id,
        email: trustableSenderEmail,
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

        {trustableSenderEmail ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.inbox.needsReview.trustTargetNotice", {
              _: "Trusting will let in future mail from %{email} too.",
              email: trustableSenderEmail,
            })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("crm.inbox.needsReview.senderUnknownNotice", {
              _: "We don't have a return address on file for this item, so there's nothing to trust yet. You can still discard it.",
            })}
          </p>
        )}

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
          {trustableSenderEmail ? (
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
