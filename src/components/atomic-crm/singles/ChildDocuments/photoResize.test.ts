import { describe, expect, it, vi } from "vitest";

import {
  fitPhotoDimensions,
  getPhotoResizeAttempts,
  makeSmallerPhoto,
  PHOTO_JPEG_QUALITY_STEPS,
  PHOTO_MAX_BYTES,
  shouldSkipPhotoResize,
  stepDownPhotoDimensions,
} from "./photoResize";

describe("photoResize", () => {
  it("fits the long side to 3000px without changing the aspect ratio", () => {
    expect(fitPhotoDimensions({ width: 4000, height: 2000 })).toEqual({
      width: 3000,
      height: 1500,
    });
    expect(fitPhotoDimensions({ width: 1200, height: 1800 })).toEqual({
      width: 1200,
      height: 1800,
    });
  });

  it("skips a photo that already fits both limits", () => {
    expect(
      shouldSkipPhotoResize(PHOTO_MAX_BYTES, {
        width: 3000,
        height: 2000,
      }),
    ).toBe(true);
    expect(
      shouldSkipPhotoResize(PHOTO_MAX_BYTES + 1, {
        width: 3000,
        height: 2000,
      }),
    ).toBe(false);
    expect(
      shouldSkipPhotoResize(PHOTO_MAX_BYTES, {
        width: 3001,
        height: 2000,
      }),
    ).toBe(false);
  });

  it("reduces JPEG quality before stepping dimensions down", () => {
    const attempts = getPhotoResizeAttempts({ width: 4000, height: 2000 });
    expect(attempts.slice(0, PHOTO_JPEG_QUALITY_STEPS.length)).toEqual(
      PHOTO_JPEG_QUALITY_STEPS.map((quality) => ({
        dimensions: { width: 3000, height: 1500 },
        quality,
      })),
    );
    expect(attempts[PHOTO_JPEG_QUALITY_STEPS.length]).toEqual({
      dimensions: { width: 2400, height: 1200 },
      quality: PHOTO_JPEG_QUALITY_STEPS[0],
    });
    expect(stepDownPhotoDimensions({ width: 3, height: 2 })).toEqual({
      width: 2,
      height: 1,
    });
  });

  it("passes EXIF orientation and resize options to the decoder", async () => {
    const decode = vi.fn(
      async (
        _source: Blob,
        options: { resizeWidth?: number; resizeHeight?: number },
      ) => ({
        width: options.resizeWidth ?? 4000,
        height: options.resizeHeight ?? 2000,
        close: vi.fn(),
      }),
    );
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob([new Uint8Array(1024)], { type: "image/jpeg" })),
    };
    const file = new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], "phone.png", {
      type: "image/png",
    });

    const result = await makeSmallerPhoto(file, {
      decode,
      createCanvas: () => canvas,
    });

    expect(result.resized).toBe(true);
    expect(decode).toHaveBeenNthCalledWith(
      1,
      file,
      expect.objectContaining({ imageOrientation: "from-image" }),
    );
    expect(decode).toHaveBeenNthCalledWith(
      2,
      file,
      expect.objectContaining({
        imageOrientation: "from-image",
        resizeWidth: 3000,
        resizeHeight: 1500,
        resizeQuality: "high",
      }),
    );
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("phone.jpg");
  });
});
