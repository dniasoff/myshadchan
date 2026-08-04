import { describe, expect, it } from "vitest";
import { parseEmail } from "./parseEmail";
import { buildRawEmail, streamFromString } from "./emailFixtures";

describe("parseEmail", () => {
  it("parses from/subject/text from a real multipart MIME message", async () => {
    // Arrange
    const raw = buildRawEmail({
      from: '"Mrs. Feldman" <mrs.feldman@example.com>',
      subject: "A resume for Rivky",
      textBody: "Hi, please see the attached resume for Rivky.",
    });

    // Act
    const parsed = await parseEmail(streamFromString(raw));

    // Assert
    expect(parsed.fromEmail).toBe("mrs.feldman@example.com");
    expect(parsed.fromName).toBe("Mrs. Feldman");
    expect(parsed.subject).toBe("A resume for Rivky");
    expect(parsed.text?.trim()).toBe(
      "Hi, please see the attached resume for Rivky.",
    );
  });

  it("parses a real attachment out of the multipart body", async () => {
    // Arrange
    const raw = buildRawEmail({
      attachmentFilename: "resume.pdf",
      attachmentContent: "PDF-DATA-BYTES",
      attachmentContentType: "application/pdf",
    });

    // Act
    const parsed = await parseEmail(streamFromString(raw));

    // Assert
    expect(parsed.attachments).toHaveLength(1);
    const [attachment] = parsed.attachments;
    expect(attachment.filename).toBe("resume.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.content).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(attachment.content)).toBe("PDF-DATA-BYTES");
  });

  it("returns an empty attachment list for a message with no attachment", async () => {
    // Arrange
    const raw = buildRawEmail({ attachmentFilename: null });

    // Act
    const parsed = await parseEmail(streamFromString(raw));

    // Assert
    expect(parsed.attachments).toEqual([]);
  });

  it("resolves the recipient address from the To header", async () => {
    // Arrange
    const raw = buildRawEmail({ to: "abc123def456@myshadchan.space" });

    // Act
    const parsed = await parseEmail(streamFromString(raw));

    // Assert
    expect(parsed.toEmails).toEqual(["abc123def456@myshadchan.space"]);
  });
});
