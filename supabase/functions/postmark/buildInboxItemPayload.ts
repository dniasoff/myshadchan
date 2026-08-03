import type { Attachment } from "./extractAndUploadAttachments.ts";
import type { OriginalSenderCandidate } from "./forwardedParser.ts";

export interface InboxItemEmailInput {
  accountId: number;
  textBody?: string | null;
  subject?: string | null;
  originalSender: OriginalSenderCandidate;
  attachments?: Attachment[] | null;
}

export interface InboxItemRow {
  account_id: number;
  source: "email";
  raw_text: string | null;
  subject: string | null;
  sender: string | null;
  sender_needs_confirmation: boolean;
  attachments: Attachment[] | null;
  status: "unresolved";
}

/**
 * Build the `inbox_items` row for a forwarded / CC'd email capture (Epic 2).
 * Pure (no I/O) so it can be unit-tested; the DB insert lives in
 * createInboxItemFromEmail. Empty text/subject collapse to null, and an empty
 * attachment list to null, so the inbox card renders calmly. The original sender
 * is recovered by the caller from the forwarded headers (FR24); if recovery was
 * ambiguous, `sender` is left null and `sender_needs_confirmation` is true. The
 * body is stored verbatim — never parsed here (auto-parse is a gated follow-up).
 */
export function buildInboxItemPayload(
  input: InboxItemEmailInput,
): InboxItemRow {
  const trimmedText = (input.textBody ?? "").trim();
  const trimmedSubject = (input.subject ?? "").trim();
  const sender = input.originalSender.name ?? input.originalSender.email;
  const trimmedSender = sender?.trim() ?? "";
  return {
    account_id: input.accountId,
    source: "email",
    raw_text: trimmedText.length > 0 ? trimmedText : null,
    subject: trimmedSubject.length > 0 ? trimmedSubject : null,
    sender: trimmedSender.length > 0 ? trimmedSender : null,
    sender_needs_confirmation: input.originalSender.needsConfirmation,
    attachments:
      input.attachments && input.attachments.length > 0
        ? input.attachments
        : null,
    status: "unresolved",
  };
}
