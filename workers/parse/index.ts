import { createWorkerApp } from "../shared/createApp";
import { requireAiEntitlement } from "../shared/aiEntitlementGate";

// E5/E11 (resume auto-parse) land here — AD-6, AD-8, AD-12. Every non-health
// route is gated by `requireAiEntitlement` (Story 11.1).
const app = createWorkerApp("parse");
app.use("*", requireAiEntitlement);

// 11.2: POST /parse goes here, after the gate.

export default app;
