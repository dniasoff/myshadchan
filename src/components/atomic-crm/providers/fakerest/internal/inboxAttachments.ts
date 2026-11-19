import type { DataProvider, Identifier } from "ra-core";

import type {
  EntityFile,
  EntityFileVisibility,
  EntityTargetType,
  InboxAttachment,
} from "../../../types";

export type EntityFileBlobUrls = Map<string, string>;
type AttemptEntityFile = EntityFile & { createdByAttempt?: boolean };

export type CopyInboxAttachmentsParams = {
  baseDataProvider: DataProvider;
  attachments: InboxAttachment[];
  targetType: EntityTargetType;
  targetId: Identifier;
  visibility?: EntityFileVisibility;
  sourceInboxItemId?: Identifier;
};

function stableAttachmentToken(itemId: Identifier, path: string): string {
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

/**
 * FakeRest mirror of `providers/supabase/inboxAttachments.ts#copyInboxAttachmentsToEntityFiles`.
 * Demo mode has no real storage buckets; the attachments are just URL strings.
 * We create `entity_files` catalog rows and register the existing `src` URL in
 * the in-memory blob map under a new entity-files-style key, so the Files tab
 * can sign and display them.
 */
export async function copyInboxAttachmentsToEntityFiles(
  blobUrls: EntityFileBlobUrls,
  params: CopyInboxAttachmentsParams & {
    accountId: Identifier;
    uploadedByMemberId: Identifier | null;
  },
): Promise<EntityFile[]> {
  const {
    baseDataProvider,
    attachments,
    targetType,
    targetId,
    visibility,
    accountId,
    uploadedByMemberId,
    sourceInboxItemId,
  } = params;
  if (!attachments || attachments.length === 0) return [];

  const resolvedVisibility = visibility ?? "shared";
  const results: AttemptEntityFile[] = [];

  for (const attachment of attachments) {
    const storageName =
      sourceInboxItemId == null
        ? crypto.randomUUID()
        : `inbox-${stableAttachmentToken(sourceInboxItemId, attachment.path)}`;
    const storagePath = `${accountId}/${targetType}/${targetId}/${storageName}`;

    if (sourceInboxItemId != null) {
      const { data: existingFiles } =
        await baseDataProvider.getList<EntityFile>("entity_files", {
          filter: { target_type: targetType, target_id: targetId },
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        });
      const existing = existingFiles.find(
        (file) => file.storage_path === storagePath,
      );
      if (existing) {
        results.push({ ...existing, createdByAttempt: false });
        continue;
      }
    }

    // Reuse the captured attachment URL as the "signed" URL for the Files tab.
    blobUrls.set(storagePath, attachment.src);

    try {
      const { data } = await baseDataProvider.create<EntityFile>(
        "entity_files",
        {
          data: {
            account_id: accountId,
            target_type: targetType,
            target_id: targetId,
            storage_path: storagePath,
            file_name: attachment.title,
            mime_type: attachment.type,
            size_bytes: 0,
            visibility: resolvedVisibility,
            uploaded_by_member_id: uploadedByMemberId,
            created_at: new Date().toISOString(),
          },
        },
      );
      results.push({ ...(data as AttemptEntityFile), createdByAttempt: true });
    } catch (error) {
      blobUrls.delete(storagePath);
      throw error;
    }
  }

  return results;
}
