import { afterEach, describe, expect, it, vi } from "vitest";
import { ClearSeedError, clearAndSeedWithRetry } from "./invokeDemoFunction.ts";

/**
 * clear_demo -> seed_demo is not transactional: a crash between the two
 * leaves the account wiped but unseeded. `clearAndSeedWithRetry` retries the
 * WHOLE pair once (never seed_demo alone) so a transient failure does not
 * permanently strand an account in that state, and reports which state the
 * account was left in when every attempt is exhausted.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("clearAndSeedWithRetry", () => {
  // SUPABASE_URL/SUPABASE_ANON_KEY are only used to build the fetch URL and
  // headers below — `fetch` itself is stubbed per test, so their actual
  // values are irrelevant here (unlike tempUser.ts's signInTempUser, which
  // validates them explicitly).
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the seed summary when clear_demo and seed_demo both succeed on the first attempt", async () => {
    // Arrange
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ cleared: true }))
        .mockResolvedValueOnce(jsonResponse({ seeded: true, singles: 2 })),
    );

    // Act
    const result = await clearAndSeedWithRetry("token");

    // Assert
    expect(result).toEqual({
      cleared: true,
      seeded: true,
      summary: { seeded: true, singles: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries the whole clear+seed pair (not seed_demo alone) after a transient seed_demo failure, and succeeds", async () => {
    // Arrange: attempt 1 clears fine but seed_demo fails; attempt 2 clears
    // again (proving clear_demo is re-invoked, not skipped) and seeds fine.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ cleared: true })) // attempt 1: clear
        .mockResolvedValueOnce(jsonResponse({}, 500)) // attempt 1: seed fails
        .mockResolvedValueOnce(jsonResponse({ cleared: true })) // attempt 2: clear
        .mockResolvedValueOnce(jsonResponse({ seeded: true })), // attempt 2: seed
    );

    // Act
    const result = await clearAndSeedWithRetry("token");

    // Assert
    expect(result.seeded).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("throws ClearSeedError(cleared: true) when every attempt clears but never seeds — the wiped-but-unseeded gap", async () => {
    // Arrange: both attempts clear successfully but seed_demo never does.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ cleared: true }))
        .mockResolvedValueOnce(
          jsonResponse({ seeded: false, reason: "account_not_empty" }),
        )
        .mockResolvedValueOnce(jsonResponse({ cleared: true }))
        .mockResolvedValueOnce(
          jsonResponse({ seeded: false, reason: "account_not_empty" }),
        ),
    );

    // Act / Assert
    await expect(clearAndSeedWithRetry("token")).rejects.toMatchObject({
      name: "ClearSeedError",
      cleared: true,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("throws ClearSeedError(cleared: false) when clear_demo itself never succeeds", async () => {
    // Arrange: clear_demo fails outright on both attempts — seed_demo is
    // never even reached.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    // Act / Assert
    await expect(clearAndSeedWithRetry("token")).rejects.toMatchObject({
      name: "ClearSeedError",
      cleared: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ClearSeedError instances are recognized via instanceof", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    // Act
    let caught: unknown;
    try {
      await clearAndSeedWithRetry("token");
    } catch (e) {
      caught = e;
    }

    // Assert
    expect(caught).toBeInstanceOf(ClearSeedError);
  });
});
