/**
 * A basic shape check, not an RFC-5322 regex — the point is to catch garbage
 * (a missing value, a display name with no address, a misconfigured
 * non-email string) before it reaches something that treats the value as an
 * address, not to validate deliverability.
 *
 * Shared by two callers that both need exactly this bar, for two different
 * reasons:
 *   - `inbox/NeedsReviewDialog.tsx` (Epic 11): `inbox_items.sender` is the
 *     FR24-recovered ORIGINAL sender for a forwarded email — a display name
 *     (e.g. "Mrs. Feldman"), a bare email, or null, depending on what the
 *     forwarded body's headers actually contained. "Trust sender" writes
 *     `trusted_senders.email`, which only means something when `sender` is
 *     itself shaped like an address — this is that gate.
 *   - `settings/CaptureSection.tsx` (Story 10.3): guards against rendering a
 *     misconfigured, non-email value as this household's real capture
 *     address.
 */
const EMAIL_SHAPE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const looksLikeEmail = (value: string | null | undefined): boolean =>
  value != null && EMAIL_SHAPE_REGEX.test(value);
