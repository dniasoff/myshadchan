import { beforeEach, describe, expect, it, vi } from "vitest";

const { download, upload, remove, rpc } = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => download(bucket, path),
        upload: (path: string, data: unknown) => upload(bucket, path, data),
        remove: (paths: string[]) => remove(bucket, paths),
      }),
    },
    rpc: (name: string, args?: unknown) => rpc(name, args),
  }),
}));

import { attachInboxAttachmentToResumeFile } from "./resumes";

const attachment = {
  title: "David Levi.docx",
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  path: "7/inbox/44/David-Levi.docx",
  src: "https://signed.example/should-not-be-used",
};

describe("attachInboxAttachmentToResumeFile", () => {
  beforeEach(() => {
    download.mockReset();
    upload.mockReset();
    remove.mockReset();
    rpc.mockReset();
    rpc.mockImplementation((name: string) => {
      if (name === "current_context_id") return { data: 7, error: null };
      return {
        data: [
          {
            id: 900,
            files: [
              {
                path: "7/resumes/42/inbox-source.docx",
                filename: "David Levi.docx",
                source_inbox_item_id: 44,
                source_inbox_attachment_path: attachment.path,
              },
            ],
          },
        ],
        error: null,
      };
    });
    download.mockResolvedValue({
      data: { size: 3210 } as Blob,
      error: null,
    });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
  });

  it("copies durable bytes and appends through the provenance-aware RPC without using the signed URL", async () => {
    const result = await attachInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 44,
      attachment,
    });

    expect(download).toHaveBeenCalledWith("attachments", attachment.path);
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path] = upload.mock.calls[0];
    expect(bucket).toBe("documents");
    expect(path).toMatch(
      /^7\/resumes\/42\/inbox-[0-9a-f]{64}-David-Levi\.docx$/,
    );
    expect(path).not.toContain("signed.example");
    expect(rpc).toHaveBeenLastCalledWith("add_resume_file", {
      p_path: path,
      p_filename: attachment.title,
      p_mime_type: attachment.type,
      p_size: 3210,
      p_shidduchim_id: 42,
      p_single_id: undefined,
      p_source_inbox_item_id: 44,
      p_source_inbox_attachment_path: attachment.path,
    });
    expect(result.id).toBe(900);
  });

  it("cleans up the deterministic destination when the atomic append fails", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "current_context_id") return { data: 7, error: null };
      return { data: null, error: { message: "Inbox attachment not found" } };
    });

    await expect(
      attachInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 44,
        attachment,
      }),
    ).rejects.toThrow("Could not attach this file");

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toBe("documents");
  });
});
