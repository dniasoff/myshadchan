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
  const from = vi.fn(() => ({
    upload: storageUpload,
    createSignedUrl: storageSignedUrl,
    remove: storageRemove,
  }));
  const supabaseClient = {
    storage: { from },
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

import { getDataProviderWithCustomMethods } from "./dataProvider";

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
    });
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
});
