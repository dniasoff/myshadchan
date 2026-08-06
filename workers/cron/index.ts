import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";
import { sweepAiParseAttempts } from "./sweepAiParseAttempts";

// Story 12.2 ("Reminders", the pre-Amendment-A2 "E7") sweeps due/overdue
// tasks here; Story 7.5 ("Communication", the post-A2 Epic 7) sweeps queued
// message notifications here too — both land in the SAME cron Worker and the
// SAME scheduled() tick (see 7.5's Dev Notes, "The AD-13 'E7' naming trap",
// for why those two are easy to conflate and are not the same thing).
// NEITHER is wired yet: 7.5's own sweep (sweepMessages.ts) needs
// workers/shared/resend.ts, which is outside this story's declared file
// set — see this story's Completion Notes for the dependency this leaves
// open; 12.2's sweep is blocked on its own AC-4 backfill migration (see
// wrangler.toml's header comment). The one sweep that IS wired below is a
// third, unrelated one: R2 (Epic 11 external review, Finding 11 closure)
// calls sweepAiParseAttempts() (./sweepAiParseAttempts.ts) — a PII-retention
// TTL sweep over `ai_parse_attempts`, nothing to do with reminders or
// message notifications.
const app = createWorkerApp<BaseEnv>("cron");

// Story 7.5 (Task 6): the per-Worker Env extension pattern workers/shared/
// env.ts documents — VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are this Worker's
// own bindings, never added to BaseEnv. Declared now so the shape exists;
// wiring sweepMessages()/webPush.ts into scheduled() below is blocked on the
// same Task 4 dependency as the sweep itself.
export interface CronEnv extends BaseEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: BaseEnv,
    _ctx: ExecutionContext,
  ) {
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
