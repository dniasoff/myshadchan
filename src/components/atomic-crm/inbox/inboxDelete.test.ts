import { describe, expect, it } from "vitest";

import type { InboxItem } from "../types";
import {
  INBOX_DELETE_UNDO_MS,
  canDeleteInboxItem,
  getSafeInboxAttachmentExtension,
  getRemovableInboxAttachmentPaths,
  hasValidInboxAttachmentPaths,
  isInboxAttachmentPurgePath,
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
  it("sanitizes upload extensions to the delete grammar", () => {
    const cases = [
      ["resume.pdf", ".pdf"],
      ["file.tar.gz", ".gz"],
      ["photo.JPEG", ".JPEG"],
      ["digits.1234567890", ".1234567890"],
      ["photo.jpeg ", ""],
      ["photo.jp!g", ""],
      ["résumé.p df", ""],
      ["long.12345678901", ""],
      ["without-extension", ""],
      ["....", ""],
    ] as const;

    for (const [filename, extension] of cases) {
      expect(getSafeInboxAttachmentExtension(filename)).toBe(extension);
    }
  });

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
    const privatePath = "7/inbox/42/11111111-1111-4111-8111-111111111111.pdf";
    const sharedPath = "7/inbox/42/22222222-2222-4222-8222-222222222222.pdf";
    const otherItemPath = "7/inbox/99/33333333-3333-4333-8333-333333333333.pdf";
    const unsafePath =
      "7/inbox/42/44444444-4444-4444-8444-444444444444/../destination.pdf";
    const ingestPath = "7/55555555-5555-4555-8555-555555555555.1234567890";

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
              title: "email.pdf",
              type: "application/pdf",
              path: ingestPath,
              src: "email",
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
    ).toEqual([privatePath, ingestPath]);
  });

  it("rejects encoded traversal, separators, controls, and backslashes", () => {
    const validG1 = "7/inbox/42/11111111-1111-4111-8111-111111111111.private";
    const validG2 = "7/22222222-2222-4222-8222-222222222222.PDF";
    expect(isInboxAttachmentPurgePath(validG1, 7)).toBe(true);
    expect(isInboxAttachmentPurgePath(validG2, 7)).toBe(true);
    for (const unsafe of [
      "7/inbox/42/11111111-1111-4111-8111-111111111111/%2e%2e/private.pdf",
      "7/inbox/42/11111111-1111-4111-8111-111111111111%2Fother.pdf",
      "7/inbox/42/11111111-1111-4111-8111-111111111111%5cother.pdf",
      "7/inbox/42/11111111-1111-4111-8111-111111111111%25path.pdf",
      "7/inbox/42/11111111-1111-4111-8111-111111111111/line\nfeed.pdf",
      "7/inbox/42/11111111-1111-4111-8111-111111111111\\file.pdf",
      "7/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.pdf",
      "7/22222222-2222-4222-8222-222222222222/extra.pdf",
      "7/22222222-2222-4222-8222-222222222222.weird-extension-too-long",
      "8/22222222-2222-4222-8222-222222222222.pdf",
    ]) {
      expect(isInboxAttachmentPurgePath(unsafe, 7)).toBe(false);
    }
  });

  it("fails closed for malformed attachment metadata while allowing null and empty arrays", () => {
    expect(hasValidInboxAttachmentPaths(item({ attachments: null }), 7)).toBe(
      true,
    );
    expect(hasValidInboxAttachmentPaths(item({ attachments: [] }), 7)).toBe(
      true,
    );
    expect(
      hasValidInboxAttachmentPaths(
        item({ attachments: {} as InboxItem["attachments"] }),
        7,
      ),
    ).toBe(false);
    expect(
      hasValidInboxAttachmentPaths(
        item({
          attachments: [
            { title: "missing", type: "text/plain", path: "", src: "" },
          ],
        }),
        7,
      ),
    ).toBe(false);
  });
});
