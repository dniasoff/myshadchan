import { describe, expect, it } from "vitest";
import { buildInboxItemRow } from "./buildInboxItemRow";
import type { UploadedAttachment } from "./attachments";

const NOT_A_FORWARD = { name: null, email: null, needsConfirmation: false };
const ENVELOPE_SENDER = "known.parent@example.com";

describe("buildInboxItemRow", () => {
  it("files a known sender's email as unresolved", () => {
    // Arrange
    const input = {
      textBody: "Hi, I have a suggestion.",
      subject: "A redt",
      originalSender: NOT_A_FORWARD,
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
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
      senderEmail: ENVELOPE_SENDER,
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.source).toBe("email");
  });

  it("persists the envelope sender into sender_email, distinct from the FR24-recovered sender field", () => {
    // Arrange — a forwarded email: the envelope sender is the person who
    // FORWARDED it, but `originalSender` (FR24 recovery) attributes the note
    // to whoever the forwarded body says wrote it originally. These must
    // stay two different values in the row — this test would fail if
    // someone wired `originalSender` into `sender_email` by mistake.
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: {
        name: "Mrs. Feldman",
        email: "mrs.feldman@example.com",
        needsConfirmation: false,
      },
      senderEmail: "known.parent@example.com",
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender_email).toBe("known.parent@example.com");
    expect(row.sender).toBe("Mrs. Feldman");
    expect(row.sender_email).not.toBe(row.sender);
  });

  it("persists sender_email even when no forward was ever detected (originalSender is null)", () => {
    // Arrange — the common case this fix exists for: a direct, non-forwarded
    // email has no recoverable original sender at all, yet the envelope
    // sender is always present.
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: NOT_A_FORWARD,
      senderEmail: "direct.sender@example.com",
      attachments: [] as UploadedAttachment[],
      classification: "unknown" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender).toBeNull();
    expect(row.sender_email).toBe("direct.sender@example.com");
  });

  it("does not lowercase sender_email — the column is citext and normalises itself", () => {
    // Arrange
    const input = {
      textBody: "text",
      subject: "subject",
      originalSender: NOT_A_FORWARD,
      senderEmail: "Mixed.Case@Example.com",
      attachments: [] as UploadedAttachment[],
      classification: "known" as const,
    };

    // Act
    const row = buildInboxItemRow(input);

    // Assert
    expect(row.sender_email).toBe("Mixed.Case@Example.com");
  });
});
