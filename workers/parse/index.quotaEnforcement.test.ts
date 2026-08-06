import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { ExtractorTimeoutError } from "./resumeExtractor";
import {
  APPLIED_CONFIRM_OUTCOME,
  APPLIED_RELEASE_OUTCOME,
  CAP_REACHED_ATTEMPT,
  CLAIM_RPC_FAILED,
  CLAIMED_ATTEMPT,
  ENTITLED_PAYLOAD,
  TEST_ENV,
} from "./parseTestFixtures";

/**
 * Findings 6/7 (Epic 11 adversarial review) — the atomic `claimParseAttempt()`
 * (`parseQuota.ts`) is the sole authority for the monthly `ai_usage` cap and
 * the sole gate on whether inference is ever spent. Split out of
 * `index.test.ts` once it would have pushed that file well past the
 * ~400-line typical ceiling (coding-style.md) — see that file's own header
 * comment.
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

describe("Findings 6/7 — quota enforcement via the atomic claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
    confirmParseAttempt.mockResolvedValue(APPLIED_CONFIRM_OUTCOME);
    releaseParseAttempt.mockResolvedValue(APPLIED_RELEASE_OUTCOME);
  });

  it("returns 402 when the atomic claim is the one that reports the cap reached (authoritative enforcement, Finding 7)", async () => {
    // Arrange — the advisory pre-check passes (plenty of allowance in the
    // stale entitlement snapshot), but the atomic claim — re-checking fresh,
    // inside the database — is the one that actually refuses.
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CAP_REACHED_ATTEMPT);

    // Act
    const app = createParseApp();
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      success: false,
      error: "monthly resume limit reached",
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("fails closed with 503 and spends nothing when the claim RPC itself errors (Finding 6, fail-closed — invariant (e): no inference-costing payload can ever be delivered without a durable claim behind it)", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CLAIM_RPC_FAILED);
    const extractSpy = vi.fn(async () => {
      throw new Error("must never be reached");
    });

    // Act
    const app = createParseApp({ extract: extractSpy });
    const res = await postParse(app);

    // Assert — no download, no inference, no confirm/release: nothing
    // further is written once the reservation call itself is unreliable. A
    // successful (200) response must never be reachable from this branch —
    // this is the structural proof of invariant (e): the ONLY way this
    // route can reach the extractor at all is via a `resolveParseClaim()`
    // resolution of `"claimed"`, which requires a durably-recorded
    // reservation (`claim_ai_parse_attempt()`, atomic with the `ai_usage`
    // increment) to exist first.
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: "AI service temporarily unavailable",
    });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(extractSpy).not.toHaveBeenCalled();
    expect(confirmParseAttempt).not.toHaveBeenCalled();
    expect(releaseParseAttempt).not.toHaveBeenCalled();
  });

  it("releases the reservation and returns 502 when the extractor throws, instead of leaving the account charged", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    const app = createParseApp({
      extract: async () => {
        throw new Error("gemini exploded");
      },
    });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: "resume extraction failed",
    });
    expect(releaseParseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      10,
      CLAIMED_ATTEMPT.outcome.attempt_id,
      CLAIMED_ATTEMPT.outcome.generation,
    );
    expect(confirmParseAttempt).not.toHaveBeenCalled();
  });

  it("labels the cap-reached refusal in the trace log (review Finding C4)", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CAP_REACHED_ATTEMPT);

    // Act
    const app = createParseApp();
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(402);
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.request",
      expect.objectContaining({ outcome: "cap_reached" }),
    );
  });

  it("labels an extractor failure as extract_failed in the trace log, distinct from a fresh success (review Finding C4)", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    const app = createParseApp({
      extract: async () => {
        throw new Error("gemini exploded");
      },
    });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(502);
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.request",
      expect.objectContaining({ outcome: "extract_failed" }),
    );
  });

  it("distinguishes an extractor timeout from a generic extraction failure in the trace log, and still releases the reservation (Finding 7 — release-on-timeout wiring)", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    const app = createParseApp({
      extract: async () => {
        throw new ExtractorTimeoutError(60_000);
      },
    });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(502);
    expect(releaseParseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      10,
      CLAIMED_ATTEMPT.outcome.attempt_id,
      CLAIMED_ATTEMPT.outcome.generation,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.request",
      expect.objectContaining({ outcome: "extract_timeout" }),
    );
  });

  it("returns 200 with the draft marked non-durable when confirm exhausts every retry, and logs the failure loudly instead of swallowing it (Finding 9)", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    confirmParseAttempt.mockResolvedValue({ outcome: "failed" });
    const app = createParseApp({
      extract: async () => ({}),
    });

    // Act
    const res = await postParse(app);
    const json = (await res.json()) as {
      success: boolean;
      data?: unknown;
      meta?: { durable?: boolean };
    };

    // Assert — the user still receives the correct, already-metered draft
    // (Findings 6/7's invariant is untouched — the spend happened durably
    // at the claim, entirely independent of this confirm call) rather than
    // a request failure that would throw it away for nothing, but it is
    // marked non-durable and the failure is logged loudly, never silently
    // swallowed.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.meta).toEqual({ durable: false });
    expect(errorSpy).toHaveBeenCalledWith(
      "parse.confirm.exhausted",
      expect.objectContaining({
        accountId: 10,
        attemptId: CLAIMED_ATTEMPT.outcome.attempt_id,
        generation: CLAIMED_ATTEMPT.outcome.generation,
      }),
    );
  });

  it("logs loudly (never silently) when a release itself never durably applies (Finding 10)", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    list.mockResolvedValue({
      data: [{ metadata: { size: 999_999_999 } }],
      error: null,
    });
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    releaseParseAttempt.mockResolvedValue({ outcome: "failed" });
    const app = createParseApp();

    // Act
    const res = await postParse(app);

    // Assert — the caller still gets the original failure (413); the
    // release outcome is surfaced only via a loud log line, per
    // `releaseAndFail()`'s own documented contract.
    expect(res.status).toBe(413);
    expect(errorSpy).toHaveBeenCalledWith(
      "parse.release.exhausted",
      expect.objectContaining({
        accountId: 10,
        attemptId: CLAIMED_ATTEMPT.outcome.attempt_id,
        generation: CLAIMED_ATTEMPT.outcome.generation,
      }),
    );
  });
});
