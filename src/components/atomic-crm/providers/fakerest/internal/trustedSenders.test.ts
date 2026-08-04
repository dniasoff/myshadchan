import { describe, expect, it } from "vitest";
import fakeRestDataProvider from "ra-data-fakerest";

import type { InboxItem, TrustedSender } from "../../../types";
import { trustSenderAndRelease } from "./trustedSenders";

/**
 * FakeRest mirror of `providers/supabase/trustedSenders.ts` — same
 * behavior, same idempotency guarantee, against `ra-data-fakerest` instead
 * of a mocked Supabase client.
 */

const buildHeldItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 7,
  created_at: "2026-07-21T09:00:00Z",
  source: "email",
  raw_text: "A suggestion",
  subject: null,
  sender: "newcontact@example.com",
  sender_needs_confirmation: false,
  attachments: null,
  status: "held",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
  ...overrides,
});

const makeProvider = (
  inbox_items: InboxItem[],
  trusted_senders: TrustedSender[] = [],
) => fakeRestDataProvider({ inbox_items, trusted_senders }, false, 0);

describe("trustSenderAndRelease (FakeRest mirror)", () => {
  it("creates a trusted_senders row and releases the held item into 'unresolved'", async () => {
    // Arrange
    const item = buildHeldItem();
    const baseDataProvider = makeProvider([item]);

    // Act
    const result = await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });

    // Assert
    expect(result.trustedSender.email).toBe("newcontact@example.com");
    expect(result.releasedItemIds).toEqual([1]);
    const { data: released } = await baseDataProvider.getOne("inbox_items", {
      id: 1,
    });
    expect(released.status).toBe("unresolved");
  });

  it("releases every OTHER held item from the same sender, not only the one reviewed", async () => {
    // Arrange
    const first = buildHeldItem({ id: 1 });
    const second = buildHeldItem({ id: 2, subject: "A second message" });
    const unrelated = buildHeldItem({
      id: 3,
      sender: "someone-else@example.com",
    });
    const baseDataProvider = makeProvider([first, second, unrelated]);

    // Act
    const result = await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });

    // Assert
    expect(result.releasedItemIds.sort()).toEqual([1, 2]);
    const { data: stillHeld } = await baseDataProvider.getOne("inbox_items", {
      id: 3,
    });
    expect(stillHeld.status).toBe("held");
  });

  it("is idempotent — reuses the existing trusted_senders row instead of creating a duplicate", async () => {
    // Arrange
    const item = buildHeldItem();
    const baseDataProvider = makeProvider([item]);

    // Act
    const first = await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });
    const second = await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });

    // Assert
    expect(second.trustedSender.id).toBe(first.trustedSender.id);
    const { total } = await baseDataProvider.getList("trusted_senders", {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(total).toBe(1);
  });

  it("returns zero released ids on a retry once every matching item already moved past 'held'", async () => {
    // Arrange
    const item = buildHeldItem();
    const baseDataProvider = makeProvider([item]);
    await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });

    // Act — retry
    const retry = await trustSenderAndRelease(baseDataProvider, {
      accountId: 7,
      email: "newcontact@example.com",
    });

    // Assert
    expect(retry.releasedItemIds).toEqual([]);
  });
});
