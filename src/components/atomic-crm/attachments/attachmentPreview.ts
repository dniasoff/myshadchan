/**
 * What, if anything, may be rendered inside the page for a stored file.
 *
 * This is a security boundary, not a convenience lookup, so it is an
 * allow-list and it lives on its own with its own tests. `mime_type` is
 * whatever the browser reported at upload time and is written to the row
 * verbatim (`uploadEntityFile`, `add_resume_file`) — a member of the account
 * can therefore choose it. Two types are actively dangerous to render:
 *
 * - `text/html` executes whatever script it contains.
 * - `image/svg+xml` is a document, not a bitmap: an `<svg>` can carry
 *   `<script>`, and an `<img>` tag is not the containment it looks like once
 *   the source is a document format.
 *
 * Supabase serves these bytes from its own storage origin rather than the
 * app's, so the blast radius of a mistake here is smaller than it would be
 * for same-origin content. That is a mitigation, not the control — an
 * allow-list of exactly what is known-safe is the control, and anything
 * absent from it (including anything added to the product later) falls
 * through to a download link rather than to a guess.
 *
 * `docx` is a third mode with a different containment story: it is never
 * handed to the browser as a document at all. It is converted to HTML in this
 * tab and sanitised against a narrow tag allow-list before it reaches the DOM
 * — see `DocxPreview.tsx`. `.doc`, the pre-2007 binary format, stays absent.
 */
export type AttachmentPreviewMode = "pdf" | "image" | "docx" | "none";

/** The one document type browsers render natively and safely in a frame. */
const PDF_MIME_TYPES: ReadonlySet<string> = new Set(["application/pdf"]);

/**
 * Word documents, rendered by converting them to sanitised HTML inside this
 * tab (`DocxPreview.tsx`) — never by handing a signed URL to Google Docs
 * Viewer or Office Online, which is the usual approach and would send a
 * family's resume to a third party on every open.
 *
 * `.doc` (the pre-2007 binary format) is deliberately absent: `mammoth` reads
 * the OOXML `.docx` package only, and admitting `.doc` here would render an
 * empty document rather than an honest "download this one".
 */
const DOCX_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Raster formats only. Every entry here is decoded by the image pipeline and
 * cannot express script; `image/svg+xml` is deliberately absent — see above.
 */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/heic",
  "image/heif",
]);

/**
 * A last-resort mapping for rows whose `mime_type` is missing or was stored
 * as `application/octet-stream` — which is what `uploadEntityFile` writes
 * whenever the browser could not identify the file, and it is common enough
 * for `.pdf` on some platforms that ignoring it would leave real resumes
 * unpreviewable. Extensions are consulted ONLY when the mime type says
 * nothing; a mime type that IS present and is not on an allow-list is
 * respected as a refusal, never overridden by a hopeful-looking extension.
 */
const EXTENSION_MODES: Readonly<Record<string, AttachmentPreviewMode>> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  heic: "image",
  heif: "image",
  docx: "docx",
};

/** Mime types that carry no information — treat as "unknown", not as a type. */
const UNINFORMATIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

function normalizeMimeType(mimeType: string | null | undefined): string {
  // Strip any parameters (`text/html; charset=utf-8`) before comparing, so a
  // parameterised type can never slip past the allow-list.
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

function extensionOf(fileName: string | null | undefined): string {
  const parts = (fileName ?? "").split(".");
  return parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : "";
}

/**
 * Resolves how a file may be shown. `"none"` is the default for everything
 * not explicitly allowed, so a type the product gains later gets an honest
 * download link rather than a guess.
 */
export function resolveAttachmentPreviewMode(
  mimeType: string | null | undefined,
  fileName?: string | null,
): AttachmentPreviewMode {
  const normalized = normalizeMimeType(mimeType);

  if (PDF_MIME_TYPES.has(normalized)) return "pdf";
  if (IMAGE_MIME_TYPES.has(normalized)) return "image";
  if (DOCX_MIME_TYPES.has(normalized)) return "docx";

  if (UNINFORMATIVE_MIME_TYPES.has(normalized)) {
    return EXTENSION_MODES[extensionOf(fileName)] ?? "none";
  }

  return "none";
}

/** Convenience for the call sites that only need "is there anything to show". */
export function isAttachmentPreviewable(
  mimeType: string | null | undefined,
  fileName?: string | null,
): boolean {
  return resolveAttachmentPreviewMode(mimeType, fileName) !== "none";
}
