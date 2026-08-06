import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

/**
 * R2 (Epic 11 external review, Finding 11 closure): before this fix,
 * `scheduled()` was a bare stub that only logged a heartbeat — the sweep RPC
 * had zero callers. These tests assert the wiring, not just the module's own
 * unit contract (that lives in `sweepAiParseAttempts.test.ts`): mock
 * `@supabase/supabase-js` at the boundary `sweepAiParseAttempts.ts` actually
 * uses, so a regression that silently drops the `sweepAiParseAttempts(env)`
 * call out of `scheduled()` again shows up here as a missing `rpc` call,
 * not just as an untested new module.
 */

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

// A realistic caught error whose OWN `.message` embeds PII, the same shape
// requestTracing.test.ts's PII suite uses — the sweep's whole reason for
// existing is that `ai_parse_attempts` rows carry names, schools, and
// reference contact details, so a raw RPC error is exactly where that could
// leak back out through a log line.
const PII_ERROR = new Error(
  'constraint violation: Key (email)=(chana.friedman@example.com) already exists for "Chana Friedman"',
);

describe("cron worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await worker.fetch(
      new Request("http://cron.local/health"),
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "cron", status: "ok" },
    });
  });

  it("logs a sweep tick when the scheduled trigger fires", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 0, error: null });

    // Act
    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    // Assert
    expect(warnSpy).toHaveBeenCalledWith("[cron] sweep tick");
  });

  it("calls sweep_expired_ai_parse_attempts on every scheduled tick", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 5, error: null });

    // Act
    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    // Assert
    expect(rpc).toHaveBeenCalledWith("sweep_expired_ai_parse_attempts");
  });

  it("logs only the swept row count on success, never row content", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 12, error: null });

    // Act
    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    // Assert
    expect(warnSpy).toHaveBeenCalledWith("[cron] sweepAiParseAttempts.ok", {
      deleted: 12,
    });
  });

  it("does not throw out of scheduled() when the sweep RPC fails, and logs the failure without leaking the raw error", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: PII_ERROR });

    // Act / Assert — a throw here would fail this test on its own; the
    // explicit resolves() assertion also documents the intent (must not
    // throw out of scheduled() in a way that could disable future ticks).
    await expect(
      worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[cron] sweepAiParseAttempts.failed — see the cron.sweepAiParseAttempts.* error logged above",
    );

    // Assert — nothing logged anywhere in this tick contains the PII embedded
    // in the raw error's own `.message`.
    const allLoggedText = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join("\n");
    expect(allLoggedText).not.toContain("chana.friedman@example.com");
    expect(allLoggedText).not.toContain("Chana Friedman");
  });

  it("does not throw out of scheduled() when the sweep RPC itself throws", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockRejectedValue(new Error("network unreachable"));

    // Act / Assert
    await expect(
      worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext),
    ).resolves.toBeUndefined();
  });
});
