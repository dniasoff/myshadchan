import { createWorkerApp } from "../shared/createApp";

// E10 (AI research assistant) lands here — AD-8 (Cloudflare AI Gateway only,
// assistive, never judges compatibility). Only the health route exists for now.
const app = createWorkerApp("ai");

export default app;
