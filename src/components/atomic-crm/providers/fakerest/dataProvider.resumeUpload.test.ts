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
});
