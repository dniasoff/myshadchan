import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the Supabase client entirely (the `inboxAttachments.test.ts` idiom)
 * so `trustSenderAndRelease` can be exercised without a real backend. Each
 * chain object mirrors the real `PostgrestFilterBuilder`: every method
 * (`upsert`/`update`/`eq`/`select`) returns the SAME object so calls can keep
 * chaining, and the object is also directly awaitable (`then`) — the real
 * client lets a caller either chain further or `await` at any point, and
 * this module's code does both (`.select().single()` for the trust step,
 * a bare terminal `.select("id")` for the release step).
 */
const {
  trustResult,
  releaseResult,
  upsertSpy,
  updateSpy,
  fromSpy,
  releaseEqSpy,
} = vi.hoisted(() => ({
  trustResult: { current: { data: null as unknown, error: null as unknown } },
  releaseResult: {
    current: { data: null as unknown, error: null as unknown },
  },
  upsertSpy: vi.fn(),
  updateSpy: vi.fn(),
  fromSpy: vi.fn(),
  // Tracks every `.eq(column, value)` call made against the RELEASE chain
  // specifically (`inbox_items`), so a test can assert which COLUMN the
  // release query matches on — not just what it returns.
  releaseEqSpy: vi.fn(),
}));

function makeChain(
  resultBox: { current: { data: unknown; error: unknown } },
  eqSpy?: (...args: unknown[]) => void,
) {
  const chain = {
    upsert: vi.fn((...args: unknown[]) => {
      upsertSpy(...args);
      return chain;
    }),
    update: vi.fn((...args: unknown[]) => {
      updateSpy(...args);
      return chain;
    }),
    eq: vi.fn((...args: unknown[]) => {
      eqSpy?.(...args);
      return chain;
    }),
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(resultBox.current)),
    then: (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resultBox.current).then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      fromSpy(table);
      return table === "trusted_senders"
        ? makeChain(trustResult)
        : makeChain(releaseResult, releaseEqSpy);
    },
  }),
}));

import { trustSenderAndRelease } from "./trustedSenders";

describe("trustSenderAndRelease (Epic 11 — Needs review trust action)", () => {
  beforeEach(() => {
    upsertSpy.mockReset();
    updateSpy.mockReset();
    fromSpy.mockReset();
    releaseEqSpy.mockReset();
    trustResult.current = {
      data: {
        id: 1,
        account_id: 7,
        email: "feldman@example.com",
        created_at: "2026-08-01T00:00:00Z",
      },
      error: null,
    };
    releaseResult.current = { data: [{ id: 10 }, { id: 11 }], error: null };
  });

  it("upserts trusted_senders before releasing any held item — the fail-safe order", async () => {
    // Arrange
    const callOrder: string[] = [];
    fromSpy.mockImplementation((table: string) => callOrder.push(table));

    // Act
    await trustSenderAndRelease({
      accountId: 7,
      email: "feldman@example.com",
    });

    // Assert
    expect(callOrder).toEqual(["trusted_senders", "inbox_items"]);
  });

  it("upserts on the (account_id, email) conflict target, never a plain insert", async () => {
    // Arrange / Act
    await trustSenderAndRelease({ accountId: 7, email: "feldman@example.com" });

    // Assert
    expect(upsertSpy).toHaveBeenCalledWith(
      { account_id: 7, email: "feldman@example.com" },
      { onConflict: "account_id,email" },
    );
  });

  it("releases every OTHER held item from the same sender for this account", async () => {
    // Arrange / Act
    const result = await trustSenderAndRelease({
      accountId: 7,
      email: "feldman@example.com",
    });

    // Assert
    expect(updateSpy).toHaveBeenCalledWith({ status: "unresolved" });
    expect(result.releasedItemIds).toEqual([10, 11]);
  });

  it("matches the release query on sender_email — the persisted envelope address — never the FR24-recovered sender field", async () => {
    // Arrange / Act
    await trustSenderAndRelease({ accountId: 7, email: "feldman@example.com" });

    // Assert — this is exactly what this fix changes: releasing on the real
    // envelope address, not the (often display-name/null) forwarded sender.
    expect(releaseEqSpy).toHaveBeenCalledWith(
      "sender_email",
      "feldman@example.com",
    );
    expect(releaseEqSpy).not.toHaveBeenCalledWith("sender", expect.anything());
  });

  it("returns zero released ids when no other held item matches — never an error", async () => {
    // Arrange
    releaseResult.current = { data: [], error: null };

    // Act
    const result = await trustSenderAndRelease({
      accountId: 7,
      email: "feldman@example.com",
    });

    // Assert
    expect(result.releasedItemIds).toEqual([]);
  });

  it("throws and never attempts the release step when the trust upsert itself fails", async () => {
    // Arrange
    trustResult.current = {
      data: null,
      error: { message: "permission denied for table trusted_senders" },
    };

    // Act / Assert
    await expect(
      trustSenderAndRelease({ accountId: 7, email: "feldman@example.com" }),
    ).rejects.toThrow("permission denied for table trusted_senders");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("throws a distinct message when the trust succeeds but the release fails — the recoverable partial state", async () => {
    // Arrange
    releaseResult.current = {
      data: null,
      error: { message: "network error" },
    };

    // Act / Assert
    await expect(
      trustSenderAndRelease({ accountId: 7, email: "feldman@example.com" }),
    ).rejects.toThrow(/couldn't release their held mail/i);
  });

  it("is idempotent — retrying after a successful call still resolves, matching zero additional rows", async () => {
    // Arrange — first call succeeds and "releases" two items.
    await trustSenderAndRelease({ accountId: 7, email: "feldman@example.com" });
    // A retry's release step would match nothing, since every row already
    // moved past 'held' — simulated here directly.
    releaseResult.current = { data: [], error: null };

    // Act
    const retry = await trustSenderAndRelease({
      accountId: 7,
      email: "feldman@example.com",
    });

    // Assert — no error, no duplicate trusted_senders row assumed lost.
    expect(retry.releasedItemIds).toEqual([]);
    expect(retry.trustedSender.email).toBe("feldman@example.com");
  });
});
