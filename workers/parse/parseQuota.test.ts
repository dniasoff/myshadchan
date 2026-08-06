import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimParseAttempt } from "./parseQuota";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import { TEST_ENV } from "./parseTestFixtures";

/**
 * Unit coverage for `claimParseAttempt()` (Findings 6/7/8/12 closure).
 * `confirmParseAttempt()` moved to `parseQuota.confirm.test.ts`,
 * `releaseParseAttempt()` / `forceReclaimParseAttempt()` to
 * `parseQuotaRecovery.test.ts` — split the same way as the source modules
 * once a combined file would otherwise push well past the ~400-line typical
 * ceiling (coding-style.md). `index.test.ts` / `index.idempotency.test.ts` /
 * `index.sizeGuard.test.ts` / `index.quotaEnforcement.test.ts` cover how
 * the route reacts to each outcome; this file covers this module's own
 * contract in isolation: correct RPC name and argument shape, Zod
 * validation of the returned jsonb, and that every database failure mode
 * (`error`, throw, unrecognized shape) degrades to the documented
 * fail-closed behavior rather than propagating.
 */

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

describe("claimParseAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("calls claim_ai_parse_attempt with the documented argument shape, including the current result schema version", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "claimed", attempt_id: 501, generation: 1 },
      error: null,
    });

    // Act
    await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(rpc).toHaveBeenCalledWith("claim_ai_parse_attempt", {
      p_account_id: 10,
      p_inbox_item_id: 1,
      p_attachment_path: "10/resume.pdf",
      p_current_result_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    });
  });

  it("returns the claimed outcome, including the fencing-token generation, on a fresh reservation", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "claimed", attempt_id: 501, generation: 1 },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({
      ok: true,
      outcome: { outcome: "claimed", attempt_id: 501, generation: 1 },
    });
  });

  it("fails closed when a 'claimed' outcome is missing its generation — an older RPC shape this Worker must not silently trust", async () => {
    // Arrange — review Finding C2: confirm/release REQUIRE a generation.
    // A 'claimed' outcome without one would leave the Worker unable to
    // fence its own later confirm/release call, so it must never be
    // treated as valid.
    rpc.mockResolvedValue({
      data: { outcome: "claimed", attempt_id: 501 },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: false });
  });

  it("returns the replay outcome with its cached result and result_schema_version on an already-completed attempt", async () => {
    // Arrange
    const cachedResult = { fields: { name_en: "Rivky" } };
    rpc.mockResolvedValue({
      data: {
        outcome: "replay",
        attempt_id: 501,
        result: cachedResult,
        result_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
      },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({
      ok: true,
      outcome: {
        outcome: "replay",
        attempt_id: 501,
        result: cachedResult,
        result_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
      },
    });
  });

  it("fails closed when a 'replay' outcome is missing its result_schema_version — Finding 12 requires it to gate future claims", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "replay", attempt_id: 501, result: {} },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: false });
  });

  it("returns the conflict outcome when another attempt is already in flight", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "conflict", attempt_id: 501 },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({
      ok: true,
      outcome: { outcome: "conflict", attempt_id: 501 },
    });
  });

  it("returns the cap_reached outcome when the monthly allowance is exhausted", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: { outcome: "cap_reached" },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: true, outcome: { outcome: "cap_reached" } });
  });

  it("fails closed when the RPC returns an error", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: false });
  });

  it("fails closed when the RPC call throws", async () => {
    // Arrange
    rpc.mockRejectedValue(new Error("network unreachable"));

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: false });
  });

  it("fails closed when the RPC returns a shape this Worker does not recognize", async () => {
    // Arrange — never trust an external/API response's shape blindly.
    rpc.mockResolvedValue({
      data: { outcome: "something_new_the_client_does_not_know" },
      error: null,
    });

    // Act
    const result = await claimParseAttempt(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );

    // Assert
    expect(result).toEqual({ ok: false });
  });
});
