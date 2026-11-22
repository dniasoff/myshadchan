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

export function validateChildDocument(file: File): string | null {
  if (file.size > CHILD_DOCUMENT_MAX_BYTES) {
    return `Each file must be ${CHILD_DOCUMENT_MAX_SIZE_LABEL} or smaller.`;
  }
  const extension = file.name.toLowerCase().split(".").pop();
  const acceptedExtensions = new Set([
    "pdf",
    "doc",
    "docx",
    "jpg",
    "jpeg",
    "png",
  ]);
  const acceptedTypes = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
  ]);
  if (
    !acceptedTypes.has(file.type) &&
    !acceptedExtensions.has(extension ?? "")
  ) {
    return "Choose a PDF, Word, JPEG, or PNG file.";
  }
  return null;
}

export function fileExtension(fileName: string): string {
  const extension = fileName.split(".").pop();
  return extension ? extension.toUpperCase() : "FILE";
}
