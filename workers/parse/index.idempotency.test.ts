import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import {
  APPLIED_CONFIRM_OUTCOME,
  APPLIED_RELEASE_OUTCOME,
  CLAIMED_ATTEMPT,
  CONFLICT_ATTEMPT,
  ENTITLED_PAYLOAD,
  TEST_ENV,
  makeExtract,
  makeParseResultPayload,
  replayAttempt,
} from "./parseTestFixtures";

/**
 * Finding 8 (Story 11-1 review report; closed for the concurrent-race
 * remainder here): a repeat POST /parse for the exact same (account, inbox
 * item, attachment) must replay a completed result instead of re-invoking
 * the model and re-metering usage, AND two truly simultaneous requests for
 * that same key must not both spend. Both are now enforced by
 * `claim_ai_parse_attempt()`'s database-level unique constraint via the
 * `"replay"` / `"conflict"` outcomes — the Workers Cache API layer this
 * replaces (`parseIdempotency.ts`, deleted) could only ever close the
 * sequential-retry case; see `parseQuota.ts`'s header comment. Split out of
 * `index.test.ts` once it would have pushed that file well past the
 * ~400-line typical ceiling (coding-style.md).
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

describe("Finding 8 — idempotency via the atomic claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
    confirmParseAttempt.mockResolvedValue(APPLIED_CONFIRM_OUTCOME);
    releaseParseAttempt.mockResolvedValue(APPLIED_RELEASE_OUTCOME);
  });

  it("replays a completed result without downloading, extracting, metering, or re-confirming", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    const cachedPayload = makeParseResultPayload({
      fields: { name_en: "Cached Rivky" },
    });
    claimParseAttempt.mockResolvedValue(replayAttempt(cachedPayload));
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: cachedPayload,
    });
    expect(extractSpy).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    // A replay is a byte-for-byte return of what claimParseAttempt already
    // read from `ai_parse_attempts.result` — no further database write is
    // needed or made, unlike a fresh claim's eventual confirm/release.
    expect(confirmParseAttempt).not.toHaveBeenCalled();
    expect(releaseParseAttempt).not.toHaveBeenCalled();
  });

  it("labels a replay as a free, non-billable outcome in the trace log, distinct from a fresh parse (review Finding C4)", async () => {
    // Arrange — a replay costs no inference; an operator reading Cloudflare
    // Logs must be able to tell it apart from a billable fresh parse without
    // reading application code.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(
      replayAttempt(
        makeParseResultPayload({ fields: { name_en: "Cached Rivky" } }),
      ),
    );
    const app = createParseApp({ extract: vi.fn(async () => makeExtract()) });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.request",
      expect.objectContaining({ outcome: "replay" }),
    );
  });

  it("returns 409 with a Retry-After hint when another request for the identical attachment is already in flight — the concurrent-claim loser", async () => {
    // Arrange — this is the case the deleted Cache-API layer could never
    // close: two truly simultaneous requests for the same key. The database
    // unique constraint inside claim_ai_parse_attempt() is what now
    // guarantees exactly one winner.
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CONFLICT_ATTEMPT);
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: "a parse is already in progress for this attachment",
    });
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(extractSpy).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("a replay is returned even when the caller's own stale entitlement snapshot shows the account at cap (Finding 6 — proves the deleted pre-check is not silently reintroduced)", async () => {
    // Arrange — `ai_entitlement()` (the RPC `requireAiEntitlement` calls) is
    // the ONLY entitlement check left in this route (is_entitled === true
    // gates access to the worker at all); the stale `resumes_used`/
    // `resumes_limit` snapshot below is deliberately AT the cap to prove
    // nothing in this route re-derives or re-checks a cap of its own before
    // `resolveParseClaim()` — the atomic claim's own "replay" outcome is
    // trusted completely, at any usage level.
    rpc.mockResolvedValue({
      data: { ...ENTITLED_PAYLOAD, resumes_used: 50, resumes_limit: 50 },
      error: null,
    });
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
    const cachedPayload = makeParseResultPayload({
      fields: { name_en: "Cached Rivky" },
    });
    claimParseAttempt.mockResolvedValue(replayAttempt(cachedPayload));
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: cachedPayload });
    expect(claimParseAttempt).toHaveBeenCalled();
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it("resolves a claimed reservation and proceeds through inference even when the caller's own stale entitlement snapshot shows the account at cap (Finding 6/10 — a stale/stranded reclaim must not be blocked by a client-side cap check)", async () => {
    // Arrange — simulates the RPC's own stale-in_progress reclaim: the
    // atomic claim itself says "claimed", so this route must proceed
    // regardless of what the (informational-only) entitlement snapshot
    // shows.
    rpc.mockResolvedValue({
      data: { ...ENTITLED_PAYLOAD, resumes_used: 50, resumes_limit: 50 },
      error: null,
    });
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({ data: new Blob(["pdf bytes"]), error: null });
    const app = createParseApp({ extract: vi.fn(async () => makeExtract()) });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  it("returns the winning generation's own durable result when a superseded confirm's winner has already completed (Finding 8)", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({ data: new Blob(["pdf bytes"]), error: null });
    const winningPayload = makeParseResultPayload({
      fields: { name_en: "Winner" },
    });
    confirmParseAttempt.mockResolvedValue({
      outcome: "superseded",
      status: "completed",
      result: winningPayload,
      resultSchemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    });
    const app = createParseApp({ extract: vi.fn(async () => makeExtract()) });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: winningPayload });
  });

  it("returns 409 with a Retry-After hint when a superseded confirm's winner is still in progress (Finding 8)", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({ data: new Blob(["pdf bytes"]), error: null });
    confirmParseAttempt.mockResolvedValue({
      outcome: "superseded",
      status: "in_progress",
    });
    const app = createParseApp({ extract: vi.fn(async () => makeExtract()) });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: "a newer parse attempt has already claimed this attachment",
    });
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});
