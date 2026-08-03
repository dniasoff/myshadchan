import type { DataProvider, Identifier } from "ra-core";

import type {
  EntityFile,
  EntityFileVisibility,
  EntityTargetType,
  InboxAttachment,
} from "../../../types";

export type EntityFileBlobUrls = Map<string, string>;

/** Mirrors `providers/supabase/entityFiles.ts#deriveExtension`. */
function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

export type CopyInboxAttachmentsParams = {
  baseDataProvider: DataProvider;
  attachments: InboxAttachment[];
  targetType: EntityTargetType;
  targetId: Identifier;
  visibility?: EntityFileVisibility;
};

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
  } = params;
  if (!attachments || attachments.length === 0) return [];

  const resolvedVisibility = visibility ?? "shared";
  const results: EntityFile[] = [];

  for (const attachment of attachments) {
    const ext = deriveExtension(attachment.title);
    const storagePath = `${accountId}/${targetType}/${targetId}/${crypto.randomUUID()}${ext}`;

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
      results.push(data);
    } catch (error) {
      blobUrls.delete(storagePath);
      throw error;
    }
  }

  return results;
}
