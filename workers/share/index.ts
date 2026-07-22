import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";

// E8 (Resume sharing) lands here — AD-9. This is the *only* Worker with an R2
// binding: recipients never get a raw R2 URL, every access is proxied and
// logged through here. Only the health route exists for now; the proxied
// stream + revoke/expiry checks + share_access_log write are future work.
export interface ShareEnv extends BaseEnv {
  MEDIA_BUCKET: R2Bucket;
}

const app = createWorkerApp<ShareEnv>("share");

export default app;
