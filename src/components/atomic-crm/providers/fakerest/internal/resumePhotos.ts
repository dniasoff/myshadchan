import type { DataProvider, Identifier } from "ra-core";

import type {
  Resume,
  ResumePhoto,
  ResumePhotoVisibility,
} from "../../../types";

/**
 * The AD-10 mirror of `providers/supabase/resumePhotos.ts` for demo mode.
 * FakeRest has no real storage bucket, so the "bytes" are an in-memory
 * `Map<storage_path, objectUrl>` — a SEPARATE map from `./resumes.ts`'s own
 * (a different bucket prefix, `photos/`, in the real backend), one per
 * `createDataProvider()` session, so a fresh demo/test session never sees a
 * stale blob from a previous one.
 */
export type ResumePhotoBlobUrls = Map<string, string>;

export type UploadResumePhotoParams = {
  shidduchimId: Identifier;
  file: File;
  visibility?: ResumePhotoVisibility;
};

/**
 * FakeRest mirror of `add_resume_photo` (AC 2): finds the shidduch's
 * existing `resumes` row (unique on `shidduchim_id`, exactly like the real
 * table) or creates it, exactly like `uploadResumeFile`'s own upsert — a
 * shidduch may get its first photo before its first resume file. Then
 * inserts a fresh `resume_photos` row (never appended to an array — one row
 * per photo, matching the real table's shape).
 */
export async function uploadResumePhoto(
  baseDataProvider: DataProvider,
  blobUrls: ResumePhotoBlobUrls,
  accountId: Identifier,
  params: UploadResumePhotoParams,
): Promise<ResumePhoto> {
  const { shidduchimId, file, visibility = "shared" } = params;
  const storagePath = `${accountId}/photos/${visibility}/${shidduchimId}/${crypto.randomUUID()}-${file.name}`;
  blobUrls.set(storagePath, URL.createObjectURL(file));

  const { data: matches } = await baseDataProvider.getList<Resume>("resumes", {
    filter: { shidduchim_id: shidduchimId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  let resumeId = matches[0]?.id;

  if (resumeId == null) {
    const { data: resume } = await baseDataProvider.create<Resume>("resumes", {
      data: {
        account_id: accountId,
        shidduchim_id: shidduchimId,
        created_at: new Date().toISOString(),
      },
    });
    resumeId = resume.id;
  }

  const { data } = await baseDataProvider.create<ResumePhoto>("resume_photos", {
    data: {
      account_id: accountId,
      resume_id: resumeId,
      path: storagePath,
      uploaded_at: new Date().toISOString(),
      visibility,
      hidden_at: null,
    },
  });
  return data;
}

/** FakeRest mirror of `signResumePhotoUrl` — returns the same object URL on
 * every call for a given `storagePath`. */
export async function signResumePhotoUrl(
  blobUrls: ResumePhotoBlobUrls,
  storagePath: string,
): Promise<string> {
  const url = blobUrls.get(storagePath);
  if (!url) {
    throw new Error("Failed to sign the photo URL");
  }
  return url;
}

/**
 * FakeRest mirror of `hide_resume_photo` (AC 2): sets `hidden_at`, never
 * deletes the row — matches the real function's soft-hide contract exactly.
 */
export async function hideResumePhoto(
  baseDataProvider: DataProvider,
  params: { id: Identifier },
): Promise<ResumePhoto> {
  const { data: photo } = await baseDataProvider.getOne<ResumePhoto>(
    "resume_photos",
    { id: params.id },
  );

  const { data } = await baseDataProvider.update<ResumePhoto>("resume_photos", {
    id: params.id,
    data: { hidden_at: new Date().toISOString() },
    previousData: photo,
  });
  return data;
}
