import { describe, expect, it } from "vitest";
import { buildInboxItemRow } from "./buildInboxItemRow";
import type { UploadedAttachment } from "./attachments";

const NOT_A_FORWARD = { name: null, email: null, needsConfirmation: false };

describe("buildInboxItemRow", () => {
  it("files a known sender's email as unresolved", () => {
    // Arrange
    const input = {
      textBody: "Hi, I have a suggestion.",
      subject: "A redt",
      originalSender: NOT_A_FORWARD,
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.status).toBe("unresolved");
  });

  it("files an unknown sender's email as held, never dismissed or dropped", () => {
    // Arrange
    const input = {
      textBody: "Hi, I have a suggestion.",
      subject: "A redt",
      originalSender: NOT_A_FORWARD,
      attachments: [] as UploadedAttachment[],
      classification: "unknown" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.status).toBe("held");
    expect(row.raw_text).toBe("Hi, I have a suggestion.");
  });

  it("collapses empty text and subject to null", () => {
    // Arrange
    const input = {
      textBody: "   ",
      subject: "",
      originalSender: NOT_A_FORWARD,
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.raw_text).toBeNull();
    expect(row.subject).toBeNull();
  });

  it("collapses an empty attachment list to null", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: NOT_A_FORWARD,
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.attachments).toBeNull();
  });

  it("carries a non-empty attachment list through untouched", () => {
    // Arrange
    const attachment: UploadedAttachment = {
      title: "resume.pdf",
      type: "application/pdf",
      path: "1/abc.pdf",
      src: "https://example.supabase.co/signed/abc",
    };
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: NOT_A_FORWARD,
      attachments: [attachment],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.attachments).toEqual([attachment]);
  });

  it("prefers the recovered sender's name over their email", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: {
        name: "Mrs. Feldman",
        email: "mrs.feldman@example.com",
        needsConfirmation: false,
      },
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender).toBe("Mrs. Feldman");
    expect(row.sender_needs_confirmation).toBe(false);
  });

  it("falls back to the recovered email when no name was recovered", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: {
        name: null,
        email: "mrs.feldman@example.com",
        needsConfirmation: false,
      },
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender).toBe("mrs.feldman@example.com");
  });

  it("leaves sender null and flags confirmation when recovery was ambiguous", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: { name: null, email: null, needsConfirmation: true },
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender).toBeNull();
    expect(row.sender_needs_confirmation).toBe(true);
  });

  it("always sets source to email", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: NOT_A_FORWARD,
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.source).toBe("email");
  });
});
