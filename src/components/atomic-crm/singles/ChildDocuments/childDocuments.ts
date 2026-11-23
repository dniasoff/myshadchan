export const MAX_CHILD_DOCUMENTS = 4;
export const MAX_CHILD_PAPERS = 2;
export const CHILD_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const CHILD_DOCUMENT_MAX_SIZE_LABEL = "8 MiB";
export const CHILD_DOCUMENT_ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf",
  ".doc",
  ".docx",
  "image/jpeg",
  "image/png",
  ".jpg",
  ".jpeg",
  ".png",
].join(",");

export type ChildPaperSlot = "paper_1" | "paper_2";

const CHILD_DOCUMENT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;
const CHILD_DOCUMENT_MIME_TYPES = new Set<string>(
  Object.values(CHILD_DOCUMENT_TYPES),
);

function extensionOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function validateChildDocument(file: File): string | null {
  if (file.size < 1 || file.size > CHILD_DOCUMENT_MAX_BYTES) {
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  }
  const extension = extensionOf(file.name);
  const expectedType =
    CHILD_DOCUMENT_TYPES[extension as keyof typeof CHILD_DOCUMENT_TYPES];
  if (!expectedType || !CHILD_DOCUMENT_MIME_TYPES.has(file.type)) {
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  }
  if (file.type !== expectedType) {
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  }
  return null;
}

export function validateChildPhoto(file: File): string | null {
  const typeError = validateChildPhotoType(file);
  if (typeError) return typeError;
  if (file.size > CHILD_DOCUMENT_MAX_BYTES)
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  return null;
}

/** Validate a picture before the size choice is shown. */
export function validateChildPhotoType(file: File): string | null {
  if (file.size < 1) {
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  }
  const extension = extensionOf(file.name);
  const expectedType =
    extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : null;
  if (!expectedType || file.type !== expectedType) {
    return "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.";
  }
  return null;
}

export function fileExtension(fileName: string): string {
  const extension = fileName.split(".").pop();
  return extension ? extension.toUpperCase() : "FILE";
}
