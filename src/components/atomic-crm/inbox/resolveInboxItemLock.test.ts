import { describe, expect, it, vi } from "vitest";
import type { CrmDataProvider } from "../providers/types";
import type { InboxItem } from "../types";
import {
  acquireResolutionLock,
  ResolutionClaimLostError,
} from "./resolveInboxItemLock";

const item = (overrides: Partial<InboxItem> = {}): InboxItem =>
  ({
    id: 44,
    account_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    source: "upload",
    raw_text: null,
    subject: null,
    sender: null,
    sender_needs_confirmation: false,
    attachments: null,
    status: "unresolved",
    single_id: null,
    shadchan_id: null,
    resolved_shidduchim_id: null,
    connection_id: null,
    resolution_attempt_id: null,
    resolution_input: null,
    ...overrides,
  }) as InboxItem;

const itemWithStatus = (
  status: InboxItem["status"],
  overrides: Partial<InboxItem> = {},
): InboxItem => item({ status, ...overrides });

function provider(initial = item()) {
  let current = initial;
  const getOne = vi.fn(async () => ({ data: current }));
  const updateInboxItemResolution = vi.fn(async (params: any) => {
    const lockAcquiredAt = (
      current.resolution_input as { lock_acquired_at?: unknown } | null
    )?.lock_acquired_at;
    if (
      current.status !== params.status ||
      (params.expectedResolutionAttemptId != null &&
        current.resolution_attempt_id !== params.expectedResolutionAttemptId) ||
      (params.expectedLockAcquiredAt !== undefined &&
        lockAcquiredAt !== params.expectedLockAcquiredAt) ||
      (params.expectedLockAcquiredAtIsNull && lockAcquiredAt != null)
    ) {
      return null;
    }
    current = { ...current, ...params.data };
    return current;
  });
  return {
    provider: {
      getOne,
      updateInboxItemResolution,
    } as unknown as CrmDataProvider,
    updateInboxItemResolution,
  };
}

const input = {
  action: "resume_new" as const,
  attachment_path: "1/inbox/resume.pdf",
  single_id: 5,
};

describe("resolve Inbox conditional claim", () => {
  it("allows exactly one of two concurrent unresolved claimers to proceed", async () => {
    const fake = provider();
    const [first, second] = await Promise.allSettled([
      acquireResolutionLock(fake.provider, item(), "attempt-a", input, {
        claimFromStatuses: ["unresolved"],
      }),
      acquireResolutionLock(fake.provider, item(), "attempt-b", input, {
        claimFromStatuses: ["unresolved"],
      }),
    ]);

    expect(
      [first.status, second.status].filter((status) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      [first, second].filter((result) => result.status === "rejected"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.any(ResolutionClaimLostError),
        }),
      ]),
    );
    expect(
      fake.updateInboxItemResolution.mock.calls.every(
        ([params]) => params.status === "unresolved",
      ),
    ).toBe(true);
  });

  it("sends the status predicate that prevents a stale claim from winning", async () => {
    const fake = provider();
    await acquireResolutionLock(fake.provider, item(), "attempt-a", input, {
      claimFromStatuses: ["unresolved"],
    });

    expect(fake.updateInboxItemResolution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: "unresolved" }),
    );
  });

  it("fails loudly when a provider does not expose the conditional update", async () => {
    const providerWithoutCas = {
      getOne: vi.fn(async () => ({ data: item() })),
    } as unknown as CrmDataProvider;

    await expect(
      acquireResolutionLock(
        providerWithoutCas,
        item(),
        "attempt-no-cas",
        input,
        { claimFromStatuses: ["unresolved"] },
      ),
    ).rejects.toThrow(
      "The Inbox resolution provider must implement updateInboxItemResolution.",
    );
  });

  it("claims a held row from its observed held status", async () => {
    const fake = provider(itemWithStatus("held"));

    const claimed = await acquireResolutionLock(
      fake.provider,
      itemWithStatus("held"),
      "attempt-held",
      { action: "dismiss" },
      { claimFromStatuses: ["unresolved", "held"] },
    );

    expect(claimed.status).toBe("resolving");
    expect(fake.updateInboxItemResolution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: "held" }),
    );
  });

  it("takes over a legacy resolving row with no lock timestamp using IS NULL", async () => {
    const legacy = itemWithStatus("resolving", {
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "resume_new",
        attachment_path: input.attachment_path,
        single_id: input.single_id,
      },
    });
    const fake = provider(legacy);

    const claimed = await acquireResolutionLock(
      fake.provider,
      legacy,
      "attempt-new",
      input,
      { claimFromStatuses: ["unresolved"] },
    );

    expect(claimed.resolution_attempt_id).toBe("attempt-new");
    expect(fake.updateInboxItemResolution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        status: "resolving",
        expectedResolutionAttemptId: "old-attempt",
        expectedLockAcquiredAtIsNull: true,
      }),
    );
  });

  it("allows exactly one concurrent held dismissal", async () => {
    const fake = provider(itemWithStatus("held"));
    const held = itemWithStatus("held");
    const [first, second] = await Promise.allSettled([
      acquireResolutionLock(
        fake.provider,
        held,
        "dismiss-a",
        { action: "dismiss" },
        { claimFromStatuses: ["unresolved", "held"] },
      ),
      acquireResolutionLock(
        fake.provider,
        held,
        "dismiss-b",
        { action: "dismiss" },
        { claimFromStatuses: ["unresolved", "held"] },
      ),
    ]);

    expect(
      [first, second].filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      [first, second].filter((result) => result.status === "rejected"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.any(ResolutionClaimLostError),
        }),
      ]),
    );
  });
});
