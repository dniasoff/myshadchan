import { describe, expect, it } from "vitest";
import {
  detectImageMimeType,
  findResumeAttachment,
  splitStoragePath,
  validateAttachmentMagic,
} from "./inboxAttachment";

describe("detectImageMimeType", () => {
  it.each([
    ["JPEG", [0xff, 0xd8, 0xff], "image/jpeg"],
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    ["GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif"],
    ["BMP", [0x42, 0x4d], "image/bmp"],
    ["TIFF little-endian", [0x49, 0x49, 0x2a, 0x00], "image/tiff"],
    ["TIFF big-endian", [0x4d, 0x4d, 0x00, 0x2a], "image/tiff"],
  ])("detects a leading %s signature", (_name, bytes, expected) => {
    expect(detectImageMimeType(new Uint8Array(bytes))).toBe(expected);
  });

  it.each([
    ["WebP", "WEBP", "image/webp"],
    ["HEIC", "heic", "image/heic"],
    ["HEIF", "heif", "image/heif"],
    ["AVIF", "avif", "image/avif"],
  ])("detects a leading %s container", (_name, brand, expected) => {
    const bytes = new Uint8Array(12);
    if (brand === "WEBP") {
      bytes.set([0x52, 0x49, 0x46, 0x46], 0);
      bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    } else {
      bytes.set([0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70], 0);
      bytes.set(new TextEncoder().encode(brand), 8);
    }

    expect(detectImageMimeType(bytes)).toBe(expected);
  });
});

describe("findResumeAttachment", () => {
  it("finds a valid PDF entry", () => {
    // Arrange
    const attachments = [
      {
        title: "resume.pdf",
        type: "application/pdf",
        path: "a/resume.pdf",
        src: "http://x",
      },
    ];

    // Act
    const result = findResumeAttachment(attachments);

    // Assert
    expect(result).toEqual({
      title: "resume.pdf",
      type: "application/pdf",
      path: "a/resume.pdf",
      src: "http://x",
    });
  });

  it("finds a valid image entry", () => {
    // Arrange
    const attachments = [
      { title: "resume.png", type: "image/png", path: "a/resume.png" },
    ];

    // Act
    const result = findResumeAttachment(attachments);

    // Assert
    expect(result?.type).toBe("image/png");
  });

  it("returns null for empty or null attachments", () => {
    // Assert
    expect(findResumeAttachment(null)).toBeNull();
    expect(findResumeAttachment([])).toBeNull();
  });

  it("preserves an optional stored byte size", () => {
    const result = findResumeAttachment([
      {
        title: "resume.pdf",
        type: "application/pdf",
        path: "42/resume.pdf",
        size: 2048,
      },
    ]);

    expect(result?.size).toBe(2048);
  });

  it("returns null for malformed jsonb without throwing", () => {
    // Arrange
    const attachments = [
      { notType: "application/pdf", notPath: "a/resume.pdf" },
      { type: "text/plain", path: "a/note.txt" },
    ];

    // Act
    const result = findResumeAttachment(attachments);

    // Assert
    expect(result).toBeNull();
  });

  // Review fix (Finding 9): the old `startsWith("image/")` prefix match
  // accepted any image subtype. The explicit allowlist must reject formats
  // Gemini's inline-data input does not document support for, even though
  // they still start with "image/".
  it("rejects an image MIME subtype not on the explicit allowlist (Finding 9)", () => {
    // Arrange
    const attachments = [
      { title: "resume.svg", type: "image/svg+xml", path: "a/resume.svg" },
      { title: "resume.gif", type: "image/gif", path: "a/resume.gif" },
    ];

    // Act
    const result = findResumeAttachment(attachments);

    // Assert
    expect(result).toBeNull();
  });

  it("accepts every MIME type on the explicit allowlist", () => {
    // Arrange
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];

    for (const type of allowed) {
      // Act
      const result = findResumeAttachment([
        { title: "resume", type, path: `a/resume.${type}` },
      ]);

      // Assert
      expect(result?.type).toBe(type);
    }
  });
});

describe("splitStoragePath", () => {
  it("splits an account-prefixed path into directory and file name", () => {
    // Act
    const result = splitStoragePath("10/resume.pdf");

    // Assert
    expect(result).toEqual({ dirPath: "10", fileName: "resume.pdf" });
  });

  it("splits a nested path at the LAST slash only", () => {
    // Act
    const result = splitStoragePath("10/inbox/2026/resume.pdf");

    // Assert
    expect(result).toEqual({
      dirPath: "10/inbox/2026",
      fileName: "resume.pdf",
    });
  });

  it("returns an empty directory for a bare file name with no slash", () => {
    // Act
    const result = splitStoragePath("resume.pdf");

    // Assert
    expect(result).toEqual({ dirPath: "", fileName: "resume.pdf" });
  });
});

describe("validateAttachmentMagic", () => {
  it("accepts matching PDF and DOCX signatures", () => {
    expect(
      validateAttachmentMagic(
        new TextEncoder().encode("%PDF-1.7").buffer,
        "application/pdf",
      ),
    ).toBe("ok");
    expect(
      validateAttachmentMagic(
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("ok");
  });

  it("rejects a mislabeled PDF and classifies encrypted OLE as password protected", () => {
    expect(
      validateAttachmentMagic(
        new TextEncoder().encode("<html>").buffer,
        "application/pdf",
      ),
    ).toBe("malformed");
    const marker = new Uint8Array(
      Array.from("EncryptedPackage", (character) => [
        character.charCodeAt(0),
        0,
      ]).flat(),
    );
    const cfb = new Uint8Array(8 + marker.length);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    cfb.set(marker, 8);
    expect(
      validateAttachmentMagic(
        cfb.buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("password_protected");
  });

  it("accepts a PDF header after only a BOM and whitespace prefix", () => {
    const bytes = new Uint8Array(1024);
    bytes.set(new TextEncoder().encode("\ufeff\n%PDF-1.7"), 0);

    expect(validateAttachmentMagic(bytes.buffer, "application/pdf")).toBe("ok");
  });

  it("rejects a PDF marker hidden inside a JPEG polyglot", () => {
    const bytes = new Uint8Array(128);
    bytes.set([0xff, 0xd8, 0xff], 0);
    bytes.set(new TextEncoder().encode("%PDF-1.7"), 100);

    expect(validateAttachmentMagic(bytes.buffer, "application/pdf")).toBe(
      "malformed",
    );
  });

  it.each(["heim", "heis", "hevm", "hevs", "avif"])(
    "accepts the supported HEIF brand %s",
    (brand) => {
      const bytes = new Uint8Array(12);
      bytes.set([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70]);
      bytes.set(new TextEncoder().encode(brand), 8);

      expect(validateAttachmentMagic(bytes.buffer, "image/heic")).toBe("ok");
    },
  );
});
