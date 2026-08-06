/**
 * Finding 19 (Epic 11 adversarial review, P2): the attachment guard
 * (`inboxAttachment.ts`) bounds only encoded byte size — a small, highly
 * compressed file can still decode to an enormous pixel canvas (a
 * decompression-bomb shape) and be forwarded to Gemini as-is, unbounded.
 *
 * Scope, decided explicitly rather than left implicit (per the approved
 * design's Q5):
 *  - PDF page-count parsing was judged NOT worth building. A correct
 *    implementation needs either a real PDF library (bundle size, CPU cost
 *    inside a Workers isolate, and a new attack surface for a maliciously
 *    crafted PDF) or a fragile hand-rolled parser walking a possibly
 *    adversarial xref table — YAGNI. PDFs (and HEIC/HEIF, for the same
 *    "not worth a hand-rolled parser for two rare MIME types" reasoning)
 *    are bounded by the 8 MiB byte cap (`inboxAttachment.ts`) plus the
 *    provider-execution timeout (Finding 7, `resumeExtractor.ts`'s
 *    `GEMINI_EXTRACT_TIMEOUT_MS`) instead — a documented gap, not an
 *    oversight, same shape as this module's own HEIC/HEIF gap below.
 *  - An image PIXEL-DIMENSION bound for `image/png`, `image/jpeg`, and
 *    `image/webp` WAS worth building: each format's dimensions sit at a
 *    small, fixed-ish early offset in the file, readable in ~30-40 lines
 *    of byte-scanning with no library and no dependency. This closes the
 *    concrete "tiny file, huge decoded canvas" gap a byte cap alone cannot.
 *
 * `image/heic`/`image/heif` are deliberately OUT of scope for THIS
 * function too — ISO-BMFF box parsing is materially more involved than
 * PNG/JPEG/WebP's flat headers, for two MIME types on the allowlist. Not a
 * silent gap: `readImageDimensions` returns `null` for them (and for any
 * other MIME type), same as it does for a malformed file of a covered type
 * — a caller cannot tell "not checkable" from "checked and fine" from this
 * return value alone, which is intentional: the guard this function backs
 * is meant to be a REJECTION signal only when a dimension genuinely exceeds
 * budget, never a false rejection when a format simply isn't parsed here.
 *
 * Wired into `index.ts`'s `POST /parse` handler (step 7): called right
 * after the bytes are downloaded and the byte-size backstop passes, and
 * before those bytes are handed to `activeExtractor.extract()`. A `null`
 * result (unsupported MIME type, or a malformed/truncated file of a
 * covered type) falls through to extraction unchanged — this guard only
 * ever rejects on a genuine over-budget dimension, never on "couldn't
 * tell." See `index.ts`'s own Finding 19 comment at that call site, and
 * `index.imageDimensionGuard.test.ts` for the route-level regression
 * coverage (the unit tests in this file's own test suite prove the parsing
 * logic, not that it is wired into the request path).
 */

/** Generous for any real scanned page or photo — comfortably above what a
 * flatbed scanner or phone camera produces, while still bounding a
 * decompression-bomb-shaped file to a fixed decode cost. */
export const MAX_IMAGE_PIXELS = 40_000_000;

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  // Bytes 12-15 must be the ASCII chunk type "IHDR" — the first chunk in
  // every valid PNG, always immediately after the 8-byte signature and its
  // own 4-byte length field.
  const isIhdr =
    view.getUint8(12) === 0x49 &&
    view.getUint8(13) === 0x48 &&
    view.getUint8(14) === 0x44 &&
    view.getUint8(15) === 0x52;
  if (!isIhdr) {
    return null;
  }
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

/** JPEG marker bytes that carry no length field / payload — Start Of Image,
 * the restart markers, End Of Image, and the (rare) standalone TEM marker. */
function isLengthlessJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

/** JPEG Start-Of-Frame markers that carry dimensions — 0xC0-0xCF, excluding
 * DHT (0xC4), the reserved JPG marker (0xC8), and DAC (0xCC), none of which
 * are actually frame markers despite falling in that numeric range. */
function isJpegSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readJpegDimensions(view: DataView): ImageDimensions | null {
  const length = view.byteLength;
  if (length < 4 || view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) {
    return null; // not a JPEG (no SOI marker)
  }

  let cursor = 2;
  // Bounded by `length` (checked before every read) and monotonically
  // increasing every iteration — this loop always terminates.
  while (cursor + 1 < length) {
    if (view.getUint8(cursor) !== 0xff) {
      return null; // not aligned on a marker; malformed, bail rather than guess
    }
    let marker = view.getUint8(cursor + 1);
    cursor += 2;
    // JPEG allows 0xFF fill/padding bytes before the real marker byte.
    while (marker === 0xff && cursor < length) {
      marker = view.getUint8(cursor);
      cursor += 1;
    }

    if (isLengthlessJpegMarker(marker)) {
      continue;
    }
    if (cursor + 1 >= length) {
      return null;
    }
    // Segment length INCLUDES its own 2 bytes; payload starts right after.
    const segmentLength = view.getUint16(cursor, false);

    if (isJpegSofMarker(marker)) {
      // Payload: precision(1) + height(2) + width(2) + ...
      if (cursor + 7 >= length) {
        return null;
      }
      return {
        height: view.getUint16(cursor + 3, false),
        width: view.getUint16(cursor + 5, false),
      };
    }
    if (marker === 0xda || segmentLength < 2) {
      // Start Of Scan (compressed data follows) or a malformed segment —
      // either way, no SOF marker was found before this point.
      return null;
    }
    cursor += segmentLength;
  }
  return null;
}

function readWebpVp8xDimensions(view: DataView): ImageDimensions {
  // Chunk data starts at byte 20: flags(1) + reserved(3), then a 3-byte
  // little-endian "canvas width minus one" and "canvas height minus one".
  const widthMinusOne =
    view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
  const heightMinusOne =
    view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
  return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
}

function readWebpVp8lDimensions(view: DataView): ImageDimensions | null {
  // Byte 20 is a fixed signature (0x2F); bytes 21-24 little-endian-pack a
  // 14-bit width-minus-one, a 14-bit height-minus-one, an alpha bit, and a
  // 3-bit version — per the WebP Lossless Bitstream spec.
  if (view.getUint8(20) !== 0x2f) {
    return null;
  }
  const bits =
    view.getUint8(21) |
    (view.getUint8(22) << 8) |
    (view.getUint8(23) << 16) |
    (view.getUint8(24) << 24);
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
  };
}

function readWebpVp8Dimensions(view: DataView): ImageDimensions | null {
  // Frame tag (3 bytes) at 20-22, then a fixed 3-byte key-frame start code
  // (0x9D 0x01 0x2A) at 23-25 — per the VP8 Data Format spec. Width/height
  // follow as 2 little-endian bytes each; the top 2 bits of each are a
  // display scale, masked off here since only the pixel dimensions matter.
  const isKeyFrameStartCode =
    view.getUint8(23) === 0x9d &&
    view.getUint8(24) === 0x01 &&
    view.getUint8(25) === 0x2a;
  if (!isKeyFrameStartCode) {
    return null;
  }
  const widthField = view.getUint8(26) | (view.getUint8(27) << 8);
  const heightField = view.getUint8(28) | (view.getUint8(29) << 8);
  return { width: widthField & 0x3fff, height: heightField & 0x3fff };
}

function readWebpDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 30) {
    return null;
  }
  const isRiff =
    view.getUint8(0) === 0x52 &&
    view.getUint8(1) === 0x49 &&
    view.getUint8(2) === 0x46 &&
    view.getUint8(3) === 0x46;
  const isWebp =
    view.getUint8(8) === 0x57 &&
    view.getUint8(9) === 0x45 &&
    view.getUint8(10) === 0x42 &&
    view.getUint8(11) === 0x50;
  if (!isRiff || !isWebp) {
    return null;
  }

  const fourCc = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );

  switch (fourCc) {
    case "VP8X":
      return readWebpVp8xDimensions(view);
    case "VP8L":
      return readWebpVp8lDimensions(view);
    case "VP8 ":
      return readWebpVp8Dimensions(view);
    default:
      return null;
  }
}

/**
 * Read an image's pixel dimensions directly from its file header, for the
 * three MIME types this module supports (`image/png`, `image/jpeg`,
 * `image/webp`). Returns `null` for any other MIME type (including
 * `image/heic`/`image/heif` — see this module's header comment) or for a
 * malformed/unrecognized file of a covered type. Never throws.
 */
export function readImageDimensions(
  bytes: ArrayBuffer,
  mimeType: string,
): ImageDimensions | null {
  const view = new DataView(bytes);
  switch (mimeType) {
    case "image/png":
      return readPngDimensions(view);
    case "image/jpeg":
      return readJpegDimensions(view);
    case "image/webp":
      return readWebpDimensions(view);
    default:
      return null;
  }
}

/** Convenience predicate for the call site — `width * height` cannot
 * realistically overflow `Number`'s safe integer range for any dimension
 * this parser can produce (each coordinate is bounded to at most 24 bits by
 * every format above). */
export function exceedsMaxImagePixels(dimensions: ImageDimensions): boolean {
  return dimensions.width * dimensions.height > MAX_IMAGE_PIXELS;
}
