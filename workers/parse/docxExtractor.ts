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
const CFB_MAGIC = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const ENCRYPTED_PACKAGE_UTF16LE = new Uint8Array([
  0x45, 0x00, 0x6e, 0x00, 0x63, 0x00, 0x72, 0x00, 0x79, 0x00, 0x70, 0x00, 0x74,
  0x00, 0x65, 0x00, 0x64, 0x00, 0x50, 0x00, 0x61, 0x00, 0x63, 0x00, 0x6b, 0x00,
  0x61, 0x00, 0x67, 0x00, 0x65, 0x00,
]);

type ZipEntry = {
  name: string;
  flags: number;
  crc32: number;
  localHeaderStart: number;
  localHeaderEnd: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
  dataEnd: number;
};

function malformed(): never {
  throw new DocxExtractionError("malformed");
}

function isCfb(bytes: ArrayBuffer): boolean {
  const data = new Uint8Array(bytes);
  return CFB_MAGIC.every((byte, index) => data[index] === byte);
}

function hasEncryptedPackageStream(bytes: ArrayBuffer): boolean {
  const data = new Uint8Array(bytes);
  outer: for (
    let start = 0;
    start + ENCRYPTED_PACKAGE_UTF16LE.length <= data.length;
    start += 1
  ) {
    for (let index = 0; index < ENCRYPTED_PACKAGE_UTF16LE.length; index += 1) {
      if (data[start + index] !== ENCRYPTED_PACKAGE_UTF16LE[index])
        continue outer;
    }
    return true;
  }
  return false;
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

function crc32Update(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return value >>> 0;
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
    const crc32 = readUint32(view, cursor + 16);
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
    if (fileNameLength > 512) malformed();

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
    const localCrc32 = readUint32(view, localHeaderOffset + 14);
    const localCompressedSize = readUint32(view, localHeaderOffset + 18);
    const localUncompressedSize = readUint32(view, localHeaderOffset + 22);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    if (
      localFlags & 0x0001 ||
      (localFlags & ~0x0008) !== (flags & ~0x0008) ||
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
    if ((flags & 0x0008) === 0) {
      if (
        localFlags !== flags ||
        localCrc32 !== crc32 ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize
      ) {
        malformed();
      }
    } else {
      const descriptorOffset =
        localHeaderOffset +
        30 +
        localNameLength +
        localExtraLength +
        compressedSize;
      const descriptorHasSignature =
        descriptorOffset + 4 <= centralDirectoryOffset &&
        readUint32(view, descriptorOffset) === 0x08074b50;
      const descriptorStart =
        descriptorOffset + (descriptorHasSignature ? 4 : 0);
      if (descriptorStart + 12 > centralDirectoryOffset) malformed();
      if (
        readUint32(view, descriptorStart) !== crc32 ||
        readUint32(view, descriptorStart + 4) !== compressedSize ||
        readUint32(view, descriptorStart + 8) !== uncompressedSize
      ) {
        malformed();
      }
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
      flags,
      crc32,
      localHeaderStart: localHeaderOffset,
      localHeaderEnd: dataStart,
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
  for (const entry of entries) {
    for (const other of entries) {
      if (entry === other) continue;
      if (
        entry.localHeaderStart < other.dataEnd &&
        entry.localHeaderEnd > other.dataStart
      ) {
        malformed();
      }
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

function checkDeadline(deadline: number, signal?: AbortSignal): void {
  if (signal?.aborted || Date.now() >= deadline) {
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
  signal: AbortSignal,
): Promise<void> {
  const isXml = entry.name.toLowerCase().endsWith(".xml");
  const decoder = isXml ? new TextDecoder() : null;
  let xmlTail = "";
  let actualSize = 0;
  let crc = 0xffffffff;
  const consume = (chunk: Uint8Array) => {
    checkDeadline(deadline, signal);
    actualSize += chunk.byteLength;
    totalInflated.value += chunk.byteLength;
    crc = crc32Update(crc, chunk);
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
    const cancelOnAbort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancelOnAbort, { once: true });
    try {
      while (true) {
        checkDeadline(deadline, signal);
        const result = await reader.read();
        if (result.done) break;
        consume(result.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof DocxExtractionError) throw error;
      throw new DocxExtractionError("malformed");
    } finally {
      signal.removeEventListener("abort", cancelOnAbort);
      reader.releaseLock();
    }
  } else {
    malformed();
  }

  if (decoder) finishXmlScan(decoder, xmlTail);
  if (
    actualSize !== entry.uncompressedSize ||
    (crc ^ 0xffffffff) >>> 0 !== entry.crc32
  ) {
    malformed();
  }
}

function withDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
  controller?: AbortController,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    return Promise.reject(new DocxExtractionError("malformed"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new DocxExtractionError("malformed"));
    }, remaining);
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
  signal: AbortSignal,
): Promise<void> {
  const entries = readZipEntries(bytes);
  const totalInflated = { value: 0 };
  for (const entry of entries) {
    checkDeadline(deadline, signal);
    await inflateEntry(bytes, entry, totalInflated, deadline, signal);
  }
}

/** Extract only bounded prose from a modern Word document. */
export async function extractDocxText(fileBytes: ArrayBuffer): Promise<string> {
  try {
    // Password-protected Word documents are OLE2/CFB containers rather than
    // ZIP packages. Legacy .doc is never routed here, so a non-encrypted CFB
    // file is still a malformed DOCX instead of an attach-only legacy file.
    if (isCfb(fileBytes)) {
      if (hasEncryptedPackageStream(fileBytes)) {
        throw new DocxExtractionError("password_protected");
      }
      throw malformed();
    }
    const deadline = Date.now() + DOCX_EXTRACTION_TIMEOUT_MS;
    const controller = new AbortController();
    await withDeadline(
      () => validateActualZip(fileBytes, deadline, controller.signal),
      deadline,
      controller,
    );
    const mammoth = await import("mammoth");
    // The browser entry selected by Wrangler reads `arrayBuffer`, while the
    // Node entry selected by Vitest reads `buffer`; providing both keeps the
    // same production call testable without importing Mammoth's internals.
    // Mammoth exposes no AbortSignal. The bounded preflight is cancellable;
    // a synchronous Mammoth CPU loop cannot be preempted by JavaScript.
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
      controller,
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
