import { z } from "zod";
import type { Context, Hono } from "hono";
import { createWorkerApp } from "../shared/createApp";
import {
  requireAiEntitlement,
  type AiEntitlementVariables,
} from "../shared/aiEntitlementGate";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
} from "../shared/cors";
import { ok, fail } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import { deriveCallerKey, deriveIpKey } from "../shared/callerIdentity";
import {
  AI_WORKER_IP_RATE_LIMIT,
  DOSSIER_USER_RATE_LIMIT,
  createRateLimitMiddleware,
  type RateLimitEnforcementEnv,
} from "../shared/rateLimit";
import {
  createTracingMiddleware,
  type TracingVariables,
} from "../shared/requestTracing";
import type { ReferenceLinkSummary } from "../../src/components/atomic-crm/types";
import { buildCrossReferenceSummary } from "./dossierFacts";
import { deterministicNarrative } from "./dossierNarrator";

// Review fix (Finding 12): this worker no longer calls Claude — see
// dossierNarrator.ts's header comment for why the free-form narrator was
// deleted rather than repaired. `AiEnv` therefore no longer carries
// AI_GATEWAY_ACCOUNT_ID / AI_GATEWAY_ID / ANTHROPIC_API_KEY; nothing in this
// worker reads them any more.
//
// Story 11.4 (Finding 16): two Cloudflare `[[ratelimits]]` bindings
// (workers/ai/wrangler.toml) plus the deploy-time `RATE_LIMITING_ENFORCED`
// secret (`RateLimitEnforcementEnv`, workers/shared/rateLimit.ts) — see that
// module's header comment for the fail-closed/unconfigured distinction this
// flag exists to make.
export type AiEnv = BaseEnv &
  RateLimitEnforcementEnv & {
    AI_IP_RATE_LIMITER?: RateLimit;
    AI_USER_RATE_LIMITER?: RateLimit;
  };

type AiVariables = AiEntitlementVariables & TracingVariables;
type AiEnvContext = { Bindings: AiEnv; Variables: AiVariables };
type AiApp = Hono<AiEnvContext>;
type AiContext = Context<AiEnvContext>;

const DossierBodySchema = z.object({
  shidduchim_id: z.number(),
});

type DossierResponsePayload = {
  spokenToCount: number;
  outstandingCount: number;
  endorsementCount: number;
  reservationCount: number;
  covered: string[];
  gaps: string[];
  hasMixedSentiment: boolean;
  narrative: string;
};

/**
 * Build the AI worker app.
 */
