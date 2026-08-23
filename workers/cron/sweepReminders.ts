import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import { sendEmail } from "../shared/resend";

/**
 * Story 12.2 (AD-13): the reminder-delivery sweep. Runs on the
 * `REMINDER_SWEEP_CRON` schedule (index.ts), claiming due reminders through
 * `claim_due_task_notifications()` (which itself calls
 * `enqueue_due_task_notifications()` first — see 02_functions.sql), sending
 * one email per claimed row via workers/shared/resend.ts, then settling each
 * row through `settle_task_notification()`.
 *
 * AC-7 (adopted from AD-7 via this story's own ruling — see the story's AC-7
 * text): this file issues NO direct table query at all — every read and
 * write goes through the three service_role-only RPCs below, never a table
 * query call. `noTenantTableAccess.guard.test.ts` (Story 7.5's AC-10 guard,
 * scoped to all of workers/cron/**\/*.ts) is what proves this — see that
 * file's own header for why it deliberately never spells out the literal
 * forbidden call shape in its own prose either.
 *
 * `sweepReminders()` itself throws only for a genuinely unexpected failure
 * with NOTHING left to process — the claim RPC erroring or its transport
 * rejecting. Nothing about a single claimed ROW, once claimed, is allowed
 * to throw out of the loop and strand its siblings: Epic 12's adversarial
 * review (R4) found that a settle RPC error used to do exactly that,
 * aborting the whole batch after every remaining row had already been
 * claimed (moved to 'sending') with no recovery. Every claimed row is now
 * processed inside its own try/catch — a send failure, a settle RPC error,
 * or a settle transport failure for ONE row is logged and counted, and the
 * loop moves on. A row that could not be settled at all stays 'sending';
 * claim_due_task_notifications()'s own lease-timeout reclaim (02_functions
 * .sql) is its recovery path, not this loop retrying it in the same tick.
 * index.ts is what turns a thrown SweepRemindersError into a bounded
 * `cron_heartbeat.last_error` code and rethrows so the Worker's own
 * scheduled-tick failure is visible to Cloudflare, not just to this
 * Worker's own logs.
 *
 * DELIVERY GUARANTEE, STATED HONESTLY (R4): this is AT-LEAST-ONCE delivery
 * with a provider-side dedupe key, NOT exactly-once. A crash, a stranded
 * lease, or a retried transient failure can all cause the SAME
 * task_notifications row to be claimed and sent more than once across
 * ticks; what prevents that from ever becoming two emails in an inbox is
 * `buildIdempotencyKey()` below, passed to Resend as its own
 * `Idempotency-Key` header (workers/shared/resend.ts) — Resend, not this
 * database, is what absorbs the duplicate request. Any future comment or
 * doc in this codebase claiming "exactly once, idempotent by construction"
 * for this path is wrong; say "at-least-once, deduplicated by Resend"
 * instead.
 *
 * RETRY (R2): a retryable send failure (workers/shared/resend.ts's own
 * `retryable` classification — a 429/5xx/transport failure, never a
 * terminal 4xx) re-arms the row 'pending' at a backoff-scheduled
 * `next_attempt_at` instead of settling it 'failed' immediately, up to
 * MAX_ATTEMPTS attempts total. `claim_due_task_notifications()` only
 * reclaims a 'pending' row once its `next_attempt_at` has elapsed.
 */

export interface CronEnv extends BaseEnv {
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_ORIGIN: string;
}

export interface SweepRemindersResult {
  claimed: number;
  sent: number;
  failed: number;
}

export type SweepRemindersErrorCode =
  "rpc_failed" | "transport_failed" | "unknown";

/**
 * Distinguishes an RPC that executed and reported an error (the Supabase
 * client resolved with `{ error }`) from the underlying HTTP transport
 * itself failing (the client call rejected) — the same split
 * `record_cron_heartbeat()`'s bounded code set (02_functions.sql) exists to
 * carry, so index.ts can classify a caught error into the right code
 * without re-deriving this distinction itself.
 */
