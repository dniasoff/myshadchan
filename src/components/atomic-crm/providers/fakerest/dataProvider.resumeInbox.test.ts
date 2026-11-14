import { describe, expect, it } from "vitest";

import type { Resume } from "../../types";
import generateData from "./dataGenerator";
import { createDataProvider } from "./dataProvider";

const SOURCE_PATH = "1/inbox/44/David-Levi.pdf";
const SOURCE_URL = "data:application/pdf;base64,cmVzdW1lIGJ5dGVz";

function setup(sourceAccountId?: number) {
  const db = generateData();
  const target = db.shidduchim[0];
  if (!target) throw new Error("fixture has no shidduch");
  db.resumes = [];
  db.inbox_items = [
    {
      id: 44,
      account_id: sourceAccountId ?? target.account_id,
      created_at: "2026-11-14T10:00:00.000Z",
      source: "whatsapp",
      sender: "Rivky's aunt",
      sender_needs_confirmation: false,
      attachments: [
        {
          title: "David Levi.pdf",
          type: "application/pdf",
          path: SOURCE_PATH,
          src: SOURCE_URL,
        },
      ],
      status: "unresolved",
    },
  ];
  return {
    target,
    db,
    dataProvider: createDataProvider({ db, latency: 0, silent: true }),
  };
}

describe("FakeRest Inbox resume attach", () => {
  it("is idempotent and keeps the source attachment after a retry", async () => {
    const { target, db, dataProvider } = setup();
    const params = {
      shidduchimId: target.id,
      inboxItemId: 44,
      attachment: db.inbox_items[0].attachments![0],
    };

    const first = await dataProvider.attachInboxAttachmentToResumeFile(params);
    const second = await dataProvider.attachInboxAttachmentToResumeFile(params);

    expect(second.id).toBe(first.id);
    expect(second.files).toHaveLength(1);
    expect(second.files?.[0]).toMatchObject({
      filename: "David Levi.pdf",
      source_inbox_item_id: 44,
      source_inbox_attachment_path: SOURCE_PATH,
    });
    expect(db.inbox_items[0].status).toBe("unresolved");
    expect(db.inbox_items[0].attachments).toHaveLength(1);
  });

  it("rejects a source from another account without creating a resume row", async () => {
    const { target, db, dataProvider } = setup(999);

    await expect(
      dataProvider.attachInboxAttachmentToResumeFile({
        shidduchimId: target.id,
        inboxItemId: 44,
        attachment: db.inbox_items[0].attachments![0],
      }),
    ).rejects.toThrow("Could not attach this file");

    const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: target.id },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(resumes).toHaveLength(0);
  });
});
