import { createWorkerApp } from "../shared/createApp";

// E4 (dating history + duplicate detection) lands here — AD-5, AD-12. Only the
// health route exists for now; matchIdentity() itself is separate future work.
const app = createWorkerApp("match");

export default app;