export class SweepRemindersError extends Error {
  readonly code: SweepRemindersErrorCode;

  constructor(code: SweepRemindersErrorCode, message: string) {
    super(message);
    this.name = "SweepRemindersError";
    this.code = code;
  }
}

interface ClaimedReminder {
  id: number;
  task_id: number;
  account_id: number;
  recipient_email: string | null;
  task_text: string | null;
  due_date: string;
  target_type: string;
  target_id: number;
  /** R2: how many times (including this one) this row has been claimed —
   * caps retries at MAX_ATTEMPTS. */
  attempts: number;
  /** R4: this claim's own lease token, echoed back to
   * settle_task_notification() as its fencing p_claimed_at — see this
   * file's own header. */
  claimed_at: string;
  /** Official onboarding rows are settled locally; no provider call. */
  simulated: boolean;
}

type ServiceRoleClient = SupabaseClient;

function getServiceRoleClient(env: CronEnv): ServiceRoleClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function claim(
  client: ServiceRoleClient,
  limit: number,
): Promise<ClaimedReminder[]> {
  let data: unknown;
  try {
    const result = await client.rpc("claim_due_task_notifications", {
      p_limit: limit,
    });
    if (result.error) {
      console.error(
        "cron.sweepReminders.claimRpcError",
        summarizeErrorForLog(result.error),
      );
      throw new SweepRemindersError(
        "rpc_failed",
        "claim_due_task_notifications reported an error",
      );
    }
    data = result.data;
  } catch (error) {
    if (error instanceof SweepRemindersError) throw error;
    console.error(
      "cron.sweepReminders.claimTransportError",
      summarizeErrorForLog(error),
    );
    throw new SweepRemindersError(
      "transport_failed",
      "claim_due_task_notifications transport failure",
    );
  }

  return Array.isArray(data) ? (data as ClaimedReminder[]) : [];
}

/**
 * R2: a bounded retry budget, not an unbounded one — a row that is STILL
 * retryable-failing after MAX_ATTEMPTS claims is settled terminally
 * 'failed' rather than re-armed forever.
 */
const MAX_ATTEMPTS = 5;

/**
 * R2: minutes to wait before the Nth attempt's retry is eligible again,
 * indexed by (attempts - 1) and capped at the last entry — a short first
 * retry (a blip clears fast) growing to a much longer one (an outage does
 * not).
 */
const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

function computeNextAttemptAt(attempts: number): string {
  const index = Math.min(
    Math.max(attempts - 1, 0),
    RETRY_BACKOFF_MINUTES.length - 1,
  );
  return new Date(
    Date.now() + RETRY_BACKOFF_MINUTES[index] * 60 * 1000,
  ).toISOString();
}

/**
 * R4: Resend's own idempotency identity for this occurrence, derived from
 * exactly the tuple task_notifications' own unique constraint uses
 * (task_id, channel, due_date — 01_tables.sql) — see resend.ts's own
 * `idempotencyKey` doc and this file's header for what this does and does
 * not guarantee.
 */
function buildIdempotencyKey(reminder: ClaimedReminder): string {
  return `task-notification:${reminder.task_id}:email:${reminder.due_date}`;
}

type SettleStatus = "sent" | "failed" | "pending";

async function settle(
  client: ServiceRoleClient,
  reminder: Pick<ClaimedReminder, "id" | "claimed_at">,
  status: SettleStatus,
  error: string | null,
  nextAttemptAt: string | null = null,
): Promise<void> {
  try {
    const result = await client.rpc("settle_task_notification", {
      p_id: reminder.id,
      p_status: status,
      p_error: error,
      p_next_attempt_at: nextAttemptAt,
      p_claimed_at: reminder.claimed_at,
    });
    if (result.error) {
      console.error(
        "cron.sweepReminders.settleRpcError",
        summarizeErrorForLog(result.error),
      );
      throw new SweepRemindersError(
        "rpc_failed",
        "settle_task_notification reported an error",
      );
    }
  } catch (caught) {
    if (caught instanceof SweepRemindersError) throw caught;
    console.error(
      "cron.sweepReminders.settleTransportError",
      summarizeErrorForLog(caught),
    );
    throw new SweepRemindersError(
      "transport_failed",
      "settle_task_notification transport failure",
    );
  }
}

