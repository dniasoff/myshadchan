import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `handleReseed` is tested directly (exported separately from `Deno.serve`,
 * exactly like postmark/index.ts and clear_demo/index.ts) — only
 * `../_shared/supabaseAdmin.ts` and `./reseedAccount.ts` are mocked, so the
 * bearer-secret check, the account fan-out loop, and the response-shaping
 * (`summarize`) all run for real.
 *
 * The core regression this file guards: a run where some accounts failed or
 * were skipped must be distinguishable, in the response body, from a run
 * where every account succeeded — `failed` must never read `0` when it
 * isn't.
 */

const mockFrom = vi.hoisted(() => vi.fn());
const mockReseedAccount = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: (...args: [string]) => mockFrom(...args) },
}));

vi.mock("./reseedAccount.ts", () => ({
  reseedAccount: (...args: [number, string]) => mockReseedAccount(...args),
}));

import { handleReseed } from "./index.ts";

const ADMIN_SECRET = "the-admin-secret";

function stubDemoAccounts(rows: Array<{ id: number; kind: string }>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "accounts") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    }
    throw new Error(`unexpected table in test double: ${table}`);
  });
}

function postRequest(authorization?: string): Request {
  return new Request("https://fn.local/admin_reseed_demo_accounts", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("handleReseed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_RESEED_SECRET", ADMIN_SECRET);
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request with the wrong bearer secret", async () => {
    // Arrange
    stubDemoAccounts([]);

    // Act
    const res = await handleReseed(postRequest("Bearer not-the-secret"));

    // Assert
    expect(res.status).toBe(401);
    expect(mockReseedAccount).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header at all", async () => {
    // Act
    const res = await handleReseed(postRequest());

    // Assert
    expect(res.status).toBe(401);
  });

  it("accepts a request with the correct bearer secret", async () => {
    // Arrange
    stubDemoAccounts([]);

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));

    // Assert
    expect(res.status).toBe(200);
  });

  it("reports failed: 0 and succeeded: N only when every account truly succeeded", async () => {
    // Arrange
    stubDemoAccounts([
      { id: 1, kind: "shadchanus" },
      { id: 2, kind: "shadchanus" },
    ]);
    mockReseedAccount.mockImplementation(async (accountId: number) => ({
      accountId,
      accountKind: "shadchanus",
      status: "ok",
      dataState: "seeded",
      cleared: true,
      seeded: true,
    }));

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));
    const body = await res.json();

    // Assert
    expect(body.processed).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.errored).toBe(0);
  });

  it("distinguishes a partial-failure run from a full success — failed must not read 0 when accounts failed or were skipped", async () => {
    // Arrange: one clean success, one hard failure (wiped but never
    // reseeded), one refused/skipped account.
    stubDemoAccounts([
      { id: 1, kind: "shadchanus" },
      { id: 2, kind: "shadchanus" },
      { id: 3, kind: "parent" },
    ]);
    mockReseedAccount.mockImplementation(async (accountId: number) => {
      if (accountId === 1) {
        return {
          accountId,
          accountKind: "shadchanus",
          status: "ok",
          dataState: "seeded",
          cleared: true,
          seeded: true,
        };
      }
      if (accountId === 2) {
        return {
          accountId,
          accountKind: "shadchanus",
          status: "error",
          dataState: "wiped_unseeded",
          cleared: true,
          seeded: false,
          error: "seed_demo did not report seeded: true",
        };
      }
      return {
        accountId,
        accountKind: "parent",
        status: "skipped",
        dataState: "unknown",
        cleared: false,
        seeded: false,
        error:
          "refusing to operate on account 3: temp user resolved to account 999 instead",
      };
    });

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));
    const body = await res.json();

    // Assert: a 3-account run with one failure and one skip must not look
    // like a clean run.
    expect(res.status).toBe(200); // the HTTP call itself succeeded — the
    // partial failure is reported IN the body, not via transport status.
    expect(body.processed).toBe(3);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errored).toBe(1);
    expect(body.wipedUnseeded).toBe(1);
    expect(body.results).toHaveLength(3);
  });

  it("isolates an unexpected throw from reseedAccount to that account's own result, instead of losing every account's result to a 500", async () => {
    // Arrange
    stubDemoAccounts([
      { id: 1, kind: "shadchanus" },
      { id: 2, kind: "shadchanus" },
    ]);
    mockReseedAccount.mockImplementation(async (accountId: number) => {
      if (accountId === 1) throw new Error("unexpected bug in reseedAccount");
      return {
        accountId,
        accountKind: "shadchanus",
        status: "ok",
        dataState: "seeded",
        cleared: true,
        seeded: true,
      };
    });

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.processed).toBe(2);
    expect(body.failed).toBe(1);
    const account1 = body.results.find(
      (r: { accountId: number }) => r.accountId === 1,
    );
    const account2 = body.results.find(
      (r: { accountId: number }) => r.accountId === 2,
    );
    expect(account1.status).toBe("error");
    expect(account1.error).toContain("unexpected bug in reseedAccount");
    expect(account2.status).toBe("ok");
  });

  it("counts accounts left wiped-but-unseeded and cleanup warnings even when status is otherwise ok", async () => {
    // Arrange
    stubDemoAccounts([{ id: 1, kind: "shadchanus" }]);
    mockReseedAccount.mockResolvedValue({
      accountId: 1,
      accountKind: "shadchanus",
      status: "ok",
      dataState: "seeded",
      cleared: true,
      seeded: true,
      cleanupWarning: "failed to delete temp user temp-user-1: boom",
    });

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));
    const body = await res.json();

    // Assert: cleanup issues surface in the summary even though the
    // account's own reseed succeeded.
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.cleanupWarnings).toBe(1);
  });

  it("returns a shaped response with zero counts when there are no demo-flagged accounts", async () => {
    // Arrange
    stubDemoAccounts([]);

    // Act
    const res = await handleReseed(postRequest(`Bearer ${ADMIN_SECRET}`));
    const body = await res.json();

    // Assert
    expect(body.processed).toBe(0);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual([]);
  });

  it("rejects non-POST methods", async () => {
    const res = await handleReseed(
      new Request("https://fn.local/admin_reseed_demo_accounts", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(405);
  });
});
