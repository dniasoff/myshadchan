export const PHOTO_MAX_LONG_SIDE = 3000;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_INITIAL_JPEG_QUALITY = 0.9;
export const PHOTO_JPEG_QUALITY_STEPS = [
  PHOTO_INITIAL_JPEG_QUALITY,
  0.84,
  0.78,
  0.72,
  0.66,
  0.6,
] as const;
export const PHOTO_DIMENSION_STEP = 0.8;
export const PHOTO_RESIZE_ERROR_MESSAGE =
  "We couldn't read this picture in your browser. Try another JPEG or PNG.";
const PHOTO_HEADER_BYTES = 64 * 1024;

export type PhotoDimensions = {
  width: number;
  height: number;
};

function readUint16BE(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 1 >= bytes.length) return undefined;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 3 >= bytes.length) return undefined;
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  if (offset < 0 || offset + 1 >= bytes.length) return undefined;
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  if (offset < 0 || offset + 3 >= bytes.length) return undefined;
  return littleEndian
    ? bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] * 0x1000000)
    : readUint32BE(bytes, offset);
}

function hasBytes(
  bytes: Uint8Array,
  offset: number,
  values: readonly number[],
): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function validPhotoDimensions(
  width: number | undefined,
  height: number | undefined,
): PhotoDimensions | undefined {
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { width, height };
}

function parseExifOrientation(
  bytes: Uint8Array,
  tiffStart: number,
  end: number,
): number {
  if (tiffStart + 8 > end) return 1;
  const littleEndian =
    bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49
      ? true
      : bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d
        ? false
        : undefined;
  if (littleEndian === undefined) return 1;
  if (readUint16(bytes, tiffStart + 2, littleEndian) !== 42) return 1;
  const firstIfdOffset = readUint32(bytes, tiffStart + 4, littleEndian);
  if (firstIfdOffset === undefined) return 1;
  const ifdStart = tiffStart + firstIfdOffset;
  const entryCount = readUint16(bytes, ifdStart, littleEndian);
  if (entryCount === undefined || ifdStart + 2 + entryCount * 12 > end) {
    return 1;
  }
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = ifdStart + 2 + index * 12;
    if (readUint16(bytes, entryStart, littleEndian) !== 0x0112) continue;
    if (readUint16(bytes, entryStart + 2, littleEndian) !== 3) return 1;
    if (readUint32(bytes, entryStart + 4, littleEndian) !== 1) return 1;
    return readUint16(bytes, entryStart + 8, littleEndian) ?? 1;
  }
  return 1;
}

function dimensionsWithOrientation(
  dimensions: PhotoDimensions,
  orientation: number,
): PhotoDimensions {
  return orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function parseJpegDimensions(bytes: Uint8Array): PhotoDimensions | undefined {
  if (!hasBytes(bytes, 0, [0xff, 0xd8])) return undefined;
  let offset = 2;
  let dimensions: PhotoDimensions | undefined;
  let orientation = 1;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = readUint16BE(bytes, offset);
    if (length === undefined || length < 2) break;
    const dataStart = offset + 2;
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) break;

    if (
      marker === 0xe1 &&
      hasBytes(bytes, dataStart, [0x45, 0x78, 0x69, 0x66, 0, 0])
    ) {
      orientation = parseExifOrientation(bytes, dataStart + 6, segmentEnd);
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      dimensions = validPhotoDimensions(
        readUint16BE(bytes, dataStart + 3),
        readUint16BE(bytes, dataStart + 1),
      );
    }
    offset = segmentEnd;
  }

  return dimensions
    ? dimensionsWithOrientation(dimensions, orientation)
    : undefined;
}

