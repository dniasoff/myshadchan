import { beforeEach, describe, expect, it, vi } from "vitest";

import { sweepMessages } from "./sweepMessages";
import type { MessageCronEnv } from "./sweepMessages";

/**
 * Story 16.4 (part 1): covers claim -> send -> settle for message
 * notifications across both channels, the privacy rule that makes this
 * story exist (the email must never carry `message_body`), expired-push
 * handling via `delete_push_subscription_by_endpoint()`, and the
 * consistency rule inherited from Epic 12's R4 reasoning — a single row's
 * failure never strands the rest of the batch.
 */

const rpc = vi.fn();
const sendEmail = vi.fn();
const sendWebPush = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

vi.mock("../shared/resend", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("./webPush", () => ({
  sendWebPush: (...args: unknown[]) => sendWebPush(...args),
}));

const env: MessageCronEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "support@myshadchan.space",
  APP_ORIGIN: "https://www.myshadchan.space",
  VAPID_PUBLIC_KEY: "vapid-public-key",
  VAPID_PRIVATE_KEY: "vapid-private-key",
  VAPID_SUBJECT: "mailto:cron@myshadchan.space",
};

function claimedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    channel: "email",
    recipient_member_id: 100,
    recipient_email: "parent@example.test",
    thread_id: 55,
    message_body: "SECRET_BODY_TEXT",
    subject_type: "shidduch",
    subject_id: 55,
    push_subscriptions: null,
    ...overrides,
  };
}

describe("sweepMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("sends an email for an email-channel row and never includes message_body anywhere in the request (PRIVACY)", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_message_notifications") {
        return Promise.resolve({ data: [claimedRow()], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });

    // Act
    const result = await sweepMessages(env);

    // Assert
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
      to: "parent@example.test",
      subject: "New message in your conversation",
      text: expect.stringContaining(
        "https://www.myshadchan.space/#/messages/55",
      ),
      idempotencyKey: "message-notification:1:email",
    });
    // The assertion that carries the story: the seeded body must appear
    // NOWHERE in the arguments handed to sendEmail.
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(
      "SECRET_BODY_TEXT",
    );
  });

  it("sends a push to EACH subscription of a push-channel row", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_message_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({
              id: 2,
              channel: "push",
              recipient_email: null,
              push_subscriptions: [
                {
                  endpoint: "https://push.example.com/1",
                  p256dh: "a",
                  auth: "b",
                },
                {
                  endpoint: "https://push.example.com/2",
                  p256dh: "c",
                  auth: "d",
                },
              ],
            }),
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendWebPush.mockResolvedValue({ ok: true, status: 201, expired: false });

    // Act
    const result = await sweepMessages(env);

    // Assert
    expect(sendWebPush).toHaveBeenCalledTimes(2);
    expect(sendWebPush).toHaveBeenNthCalledWith(
      1,
      { endpoint: "https://push.example.com/1", p256dh: "a", auth: "b" },
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
      env.VAPID_SUBJECT,
    );
    expect(rpc).toHaveBeenCalledWith("settle_message_notification", {
      p_id: 2,
      p_status: "sent",
      p_error: null,
    });
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
  });

  it("deletes an expired push subscription by its endpoint (404/410)", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_message_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({
              id: 3,
              channel: "push",
              recipient_email: null,
              push_subscriptions: [
                {
                  endpoint: "https://push.example.com/stale",
                  p256dh: "a",
                  auth: "b",
                },
              ],
            }),
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendWebPush.mockResolvedValue({ ok: false, status: 410, expired: true });

    // Act
    const result = await sweepMessages(env);

    // Assert
    expect(rpc).toHaveBeenCalledWith("delete_push_subscription_by_endpoint", {
      p_endpoint: "https://push.example.com/stale",
    });
    expect(rpc).toHaveBeenCalledWith("settle_message_notification", {
      p_id: 3,
      p_status: "failed",
      p_error: "push to https://push.example.com/stale failed with status 410",
    });
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
  });

  it("a row whose send throws is counted 'failed' and the remaining rows are still processed", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_message_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({ id: 1, recipient_email: "one@example.test" }),
            claimedRow({ id: 2, recipient_email: "two@example.test" }),
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail
      .mockRejectedValueOnce(new Error("transport failure"))
      .mockResolvedValueOnce({ ok: true, id: "email-2" });

    // Act
    const result = await sweepMessages(env);

    // Assert — the thrown row is recorded as failed, the sibling is still
    // sent and settled, and the sweep resolves instead of aborting.
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("settle_message_notification", {
      p_id: 2,
      p_status: "sent",
      p_error: null,
    });
  });

  it("returns the correct {claimed, sent, failed} counts for a mixed batch", async () => {
    // Arrange
    rpc.mockImplementation((name: string) => {
      if (name === "claim_message_notifications") {
        return Promise.resolve({
          data: [
            claimedRow({ id: 1, recipient_email: "one@example.test" }),
            claimedRow({
              id: 2,
              channel: "push",
              recipient_email: null,
              push_subscriptions: [
                {
                  endpoint: "https://push.example.com/1",
                  p256dh: "a",
                  auth: "b",
                },
              ],
            }),
            claimedRow({ id: 3, recipient_email: null }),
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sendEmail.mockResolvedValue({ ok: true, id: "email-1" });
    sendWebPush.mockResolvedValue({ ok: true, status: 201, expired: false });

    // Act
    const result = await sweepMessages(env);

    // Assert — one email sent, one push sent, one email row with no
    // recipient that had to settle 'failed'.
    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("settle_message_notification", {
      p_id: 3,
      p_status: "failed",
      p_error: "claimed row carried no recipient_email",
    });
  });
});
