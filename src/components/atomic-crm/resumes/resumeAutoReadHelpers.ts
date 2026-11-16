import type { ResumeFileVersion } from "../types";

export const RESUME_AUTO_READ_COPY = {
  reading: "Making it easy to read. Please wait.",
  completed: "Done. The easy-to-read details are ready below.",
  empty: "We could not find details in this resume.",
  failed:
    "Could not make this resume easy to read. The file was saved; you can try again.",
  timeout:
    "This is taking too long. Nothing was changed. Please try again later.",
  provider_busy:
    "The reading service is busy right now. Nothing was changed. Please try again in a few minutes.",
  noAllowance: "No resume reads left this month. The file was saved.",
  notEntitled:
    "AI reading is not switched on for your account yet. The file was saved.",
  staleFile: "This resume changed while it was being read. Please try again.",
  unsupported: "This file type cannot be read automatically.",
} as const;

export type ResumeAutoReadFeedback =
  | "reading"
  | "completed"
  | "empty"
  | "failed"
  | "timeout"
  | "provider_busy"
  | "no_allowance"
  | "not_entitled"
  | "stale_file"
  | "unsupported";

const READABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isAutomaticallyReadableResume(
  file: Pick<ResumeFileVersion, "mime_type">,
): boolean {
  return READABLE_MIME_TYPES.has(file.mime_type.trim().toLowerCase());
}

export function resumeAutoReadFeedbackText(
  feedback: ResumeAutoReadFeedback,
): string {
  switch (feedback) {
    case "reading":
      return RESUME_AUTO_READ_COPY.reading;
    case "completed":
      return RESUME_AUTO_READ_COPY.completed;
    case "empty":
      return RESUME_AUTO_READ_COPY.empty;
    case "failed":
      return RESUME_AUTO_READ_COPY.failed;
    case "timeout":
      return RESUME_AUTO_READ_COPY.timeout;
    case "provider_busy":
      return RESUME_AUTO_READ_COPY.provider_busy;
    case "no_allowance":
      return RESUME_AUTO_READ_COPY.noAllowance;
    case "not_entitled":
      return RESUME_AUTO_READ_COPY.notEntitled;
    case "stale_file":
      return RESUME_AUTO_READ_COPY.staleFile;
    case "unsupported":
      return RESUME_AUTO_READ_COPY.unsupported;
  }
}
