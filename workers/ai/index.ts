import { createWorkerApp } from "../shared/createApp";
import { requireAiEntitlement } from "../shared/aiEntitlementGate";

// E10/E11 (AI research assistant + diligence dossier) land here — AD-8
// (Cloudflare AI Gateway only, assistive, never judges compatibility). Every
// non-health route is gated by `requireAiEntitlement` (Story 11.1).
const app = createWorkerApp("ai");
app.use("*", requireAiEntitlement);

// 11.3: POST /dossier goes here, after the gate.

export default app;
