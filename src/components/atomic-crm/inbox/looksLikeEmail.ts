/**
 * A basic shape check, not an RFC-5322 regex — the point is to catch garbage
 * (a missing value, a display name with no address, a misconfigured
 * non-email string) before it reaches something that treats the value as an
 * address, not to validate deliverability.
 *
 * Used by `settings/CaptureSection.tsx` (Story 10.3): guards against
 * rendering a misconfigured, non-email value as this household's real
 * capture address.
 *
 * NOT used by `inbox/NeedsReviewDialog.tsx` (Epic 11) any more: that dialog
 * used to gate "Trust sender" on this check against `inbox_items.sender`
 * (the FR24-recovered ORIGINAL forwarded sender — a display name, a bare
 * email, or null, often not address-shaped at all). It now gates on
 * `inbox_items.sender_email` (the persisted SMTP envelope sender,
 * `workers/ingest/buildInboxItemRow.ts`), which is always a real address
 * when present — so a shape check there would be redundant. See that
 * dialog's own doc comment.
 */
const EMAIL_SHAPE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const looksLikeEmail = (value: string | null | undefined): boolean =>
  value != null && EMAIL_SHAPE_REGEX.test(value);