function parsePngDimensions(bytes: Uint8Array): PhotoDimensions | undefined {
  if (!hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return undefined;
  }
  const dimensions = validPhotoDimensions(
    readUint32BE(bytes, 16),
    readUint32BE(bytes, 20),
  );
  if (!dimensions) return undefined;

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    if (length === undefined) break;
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (chunkEnd > bytes.length) break;
    if (hasBytes(bytes, typeStart, [0x65, 0x58, 0x49, 0x66])) {
      return dimensionsWithOrientation(
        dimensions,
        parseExifOrientation(bytes, dataStart, dataStart + length),
      );
    }
    offset = chunkEnd;
  }
  return dimensions;
}

function readUint24LE(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 >= bytes.length) return undefined;
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parseWebpDimensions(bytes: Uint8Array): PhotoDimensions | undefined {
  if (
    !hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return undefined;
  }
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  const chunkData = 20;
  if (chunkType === "VP8X") {
    return validPhotoDimensions(
      (readUint24LE(bytes, chunkData + 4) ?? 0) + 1,
      (readUint24LE(bytes, chunkData + 7) ?? 0) + 1,
    );
  }
  if (chunkType === "VP8 ") {
    if (!hasBytes(bytes, chunkData + 3, [0x9d, 0x01, 0x2a])) return undefined;
    return validPhotoDimensions(
      (readUint16(bytes, chunkData + 6, true) ?? 0) & 0x3fff,
      (readUint16(bytes, chunkData + 8, true) ?? 0) & 0x3fff,
    );
  }
  if (chunkType === "VP8L" && bytes[chunkData] === 0x2f) {
    const bits =
      (bytes[chunkData + 1] ?? 0) |
      ((bytes[chunkData + 2] ?? 0) << 8) |
      ((bytes[chunkData + 3] ?? 0) << 16) |
      ((bytes[chunkData + 4] ?? 0) << 24);
    return validPhotoDimensions(
      (bits & 0x3fff) + 1,
      ((bits >>> 14) & 0x3fff) + 1,
    );
  }
  return undefined;
}

export function parsePhotoDimensions(bytes: Uint8Array): PhotoDimensions {
  const dimensions =
    parsePngDimensions(bytes) ??
    parseJpegDimensions(bytes) ??
    parseWebpDimensions(bytes);
  if (!dimensions) throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
  return dimensions;
}

async function readPhotoDimensions(file: Blob): Promise<PhotoDimensions> {
  const header = new Uint8Array(
    await file.slice(0, PHOTO_HEADER_BYTES).arrayBuffer(),
  );
  return parsePhotoDimensions(header);
}

export type PhotoResizeAttempt = {
  dimensions: PhotoDimensions;
  quality: number;
};

