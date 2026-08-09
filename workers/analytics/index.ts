import { z } from "zod";
import { Hono } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ok, fail } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import { createTracingMiddleware } from "../shared/requestTracing";
import { createRateLimitMiddleware } from "../shared/rateLimit";
import { forAccount } from "../shared/forAccount";
import { securityHeaders } from "../shared/securityHeaders";
import { AnalyticsEventSchema } from "../../src/components/atomic-crm/analytics/types";

export type AnalyticsEnv = BaseEnv & {
  RATE_LIMITING_ENFORCED?: string;
  ANALYTICS_RATE_LIMITER?: RateLimit;
};

type AnalyticsVariables = {
  requestId: string;
  traceOutcome?: string;
};

type AnalyticsEnvContext = {
  Bindings: AnalyticsEnv;
  Variables: AnalyticsVariables;
};

const EventsBatchSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(100),
});

function createSupabaseClient(env: BaseEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function createAnalyticsApp(): Hono<AnalyticsEnvContext> {
  const app = new Hono<AnalyticsEnvContext>();

  app.use("*", securityHeaders);
  app.get("/health", (c) => c.json(ok({ worker: "analytics", status: "ok" })));

  app.use("*", createTracingMiddleware<AnalyticsEnvContext>("analytics"));
  app.use(
    "*",
    createRateLimitMiddleware<AnalyticsEnvContext>({
      limiterName: "analytics-events",
      config: { limit: 100, periodSeconds: 60 },
      getBinding: (env) => env.ANALYTICS_RATE_LIMITER,
      deriveKey: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
    }),
  );

  app.post("/events", async (c) => {
    const accountId = c.req.header("X-Account-ID");
    if (!accountId) {
      return c.json(fail("missing account context"), 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(fail("invalid request body"), 400);
    }

    const bodyResult = EventsBatchSchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json(fail("invalid request body"), 400);
    }

    const { events } = bodyResult.data;
    const client = forAccount(accountId, c.env);

    const rows = events.map((event) => ({
      account_id: parseInt(accountId, 10),
      event_type: event.event_type,
      properties: event.properties,
      created_at: event.created_at ?? new Date().toISOString(),
    }));

    const { error } = await client.from("analytics_events").insert(rows);
    if (error) {
      console.error("analytics.events.insert.error", {
        accountId,
        error: error.message,
      });
      return c.json(fail("failed to store events"), 500);
    }

    c.set("traceOutcome", "events_stored");
    return c.json(ok({ stored: rows.length }), 200);
  });

  app.get("/metrics", async (c) => {
    const accountId = c.req.header("X-Account-ID");
    if (!accountId) {
      return c.json(fail("missing account context"), 400);
    }

    const client = forAccount(accountId, c.env);
    const supabase = createSupabaseClient(c.env);

    const [
      summaryResult,
      crossAccountResult,
      misroutedResult,
      duplicateResult,
      trialResult,
      aiCostResult,
    ] = await Promise.all([
      client.from("analytics_events_summary").select("*").single(),
      supabase.rpc("cross_account_leak_reports"),
      supabase.rpc("misrouted_channel_items"),
      supabase.rpc("duplicate_flag_false_positive_rate"),
      supabase.rpc("trial_to_paid_conversion"),
      supabase.rpc("ai_cost_per_active_family"),
    ]);

    if (summaryResult.error) {
      console.error("analytics.metrics.summary.error", {
        accountId,
        error: summaryResult.error.message,
      });
      return c.json(fail("failed to read metrics"), 500);
    }

    c.set("traceOutcome", "metrics_served");
    return c.json(
      ok({
        summary: summaryResult.data,
        counterMetrics: {
          cross_account_leak_reports: crossAccountResult.data ?? 0,
          misrouted_channel_items: misroutedResult.data ?? 0,
          duplicate_flag_false_positive_rate: duplicateResult.data ?? 0,
          trial_to_paid_conversion: trialResult.data ?? 0,
          ai_cost_per_active_family: aiCostResult.data ?? 0,
        },
      }),
      200,
    );
  });

  return app;
}

const app = createAnalyticsApp();
export default app;
