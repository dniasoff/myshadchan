import type { DataProvider, Identifier } from "ra-core";

import {
  isSingleSubject,
  resumeSubjectFilter,
  type ResumeSubject,
} from "../../../resumes/resumeSubject";
import type {
  InboxAttachment,
  Resume,
  ResumePhoto,
  ResumePhotoVisibility,
} from "../../../types";
import { validateChildPhoto } from "../../../singles/ChildDocuments/childDocuments";
import { resumePhotoStoragePath } from "../../resumePhotoIdempotency";

/**
 * The AD-10 mirror of `providers/supabase/resumePhotos.ts` for demo mode.
 * FakeRest has no real storage bucket, so the "bytes" are an in-memory
 * `Map<storage_path, objectUrl>` — a SEPARATE map from `./resumes.ts`'s own
 * (a different bucket prefix, `photos/`, in the real backend), one per
 * `createDataProvider()` session, so a fresh demo/test session never sees a
 * stale blob from a previous one.
 */
export type ResumePhotoBlobUrls = Map<string, string>;

export type UploadResumePhotoParams = ResumeSubject & {
  file: File;
  visibility?: ResumePhotoVisibility;
  sourceAttachmentPath?: string;
  onlyIfNoVisiblePhoto?: boolean;
};

export type CopyInboxAttachmentToResumePhotoParams = ResumeSubject & {
  attachment: InboxAttachment;
};

export type FindResumePhotoBySourceParams = ResumeSubject & {
  sourceAttachmentPath: string;
  visibility?: ResumePhotoVisibility;
};

const automaticPhotoLocks = new Map<string, Promise<void>>();

async function withAutomaticPhotoLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = automaticPhotoLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  automaticPhotoLocks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (automaticPhotoLocks.get(key) === current) {
      automaticPhotoLocks.delete(key);
    }
  }
}

function ownerSegment(subject: ResumeSubject): string {
  return isSingleSubject(subject)
    ? `single-${subject.singleId}`
    : `${subject.shidduchimId}`;
}

export async function findResumePhotoBySource(
  baseDataProvider: DataProvider,
  accountId: Identifier,
  params: FindResumePhotoBySourceParams,
): Promise<ResumePhoto | null> {
  const path = resumePhotoStoragePath(
    accountId,
    ownerSegment(params),
    params.visibility ?? "shared",
    params.sourceAttachmentPath,
  );
  const { data } = await baseDataProvider.getList<ResumePhoto>(
    "resume_photos",
    {
      filter: { path },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data[0] ?? null;
}

/**
 * FakeRest mirror of `add_resume_photo` (AC 2; widened to a single subject
 * by Story 5.8): finds the subject's existing `resumes` row (unique on
 * `shidduchim_id`/`single_id`, exactly like the real table) or creates it,
 * exactly like `uploadResumeFile`'s own upsert — a subject may get its
 * first photo before its first resume file. Then inserts a fresh
 * `resume_photos` row (never appended to an array — one row per photo,
 * matching the real table's shape).
 */
export async function uploadResumePhoto(
  baseDataProvider: DataProvider,
  blobUrls: ResumePhotoBlobUrls,
  accountId: Identifier,
  params: UploadResumePhotoParams,
): Promise<ResumePhoto> {
  const {
    file,
    visibility = "shared",
    sourceAttachmentPath,
    onlyIfNoVisiblePhoto = false,
    ...subject
  } = params;
  const upload = async (): Promise<ResumePhoto> => {
    if (isSingleSubject(subject)) {
      const { data: targets } = await baseDataProvider.getList<{
        id: Identifier;
        account_id: Identifier;
      }>("singles", {
        filter: { id: subject.singleId },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      if (!targets[0] || String(targets[0].account_id) !== String(accountId)) {
        throw new Error("single photo target is missing");
      }
    }
    const validationError = validateChildPhoto(file);
    if (validationError) throw new Error(validationError);
    const storagePath = resumePhotoStoragePath(
      accountId,
      ownerSegment(subject),
      visibility,
      sourceAttachmentPath,
      file.name,
    );
    if (sourceAttachmentPath) {
      const existing = await findResumePhotoBySource(
        baseDataProvider,
        accountId,
        {
          ...subject,
          sourceAttachmentPath,
          visibility,
        },
      );
      if (existing) return existing;
    }

    const { data: matches } = await baseDataProvider.getList<Resume>(
      "resumes",
      {
        filter: resumeSubjectFilter(subject),
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      },
    );
    let resumeId = matches[0]?.id;

    if (onlyIfNoVisiblePhoto && resumeId != null) {
      const { data: photos } = await baseDataProvider.getList<ResumePhoto>(
        "resume_photos",
        {
          filter: { resume_id: resumeId, "hidden_at@is": null },
          pagination: { page: 1, perPage: 1 },
          sort: { field: "uploaded_at", order: "ASC" },
        },
      );
      if (photos[0]) return photos[0];
    }

    blobUrls.set(storagePath, URL.createObjectURL(file));

    if (resumeId == null) {
      const { data: resume } = await baseDataProvider.create<Resume>(
        "resumes",
        {
          data: {
            account_id: accountId,
            ...resumeSubjectFilter(subject),
            created_at: new Date().toISOString(),
          },
        },
      );
      resumeId = resume.id;
    }

    const { data } = await baseDataProvider.create<ResumePhoto>(
      "resume_photos",
      {
        data: {
          account_id: accountId,
          resume_id: resumeId,
          path: storagePath,
          uploaded_at: new Date().toISOString(),
          visibility,
          hidden_at: null,
        },
      },
    );
    return data;
  };

  if (!onlyIfNoVisiblePhoto) return upload();
  return withAutomaticPhotoLock(
    `${accountId}:${ownerSegment(subject)}`,
    upload,
  );
}

/** FakeRest mirror of the Supabase Inbox-to-Photo copy. The inbox blob map is
 * the durable source in demo mode, so an expired persisted `src` does not
 * prevent the automatic promotion. */
export async function copyInboxAttachmentToResumePhoto(
  baseDataProvider: DataProvider,
  inboxBlobUrls: Map<string, string>,
  photoBlobUrls: ResumePhotoBlobUrls,
  accountId: Identifier,
  params: CopyInboxAttachmentToResumePhotoParams,
): Promise<ResumePhoto> {
  const sourceUrl =
    inboxBlobUrls.get(params.attachment.path) ?? params.attachment.src;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("Failed to read the captured picture");
  }
  const blob = await response.blob();
  const file = new File([blob], params.attachment.title, {
    type: params.attachment.type || blob.type || "application/octet-stream",
  });
  const { attachment: _attachment, ...subject } = params;
  return uploadResumePhoto(baseDataProvider, photoBlobUrls, accountId, {
    ...subject,
    file,
    visibility: "shared",
    sourceAttachmentPath: params.attachment.path,
    onlyIfNoVisiblePhoto: true,
  });
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

export async function restoreResumePhoto(
  baseDataProvider: DataProvider,
  params: { id: Identifier },
): Promise<ResumePhoto> {
  const { data: photo } = await baseDataProvider.getOne<ResumePhoto>(
    "resume_photos",
    { id: params.id },
  );
  const { data } = await baseDataProvider.update<ResumePhoto>("resume_photos", {
    id: params.id,
    data: { hidden_at: null },
    previousData: photo,
  });
  return data;
}
