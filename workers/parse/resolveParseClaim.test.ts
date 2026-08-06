import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveParseClaim } from "./resolveParseClaim";
import {
  ATTEMPT_ID,
  CAP_REACHED_ATTEMPT,
  CLAIMED_ATTEMPT,
  CLAIM_RPC_FAILED,
  CONFLICT_ATTEMPT,
  GENERATION,
  TEST_ENV,
  makeParseResultPayload,
  replayAttempt,
} from "./parseTestFixtures";

/**
 * Findings 6/8/10/12 (Epic 11 adversarial review) — unit coverage for
 * `resolveParseClaim()` in isolation, mocking `./parseQuota` and
 * `./parseQuotaRecovery` directly rather than going through the full
 * `POST /parse` route. `index.idempotency.test.ts` / `index.quotaEnforcement.test.ts`
 * cover the HTTP-level consequence of each `ClaimResolution`; this file
 * covers the decision logic itself, including the Finding 12
 * corruption/force-reclaim path no route-level test can cheaply exercise
 * (it requires a "replay" whose result fails Zod validation).
 */

const claimParseAttempt = vi.fn();
const forceReclaimParseAttempt = vi.fn();

vi.mock("./parseQuota", () => ({
  claimParseAttempt: (...args: unknown[]) => claimParseAttempt(...args),
}));

vi.mock("./parseQuotaRecovery", () => ({
  forceReclaimParseAttempt: (...args: unknown[]) =>
    forceReclaimParseAttempt(...args),
}));

describe("resolveParseClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("resolves to claim_error when the claim RPC itself fails", async () => {
    // Arrange
    claimParseAttempt.mockResolvedValue(CLAIM_RPC_FAILED);

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "claim_error" });
    expect(forceReclaimParseAttempt).not.toHaveBeenCalled();
  });

  it("resolves to cap_reached when a genuinely new claim hits the cap", async () => {
    // Arrange
    claimParseAttempt.mockResolvedValue(CAP_REACHED_ATTEMPT);

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "cap_reached" });
  });

  it("resolves to conflict when another attempt is already in flight", async () => {
    // Arrange
    claimParseAttempt.mockResolvedValue(CONFLICT_ATTEMPT);

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "conflict", attemptId: ATTEMPT_ID });
  });

  it("resolves to claimed, carrying the attempt id and generation, on a fresh reservation", async () => {
    // Arrange
    claimParseAttempt.mockResolvedValue(CLAIMED_ATTEMPT);

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({
      kind: "claimed",
      attemptId: ATTEMPT_ID,
      generation: GENERATION,
    });
  });

  it("resolves to replay with the validated payload when the cached result passes schema validation (Finding 12)", async () => {
    // Arrange
    const payload = makeParseResultPayload({ fields: { name_en: "Rivky" } });
    claimParseAttempt.mockResolvedValue(replayAttempt(payload));

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "replay", payload });
    expect(forceReclaimParseAttempt).not.toHaveBeenCalled();
  });

  it("force-reclaims and proceeds as claimed when a same-version replay fails Zod validation (Finding 12 corruption path)", async () => {
    // Arrange — same version, but a shape that fails ParseResultPayloadSchema.
    claimParseAttempt.mockResolvedValue(
      replayAttempt({ not: "a valid payload" }),
    );
    forceReclaimParseAttempt.mockResolvedValue({
      ok: true,
      outcome: { outcome: "reclaimed", generation: 7 },
    });

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({
      kind: "claimed",
      attemptId: ATTEMPT_ID,
      generation: 7,
    });
    expect(forceReclaimParseAttempt).toHaveBeenCalledWith(
      TEST_ENV,
      10,
      ATTEMPT_ID,
    );
    expect(claimParseAttempt).toHaveBeenCalledTimes(1);
  });

  it("re-claims from scratch when force_reclaim reports not_reclaimable (a concurrent request already resolved the race)", async () => {
    // Arrange
    claimParseAttempt
      .mockResolvedValueOnce(replayAttempt({ not: "a valid payload" }))
      .mockResolvedValueOnce(CLAIMED_ATTEMPT);
    forceReclaimParseAttempt.mockResolvedValue({
      ok: true,
      outcome: { outcome: "not_reclaimable" },
    });

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({
      kind: "claimed",
      attemptId: ATTEMPT_ID,
      generation: GENERATION,
    });
    expect(claimParseAttempt).toHaveBeenCalledTimes(2);
  });

  it("fails closed to claim_error if the force_reclaim RPC itself errors", async () => {
    // Arrange
    claimParseAttempt.mockResolvedValue(
      replayAttempt({ not: "a valid payload" }),
    );
    forceReclaimParseAttempt.mockResolvedValue({ ok: false });

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "claim_error" });
  });

  it("fails closed to claim_error rather than looping forever when corruption persists across every bounded claim attempt", async () => {
    // Arrange — every claim returns a corrupted replay, every force-reclaim
    // reports the row was already grabbed by someone else. A live,
    // persistent race like this is far outside what this rare corruption
    // path is meant to absorb.
    claimParseAttempt.mockResolvedValue(
      replayAttempt({ not: "a valid payload" }),
    );
    forceReclaimParseAttempt.mockResolvedValue({
      ok: true,
      outcome: { outcome: "not_reclaimable" },
    });

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert
    expect(resolution).toEqual({ kind: "claim_error" });
    expect(claimParseAttempt).toHaveBeenCalledTimes(2); // MAX_CLAIM_ATTEMPTS
  });

  it("succeeds a replay even when the account is already at its cap (Finding 6 — the free replay path a pre-check would have blocked)", async () => {
    // Arrange — this proves the resolver never re-derives or re-checks a
    // usage cap of its own; it trusts the RPC's own outcome completely.
    const payload = makeParseResultPayload();
    claimParseAttempt.mockResolvedValue(replayAttempt(payload));

    // Act
    const resolution = await resolveParseClaim(
      TEST_ENV,
      10,
      1,
      "10/resume.pdf",
    );

    // Assert — no cap-related outcome is possible from a "replay"; this
    // simply proves resolveParseClaim never intercepts it with one.
    expect(resolution).toEqual({ kind: "replay", payload });
  });
});
