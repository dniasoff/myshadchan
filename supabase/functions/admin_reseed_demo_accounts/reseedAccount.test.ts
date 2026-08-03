import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as InvokeDemoFunctionModule from "./invokeDemoFunction.ts";

/**
 * Regression coverage for the review finding: `removeTempMembership`'s
 * error used to be swallowed in a `finally` block, and a shared temp user
 * being reused across accounts meant a leftover `active` membership row
 * from a failed cleanup could be picked up by `resolveAccountId` on a LATER
 * account's iteration ("first active membership by id" for that user id) —
 * silently re-processing an already-done account while skipping the one
 * the loop believed it was handling, and still reporting success.
 *
 * `reseedAccount.ts` now (a) gives every account its own temp user, so a
 * leftover row can never belong to a user id a later account reuses, and
 * (b) independently confirms `resolveAccountId` resolves to the intended
 * account before invoking anything destructive, refusing (not proceeding)
 * when it does not. These tests exercise both layers plus the
 * previously-swallowed cleanup-error path and the not-transactional
 * clear_demo -> seed_demo gap.
 */

const mockCreateTempUser = vi.hoisted(() => vi.fn());
const mockDeleteTempUser = vi.hoisted(() => vi.fn());
const mockSignInTempUser = vi.hoisted(() => vi.fn());
const mockAddTempMembership = vi.hoisted(() => vi.fn());
const mockRemoveTempMembership = vi.hoisted(() => vi.fn());
const mockSetTempActiveAccount = vi.hoisted(() => vi.fn());
const mockResolveAccountId = vi.hoisted(() => vi.fn());
const mockClearAndSeedWithRetry = vi.hoisted(() => vi.fn());

vi.mock("./tempUser.ts", () => ({
  createTempUser: mockCreateTempUser,
  deleteTempUser: mockDeleteTempUser,
  signInTempUser: mockSignInTempUser,
}));

vi.mock("./membership.ts", () => ({
  addTempMembership: mockAddTempMembership,
  removeTempMembership: mockRemoveTempMembership,
  setTempActiveAccount: mockSetTempActiveAccount,
  roleForAccountKind: (kind: string) =>
    kind === "shadchanus" ? "shadchan" : "parent_admin",
}));

vi.mock("../_shared/resolveDemoAccount.ts", () => ({
  resolveAccountId: mockResolveAccountId,
}));

vi.mock("./invokeDemoFunction.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof InvokeDemoFunctionModule>();
  return {
    ...actual,
    clearAndSeedWithRetry: mockClearAndSeedWithRetry,
  };
});

import { ClearSeedError } from "./invokeDemoFunction.ts";
import { reseedAccount } from "./reseedAccount.ts";

const TEMP_USER = { id: "temp-user-1", email: "a@b.test", password: "pw" };

function arrangeHappyPathScaffolding() {
  mockCreateTempUser.mockResolvedValue(TEMP_USER);
  mockSignInTempUser.mockResolvedValue("access-token");
  mockAddTempMembership.mockResolvedValue(42);
  mockSetTempActiveAccount.mockResolvedValue(undefined);
  mockRemoveTempMembership.mockResolvedValue({ ok: true });
  mockDeleteTempUser.mockResolvedValue({ ok: true });
}

