import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

vi.mock("./supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => mockFrom(...args),
    rpc: (...args: [string, unknown]) => mockRpc(...args),
  },
}));

import {
  findUnfinishedDemoRun,
  resolveAccountId,
} from "./resolveDemoAccount.ts";

function queryResult(data: unknown, error: unknown = null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }),
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
        maybeSingle: () => Promise.resolve({ data, error }),
      }),
      maybeSingle: () => Promise.resolve({ data, error }),
    }),
  };
}

describe("resolveAccountId", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  it("uses the validated active context and maps a companion to its root", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "member_state") {
        return queryResult({ active_account_id: 42 });
      }
      if (table === "account_members") {
        return queryResult({ account_id: 42 });
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: 7, error: null });

    await expect(resolveAccountId("user-1")).resolves.toBe(7);
    expect(mockRpc).toHaveBeenCalledWith("demo_root_account_for", {
      p_account_id: 42,
    });
  });

  it("keeps a validated root when the manifest resolver succeeds with NULL", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "member_state") {
        return queryResult({ active_account_id: 42 });
      }
      if (table === "account_members") {
        return queryResult({ account_id: 42 });
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(resolveAccountId("user-1")).resolves.toBe(42);
  });

  it("fails closed when manifest lookup returns an RPC error", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "member_state") {
        return queryResult({ active_account_id: 42 });
      }
      if (table === "account_members") {
        return queryResult({ account_id: 42 });
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "unavailable" },
    });

    await expect(resolveAccountId("user-1")).resolves.toBeNull();
  });

  it("fails closed when member_state points at a membership the user does not hold", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "member_state") {
        return queryResult({ active_account_id: 42 });
      }
      if (table === "account_members") {
        return queryResult(null);
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(resolveAccountId("user-1")).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("treats a failed manifest as unfinished so seed cannot orphan its resources", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== "demo_runs") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 9001,
                        status: "failed",
                        updated_at: "2026-08-23T10:00:00.000Z",
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    await expect(findUnfinishedDemoRun(42)).resolves.toEqual({
      id: 9001,
      status: "failed",
      updated_at: "2026-08-23T10:00:00.000Z",
    });
  });
});
