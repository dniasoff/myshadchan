import type { DataProvider, Identifier } from "ra-core";

import type {
  EntityFile,
  EntityFileVisibility,
  EntityTargetType,
} from "../../../types";

/**
 * The AD-10 mirror of `providers/supabase/entityFiles.ts` for demo mode.
 * FakeRest has no real storage bucket, so the "bytes" are an in-memory
 * `Map<storage_path, objectUrl>` built with `URL.createObjectURL` —
 * `createDataProvider()` owns one such map per session (closure-local,
 * exactly like its `activeAccountId`) and passes it into every function
 * here, so a second `createDataProvider()` call (a fresh test/demo session)
 * never sees a stale blob from a previous one.
 */
export type EntityFileBlobUrls = Map<string, string>;

/** Mirrors `providers/supabase/entityFiles.ts`'s `deriveExtension`. */
function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

export type UploadEntityFileParams = {
  targetType: EntityTargetType;
  targetId: Identifier;
  file: File;
  visibility?: EntityFileVisibility;
};

/**
 * FakeRest mirror of `uploadEntityFile` (AC 4): same key grammar
 * (`{account_id}/{target_type}/{target_id}/{uuid}{ext}`, no user-supplied
 * segment), same "no object without a row" failure handling — if the
 * `entity_files` create rejects, the blob URL is revoked and removed from
 * the map before rethrowing.
 */
export async function uploadEntityFile(
  baseDataProvider: DataProvider,
  blobUrls: EntityFileBlobUrls,
  accountId: Identifier,
  uploadedByMemberId: Identifier | null,
  params: UploadEntityFileParams,
): Promise<EntityFile> {
  const { targetType, targetId, file, visibility } = params;
  const ext = deriveExtension(file.name);
  const storagePath = `${accountId}/${targetType}/${targetId}/${crypto.randomUUID()}${ext}`;
  blobUrls.set(storagePath, URL.createObjectURL(file));

  try {
    const { data } = await baseDataProvider.create<EntityFile>("entity_files", {
      data: {
        account_id: accountId,
        target_type: targetType,
        target_id: targetId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        visibility: visibility ?? "shared",
        uploaded_by_member_id: uploadedByMemberId,
        created_at: new Date().toISOString(),
      },
    });
    return data;
  } catch (error) {
    const url = blobUrls.get(storagePath);
    if (url) URL.revokeObjectURL(url);
    blobUrls.delete(storagePath);
    throw error;
  }
}

/** FakeRest mirror of `signEntityFileUrl` — returns the same object URL on
 * every call for a given `storagePath` (a real signed URL from Supabase
 * storage is per-call too, but the underlying object is identical either
 * way; nothing here caches the URL on the row or in list state). */
export async function signEntityFileUrl(
  blobUrls: EntityFileBlobUrls,
  storagePath: string,
): Promise<string> {
  const url = blobUrls.get(storagePath);
  if (!url) {
    throw new Error("Failed to sign the file URL");
  }
  return url;
}

/** FakeRest mirror of `deleteEntityFile`: the row deletion is authoritative
 * and runs first, exactly like the Supabase implementation. */
export async function deleteEntityFile(
  baseDataProvider: DataProvider,
  blobUrls: EntityFileBlobUrls,
  params: { id: Identifier; storagePath: string },
): Promise<void> {
  await baseDataProvider.delete("entity_files", { id: params.id });
  const url = blobUrls.get(params.storagePath);
  if (url) URL.revokeObjectURL(url);
  blobUrls.delete(params.storagePath);
}

/** FakeRest mirror of `removeEntityFileObjects` — the beforeDelete cleanup
 * callback's storage half (AC 7b). */
export function removeEntityFileObjects(
  blobUrls: EntityFileBlobUrls,
  storagePaths: string[],
): void {
  for (const storagePath of storagePaths) {
    const url = blobUrls.get(storagePath);
    if (url) URL.revokeObjectURL(url);
    blobUrls.delete(storagePath);
  }
}
