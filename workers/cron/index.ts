import { createClient } from "@supabase/supabase-js";
import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import { sweepAiParseAttempts } from "./sweepAiParseAttempts";
import { sweepReminders, SweepRemindersError } from "./sweepReminders";
import type { CronEnv, SweepRemindersErrorCode } from "./sweepReminders";

// This Worker's `scheduled()` handler fires on TWO independent cron
// schedules, declared together in wrangler.toml's `[triggers]` (Cloudflare
// dispatches every schedule in that array to the SAME `scheduled()` export,
// distinguished at runtime by `event.cron`):
//
//   - REMINDER_SWEEP_CRON ("*/15 * * * *"): Story 12.2's reminder-delivery
//     sweep (AD-13) — sweepReminders.ts, claiming due/overdue tasks and
//     emailing their owner. This is the branch this story wires in below;
//     until this story landed it was a bare stub (see git history for
//     workers/cron/wrangler.toml's own long-standing header comment on why
//     it stayed unarmed — the AC-4 backfill migration that suppresses the
//     pre-existing overdue backlog had not shipped yet).
//   - every other scheduled tick (currently just "0 3 * * *"): R2 (Epic 11
//     external review, Finding 11 closure)'s daily PII-retention sweep,
//     sweepAiParseAttempts() — unchanged by this story.
//
// Story 7.5 ("Communication", the post-Amendment-A2 Epic 7) will eventually
// add a THIRD concern — sweepMessages.ts, queued message notifications —
// sharing this same Worker and this same scheduled() tick, per that story's
// own Dev Notes ("The AD-13 'E7' naming trap"). Not wired here: this
// story's declared file set does not include it.
const app = createWorkerApp<BaseEnv>("cron");

// Kept as an exported constant, not a literal repeated in two places, so
// this file's own branch below and wrangler.toml's `[triggers]` entry
// cannot silently drift apart — a mismatch here would mean the reminders
// sweep either never fires (wrong string) or fires on every tick, including
// the retention sweep's, undermining that sweep's own daily-ish cadence
// rationale (wrangler.toml's header comment).
export const REMINDER_SWEEP_CRON = "*/15 * * * *";

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
 * Never throws itself — a heartbeat write failing must not mask (or
 * replace) whatever real sweep failure is already being reported by the
 * caller's own rethrow.
 */
async function recordHeartbeat(
  env: BaseEnv,
  errorCode: SweepRemindersErrorCode | null,
): Promise<void> {
  try {
    const { error } = await getServiceRoleClient(env).rpc(
      "record_cron_heartbeat",
      { p_worker: "cron", p_error: errorCode },
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
  async scheduled(event: ScheduledEvent, env: BaseEnv, _ctx: ExecutionContext) {
    if (event.cron === REMINDER_SWEEP_CRON) {
      try {
        const result = await sweepReminders(env as CronEnv);
        console.warn("[cron] sweepReminders.ok", result);
        await recordHeartbeat(env, null);
      } catch (error) {
        const code =
          error instanceof SweepRemindersError ? error.code : "unknown";
        await recordHeartbeat(env, code);
        // Rethrown deliberately (unlike sweepAiParseAttempts below): a
        // failed reminders tick should surface as a failed Worker
        // invocation, visible to Cloudflare's own retry/alerting, not just
        // swallowed into this Worker's own logs — cron_heartbeat already
        // carries the bounded reason for anyone reading Settings.
        throw error;
      }
      return;
    }

    console.warn("[cron] sweep tick");

    // R2/Finding 11 closure: sweepAiParseAttempts() never throws (see its
    // own header) — it reduces every failure to `{ ok: false }` and logs the
    // failure itself via summarizeErrorForLog before returning, so a bad
    // tick here can never take down a later one. Only the row COUNT is
    // logged on success; the swept rows themselves carry PII (names,
    // schools, reference contact details) and are never logged.
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
