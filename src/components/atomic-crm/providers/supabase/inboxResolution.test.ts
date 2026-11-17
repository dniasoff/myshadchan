import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../types";
import {
  deleteOwnedInboxShidduch,
  updateInboxItemResolution,
} from "./inboxResolution";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({ from, rpc }),
}));

type TestRow = Pick<
  InboxItem,
  | "id"
  | "status"
  | "resolution_attempt_id"
  | "resolution_input"
  | "resolved_shidduchim_id"
  | "single_id"
  | "shadchan_id"
>;

let row: TestRow;

const readLockTimestamp = () => {
  const input = row.resolution_input;
  if (!input || typeof input !== "object") return null;
  const value = (input as { lock_acquired_at?: unknown }).lock_acquired_at;
  return typeof value === "string" ? value : null;
};

const makeBuilder = () => {
  const filters: Array<{
    kind: "eq" | "is" | "lt";
    field: string;
    value: unknown;
  }> = [];
  let patch: Record<string, unknown> = {};
  const builder = {
    update: vi.fn((data: Record<string, unknown>) => {
      patch = data;
      return builder;
    }),
    eq: vi.fn((field: string, value: unknown) => {
      filters.push({ kind: "eq", field, value });
      return builder;
    }),
    filter: vi.fn(
      (field: string, operator: "is" | "lt" | "eq", value: unknown) => {
        filters.push({ kind: operator, field, value });
        return builder;
      },
    ),
    select: vi.fn(async () => {
      const matches = filters.every((filter) => {
        if (filter.field === "id")
          return String(row.id) === String(filter.value);
        if (filter.field === "status") return row.status === filter.value;
        if (filter.field === "resolution_attempt_id") {
          return row.resolution_attempt_id === filter.value;
        }
        if (filter.field === "resolution_input->>lock_acquired_at") {
          const timestamp = readLockTimestamp();
          if (filter.kind === "is" && filter.value === "null") {
            return timestamp === null;
          }
          if (filter.kind === "lt") {
            return timestamp !== null && timestamp < String(filter.value);
          }
          return timestamp === filter.value;
        }
        return false;
      });
      if (!matches) return { data: [], error: null };
      Object.assign(row, patch);
      return { data: [row], error: null };
    }),
  };
  return builder;
};

const claim = (status: InboxItem["status"], attempt: string) =>
  updateInboxItemResolution({
    id: 44,
    status,
    data: {
      status: "resolving",
      resolution_attempt_id: attempt,
      resolution_input: { lock_acquired_at: "2026-11-16T00:00:00.000Z" },
    },
  });

describe("Supabase Inbox resolution conditional update", () => {
  beforeEach(() => {
    row = {
      id: 44,
      status: "unresolved",
      resolution_attempt_id: null,
      resolution_input: null,
      resolved_shidduchim_id: null,
      single_id: null,
      shadchan_id: null,
    };
    from.mockReset().mockImplementation((table: string) => {
      if (table !== "inbox_items") throw new Error(`unexpected table ${table}`);
      return makeBuilder();
    });
    rpc.mockReset();
  });

  it("uses the observed status as a real PostgREST predicate, so a held row cannot be claimed as unresolved", async () => {
    row.status = "held";

    const result = await claim("unresolved", "loser");

    expect(result).toBeNull();
    expect(row.status).toBe("held");
    expect(row.resolution_attempt_id).toBeNull();
  });

  it("allows the held discard/resolve path when the caller supplies held as the observed status", async () => {
    row.status = "held";

    const result = await claim("held", "held-winner");

    expect(result).toMatchObject({
      id: 44,
      status: "resolving",
      resolution_attempt_id: "held-winner",
    });
  });

  it("serializes two claimers through the same conditional update contract", async () => {
    const [first, second] = await Promise.all([
      claim("unresolved", "first"),
      claim("unresolved", "second"),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(row.status).toBe("resolving");
    expect(["first", "second"]).toContain(row.resolution_attempt_id);
  });

  it("takes over a legacy resolving row only when its old attempt and NULL lock stamp still match", async () => {
    row.status = "resolving";
    row.resolution_attempt_id = "legacy";
    row.resolution_input = {};

    const result = await updateInboxItemResolution({
      id: 44,
      status: "resolving",
      expectedResolutionAttemptId: "legacy",
      expectedLockAcquiredAtIsNull: true,
      data: {
        resolution_attempt_id: "takeover",
        resolution_input: { lock_acquired_at: "2026-11-16T00:00:00.000Z" },
      },
    });

    expect(result).toMatchObject({ resolution_attempt_id: "takeover" });
  });

  it("rejects a stale takeover after another caller has written a lock timestamp", async () => {
    row.status = "resolving";
    row.resolution_attempt_id = "legacy";
    row.resolution_input = {};
    row.resolution_input = { lock_acquired_at: "2026-11-16T00:00:00.000Z" };

    const result = await updateInboxItemResolution({
      id: 44,
      status: "resolving",
      expectedResolutionAttemptId: "legacy",
      expectedLockAcquiredAtIsNull: true,
      data: { resolution_attempt_id: "stale-taker" },
    });

    expect(result).toBeNull();
    expect(row.resolution_attempt_id).toBe("legacy");
  });

  it("uses the guarded delete RPC instead of a direct PostgREST DELETE", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      deleteOwnedInboxShidduch({
        id: 44,
        singleId: 9,
        expectedCreatedAt: "2026-11-16T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("delete_owned_inbox_shidduch", {
      p_id: 44,
      p_single_id: 9,
      p_created_at: "2026-11-16T00:00:00.000Z",
    });
    expect(from).not.toHaveBeenCalledWith("shidduchim");
  });
});
