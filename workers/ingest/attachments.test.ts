import { describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "./emailFixtures";
import type { ParsedEmailAttachment } from "./parseEmail";
import { uploadAttachments } from "./attachments";

/**
 * A minimal in-memory fake of the Storage surface `attachments.ts` touches:
 * `.storage.from(bucket).upload(path, content, opts)`,
 * `.createSignedUrl(path, ttl)`, and compensating `.remove(paths)`. Same
 * "mock the client entirely" idiom
 * `forAccount.test.ts` and `share/index.test.ts` already use in this repo.
 */
const { uploads, upload, createSignedUrl, remove, storageFrom } = vi.hoisted(
  () => {
    const uploads: Array<{ path: string; contentType?: string }> = [];
    const upload = vi.fn(
      async (
        path: string,
        _content: unknown,
        opts?: { contentType?: string },
      ): Promise<{
        data: { path: string } | null;
        error: { message: string } | null;
      }> => {
        uploads.push({ path, contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
    );
    const createSignedUrl = vi.fn(
      async (
        path: string,
      ): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }> => ({
        data: { signedUrl: `https://example.supabase.co/signed/${path}` },
        error: null,
      }),
    );
    const remove = vi.fn(
      async (
        _paths: string[],
      ): Promise<{ error: { message: string } | null }> => ({ error: null }),
    );
    const storageFrom = vi.fn(() => ({ upload, createSignedUrl, remove }));
    return { uploads, upload, createSignedUrl, remove, storageFrom };
  },
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: storageFrom } }),
}));

function makeAttachment(
  overrides: Partial<ParsedEmailAttachment> = {},
): ParsedEmailAttachment {
  return {
    filename: "resume.pdf",
    mimeType: "application/pdf",
    content: new TextEncoder().encode("PDF-DATA").buffer,
    ...overrides,
  };
}

describe("uploadAttachments", () => {
  it("uploads to the private attachments bucket under an account-prefixed path", async () => {
    // Arrange
    const attachment = makeAttachment();

    // Act
    await uploadAttachments([attachment], 42, TEST_ENV);

    // Assert
    expect(storageFrom).toHaveBeenCalledWith("attachments");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^42\/[0-9a-f-]{36}\.pdf$/);
    expect(uploads[0].contentType).toBe("application/pdf");
  });

  it("returns the title/type/path/src shape the frontend renders", async () => {
    // Arrange
    const attachment = makeAttachment({ filename: "resume.pdf" });

    // Act
    const [result] = await uploadAttachments([attachment], 7, TEST_ENV);

    // Assert
    expect(result.title).toBe("resume.pdf");
    expect(result.type).toBe("application/pdf");
    expect(result.path).toMatch(/^7\//);
    expect(result.src).toBe(
      `https://example.supabase.co/signed/${result.path}`,
    );
  });

  it("keeps only a short alphanumeric extension for a normal filename", async () => {
    // Arrange
    const attachment = makeAttachment({ filename: "photo.JPG" });

    // Act
    const [result] = await uploadAttachments([attachment], 1, TEST_ENV);

    // Assert
    expect(result.path.endsWith(".JPG")).toBe(true);
  });

  it("drops the extension for a path-traversal filename instead of sanitizing it byte-by-byte", async () => {
    // Arrange — Story 10.3 review fix F-H's exact scenario, ported.
    const attachment = makeAttachment({ filename: "a.txt/../../../evil" });

    // Act
    const [result] = await uploadAttachments([attachment], 1, TEST_ENV);

    // Assert: no extension survives (the "evil" segment is far longer than
    // 10 chars and contains no traversal characters in the stored key at
    // all), and — the actual security property — the path never contains a
    // literal ".." or "/" beyond the single account-id prefix separator.
    expect(result.path.startsWith("1/")).toBe(true);
    expect(result.path.slice(2)).not.toMatch(/[./]/);
  });

  it("drops an unreasonably long or non-alphanumeric extension", async () => {
    // Arrange
    const attachment = makeAttachment({
      filename: "resume.reallylongextensionover10chars",
    });

    // Act
    const [result] = await uploadAttachments([attachment], 1, TEST_ENV);

    // Assert
    expect(result.path.slice(2)).not.toContain(".");
  });

  it("skips an attachment missing a filename or mimeType rather than throwing", async () => {
    // Arrange
    const badAttachment = makeAttachment({ filename: null });
    const goodAttachment = makeAttachment({ filename: "ok.pdf" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Act
    const result = await uploadAttachments(
      [badAttachment, goodAttachment],
      1,
      TEST_ENV,
    );

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("ok.pdf");
    warnSpy.mockRestore();
  });

  it("throws when the upload itself fails, so the caller can reject the message", async () => {
    // Arrange
    upload.mockResolvedValueOnce({
      data: null,
      error: { message: "storage is down" },
    });
    const attachment = makeAttachment();

    // Act / Assert
    await expect(uploadAttachments([attachment], 1, TEST_ENV)).rejects.toThrow(
      /Failed to upload attachment/,
    );
  });

  it("throws when signing the URL fails", async () => {
    // Arrange
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "signing is down" },
    });
    const attachment = makeAttachment();

    // Act / Assert
    await expect(uploadAttachments([attachment], 1, TEST_ENV)).rejects.toThrow(
      /Failed to sign attachment URL/,
    );
  });

  it("keeps the original signing error when compensating removal also fails", async () => {
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "signing is down" },
    });
    remove.mockResolvedValueOnce({ error: { message: "remove is down" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      uploadAttachments([makeAttachment()], 1, TEST_ENV),
    ).rejects.toThrow("Failed to sign attachment URL");
    expect(remove).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "ingest.uploadAttachments.cleanup.error",
      expect.objectContaining({ message: "remove is down" }),
    );
    errorSpy.mockRestore();
  });

  it("keeps the original signing error when compensation is unavailable", async () => {
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "signing is down" },
    });
    const originalStorageFrom = storageFrom.getMockImplementation();
    storageFrom.mockImplementation(
      () => ({ upload, createSignedUrl }) as never,
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        uploadAttachments([makeAttachment()], 1, TEST_ENV),
      ).rejects.toThrow("Failed to sign attachment URL");
      expect(errorSpy).toHaveBeenCalledWith(
        "ingest.uploadAttachments.cleanup.error",
        expect.anything(),
      );
    } finally {
      storageFrom.mockImplementation(originalStorageFrom!);
      errorSpy.mockRestore();
    }
  });
});
