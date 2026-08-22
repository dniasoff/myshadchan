import { describe, expect, it } from "vitest";

import {
  assertNoKnownHalachicConflict,
  hasKnownHalachicConflict,
} from "./halachicEligibility";

describe("halachic eligibility", () => {
  it("blocks the two explicit same-gender cases", () => {
    expect(
      hasKnownHalachicConflict({ gender: "female" }, { gender: "female" }),
    ).toBe(true);
    expect(
      hasKnownHalachicConflict({ gender: "male" }, { gender: "male" }),
    ).toBe(true);
    expect(
      hasKnownHalachicConflict({ gender: "female" }, { gender: "male" }),
    ).toBe(false);
  });

  it("blocks a known Kohen and clearly identified divorcee either way", () => {
    expect(
      hasKnownHalachicConflict(
        { kohen_status: "yes" },
        { marital_status: "divorced" },
      ),
    ).toBe(true);
    expect(
      hasKnownHalachicConflict(
        { marital_status: "gerushah" },
        { kohen_status: "kohen" },
      ),
    ).toBe(true);
  });

  it("allows unknown and non-standard facts", () => {
    expect(
      hasKnownHalachicConflict(
        { gender: "unknown", kohen_status: null },
        { gender: "female", marital_status: "separated" },
      ),
    ).toBe(false);
    expect(() =>
      assertNoKnownHalachicConflict({ gender: "other" }, { gender: "other" }),
    ).not.toThrow();
  });
});
