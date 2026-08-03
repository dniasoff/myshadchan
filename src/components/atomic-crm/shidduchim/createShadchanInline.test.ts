import { describe, expect, it, vi } from "vitest";

import type { CrmDataProvider } from "../providers/types";
import { createShadchanInline } from "./createShadchanInline";

/**
 * Review fix (F4, MEDIUM, Story 10.1): `ShidduchInputs.tsx`'s
 * `onCreateShadchan` prop shipped with no caller ever supplying it — this
 * pins the one function every real caller (`ShareTarget.tsx`,
 * `InboxResolveDialog.tsx`, `ShidduchCreate.tsx`) now shares, so a future
 * change to how "+ Add a shadchan" creates a row is exercised once, not
 * three times over (or missed three times over).
 */
describe("createShadchanInline (AC 3 / FR78)", () => {
  it("creates a shadchanim row named after the typed filter and returns it", async () => {
    // Arrange
    const create = vi
      .fn()
      .mockResolvedValue({ data: { id: 42, name: "Devorah" } });
    const dataProvider = { create } as unknown as CrmDataProvider;
    const onCreate = createShadchanInline(dataProvider);

    // Act
    const result = await onCreate!("Devorah");

    // Assert
    expect(create).toHaveBeenCalledWith("shadchanim", {
      data: { name: "Devorah" },
    });
    expect(result).toEqual({ id: 42, name: "Devorah" });
  });

  it("falls back to an empty name when the autocomplete calls it with no filter", async () => {
    // Arrange — AutocompleteInput's onCreate is typed to allow a missing
    // filter; the underlying create must still receive a string, never
    // undefined, since `shadchanim.name` is not-null.
    const create = vi.fn().mockResolvedValue({ data: { id: 43, name: "" } });
    const dataProvider = { create } as unknown as CrmDataProvider;
    const onCreate = createShadchanInline(dataProvider);

    // Act
    await onCreate!(undefined);

    // Assert
    expect(create).toHaveBeenCalledWith("shadchanim", {
      data: { name: "" },
    });
  });
});
