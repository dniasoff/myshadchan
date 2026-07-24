import { describe, expect, it } from "vitest";

import { usagePercent } from "./billingPlans";

/**
 * The usage meter's only arithmetic (E4). It must stay calm and safe: never
 * exceed 100%, never go negative, and never divide by a zero (free-tier) limit.
 */
describe("usagePercent", () => {
  it("returns the rounded proportion of used to limit", () => {
    // Arrange
    const used = 34;
    const limit = 100;

    // Act
    const result = usagePercent(used, limit);

    // Assert
    expect(result).toBe(34);
  });

  it("rounds to the nearest whole percent", () => {
    // Arrange / Act
    const result = usagePercent(1, 3);

    // Assert — 33.33% rounds to 33
    expect(result).toBe(33);
  });

  it("returns 0 for a zero limit (the free tier) instead of dividing by zero", () => {
    // Arrange / Act
    const result = usagePercent(5, 0);

    // Assert
    expect(result).toBe(0);
  });

  it("clamps to 100 when usage somehow exceeds the limit", () => {
    // Arrange / Act
    const result = usagePercent(150, 100);

    // Assert
    expect(result).toBe(100);
  });

  it("clamps to 0 for negative usage", () => {
    // Arrange / Act
    const result = usagePercent(-10, 100);

    // Assert
    expect(result).toBe(0);
  });
});
