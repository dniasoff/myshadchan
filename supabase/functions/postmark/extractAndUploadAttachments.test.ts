import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the Supabase client entirely (the `index.test.ts` / `entityFiles.test.ts`
 * idiom) so `extractAndUploadAttachments` can be exercised without a real
 * backend. `vi.hoisted` is required because `vi.mock`'s factory itself is
 * hoisted above every import/declaration.
 */
const { upload, createSignedUrl } = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({ upload, createSignedUrl }),
    },
  },
}));

import { extractAndUploadAttachments } from "./extractAndUploadAttachments.ts";

// Base64 for "This is attachment contents, base-64 encoded." — the exact
// content the docstring's own curl example uses.
const VALID_CONTENT =
  "VGhpcyBpcyBhdHRhY2htZW50IGNvbnRlbnRzLCBiYXNlLTY0IGVuY29kZWQu";

describe("extractAndUploadAttachments — filename sanitization (Story 10.3 review fix F-H)", () => {
  beforeEach(() => {
    upload.mockReset();
    createSignedUrl.mockReset();
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: "http://kong:8000/storage/v1/object/sign/attachments/x",
      },
      error: null,
    });
  });

  it("keeps a plain alphanumeric extension", async () => {
    // Arrange
    const attachments = [
      {
        Name: "resume.pdf",
        Content: VALID_CONTENT,
        ContentType: "application/pdf",
        ContentLength: 45,
      },
    ];

    // Act
    const [attachment] = await extractAndUploadAttachments(
      attachments,
      11,
      "http://localhost:54321",
    );

    // Assert
    expect(attachment.path).toMatch(/^11\/[0-9a-f-]{36}\.pdf$/);
  });

  it("drops a path-traversal-shaped 'extension' rather than embedding it in the key (review fix F-H)", async () => {
    // Arrange — `Name.split(".").pop()` used to take this verbatim,
    // producing a key like `11/<uuid>./evil`.
    const attachments = [
      {
        Name: "a.txt/../../../evil",
        Content: VALID_CONTENT,
        ContentType: "text/plain",
        ContentLength: 45,
      },
    ];

    // Act
    const [attachment] = await extractAndUploadAttachments(
      attachments,
      11,
      "http://localhost:54321",
    );

    // Assert — no `/`, no `..`, no sender-controlled bytes at all: just the
    // account prefix and a fresh UUID.
    expect(attachment.path).toMatch(/^11\/[0-9a-f-]{36}$/);
  });

  it("drops an unreasonably long 'extension'", async () => {
    // Arrange
    const attachments = [
      {
        Name: `file.${"a".repeat(50)}`,
        Content: VALID_CONTENT,
        ContentType: "text/plain",
        ContentLength: 45,
      },
    ];

    // Act
    const [attachment] = await extractAndUploadAttachments(
      attachments,
      11,
      "http://localhost:54321",
    );

    // Assert
    expect(attachment.path).toMatch(/^11\/[0-9a-f-]{36}$/);
  });

  it("produces no extension when the filename has none", async () => {
    // Arrange
    const attachments = [
      {
        Name: "noextension",
        Content: VALID_CONTENT,
        ContentType: "text/plain",
        ContentLength: 45,
      },
    ];

    // Act
    const [attachment] = await extractAndUploadAttachments(
      attachments,
      11,
      "http://localhost:54321",
    );

    // Assert
    expect(attachment.path).toMatch(/^11\/[0-9a-f-]{36}$/);
  });
});
