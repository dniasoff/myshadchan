import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { summarizeErrorForLog } from "../shared/safeLog";
import { sendEmail } from "../shared/resend";
import type { CronEnv } from "./sweepReminders";
import { sendWebPush, type WebPushSubscription } from "./webPush";

/**
 * Story 16.4 (part 1): the message-notification send sweep. Runs on the
 * existing `REMINDER_SWEEP_CRON` tick (every 15 minutes, wrangler.toml) —
 * the same scheduled event that already fires the reminders sweep, not a
 * schedule of its own — claiming pending message notifications through
 * `claim_message_notifications()`, sending one email or push per claimed
 * row, then settling each row through `settle_message_notification()`.
 *
 *  AC-10 (adopted from Story 7.5 via this story's ruling): this file issues
 *  NO direct table query at all — every read and write goes through the
 *  service_role-only RPCs below, never a table query call.
 *  `noTenantTableAccess.guard.test.ts` (Story 7.5's AC-10 guard, scoped to
 *  every file under workers/cron) is what proves this.
 *
 * `sweepMessages()` itself throws only for a genuinely unexpected failure
 * with NOTHING left to process — the claim RPC erroring or its transport
 * rejecting. Nothing about a single claimed ROW, once claimed, is allowed to
 * throw out of the loop and strand its siblings: every claimed row is
 * processed inside its own try/catch — a send failure, a settle RPC error,
 * or a settle transport failure for ONE row is logged and counted, and the
 * loop moves on. A row that could not be settled at all stays in whatever
 * state the claim RPC left it; the next tick's claim will reclaim it.
 * index.ts is what turns a thrown SweepMessagesError into a bounded
 * `cron_heartbeat.last_error` code and rethrows so the Worker's own
 * scheduled-tick failure is visible to Cloudflare, not just to this
 * Worker's own logs.
 *
 * PRIVACY (CRITICAL): the email body MUST NEVER contain `row.message_body`.
 * The email says only that there is a new message and where to read it.
 * This is the same principle Story 7.5's Task 5 documented for push ("never
 * include message body text in the email"), applied here to email as well.
 *
 * DELIVERY GUARANTEE: this is AT-LEAST-ONCE delivery with a provider-side
 * dedupe key (Resend's `Idempotency-Key` for email; for push, the empty
 * payload and VAPID auth mean duplicates are harmless — the service worker
 * shows a fixed "you have a new message" notification regardless). Any
 * future comment or doc in this codebase claiming "exactly once, idempotent
 * by construction" for this path is wrong; say "at-least-once, deduplicated
 * by Resend / harmless duplicate push" instead.
 */

export interface MessageCronEnv extends CronEnv {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

export interface SweepMessagesResult {
  claimed: number;
  sent: number;
  failed: number;
}

export type SweepMessagesErrorCode =
  "rpc_failed" | "transport_failed" | "unknown";

/**
 * Distinguishes an RPC that executed and reported an error (the Supabase
 * client resolved with `{ error }`) from the underlying HTTP transport
 * itself failing (the client call rejected) — the same split
 * `record_cron_heartbeat()`'s bounded code set (02_functions.sql) exists to
 * carry, so index.ts can classify a caught error into the right code
 * without re-deriving this distinction itself.
 */
export class SweepMessagesError extends Error {
  readonly code: SweepMessagesErrorCode;

