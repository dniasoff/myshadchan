/**
 * Bounded DOCX text extraction for the parse Worker.
 *
 * A DOCX is a ZIP archive. Mammoth does the OOXML interpretation, but it must
 * not see an archive whose declared expansion is unbounded or whose entry
 * count can create an unreasonable amount of parser work. The central
 * directory is inspected first, without decompressing any entry.
 */

export const MAX_DOCX_EXTRACTED_TEXT_BYTES = 256 * 1024;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_DOCX_ZIP_ENTRIES = 256;

export type DocxExtractionFailure =
  "empty" | "password_protected" | "malformed" | "too_large";

export class DocxExtractionError extends Error {
  constructor(public readonly failure: DocxExtractionFailure) {
    super("DOCX extraction failed");
    this.name = "DocxExtractionError";
  }
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

function malformed(): never {
  throw new DocxExtractionError("malformed");
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    return malformed();
  }
  return view.getUint32(offset, true);
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    return malformed();
  }
  return view.getUint16(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(
    0,
    bytes.byteLength -
      END_OF_CENTRAL_DIRECTORY_MIN_BYTES -
      MAX_ZIP_COMMENT_BYTES,
  );
  for (
    let offset = bytes.byteLength - END_OF_CENTRAL_DIRECTORY_MIN_BYTES;
    offset >= start;
    offset -= 1
  ) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

/**
 * Validate the ZIP central directory without reading or inflating entry data.
 * ZIP64 and encrypted entries fail closed because their expansion metadata is
 * not safely representable by the bounded 32-bit checks below.
 */
export function inspectDocxZip(bytes: ArrayBuffer): void {
  const data = new Uint8Array(bytes);
  if (data.byteLength < END_OF_CENTRAL_DIRECTORY_MIN_BYTES) {
    malformed();
  }

  const endOffset = findEndOfCentralDirectory(data);
  if (endOffset < 0) {
    malformed();
  }

  const view = new DataView(bytes);
  const entryCount = readUint16(view, endOffset + 10);
  const centralDirectorySize = readUint32(view, endOffset + 12);
  const centralDirectoryOffset = readUint32(view, endOffset + 16);
  const commentLength = readUint16(view, endOffset + 20);

  // A ZIP64 sentinel means these values are not trustworthy in the classic
  // EOCD. Reject instead of attempting an unbounded ZIP64 interpretation.
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new DocxExtractionError("too_large");
  }
  if (
    endOffset + END_OF_CENTRAL_DIRECTORY_MIN_BYTES + commentLength >
    data.byteLength
  ) {
    malformed();
  }
  if (entryCount === 0 || entryCount > MAX_DOCX_ZIP_ENTRIES) {
    throw new DocxExtractionError("too_large");
  }
  if (
    centralDirectoryOffset > data.byteLength ||
    centralDirectorySize > data.byteLength - centralDirectoryOffset
  ) {
    malformed();
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > centralDirectoryEnd ||
      readUint32(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      malformed();
    }

    const flags = readUint16(view, cursor + 8);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const entryCommentLength = readUint16(view, cursor + 32);
    if (flags & 0x0001) {
      throw new DocxExtractionError("password_protected");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new DocxExtractionError("too_large");
    }

    const recordLength = 46 + fileNameLength + extraLength + entryCommentLength;
    if (recordLength > centralDirectoryEnd - cursor) {
      malformed();
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new DocxExtractionError("too_large");
    }
    cursor += recordLength;
  }
}

/** Extract only bounded prose from a modern Word document. */
export async function extractDocxText(fileBytes: ArrayBuffer): Promise<string> {
  try {
    inspectDocxZip(fileBytes);
    const mammoth = await import("mammoth");
    // The browser entry selected by Wrangler reads `arrayBuffer`, while the
    // Node entry selected by Vitest reads `buffer`; providing both keeps the
    // same production call testable without importing Mammoth's internals.
    const result = await mammoth.extractRawText({
      arrayBuffer: fileBytes,
      buffer: fileBytes as never,
    });
    const text = result.value.split(String.fromCharCode(0)).join("").trim();
    if (text.length === 0) {
      throw new DocxExtractionError("empty");
    }
    if (
      new TextEncoder().encode(text).byteLength > MAX_DOCX_EXTRACTED_TEXT_BYTES
    ) {
      throw new DocxExtractionError("too_large");
    }
    return text;
  } catch (error) {
    if (error instanceof DocxExtractionError) {
      throw error;
    }
    // Mammoth's parser errors are intentionally not exposed or logged; they
    // may include package details. The caller receives one fixed damaged-file
    // message and the safe-log boundary records only the error class.
    throw new DocxExtractionError("malformed");
  }
}
