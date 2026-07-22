import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";

// E6 (Unified Inbox + channels) lands here — AD-6, AD-7. Every inbound channel
// creates an unfiled inbox_item and never writes straight to a suggestion; the
// email handler below is a stub for that rule until the inbox_item schema and
// postal-mime parsing land (separate future work).
const app = createWorkerApp<BaseEnv>("ingest");

export default {
  fetch: app.fetch,
  async email(
    message: ForwardableEmailMessage,
    _env: BaseEnv,
    _ctx: ExecutionContext,
  ) {
    console.warn(
      `[ingest/email] received message from ${message.from} to ${message.to}`,
    );
  },
};
