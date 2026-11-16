import { describe, expect, it } from "vitest";

import type { InboxItem } from "../types";
import {
  INBOX_DELETE_UNDO_MS,
  canDeleteInboxItem,
  getRemovableInboxAttachmentPaths,
} from "./inboxDelete";

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 42,
  account_id: 7,
  created_at: "2026-11-15T00:00:00.000Z",
  source: "upload",
  sender_needs_confirmation: false,
  status: "unresolved",
  attachments: null,
  ...overrides,
});

describe("Inbox delete safety", () => {
  it("keeps the approved 10-second undo window and only allows safe statuses", () => {
    expect(INBOX_DELETE_UNDO_MS).toBe(10_000);
    expect(canDeleteInboxItem(item({ status: "unresolved" }))).toBe(true);
    expect(canDeleteInboxItem(item({ status: "held" }))).toBe(true);
    expect(canDeleteInboxItem(item({ status: "dismissed" }))).toBe(true);
    expect(canDeleteInboxItem(item({ status: "resolving" }))).toBe(false);
    expect(canDeleteInboxItem(item({ status: "resolved" }))).toBe(false);
    expect(
      canDeleteInboxItem(
        item({ status: "unresolved", resolution_attempt_id: "in-flight" }),
      ),
    ).toBe(false);
  });

  it("removes only this item's private attachment paths and preserves shared paths", () => {
    const privatePath = "7/inbox/42/private.pdf";
    const sharedPath = "7/inbox/42/shared.pdf";
    const otherItemPath = "7/inbox/99/other.pdf";
    const unsafePath = "7/inbox/42/../entity-files/destination.pdf";

    expect(
      getRemovableInboxAttachmentPaths(
        item({
          attachments: [
            {
              title: "private.pdf",
              type: "application/pdf",
              path: privatePath,
              src: "private",
            },
            {
              title: "shared.pdf",
              type: "application/pdf",
              path: sharedPath,
              src: "shared",
            },
            {
              title: "other.pdf",
              type: "application/pdf",
              path: otherItemPath,
              src: "other",
            },
            {
              title: "unsafe.pdf",
              type: "application/pdf",
              path: unsafePath,
              src: "unsafe",
            },
            {
              title: "private.pdf",
              type: "application/pdf",
              path: privatePath,
              src: "private",
            },
          ],
        }),
        7,
        [
          item({
            id: 99,
            attachments: [
              {
                title: "shared.pdf",
                type: "application/pdf",
                path: sharedPath,
                src: "shared",
              },
            ],
          }),
        ],
      ),
    ).toEqual([privatePath]);
  });
});