export function createAiApp(): AiApp {
  // E10/E11 (AI research assistant + diligence dossier) land here — AD-8
  // (Cloudflare AI Gateway only, assistive, never judges compatibility). Every
  // non-health route is gated by `requireAiEntitlement` (Story 11.1).
  //
  // Review fix (Finding 1, P1): CORS MUST be registered before the
  // entitlement gate — see `workers/parse/index.ts`'s identical comment for
  // why. Without this, `callAiWorker()`'s preflight `OPTIONS` request (no
  // `Authorization` header) got 401'd by the gate before ever reaching
  // `hono/cors`, so the browser blocked every real POST and the diligence
  // dossier failed for every user, every time.
  const app = createWorkerApp<AiEnv>("ai") as unknown as AiApp;
  app.use(
    "*",
    createCorsMiddleware({
      origins: AI_WORKER_ALLOWED_ORIGINS,
      methods: ["POST"],
      allowHeaders: [...AI_WORKER_ALLOWED_HEADERS],
    }),
  );

  // Story 11.4 (Finding 16): tracing, then the pre-auth IP-scoped rate
  // limiter, THEN the entitlement gate, THEN the post-auth caller-scoped
  // rate limiter — see `workers/parse/index.ts`'s identical comment block
  // for the full ordering argument. This worker mirrors it exactly so the
  // two Workers never silently drift into two different orderings for one
  // policy.
  //
  //   - Tracing is registered right after CORS (never before it), so
  //     `hono/cors`'s own OPTIONS short-circuit — which never calls
  //     `next()` — means a preflight is never traced, rate-limited, or
  //     gated; only a real request reaches any of the three.
  //   - The IP-scoped limiter runs BEFORE `requireAiEntitlement`: it is a
  //     pre-auth backstop against unauthenticated flooding, so a scripted
  //     burst is refused with a cheap `binding.limit()` call before this
  //     route ever spends a Supabase RPC re-verifying entitlement (design
  //     Q1/limiterDesign).
  //   - The caller-scoped limiter runs AFTER the gate: its bucket key is the
  //     JWT `sub` (`deriveCallerKey`), and putting it before the gate would
  //     rate-limit by an unverified claim with no entitlement check behind
  //     it yet, and would lump every unauthenticated request into one shared
  //     "anonymous" bucket instead of a per-caller one.
  //   - `/health` is bypassed by both `createRateLimitMiddleware` and
  //     `requireAiEntitlement` internally — this ordering only decides what
  //     happens to routes that are NOT `/health`.
  app.use("*", createTracingMiddleware<AiEnvContext>("ai"));
  app.use(
    "*",
    createRateLimitMiddleware<AiEnvContext>({
      limiterName: "ai-ip",
      config: AI_WORKER_IP_RATE_LIMIT,
      getBinding: (env) => env.AI_IP_RATE_LIMITER,
      deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
      workerName: "ai",
      surface: "ai",
    }),
  );
  app.use("*", requireAiEntitlement);
  app.use(
    "*",
    createRateLimitMiddleware<AiEnvContext>({
      limiterName: "ai-user",
      config: DOSSIER_USER_RATE_LIMIT,
      getBinding: (env) => env.AI_USER_RATE_LIMITER,
      deriveKey: (c) => deriveCallerKey(c.req.header("Authorization")),
      workerName: "ai",
      surface: "ai",
    }),
  );

  // 11.3: POST /dossier — per-suggestion cross-reference summary + narrative.
  // Facts are computed from rows the caller-scoped client can see, and the
  // narrative is the deterministic sentence built from those same facts (see
  // dossierNarrator.ts's header comment — Finding 12 — for why this is no
  // longer a Claude call with a deterministic fallback, but the deterministic
  // narrative alone).
  app.post("/dossier", async (c: AiContext) => {
    // Review fix (Finding 5): decode JSON in its own try/catch before
    // handing the value to Zod — see `workers/parse/index.ts`'s identical
    // comment. The 400 body is a static string in both branches, never the
    // caught error, so a parser's internal message/stack trace is never
    // echoed back to the caller.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(fail("invalid request body"), 400);
    }
    const bodyResult = DossierBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json(fail("invalid request body"), 400);
    }
    const { shidduchim_id } = bodyResult.data;

    const supabase = c.get("supabaseCaller");

    // Review fix (Finding 16 follow-up, C1 — cross-role response-cache leak):
    // this route used to check an account-namespaced response cache here,
    // keyed on (accountId, shidduchim_id) alone. That key collided for two
    // members of the SAME account with DIFFERENT roles: `reference_links`'s
    // own RLS policy ("Reference links scoped to account",
    // supabase/schemas/05_policies.sql) denies the `single` role entirely,
    // but the cache had no idea a `single` and a `parent_admin` are different
    // viewers once they share an account id — so whichever caller populated
    // the cache first had their (privileged or empty) payload served
    // verbatim to the other for up to 120 seconds. There is no cache-key
    // dimension that fixes this without duplicating RLS's own membership
    // logic in the Worker (see this fix's design notes) and no cost
    // justifies that duplication: this query is a single indexed SELECT, not
    // an inference call. The cache is removed; RLS alone is now the only
    // thing that has to be correct for per-caller isolation, instead of RLS
    // AND a Worker-side cache key having to independently agree.
    const { data: links, error } = await supabase
      .from("reference_links_summary")
      .select("*")
      .eq("shidduchim_id", shidduchim_id);

    if (error) {
      return c.json(fail("failed to read reference links"), 500);
    }

    // Review fix (Finding 4): this used to special-case `links.length === 0`
    // with a hand-written zero-row object that hard-coded `gaps: []` —
    // disagreeing with what `buildCrossReferenceSummary` itself computes for
    // an empty corpus (every topic is a gap when nobody has been reached),
    // and the card rendered that empty list as "Every topic has been touched
    // on", the exact opposite of the truth. There is now exactly one path:
    // `buildCrossReferenceSummary` already handles an empty array correctly
    // (see its own "no reference links at all" test), so the empty case is
    // just this same call with `links` empty, not a special case.
    const facts = buildCrossReferenceSummary(
      (links ?? []) as unknown as ReferenceLinkSummary[],
    );

    const payload: DossierResponsePayload = {
      spokenToCount: facts.spokenTo.length,
      outstandingCount: facts.outstanding.length,
      endorsementCount: facts.endorsements.length,
      reservationCount: facts.reservations.length,
      covered: facts.covered.map((topic) => topic.label),
      gaps: facts.gaps.map((topic) => topic.label),
      hasMixedSentiment: facts.hasMixedSentiment,
      narrative: deterministicNarrative(facts),
    };

    c.set("traceOutcome", "fresh_dossier");

    return c.json(ok(payload), 200);
  });

  return app;
}

const app = createAiApp();
export default app;
