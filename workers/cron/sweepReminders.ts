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
 * — the claim RPC or a settle RPC erroring or the underlying transport
 * rejecting. A single recipient's email failing to send is NOT one of
 * these: that settles the offending row 'failed' with the reason (Resend's
 * own error text) and the loop continues to the next claimed row — losing
 * one email must never lose the rest of the batch. index.ts is what turns a
 * thrown SweepRemindersError into a bounded `cron_heartbeat.last_error`
 * code and rethrows so the Worker's own scheduled-tick failure is visible
 * to Cloudflare, not just to this Worker's own logs.
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

async function settle(
  client: ServiceRoleClient,
  id: number,
  status: "sent" | "failed",
  error: string | null,
): Promise<void> {
  try {
    const result = await client.rpc("settle_task_notification", {
      p_id: id,
      p_status: status,
      p_error: error,
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

const CLAIM_LIMIT = 100;

export async function sweepReminders(
  env: CronEnv,
): Promise<SweepRemindersResult> {
  const client = getServiceRoleClient(env);
  const claimed = await claim(client, CLAIM_LIMIT);

  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    if (!reminder.recipient_email) {
      // Should not happen — claim only ever selects 'pending' rows, and
      // enqueue_due_task_notifications() never writes 'pending' without a
      // recipient_email (AC-5). Guarded anyway rather than calling Resend
      // with an empty recipient.
      await settle(
        client,
        reminder.id,
        "failed",
        "claimed row carried no recipient_email",
      );
      failed += 1;
      continue;
    }

    const result = await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
      to: reminder.recipient_email,
      subject: buildSubject(reminder),
      text: buildBody(reminder, env.APP_ORIGIN),
    });

    if (result.ok) {
      await settle(client, reminder.id, "sent", null);
      sent += 1;
    } else {
      await settle(client, reminder.id, "failed", result.error);
      failed += 1;
    }
  }

  return { claimed: claimed.length, sent, failed };
}