describe("reseedAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeHappyPathScaffolding();
  });

  it("refuses to reseed when resolveAccountId does not confirm the intended account, and never invokes clear/seed", async () => {
    // Arrange: simulates the exact stale-membership scenario — the temp
    // user's resolved account (999) does not match the account this
    // iteration was asked to process (123).
    mockResolveAccountId.mockResolvedValue(999);

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert: refused, not silently redirected.
    expect(result.status).toBe("skipped");
    expect(result.dataState).toBe("unknown");
    expect(result.cleared).toBe(false);
    expect(result.seeded).toBe(false);
    expect(result.error).toContain("999");
    expect(result.error).toContain("123");
    expect(mockClearAndSeedWithRetry).not.toHaveBeenCalled();

    // Cleanup still ran for the temp scaffolding this iteration created.
    expect(mockRemoveTempMembership).toHaveBeenCalledWith(42);
    expect(mockDeleteTempUser).toHaveBeenCalledWith(TEMP_USER.id);
  });

  it("proceeds and succeeds when resolveAccountId confirms the intended account", async () => {
    // Arrange
    mockResolveAccountId.mockResolvedValue(123);
    mockClearAndSeedWithRetry.mockResolvedValue({
      cleared: true,
      seeded: true,
      summary: { seeded: true, singles: 2 },
    });

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert
    expect(result.status).toBe("ok");
    expect(result.dataState).toBe("seeded");
    expect(result.cleared).toBe(true);
    expect(result.seeded).toBe(true);
    expect(result.cleanupWarning).toBeUndefined();
  });

  it("reports a failed membership cleanup via cleanupWarning instead of swallowing it", async () => {
    // Arrange
    mockResolveAccountId.mockResolvedValue(123);
    mockClearAndSeedWithRetry.mockResolvedValue({
      cleared: true,
      seeded: true,
      summary: { seeded: true },
    });
    mockRemoveTempMembership.mockResolvedValue({
      ok: false,
      error: "failed to remove temp membership 42: boom",
    });

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert: the account's own data succeeded, but the cleanup failure is
    // visible in the result rather than disappearing.
    expect(result.status).toBe("ok");
    expect(result.cleanupWarning).toContain("boom");
  });

  it("reports a failed temp-user deletion via cleanupWarning instead of swallowing it", async () => {
    // Arrange
    mockResolveAccountId.mockResolvedValue(123);
    mockClearAndSeedWithRetry.mockResolvedValue({
      cleared: true,
      seeded: true,
      summary: { seeded: true },
    });
    mockDeleteTempUser.mockResolvedValue({
      ok: false,
      error: "failed to delete temp user temp-user-1: boom-2",
    });

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert
    expect(result.status).toBe("ok");
    expect(result.cleanupWarning).toContain("boom-2");
  });

  it("reports a per-account clear+seed failure as an error with dataState wiped_unseeded, not a blanket success", async () => {
    // Arrange: clear_demo succeeded on the last attempt but seed_demo never
    // did — the non-transactional gap between the two calls.
    mockResolveAccountId.mockResolvedValue(123);
    mockClearAndSeedWithRetry.mockRejectedValue(
      new ClearSeedError(true, "seed_demo did not report seeded: true"),
    );

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert
    expect(result.status).toBe("error");
    expect(result.dataState).toBe("wiped_unseeded");
    expect(result.cleared).toBe(true);
    expect(result.seeded).toBe(false);
    expect(result.error).toContain("seed_demo did not report seeded");
  });

  it("reports dataState unknown when clear_demo itself never succeeded on any attempt", async () => {
    // Arrange
    mockResolveAccountId.mockResolvedValue(123);
    mockClearAndSeedWithRetry.mockRejectedValue(
      new ClearSeedError(false, "clear_demo returned 500"),
    );

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert
    expect(result.status).toBe("error");
    expect(result.dataState).toBe("unknown");
    expect(result.cleared).toBe(false);
  });

  it("marks the account as skipped (not error) when temp-user setup fails before any destructive call", async () => {
    // Arrange
    mockCreateTempUser.mockRejectedValue(
      new Error("createUser quota exceeded"),
    );

    // Act
    const result = await reseedAccount(123, "shadchanus");

    // Assert
    expect(result.status).toBe("skipped");
    expect(result.dataState).toBe("unknown");
    expect(result.error).toContain("createUser quota exceeded");
    // Nothing was created, so there is nothing to clean up.
    expect(mockRemoveTempMembership).not.toHaveBeenCalled();
    expect(mockDeleteTempUser).not.toHaveBeenCalled();
  });
});
