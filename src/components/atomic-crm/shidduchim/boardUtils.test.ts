import type { ShidduchSummary } from "../types";
import { formatRedtDate, getShidduchimByState } from "./boardUtils";

const makeShidduch = (
  overrides: Partial<ShidduchSummary> & Pick<ShidduchSummary, "id">,
): ShidduchSummary =>
  ({
    account_id: 1,
    single_id: 1,
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
