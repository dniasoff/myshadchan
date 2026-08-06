import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceReclaimParseAttempt,
  releaseParseAttempt,
} from "./parseQuotaRecovery";
import { RETRY_DELAYS_MS } from "./parseQuotaClient";
import { TEST_ENV } from "./parseTestFixtures";

/**
 * Unit coverage for `releaseParseAttempt()` (Finding 10 closure) and
 * `forceReclaimParseAttempt()` (Finding 12's corruption escape hatch) — the
 * two RPC wrappers split out of `parseQuota.ts` once claim+confirm alone
 * pushed it well past the ~400-line typical ceiling (coding-style.md).
 * `index.sizeGuard.test.ts` / `index.quotaEnforcement.test.ts` /
 * `resolveParseClaim.test.ts` cover how the route/resolver reacts to each
 * outcome; this file covers this module's own contract in isolation.
 */

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

describe("parseQuotaRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  describe("releaseParseAttempt", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls release_ai_parse_attempt with the documented argument shape, including the fencing-token generation", async () => {
      // Arrange
      rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });

      // Act
      await releaseParseAttempt(TEST_ENV, 10, 501, 1);

      // Assert
      expect(rpc).toHaveBeenCalledWith("release_ai_parse_attempt", {
        p_account_id: 10,
        p_attempt_id: 501,
        p_generation: 1,
      });
    });

    it("returns 'applied' on a durable release", async () => {
      // Arrange
      rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });

      // Act
      const result = await releaseParseAttempt(TEST_ENV, 10, 501, 1);

      // Assert
      expect(result).toEqual({ outcome: "applied" });
    });

    it("retries a transient RPC error and returns 'applied' once a later attempt succeeds", async () => {
      // Arrange
      rpc
        .mockRejectedValueOnce(new Error("network unreachable"))
        .mockResolvedValueOnce({ data: { outcome: "applied" }, error: null });

      // Act
      const resultPromise = releaseParseAttempt(TEST_ENV, 10, 501, 1);
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      const result = await resultPromise;

      // Assert
      expect(result).toEqual({ outcome: "applied" });
      expect(rpc).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a legitimate 'superseded' response", async () => {
      // Arrange
      rpc.mockResolvedValue({ data: { outcome: "superseded" }, error: null });

      // Act
      const result = await releaseParseAttempt(TEST_ENV, 10, 501, 1);

      // Assert
      expect(result).toEqual({ outcome: "superseded" });
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it("returns 'failed' (Finding 10 closure — never a silent void) once every retry is exhausted against a persistent RPC error", async () => {
      // Arrange
      rpc.mockRejectedValue(new Error("persistent network failure"));

      // Act
      const resultPromise = releaseParseAttempt(TEST_ENV, 10, 501, 1);
      for (const delayMs of RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delayMs);
      }
      const result = await resultPromise;

      // Assert
      expect(result).toEqual({ outcome: "failed" });
      expect(rpc).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    });

    it("returns 'failed' without retrying when the RPC returns a shape this Worker does not recognize", async () => {
      // Arrange — never trust an external/API response's shape blindly.
      rpc.mockResolvedValue({
        data: { outcome: "something_new_the_client_does_not_know" },
        error: null,
      });

      // Act
      const result = await releaseParseAttempt(TEST_ENV, 10, 501, 1);

      // Assert
      expect(result).toEqual({ outcome: "failed" });
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it("treats a 'superseded' outcome as a benign no-op (review Finding C2) — this is the interleaving-(b) fix: a stale-token release must never decrement ai_usage for a reservation a newer generation still legitimately holds", async () => {
      // Arrange
      const warnSpy = vi.spyOn(console, "warn");
      rpc.mockResolvedValue({ data: { outcome: "superseded" }, error: null });

      // Act
      await releaseParseAttempt(TEST_ENV, 10, 501, 1);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        "parse.releaseParseAttempt.superseded",
        expect.objectContaining({
          accountId: 10,
          attemptId: 501,
          generation: 1,
        }),
      );
    });
  });

  describe("forceReclaimParseAttempt", () => {
    it("calls force_reclaim_ai_parse_attempt with the documented argument shape", async () => {
      // Arrange
      rpc.mockResolvedValue({
        data: { outcome: "reclaimed", generation: 2 },
        error: null,
      });

      // Act
      await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(rpc).toHaveBeenCalledWith("force_reclaim_ai_parse_attempt", {
        p_account_id: 10,
        p_attempt_id: 501,
      });
    });

    it("returns the reclaimed outcome with its new generation", async () => {
      // Arrange
      rpc.mockResolvedValue({
        data: { outcome: "reclaimed", generation: 2 },
        error: null,
      });

      // Act
      const result = await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(result).toEqual({
        ok: true,
        outcome: { outcome: "reclaimed", generation: 2 },
      });
    });

    it("returns the not_reclaimable outcome when a concurrent request already resolved the row", async () => {
      // Arrange
      rpc.mockResolvedValue({
        data: { outcome: "not_reclaimable" },
        error: null,
      });

      // Act
      const result = await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(result).toEqual({
        ok: true,
        outcome: { outcome: "not_reclaimable" },
      });
    });

    it("fails closed when the RPC returns an error", async () => {
      // Arrange
      rpc.mockResolvedValue({
        data: null,
        error: { message: "permission denied" },
      });

      // Act
      const result = await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(result).toEqual({ ok: false });
    });

    it("fails closed when the RPC call throws", async () => {
      // Arrange
      rpc.mockRejectedValue(new Error("network unreachable"));

      // Act
      const result = await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(result).toEqual({ ok: false });
    });

    it("fails closed when the RPC returns a shape this Worker does not recognize", async () => {
      // Arrange
      rpc.mockResolvedValue({
        data: { outcome: "something_new_the_client_does_not_know" },
        error: null,
      });

      // Act
      const result = await forceReclaimParseAttempt(TEST_ENV, 10, 501);

      // Assert
      expect(result).toEqual({ ok: false });
    });
  });
});
