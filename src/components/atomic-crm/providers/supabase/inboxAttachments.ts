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
  /** Makes the destination key stable across a crashed retry. */
  sourceInboxItemId?: Identifier;
};

export class InboxAttachmentCopyError extends Error {
  constructor(
    message: string,
    readonly copiedFiles: EntityFile[],
  ) {
    super(message);
    this.name = "InboxAttachmentCopyError";
  }
}

type AttemptEntityFile = EntityFile & { createdByAttempt?: boolean };

const ENTITY_FILES_BUCKET = "entity-files";

/** Mirrors `entityFiles.ts#deriveExtension`. */
function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

function stableAttachmentToken(itemId: Identifier, path: string): string {
  // The token is only a retry key, never an authorization value. Two FNV
  // rounds keep the path opaque while avoiding a second async digest for each
  // attachment in this already sequential copy path.
  let first = 2166136261;
  let second = 2246822519;
  for (const character of `${itemId}:${path}`) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code;
    second = Math.imul(second, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function isExistingStorageObjectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    /already exists|duplicate|already been uploaded/i.test(
      String((error as { message?: unknown }).message ?? ""),
    )
  );
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
  sourceInboxItemId?: Identifier,
): Promise<EntityFile> {
  const ext = deriveExtension(attachment.title);
  const storagePath = `${accountId}/${targetType}/${targetId}/${
    sourceInboxItemId == null
      ? crypto.randomUUID()
      : `inbox-${sourceInboxItemId}-${stableAttachmentToken(
          sourceInboxItemId,
          attachment.path,
        )}`
  }${ext}`;

  const { data: blob, error: downloadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .download(attachment.path);
  if (downloadError || !blob) {
    throw new Error("Failed to download the captured attachment");
  }

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .upload(storagePath, blob);
  if (uploadError && !isExistingStorageObjectError(uploadError)) {
    throw new Error("Failed to upload the captured attachment");
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
  } catch {
    // Best-effort cleanup: the catalog row is the source of truth, so if it
    // failed we remove the orphaned object for the old random-key path. A
    // deterministic retry path may already have committed its row while the
    // response was lost, so leave that object for the next lookup.
    if (sourceInboxItemId == null) {
      await getSupabaseClient()
        .storage.from(ENTITY_FILES_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
    }
    throw new Error("Failed to save the captured attachment");
  }
}

export async function copyInboxAttachmentsToEntityFiles(
  params: CopyInboxAttachmentsParams,
): Promise<EntityFile[]> {
  const {
    baseDataProvider,
    attachments,
    targetType,
    targetId,
    visibility,
    sourceInboxItemId,
  } = params;
  if (!attachments || attachments.length === 0) return [];

  const accountId = await currentAccountId();
  const resolvedVisibility = visibility ?? "shared";

  const results: AttemptEntityFile[] = [];
  for (const attachment of attachments) {
    try {
      const expectedPath =
        sourceInboxItemId == null
          ? null
          : `${accountId}/${targetType}/${targetId}/inbox-${
              sourceInboxItemId
            }-${stableAttachmentToken(sourceInboxItemId, attachment.path)}${deriveExtension(
              attachment.title,
            )}`;
      if (expectedPath != null) {
        const { data: existingFiles } =
          await baseDataProvider.getList<EntityFile>("entity_files", {
            filter: { target_type: targetType, target_id: targetId },
            pagination: { page: 1, perPage: 10_000 },
            sort: { field: "id", order: "ASC" },
          });
        const existing = existingFiles.find(
          (file) => file.storage_path === expectedPath,
        );
        if (existing) {
          results.push({ ...existing, createdByAttempt: false });
          continue;
        }
      }
      const file = await copyOneAttachment(
        baseDataProvider,
        attachment,
        targetType,
        targetId,
        accountId,
        resolvedVisibility,
        sourceInboxItemId,
      );
      results.push({ ...file, createdByAttempt: true });
    } catch (error) {
      throw new InboxAttachmentCopyError(
        error instanceof Error
          ? error.message
          : "Failed to save the captured attachment",
        results,
      );
    }
  }
  return results;
}
