import { describe, it, expect } from "vitest";
import { buildInboxItemPayload } from "./buildInboxItemPayload";

describe("buildInboxItemPayload", () => {
  it("builds an unresolved email inbox row from a full capture", () => {
    // Arrange
    const input = {
      accountId: 7,
      textBody: "  A wonderful boy for Rivky — Dovid Berkowitz, BMG.  ",
      subject: "  A suggestion  ",
      sender: "mrs.feldman@example.com",
      attachments: [{ path: "inbox/resume.pdf" }] as never,
    };

    // Act
    const row = buildInboxItemPayload(input);

    // Assert
    expect(row).toEqual({
      account_id: 7,
      source: "email",
      raw_text: "A wonderful boy for Rivky — Dovid Berkowitz, BMG.",
      subject: "A suggestion",
      sender: "mrs.feldman@example.com",
      attachments: [{ path: "inbox/resume.pdf" }],
      status: "unresolved",
    });
  });

  it("collapses empty text, subject, sender, and attachments to null", () => {
    // Arrange
    const input = {
      accountId: 3,
      textBody: "   ",
      subject: "",
      sender: undefined,
      attachments: [],
    };

    // Act
    const row = buildInboxItemPayload(input);

    // Assert
    expect(row.raw_text).toBeNull();
    expect(row.subject).toBeNull();
    expect(row.sender).toBeNull();
    expect(row.attachments).toBeNull();
    expect(row.account_id).toBe(3);
    expect(row.status).toBe("unresolved");
  });
});
