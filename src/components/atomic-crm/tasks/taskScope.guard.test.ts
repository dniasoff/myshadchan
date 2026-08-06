import { describe, expect, it } from "vitest";

/**
 * AC-1's whole diagnosis (contract §8) was one line:
 * `filter: { member_id: identity?.id }`, sent unconditionally, on every
 * `/tasks` load. A behaviour test against a mocked data provider can only
 * prove the CURRENT scope logic works — it cannot prove a future edit
 * didn't put the unconditional filter back (a copy-paste from an older
 * branch, a "just for now" debug tweak). This scans the raw source instead
 * — the same `?raw` idiom `entity360/tabs/TasksRailSummary.guard.test.ts`
 * uses — so the regression is caught by CI regardless of which behaviour
 * test happens to still pass.
 *
 * Shown red first (contract §13 rule 2): the second `it` below asserts the
 * regex fires on a literal copy of the pre-story defect line, proving this
 * guard is not vacuous. The guard was also run directly against a
 * deliberately reverted copy of `TasksListByDueDate.tsx` (the real
 * pre-fix source) and failed — see the story's Dev Agent Record -> Debug
 * Log References for the captured `npx vitest run` output.
 */

const sources = import.meta.glob("./TasksListByDueDate.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SOURCE = Object.values(sources)[0];

// The exact shape of the original defect: `filter:` immediately followed by
// an object literal containing `member_id`, with no scope condition between
// them. The fixed line wraps this in a `scope === "mine" ? { member_id: ... }
// : {}` ternary, which this regex does NOT match, because `filter:` is not
// immediately followed by `{`.
const UNCONDITIONAL_MEMBER_ID_FILTER = /filter:\s*\{\s*member_id\s*:/;

describe("TasksListByDueDate never sends member_id unconditionally (AC-1)", () => {
  it("has a source to scan", () => {
    // Sanity check for the glob pattern itself — if this ever fails, the
    // checks below would pass vacuously on an empty string.
    expect(typeof SOURCE).toBe("string");
    expect(SOURCE.length).toBeGreaterThan(0);
  });

  it("the guard regex actually fires on the original defect shape (not vacuous)", () => {
    const originalDefect = "filter: { member_id: identity?.id },";
    expect(UNCONDITIONAL_MEMBER_ID_FILTER.test(originalDefect)).toBe(true);
  });

  it("does not contain an unconditional member_id filter", () => {
    expect(UNCONDITIONAL_MEMBER_ID_FILTER.test(SOURCE)).toBe(false);
  });
});
