import type { BaseEnv } from "../shared/env";
import type { ParsedEmailAttachment } from "./parseEmail";
import { getServiceRoleClient } from "./serviceRoleClient";

/** Same bucket `supabase/functions/postmark/extractAndUploadAttachments.ts`
 * uploads into, and the same one `src/.../inboxAttachments.ts` reads from. */
export const ATTACHMENTS_BUCKET = "attachments";

/** Ported verbatim from the retired Postmark path's `SIGNED_URL_TTL_SECONDS`
 * — the durable reference is the object `path`; callers re-sign on read. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Exactly `InboxAttachment` (`src/components/atomic-crm/types.ts`) — the
 * shape the frontend already renders. */
export interface UploadedAttachment {
  title: string;
  type: string;
  path: string;
  src: string;
}

/**
 * Derive a short, safe extension from a sender-controlled filename. Ported
 * verbatim (Story 10.3 review fix F-H) from
 * `supabase/functions/postmark/extractAndUploadAttachments.ts`: only a
 * short alphanumeric extension survives — a traversal attempt
 * (`a.txt/../../../evil`), an embedded `/`, unicode, or an unreasonably long
 * "extension" is dropped rather than sanitized byte-by-byte, since the
 * extension is a cosmetic hint, not data that needs to round-trip.
 */
function deriveSafeExtension(filename: string): string {
  const parts = filename.split(".");
  const rawExt = parts.length > 1 ? (parts.pop() ?? "") : "";
  return /^[A-Za-z0-9]{1,10}$/.test(rawExt) ? `.${rawExt}` : "";
}

/**
 * Upload every parsed attachment to the private `attachments` bucket and
 * return the same `{title, type, path, src}` shape the retired Postmark
 * path produced. Storage is the one documented exception `forAccount()`
 * does not wrap (`serviceRoleClient.ts`), so this uses the raw service-role
 * client directly — the account-prefixed path (`{accountId}/{uuid}{ext}`) is
 * what makes that safe: the bucket is private and its RLS policies scope on
 * that first path segment, so the prefix is load-bearing, not cosmetic.
 *
 * A single attachment failing to upload or sign aborts the whole batch by
 * throwing — the caller (`index.ts`) wraps the entire `email()` body in
 * try/catch and turns any throw into `message.setReject(...)`, never a
 * silently partial capture.
 */
export async function uploadAttachments(
  attachments: ParsedEmailAttachment[],
  accountId: number,
  env: BaseEnv,
): Promise<UploadedAttachment[]> {
  const client = getServiceRoleClient(env);

  const uploaded = await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment.filename || !attachment.mimeType) {
        console.warn(
          "ingest.uploadAttachments: attachment missing filename or mimeType, skipping",
        );
        return null;
      }

      const fileExt = deriveSafeExtension(attachment.filename);
      const path = `${accountId}/${crypto.randomUUID()}${fileExt}`;

      const { error: uploadError } = await client.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, attachment.content, { contentType: attachment.mimeType });
      if (uploadError) {
        throw new Error(`Failed to upload attachment: ${uploadError.message}`);
      }

      const { data: signed, error: signError } = await client.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (signError || !signed) {
        throw new Error("Failed to sign attachment URL");
      }

      const entry: UploadedAttachment = {
        title: attachment.filename,
        type: attachment.mimeType,
        path,
        src: signed.signedUrl,
      };
      return entry;
    }),
  );

  return uploaded.filter(
    (entry): entry is UploadedAttachment => entry !== null,
  );
}
