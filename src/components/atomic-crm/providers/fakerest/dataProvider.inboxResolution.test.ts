import { describe, expect, it } from "vitest";

import type { InboxItem } from "../../types";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";

const makeItem = (status: InboxItem["status"]): InboxItem => ({
  id: 44,
  account_id: 1,
  created_at: "2026-11-16T00:00:00.000Z",
  source: "upload",
  sender_needs_confirmation: false,
  status,
  resolution_attempt_id: null,
  resolution_input: null,
});

const makeProvider = (status: InboxItem["status"] = "unresolved") => {
  const db = generateData();
  db.inbox_items = [makeItem(status)];
  return {
    db,
    provider: createDataProvider({ db, latency: 15, silent: true }),
  };
};

const update = (
  provider: ReturnType<typeof createDataProvider>,
  status: InboxItem["status"],
  attempt: string,
) =>
  provider.updateInboxItemResolution({
    id: 44,
    status,
    data: {
      status: "resolving",
      resolution_attempt_id: attempt,
      resolution_input: { lock_acquired_at: "2026-11-16T00:00:00.000Z" },
    },
  });

describe("FakeRest Inbox resolution conditional update", () => {
  it("lets exactly one of two concurrent unresolved claimers win", async () => {
    const { provider } = makeProvider();

    const [first, second] = await Promise.all([
      update(provider, "unresolved", "first"),
      update(provider, "unresolved", "second"),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const { data: stored } = await provider.getOne<InboxItem>("inbox_items", {
      id: 44,
    });
    expect(stored).toMatchObject({
      status: "resolving",
      resolution_attempt_id: expect.stringMatching(/^(first|second)$/),
    });
  });

  it("mirrors the held-row status predicate instead of silently treating held as unresolved", async () => {
    const { provider } = makeProvider("held");

    await expect(update(provider, "unresolved", "wrong-status")).resolves.toBe(
      null,
    );
    await expect(
      provider.getOne<InboxItem>("inbox_items", { id: 44 }),
    ).resolves.toMatchObject({ data: { status: "held" } });

    await expect(
      update(provider, "held", "held-winner"),
    ).resolves.toMatchObject({
      status: "resolving",
      resolution_attempt_id: "held-winner",
    });
  });

  it("takes over a legacy resolving row only when the lock timestamp is still NULL", async () => {
    const { provider } = makeProvider();
    await provider.updateInboxItemResolution({
      id: 44,
      status: "unresolved",
      data: {
        status: "resolving",
        resolution_attempt_id: "legacy",
        resolution_input: {},
      },
    });

    await expect(
      provider.updateInboxItemResolution({
        id: 44,
        status: "resolving",
        expectedResolutionAttemptId: "legacy",
        expectedLockAcquiredAtIsNull: true,
        data: {
          resolution_attempt_id: "takeover",
          resolution_input: { lock_acquired_at: "2026-11-16T00:00:00.000Z" },
        },
      }),
    ).resolves.toMatchObject({ resolution_attempt_id: "takeover" });

    await expect(
      provider.updateInboxItemResolution({
        id: 44,
        status: "resolving",
        expectedResolutionAttemptId: "takeover",
        expectedLockAcquiredAtIsNull: true,
        data: { resolution_attempt_id: "second-taker" },
      }),
    ).resolves.toBeNull();
    await expect(
      provider.getOne<InboxItem>("inbox_items", { id: 44 }),
    ).resolves.toMatchObject({
      data: { resolution_attempt_id: "takeover" },
    });
  });
});
