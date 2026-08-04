import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { MAX_ATTACHMENT_BYTES } from "./inboxAttachment";
import { ENTITLED_PAYLOAD, TEST_ENV, makeExtract } from "./parseTestFixtures";

/**
 * Finding 9 (Story 11-1 review report): an attachment's size is checked
 * BEFORE it is downloaded, via storage `list()` metadata, with a
 * post-download backstop for when that metadata is unavailable. Split out
 * of `index.test.ts` once it would have pushed that file well past the
 * ~400-line typical ceiling (coding-style.md).
 */

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const single = vi.fn();
const update = vi.fn().mockReturnThis();
const insert = vi.fn().mockReturnThis();
const storageFrom = vi.fn();
const download = vi.fn();
const list = vi.fn();
const from = vi.fn(() => ({ select, eq, single, update, insert }));

const mockScopedTable = {
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ data: [], error: null }),
  }),
  insert: vi.fn().mockReturnValue({ error: null }),
  update: vi.fn(() => ({
    eq: vi.fn().mockReturnValue({ data: null, error: null }),
  })),
  delete: vi.fn(),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from,
    storage: { from: storageFrom },
  }),
}));

vi.mock("../shared/forAccount", () => ({
  forAccount: vi.fn(() => ({ from: () => mockScopedTable })),
}));

function arrangeEntitledItemWithAttachment() {
  rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
  single.mockResolvedValue({
    data: {
      id: 1,
      account_id: 10,
      attachments: [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: "10/resume.pdf",
        },
      ],
    },
    error: null,
  });
  storageFrom.mockReturnValue({ download, list });
}

function postParse(app: ReturnType<typeof createParseApp>) {
  return app.request(
    "http://parse.local/parse",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inbox_item_id: 1 }),
    },
    TEST_ENV,
  );
}

describe("Finding 9 — attachment size guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
  });

  it("rejects an oversized attachment via storage list() metadata BEFORE downloading", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({
      data: [{ metadata: { size: MAX_ATTACHMENT_BYTES + 1 } }],
      error: null,
    });
    const app = createParseApp();

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      success: false,
      error: "attachment too large",
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("accepts an attachment exactly at the byte cap", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({
      data: [{ metadata: { size: MAX_ATTACHMENT_BYTES } }],
      error: null,
    });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    const app = createParseApp({ extract: async () => makeExtract() });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
  });

  it("falls back to a post-download size check when storage metadata is unavailable, and never reaches the extractor", async () => {
    // Arrange — the `list()` metadata check is the primary guard; this
    // proves the backstop still catches an oversized file when that
    // metadata is missing, WITHOUT allocating a real oversized buffer in
    // the test.
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: {
        arrayBuffer: async () => ({
          byteLength: MAX_ATTACHMENT_BYTES + 1,
        }),
      },
      error: null,
    });
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      success: false,
      error: "attachment too large",
    });
    expect(extractSpy).not.toHaveBeenCalled();
  });
});
