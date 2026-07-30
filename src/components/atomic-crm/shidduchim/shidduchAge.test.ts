import { commands } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";

import { computeAgeFromDob } from "./shidduchAge";

describe("computeAgeFromDob", () => {
  afterEach(async () => {
    // Undo the CDP timezone override from the negative-UTC-offset test below
    // so it cannot leak into any other test sharing this browser page
    // (`.claude/rules/testing.md` — test isolation).
    await commands.setTimezone("UTC");
  });

  it("returns the whole-year age when the birthday already happened this year", () => {
    // Arrange
    const referenceDate = new Date("2026-07-24T00:00:00.000Z");

    // Act
    const age = computeAgeFromDob("2000-01-15", referenceDate);

    // Assert
    expect(age).toBe(26);
  });

  it("has not yet counted this year's birthday when it hasn't happened yet", () => {
    // Arrange
    const referenceDate = new Date("2026-07-24T00:00:00.000Z");

    // Act
    const age = computeAgeFromDob("2000-12-15", referenceDate);

    // Assert
    expect(age).toBe(25);
  });

  it("counts the birthday on the exact anniversary date", () => {
    // Arrange
    const referenceDate = new Date("2026-07-24T00:00:00.000Z");

    // Act
    const age = computeAgeFromDob("2000-07-24", referenceDate);

    // Assert
    expect(age).toBe(26);
  });

  it("defaults to the current date when no reference date is given", () => {
    // Arrange
    const now = new Date();
    const twentyYearsAgo = new Date(now);
    twentyYearsAgo.setFullYear(now.getFullYear() - 20);
    const dob = twentyYearsAgo.toISOString().slice(0, 10);

    // Act
    const age = computeAgeFromDob(dob);

    // Assert
    expect(age).toBe(20);
  });

  // Review fix F5 (Story 5.2): `new Date(dob)` parses a date-only string as
  // UTC midnight; reading it back with local getters in a negative-UTC-offset
  // timezone rolls it back one calendar day. Every case above passes a
  // UTC-parsed `referenceDate` (a `Z`-suffixed ISO string), so both sides of
  // the comparison shifted by the same offset and the bug canceled out —
  // structurally blind to the class of bug this test targets. This one runs
  // in a real non-UTC timezone (via a Chrome DevTools Protocol override —
  // `process.env.TZ` has no effect inside a browser) and picks a reference
  // date the day *before* the birthday, the exact boundary the off-by-one
  // hits.
  it("does not roll the DOB back a day in a negative-UTC-offset timezone", async () => {
    // Arrange
    await commands.setTimezone("America/New_York");
    // One day before the 26th birthday, built from local components (not an
    // ISO string) so this reference date carries no UTC-parsing ambiguity of
    // its own.
    const referenceDate = new Date(2026, 6, 23);

    // Act
    const age = computeAgeFromDob("2000-07-24", referenceDate);

    // Assert — the birthday has not happened yet, so still 25.
    expect(age).toBe(25);
  });
});
