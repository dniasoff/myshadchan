import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { MAX_ATTACHMENT_BYTES } from "./inboxAttachment";
import {
  APPLIED_CONFIRM_OUTCOME,
  APPLIED_RELEASE_OUTCOME,
  CLAIMED_ATTEMPT,
  ENTITLED_PAYLOAD,
  TEST_ENV,
  makeExtract,
} from "./parseTestFixtures";

/**
 * Finding 9 (Story 11-1 review report): an attachment's size is checked
 * BEFORE it is downloaded, via storage `list()` metadata, with a
 * post-download backstop for when that metadata is unavailable. Split out
 * of `index.test.ts` once it would have pushed that file well past the
 * ~400-line typical ceiling (coding-style.md).
 *
 * Findings 6/7 closure note: by the time either size guard fires, the
 * reservation is already claimed (step 5 runs before step 6), so both
 * branches below must give it back via `releaseParseAttempt()` — otherwise
 * an account would be charged a unit for an attachment that was rejected
 * before any inference ever ran.
 */

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const single = vi.fn();
const storageFrom = vi.fn();
const download = vi.fn();
const list = vi.fn();
const from = vi.fn(() => ({ select, eq, single }));

const claimParseAttempt = vi.fn();
const confirmParseAttempt = vi.fn();
const releaseParseAttempt = vi.fn();
const forceReclaimParseAttempt = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from,
    storage: { from: storageFrom },
  }),
}));

vi.mock("./parseQuota", () => ({
  claimParseAttempt: (...args: unknown[]) => claimParseAttempt(...args),
  confirmParseAttempt: (...args: unknown[]) => confirmParseAttempt(...args),
}));

vi.mock("./parseQuotaRecovery", () => ({
  releaseParseAttempt: (...args: unknown[]) => releaseParseAttempt(...args),
  forceReclaimParseAttempt: (...args: unknown[]) =>
    forceReclaimParseAttempt(...args),
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
  claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
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
    releaseParseAttempt.mockResolvedValue(APPLIED_RELEASE_OUTCOME);
    confirmParseAttempt.mockResolvedValue(APPLIED_CONFIRM_OUTCOME);
  });

  it("rejects an oversized attachment via storage list() metadata BEFORE downloading, and releases the reservation it had already claimed", async () => {
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
    expect(releaseParseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      10,
      CLAIMED_ATTEMPT.outcome.attempt_id,
      CLAIMED_ATTEMPT.outcome.generation,
    );
    expect(confirmParseAttempt).not.toHaveBeenCalled();
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
    expect(releaseParseAttempt).not.toHaveBeenCalled();
  });

  it("falls back to a post-download size check when storage metadata is unavailable, releases the reservation, and never reaches the extractor", async () => {
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
    expect(releaseParseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      10,
      CLAIMED_ATTEMPT.outcome.attempt_id,
      CLAIMED_ATTEMPT.outcome.generation,
    );
  });
});
