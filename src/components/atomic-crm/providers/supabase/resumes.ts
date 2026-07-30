import {
  isSingleSubject,
  type ResumeSubject,
} from "../../resumes/resumeSubject";
import type { Resume } from "../../types";
import { getSupabaseClient } from "./supabase";

/**
 * A third private bucket, separate from `ATTACHMENTS_BUCKET` and
 * `entity-files` (Story 5.3, contract re-ratified in the story's own "Why a
 * new `documents` bucket" section): a resume needs a `{account}/resumes/…`
 * key grammar `uploadToBucket()`'s two-segment shape cannot express, and
 * Story 5.4's photo visibility rules need a bucket whose every policy is
 * written from scratch — a permissive account-wide SELECT policy on either
 * existing bucket can only ever ADD access, never narrow it back down.
 */
const DOCUMENTS_BUCKET = "documents";

/**
 * Minted per click, never persisted (AC 5) — same order of magnitude as
 * `entityFiles.ts`'s `ENTITY_FILE_URL_TTL_SECONDS`, NOT
 * `ATTACHMENT_URL_TTL_SECONDS` (`dataProvider.ts`, one hour): that one is
 * written onto a record and re-read later, this one is consumed
 * immediately after `signResumeFileUrl` returns it.
 */
export const RESUME_FILE_URL_TTL_SECONDS = 60;

/**
 * The caller's ACTIVE account id, resolved the same way `dataProvider.ts`'s
 * `getCurrentAccountId` and `entityFiles.ts`'s own copy do
 * (`current_context_id` RPC, never client state) — duplicated rather than
 * imported to avoid a circular import between this module and
 * `dataProvider.ts` (which imports this module to wire the two methods
 * below into the custom-methods overlay), exactly like `entityFiles.ts`.
 */
async function getCurrentAccountId(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");
  if (error || data == null) {
    throw new Error("Cannot resolve the account for this resume upload");
  }
  return data as number;
}

export type UploadResumeFileParams = ResumeSubject & {
  file: File;
};

export type SignResumeFileUrlParams = {
  storagePath: string;
  fileName: string;
};

/**
 * AC 1/2/4/5: uploads the file under the AC-4 key grammar, then calls
 * `add_resume_file()` — the server-side append that keeps two concurrent
 * uploads from racing (see that function's own comment). Mirrors
 * `uploadEntityFile`'s "no object without a row" ordering: if the RPC
 * rejects, the just-uploaded object is removed before rethrowing.
 *
 * Story 5.8 widens the subject to a single alongside a shidduch: a single's
 * segment is `single-{id}` — distinct from a shidduch's bare `{id}` — so the
 * two id spaces can never collide in a storage path; storage RLS itself
 * only ever inspects segments [1] (account) and [2] (`resumes`), so this is
 * a naming choice, not a policy requirement.
 */
export async function uploadResumeFile(
  params: UploadResumeFileParams,
): Promise<Resume> {
  const { file, ...subject } = params;
  const accountId = await getCurrentAccountId();
  const ownerSegment = isSingleSubject(subject)
    ? `single-${subject.singleId}`
    : `${subject.shidduchimId}`;
  const storagePath = `${accountId}/resumes/${ownerSegment}/${crypto.randomUUID()}-${file.name}`;

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(storagePath, file);
  if (uploadError) {
    console.error("uploadResumeFile.upload.error", uploadError);
    throw new Error("Failed to upload the resume");
  }

  const { data, error } = await getSupabaseClient().rpc("add_resume_file", {
    p_path: storagePath,
    p_filename: file.name,
    p_mime_type: file.type || "application/octet-stream",
    p_size: file.size,
    p_shidduchim_id: isSingleSubject(subject)
      ? undefined
      : subject.shidduchimId,
    p_single_id: isSingleSubject(subject) ? subject.singleId : undefined,
  });
  if (error) {
    console.error("uploadResumeFile.add_resume_file.error", error);
    await getSupabaseClient()
      .storage.from(DOCUMENTS_BUCKET)
      .remove([storagePath])
      .catch((removeError) => {
        console.error("uploadResumeFile.cleanup.error", removeError);
      });
    throw new Error(error.message || "Failed to upload the resume");
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as Resume;
}

/**
 * AC 5: a signed, expiring URL minted at click time, never persisted.
 * `download: fileName` restores the original name to the browser without
 * putting it in the object key — mirrors `signEntityFileUrl`.
 */
export async function signResumeFileUrl(
  params: SignResumeFileUrlParams,
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(params.storagePath, RESUME_FILE_URL_TTL_SECONDS, {
      download: params.fileName,
    });
  if (error || !data) {
    console.error("signResumeFileUrl.error", error);
    throw new Error("Failed to sign the file URL");
  }
  return data.signedUrl;
}
