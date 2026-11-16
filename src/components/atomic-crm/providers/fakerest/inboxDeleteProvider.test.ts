import { describe, expect, it } from "vitest";

import type { InboxItem } from "../../types";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

const inboxItem = (
  id: number,
  attachments: InboxItem["attachments"],
  overrides: Partial<InboxItem> = {},
): InboxItem => ({
  id,
  account_id: 1,
  created_at: "2026-11-16T00:00:00.000Z",
  source: "upload",
  sender_needs_confirmation: false,
  status: "unresolved",
  attachments,
  ...overrides,
});

const makeProvider = (items: InboxItem[], configure?: (db: Db) => void) => {
  const db = generateData();
  db.inbox_items = items;
  configure?.(db);
  return createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0 }) },
  });
};

describe("FakeRest Inbox delete provider", () => {
  it("deletes atomically and preserves a path referenced by another Inbox row", async () => {
    const sharedPath = "1/inbox/42/shared.pdf";
    const provider = makeProvider([
      inboxItem(42, [
        {
          title: "shared.pdf",
          type: "application/pdf",
          path: sharedPath,
          src: "shared",
        },
      ]),
      inboxItem(43, [
        {
          title: "shared.pdf",
          type: "application/pdf",
          path: sharedPath,
          src: "shared",
        },
      ]),
    ]);

    await expect(provider.deleteInboxItem(42)).resolves.toEqual({
      purgePending: false,
    });
    await expect(provider.getOne("inbox_items", { id: 42 })).rejects.toThrow();
    await expect(
      provider.getOne("inbox_items", { id: 43 }),
    ).resolves.toMatchObject({
      data: { id: 43 },
    });
  });

  it("is idempotent and does not reveal a missing row on a second call", async () => {
    const provider = makeProvider([inboxItem(42, null)]);

    await expect(provider.deleteInboxItem(42)).resolves.toEqual({
      purgePending: false,
    });
    await expect(provider.deleteInboxItem(42)).resolves.toEqual({
      purgePending: false,
    });
  });

  it("refuses malformed metadata and resolving rows without changing them", async () => {
    const malformed = inboxItem(42, {} as InboxItem["attachments"]);
    const resolving = inboxItem(43, null, { status: "resolving" });
    const provider = makeProvider([malformed, resolving]);

    await expect(provider.deleteInboxItem(42)).rejects.toThrow(
      "This item cannot be deleted automatically.",
    );
    await expect(provider.deleteInboxItem(43)).rejects.toThrow(
      "Could not delete this Inbox item",
    );
    await expect(
      provider.getOne("inbox_items", { id: 42 }),
    ).resolves.toMatchObject({
      data: { id: 42 },
    });
    await expect(
      provider.getOne("inbox_items", { id: 43 }),
    ).resolves.toMatchObject({
      data: { id: 43 },
    });
  });

  it("rejects a single-role delete", async () => {
    const db = generateData();
    db.inbox_items = [inboxItem(42, null)];
    db.account_members.push({
      id: 9001,
      account_id: 1,
      user_id: "single-delete-test",
      role: "single",
      status: "active",
      created_at: "2026-11-16T00:00:00.000Z",
    });
    const provider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: {
        getIdentity: async () => ({ id: "single-delete-test" }),
      },
    });

    await expect(provider.deleteInboxItem(42)).rejects.toThrow(
      "Could not delete this Inbox item",
    );
    await expect(
      provider.getOne("inbox_items", { id: 42 }),
    ).resolves.toMatchObject({
      data: { id: 42 },
    });
  });

  it("fails cleanly when an attachment is attached after the Inbox row was deleted", async () => {
    const sourcePath = "1/inbox/42/resume.pdf";
    const provider = makeProvider([
      inboxItem(42, [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: sourcePath,
          src: "source",
        },
      ]),
    ]);

    await provider.deleteInboxItem(42);
    await expect(
      provider.attachInboxAttachmentToResumeFile({
        shidduchimId: 1,
        inboxItemId: 42,
        attachment: {
          title: "resume.pdf",
          type: "application/pdf",
          path: sourcePath,
        },
      }),
    ).rejects.toThrow("Could not attach this file");
    await expect(provider.getOne("inbox_items", { id: 42 })).rejects.toThrow();
  });
});
