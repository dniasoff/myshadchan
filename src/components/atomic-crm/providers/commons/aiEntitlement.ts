import type { AiEntitlementInfo } from "../../types";

/**
 * The fail-closed default entitlement (E4). Both data providers return this when
 * the entitlement read fails or is unknown, so a broken read can never
 * accidentally unlock the paid AI surface — the free manual path is always the
 * safe fallback. It is also FakeRest's default (demo/free tier).
 *
 * This is a client-side DEFAULT only, never a grant: the real decision is always
 * the server's ai_entitlement() (02_functions.sql), which reads the SELECT-only
 * `subscription` table. There is no client path that flips this to entitled.
 */
export const UNENTITLED_AI: AiEntitlementInfo = {
  is_entitled: false,
  plan: "free",
  status: "none",
  resumes_used: 0,
  resumes_limit: 0,
};
