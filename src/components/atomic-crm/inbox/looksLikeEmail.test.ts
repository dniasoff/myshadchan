import { describe, expect, it } from "vitest";

import { looksLikeEmail } from "./looksLikeEmail";

describe("looksLikeEmail", () => {
  it("accepts a plain, well-shaped address", () => {
    // Arrange
    const value = "feldman@example.com";

    // Act
    const result = looksLikeEmail(value);

    // Assert
    expect(result).toBe(true);
  });

  it("rejects null", () => {
    // Arrange / Act
    const result = looksLikeEmail(null);

    // Assert
    expect(result).toBe(false);
  });

  it("rejects undefined", () => {
    // Arrange / Act
    const result = looksLikeEmail(undefined);

    // Assert
    expect(result).toBe(false);
  });

  it("rejects a plain display name with no address — the FR24 forwarded-sender shape", () => {
    // Arrange
    const value = "Mrs. Feldman";

    // Act
    const result = looksLikeEmail(value);

    // Assert
    expect(result).toBe(false);
  });

  it("rejects an 11-character non-email token — the real misconfiguration incident this guard exists for", () => {
    // Arrange
    const value = "n3f8x7k2p9q";

    // Act
    const result = looksLikeEmail(value);

    // Assert
    expect(result).toBe(false);
  });

  it("rejects an empty string", () => {
    // Arrange / Act
    const result = looksLikeEmail("");

    // Assert
    expect(result).toBe(false);
  });
});
