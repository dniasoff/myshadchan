import { describe, expect, it } from "vitest";

import { isSingleSubject, resumeSubjectFilter } from "./resumeSubject";

describe("isSingleSubject", () => {
  it("returns true for a single-owned subject", () => {
    // Arrange
    const subject = { singleId: 7 };

    // Act
    const result = isSingleSubject(subject);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false for a shidduch-owned subject", () => {
    // Arrange
    const subject = { shidduchimId: 3 };

    // Act
    const result = isSingleSubject(subject);

    // Assert
    expect(result).toBe(false);
  });
});

describe("resumeSubjectFilter", () => {
  it("resolves a single-owned subject to a single_id filter", () => {
    // Arrange
    const subject = { singleId: 7 };

    // Act
    const filter = resumeSubjectFilter(subject);

    // Assert
    expect(filter).toEqual({ single_id: 7 });
  });

  it("resolves a shidduch-owned subject to a shidduchim_id filter", () => {
    // Arrange
    const subject = { shidduchimId: 3 };

    // Act
    const filter = resumeSubjectFilter(subject);

    // Assert
    expect(filter).toEqual({ shidduchim_id: 3 });
  });
});
