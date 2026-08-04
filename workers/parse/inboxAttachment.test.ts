import { describe, expect, it } from "vitest";
import { findResumeAttachment, splitStoragePath } from "./inboxAttachment";

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
