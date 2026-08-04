import { describe, expect, it } from "vitest";
import { extractOriginalSender } from "./forwardedSender";

/**
 * `extractOriginalSender` is ported verbatim from
 * `supabase/functions/postmark/forwardedParser.ts` (see this file's own doc
 * comment) — this suite mirrors a representative subset of that module's
 * own `forwardedParser.test.ts` to confirm the porting preserved behaviour,
 * not the full original suite.
 */
describe("extractOriginalSender", () => {
  it("returns not-a-forward when no separator is present", () => {
    // Arrange
    const body = "Hi, I have a suggestion for Rivky.";

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: null,
      email: null,
      needsConfirmation: false,
    });
  });

  it("confidently recovers the original sender from a Gmail forward", () => {
    // Arrange
    const body = [
      "---------- Forwarded message ----------",
      "From: Mrs. Feldman <mrs.feldman@example.com>",
      "Date: Mon, 21 Jul 2026 10:00:00 +0000",
      "Subject: A suggestion",
      "To: member@example.com",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: "Mrs. Feldman",
      email: "mrs.feldman@example.com",
      needsConfirmation: false,
    });
  });

  it("confidently recovers the original sender from Outlook forwards", () => {
    // Arrange
    const body = [
      "-----Original Message-----",
      "From: Mrs. Feldman <mrs.feldman@example.com>",
      "Sent: Monday, July 21, 2026 10:00 AM",
      "To: member@example.com",
      "Subject: A suggestion",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: "Mrs. Feldman",
      email: "mrs.feldman@example.com",
      needsConfirmation: false,
    });
  });

  it("flags doubly-forwarded messages as ambiguous", () => {
    // Arrange
    const body = [
      "---------- Forwarded message ----------",
      "From: member@example.com",
      "",
      "---------- Forwarded message ----------",
      "From: mrs.feldman@example.com",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: null,
      email: null,
      needsConfirmation: true,
    });
  });

  it("flags a forward block with no From-style line as ambiguous", () => {
    // Arrange
    const body = [
      "---------- Forwarded message ----------",
      "Date: Mon, 21 Jul 2026 10:00:00 +0000",
      "Subject: A suggestion",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: null,
      email: null,
      needsConfirmation: true,
    });
  });

  it("flags a forward block with multiple From-style lines as ambiguous", () => {
    // Arrange
    const body = [
      "---------- Forwarded message ----------",
      "From: Mrs. Feldman <mrs.feldman@example.com>",
      "From: Another Shadchan <another@example.com>",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result).toEqual({
      name: null,
      email: null,
      needsConfirmation: true,
    });
  });

  it("lowercases the recovered email so JS-side self-reference checks work", () => {
    // Arrange
    const body = [
      "---------- Forwarded message ----------",
      "From: Mrs. Feldman <Mrs.Feldman@Example.COM>",
      "",
      "Hi, I have a suggestion for Rivky.",
    ].join("\n");

    // Act
    const result = extractOriginalSender(body);

    // Assert
    expect(result.email).toBe("mrs.feldman@example.com");
  });
});
