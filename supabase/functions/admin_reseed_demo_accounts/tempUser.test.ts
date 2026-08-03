import { describe, expect, it, vi } from "vitest";

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockDeleteUser = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: (...args: [unknown]) => mockCreateUser(...args),
        deleteUser: (...args: [string]) => mockDeleteUser(...args),
      },
    },
  },
}));

import { createTempUser, deleteTempUser } from "./tempUser.ts";

describe("createTempUser", () => {
  it("returns the created user's id, email and password on success", async () => {
    // Arrange
    mockCreateUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });

    // Act
    const result = await createTempUser();

    // Assert
    expect(result.id).toBe("user-123");
    expect(result.email).toContain("@atomic-crm-demo.internal");
    expect(result.password.length).toBeGreaterThan(0);
  });

  it("throws when auth.admin.createUser reports an error", async () => {
    // Arrange
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "quota exceeded" },
    });

    // Act / Assert
    await expect(createTempUser()).rejects.toThrow("quota exceeded");
  });
});

describe("deleteTempUser", () => {
  it("returns ok: true and never throws on success", async () => {
    // Arrange
    mockDeleteUser.mockResolvedValue({ error: null });

    // Act
    const result = await deleteTempUser("user-123");

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false with the error message instead of throwing, so a failed deletion is never silently lost", async () => {
    // Arrange
    mockDeleteUser.mockResolvedValue({ error: { message: "not found" } });

    // Act
    const result = await deleteTempUser("user-123");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("user-123");
    }
  });
});
