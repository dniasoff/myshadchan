import type { DataProvider, Identifier } from "ra-core";

import type {
  EntityFile,
  EntityFileVisibility,
  EntityTargetType,
  InboxAttachment,
} from "../../types";
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

/**
 * Story 10.4: when an inbox item with attachments is linked to an existing
 * shidduch, copy those attachments into the durable `entity-files` bucket
 * and create `entity_files` catalog rows so they appear on the shidduch's
 * Files tab.
 */
export type CopyInboxAttachmentsParams = {
  baseDataProvider: DataProvider;
  attachments: InboxAttachment[];
  targetType: EntityTargetType;
  targetId: Identifier;
  visibility?: EntityFileVisibility;
};

const ENTITY_FILES_BUCKET = "entity-files";

/** Mirrors `entityFiles.ts#deriveExtension`. */
function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

async function currentAccountId(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");
  if (error || data == null) {
    throw new Error("Cannot resolve the account for this attachment copy");
  }
  return data as number;
}

async function copyOneAttachment(
  baseDataProvider: DataProvider,
  attachment: InboxAttachment,
  targetType: EntityTargetType,
  targetId: Identifier,
  accountId: number,
  visibility: EntityFileVisibility,
): Promise<EntityFile> {
  const ext = deriveExtension(attachment.title);
  const storagePath = `${accountId}/${targetType}/${targetId}/${crypto.randomUUID()}${ext}`;

  const { data: blob, error: downloadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .download(attachment.path);
  if (downloadError || !blob) {
    throw new Error(
      `Failed to download attachment ${attachment.title}: ${downloadError?.message ?? "unknown"}`,
    );
  }

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .upload(storagePath, blob);
  if (uploadError) {
    throw new Error(
      `Failed to upload attachment ${attachment.title}: ${uploadError.message}`,
    );
  }

  try {
    const { data } = await baseDataProvider.create<EntityFile>("entity_files", {
      data: {
        target_type: targetType,
        target_id: targetId,
        storage_path: storagePath,
        file_name: attachment.title,
        mime_type: attachment.type,
        size_bytes: blob.size,
        visibility,
      },
    });
    return data;
  } catch (createError) {
    // Best-effort cleanup: the catalog row is the source of truth, so if it
    // failed we remove the orphaned object and rethrow the original error.
    await getSupabaseClient()
      .storage.from(ENTITY_FILES_BUCKET)
      .remove([storagePath])
      .catch((removeError) => {
        console.error("copyOneAttachment.cleanup.error", removeError);
      });
    throw createError;
  }
}

export async function copyInboxAttachmentsToEntityFiles(
  params: CopyInboxAttachmentsParams,
): Promise<EntityFile[]> {
  const { baseDataProvider, attachments, targetType, targetId, visibility } =
    params;
  if (!attachments || attachments.length === 0) return [];

  const accountId = await currentAccountId();
  const resolvedVisibility = visibility ?? "shared";

  const results: EntityFile[] = [];
  for (const attachment of attachments) {
    const file = await copyOneAttachment(
      baseDataProvider,
      attachment,
      targetType,
      targetId,
      accountId,
      resolvedVisibility,
    );
    results.push(file);
  }
  return results;
}
