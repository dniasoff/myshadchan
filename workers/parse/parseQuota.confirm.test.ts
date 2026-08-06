import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmParseAttempt } from "./parseQuota";
import { RETRY_DELAYS_MS } from "./parseQuotaClient";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import { TEST_ENV } from "./parseTestFixtures";

/**
 * Unit coverage for `confirmParseAttempt()` (Findings 8/9/12 closure).
 * Split out of `parseQuota.test.ts` (`claimParseAttempt()`'s own suite)
 * once the combined file pushed well past the ~400-line typical ceiling
 * (coding-style.md). `index.test.ts` / `index.idempotency.test.ts` /
 * `index.quotaEnforcement.test.ts` cover how the route reacts to each
 * outcome; this file covers this module's own contract in isolation:
 * correct RPC name and argument shape, Zod validation of the returned
 * jsonb, and that every database failure mode (`error`, throw, unrecognized
 * shape) degrades to the documented bounded-retry behavior rather than
 * propagating.
 */

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

describe("confirmParseAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls confirm_ai_parse_attempt with the documented argument shape, including the fencing-token generation and result schema version", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });
    const payload = { fields: { name_en: "Rivky" } };

    // Act
    await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      payload,
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(rpc).toHaveBeenCalledWith("confirm_ai_parse_attempt", {
      p_account_id: 10,
      p_attempt_id: 501,
      p_generation: 1,
      p_result: payload,
      p_result_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    });
  });

  it("returns 'applied' on a durable write", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });

    // Act
    const result = await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ outcome: "applied" });
  });

  it("retries a transient RPC error and returns 'applied' once a later attempt succeeds", async () => {
    // Arrange
    rpc
      .mockRejectedValueOnce(new Error("network unreachable"))
      .mockResolvedValueOnce({ data: { outcome: "applied" }, error: null });

    // Act
    const resultPromise = confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    const result = await resultPromise;

    // Assert
    expect(result).toEqual({ outcome: "applied" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a legitimate 'superseded' response", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "superseded", status: "in_progress" },
      error: null,
    });

    // Act
    const result = await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ outcome: "superseded", status: "in_progress" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns 'failed' (not 'applied', not a throw) once every retry is exhausted against a persistent RPC error", async () => {
    // Arrange
    rpc.mockRejectedValue(new Error("persistent network failure"));

    // Act
    const resultPromise = confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );
    for (const delayMs of RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delayMs);
    }
    const result = await resultPromise;

    // Assert
    expect(result).toEqual({ outcome: "failed" });
    expect(rpc).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it("returns 'failed' without retrying when the RPC returns a shape this Worker does not recognize — deterministic, not transient", async () => {
    // Arrange — never trust an external/API response's shape blindly.
    rpc.mockResolvedValue({
      data: { outcome: "something_new_the_client_does_not_know" },
      error: null,
    });

    // Act
    const result = await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ outcome: "failed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("carries the winning generation's result and result_schema_version when superseded by an already-completed generation (Finding 8 closure)", async () => {
    // Arrange
    const winningResult = { fields: { name_en: "Winner" } };
    rpc.mockResolvedValue({
      data: {
        outcome: "superseded",
        status: "completed",
        result: winningResult,
        result_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
      },
      error: null,
    });

    // Act
    const result = await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({
      outcome: "superseded",
      status: "completed",
      result: winningResult,
      resultSchemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    });
  });

  it("treats a 'superseded' outcome as a benign no-op (review Finding C2) — logged at warn, never propagated as an error", async () => {
    // Arrange — a newer generation already reclaimed this row; this must
    // NOT be treated the same as an RPC error.
    const warnSpy = vi.spyOn(console, "warn");
    rpc.mockResolvedValue({
      data: { outcome: "superseded", status: "in_progress" },
      error: null,
    });

    // Act
    await confirmParseAttempt(
      TEST_ENV,
      10,
      501,
      1,
      {},
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(warnSpy).toHaveBeenCalledWith(
      "parse.confirmParseAttempt.superseded",
      expect.objectContaining({
        accountId: 10,
        attemptId: 501,
        generation: 1,
        status: "in_progress",
      }),
    );
  });
});
