import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepAiParseAttempts } from "./sweepAiParseAttempts";
import type { BaseEnv } from "../shared/env";

/**
 * R2 (Epic 11 external review, Finding 11 closure) coverage for the sweep's
 * own RPC wrapper — `index.test.ts` covers that `scheduled()` actually calls
 * this module; this file covers the module's own contract in isolation,
 * mirroring `workers/parse/parseQuotaRecovery.test.ts`'s split.
 */

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

const env: BaseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "test@example.com",
  APP_ORIGIN: "https://app.example.com",
};

// A realistic caught error whose OWN `.message` embeds PII — the exact shape
// requestTracing.test.ts's "boom-pii" fixture uses (a provider/database
// error can echo back fragments of the row/request it came from).
const PII_ERROR = new Error(
  'duplicate key value violates unique constraint: Key (email)=(chana.friedman@example.com) already exists for "Chana Friedman"',
);

describe("sweepAiParseAttempts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("calls sweep_expired_ai_parse_attempts with no arguments", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 3, error: null });

    // Act
    await sweepAiParseAttempts(env);

    // Assert
    expect(rpc).toHaveBeenCalledWith("sweep_expired_ai_parse_attempts");
  });

  it("returns the deleted row count on success", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 7, error: null });

    // Act
    const result = await sweepAiParseAttempts(env);

    // Assert
    expect(result).toEqual({ ok: true, deleted: 7 });
  });

  it("returns deleted: 0 when nothing was expired, without treating it as a failure", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 0, error: null });

    // Act
    const result = await sweepAiParseAttempts(env);

    // Assert
    expect(result).toEqual({ ok: true, deleted: 0 });
  });

  it("returns ok: false and logs a redacted summary when the RPC reports an error", async () => {
    // Arrange
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: PII_ERROR });

    // Act
    const result = await sweepAiParseAttempts(env);

    // Assert
    expect(result).toEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0];
    expect(loggedArgs[0]).toBe("cron.sweepAiParseAttempts.rpcError");
    const loggedPayload = JSON.stringify(loggedArgs[1]);
    expect(loggedPayload).not.toContain("chana.friedman@example.com");
    expect(loggedPayload).not.toContain("Chana Friedman");
  });

  it("returns ok: false and logs a redacted summary when the client throws", async () => {
    // Arrange
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    rpc.mockRejectedValue(PII_ERROR);

    // Act
    const result = await sweepAiParseAttempts(env);

    // Assert
    expect(result).toEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0];
    expect(loggedArgs[0]).toBe("cron.sweepAiParseAttempts.threw");
    const loggedPayload = JSON.stringify(loggedArgs[1]);
    expect(loggedPayload).not.toContain("chana.friedman@example.com");
    expect(loggedPayload).not.toContain("Chana Friedman");
  });

  it("returns ok: false when the RPC returns an unexpected (non-numeric) shape", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: null, error: null });

    // Act
    const result = await sweepAiParseAttempts(env);

    // Assert
    expect(result).toEqual({ ok: false });
  });
});
