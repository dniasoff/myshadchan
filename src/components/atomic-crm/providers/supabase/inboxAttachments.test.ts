import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataProvider } from "ra-core";

/**
 * Mocks the Supabase client entirely (the `entityFiles.test.ts` idiom) so
 * `signInboxAttachmentUrl` can be exercised without a real backend.
 * `vi.hoisted` is required because `vi.mock`'s factory itself is hoisted
 * above every import/declaration.
 */
const { createSignedUrl, download, upload, remove, rpc } = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
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
    const create = vi.fn();
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
});
