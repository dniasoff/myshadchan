import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the Supabase client entirely (the `inboxAttachments.test.ts` /
 * `resumeStorageCleanup.test.ts` idiom), so `copyInboxAttachmentToResumeFile`
 * can be exercised without a real backend. `from` is routed by bucket id so
 * a single test can assert the download and the upload each hit the bucket
 * they're supposed to.
 */
const { download, upload, remove, rpc, tableMaybeSingle } = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  tableMaybeSingle: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => download(bucket, path),
        upload: (path: string, data: unknown, options?: unknown) =>
          upload(bucket, path, data, options),
        remove: (paths: string[]) => remove(bucket, paths),
      }),
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => tableMaybeSingle(table),
      };
      return query;
    },
    rpc: (name: string, args?: unknown) => rpc(name, args),
  }),
}));

import {
  attachInboxAttachmentToResumeFile,
  copyInboxAttachmentToResumeFile,
  removeResumeFileObjectsOrThrow,
} from "./resumes";

const FAKE_BLOB = { size: 48213 } as Blob;

describe("copyInboxAttachmentToResumeFile (Story 11.2 review fix, Finding 2)", () => {
  beforeEach(() => {
    download.mockReset();
    upload.mockReset();
    remove.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 7, error: null });
    tableMaybeSingle.mockReset();
  });

  it("downloads the captured attachment from the attachments bucket and re-uploads it under the documents bucket's resumes/{shidduch} grammar", async () => {
    // Arrange
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: null });

    // Act
    const result = await copyInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 700,
      attachment: {
        path: "7/inbox-abc.pdf",
        title: "resume.pdf",
        type: "application/pdf",
        src: "https://example.test/resume.pdf",
      },
    });

    // Assert: read from the exact bucket + path the inbox capture landed at.
    expect(download).toHaveBeenCalledWith("attachments", "7/inbox-abc.pdf");

    // Assert: written to the documents bucket under {account}/resumes/{shidduch}/.
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, data, options] = upload.mock.calls[0];
    expect(bucket).toBe("documents");
    expect(path).toMatch(/^7\/resumes\/42\/inbox-[0-9a-f]{64}$/);
    expect(options).toEqual({ upsert: true });
    expect(data).toBe(FAKE_BLOB);

    // Assert: the returned path is the one that was actually written — the
    // regression test for the whole finding: `signResumeFileUrl` signs
    // against the `documents` bucket, so a path this function returns must
    // resolve there, not in `attachments`.
    expect(result.storagePath).toBe(path);
  });

  it("records the real downloaded byte size instead of a hardcoded 0", async () => {
    // Arrange
    download.mockResolvedValue({
      data: { size: 913456 } as Blob,
      error: null,
    });
    upload.mockResolvedValue({ error: null });

    // Act
    const result = await copyInboxAttachmentToResumeFile({
      shidduchimId: 42,
      inboxItemId: 700,
      attachment: {
        path: "7/inbox-abc.pdf",
        title: "resume.pdf",
        type: "application/pdf",
        src: "https://example.test/resume.pdf",
      },
    });

    // Assert
    expect(result.size).toBe(913456);
  });

  it("uses the single- owner segment for a single's own resume subject", async () => {
    // Arrange
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: null });

    // Act
    await copyInboxAttachmentToResumeFile({
      singleId: 15,
      inboxItemId: 700,
      attachment: {
        path: "7/inbox-abc.pdf",
        title: "resume.pdf",
        type: "application/pdf",
        src: "https://example.test/resume.pdf",
      },
    });

    // Assert
    const [, path] = upload.mock.calls[0];
    expect(path).toMatch(/^7\/resumes\/single-15\/inbox-[0-9a-f]{64}$/);
  });

  it("keeps the opaque destination stable when the display title changes", async () => {
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: null });

    const base = {
      shidduchimId: 42,
      inboxItemId: 700,
      attachment: {
        path: "7/inbox-abc.pdf",
        title: "Alice Cohen.pdf",
        type: "application/pdf",
        src: "https://example.test/resume.pdf",
      },
    } as const;
    await copyInboxAttachmentToResumeFile(base);
    await copyInboxAttachmentToResumeFile({
      ...base,
      attachment: { ...base.attachment, title: "Renamed resume.docx" },
    });

    expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]);
    expect(upload.mock.calls[0][1]).not.toContain("Alice");
    expect(upload.mock.calls[0][1]).not.toContain("Renamed");
  });

  it("throws a friendly error and never uploads when the captured attachment cannot be downloaded", async () => {
    // Arrange
    download.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });

    // Act / Assert
    await expect(
      copyInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 700,
        attachment: {
          path: "7/missing.pdf",
          title: "resume.pdf",
          type: "application/pdf",
          src: "https://example.test/resume.pdf",
        },
      }),
    ).rejects.toThrow("Failed to read the captured resume attachment");
    expect(upload).not.toHaveBeenCalled();
  });

  it("throws a friendly error when the upload into the documents bucket fails", async () => {
    // Arrange
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: { message: "quota exceeded" } });

    // Act / Assert
    await expect(
      copyInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 700,
        attachment: {
          path: "7/inbox-abc.pdf",
          title: "resume.pdf",
          type: "application/pdf",
          src: "https://example.test/resume.pdf",
        },
      }),
    ).rejects.toThrow("Failed to save the captured resume");
  });

  it("reuses the deterministic destination after an ambiguous upload failure", async () => {
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload
      .mockResolvedValueOnce({ error: { message: "request timed out" } })
      .mockResolvedValueOnce({ error: null });

    const params = {
      shidduchimId: 42,
      inboxItemId: 700,
      attachment: {
        path: "7/inbox-abc.pdf",
        title: "resume.pdf",
        type: "application/pdf",
        src: "https://example.test/resume.pdf",
      },
    } as const;

    await expect(copyInboxAttachmentToResumeFile(params)).rejects.toThrow(
      "Failed to save the captured resume",
    );
    const retried = await copyInboxAttachmentToResumeFile(params);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]);
    expect(upload.mock.calls[0][3]).toEqual({ upsert: true });
    expect(retried.storagePath).toBe(upload.mock.calls[1][1]);
  });

  it("cleans the opaque object when a manager-only append is rejected", async () => {
    tableMaybeSingle
      .mockResolvedValueOnce({
        data: { id: 700, status: "unresolved" },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 42 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "current_context_id") return { data: 7, error: null };
      if (name === "current_member_role")
        return { data: "helper", error: null };
      if (name === "add_resume_file") {
        return {
          data: null,
          error: {
            code: "42501",
            status: 403,
            message: "new row violates row-level security policy",
          },
        };
      }
      return { data: null, error: null };
    });
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: null });

    await expect(
      attachInboxAttachmentToResumeFile({
        shidduchimId: 42,
        inboxItemId: 700,
        attachment: {
          path: "7/inbox-abc.pdf",
          title: "private name.pdf",
          type: "application/pdf",
        },
      }),
    ).rejects.toThrow("Could not attach this file");

    expect(remove).toHaveBeenCalledWith(
      "documents",
      expect.arrayContaining([expect.stringMatching(/inbox-[0-9a-f]{64}$/)]),
    );
  });

  it("strictly reports a storage tuple error so owned compensation keeps its catalog row", async () => {
    remove.mockResolvedValue({ error: { message: "storage down" } });

    await expect(
      removeResumeFileObjectsOrThrow(["7/resumes/42/resume.pdf"]),
    ).rejects.toThrow("Could not clean up the resume file objects");
    expect(remove).toHaveBeenCalledWith("documents", [
      "7/resumes/42/resume.pdf",
    ]);
  });
});
