import { createWorkerApp } from "../shared/createApp";

// E5 (Auto-parse, OCR+LLM) lands here — AD-6, AD-8, AD-12. Only the health
// route exists for now; the AI Gateway call + Hebrew OCR pipeline is separate
// future work.
const app = createWorkerApp("parse");

export default app;
