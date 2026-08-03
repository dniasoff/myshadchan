import { describe, expect, it } from "vitest";
import { findResumeAttachment } from "./inboxAttachment";

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
});
