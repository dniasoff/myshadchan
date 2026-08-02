import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";

// Story 12.2 ("Reminders", the pre-Amendment-A2 "E7") sweeps due/overdue
// tasks here; Story 7.5 ("Communication", the post-A2 Epic 7) sweeps queued
// message notifications here too — both land in the SAME cron Worker and the
// SAME scheduled() tick (see 7.5's Dev Notes, "The AD-13 'E7' naming trap",
// for why those two are easy to conflate and are not the same thing). Only
// the health route and this logging stub exist for now: 7.5's own sweep
// (sweepMessages.ts) needs workers/shared/resend.ts, which is outside this
// story's declared file set — see this story's Completion Notes for the
// dependency this leaves open.
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
    _env: BaseEnv,
    _ctx: ExecutionContext,
  ) {
    console.warn("[cron] sweep tick");
  },
};