  constructor(code: SweepMessagesErrorCode, message: string) {
    super(message);
    this.name = "SweepMessagesError";
    this.code = code;
  }
}

interface ClaimedMessageNotification {
  id: number;
  channel: "email" | "push";
  recipient_member_id: number;
  recipient_email: string | null;
  thread_id: number;
  message_body: string;
  subject_type: string;
  subject_id: number;
  push_subscriptions: WebPushSubscription[] | null;
}

type ServiceRoleClient = SupabaseClient;

function getServiceRoleClient(env: MessageCronEnv): ServiceRoleClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function claim(
  client: ServiceRoleClient,
  limit: number,
): Promise<ClaimedMessageNotification[]> {
  let data: unknown;
  try {
    const result = await client.rpc("claim_message_notifications", {
      p_limit: limit,
    });
    if (result.error) {
      console.error(
        "cron.sweepMessages.claimRpcError",
        summarizeErrorForLog(result.error),
      );
      throw new SweepMessagesError(
        "rpc_failed",
        "claim_message_notifications reported an error",
      );
    }
    data = result.data;
  } catch (error) {
    if (error instanceof SweepMessagesError) throw error;
    console.error(
      "cron.sweepMessages.claimTransportError",
      summarizeErrorForLog(error),
    );
    throw new SweepMessagesError(
      "transport_failed",
      "claim_message_notifications transport failure",
    );
  }

  return Array.isArray(data) ? (data as ClaimedMessageNotification[]) : [];
}

type SettleStatus = "sent" | "failed";

async function settle(
  client: ServiceRoleClient,
  id: number,
  status: SettleStatus,
  error: string | null,
): Promise<void> {
  try {
    const result = await client.rpc("settle_message_notification", {
      p_id: id,
      p_status: status,
      p_error: error,
    });
    if (result.error) {
      console.error(
        "cron.sweepMessages.settleRpcError",
        summarizeErrorForLog(result.error),
      );
      throw new SweepMessagesError(
        "rpc_failed",
        "settle_message_notification reported an error",
      );
    }
  } catch (caught) {
    if (caught instanceof SweepMessagesError) throw caught;
    console.error(
      "cron.sweepMessages.settleTransportError",
      summarizeErrorForLog(caught),
    );
    throw new SweepMessagesError(
      "transport_failed",
      "settle_message_notification transport failure",
    );
  }
}

function buildIdempotencyKey(notification: ClaimedMessageNotification): string {
  return `message-notification:${notification.id}:${notification.channel}`;
}

function buildEmailSubject(): string {
  return "New message in your conversation";
}

function buildEmailBody(
  notification: ClaimedMessageNotification,
  appOrigin: string,
): string {
  const link = `${appOrigin}/#/messages/${notification.thread_id}`;
  // CRITICAL PRIVACY RULE: never include notification.message_body in the email.
  // The email says only that there is a new message and where to read it.
  return `You have a new message.\n\nOpen your messages: ${link}`;
}

async function processNotification(
  client: ServiceRoleClient,
  env: MessageCronEnv,
  notification: ClaimedMessageNotification,
): Promise<"sent" | "failed"> {
  if (notification.channel === "email") {
    if (!notification.recipient_email) {
      await settle(
        client,
        notification.id,
        "failed",
        "claimed row carried no recipient_email",
      );
      return "failed";
    }

    const result = await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
      to: notification.recipient_email,
      subject: buildEmailSubject(),
      text: buildEmailBody(notification, env.APP_ORIGIN),
      idempotencyKey: buildIdempotencyKey(notification),
    });

    if (result.ok) {
      await settle(client, notification.id, "sent", null);
      return "sent";
    }

    await settle(client, notification.id, "failed", result.error);
    return "failed";
  }

  if (notification.channel === "push") {
    const subscriptions = notification.push_subscriptions ?? [];
    if (subscriptions.length === 0) {
      await settle(
        client,
        notification.id,
        "failed",
        "claimed push row carried no push_subscriptions",
      );
      return "failed";
    }

    let allSent = true;
    let lastError: string | null = null;

    for (const subscription of subscriptions) {
      const pushResult = await sendWebPush(
        subscription,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
        env.VAPID_SUBJECT,
      );

      if (pushResult.expired) {
        try {
          await client.rpc("delete_push_subscription_by_endpoint", {
            p_endpoint: subscription.endpoint,
          });
        } catch (deleteError) {
          console.error(
            "cron.sweepMessages.deleteExpiredSubscriptionError",
            summarizeErrorForLog(deleteError),
          );
        }
      }

      if (!pushResult.ok) {
        allSent = false;
        lastError = `push to ${subscription.endpoint} failed with status ${pushResult.status}`;
      }
    }

    if (allSent) {
      await settle(client, notification.id, "sent", null);
      return "sent";
    }

    await settle(client, notification.id, "failed", lastError);
    return "failed";
  }

  await settle(
    client,
    notification.id,
    "failed",
    `unknown channel: ${(notification as ClaimedMessageNotification).channel}`,
  );
  return "failed";
}

const CLAIM_LIMIT = 100;

export async function sweepMessages(
  env: MessageCronEnv,
): Promise<SweepMessagesResult> {
  const client = getServiceRoleClient(env);
  const claimed = await claim(client, CLAIM_LIMIT);

  let sent = 0;
  let failed = 0;

  for (const notification of claimed) {
    try {
      const outcome = await processNotification(client, env, notification);
      if (outcome === "sent") {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      console.error(
        "cron.sweepMessages.rowProcessingError",
        summarizeErrorForLog(error),
      );
      failed += 1;
    }
  }

  return { claimed: claimed.length, sent, failed };
}
