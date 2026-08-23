import { beforeEach, describe, expect, it, vi } from "vitest";

import { sweepReminders, SweepRemindersError } from "./sweepReminders";
import type { CronEnv } from "./sweepReminders";

/**
 * Story 12.2 (AC-1, AC-6, AC-7) + Epic 12 adversarial review fixes (R2, R4):
 * covers claim -> send -> settle ordering, retryable-vs-terminal send
 * failure classification (a retryable one re-arms 'pending' with a backoff
 * next_attempt_at; a terminal one, or a retryable one past MAX_ATTEMPTS,
 * settles 'failed'), a settle failure for ONE row never stranding the rest
 * of the batch (R4 — this used to throw and abort the whole tick), and the
 * classification a thrown claim-level error carries out to index.ts (AC-9's
 * rpc_failed/transport_failed split). AC-7's own `?raw` source scan lives in
 * noTenantTableAccess.guard.test.ts, scoped to the whole of workers/cron/**.
 */

const rpc = vi.fn();
const sendEmail = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

vi.mock("../shared/resend", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

const env: CronEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "support@myshadchan.space",
  APP_ORIGIN: "https://www.myshadchan.space",
};

function claimedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    simulated: false,
    ...overrides,
  };
}

describe("sweepReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("claims, sends, then settles — in that order — for a single due reminder", async () => {
    // Arrange
    const callOrder: string[] = [];
    rpc.mockImplementation((name: string) => {
      callOrder.push(name);
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow()], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockImplementation(() => {
      callOrder.push("sendEmail");
      return Promise.resolve({ ok: true, id: "email-1" });
    });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(callOrder).toEqual([
      "claim_due_task_notifications",
      "sendEmail",
      "settle_task_notification",
    ]);
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_due_task_notifications", {
      p_limit: 100,
    });
    expect(rpc).toHaveBeenCalledWith("settle_task_notification", {
      p_id: 1,
      p_status: "sent",
      p_error: null,
      p_next_attempt_at: null,
      p_claimed_at: "2026-08-07T12:05:00Z",
    });
  });

  it("sends the recipient's own email address and a subject naming the reminder text", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow()], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    await sweepReminders(env);

    // Assert
    expect(sendEmail).toHaveBeenCalledWith({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
      to: "parent@example.test",
      subject: "Reminder: Follow up with the Cohens",
      text: expect.stringContaining("https://www.myshadchan.space/#/reminders"),
      idempotencyKey: "task-notification:10:email:2026-08-07T12:00:00Z",
    });
  });

  it("settles a simulated reminder without calling the email provider", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [claimedRow({ id: 77, simulated: true })],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const result = await sweepReminders(env);

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("settle_task_notification", {
      p_id: 77,
      p_status: "sent",
      p_error: null,
      p_next_attempt_at: null,
      p_claimed_at: "2026-08-07T12:05:00Z",
    });
  });

  it("a terminal (non-retryable) send failure settles the row 'failed' with the reason, and the batch continues to the next row", async () => {
    // Arrange
    const settleCalls: unknown[] = [];
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({
              id: 1,
              recipient_email: "one@example.test",
              claimed_at: "2026-08-07T12:05:00Z",
            }),
            claimedRow({
              id: 2,
              recipient_email: "two@example.test",
              claimed_at: "2026-08-07T12:05:01Z",
            }),
          ],
          error: null,
        });
      }
      if (name === "settle_task_notification") {
        settleCalls.push(args);
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail
      .mockResolvedValueOnce({
        ok: false,
        error: "Resend responded 403: domain is not verified",
        retryable: false,
      })
      .mockResolvedValueOnce({ ok: true, id: "email-2" });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(settleCalls).toEqual([
      {
        p_id: 1,
        p_status: "failed",
        p_error: "Resend responded 403: domain is not verified",
        p_next_attempt_at: null,
        p_claimed_at: "2026-08-07T12:05:00Z",
      },
      {
        p_id: 2,
        p_status: "sent",
        p_error: null,
        p_next_attempt_at: null,
        p_claimed_at: "2026-08-07T12:05:01Z",
      },
    ]);
  });

  it("a retryable send failure re-arms the row 'pending' with a computed next_attempt_at, not 'failed'", async () => {
    // Arrange
    const settleCalls: Array<Record<string, unknown>> = [];
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [claimedRow({ attempts: 1 })],
          error: null,
        });
      }
      if (name === "settle_task_notification" && args) {
        settleCalls.push(args);
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Resend responded 503: upstream unavailable",
      retryable: true,
    });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0]).toMatchObject({
      p_id: 1,
      p_status: "pending",
      p_error: "Resend responded 503: upstream unavailable",
    });
    expect(typeof settleCalls[0].p_next_attempt_at).toBe("string");
    expect(
      new Date(settleCalls[0].p_next_attempt_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("a retryable send failure settles terminally 'failed' once attempts reach MAX_ATTEMPTS, not 'pending'", async () => {
    // Arrange
    const settleCalls: Array<Record<string, unknown>> = [];
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [claimedRow({ attempts: 5 })],
          error: null,
        });
      }
      if (name === "settle_task_notification" && args) {
        settleCalls.push(args);
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Resend responded 503: upstream unavailable",
      retryable: true,
    });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].p_status).toBe("failed");
    expect(settleCalls[0].p_next_attempt_at).toBeNull();
    expect(settleCalls[0].p_error).toContain("exhausted 5 attempts");
  });

  it("a settle failure for one row does not strand the rest of the batch (R4)", async () => {
    // Arrange
    const settleCalls: unknown[] = [];
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({ id: 1, recipient_email: "one@example.test" }),
            claimedRow({ id: 2, recipient_email: "two@example.test" }),
          ],
          error: null,
        });
      }
      if (name === "settle_task_notification") {
        settleCalls.push(args);
        if ((args as { p_id: number }).p_id === 1) {
          return Promise.resolve({
            data: null,
            error: { message: "row not found" },
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    const result = await sweepReminders(env);

    // Assert — the whole batch still gets processed; the failing settle for
    // row 1 does not prevent row 2 from being sent and settled.
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(settleCalls).toHaveLength(2);
  });

  it("claims nothing and sends nothing when no reminder is due", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: [], error: null });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("throws a SweepRemindersError('rpc_failed') when claim_due_task_notifications reports an error", async () => {
    // Arrange
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    // Act / Assert
    const error = await sweepReminders(env).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SweepRemindersError);
    expect((error as SweepRemindersError).code).toBe("rpc_failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("throws a SweepRemindersError('transport_failed') when the claim call itself rejects", async () => {
    // Arrange
    rpc.mockRejectedValue(new TypeError("network unreachable"));

    // Act / Assert
    const error = await sweepReminders(env).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SweepRemindersError);
    expect((error as SweepRemindersError).code).toBe("transport_failed");
  });

  it("R4: does NOT throw when settle_task_notification reports an error for a claimed row — it is counted 'failed' and the tick still resolves", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow()], error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "row not found" },
      });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    const result = await sweepReminders(env);

    // Assert — before R4 this threw a SweepRemindersError and aborted the
    // whole tick; now the row's own settle failure is contained.
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
  });

  it("R4: does NOT throw when the settle call itself rejects for a claimed row — it is counted 'failed' and the tick still resolves", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({ data: [claimedRow()], error: null });
      }
      return Promise.reject(new TypeError("network unreachable"));
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
  });

  it("settles a claimed row with no recipient_email as 'failed' without ever calling Resend", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_due_task_notifications") {
        return Promise.resolve({
          data: [claimedRow({ recipient_email: null })],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Act
    const result = await sweepReminders(env);

    // Assert
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledWith("settle_task_notification", {
      p_id: 1,
      p_status: "failed",
      p_error: "claimed row carried no recipient_email",
      p_next_attempt_at: null,
      p_claimed_at: "2026-08-07T12:05:00Z",
    });
  });

  it("never logs a raw caught error's own message — only summarizeErrorForLog's bounded shape", async () => {
    // Arrange
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    rpc.mockResolvedValue({
      data: null,
      error: new Error(
        "constraint violation: Key (email)=(chana.friedman@example.com) already exists",
      ),
    });

    // Act
    await sweepReminders(env).catch(() => undefined);

    // Assert
    const loggedText = errorSpy.mock.calls
      .map((call) => JSON.stringify(call))
      .join("\n");
    expect(loggedText).not.toContain("chana.friedman@example.com");
  });
});
