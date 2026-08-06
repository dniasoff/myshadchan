import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import {
  APPLIED_CONFIRM_OUTCOME,
  APPLIED_RELEASE_OUTCOME,
  CLAIMED_ATTEMPT,
  ENTITLED_PAYLOAD,
  TEST_ENV,
  makeExtract,
} from "./parseTestFixtures";

/**
 * Finding 19 (Epic 11 adversarial review, P2) closure: `imageDimensionGuard.ts`
 * was built and unit-tested but never called from the request path — a
 * compact decompression-bomb-shaped PNG/JPEG/WebP reached the extractor
 * exactly as before. These tests prove the wiring itself: that
 * `POST /parse` actually invokes the guard, refuses an over-dimension
 * image WITHOUT spending inference, and leaves a normal image and a PDF
 * unaffected. `imageDimensionGuard.test.ts`'s own unit tests only prove the
 * byte-parsing logic — they exercise the module directly and could all
 * stay green even if `index.ts` never imported it, which is exactly what
 * happened before this file existed.
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

/**
 * Builds a minimal, valid PNG header — signature (8 bytes) + a length field
 * (unused by the guard) + the "IHDR" chunk type + big-endian width/height —
 * exactly the 24 bytes `readImageDimensions()` reads and no more. Real PNG
 * files carry bit depth/color type/CRC bytes after this; the guard never
 * looks past byte 24, so this fixture doesn't need them either.
 */
function buildPngBytes(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  signature.forEach((byte, i) => view.setUint8(i, byte));
  view.setUint32(8, 13, false); // IHDR chunk length, unused here
  view.setUint8(12, 0x49); // "I"
  view.setUint8(13, 0x48); // "H"
  view.setUint8(14, 0x44); // "D"
  view.setUint8(15, 0x52); // "R"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes.buffer;
}

// 10000 * 10000 = 100,000,000 px, comfortably over MAX_IMAGE_PIXELS
// (40,000,000) — a compact header describing a decompression-bomb-shaped
// canvas, exactly the attack shape Finding 19 is about.
const OVERSIZE_PNG_BYTES = buildPngBytes(10_000, 10_000);
// 800x600 = 480,000 px — an ordinary photo/scan, comfortably under budget.
const NORMAL_PNG_BYTES = buildPngBytes(800, 600);

function arrangeEntitledItemWithAttachment(type: string, path: string) {
  rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
  single.mockResolvedValue({
    data: {
      id: 1,
      account_id: 10,
      attachments: [{ title: "attachment", type, path }],
    },
    error: null,
  });
  storageFrom.mockReturnValue({ download, list });
  // Under the byte cap, so the request reaches the dimension guard.
  list.mockResolvedValue({ data: [{ metadata: { size: 1024 } }], error: null });
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

describe("Finding 19 — image pixel-dimension guard wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
    releaseParseAttempt.mockResolvedValue(APPLIED_RELEASE_OUTCOME);
    confirmParseAttempt.mockResolvedValue(APPLIED_CONFIRM_OUTCOME);
  });

  it("refuses an over-dimension PNG without calling the extractor, and releases the reservation it had already claimed", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment("image/png", "10/photo.png");
    download.mockResolvedValue({
      data: { arrayBuffer: async () => OVERSIZE_PNG_BYTES },
      error: null,
    });
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    expect(confirmParseAttempt).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.request",
      expect.objectContaining({ outcome: "image_dimensions_exceeded" }),
    );
  });

  it("still parses a normal-dimension PNG", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment("image/png", "10/photo.png");
    download.mockResolvedValue({
      data: { arrayBuffer: async () => NORMAL_PNG_BYTES },
      error: null,
    });
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(releaseParseAttempt).not.toHaveBeenCalled();
  });

  it("still parses a PDF untouched — dimension parsing is deliberately out of scope for that MIME type", async () => {
    // Arrange — the PDF bytes below don't even look like an image; the
    // guard must never attempt to interpret them as one.
    arrangeEntitledItemWithAttachment("application/pdf", "10/resume.pdf");
    download.mockResolvedValue({
      data: {
        arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4").buffer,
      },
      error: null,
    });
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(releaseParseAttempt).not.toHaveBeenCalled();
  });
});
