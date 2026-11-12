/**
 * The manual suggestion flow accepts the same resume formats Ronit receives
 * over email and messaging. The parse Worker intentionally supports only the
 * formats Gemini can read today; Word remains attach-only until that allowlist
 * grows.
 */
export const MAX_RESUME_UPLOAD_BYTES = 8 * 1024 * 1024;

export const RESUME_UPLOAD_ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".webp",
].join(",");

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

const ATTACHABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

const AUTO_FILL_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function resumeMimeType(file: Pick<File, "name" | "type">): string {
  const extensionMime = MIME_BY_EXTENSION[extensionOf(file.name)];
  return !file.type || file.type === "application/octet-stream"
    ? extensionMime || file.type
    : file.type;
}

export function isAutoFillResumeMimeType(mimeType: string): boolean {
  return AUTO_FILL_MIME_TYPES.has(mimeType);
}

export function validateResumeUpload(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  if (file.size === 0) {
    return "That file is empty. Please choose a resume with some content.";
  }

  if (file.size > MAX_RESUME_UPLOAD_BYTES) {
    return "That file is too large. Resumes must be 8 MB or smaller.";
  }

  const mimeType = resumeMimeType(file);
  if (!ATTACHABLE_MIME_TYPES.has(mimeType)) {
    return "Please choose a PDF, Word document, JPG, PNG, HEIC, HEIF, or WebP file.";
  }

  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

/** Keep worker, entitlement, quota, and network details out of the form. */
export function friendlyResumeReadError(error: unknown): string {
  const message = errorText(error);
  if (/monthly|quota|limit reached|too many/.test(message)) {
    return "You’ve reached your monthly resume-reading limit. Your file is still attached.";
  }
  if (/failed to fetch|network|offline|timeout|connection/.test(message)) {
    return "We couldn’t reach the resume reader. Check your connection and try again. Your file is still attached.";
  }
  if (
    /not authenticated|unauthorized|forbidden|entitlement|plan/.test(message)
  ) {
    return "Resume reading isn’t available right now, but your file is still attached.";
  }
  if (
    /429|rate limit|temporarily unavailable|service unavailable|\b(?:status|status_code|code)\s*[:=]?\s*5\d{2}\b/.test(
      message,
    )
  ) {
    return "The resume reader is busy. Please try again shortly. Your file is still attached.";
  }
  return "We couldn’t read that resume, but your file is still attached.";
}

export function friendlyResumeUploadError(): string {
  return "We couldn’t attach that resume. Please try again.";
}

export function friendlySuggestionSubmitError(error: unknown): string {
  const message = errorText(error);
  if (/another resolution is already in progress/.test(message)) {
    return "This suggestion was already started. Please save again without changing it, or open it from the list.";
  }
  return "We couldn’t add that suggestion. Please try again.";
}