export function fitPhotoDimensions(
  dimensions: PhotoDimensions,
  maxLongSide = PHOTO_MAX_LONG_SIDE,
): PhotoDimensions {
  const longSide = Math.max(dimensions.width, dimensions.height);
  if (!Number.isFinite(longSide) || longSide <= 0) {
    throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
  }
  const scale = Math.min(1, maxLongSide / longSide);
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

export function shouldSkipPhotoResize(
  fileSize: number,
  dimensions: PhotoDimensions,
  maxBytes = PHOTO_MAX_BYTES,
  maxLongSide = PHOTO_MAX_LONG_SIDE,
): boolean {
  return (
    fileSize <= maxBytes &&
    Math.max(dimensions.width, dimensions.height) <= maxLongSide
  );
}

export function stepDownPhotoDimensions(
  dimensions: PhotoDimensions,
  factor = PHOTO_DIMENSION_STEP,
): PhotoDimensions {
  return {
    width: Math.max(1, Math.floor(dimensions.width * factor)),
    height: Math.max(1, Math.floor(dimensions.height * factor)),
  };
}

/** Quality is reduced first; dimensions are stepped down only if needed. */
export function getPhotoResizeAttempts(
  sourceDimensions: PhotoDimensions,
): PhotoResizeAttempt[] {
  const attempts: PhotoResizeAttempt[] = [];
  let dimensions = fitPhotoDimensions(sourceDimensions);

  for (let dimensionStep = 0; dimensionStep < 24; dimensionStep += 1) {
    for (const quality of PHOTO_JPEG_QUALITY_STEPS) {
      attempts.push({ dimensions, quality });
    }
    const nextDimensions = stepDownPhotoDimensions(dimensions);
    if (
      nextDimensions.width === dimensions.width &&
      nextDimensions.height === dimensions.height
    ) {
      break;
    }
    dimensions = nextDimensions;
  }

  return attempts;
}

export type DecodedPhoto = PhotoDimensions & {
  close?: () => void;
};

export type PhotoDecodeOptions = {
  imageOrientation: "from-image";
  resizeWidth?: number;
  resizeHeight?: number;
  resizeQuality?: "pixelated" | "low" | "medium" | "high";
};

export type PhotoCanvas = {
  getContext: (
    contextId: "2d",
  ) => { drawImage: (...args: unknown[]) => void } | null;
  toBlob: (
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ) => void;
};

export type PhotoResizeDependencies = {
  decode: (source: Blob, options: PhotoDecodeOptions) => Promise<DecodedPhoto>;
  createCanvas: (width: number, height: number) => PhotoCanvas;
  readDimensions?: (source: Blob) => Promise<PhotoDimensions>;
};

function browserResizeDependencies(): PhotoResizeDependencies {
  return {
    decode: async (source, options) => {
      if (typeof globalThis.createImageBitmap !== "function") {
        throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
      }
      return globalThis.createImageBitmap(source, options);
    },
    createCanvas: (width, height) => {
      if (typeof document === "undefined") {
        throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as PhotoCanvas;
    },
    readDimensions: readPhotoDimensions,
  };
}

function toJpegFileName(name: string): string {
  return `${name.replace(/\.[^.]*$/, "") || "picture"}.jpg`;
}

function canvasToBlob(canvas: PhotoCanvas, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error(PHOTO_RESIZE_ERROR_MESSAGE)),
        "image/jpeg",
        quality,
      );
    } catch {
      reject(new Error(PHOTO_RESIZE_ERROR_MESSAGE));
    }
  });
}

export async function makeSmallerPhoto(
  file: File,
  dependencies: PhotoResizeDependencies = browserResizeDependencies(),
): Promise<{
  file: File;
  resized: boolean;
  sourceDimensions: PhotoDimensions;
  outputDimensions: PhotoDimensions;
}> {
  let sourceDimensions: PhotoDimensions;
  try {
    sourceDimensions = await (
      dependencies.readDimensions ?? readPhotoDimensions
    )(file);
  } catch {
    throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
  }

  const skip = shouldSkipPhotoResize(file.size, sourceDimensions);
  if (skip) {
    return {
      file,
      resized: false,
      sourceDimensions,
      outputDimensions: sourceDimensions,
    };
  }

  for (const attempt of getPhotoResizeAttempts(sourceDimensions)) {
    let bitmap: DecodedPhoto | undefined;
    try {
      bitmap = await dependencies.decode(file, {
        imageOrientation: "from-image",
        resizeWidth: attempt.dimensions.width,
        resizeHeight: attempt.dimensions.height,
        resizeQuality: "high",
      });
      const canvas = dependencies.createCanvas(
        attempt.dimensions.width,
        attempt.dimensions.height,
      );
      const context = canvas.getContext("2d");
      if (!context) throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
      context.drawImage(
        bitmap,
        0,
        0,
        attempt.dimensions.width,
        attempt.dimensions.height,
      );
      const blob = await canvasToBlob(canvas, attempt.quality);
      if (blob.size <= PHOTO_MAX_BYTES) {
        return {
          file: new File([blob], toJpegFileName(file.name), {
            type: "image/jpeg",
            lastModified: file.lastModified,
          }),
          resized: true,
          sourceDimensions,
          outputDimensions: attempt.dimensions,
        };
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === PHOTO_RESIZE_ERROR_MESSAGE
      ) {
        throw error;
      }
      throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
    } finally {
      bitmap?.close?.();
    }
  }

  throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
}
