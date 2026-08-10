import { createClient } from "@supabase/supabase-js";
import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import { sweepAiParseAttempts } from "./sweepAiParseAttempts";
import { sweepGraceWindow } from "./sweepGraceWindow";
import { sweepMessages, SweepMessagesError } from "./sweepMessages";
import type { MessageCronEnv } from "./sweepMessages";
import { sweepReminders, SweepRemindersError } from "./sweepReminders";
import type { CronEnv, SweepRemindersErrorCode } from "./sweepReminders";
import { alertOnSilence, createErrorAlerter } from "../shared/alerting";

// This Worker's `scheduled()` handler fires on THREE independent cron
// schedules, declared together in wrangler.toml's `[triggers]` (Cloudflare
// dispatches every schedule in that array to the SAME `scheduled()` export,
// distinguished at runtime by `event.cron`):
//
//   - REMINDER_SWEEP_CRON ("*/15 * * * *"): Story 12.2's reminder-delivery
//     sweep (AD-13) — sweepReminders.ts, claiming due/overdue tasks and
//     emailing their owner — and, on that same tick and sharing Story 12.2's
//     single recordHeartbeat, Story 16.4 (part 2)'s queued
//     message-notification sweep (sweepMessages.ts).
//   - GRACE_SWEEP_CRON ("0 3 * * *"): Story 12.6's grace window sweep
//     (FR75) — lapses expired grace windows, starts new ones for freshly
//     past_due subscriptions, sends dunning emails.
//   - every other scheduled tick: R2 (Epic 11 external review, Finding 11
//     closure)'s daily PII-retention sweep, sweepAiParseAttempts().
//
// Story 7.5 ("Communication", the post-Amendment-A2 Epic 7) had planned
// sweepMessages.ts as a future FOURTH concern sharing this same Worker and
// this same scheduled() tick, per that story's own Dev Notes ("The AD-13
// 'E7' naming trap"). Story 16.4 (part 2) has now wired it: sweepMessages()
// runs on the REMINDER_SWEEP_CRON branch below alongside sweepReminders() —
// no schedule of its own (wrangler.toml's [triggers] is unchanged) and no
// heartbeat of its own (it shares Story 12.2's recordHeartbeat; a failure is
// surfaced through the error alerter, so a dead message sweep is never
// mistaken for a healthy reminders tick).
const app = createWorkerApp<BaseEnv>("cron");

// Kept as exported constants, not literals repeated in two places, so
// this file's own branch below and wrangler.toml's `[triggers]` entry
// cannot silently drift apart — a mismatch here would mean the reminders
// sweep either never fires (wrong string) or fires on every tick, including
// the grace/retention sweeps, undermining their own cadence rationale
// (wrangler.toml's header comment).
export const REMINDER_SWEEP_CRON = "*/15 * * * *";
export const GRACE_SWEEP_CRON = "0 3 * * *";

function getServiceRoleClient(env: BaseEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * AC-9: upserts `public.cron_heartbeat` for `worker = 'cron'`, success or
 * failure, so a dead reminders sweep is visible from Settings instead of
 * indistinguishable from "healthy, nothing due yet" — the exact ambiguity
 * that let this feature ship silently broken the first time. Scoped to the
 * REMINDER_SWEEP_CRON tick alone (not the retention sweep's tick): the
 * heartbeat's own staleness threshold (30 minutes, wrangler.toml) is sized
 * to the reminders cadence specifically, and Settings' three-state read is
 * about "is the reminders sweep alive", not "did any cron tick fire at all".
 *
 * Epic 12 review fix (R3): `failedCount` is the just-finished tick's own
 * `result.failed` — record_cron_heartbeat() only stores it on a null
 * errorCode call (a genuinely successful tick), but a "successful tick"
 * and "every email actually sent" used to be conflated: `sweepReminders()`
 * returns normally even when every individual send failed (a single bad
 * recipient must never abort the batch — sweepReminders.ts's own header),
 * and this function used to record a plain success heartbeat regardless,
 * so missing/invalid Resend credentials produced a green heartbeat and a
 * permanently failing queue. ReminderDeliveryStatus.tsx now reads
 * `last_failed_count` to tell "the sweep ran" apart from "delivery is
 * actually healthy."
 *
 * Never throws itself — a heartbeat write failing must not mask (or
 * replace) whatever real sweep failure is already being reported by the
 * caller's own rethrow.
 */
async function recordHeartbeat(
  env: BaseEnv,
  errorCode: SweepRemindersErrorCode | null,
  failedCount: number | null = null,
): Promise<void> {
  try {
    const { error } = await getServiceRoleClient(env).rpc(
      "record_cron_heartbeat",
      { p_worker: "cron", p_error: errorCode, p_failed_count: failedCount },
    );
    if (error) {
      console.error(
        "cron.recordHeartbeat.rpcError",
        summarizeErrorForLog(error),
      );
    }
  } catch (error) {
    console.error("cron.recordHeartbeat.threw", summarizeErrorForLog(error));
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: BaseEnv, ctx: ExecutionContext) {
    const requestId = crypto.randomUUID();
    const alerter = createErrorAlerter(env, "cron", "scheduled", requestId);

    if (event.cron === REMINDER_SWEEP_CRON) {
      // Story 16.4 (part 2): the queued message-notification sweep shares
      // this same tick but stays a SEPARATE concern from the reminders sweep
      // that owns it — each runs in its own try/catch so one throwing never
      // strands the other. It gets NO heartbeat of its own: Story 12.2's
      // single recordHeartbeat below stays the tick's only record (its
      // staleness threshold is sized to the reminders cadence), so a failure
      // here is surfaced through the error alerter instead of being written
      // into — or masked by — the reminders heartbeat.
      try {
        const messagesResult = await sweepMessages(env as MessageCronEnv);
        console.warn("[cron] sweepMessages.ok", messagesResult);
      } catch (error) {
        const code =
          error instanceof SweepMessagesError ? error.code : "unknown";
        console.error(
          "[cron] sweepMessages.failed",
          code,
          summarizeErrorForLog(error),
        );
        await alerter(error, "critical");
      }

      try {
        const result = await sweepReminders(env as CronEnv);
        console.warn("[cron] sweepReminders.ok", result);
        await recordHeartbeat(env, null, result.failed);

        ctx.waitUntil(
          alertOnSilence(
            env,
            "reminder-sweep",
            15,
            new Date().toISOString(),
            "cron",
          ),
        );
      } catch (error) {
        const code =
          error instanceof SweepRemindersError ? error.code : "unknown";
        await recordHeartbeat(env, code);
        await alerter(error, "critical");
        throw error;
      }
      return;
    }

    if (event.cron === GRACE_SWEEP_CRON) {
      try {
        const result = await sweepGraceWindow(env);
        console.warn("[cron] sweepGraceWindow.ok", result);
      } catch (error) {
        console.error(
          "[cron] sweepGraceWindow.failed",
          summarizeErrorForLog(error),
        );
        await alerter(error, "critical");
        throw error;
      }
      return;
    }

    console.warn("[cron] sweepAiParseAttempts tick");

    const result = await sweepAiParseAttempts(env);
    if (result.ok) {
      console.warn("[cron] sweepAiParseAttempts.ok", {
        deleted: result.deleted,
      });
    } else {
      console.warn(
        "[cron] sweepAiParseAttempts.failed — see the cron.sweepAiParseAttempts.* error logged above",
      );
    }
  },
};
