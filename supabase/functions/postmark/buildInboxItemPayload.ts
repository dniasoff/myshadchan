import type { Attachment } from "./extractAndUploadAttachments.ts";

export interface InboxItemEmailInput {
  accountId: number;
  textBody?: string | null;
  subject?: string | null;
  sender?: string | null;
  attachments?: Attachment[] | null;
}

export interface InboxItemRow {
  account_id: number;
  source: "email";
  raw_text: string | null;
  subject: string | null;
  sender: string | null;
  attachments: Attachment[] | null;
  status: "unresolved";
}

/**
 * Build the `inbox_items` row for a forwarded / CC'd email capture (Epic 2).
 * Pure (no I/O) so it can be unit-tested; the DB insert lives in
 * createInboxItemFromEmail. Empty text/subject/sender collapse to null, and an
 * empty attachment list to null, so the inbox card renders calmly. The body is
 * stored verbatim — never parsed here (auto-parse is a gated follow-up).
 */
export function buildInboxItemPayload(
  input: InboxItemEmailInput,
): InboxItemRow {
  const trimmedText = (input.textBody ?? "").trim();
  const trimmedSubject = (input.subject ?? "").trim();
  const trimmedSender = (input.sender ?? "").trim();
  return {
    account_id: input.accountId,
    source: "email",
    raw_text: trimmedText.length > 0 ? trimmedText : null,
    subject: trimmedSubject.length > 0 ? trimmedSubject : null,
    sender: trimmedSender.length > 0 ? trimmedSender : null,
    attachments:
      input.attachments && input.attachments.length > 0
        ? input.attachments
        : null,
    status: "unresolved",
  };
}
