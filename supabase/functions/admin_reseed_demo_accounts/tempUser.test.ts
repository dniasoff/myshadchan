import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockDeleteUser = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: (...args: [unknown]) => mockCreateUser(...args),
        deleteUser: (...args: [string]) => mockDeleteUser(...args),
      },
    },
    from: (...args: [string]) => mockFrom(...args),
  },
}));

import { createTempUser, deleteTempUser } from "./tempUser.ts";

/** Arranges the `public.members` row delete (the first step of
 * `deleteTempUser`, see its own comment) to resolve with the given error,
 * and records every table name `.from()` was called with. */
function arrangeMembersDelete(error: { message: string } | null) {
  mockFrom.mockReturnValue({
    delete: () => ({ eq: () => Promise.resolve({ error }) }),
  });
}

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

  it("throws a useful message instead of the literal string 'undefined' when the API returns no user and no error", async () => {
    // Arrange
    mockCreateUser.mockResolvedValue({ data: { user: null }, error: null });

    // Act / Assert
    await expect(createTempUser()).rejects.toThrow("no user returned");
  });
});

describe("deleteTempUser", () => {
  it("returns ok: true and never throws on success", async () => {
    // Arrange
    arrangeMembersDelete(null);
    mockDeleteUser.mockResolvedValue({ error: null });

    // Act
    const result = await deleteTempUser("user-123");

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it("deletes the public.members row before deleting the auth user, so members_user_id_fkey (no ON DELETE action) never blocks the auth delete", async () => {
    // Arrange
    const callOrder: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      callOrder.push(`from:${table}`);
      return { delete: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });
    mockDeleteUser.mockImplementation(() => {
      callOrder.push("auth.deleteUser");
      return Promise.resolve({ error: null });
    });

    // Act
    await deleteTempUser("user-123");

    // Assert: this is the production defect's actual root cause — the
    // members row (created by the on_auth_user_created trigger for every
    // temp user) must be gone before auth.users' own delete is attempted.
    expect(mockFrom).toHaveBeenCalledWith("members");
    expect(callOrder).toEqual(["from:members", "auth.deleteUser"]);
  });

  it("surfaces the real error, not the literal string '{}', when auth.admin.deleteUser fails with an auth-js retryable-fetch-style error", async () => {
    // Arrange: reproduces the exact production shape — auth-js's
    // `_getErrorMessage` stringifies the raw Response for any 5xx, which
    // always serializes to the empty object "{}" (see errorMessage.ts's doc
    // comment on formatSupabaseError). The real diagnostic instead lives in
    // `.status`/`.name`, which auth-js sets as real own properties.
    arrangeMembersDelete(null);
    mockDeleteUser.mockResolvedValue({
      error: { message: "{}", name: "AuthRetryableFetchError", status: 500 },
    });

    // Act
    const result = await deleteTempUser("user-123");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(": {}");
      expect(result.error).toContain("AuthRetryableFetchError");
      expect(result.error).toContain("500");
      expect(result.error).toContain("user-123");
    }
  });

  it("returns ok: false with the error message instead of throwing, so a failed deletion is never silently lost", async () => {
    // Arrange
    arrangeMembersDelete(null);
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

  it("surfaces a failed members-row delete directly and never attempts auth.admin.deleteUser, since that call would only repeat the same foreign-key violation", async () => {
    // Arrange
    arrangeMembersDelete({ message: "row is in use" });

    // Act
    const result = await deleteTempUser("user-123");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("row is in use");
      expect(result.error).toContain("user-123");
    }
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});
