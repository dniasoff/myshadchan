import { describe, expect, it } from "vitest";

import {
  displaySuggestedByPhone,
  resolveSuggestedByValues,
  suggestedByPhoneForName,
  suggestedByPhoneHref,
  suggestedByPhoneSearchDigits,
  validateSuggestedByName,
  validateSuggestedByPhone,
} from "./suggestedBy";

describe("SuggestedByFields", () => {
  it("keeps a friend in Suggested by without creating a shadchan", async () => {
    await expect(
      resolveSuggestedByValues({
        suggested_by_name: " Sara Cohen ",
        suggested_by_phone: " +1 (347) 555-0182 ",
      }),
    ).resolves.toEqual({
      suggestedByName: "Sara Cohen",
      suggestedByPhone: "+1 (347) 555-0182",
      shadchanId: null,
    });
  });

  it("matches the database length/control checks and sanitizes tel targets", () => {
    expect(validateSuggestedByPhone("347.555.0182")).toBeUndefined();
    expect(validateSuggestedByPhone("javascript:")).toBeUndefined();
    expect(validateSuggestedByPhone("x".repeat(41))).toContain("40");
    expect(validateSuggestedByPhone("347\n555")).toContain("ordinary");
    expect(validateSuggestedByName("x".repeat(201))).toContain("200");
    expect(validateSuggestedByName("Sara\u0000Cohen")).toContain("ordinary");
    expect(validateSuggestedByName("שרה כהן")).toBeUndefined();
    expect(suggestedByPhoneHref("+1 (347) 555-0182")).toBe("tel:+13475550182");
    expect(suggestedByPhoneHref("*~+1 (347) 555-0182~*")).toBe(
      "tel:+13475550182",
    );
    expect(suggestedByPhoneHref("javascript:")).toBeNull();
    expect(validateSuggestedByPhone(" ")).toBeUndefined();
  });

  it("only carries a phone when the Suggested-by name is valid", () => {
    expect(suggestedByPhoneForName(" Sara Cohen ", " +1 347-555-0182 ")).toBe(
      "+1 347-555-0182",
    );
    expect(suggestedByPhoneForName("Sara\u0000Cohen", "555-0100")).toBeNull();
    expect(suggestedByPhoneForName("Sara Cohen", "x".repeat(41))).toBeNull();
    expect(suggestedByPhoneForName("", "555-0100")).toBeNull();
  });

  it("strips edge decoration for display without changing phone digits", () => {
    expect(displaySuggestedByPhone("  *~(+1 347-555-0182)~*  ")).toBe(
      "+1 347-555-0182",
    );
    expect(suggestedByPhoneSearchDigits("*~(+1 347-555-0182)~*")).toBe(
      "13475550182",
    );
  });
});
