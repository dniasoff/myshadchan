import { describe, expect, it, vi } from "vitest";

import type { CrmDataProvider } from "../providers/types";
import {
  resolveSuggestedByValues,
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
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a shadchan only for the explicit promotion", async () => {
    const create = vi.fn().mockResolvedValue({
      data: { id: 88, name: "Sara Cohen" },
    });
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
      shadchanId: 88,
    });
    expect(create).toHaveBeenCalledWith("shadchanim", {
      data: { name: "Sara Cohen" },
    });
  });

  it("rejects phone punctuation that cannot be safely understood as a phone", () => {
    expect(validateSuggestedByPhone("347.555.0182")).toContain("Use digits");
    expect(validateSuggestedByPhone("+1 (347) 555-0182")).toBeUndefined();
    expect(validateSuggestedByPhone(" ")).toBeUndefined();
  });
});
