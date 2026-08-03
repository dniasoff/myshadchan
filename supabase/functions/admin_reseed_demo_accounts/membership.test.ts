import { describe, expect, it, vi } from "vitest";

const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: (...args: [string]) => mockFrom(...args) },
}));

import {
  addTempMembership,
  removeTempMembership,
  roleForAccountKind,
  setTempActiveAccount,
} from "./membership.ts";

describe("roleForAccountKind", () => {
  it("maps a shadchanus account to the shadchan role", () => {
    expect(roleForAccountKind("shadchanus")).toBe("shadchan");
  });

  it("maps every other account kind to parent_admin", () => {
    expect(roleForAccountKind("household")).toBe("parent_admin");
  });
});

describe("addTempMembership", () => {
  it("returns the new membership row id on success", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 42 }, error: null }),
        }),
      }),
    });

    // Act
    const id = await addTempMembership("user-1", 7, "parent_admin");

    // Assert
    expect(id).toBe(42);
  });

  it("throws when the insert fails", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "fk violation" } }),
        }),
      }),
    });

    // Act / Assert
    await expect(
      addTempMembership("user-1", 7, "parent_admin"),
    ).rejects.toThrow("fk violation");
  });
});

describe("removeTempMembership", () => {
  it("returns ok: true on success", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    });

    // Act
    const result = await removeTempMembership(42);

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false with the error message instead of throwing — this is the exact swallowed-error regression: a caller that ignored this used to leave a stale active membership behind with no visible trace", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      delete: () => ({
        eq: () => Promise.resolve({ error: { message: "row locked" } }),
      }),
    });

    // Act
    const result = await removeTempMembership(42);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("row locked");
      expect(result.error).toContain("42");
    }
  });
});

describe("setTempActiveAccount", () => {
  it("resolves without throwing on success", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      upsert: () => Promise.resolve({ error: null }),
    });

    // Act / Assert
    await expect(setTempActiveAccount("user-1", 7)).resolves.toBeUndefined();
  });

  it("throws when the upsert fails", async () => {
    // Arrange
    mockFrom.mockReturnValue({
      upsert: () =>
        Promise.resolve({ error: { message: "constraint violated" } }),
    });

    // Act / Assert
    await expect(setTempActiveAccount("user-1", 7)).rejects.toThrow(
      "constraint violated",
    );
  });
});
