import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the Supabase client entirely (the `inboxAttachments.test.ts` /
 * `resumeStorageCleanup.test.ts` idiom), so `copyInboxAttachmentToResumeFile`
 * can be exercised without a real backend. `from` is routed by bucket id so
 * a single test can assert the download and the upload each hit the bucket
 * they're supposed to.
 */
const { download, upload, rpc } = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => download(bucket, path),
        upload: (path: string, data: unknown) => upload(bucket, path, data),
      }),
    },
    rpc: (name: string, args?: unknown) => rpc(name, args),
  }),
}));

import { copyInboxAttachmentToResumeFile } from "./resumes";

const FAKE_BLOB = { size: 48213 } as Blob;

describe("copyInboxAttachmentToResumeFile (Story 11.2 review fix, Finding 2)", () => {
  beforeEach(() => {
    download.mockReset();
    upload.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 7, error: null });
  });

  it("downloads the captured attachment from the attachments bucket and re-uploads it under the documents bucket's resumes/{shidduch} grammar", async () => {
    // Arrange
    download.mockResolvedValue({ data: FAKE_BLOB, error: null });
    upload.mockResolvedValue({ error: null });

    // Act
    const result = await copyInboxAttachmentToResumeFile({
      shidduchimId: 42,
      attachmentPath: "7/inbox-abc.pdf",
      fileName: "resume.pdf",
    });

    // Assert: read from the exact bucket + path the inbox capture landed at.
    expect(download).toHaveBeenCalledWith("attachments", "7/inbox-abc.pdf");

    // Assert: written to the documents bucket under {account}/resumes/{shidduch}/.
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, data] = upload.mock.calls[0];
    expect(bucket).toBe("documents");
    expect(path).toMatch(/^7\/resumes\/42\/[0-9a-f-]+-resume\.pdf$/);
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
      attachmentPath: "7/inbox-abc.pdf",
      fileName: "resume.pdf",
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
      attachmentPath: "7/inbox-abc.pdf",
      fileName: "resume.pdf",
    });

    // Assert
    const [, path] = upload.mock.calls[0];
    expect(path).toMatch(/^7\/resumes\/single-15\/[0-9a-f-]+-resume\.pdf$/);
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
        attachmentPath: "7/missing.pdf",
        fileName: "resume.pdf",
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
        attachmentPath: "7/inbox-abc.pdf",
        fileName: "resume.pdf",
      }),
    ).rejects.toThrow("Failed to save the captured resume");
  });
});
