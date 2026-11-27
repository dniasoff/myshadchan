import { describe, expect, it, vi } from "vitest";
import type { DataProvider } from "ra-core";

import type { Resume, ResumeFileVersion } from "../../types";
import { createDataProvider } from "./dataProvider";
import { removeResumeFile } from "./internal/resumes";

describe("FakeRest resume capture methods", () => {
  it("uploads, copies, and removes a captured resume", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const file = new File(["resume bytes"], "resume.pdf", {
      type: "application/pdf",
    });

    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
    });
    expect(attachment.path).toMatch(/\/inbox\/700\//);
    expect(attachment.type).toBe("application/pdf");

    const copied = await dataProvider.copyInboxAttachmentToResumeFile({
      shidduchimId: 99,
      inboxItemId: 700,
      attachment,
    });
    expect(copied.size).toBe(file.size);

    await dataProvider.removeResumeFileObjectsStrict([copied.storagePath]);
    // The historical lifecycle helper remains available separately; strict
    // compensation cleanup is the method the Inbox resolver selects.
    await dataProvider.removeResumeFileObjects([copied.storagePath]);
    await dataProvider.removeInboxAttachment(attachment.path);
  });

  it("persists the canonical MIME supplied by the picker validator", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const file = new File(["picture"], "picture.jpg");

    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
      mimeType: " IMAGE/JPEG ; charset=utf-8 ",
    });

    expect(attachment.type).toBe("image/jpeg");
  });

  it("promotes the captured JPEG through the same idempotent Photo path", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const attachment = await dataProvider.uploadInboxAttachment({
      file: new File(["picture"], "picture.jpg", { type: "image/jpeg" }),
      inboxItemId: 701,
    });

    const photo = await dataProvider.copyInboxAttachmentToResumePhoto({
      shidduchimId: 99,
      attachment,
    });

    expect(photo.visibility).toBe("shared");
    expect(photo.path).toContain("/photos/shared/99/inbox-");
    const { data: photos } = await dataProvider.getList("resume_photos", {
      filter: { path: photo.path },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(photos).toHaveLength(1);
  });

  it("keeps concurrent automatic promotions to one visible Photo", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const [firstAttachment, secondAttachment] = await Promise.all([
      dataProvider.uploadInboxAttachment({
        file: new File(["first"], "first.jpg", { type: "image/jpeg" }),
        inboxItemId: 702,
      }),
      dataProvider.uploadInboxAttachment({
        file: new File(["second"], "second.jpg", { type: "image/jpeg" }),
        inboxItemId: 703,
      }),
    ]);

    const [firstPhoto, secondPhoto] = await Promise.all([
      dataProvider.copyInboxAttachmentToResumePhoto({
        shidduchimId: 99,
        attachment: firstAttachment,
      }),
      dataProvider.copyInboxAttachmentToResumePhoto({
        shidduchimId: 99,
        attachment: secondAttachment,
      }),
    ]);

    expect(firstPhoto.path).toBe(secondPhoto.path);
    const { data: photos } = await dataProvider.getList("resume_photos", {
      filter: { resume_id: firstPhoto.resume_id, "hidden_at@is": null },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(photos).toHaveLength(1);
  });

  it("finalizes one exact duplicate-path file at a time", async () => {
    const path = "1/resumes/99/duplicate.pdf";
    const first: ResumeFileVersion = {
      path,
      filename: "first.pdf",
      uploaded_at: "2026-11-17T12:00:00.000Z",
      uploaded_by: 10,
      mime_type: "application/pdf",
      size: 100,
    };
    const second: ResumeFileVersion = {
      ...first,
      filename: "second.pdf",
      uploaded_at: "2026-11-17T12:01:00.000Z",
      size: 200,
    };
    let current: Resume = {
      id: 99,
      account_id: 1,
      shidduchim_id: 99,
      created_at: "2026-11-17T12:00:00.000Z",
      files: [first, second],
    };
    const update = vi.fn(
      async (
        _resource: string,
        params: { data: { files: ResumeFileVersion[] } },
      ) => {
        current = { ...current, files: params.data.files };
        return { data: current };
      },
    );
    const baseDataProvider = {
      getOne: vi.fn(async () => ({ data: current })),
      update,
    } as unknown as DataProvider;
    const blobUrls = new Map([[path, "blob:duplicate"]]);
    const removedPaths = new Set<string>();
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    try {
      await removeResumeFile(
        baseDataProvider,
        blobUrls,
        removedPaths,
        1,
        "self_manager",
        99,
        first.path,
        first.size,
        first.uploaded_at,
      );
      expect(current.files).toEqual([second]);
      expect(update).toHaveBeenCalledOnce();
      expect(blobUrls.get(path)).toBe("blob:duplicate");
      expect(revokeObjectURL).not.toHaveBeenCalled();

      await removeResumeFile(
        baseDataProvider,
        blobUrls,
        removedPaths,
        1,
        "self_manager",
        99,
        second.path,
        second.size,
        second.uploaded_at,
      );
      expect(current.files).toEqual([]);
      expect(update).toHaveBeenCalledTimes(2);
      expect(blobUrls.has(path)).toBe(false);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:duplicate");

      await expect(
        removeResumeFile(
          baseDataProvider,
          blobUrls,
          removedPaths,
          1,
          "self_manager",
          99,
          first.path,
          first.size,
          first.uploaded_at,
        ),
      ).resolves.toEqual({ purgePending: false });
      expect(update).toHaveBeenCalledTimes(2);
    } finally {
      revokeObjectURL.mockRestore();
    }
  });

  it("does not remove an identical sibling on an idempotent retry", async () => {
    const file: ResumeFileVersion = {
      path: "1/resumes/99/duplicate.pdf",
      filename: "duplicate.pdf",
      uploaded_at: "2026-11-17T12:00:00.000Z",
      uploaded_by: 10,
      mime_type: "application/pdf",
      size: 100,
    };
    let current: Resume = {
      id: 99,
      account_id: 1,
      shidduchim_id: 99,
      created_at: "2026-11-17T12:00:00.000Z",
      files: [file, { ...file }],
    };
    const update = vi.fn(
      async (
        _resource: string,
        params: { data: { files: ResumeFileVersion[] } },
      ) => {
        current = { ...current, files: params.data.files };
        return { data: current };
      },
    );
    const baseDataProvider = {
      getOne: vi.fn(async () => ({ data: current })),
      update,
    } as unknown as DataProvider;
    const removedPaths = new Set<string>();

    await removeResumeFile(
      baseDataProvider,
      new Map(),
      removedPaths,
      1,
      "self_manager",
      99,
      file.path,
      file.size,
      file.uploaded_at,
    );
    await removeResumeFile(
      baseDataProvider,
      new Map(),
      removedPaths,
      1,
      "self_manager",
      99,
      file.path,
      file.size,
      file.uploaded_at,
    );

    expect(current.files).toEqual([{ ...file }]);
    expect(update).toHaveBeenCalledOnce();
  });

  it("keeps the copied resume object key when its display title changes", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const file = new File(["resume bytes"], "source.pdf", {
      type: "application/pdf",
    });
    const source = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 701,
    });

    const first = await dataProvider.copyInboxAttachmentToResumeFile({
      shidduchimId: 99,
      inboxItemId: 701,
      attachment: { ...source, title: "Alice Cohen.pdf" },
    });
    const second = await dataProvider.copyInboxAttachmentToResumeFile({
      shidduchimId: 99,
      inboxItemId: 701,
      attachment: {
        ...source,
        title: "Renamed.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    });

    expect(second.storagePath).toBe(first.storagePath);
    expect(second.storagePath).not.toContain("Alice");
    expect(second.storagePath).not.toContain(".pdf");
    expect(second.storagePath).not.toContain(".docx");
  });
});
