/**
 * The manual suggestion flow accepts the same resume formats Ronit receives
 * over email and messaging. The parse Worker intentionally supports only the
 * formats the parse Worker can read today. Legacy Word remains attach-only;
 * modern .docx is extracted server-side before it reaches the model.
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
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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

export function friendlyResumeMimeType(mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "Word document (.docx)";
    case "application/msword":
      return "Word document (.doc)";
    case "application/pdf":
      return "PDF";
    case "image/jpeg":
      return "Photo (JPG)";
    case "image/png":
      return "Photo (PNG)";
    case "image/heic":
    case "image/heif":
      return "Photo (HEIC)";
    case "image/webp":
      return "Photo (WebP)";
    default:
      return "File";
  }
}

export function validateResumeUpload(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  if (file.size === 0) {
    return "This file is empty. Choose a resume with some content.";
  }

  if (file.size > MAX_RESUME_UPLOAD_BYTES) {
    return "This file is too large. Choose a file up to 8 MB.";
  }

  const mimeType = resumeMimeType(file);
  if (!ATTACHABLE_MIME_TYPES.has(mimeType)) {
    return "This file type is not supported here. Choose a .docx, PDF, JPG, PNG, HEIC or WebP file.";
  }

  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

/** Keep worker, entitlement, quota, and network details out of the form. */
export function friendlyResumeReadError(error: unknown): string {
  const message = errorText(error);
  if (/resume appears empty/.test(message)) {
    return "This Word file appears to be empty. You can enter the details yourself or upload a different file.";
  }
  if (/password-protected/.test(message)) {
    return "This Word file is password-protected, so we can’t read it. Remove the password or save it as a PDF, then try again. You can still enter the details yourself.";
  }
  if (/could not open resume/.test(message)) {
    return "We couldn’t open this Word file. It may be damaged. Try saving it again as .docx or PDF. You can still enter the details yourself.";
  }
  if (/resume too long/.test(message)) {
    return "This resume is too long for auto-fill here. It is still attached, and you can enter the details yourself.";
  }
  if (/not entitled|auto-fill isn.t available|no entitlement/.test(message)) {
    return "Auto-fill isn’t available on this account right now. Your file is still attached; you can enter the details yourself.";
  }
  return "We couldn’t read the resume right now. Your file is still attached, and you can enter the details yourself.";
}

export function resumeReadSuccessMessage(
  fields: Record<string, unknown>,
): string {
  const values = Object.values(fields);
  const hasAnyField = values.some(
    (value) => value !== null && value !== undefined && value !== "",
  );
  if (!hasAnyField) {
    return "We couldn’t read the resume right now. Your file is still attached, and you can enter the details yourself.";
  }
  const hasMissingField = values.some(
    (value) => value === null || value === undefined || value === "",
  );
  return hasMissingField
    ? "We found a few details, but not everything. Please check the filled fields and add anything missing."
    : "We found some details. Please review them before saving.";
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
