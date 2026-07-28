import { getAvatarIndex, getMonogram } from "./avatar";

describe("getMonogram", () => {
  it("takes the first and last initials of a two-part name", () => {
    expect(getMonogram("Ari Rosenberg")).toBe("AR");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(getMonogram("Boruch")).toBe("BO");
  });

  it("falls back to ? for an empty name", () => {
    expect(getMonogram(null)).toBe("?");
    expect(getMonogram("")).toBe("?");
  });
});

describe("getAvatarIndex", () => {
  it("is deterministic for the same seed", () => {
    expect(getAvatarIndex("Ari Rosenberg")).toBe(
      getAvatarIndex("Ari Rosenberg"),
    );
  });

  it("always returns an index within the 0-9 palette", () => {
    for (const seed of ["a", "Menachem Stern", "", "12345", "שמואל"]) {
      const index = getAvatarIndex(seed);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(9);
    }
  });
});
