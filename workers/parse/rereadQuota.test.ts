import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimRereadAttempt,
  completeRereadAttempt,
  releaseRereadAttempt,
} from "./rereadQuota";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import { TEST_ENV } from "./parseTestFixtures";

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

describe("re-read quota RPC wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("claims with the request id and current sections schema version", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "reserved", attempt_id: 41, generation: 1 },
      error: null,
    });

    await expect(
      claimRereadAttempt(
        TEST_ENV,
        10,
        22,
        "8f7d6f38-a1ea-4f04-9b14-1e68b2c9f4e3",
        CURRENT_PARSE_RESULT_SCHEMA_VERSION,
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: { outcome: "reserved", attempt_id: 41, generation: 1 },
    });
    expect(rpc).toHaveBeenCalledWith("claim_ai_reread_attempt", {
      p_account_id: 10,
      p_resume_id: 22,
      p_request_id: "8f7d6f38-a1ea-4f04-9b14-1e68b2c9f4e3",
      p_current_schema_version: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    });
  });

  it.each(["replayed", "in_progress", "busy"] as const)(
    "accepts the %s single-flight outcome without treating it as a fresh charge",
    async (outcome) => {
      rpc.mockResolvedValue({
        data: { outcome, attempt_id: 41, generation: 2 },
        error: null,
      });

      await expect(
        claimRereadAttempt(TEST_ENV, 10, 22, crypto.randomUUID(), 4),
      ).resolves.toEqual({
        ok: true,
        outcome: { outcome, attempt_id: 41, generation: 2 },
      });
    },
  );

  it("fails closed for malformed or repeated RPC failures", async () => {
    rpc.mockResolvedValue({ data: { outcome: "reserved" }, error: null });

    await expect(
      claimRereadAttempt(TEST_ENV, 10, 22, crypto.randomUUID(), 4),
    ).resolves.toEqual({ ok: false });
    expect(rpc).toHaveBeenCalledTimes(1);

    rpc.mockRejectedValue(new Error("database unavailable"));
    await expect(
      claimRereadAttempt(TEST_ENV, 10, 22, crypto.randomUUID(), 4),
    ).resolves.toEqual({ ok: false });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("passes generation fences to complete and release", async () => {
    rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });

    await expect(
      completeRereadAttempt(TEST_ENV, 10, 41, 2, 4),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(releaseRereadAttempt(TEST_ENV, 10, 41, 2)).resolves.toEqual({
      outcome: "applied",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "complete_ai_reread_attempt", {
      p_account_id: 10,
      p_attempt_id: 41,
      p_generation: 2,
      p_schema_version: 4,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "release_ai_reread_attempt", {
      p_account_id: 10,
      p_attempt_id: 41,
      p_generation: 2,
    });
  });
});
