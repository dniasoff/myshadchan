import type { DataProvider, Identifier } from "ra-core";

import type {
  EntityFile,
  EntityFileVisibility,
  EntityTargetType,
} from "../../types";
import { getSupabaseClient } from "./supabase";

/**
 * Private bucket for `entity_files` objects (contract AC 1). Deliberately a
 * SECOND bucket from `ATTACHMENTS_BUCKET` (`../commons/attachments.ts`):
 * different lifetime owner (a first-class `entity_files` row with its own
 * purge trigger, not a URL written back onto a record) and a different key
 * grammar (four segments here, so a target's objects can be enumerated and
 * removed as a unit — `removeEntityFileObjects` below).
 */
const ENTITY_FILES_BUCKET = "entity-files";

/**
 * Minted per click, never persisted (AC 5). NOT `ATTACHMENT_URL_TTL_SECONDS`
 * (`dataProvider.ts`) — that one is written onto a record and re-read later;
 * this one is consumed immediately after `signEntityFileUrl` returns it.
 */
export const ENTITY_FILE_URL_TTL_SECONDS = 60;

/**
 * The caller's ACTIVE account id, resolved the same way
 * `dataProvider.ts`'s `getCurrentAccountId` does (`current_context_id` RPC,
 * never client state) — duplicated rather than imported to avoid a circular
 * import between this module and `dataProvider.ts` (which imports this
 * module to wire the three methods below into the custom-methods overlay).
 */
async function getCurrentAccountId(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");
  if (error || data == null) {
    throw new Error("Cannot resolve the account for this file upload");
  }
  return data as number;
}

/** Mirrors `dataProvider.ts`'s `uploadToBucket` extension derivation exactly. */
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

export type SignEntityFileUrlParams = {
  storagePath: string;
  fileName: string;
};

export type DeleteEntityFileParams = {
  id: Identifier;
  storagePath: string;
};

/**
 * AC 4's ordering, exactly:
 *   1. Resolve the key — `{account_id}/{target_type}/{target_id}/{uuid}{ext}`,
 *      no user-supplied segment (the original name lives in `file_name`).
 *   2. Upload the bytes.
 *   3. `dataProvider.create("entity_files", {...})` — `account_id` and
 *      `uploaded_by_member_id` are never sent; both are trigger-assigned.
 *   4. If step 3 fails, remove the uploaded object and rethrow. No object
 *      without a row.
 */
export async function uploadEntityFile(
  baseDataProvider: DataProvider,
  params: UploadEntityFileParams,
): Promise<EntityFile> {
  const { targetType, targetId, file, visibility } = params;
  const accountId = await getCurrentAccountId();
  const ext = deriveExtension(file.name);
  const storagePath = `${accountId}/${targetType}/${targetId}/${crypto.randomUUID()}${ext}`;

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .upload(storagePath, file);
  if (uploadError) {
    console.error("uploadEntityFile.upload.error", uploadError);
    throw new Error("Failed to upload the file");
  }

  try {
    const { data } = await baseDataProvider.create<EntityFile>("entity_files", {
      data: {
        target_type: targetType,
        target_id: targetId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        ...(visibility !== undefined ? { visibility } : {}),
      },
    });
    return data;
  } catch (createError) {
    console.error("uploadEntityFile.create.error", createError);
    // No object without a row (AC 4 step 4). Best-effort: a failure here is
    // logged, not thrown — the create error above is the one the caller
    // needs to see, and masking it with a cleanup failure would hide it.
    await getSupabaseClient()
      .storage.from(ENTITY_FILES_BUCKET)
      .remove([storagePath])
      .catch((removeError) => {
        console.error("uploadEntityFile.cleanup.error", removeError);
      });
    throw createError instanceof Error
      ? createError
      : new Error("Failed to save the uploaded file");
  }
}

/**
 * AC 5: a signed, expiring URL minted at click time, never persisted.
 * `download: fileName` restores the original name to the browser without
 * ever putting it in the object key (`file_name` lives on the row, never in
 * `storage_path`).
 */
export async function signEntityFileUrl(
  params: SignEntityFileUrlParams,
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .createSignedUrl(params.storagePath, ENTITY_FILE_URL_TTL_SECONDS, {
      download: params.fileName,
    });
  if (error || !data) {
    console.error("signEntityFileUrl.error", error);
    throw new Error("Failed to sign the file URL");
  }
  return data.signedUrl;
}

/**
 * The reverse of `uploadEntityFile`, and deliberately asymmetric: the ROW
 * deletion is authoritative (it is what every other surface reads), so it
 * runs first; a failure to also remove the storage object is logged, not
 * surfaced as a failed delete. That asymmetry is deliberate — a two-call
 * flow the user could interrupt halfway would be worse.
 */
export async function deleteEntityFile(
  baseDataProvider: DataProvider,
  params: DeleteEntityFileParams,
): Promise<void> {
  await baseDataProvider.delete("entity_files", { id: params.id });

  const { error } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .remove([params.storagePath]);
  if (error) {
    console.error("deleteEntityFile.storage.error", error);
  }
}

/**
 * AC 7(b): byte cleanup at the layer that can actually do it. Called from
 * `dataProvider.ts`'s `beforeDelete` `ResourceCallbacks` for each of the
 * four parent resources, with every `storage_path` the deleted target owned
 * — `purge_polymorphic_dependents()` (02_functions.sql) removes the
 * `entity_files` CATALOG rows; it cannot reach the Storage API, so it never
 * removes bytes. A failure here is logged, not thrown: the parent record
 * delete has already been requested and should not be blocked by a storage
 * cleanup failure (mirrors `deleteEntityFile`'s own asymmetry above).
 */
export async function removeEntityFileObjects(
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await getSupabaseClient()
    .storage.from(ENTITY_FILES_BUCKET)
    .remove(storagePaths);
  if (error) {
    console.error("removeEntityFileObjects.error", error);
  }
}
