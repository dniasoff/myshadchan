import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, upload, download, remove, maybeSingle, eq, select } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
    maybeSingle: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    addResumePhoto: vi.fn(),
  }),
);

const tableQuery = { select, eq, maybeSingle };

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    rpc,
    from: () => tableQuery,
    storage: { from: () => ({ upload, download, remove }) },
  }),
}));

import {
  copyInboxAttachmentToResumePhoto,
  uploadResumePhoto,
} from "./resumePhotos";

describe("Supabase resume photo promotion", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({
      data: {
        id: 12,
        account_id: 7,
        resume_id: 55,
        path: "7/photos/shared/42/inbox-stable",
        visibility: "shared",
      },
      error: null,
    });
    upload.mockReset().mockResolvedValue({ error: null });
    remove.mockReset().mockResolvedValue({ error: null });
    download.mockReset().mockResolvedValue({
      data: new Blob(["photo"], { type: "image/jpeg" }),
      error: null,
    });
    select.mockReset().mockReturnValue(tableQuery);
    eq.mockReset().mockReturnValue(tableQuery);
    maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("returns the existing source photo after a remount-style second promotion", async () => {
    const params = {
      shidduchimId: 42,
      sourceAttachmentPath: "7/inbox/900/photo.jpg",
      file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
      visibility: "shared" as const,
    };
    const first = await uploadResumePhoto(params);
    const existing = { ...first, id: 13 };
    maybeSingle.mockResolvedValueOnce({ data: existing, error: null });

    const second = await uploadResumePhoto(params);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(second).toEqual(existing);
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("path", expect.stringContaining("inbox-"));
    expect(eq).toHaveBeenCalledWith("path", expect.stringMatching(/\.jpg$/));
  });

  it("returns a hidden deterministic source photo without promoting it again", async () => {
    const hidden = {
      id: 13,
      account_id: 7,
      resume_id: 55,
      path: "7/photos/shared/42/inbox-stable.jpg",
      visibility: "shared" as const,
      hidden_at: "2026-11-27T00:00:00.000Z",
    };
    maybeSingle.mockResolvedValueOnce({ data: hidden, error: null });

    const result = await copyInboxAttachmentToResumePhoto({
      shidduchimId: 42,
      attachment: {
        path: "7/inbox/900/photo.jpg",
        src: "expired-url",
        title: "photo.jpg",
        type: "image/jpeg",
        size: 5,
      },
    });

    expect(result).toEqual(hidden);
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("current_context_id");
    expect(rpc).not.toHaveBeenCalledWith("add_resume_photo", expect.anything());
  });

  it("keeps the image filename suffix for direct uploads", async () => {
    await uploadResumePhoto({
      shidduchimId: 42,
      file: new File(["photo"], "portrait.png", { type: "image/png" }),
    });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/\/photos\/shared\/42\/[0-9a-f-]+-portrait\.png$/),
      expect.any(File),
    );
  });

  it("copies the Inbox object by durable path for automatic promotion", async () => {
    await copyInboxAttachmentToResumePhoto({
      shidduchimId: 42,
      attachment: {
        path: "7/inbox/900/photo.jpg",
        src: "expired-url",
        title: "photo.jpg",
        type: "image/jpeg",
        size: 5,
      },
    });

    expect(download).toHaveBeenCalledWith("7/inbox/900/photo.jpg");
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/\/photos\/shared\/42\/inbox-/),
      expect.any(File),
    );
    expect(rpc).toHaveBeenCalledWith(
      "add_resume_photo",
      expect.objectContaining({ p_only_if_no_visible_photo: true }),
    );
  });
});
