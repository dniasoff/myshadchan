import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";

// E7 (Reminders) lands here — AD-13. The scheduled handler sweeps due/overdue
// tasks and delivers in-app + email + push; only the health route and a
// logging stub exist for now.
const app = createWorkerApp<BaseEnv>("cron");

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
