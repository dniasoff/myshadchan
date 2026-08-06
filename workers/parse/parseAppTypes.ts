import type { Context, Hono } from "hono";
import type { AiEntitlementVariables } from "../shared/aiEntitlementGate";
import type { BaseEnv } from "../shared/env";
import type { RateLimitEnforcementEnv } from "../shared/rateLimit";
import type { TracingVariables } from "../shared/requestTracing";
import type { ParseEnv } from "./resumeExtractor";

/**
 * Shared Hono context typing for the parse worker — split out of `index.ts`
 * so `registerParseMiddleware.ts` and `index.ts` can both reference the
 * exact same context shape without a circular import between them.
 */

// Story 11.4 (Finding 16): two Cloudflare `[[ratelimits]]` bindings
// (workers/parse/wrangler.toml) plus the deploy-time `RATE_LIMITING_ENFORCED`
// secret (`RateLimitEnforcementEnv`, workers/shared/rateLimit.ts) — see that
// module's header comment for the fail-closed/unconfigured distinction this
// flag exists to make.
export type ParseBindings = BaseEnv &
  ParseEnv &
  RateLimitEnforcementEnv & {
    PARSE_IP_RATE_LIMITER?: RateLimit;
    PARSE_USER_RATE_LIMITER?: RateLimit;
  };
export type ParseVariables = AiEntitlementVariables & TracingVariables;
export type ParseEnvContext = {
  Bindings: ParseBindings;
  Variables: ParseVariables;
};
export type ParseApp = Hono<ParseEnvContext>;
export type ParseContext = Context<ParseEnvContext>;
