import { Paperclip } from "lucide-react";
import { useNotify, useTranslate } from "ra-core";

import { signInboxAttachmentUrl } from "../providers/supabase/inboxAttachments";
import type { InboxAttachment, InboxItem } from "../types";
import { INBOX_SOURCE_META } from "./inboxMeta";

/**
 * The raw capture, verbatim, for reference while filing or reviewing —
 * extracted out of `InboxResolveDialog.tsx` (the only place that used to
 * inline this) so `NeedsReviewDialog.tsx` (Epic 11) can reuse the exact same
 * block rather than forking a second copy, mirroring
 * `useResolveInboxItem.ts`'s own "one place decides, every entry point
 * reuses it" convention.
 *
 * Story 10.3 review fix (F-B): `item.attachments[].src` is a signed URL that
 * expires an hour after capture — `handleOpenAttachment` mints a FRESH one
 * at click time via `signInboxAttachmentUrl(attachment.path)`, never
 * rendering the persisted `src` as a static `href`.
 */
export const InboxCapturePreview = ({ item }: { item: InboxItem }) => {
  const translate = useTranslate();
  const notify = useNotify();

  const SourceIcon = INBOX_SOURCE_META[item.source].icon;
  const sourceLabel = translate(`crm.inbox.source_${item.source}`, {
    _: INBOX_SOURCE_META[item.source].label,
  });

  const handleOpenAttachment = async (attachment: InboxAttachment) => {
    try {
      const url = await signInboxAttachmentUrl(attachment.path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Couldn't open the attachment",
        { type: "error" },
      );
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-secondary/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <SourceIcon className="size-3.5" aria-hidden="true" />
        {sourceLabel}
        {item.sender_needs_confirmation ? (
          <span
            className="normal-case font-medium"
            style={{
              color:
                "color-mix(in oklch, var(--attention) 75%, var(--foreground))",
            }}
          >
            {translate("crm.inbox.senderNeedsConfirmation", {
              _: "Who sent this?",
            })}
          </span>
        ) : item.sender ? (
          <span className="normal-case">· {item.sender}</span>
        ) : null}
      </div>
      {item.subject ? (
        <p className="text-sm font-semibold">{item.subject}</p>
      ) : null}
      {item.raw_text ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {item.raw_text}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No text — see the attached file.
        </p>
      )}
      {item.attachments && item.attachments.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.attachments.map((attachment) => (
            <li key={attachment.path}>
              <button
                type="button"
                onClick={() => handleOpenAttachment(attachment)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                <Paperclip className="size-3.5" aria-hidden="true" />
                {attachment.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
