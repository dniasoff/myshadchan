import { z } from "zod";

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  splitStoragePath,
  validateAttachmentMagic,
} from "./inboxAttachment";

const ResumeFileSchema = z.object({
  path: z.string(),
  filename: z.string(),
  uploaded_at: z.string(),
  mime_type: z.string(),
  size: z.number().int().nonnegative(),
});

const ResumeRowSchema = z.object({
  id: z.number(),
  account_id: z.number(),
  shidduchim_id: z.number().nullable().optional(),
  single_id: z.number().nullable().optional(),
  files: z.array(ResumeFileSchema).nullable(),
  sections: z.unknown().nullable(),
});

export type RereadResumeRow = z.infer<typeof ResumeRowSchema>;
export type RereadResumeFile = z.infer<typeof ResumeFileSchema>;

export function readRereadResumeRow(value: unknown): RereadResumeRow | null {
  const parsed = ResumeRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function safeStoragePath(
  path: string,
  accountId: number,
  ownerSegment: string,
): boolean {
  const parts = path.split("/");
  if (parts.length !== 4) return false;
  if (parts[0] !== String(accountId) || parts[1] !== "resumes") return false;
  if (parts[2] !== ownerSegment || parts[3].length === 0) return false;
  if (
    [...path].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f || character === "\\";
    })
  ) {
    return false;
  }
  if (parts.some((part) => part === "." || part === "..")) return false;
  return true;
}

export function selectRereadFile(
  resume: RereadResumeRow,
  accountId: number,
): { file: RereadResumeFile; dirPath: string; fileName: string } | null {
  const ownerSegment =
    resume.shidduchim_id != null && resume.single_id == null
      ? String(resume.shidduchim_id)
      : resume.single_id != null && resume.shidduchim_id == null
        ? `single-${resume.single_id}`
        : null;
  if (!ownerSegment || !resume.files || resume.files.length === 0) return null;

  const newest = [...resume.files].sort((left, right) => {
    const rightTime = Date.parse(right.uploaded_at);
    const leftTime = Date.parse(left.uploaded_at);
    return rightTime - leftTime;
  })[0];
  if (
    !newest ||
    !(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
      newest.mime_type,
    )
  ) {
    return null;
  }
  if (newest.size > MAX_ATTACHMENT_BYTES) return null;
  if (!safeStoragePath(newest.path, accountId, ownerSegment)) return null;

  const { dirPath, fileName } = splitStoragePath(newest.path);
  if (fileName !== newest.path.split("/").at(-1)) return null;
  return { file: newest, dirPath, fileName };
}

export function validateDownloadedRereadFile(
  bytes: ArrayBuffer,
  claimedMimeType: string,
): boolean {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return false;
  return validateAttachmentMagic(bytes, claimedMimeType) === "ok";
}

export { MAX_ATTACHMENT_BYTES };
