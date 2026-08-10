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

// Mock ExecutionContext for Cloudflare Workers
const mockExecutionContext: ExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => {
    promise.catch((error) => {
      console.error("Error in waitUntil promise:", error);
    });
  },
  passThroughOnException: () => {},
  exports: {},
  props: undefined,
  tracing: {
    enterSpan<T, A extends unknown[]>(
      _name: string,
      callback: (span: TracingSpan, ...args: A) => T,
      ...args: A
    ): T {
      return callback({} as TracingSpan, ...args);
    },
    startActiveSpan<T, A extends unknown[]>(
      _name: string,
      callback: (span: TracingSpan, ...args: A) => T,
      ...args: A
    ): T {
      return callback({} as TracingSpan, ...args);
    },
    Span: class {
      isTraced = false;
      setAttribute(_key: string, _value?: boolean | number | string): void {}
      end(): void {}
    },
  },
};

interface TracingSpan {
  isTraced: boolean;
  setAttribute(key: string, value?: boolean | number | string): void;
  end(): void;
}

const rpc = vi.fn();
const sendEmail = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

vi.mock("../shared/resend", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "support@myshadchan.space",
  APP_ORIGIN: "https://www.myshadchan.space",
};

const REMINDER_EVENT = { cron: "*/15 * * * *" } as ScheduledEvent;
const RETENTION_EVENT = { cron: "0 3 * * *" } as ScheduledEvent;

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
    await worker.scheduled(
      { cron: "* * * * *" } as ScheduledEvent,
      env,
      mockExecutionContext,
    );

    // Assert
    expect(warnSpy).toHaveBeenCalledWith("[cron] sweepAiParseAttempts tick");
  });

  it("calls sweep_expired_ai_parse_attempts on every scheduled tick", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 5, error: null });

    // Act
    await worker.scheduled({} as ScheduledEvent, env, mockExecutionContext);

    // Assert
    expect(rpc).toHaveBeenCalledWith("sweep_expired_ai_parse_attempts");
  });

  it("logs only the swept row count on success, never row content", async () => {
    // Arrange
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 12, error: null });

    // Act
    await worker.scheduled({} as ScheduledEvent, env, mockExecutionContext);

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
      worker.scheduled({} as ScheduledEvent, env, mockExecutionContext),
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
      worker.scheduled({} as ScheduledEvent, env, mockExecutionContext),
    ).resolves.toBeUndefined();
  });
});

// Story 12.2: the reminders-sweep branch of scheduled(), dispatched on
// `event.cron === REMINDER_SWEEP_CRON` (REMINDER_EVENT, every 15 minutes) —
// a SEPARATE tick from the retention sweep covered above (RETENTION_EVENT,
// once daily). Asserts AC-9's own falsifiable claim: a heartbeat is
// recorded with no error on success, and with a bounded
// rpc_failed/transport_failed code — followed by a rethrow — on failure.
describe("cron worker — reminders sweep (event.cron === REMINDER_SWEEP_CRON)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims nothing, sends nothing, and records a heartbeat with no error when nothing is due", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Act
    await worker.scheduled(REMINDER_EVENT, env, mockExecutionContext);

    // Assert
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_cron_heartbeat", {
      p_worker: "cron",
      p_error: null,
      p_failed_count: 0,
    });
    // The retention sweep's own RPC never fires on this tick.
    expect(rpc).not.toHaveBeenCalledWith(
      "sweep_expired_ai_parse_attempts",
      expect.anything(),
    );
  });

  it("does not run the retention sweep on the reminders tick", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: 0, error: null });

    // Act
    await worker.scheduled(REMINDER_EVENT, env, mockExecutionContext);

    // Assert
    const calledNames = rpc.mock.calls.map((call) => call[0]);
    expect(calledNames).not.toContain("sweep_expired_ai_parse_attempts");
  });

  it("does not run the reminders sweep on the retention tick", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockImplementation((name: string) => {
      if (name === "find_grace_subscriptions") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: 0, error: null });
    });

    // Act
    await worker.scheduled(RETENTION_EVENT, env, mockExecutionContext);

    // Assert
    const calledNames = rpc.mock.calls.map((call) => call[0]);
    expect(calledNames).not.toContain("sweep_expired_ai_parse_attempts");
  });

  it("records rpc_failed and rethrows when claim_due_task_notifications reports an error", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: null,
          error: { message: "permission denied" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Act / Assert
    await expect(
      worker.scheduled(REMINDER_EVENT, env, mockExecutionContext),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledWith("record_cron_heartbeat", {
      p_worker: "cron",
      p_error: "rpc_failed",
      p_failed_count: null,
    });
  });

  it("records transport_failed and rethrows when the claim call itself rejects", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.reject(new TypeError("network unreachable"));
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Act / Assert
    await expect(
      worker.scheduled(REMINDER_EVENT, env, mockExecutionContext),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledWith("record_cron_heartbeat", {
      p_worker: "cron",
      p_error: "transport_failed",
      p_failed_count: null,
    });
  });

  it("claims, sends and settles a due reminder, then records a healthy heartbeat", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claimedRow = {
      id: 1,
      task_id: 10,
      account_id: 100,
      recipient_email: "parent@example.test",
      task_text: "Follow up with the Cohens",
      due_date: "2026-08-07T12:00:00Z",
      target_type: "shidduch",
      target_id: 55,
      attempts: 1,
      claimed_at: "2026-08-07T12:05:00Z",
    };
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    await worker.scheduled(REMINDER_EVENT, env, mockExecutionContext);

    // Assert
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("settle_task_notification", {
      p_id: 1,
      p_status: "sent",
      p_error: null,
      p_next_attempt_at: null,
      p_claimed_at: "2026-08-07T12:05:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("record_cron_heartbeat", {
      p_worker: "cron",
      p_error: null,
      p_failed_count: 0,
    });
  });

  it("R3: records the tick's own failed count on the heartbeat even though the tick itself succeeded — a green sweep is not the same claim as healthy delivery", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const claimedRow = {
      id: 1,
      task_id: 10,
      account_id: 100,
      recipient_email: "parent@example.test",
      task_text: "Follow up with the Cohens",
      due_date: "2026-08-07T12:00:00Z",
      target_type: "shidduch",
      target_id: 55,
      attempts: 5,
      claimed_at: "2026-08-07T12:05:00Z",
    };
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    // Every send fails terminally — simulates missing/invalid Resend
    // credentials, the exact scenario R3 names.
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Resend responded 401: invalid API key",
      retryable: false,
    });

    // Act
    await worker.scheduled(REMINDER_EVENT, env, mockExecutionContext);

    // Assert — the sweep's own RPCs all succeeded (no rethrow, no
    // rpc_failed/transport_failed code), but the heartbeat still carries
    // last_failed_count > 0, which is what lets Settings tell this apart
    // from a genuinely healthy sweep.
    expect(rpc).toHaveBeenCalledWith("record_cron_heartbeat", {
      p_worker: "cron",
      p_error: null,
      p_failed_count: 1,
    });
  });
});
