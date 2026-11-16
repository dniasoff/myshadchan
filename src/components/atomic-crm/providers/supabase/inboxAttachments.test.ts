import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataProvider } from "ra-core";

/**
 * Mocks the Supabase client entirely (the `entityFiles.test.ts` idiom) so
 * `signInboxAttachmentUrl` can be exercised without a real backend.
 * `vi.hoisted` is required because `vi.mock`'s factory itself is hoisted
 * above every import/declaration.
 */
const { createSignedUrl, download, upload, remove, rpc, getList, create } =
  vi.hoisted(() => ({
    createSignedUrl: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    rpc: vi.fn(),
    getList: vi.fn(),
    create: vi.fn(),
  }));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: () => ({ createSignedUrl, download, upload, remove }),
    },
    rpc,
  }),
}));

import {
  INBOX_ATTACHMENT_URL_TTL_SECONDS,
  copyInboxAttachmentsToEntityFiles,
  signInboxAttachmentUrl,
} from "./inboxAttachments";

describe("signInboxAttachmentUrl (Story 10.3 review fix F-B)", () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
    download.mockReset();
    upload.mockReset();
    remove.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: 7, error: null });
    getList.mockReset();
    create.mockReset();
  });

  it("signs the given path with the short, minted-per-click TTL and returns the signed URL", async () => {
    // Arrange
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/1/abc.pdf?token=fresh" },
      error: null,
    });

    // Act
    const url = await signInboxAttachmentUrl("1/abc.pdf");

    // Assert
    expect(url).toBe("https://signed.example/1/abc.pdf?token=fresh");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "1/abc.pdf",
      INBOX_ATTACHMENT_URL_TTL_SECONDS,
    );
  });

  it("mints a new URL on every call — never caches the previous result", async () => {
    // Arrange
    createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: "https://signed.example/first" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://signed.example/second" },
        error: null,
      });

    // Act
    const first = await signInboxAttachmentUrl("1/abc.pdf");
    const second = await signInboxAttachmentUrl("1/abc.pdf");

    // Assert
    expect(first).toBe("https://signed.example/first");
    expect(second).toBe("https://signed.example/second");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("throws when Supabase returns an error instead of a signed URL", async () => {
    // Arrange
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "object not found" },
    });

    // Act / Assert
    await expect(signInboxAttachmentUrl("1/missing.pdf")).rejects.toThrow(
      "Failed to open the attachment",
    );
  });

  it("uses static, content-free errors while copying captured attachments", async () => {
    const attachment = {
      title: "family-secret.pdf",
      type: "application/pdf",
      path: "7/inbox/family-secret.pdf",
      src: "https://signed.example/family-secret.pdf",
    };
    const baseDataProvider = { create } as unknown as DataProvider;

    download.mockResolvedValueOnce({
      data: null,
      error: { message: "provider path and filename leaked" },
    });
    await expect(
      copyInboxAttachmentsToEntityFiles({
        baseDataProvider,
        attachments: [attachment],
        targetType: "shidduch",
        targetId: 42,
      }),
    ).rejects.toThrow("Failed to download the captured attachment");

    download.mockResolvedValueOnce({ data: new Blob(["bytes"]), error: null });
    upload.mockResolvedValueOnce({
      error: { message: "provider path and filename leaked" },
    });
    await expect(
      copyInboxAttachmentsToEntityFiles({
        baseDataProvider,
        attachments: [attachment],
        targetType: "shidduch",
        targetId: 42,
      }),
    ).rejects.toThrow("Failed to upload the captured attachment");

    download.mockResolvedValueOnce({ data: new Blob(["bytes"]), error: null });
    upload.mockResolvedValueOnce({ error: null });
    create.mockRejectedValueOnce(
      new Error("provider path and filename leaked"),
    );
    await expect(
      copyInboxAttachmentsToEntityFiles({
        baseDataProvider,
        attachments: [attachment],
        targetType: "shidduch",
        targetId: 42,
      }),
    ).rejects.toThrow("Failed to save the captured attachment");
  });

  it("copies pictures as private_parent with a deterministic retry key", async () => {
    const picture = {
      title: "family-photo.jpg",
      type: "image/jpeg",
      path: "7/inbox/family-photo.jpg",
      src: "https://signed.example/family-photo.jpg",
    };
    const copied = {
      id: 91,
      account_id: 7,
      target_type: "shidduch",
      target_id: 42,
      storage_path: "",
      file_name: picture.title,
      mime_type: picture.type,
      size_bytes: 4,
      visibility: "private_parent",
      created_at: "2026-01-01T00:00:00Z",
    };
    const baseDataProvider = {
      getList,
      create,
    } as unknown as DataProvider;
    let existing: typeof copied | undefined;
    getList.mockImplementation(async () => ({
      data: existing ? [existing] : [],
      total: existing ? 1 : 0,
    }));
    create.mockImplementation(async (_resource, params) => {
      existing = {
        ...copied,
        storage_path: (params as { data: { storage_path: string } }).data
          .storage_path,
      };
      return { data: existing };
    });
    download.mockResolvedValue({ data: new Blob(["bytes"]), error: null });
    upload.mockResolvedValue({ error: null });

    const first = await copyInboxAttachmentsToEntityFiles({
      baseDataProvider,
      attachments: [picture],
      targetType: "shidduch",
      targetId: 42,
      visibility: "private_parent",
      sourceInboxItemId: 44,
    });
    const second = await copyInboxAttachmentsToEntityFiles({
      baseDataProvider,
      attachments: [picture],
      targetType: "shidduch",
      targetId: 42,
      visibility: "private_parent",
      sourceInboxItemId: 44,
    });

    expect(first[0].visibility).toBe("private_parent");
    expect(second[0].visibility).toBe("private_parent");
    expect(first[0].storage_path).toBe(second[0].storage_path);
    expect(first[0].visibility).not.toBe("shared");
    expect(create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
