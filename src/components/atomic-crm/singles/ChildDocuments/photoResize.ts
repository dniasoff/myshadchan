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

export type PhotoDimensions = {
  width: number;
  height: number;
};

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
  let sourceBitmap: DecodedPhoto;
  try {
    sourceBitmap = await dependencies.decode(file, {
      imageOrientation: "from-image",
    });
  } catch {
    throw new Error(PHOTO_RESIZE_ERROR_MESSAGE);
  }

  const sourceDimensions: PhotoDimensions = {
    width: sourceBitmap.width,
    height: sourceBitmap.height,
  };
  const skip = shouldSkipPhotoResize(file.size, sourceDimensions);
  sourceBitmap.close?.();
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
