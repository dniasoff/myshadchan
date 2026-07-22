import type { ShidduchSummary } from "../types";
import {
  formatRedtDate,
  getAvatarIndex,
  getMonogram,
  getShidduchimByState,
} from "./boardUtils";

const makeShidduch = (
  overrides: Partial<ShidduchSummary> & Pick<ShidduchSummary, "id">,
): ShidduchSummary =>
  ({
    account_id: 1,
    child_id: 1,
    pipeline_state: "new",
    redt_date: "2026-07-01",
    first_suggested_at: "2026-07-01T00:00:00.000Z",
    origin: "manual",
    visibility: "shared",
    index: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }) as ShidduchSummary;

describe("getShidduchimByState", () => {
  it("groups shidduchim into all 7 state buckets", () => {
    const result = getShidduchimByState([]);
    expect(Object.keys(result).sort()).toEqual(
      [
        "for_sure_not",
        "look_into",
        "new",
        "no",
        "not_sure",
        "unsure",
        "yes",
      ].sort(),
    );
    expect(result.new).toEqual([]);
  });

  it("orders each column by index ascending", () => {
    // Arrange
    const items = [
      makeShidduch({ id: 1, pipeline_state: "new", index: 2 }),
      makeShidduch({ id: 2, pipeline_state: "new", index: 0 }),
      makeShidduch({ id: 3, pipeline_state: "new", index: 1 }),
    ];
    // Act
    const result = getShidduchimByState(items);
    // Assert
    expect(result.new.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it("buckets an unknown state into the first column rather than dropping it", () => {
    const items = [
      makeShidduch({
        id: 9,
        pipeline_state: "bogus" as ShidduchSummary["pipeline_state"],
      }),
    ];
    const result = getShidduchimByState(items);
    expect(result.new.map((s) => s.id)).toEqual([9]);
  });
});

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

describe("formatRedtDate", () => {
  it("formats a YYYY-MM-DD date as a readable redt date", () => {
    expect(formatRedtDate("2026-07-20")).toBe("20 Jul 2026");
  });

  it("returns an empty string for a missing date", () => {
    expect(formatRedtDate(null)).toBe("");
    expect(formatRedtDate(undefined)).toBe("");
  });

  it("passes through an unparseable value unchanged", () => {
    expect(formatRedtDate("not-a-date")).toBe("not-a-date");
  });
});
