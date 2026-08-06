import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_PIXELS,
  exceedsMaxImagePixels,
  readImageDimensions,
} from "./imageDimensionGuard";

function writeAscii(view: DataView, offset: number, ascii: string): void {
  for (let i = 0; i < ascii.length; i++) {
    view.setUint8(offset + i, ascii.charCodeAt(i));
  }
}

function buildPng(width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(29);
  const view = new DataView(buffer);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  signature.forEach((byte, i) => view.setUint8(i, byte));
  view.setUint32(8, 13, false); // IHDR chunk length field (not checked by the parser)
  writeAscii(view, 12, "IHDR");
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buffer;
}

/** A minimal but structurally real JPEG: SOI, an APP0 (JFIF) segment the
 * walker must skip over, then an SOF0 segment carrying the dimensions. */
function buildJpeg(width: number, height: number): ArrayBuffer {
  const bytes: number[] = [0xff, 0xd8]; // SOI
  bytes.push(0xff, 0xe0); // APP0
  const app0PayloadLength = 14;
  bytes.push((app0PayloadLength >> 8) & 0xff, app0PayloadLength & 0xff);
  for (let i = 0; i < app0PayloadLength - 2; i++) bytes.push(0);
  bytes.push(0xff, 0xc0); // SOF0
  bytes.push(0, 11); // segment length (informational only — not enforced by the reader)
  bytes.push(8); // precision
  bytes.push((height >> 8) & 0xff, height & 0xff);
  bytes.push((width >> 8) & 0xff, width & 0xff);
  bytes.push(1, 1, 0x11, 0); // one component spec, enough trailing bytes
  return new Uint8Array(bytes).buffer;
}

function buildWebpVp8x(width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(30);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 22, true);
  writeAscii(view, 8, "WEBP");
  writeAscii(view, 12, "VP8X");
  view.setUint32(16, 10, true);
  view.setUint8(20, 0); // flags
  view.setUint8(21, 0);
  view.setUint8(22, 0);
  view.setUint8(23, 0); // reserved
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  view.setUint8(24, widthMinusOne & 0xff);
  view.setUint8(25, (widthMinusOne >> 8) & 0xff);
  view.setUint8(26, (widthMinusOne >> 16) & 0xff);
  view.setUint8(27, heightMinusOne & 0xff);
  view.setUint8(28, (heightMinusOne >> 8) & 0xff);
  view.setUint8(29, (heightMinusOne >> 16) & 0xff);
  return buffer;
}

function buildWebpVp8l(width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(30);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 17, true);
  writeAscii(view, 8, "WEBP");
  writeAscii(view, 12, "VP8L");
  view.setUint32(16, 5, true);
  view.setUint8(20, 0x2f); // VP8L signature
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  view.setUint8(21, bits & 0xff);
  view.setUint8(22, (bits >> 8) & 0xff);
  view.setUint8(23, (bits >> 16) & 0xff);
  view.setUint8(24, (bits >> 24) & 0xff);
  return buffer;
}

function buildWebpVp8(width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(30);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 22, true);
  writeAscii(view, 8, "WEBP");
  writeAscii(view, 12, "VP8 ");
  view.setUint32(16, 10, true);
  view.setUint8(20, 0x10); // frame tag (arbitrary — not validated)
  view.setUint8(21, 0x02);
  view.setUint8(22, 0x00);
  view.setUint8(23, 0x9d); // key-frame start code
  view.setUint8(24, 0x01);
  view.setUint8(25, 0x2a);
  view.setUint8(26, width & 0xff);
  view.setUint8(27, (width >> 8) & 0x3f);
  view.setUint8(28, height & 0xff);
  view.setUint8(29, (height >> 8) & 0x3f);
  return buffer;
}

