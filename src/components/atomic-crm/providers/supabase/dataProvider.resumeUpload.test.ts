import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  storageUpload,
  storageSignedUrl,
  storageRemove,
  rpc,
  from,
  supabaseClient,
  baseDataProvider,
} = vi.hoisted(() => {
  const storageUpload = vi.fn();
  const storageSignedUrl = vi.fn();
  const storageRemove = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn((resource: string) => {
    if (resource === "storage_purge_queue") {
      return {
        select: vi.fn().mockResolvedValue({ count: 0, error: null }),
      };
    }
    return {
      upload: storageUpload,
      createSignedUrl: storageSignedUrl,
      remove: storageRemove,
    };
  });
  const supabaseClient = {
    storage: { from },
    from,
    rpc,
  };
  const baseDataProvider = {
    getList: vi.fn(),
    getOne: vi.fn(),
    getMany: vi.fn(),
    create: vi.fn(),
  };
  return {
    storageUpload,
    storageSignedUrl,
    storageRemove,
    rpc,
    from,
    supabaseClient,
    baseDataProvider,
  };
});

vi.mock("ra-supabase-core", () => ({
  supabaseDataProvider: vi.fn(() => baseDataProvider),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => supabaseClient,
}));

import {
  getDataProviderWithCustomMethods,
  uploadToBucket,
} from "./dataProvider";
import { isInboxAttachmentPurgePath } from "../../inbox/inboxDelete";

describe("Supabase resume capture provider methods", () => {
  beforeEach(() => {
    storageUpload.mockReset().mockResolvedValue({ error: null });
    storageSignedUrl.mockReset().mockResolvedValue({
      data: { signedUrl: "https://signed.example/resume.pdf" },
      error: null,
    });
    storageRemove.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === "current_context_id") return { data: 7, error: null };
      return { data: null, error: null };
    });
    from.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        blob: () => Promise.resolve(new Blob(["resume"])),
      }),
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:resume"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads inbox attachments under the account/inbox/item path and returns metadata", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    const file = new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    });

    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
    });

    expect(from).toHaveBeenCalledWith("attachments");
    const [storagePath, uploadedBody] = storageUpload.mock.calls[0];
    expect(storagePath).toMatch(/^7\/inbox\/700\/[0-9a-f-]+\.pdf$/);
    expect(uploadedBody).toBeInstanceOf(Blob);
    expect(storageSignedUrl).toHaveBeenCalledWith(storagePath, 60 * 60);
    expect(attachment).toEqual({
      title: "resume.pdf",
      type: "application/pdf",
      path: storagePath,
      src: "https://signed.example/resume.pdf",
      size: file.size,
    });
  });

  it("sanitizes every Inbox upload extension to the delete grammar", async () => {
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
    const dataProvider = getDataProviderWithCustomMethods();

    for (const [filename, extension] of cases) {
      storageUpload.mockClear();
      const attachment = await dataProvider.uploadInboxAttachment({
        file: new File(["attachment"], filename),
        inboxItemId: 700,
      });
      const [storagePath] = storageUpload.mock.calls[0];
      expect(storagePath).toBe(attachment.path);
      expect(storagePath).toMatch(
        new RegExp(
          `^7/inbox/700/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}${extension.replace(".", "\\.")}$`,
        ),
      );
      expect(isInboxAttachmentPurgePath(storagePath, 7)).toBe(true);
    }
  });

  it("round-trips a sanitized upload through create and the delete RPC", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    const file = new File(["resume"], "resume.tar.gz", {
      type: "application/gzip",
    });
    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
    });
    baseDataProvider.create.mockResolvedValue({
      data: {
        id: 700,
        account_id: 7,
        status: "unresolved",
        attachments: [attachment],
      },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "delete_inbox_item") return { data: 1, error: null };
      if (name === "current_context_id") return { data: 7, error: null };
      if (name === "claim_inbox_attachment_purge") {
        return {
          data: [{ id: 1, storage_path: attachment.path }],
          error: null,
        };
      }
      if (name === "ack_inbox_attachment_purge") {
        return { data: 1, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    await dataProvider.create("inbox_items", {
      data: {
        id: 700,
        account_id: 7,
        status: "unresolved",
        attachments: [attachment],
      },
    });
    await expect(dataProvider.deleteInboxItem(700)).resolves.toEqual({
      purgePending: false,
    });
    expect(storageRemove).toHaveBeenCalledWith([attachment.path]);
    expect(isInboxAttachmentPurgePath(attachment.path, 7)).toBe(true);
  });

  it("removes an inbox attachment from the attachments bucket and reports storage errors", async () => {
    const dataProvider = getDataProviderWithCustomMethods();

    await dataProvider.removeInboxAttachment("7/inbox/700/resume.pdf");
    expect(from).toHaveBeenCalledWith("attachments");
    expect(storageRemove).toHaveBeenCalledWith(["7/inbox/700/resume.pdf"]);

    storageRemove.mockResolvedValue({
      error: { message: "permission denied" },
    });
    await expect(
      dataProvider.removeInboxAttachment("7/inbox/700/resume.pdf"),
    ).rejects.toThrow("Failed to remove the captured resume");
  });

  it("persists the canonical MIME supplied by the picker validator", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    const file = new File(["picture"], "picture.jpg");

    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
      mimeType: "image/jpeg",
    });

    expect(attachment.type).toBe("image/jpeg");
  });

  it("normalizes the supplied MIME instead of overwriting it with raw File.type", async () => {
    const file = new File(["picture"], "picture.jpg", {
      type: "application/pdf",
    });

    const uploaded = await uploadToBucket(
      {
        src: "blob:picture",
        title: file.name,
        rawFile: file,
        type: " IMAGE/JPEG ; charset=utf-8 ",
      },
      "inbox/700",
    );

    expect(uploaded.type).toBe("image/jpeg");
    expect(storageUpload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Blob),
      { contentType: "image/jpeg" },
    );
  });

  it("removes the uploaded object when signed URL creation fails", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    storageSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "signing failed" },
    });
    const file = new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    });

    await expect(
      dataProvider.uploadInboxAttachment({ file, inboxItemId: 700 }),
    ).rejects.toThrow("Failed to sign attachment URL");
    const [storagePath] = storageUpload.mock.calls[0];
    expect(storageRemove).toHaveBeenCalledWith([storagePath]);
  });

  it("passes the exact resume-file identity and opaque token to the delete RPC", async () => {
    vi.unstubAllGlobals();
    const dataProvider = getDataProviderWithCustomMethods();
    const deleteToken = "a".repeat(64);
    rpc.mockImplementation(async (name: string) => {
      if (name === "remove_resume_file") return { data: null, error: null };
      if (name === "claim_shidduch_storage_purge") {
        return { data: [], error: null };
      }
      if (name === "current_context_id") return { data: 7, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });

    await expect(
      dataProvider.removeResumeFile({
        resumeId: 42,
        path: "7/resumes/42/resume.pdf",
        size: 1234,
        uploadedAt: "2026-11-17T12:34:56.000Z",
        deleteToken,
      }),
    ).resolves.toEqual({ purgePending: false });

    expect(rpc).toHaveBeenCalledWith("remove_resume_file", {
      p_resume_id: 42,
      p_path: "7/resumes/42/resume.pdf",
      p_size: 1234,
      p_uploaded_at: "2026-11-17T12:34:56.000Z",
      p_delete_token: deleteToken,
    });
  });
});
