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

  it("starts resume reference reconciliation after filing without holding the create open", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    let releaseSync!: (value: { data: null; error: null }) => void;
    const resumeSync = new Promise<{ data: null; error: null }>((resolve) => {
      releaseSync = resolve;
    });
    rpc.mockImplementation((name: string) => {
      if (name === "current_context_id")
        return Promise.resolve({ data: 7, error: null });
      if (name === "sync_resume_references") return resumeSync;
      return Promise.resolve({ data: null, error: null });
    });
    baseDataProvider.create.mockResolvedValue({ data: { id: 901 } });

    const result = await dataProvider.create("resumes", {
      data: {
        shidduchim_id: 42,
        sections: { references: [] },
      },
    });

    expect(result).toEqual({ data: { id: 901 } });
    expect(rpc).toHaveBeenCalledWith("sync_resume_references", {
      p_resume_id: 901,
    });
    releaseSync({ data: null, error: null });
    await resumeSync;
  });

  it("swallows reconciliation errors and logs only the bounded error code", async () => {
    const dataProvider = getDataProviderWithCustomMethods();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation((name: string) => {
      if (name === "sync_resume_references") {
        return Promise.resolve({
          data: null,
          error: { code: "42501", message: "resume 901 is not visible" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    baseDataProvider.create.mockResolvedValue({ data: { id: 901 } });

    try {
      await expect(
        dataProvider.create("resumes", {
          data: {
            shidduchim_id: 42,
            sections: { references: [] },
          },
        }),
      ).resolves.toEqual({ data: { id: 901 } });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith(
        "syncResumeReferencesAfterFiling.error",
        { code: "42501" },
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
