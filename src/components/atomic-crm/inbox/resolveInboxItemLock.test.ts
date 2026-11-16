import { describe, expect, it, vi } from "vitest";
import type { CrmDataProvider } from "../providers/types";
import type { InboxItem } from "../types";
import {
  acquireResolutionLock,
  ResolutionClaimLostError,
} from "./resolveInboxItemLock";

const item = (): InboxItem =>
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
  }) as InboxItem;

function provider() {
  let current = item();
  const getOne = vi.fn(async () => ({ data: current }));
  const updateInboxItemResolution = vi.fn(async (params: any) => {
    if (
      current.status !== params.status ||
      (params.expectedResolutionAttemptId != null &&
        current.resolution_attempt_id !== params.expectedResolutionAttemptId)
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
      acquireResolutionLock(fake.provider, item(), "attempt-a", input),
      acquireResolutionLock(fake.provider, item(), "attempt-b", input),
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
    await acquireResolutionLock(fake.provider, item(), "attempt-a", input);

    expect(fake.updateInboxItemResolution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: "unresolved" }),
    );
  });
});
