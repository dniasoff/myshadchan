import type { UploadedAttachment } from "./attachments";
import type { OriginalSenderCandidate } from "./forwardedSender";
import type { SenderClassification } from "./classifySender";

export interface InboxItemEmailInput {
  textBody: string | null;
  subject: string | null;
  originalSender: OriginalSenderCandidate;
  attachments: UploadedAttachment[];
  classification: SenderClassification;
}

export interface InboxItemRow {
  source: "email";
  raw_text: string | null;
  subject: string | null;
  sender: string | null;
  sender_needs_confirmation: boolean;
  attachments: UploadedAttachment[] | null;
  status: "unresolved" | "held";
}

/**
 * Build the `inbox_items` row for an inbound email capture (Epic 11).
 * Pure (no I/O) so it can be unit-tested; the DB insert lives in `index.ts`,
 * via `forAccount()` — deliberately no `account_id` field here: `forAccount()`
 * injects and asserts it, so it is never "passed by hand" (the tenancy
 * requirement this Worker's spec calls out explicitly).
 *
 * Mirrors `supabase/functions/postmark/buildInboxItemPayload.ts`: empty
 * text/subject collapse to null, and an empty attachment list to null, so
 * the inbox card renders calmly. The original sender is recovered by the
 * caller from the forwarded headers (FR24, `forwardedSender.ts`); if
 * recovery was ambiguous, `sender` is left null and
 * `sender_needs_confirmation` is true. The body is stored verbatim — never
 * parsed here.
 *
 * `status` is the one real difference from the Postmark path (which always
 * wrote `'unresolved'`): here it follows the sender CLASSIFICATION
 * (`classifySender.ts`) — 'unresolved' for a known sender, 'held' for an
 * unknown one. Classification is a property of the actual envelope sender,
 * independent of whatever original sender FR24 recovery attributes the note
 * to.
 */
export function buildInboxItemRow(input: InboxItemEmailInput): InboxItemRow {
  const trimmedText = (input.textBody ?? "").trim();
  const trimmedSubject = (input.subject ?? "").trim();
  const sender = input.originalSender.name ?? input.originalSender.email;
  const trimmedSender = sender?.trim() ?? "";

  return {
    source: "email",
    raw_text: trimmedText.length > 0 ? trimmedText : null,
    subject: trimmedSubject.length > 0 ? trimmedSubject : null,
    sender: trimmedSender.length > 0 ? trimmedSender : null,
    sender_needs_confirmation: input.originalSender.needsConfirmation,
    attachments: input.attachments.length > 0 ? input.attachments : null,
    status: input.classification === "known" ? "unresolved" : "held",
  };
}
