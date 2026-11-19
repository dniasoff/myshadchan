import { describe, expect, it, vi } from "vitest";

import type { DataProvider } from "ra-core";
import type { Resume } from "../../types";
import { buildResumeInboxStoragePath } from "../../resumes/resumeInbox";
import generateData from "./dataGenerator";
import { createDataProvider } from "./dataProvider";
import { attachInboxAttachmentToResumeFile } from "./internal/resumes";

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

  it("retains the shared blob when a committed row response is lost before retry", async () => {
    const { target, db } = setup();
    const sourceItem = db.inbox_items[0];
    const attachment = sourceItem.attachments![0];
    const blobUrls = new Map<string, string>();
    let committedResume: Resume | null = null;
    let loseFirstResponse = true;
    const baseDataProvider = {
      getList: vi.fn(async (resource: string) => {
        if (resource === "inbox_items") {
          return { data: [sourceItem], total: 1 };
        }
        if (resource === "shidduchim") {
          return { data: [target], total: 1 };
        }
        if (resource === "resumes") {
          return {
            data: committedResume ? [committedResume] : [],
            total: committedResume ? 1 : 0,
          };
        }
        throw new Error(`unexpected resource ${resource}`);
      }),
      create: vi.fn(async (_resource: string, params: { data: unknown }) => {
        committedResume = {
          id: 900,
          ...(params.data as Omit<Resume, "id">),
        } as Resume;
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("response lost after commit");
        }
        return { data: committedResume };
      }),
      update: vi.fn(),
    } as unknown as DataProvider;

    const params = {
      shidduchimId: target.id,
      inboxItemId: sourceItem.id,
      attachment,
    };

    await expect(
      attachInboxAttachmentToResumeFile(
        baseDataProvider,
        blobUrls,
        target.account_id,
        7,
        "parent_admin",
        params,
      ),
    ).rejects.toThrow("Could not attach this file");

    const storagePath = await buildResumeInboxStoragePath(
      target.account_id,
      params,
      sourceItem.id,
      SOURCE_PATH,
    );
    expect(blobUrls.has(storagePath)).toBe(true);
    expect((committedResume as unknown as Resume).files).toHaveLength(1);

    const retry = await attachInboxAttachmentToResumeFile(
      baseDataProvider,
      blobUrls,
      target.account_id,
      7,
      "parent_admin",
      params,
    );
    expect(retry.id).toBe(900);
    expect(retry.files).toHaveLength(1);
    expect(baseDataProvider.create).toHaveBeenCalledTimes(1);
    expect(blobUrls.has(storagePath)).toBe(true);
  });

  it("keeps entity-file keys opaque when the display title changes", async () => {
    const { target, db, dataProvider } = setup();
    const source = db.inbox_items[0].attachments![0];

    const first = await dataProvider.copyInboxAttachmentsToEntityFiles({
      baseDataProvider: dataProvider,
      attachments: [{ ...source, title: "Family secret.pdf" }],
      targetType: "shidduch",
      targetId: target.id,
      sourceInboxItemId: 44,
    });
    const second = await dataProvider.copyInboxAttachmentsToEntityFiles({
      baseDataProvider: dataProvider,
      attachments: [
        {
          ...source,
          title: "Renamed.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      targetType: "shidduch",
      targetId: target.id,
      sourceInboxItemId: 44,
    });

    expect(first[0].storage_path).toBe(second[0].storage_path);
    expect(first[0].storage_path).not.toContain("Family");
    expect(first[0].storage_path).not.toContain(".pdf");
    expect(first[0].storage_path).not.toContain(".docx");
  });
});