function buildSubject(reminder: ClaimedReminder): string {
  return reminder.task_text
    ? `Reminder: ${reminder.task_text}`
    : "You have a reminder due";
}

function buildBody(reminder: ClaimedReminder, appOrigin: string): string {
  const link = `${appOrigin}/#/reminders`;
  const what = reminder.task_text ?? "a reminder you set";
  // Deliberately no message BODY text beyond the reminder's own short
  // label — the same "never include content beyond what the recipient
  // already wrote" principle Story 7.5's Task 5 documents for push, applied
  // here to email: this line is what the reminder-creator themselves typed
  // into the create sheet, not a system-composed summary of anything else.
  return `${what}\n\nOpen your reminders: ${link}`;
}

/**
 * Everything one claimed row needs, ending in exactly one settle call (or,
 * for R4, none — see the catch below). Never throws: a failure anywhere in
 * here — sending, or settling — is caught by the caller's own per-row
 * try/catch, which is the actual R4 fix (a single row's failure must never
 * strand the rest of the batch, the opposite of what this loop used to do
 * when settle() itself was allowed to throw all the way out).
 */
async function processReminder(
  client: ServiceRoleClient,
  env: CronEnv,
  reminder: ClaimedReminder,
): Promise<"sent" | "failed"> {
  if (reminder.simulated) {
    await settle(client, reminder, "sent", null);
    return "sent";
  }
  if (!reminder.recipient_email) {
    // Should not happen — claim only ever selects 'pending' rows, and
    // enqueue_due_task_notifications() never writes 'pending' without a
    // recipient_email (AC-5). Guarded anyway rather than calling Resend
    // with an empty recipient. Terminal, not retryable: a missing
    // recipient will not appear on a later attempt.
    await settle(
      client,
      reminder,
      "failed",
      "claimed row carried no recipient_email",
    );
    return "failed";
  }

  const result = await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM,
    to: reminder.recipient_email,
    subject: buildSubject(reminder),
    text: buildBody(reminder, env.APP_ORIGIN),
    idempotencyKey: buildIdempotencyKey(reminder),
  });

  if (result.ok) {
    await settle(client, reminder, "sent", null);
    return "sent";
  }

  if (result.retryable && reminder.attempts < MAX_ATTEMPTS) {
    await settle(
      client,
      reminder,
      "pending",
      result.error,
      computeNextAttemptAt(reminder.attempts),
    );
    return "failed";
  }

  await settle(
    client,
    reminder,
    "failed",
    result.retryable
      ? `${result.error} (retryable, but exhausted ${reminder.attempts} attempts)`
      : result.error,
  );
  return "failed";
}

const CLAIM_LIMIT = 100;

export async function sweepReminders(
  env: CronEnv,
): Promise<SweepRemindersResult> {
  const client = getServiceRoleClient(env);
  const claimed = await claim(client, CLAIM_LIMIT);

  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      const outcome = await processReminder(client, env, reminder);
      if (outcome === "sent") {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      // R4: this row could not even be settled (a settle RPC error or
      // transport failure) — it stays 'sending'. That is NOT this tick
      // aborting: every other claimed row still gets processed below.
      // claim_due_task_notifications()'s own lease-timeout reclaim
      // (02_functions.sql) is what recovers a row stranded here, on a
      // later tick.
      console.error(
        "cron.sweepReminders.rowProcessingError",
        summarizeErrorForLog(error),
      );
      failed += 1;
    }
  }

  return { claimed: claimed.length, sent, failed };
}
