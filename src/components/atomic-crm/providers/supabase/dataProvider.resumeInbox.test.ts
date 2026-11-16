import { beforeEach, describe, expect, it, vi } from "vitest";

const { download, upload, remove, rpc, from } = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
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
    from: (table: string) => from(table),
  }),
}));

import { attachInboxAttachmentToResumeFile } from "./resumes";

const attachment = {
  title: "David Levi.docx",
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  path: "7/inbox/44/David-Levi.docx",
  src: "https://signed.example/should-not-be-used",
};

let sourceStatus: string;
let sourceExists: boolean;
let targetExists: boolean;
let existingFiles: unknown[];

describe("attachInboxAttachmentToResumeFile", () => {
  beforeEach(() => {
    download.mockReset();
    upload.mockReset();
    remove.mockReset();
    rpc.mockReset();
    from.mockReset();
    sourceStatus = "unresolved";
    sourceExists = true;
    targetExists = true;
    existingFiles = [];
    from.mockImplementation((table: string) => {
      const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      builder.select.mockReturnValue(builder);
      builder.eq.mockReturnValue(builder);
      builder.maybeSingle.mockResolvedValue(
        table === "inbox_items"
          ? {
              data: sourceExists ? { id: 44, status: sourceStatus } : null,
              error: null,
            }
          : table === "shidduchim"
            ? {
                data: targetExists ? { id: 42 } : null,
                error: null,
              }
            : {
                data: {
                  id: 900,
                  account_id: 7,
                  shidduchim_id: 42,
                  files: existingFiles,
                },
                error: null,
              },
      );
      return builder;
    });
    rpc.mockImplementation((name: string, args?: { p_path?: string }) => {
      if (name === "current_context_id") return { data: 7, error: null };
      if (name === "current_member_role")
        return { data: "parent", error: null };
      return {
        data: [
          {
            id: 900,
            files: [
              {
                path: args?.p_path,
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

  it("cleans up its destination when the delete wins before the atomic append", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "current_context_id") return { data: 7, error: null };
      if (name === "current_member_role")
        return { data: "parent", error: null };
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
    expect(remove.mock.calls[0][1]).toEqual([
      expect.stringMatching(
        /^7\/resumes\/42\/inbox-[0-9a-f]{64}-David-Levi\.docx$/,
      ),
    ]);
  });

  it("returns an existing account-scoped row on a duplicate retry without copying", async () => {
    existingFiles = [
      {
        path: "7/resumes/42/inbox-duplicate.docx",
        filename: attachment.title,
        source_inbox_item_id: 44,
        source_inbox_attachment_path: attachment.path,
      },
    ];

    const result = await attachInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 44,
      attachment,
    });

    expect(result).toMatchObject({
      id: 900,
      account_id: 7,
      shidduchim_id: 42,
      files: existingFiles,
    });
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("add_resume_file", expect.anything());
  });

  it("rejects an already-resolved Inbox item before copying bytes", async () => {
    sourceStatus = "resolved";

    await expect(
      attachInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 44,
        attachment,
      }),
    ).rejects.toThrow("Could not attach this file");

    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an attach after delete won without creating an orphan destination copy", async () => {
    sourceExists = false;

    await expect(
      attachInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 44,
        attachment,
      }),
    ).rejects.toThrow("Could not attach this file");

    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not delete a shared object when a lost response races with a retry", async () => {
    const storedObjects = new Set<string>();
    let appendCalls = 0;
    let signalFirstAppend!: () => void;
    let releaseFirstAppend!: (result: {
      data: null;
      error: { message: string };
    }) => void;
    const firstAppendStarted = new Promise<void>((resolve) => {
      signalFirstAppend = resolve;
    });
    const firstAppendResponse = new Promise<{
      data: null;
      error: { message: string };
    }>((resolve) => {
      releaseFirstAppend = resolve;
    });

    upload.mockImplementation(async (bucket: string, path: string) => {
      if (bucket === "documents") {
        if (storedObjects.has(path)) {
          return {
            error: { statusCode: 409, message: "already exists" },
          };
        }
        storedObjects.add(path);
      }
      return { error: null };
    });
    rpc.mockImplementation((name: string, args?: { p_path?: string }) => {
      if (name === "current_context_id") return { data: 7, error: null };
      if (name === "current_member_role")
        return { data: "parent", error: null };
      appendCalls += 1;
      if (appendCalls === 1) {
        signalFirstAppend();
        return firstAppendResponse;
      }
      return {
        data: [
          {
            id: 900,
            files: [
              {
                path: args?.p_path,
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

    const firstAttempt = attachInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 44,
      attachment,
    });
    await firstAppendStarted;

    const retryResult = await attachInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 44,
      attachment,
    });
    releaseFirstAppend({
      data: null,
      error: { message: "network response lost" },
    });
    await expect(firstAttempt).rejects.toThrow("Could not attach this file");

    const destinationPath = upload.mock.calls[0][1];
    expect(upload).toHaveBeenCalledTimes(2);
    expect(storedObjects.has(destinationPath)).toBe(true);
    expect(retryResult.files?.[0]?.path).toBe(destinationPath);
    expect(remove).not.toHaveBeenCalled();
  });
});
