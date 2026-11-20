import { describe, expect, it, vi } from "vitest";

import type { CrmDataProvider } from "../providers/types";
import {
  resolveSuggestedByValues,
  suggestedByPhoneHref,
  validateSuggestedByName,
  validateSuggestedByPhone,
} from "./suggestedBy";

describe("SuggestedByFields", () => {
  it("keeps a friend in Suggested by without creating a shadchan", async () => {
    const create = vi.fn();
    const dataProvider = { create } as unknown as CrmDataProvider;

    await expect(
      resolveSuggestedByValues(dataProvider, {
        suggested_by_name: " Sara Cohen ",
        suggested_by_phone: " +1 (347) 555-0182 ",
        make_person_shadchan: false,
      }),
    ).resolves.toEqual({
      suggestedByName: "Sara Cohen",
      suggestedByPhone: "+1 (347) 555-0182",
      shadchanId: null,
      makePersonShadchan: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("records promotion intent without creating before the resolver owns the item", async () => {
    const create = vi.fn();
    const dataProvider = { create } as unknown as CrmDataProvider;

    await expect(
      resolveSuggestedByValues(dataProvider, {
        suggested_by_name: "Sara Cohen",
        suggested_by_phone: "347-555-0182",
        make_person_shadchan: true,
      }),
    ).resolves.toEqual({
      suggestedByName: "Sara Cohen",
      suggestedByPhone: "347-555-0182",
      shadchanId: null,
      makePersonShadchan: true,
    });
    expect(create).not.toHaveBeenCalled();
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
    expect(suggestedByPhoneHref("javascript:")).toBeNull();
    expect(validateSuggestedByPhone(" ")).toBeUndefined();
  });
});
