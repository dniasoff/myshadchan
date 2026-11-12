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
export const DOCX_EXTRACTION_TIMEOUT_MS = 10_000;

const MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;

export type DocxExtractionFailure =
  "empty" | "password_protected" | "malformed" | "too_large";

export class DocxExtractionError extends Error {
  constructor(public readonly failure: DocxExtractionFailure) {
    super("DOCX extraction failed");
    this.name = "DocxExtractionError";
  }
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const DEFLATE_METHOD = 8;
const STORED_METHOD = 0;
const XML_FORBIDDEN_MARKERS = ["<!doctype", "<!entity"] as const;

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
  dataEnd: number;
};

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

function bytesKey(bytes: Uint8Array): string {
  let key = "";
  for (const byte of bytes) key += byte.toString(16).padStart(2, "0");
  return key;
}

function sameBytes(
  left: Uint8Array,
  leftOffset: number,
  right: Uint8Array,
  rightOffset: number,
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (left[leftOffset + index] !== right[rightOffset + index]) return false;
  }
  return true;
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
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

function readZipEntries(bytes: ArrayBuffer): ZipEntry[] {
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
  if (centralDirectoryEnd > endOffset) {
    malformed();
  }
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
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
    const compressionMethod = readUint16(view, cursor + 10);
    const localHeaderOffset = readUint32(view, cursor + 42);
    if (flags & 0x0001) {
      throw new DocxExtractionError("password_protected");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new DocxExtractionError("too_large");
    }
    if (uncompressedSize > MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new DocxExtractionError("too_large");
    }

    const recordLength = 46 + fileNameLength + extraLength + entryCommentLength;
    if (recordLength > centralDirectoryEnd - cursor) {
      malformed();
    }
    const nameBytes = data.slice(cursor + 46, cursor + 46 + fileNameLength);
    const nameKey = bytesKey(nameBytes);
    if (names.has(nameKey)) {
      malformed();
    }
    names.add(nameKey);

    if (
      localHeaderOffset > centralDirectoryOffset ||
      localHeaderOffset + 30 > data.byteLength ||
      readUint32(view, localHeaderOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      malformed();
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localCompressionMethod = readUint16(view, localHeaderOffset + 8);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    if (
      localFlags & 0x0001 ||
      localCompressionMethod !== compressionMethod ||
      localNameLength !== fileNameLength ||
      localHeaderOffset + 30 + localNameLength + localExtraLength >
        data.byteLength ||
      !sameBytes(
        data,
        localHeaderOffset + 30,
        data,
        cursor + 46,
        fileNameLength,
      )
    ) {
      malformed();
    }
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      dataStart > centralDirectoryOffset ||
      dataEnd < dataStart ||
      dataEnd > centralDirectoryOffset
    ) {
      malformed();
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new DocxExtractionError("too_large");
    }
    entries.push({
      name: decodeName(nameBytes),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataStart,
      dataEnd,
    });
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryEnd) {
    malformed();
  }

  const ranges = [...entries].sort(
    (left, right) => left.dataStart - right.dataStart,
  );
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].dataStart < ranges[index - 1].dataEnd) {
      malformed();
    }
  }
  return entries;
}

/**
 * Validate the ZIP central directory without reading or inflating entry data.
 * ZIP64 and encrypted entries fail closed because their expansion metadata is
 * not safely representable by the bounded 32-bit checks below. `extractDocxText`
 * performs the second, actual-inflation pass before Mammoth sees the archive.
 */
export function inspectDocxZip(bytes: ArrayBuffer): void {
  readZipEntries(bytes);
}

function checkDeadline(deadline: number): void {
  if (Date.now() >= deadline) {
    throw new DocxExtractionError("malformed");
  }
}

function scanXmlChunk(
  chunk: Uint8Array,
  decoder: TextDecoder,
  tail: string,
): string {
  const text = (tail + decoder.decode(chunk, { stream: true })).toLowerCase();
  if (XML_FORBIDDEN_MARKERS.some((marker) => text.includes(marker))) {
    throw new DocxExtractionError("malformed");
  }
  return text.slice(-XML_FORBIDDEN_MARKERS[0].length);
}

