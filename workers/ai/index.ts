import { z } from "zod";
import type { Hono } from "hono";
import { createWorkerApp } from "../shared/createApp";
import { requireAiEntitlement } from "../shared/aiEntitlementGate";
import type { AiEntitlementVariables } from "../shared/aiEntitlementGate";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
} from "../shared/cors";
import { ok, fail } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import type { ReferenceLinkSummary } from "../../src/components/atomic-crm/types";
import { buildCrossReferenceSummary } from "./dossierFacts";
import { deterministicNarrative } from "./dossierNarrator";

// Review fix (Finding 12): this worker no longer calls Claude — see
// dossierNarrator.ts's header comment for why the free-form narrator was
// deleted rather than repaired. `AiEnv` therefore no longer carries
// AI_GATEWAY_ACCOUNT_ID / AI_GATEWAY_ID / ANTHROPIC_API_KEY; nothing in this
// worker reads them any more.
export type AiEnv = BaseEnv;

type AiApp = Hono<{ Bindings: AiEnv; Variables: AiEntitlementVariables }>;

const DossierBodySchema = z.object({
  shidduchim_id: z.number(),
});

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
  app.use("*", requireAiEntitlement);

  // 11.3: POST /dossier — per-suggestion cross-reference summary + narrative.
  // Facts are computed from rows the caller-scoped client can see, and the
  // narrative is the deterministic sentence built from those same facts (see
  // dossierNarrator.ts's header comment — Finding 12 — for why this is no
  // longer a Claude call with a deterministic fallback, but the deterministic
  // narrative alone).
  app.post("/dossier", async (c) => {
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

    return c.json(
      ok({
        spokenToCount: facts.spokenTo.length,
        outstandingCount: facts.outstanding.length,
        endorsementCount: facts.endorsements.length,
        reservationCount: facts.reservations.length,
        covered: facts.covered.map((topic) => topic.label),
        gaps: facts.gaps.map((topic) => topic.label),
        hasMixedSentiment: facts.hasMixedSentiment,
        narrative: deterministicNarrative(facts),
      }),
      200,
    );
  });

  return app;
}

const app = createAiApp();
export default app;
