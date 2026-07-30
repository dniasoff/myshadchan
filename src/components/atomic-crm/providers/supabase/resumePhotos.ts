import type { Identifier } from "ra-core";

import type { ResumePhoto, ResumePhotoVisibility } from "../../types";
import { getSupabaseClient } from "./supabase";

/**
 * The same third private bucket `resumes.ts` uses (Story 5.3/5.4) — this
 * story's whole reason it exists: a `photos/` prefix whose policies are
 * written from scratch, so a `single`-role member can be denied a
 * `private_parent` photo at the storage layer itself (AC 4), which a
 * permissive account-wide policy on `attachments`/`entity-files` could
 * never retrofit.
 */
const DOCUMENTS_BUCKET = "documents";

/**
 * Minted per reveal click, never persisted (AC 1/AC 4) — same order of
 * magnitude as `resumes.ts`'s `RESUME_FILE_URL_TTL_SECONDS`.
 */
export const RESUME_PHOTO_URL_TTL_SECONDS = 60;

/**
 * The caller's ACTIVE account id, resolved the same way `resumes.ts`'s own
 * copy does (`current_context_id` RPC, never client state) — duplicated
 * rather than imported to avoid a circular import between this module and
 * `dataProvider.ts` (which imports this module to wire its three methods
 * into the custom-methods overlay).
 */
async function getCurrentAccountId(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");
  if (error || data == null) {
    throw new Error("Cannot resolve the account for this photo upload");
  }
  return data as number;
}

export type UploadResumePhotoParams = {
  shidduchimId: Identifier;
  file: File;
  visibility?: ResumePhotoVisibility;
};

export type SignResumePhotoUrlParams = {
  storagePath: string;
};

export type HideResumePhotoParams = {
  id: Identifier;
};

/**
 * AC 2/AC 4: uploads under the AC-4 key grammar — the visibility is segment
 * 3 of the path itself, `{account}/photos/{visibility}/{shidduchim}/{uuid}-
 * {filename}` — then calls `add_resume_photo()`, which upserts the parent
 * `resumes` row (a shidduch may get its first photo before its first
 * resume file) and inserts the catalog row. Mirrors `uploadResumeFile`'s
 * "no object without a row" ordering: if the RPC rejects, the just-uploaded
 * object is removed before rethrowing.
 */
export async function uploadResumePhoto(
  params: UploadResumePhotoParams,
): Promise<ResumePhoto> {
  const { shidduchimId, file, visibility = "shared" } = params;
  const accountId = await getCurrentAccountId();
  const storagePath = `${accountId}/photos/${visibility}/${shidduchimId}/${crypto.randomUUID()}-${file.name}`;

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(storagePath, file);
  if (uploadError) {
    console.error("uploadResumePhoto.upload.error", uploadError);
    throw new Error("Failed to upload the photo");
  }

  const { data, error } = await getSupabaseClient().rpc("add_resume_photo", {
    p_shidduchim_id: shidduchimId,
    p_path: storagePath,
    p_visibility: visibility,
  });
  if (error) {
    console.error("uploadResumePhoto.add_resume_photo.error", error);
    await getSupabaseClient()
      .storage.from(DOCUMENTS_BUCKET)
      .remove([storagePath])
      .catch((removeError) => {
        console.error("uploadResumePhoto.cleanup.error", removeError);
      });
    throw new Error(error.message || "Failed to upload the photo");
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as ResumePhoto;
}

/**
 * AC 1: a signed, expiring URL minted at reveal-click time, never persisted.
 * Deliberately no `download` option (contrast `signResumeFileUrl`) — a
 * photo is displayed inline behind the reveal affordance, not downloaded.
 */
export async function signResumePhotoUrl(
  params: SignResumePhotoUrlParams,
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(params.storagePath, RESUME_PHOTO_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("signResumePhotoUrl.error", error);
    throw new Error("Failed to sign the photo URL");
  }
  return data.signedUrl;
}

/**
 * AC 2: the sole write path to `hidden_at` — a soft-hide, never a DELETE.
 */
export async function hideResumePhoto(
  params: HideResumePhotoParams,
): Promise<ResumePhoto> {
  const { data, error } = await getSupabaseClient().rpc("hide_resume_photo", {
    p_photo_id: params.id,
  });
  if (error) {
    console.error("hideResumePhoto.error", error);
    throw new Error(error.message || "Failed to hide the photo");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as ResumePhoto;
}