function finishXmlScan(decoder: TextDecoder, tail: string): void {
  const text = (tail + decoder.decode()).toLowerCase();
  if (XML_FORBIDDEN_MARKERS.some((marker) => text.includes(marker))) {
    throw new DocxExtractionError("malformed");
  }
}

async function inflateEntry(
  bytes: ArrayBuffer,
  entry: ZipEntry,
  totalInflated: { value: number },
  deadline: number,
): Promise<void> {
  const isXml = entry.name.toLowerCase().endsWith(".xml");
  const decoder = isXml ? new TextDecoder() : null;
  let xmlTail = "";
  let actualSize = 0;
  const consume = (chunk: Uint8Array) => {
    actualSize += chunk.byteLength;
    totalInflated.value += chunk.byteLength;
    if (
      actualSize > MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES ||
      totalInflated.value > MAX_DOCX_UNCOMPRESSED_BYTES
    ) {
      throw new DocxExtractionError("too_large");
    }
    if (decoder) xmlTail = scanXmlChunk(chunk, decoder, xmlTail);
  };

  if (entry.compressionMethod === STORED_METHOD) {
    const chunk = new Uint8Array(bytes, entry.dataStart, entry.compressedSize);
    consume(chunk);
  } else if (entry.compressionMethod === DEFLATE_METHOD) {
    const compressed = new Uint8Array(
      bytes,
      entry.dataStart,
      entry.compressedSize,
    );
    const body = new Response(new Blob([compressed])).body;
    if (!body || typeof DecompressionStream === "undefined") malformed();
    const reader = body
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    try {
      while (true) {
        checkDeadline(deadline);
        const result = await reader.read();
        if (result.done) break;
        consume(result.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof DocxExtractionError) throw error;
      throw new DocxExtractionError("malformed");
    } finally {
      reader.releaseLock();
    }
  } else {
    malformed();
  }

  if (decoder) finishXmlScan(decoder, xmlTail);
  if (actualSize !== entry.uncompressedSize) {
    malformed();
  }
}

function withDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    return Promise.reject(new DocxExtractionError("malformed"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DocxExtractionError("malformed")),
      remaining,
    );
  });
  // This race can stop asynchronous ZIP work, but it cannot preempt a
  // synchronous CPU loop inside a dependency. The real-byte caps and the
  // checks between each stream read are therefore the primary protection.
  let work: Promise<T>;
  try {
    work = operation();
  } catch (error) {
    if (timer !== undefined) clearTimeout(timer);
    return Promise.reject(error);
  }
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function validateActualZip(
  bytes: ArrayBuffer,
  deadline: number,
): Promise<void> {
  const entries = readZipEntries(bytes);
  const totalInflated = { value: 0 };
  for (const entry of entries) {
    checkDeadline(deadline);
    await inflateEntry(bytes, entry, totalInflated, deadline);
  }
}

/** Extract only bounded prose from a modern Word document. */
export async function extractDocxText(fileBytes: ArrayBuffer): Promise<string> {
  try {
    const deadline = Date.now() + DOCX_EXTRACTION_TIMEOUT_MS;
    await withDeadline(() => validateActualZip(fileBytes, deadline), deadline);
    const mammoth = await import("mammoth");
    // The browser entry selected by Wrangler reads `arrayBuffer`, while the
    // Node entry selected by Vitest reads `buffer`; providing both keeps the
    // same production call testable without importing Mammoth's internals.
    const result = await withDeadline(
      () =>
        // Mammoth's extractRawText API has no options parameter; its source
        // default is externalFileAccess: false. XML external entities are
        // additionally rejected by the preflight scanner above.
        mammoth.extractRawText({
          arrayBuffer: fileBytes,
          buffer: fileBytes as never,
        }),
      deadline,
    );
    checkDeadline(deadline);
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
