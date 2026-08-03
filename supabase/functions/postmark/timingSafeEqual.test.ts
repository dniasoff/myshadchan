import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "./timingSafeEqual.ts";

describe("timingSafeEqual (Story 10.3 review fix F-D)", () => {
  it("returns true for two identical strings", () => {
    // Arrange
    const a = "Basic dGVzdHVzZXI6dGVzdHB3ZA==";
    const b = "Basic dGVzdHVzZXI6dGVzdHB3ZA==";

    // Act
    const result = timingSafeEqual(a, b);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false when the strings differ only in the last byte", () => {
    // Arrange
    const a = "Basic dGVzdHVzZXI6dGVzdHB3ZA==";
    const b = "Basic dGVzdHVzZXI6dGVzdHB3ZB==";

    // Act / Assert
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false when the strings differ only in the first byte", () => {
    // Arrange
    const a = "Basic dGVzdHVzZXI6dGVzdHB3ZA==";
    const b = "asic dGVzdHVzZXI6dGVzdHB3ZA==X";

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
