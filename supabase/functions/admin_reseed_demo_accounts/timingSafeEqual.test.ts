import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "./timingSafeEqual.ts";

describe("timingSafeEqual (admin_reseed_demo_accounts bearer-secret check)", () => {
  it("returns true for two identical strings", () => {
    // Arrange
    const a = "super-secret-value";
    const b = "super-secret-value";

    // Act
    const result = timingSafeEqual(a, b);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false when the strings differ only in the last byte", () => {
    // Arrange
    const a = "super-secret-valueA";
    const b = "super-secret-valueB";

    // Act / Assert
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false when the strings differ only in the first byte", () => {
    // Arrange
    const a = "Xuper-secret-value";
    const b = "Yuper-secret-value";

    // Act / Assert
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false when the strings have different lengths", () => {
    expect(timingSafeEqual("short", "a-lot-longer-string")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
