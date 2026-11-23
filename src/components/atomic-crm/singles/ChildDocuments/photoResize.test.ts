import { describe, expect, it, vi } from "vitest";

import {
  fitPhotoDimensions,
  getPhotoResizeAttempts,
  makeSmallerPhoto,
  parsePhotoDimensions,
  PHOTO_JPEG_QUALITY_STEPS,
  PHOTO_MAX_BYTES,
  shouldSkipPhotoResize,
  stepDownPhotoDimensions,
} from "./photoResize";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function orientedJpegHeader(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01,
    0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0xd0, 0x0f, 0xa0, 0x01,
    0x01, 0x11, 0x00,
  ]);
}

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

  it("reads dimensions from headers and applies EXIF rotation", () => {
    expect(parsePhotoDimensions(pngHeader(4000, 2000))).toEqual({
      width: 4000,
      height: 2000,
    });
    expect(parsePhotoDimensions(orientedJpegHeader())).toEqual({
      width: 2000,
      height: 4000,
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

  it("never asks the decoder for an unbounded bitmap", async () => {
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
    const bytes = new Uint8Array(PHOTO_MAX_BYTES + 1);
    bytes.set(pngHeader(4000, 2000));
    const file = new File([bytes], "phone.png", {
      type: "image/png",
    });

    const result = await makeSmallerPhoto(file, {
      decode,
      createCanvas: () => canvas,
    });

    expect(result.resized).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        imageOrientation: "from-image",
        resizeWidth: 3000,
        resizeHeight: 1500,
        resizeQuality: "high",
      }),
    );
    for (const [, options] of decode.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          resizeWidth: expect.any(Number),
          resizeHeight: expect.any(Number),
        }),
      );
    }
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("phone.jpg");
  });
});