describe("readImageDimensions", () => {
  describe("image/png", () => {
    it("reads width/height from a well-formed PNG's IHDR chunk", () => {
      // Act
      const result = readImageDimensions(buildPng(2000, 3000), "image/png");

      // Assert
      expect(result).toEqual({ width: 2000, height: 3000 });
    });

    it("returns null for a truncated PNG (shorter than the IHDR chunk)", () => {
      // Act
      const result = readImageDimensions(new ArrayBuffer(10), "image/png");

      // Assert
      expect(result).toBeNull();
    });

    it("returns null when the PNG signature is wrong", () => {
      // Arrange
      const buffer = buildPng(100, 100);
      new DataView(buffer).setUint8(0, 0x00); // corrupt the signature

      // Act
      const result = readImageDimensions(buffer, "image/png");

      // Assert
      expect(result).toBeNull();
    });

    it("returns null when the first chunk is not IHDR", () => {
      // Arrange
      const buffer = buildPng(100, 100);
      writeAscii(new DataView(buffer), 12, "IDAT");

      // Act
      const result = readImageDimensions(buffer, "image/png");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("image/jpeg", () => {
    it("reads width/height from a well-formed JPEG's SOF0 segment, skipping the APP0 segment first", () => {
      // Act
      const result = readImageDimensions(buildJpeg(1920, 1080), "image/jpeg");

      // Assert
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    it("returns null for a file lacking an SOI marker", () => {
      // Act
      const result = readImageDimensions(new ArrayBuffer(10), "image/jpeg");

      // Assert
      expect(result).toBeNull();
    });

    it("returns null (never hangs) for a JPEG with no SOF segment at all", () => {
      // Arrange — SOI immediately followed by EOI, no SOF.
      const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;

      // Act
      const result = readImageDimensions(buffer, "image/jpeg");

      // Assert
      expect(result).toBeNull();
    });

    it("returns null for a truncated SOF segment", () => {
      // Arrange
      const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 4]).buffer;

      // Act
      const result = readImageDimensions(buffer, "image/jpeg");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("image/webp", () => {
    it("reads width/height from a VP8X (extended) chunk", () => {
      // Act
      const result = readImageDimensions(
        buildWebpVp8x(4096, 2048),
        "image/webp",
      );

      // Assert
      expect(result).toEqual({ width: 4096, height: 2048 });
    });

    it("reads width/height from a VP8L (lossless) chunk", () => {
      // Act
      const result = readImageDimensions(buildWebpVp8l(800, 600), "image/webp");

      // Assert
      expect(result).toEqual({ width: 800, height: 600 });
    });

    it("reads width/height from a VP8 (simple lossy) chunk", () => {
      // Act
      const result = readImageDimensions(buildWebpVp8(640, 480), "image/webp");

      // Assert
      expect(result).toEqual({ width: 640, height: 480 });
    });

    it("returns null for a file with the RIFF/WEBP header but an unrecognized chunk type", () => {
      // Arrange
      const buffer = buildWebpVp8x(100, 100);
      writeAscii(new DataView(buffer), 12, "ANIM");

      // Act
      const result = readImageDimensions(buffer, "image/webp");

      // Assert
      expect(result).toBeNull();
    });

    it("returns null when it isn't RIFF/WEBP at all", () => {
      // Act
      const result = readImageDimensions(new ArrayBuffer(40), "image/webp");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("out-of-scope MIME types (documented gap, not a false positive)", () => {
    it("returns null for application/pdf", () => {
      // Act
      const result = readImageDimensions(
        new ArrayBuffer(100),
        "application/pdf",
      );

      // Assert
      expect(result).toBeNull();
    });

    it("returns null for image/heic and image/heif", () => {
      // Act / Assert
      expect(
        readImageDimensions(new ArrayBuffer(100), "image/heic"),
      ).toBeNull();
      expect(
        readImageDimensions(new ArrayBuffer(100), "image/heif"),
      ).toBeNull();
    });
  });

  it("never throws on arbitrary/garbage bytes for any covered MIME type", () => {
    // Arrange
    const garbage = new Uint8Array(50).map((_, i) => (i * 37) % 256).buffer;

    // Act / Assert
    for (const mimeType of ["image/png", "image/jpeg", "image/webp"]) {
      expect(() => readImageDimensions(garbage, mimeType)).not.toThrow();
    }
  });
});

describe("exceedsMaxImagePixels", () => {
  it("returns false for dimensions within budget", () => {
    // Act / Assert
    expect(exceedsMaxImagePixels({ width: 4000, height: 3000 })).toBe(false);
  });

  it("returns false exactly at the budget boundary", () => {
    // Arrange — 8000 * 5000 = 40,000,000 = MAX_IMAGE_PIXELS exactly.
    // Act / Assert
    expect(exceedsMaxImagePixels({ width: 8000, height: 5000 })).toBe(false);
    expect(8000 * 5000).toBe(MAX_IMAGE_PIXELS);
  });

  it("returns true one pixel over the budget", () => {
    // Act / Assert
    expect(exceedsMaxImagePixels({ width: 8000, height: 5001 })).toBe(true);
  });

  it("returns true for a decompression-bomb-shaped image (small file, huge canvas)", () => {
    // Arrange — the exact scenario Finding 19 names: a compact file whose
    // header claims an enormous decoded canvas.
    const bomb = buildPng(50_000, 50_000);

    // Act
    const dimensions = readImageDimensions(bomb, "image/png");

    // Assert
    expect(dimensions).toEqual({ width: 50_000, height: 50_000 });
    expect(exceedsMaxImagePixels(dimensions!)).toBe(true);
  });
});
