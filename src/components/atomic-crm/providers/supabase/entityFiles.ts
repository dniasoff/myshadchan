import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import { RESOURCE_FOR_TARGET } from "../../reminders/reminderEntity";
import {
  ENTITY_TARGET_TYPES,
  type EntityFile,
  type EntityFileVisibility,
  type EntityTargetType,
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
 * Longer than the download TTL. The original reason — that a browser's PDF
 * viewer range-requests the file lazily as the reader scrolls, so a URL can
 * expire under a document already on screen — no longer applies: PDFs are now
 * parsed by `attachments/PdfPreview`, which fetches the whole file once and
 * never touches the URL again. Two reasons remain, and they are enough:
 *
 * - An hour matches the window an EMBEDDED viewer actually needs.
 *   `resumes/ResumeDocument` puts the resume in the page, so its lifetime is
 *   however long someone leaves the Resume tab open — not how long they keep
 *   a modal up. Ten minutes was sized for open-read-close and would fail a
 *   tab left open over a phone call.
 * - It matches `dataProvider.ts`'s `ATTACHMENT_URL_TTL_SECONDS`, so there is
 *   one viewing window in the product rather than three.
 *
 * The URL is still minted per mount and still never persisted, so the privacy
 * posture is unchanged either way.
 */
export const ENTITY_FILE_VIEW_TTL_SECONDS = 3600;

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
  /**
   * Serve the bytes for viewing in the page instead of saving them to disk.
   * `download` is what sets `Content-Disposition: attachment` on the signed
   * URL, so omitting it is the whole difference between a preview and a
   * download — there is no separate "preview" API.
   */
  inline?: boolean;
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
    .createSignedUrl(
      params.storagePath,
      params.inline
        ? ENTITY_FILE_VIEW_TTL_SECONDS
        : ENTITY_FILE_URL_TTL_SECONDS,
      params.inline ? undefined : { download: params.fileName },
    );
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

/**
 * AC 7(b), built here (not inline in `dataProvider.ts`) so it is unit
 * testable independent of the whole custom-methods overlay (review fix,
 * F5): one `beforeDelete` `ResourceCallbacks` entry per
 * `ENTITY_TARGET_TYPES` member, mapped onto its owning resource via
 * `RESOURCE_FOR_TARGET`. `dataProvider.ts` splices the returned array
 * straight into `lifeCycleCallbacks` — this is the exact code that runs in
 * production, not a re-implementation the test exercises in parallel.
 *
 * `dataProvider` here is the WRAPPED provider `withLifecycleCallbacks`
 * passes to every callback at call time (so `getList("entity_files", ...)`
 * itself still goes through the custom-methods overlay) — never the
 * `baseDataProvider` closed over elsewhere in this module.
 */
export function buildEntityFilesCleanupCallbacks(): ResourceCallbacks[] {
  return ENTITY_TARGET_TYPES.map((targetType) => ({
    resource: RESOURCE_FOR_TARGET[targetType],
    beforeDelete: async (params, dataProvider) => {
      const { data } = await dataProvider.getList<EntityFile>("entity_files", {
        filter: { target_type: targetType, target_id: params.id },
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      });
      await removeEntityFileObjects(data.map((file) => file.storage_path));
      return params;
    },
  }));
}
