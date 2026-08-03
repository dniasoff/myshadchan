import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getSupabaseClient } from "./supabase";

/**
 * Story 10.3 review fix (F-B, BLOCKING): `inbox_items.attachments[].src` is a
 * signed URL minted ONCE by `postmark/extractAndUploadAttachments.ts`
 * (`SIGNED_URL_TTL_SECONDS`, one hour) and persisted verbatim in the row.
 * `InboxResolveDialog.tsx` used to render that stored value directly as an
 * `<a href>` — the first caller ever to render it — so every attachment
 * link went dead exactly one hour after capture, with nothing anywhere to
 * re-sign it. Measured: a 1-second signed URL against a real object
 * returned `200` immediately and `400 InvalidJWT` three seconds later.
 *
 * `path` (the object key) is the durable reference; this mints a FRESH
 * signed URL from it at click/render time and never persists the result —
 * the same "minted per click, never cached" contract
 * `entityFiles.ts#signEntityFileUrl` and `resumes.ts#signResumeFileUrl`
 * already use for the sibling `entity-files` / `documents` buckets.
 * `ATTACHMENTS_BUCKET` is the same bucket id
 * `extractAndUploadAttachments.ts` uploads into (that Edge Function hardcodes
 * the literal `"attachments"`, which is this constant's default; the two
 * only diverge if `VITE_ATTACHMENTS_BUCKET` is overridden — same rule the
 * existing `dataProvider.ts#uploadToBucket` for note attachments already
 * relies on).
 *
 * Deliberately NOT wired into `dataProvider.ts`'s custom-methods overlay the
 * way the two siblings above are — that file is Story 10.1's concurrent,
 * uncommitted work in this tree (`.claude/rules/parallel-ownership.md`
 * "Out-of-scope work is reported, not taken"). Calling a
 * `providers/supabase/*` module directly from a component is an existing
 * pattern too, not a new one invented for this fix (`landing/LandingGate.tsx`).
 *
 * Deliberately no `{ download: fileName }` option, unlike
 * `signEntityFileUrl` / `signResumeFileUrl`: the pre-fix behaviour opened
 * the attachment as a plain `target="_blank"` link, letting the browser
 * render it (a PDF viewer, a text file inline, an image) rather than
 * forcing a save-to-disk prompt — this fix keeps that exact UX and only
 * replaces the STALE URL with a fresh one.
 */
export const INBOX_ATTACHMENT_URL_TTL_SECONDS = 60;

export async function signInboxAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, INBOX_ATTACHMENT_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("signInboxAttachmentUrl.error", error);
    throw new Error("Failed to open the attachment");
  }
  return data.signedUrl;
}
