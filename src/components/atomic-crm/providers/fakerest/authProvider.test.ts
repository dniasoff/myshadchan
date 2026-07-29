import { beforeEach, describe, expect, it, vi } from "vitest";

// Story 3.4 AC 8 — `canAccess`'s role source. `authProvider.ts` imports the
// `dataProvider` singleton directly (not through a data-provider context),
// so it is mocked the same way `./supabase` is mocked for the Supabase
// authProvider's own `canAccess` tests.
const { getMyContexts } = vi.hoisted(() => ({
  getMyContexts: vi.fn(),
}));

vi.mock("./dataProvider", () => ({
  dataProvider: { getMyContexts },
}));

import { authProvider, USER_STORAGE_KEY } from "./authProvider";

const contextRow = (role: string) => ({
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role,
  is_active: true,
});

describe("authProvider.canAccess", () => {
  beforeEach(() => {
    getMyContexts.mockReset();
    // A default logged-in session, so every test below exercises the
    // active-context role resolution unless it deliberately removes this
    // (the no-session test does, as its own Arrange step).
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ id: 0 }));
  });

  it("denies access outright with no session in localStorage, without resolving any active-context role", async () => {
    // Arrange — `getIdentity()` alone cannot distinguish a logged-out
    // session from the seed user (it falls back to id 0 with no
    // `USER_STORAGE_KEY` entry), so this precondition must run before
    // `resolveActiveRole()` (and therefore `getMyContexts()`) is ever
    // reached.
    localStorage.removeItem(USER_STORAGE_KEY);
    getMyContexts.mockResolvedValue([contextRow("parent_admin")]);

    // Act
    const allowed = await authProvider.canAccess!({
      resource: "members",
      action: "list",
    });

    // Assert
    expect(allowed).toBe(false);
    expect(getMyContexts).not.toHaveBeenCalled();
  });

  it("denies members management for a helper active-context role — the locally-stored administrator flag no longer decides (AD-2)", async () => {
    // Arrange — the locally-stored user carries `administrator: true`
    // (this module's own `DEFAULT_USER`), yet the active-context role is
    // `helper`.
    localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ id: 0, administrator: true }),
    );
    getMyContexts.mockResolvedValue([contextRow("helper")]);

    // Act
    const allowed = await authProvider.canAccess!({
      resource: "members",
      action: "list",
    });

    // Assert
    expect(allowed).toBe(false);
    expect(getMyContexts).toHaveBeenCalled();
  });

  it("allows members management for a parent_admin active-context role, even when the locally-stored user has administrator: false", async () => {
    // Arrange
    localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ id: 0, administrator: false }),
    );
    getMyContexts.mockResolvedValue([contextRow("parent_admin")]);

    // Act
    const allowed = await authProvider.canAccess!({
      resource: "members",
      action: "list",
    });

    // Assert
    expect(allowed).toBe(true);
  });

  it("allows every role on a non-members resource", async () => {
    // Arrange
    getMyContexts.mockResolvedValue([contextRow("single")]);

    // Act
    const allowed = await authProvider.canAccess!({
      resource: "shidduchim",
      action: "list",
    });

    // Assert
    expect(allowed).toBe(true);
  });

  it("fails closed when no context is active", async () => {
    // Arrange
    getMyContexts.mockResolvedValue([]);

    // Act
    const allowed = await authProvider.canAccess!({
      resource: "shidduchim",
      action: "list",
    });

    // Assert
    expect(allowed).toBe(false);
  });

  it("dedupes a burst of concurrent calls onto a single getMyContexts() call, and issues a fresh one after the burst settles", async () => {
    // Arrange
    getMyContexts.mockResolvedValue([contextRow("parent_admin")]);

    // Act — five concurrent calls in the same burst.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        authProvider.canAccess!({ resource: "shidduchim", action: "list" }),
      ),
    );

    // Assert — exactly one call for the whole burst.
    expect(getMyContexts).toHaveBeenCalledTimes(1);

    // Act — a sixth call, started after the burst has settled.
    await authProvider.canAccess!({ resource: "shidduchim", action: "list" });

    // Assert — a fresh call, proving there is no cross-time cache.
    expect(getMyContexts).toHaveBeenCalledTimes(2);
  });
});
