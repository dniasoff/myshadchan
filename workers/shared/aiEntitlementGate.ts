import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import type { AiEntitlementInfo } from "../../src/components/atomic-crm/types";
import type { BaseEnv } from "./env";
import { fail } from "./envelope";

/**
 * Request-scoped Hono variables set by `requireAiEntitlement` after a
 * successful entitlement check. Downstream routes read both values via
 * `c.get(...)` instead of re-deriving them (AD-16/AD-17).
 */
export type AiEntitlementVariables = {
  supabaseCaller: SupabaseClient;
  aiEntitlement: AiEntitlementInfo;
};

/**
 * Build a caller-scoped Supabase client from the forwarded Authorization
 * header and the Worker's publishable key. This client respects Postgres RLS
 * exactly like the SPA: PostgREST verifies the JWT, sets `role=authenticated`,
 * and `current_context_id()` scopes every row. It is deliberately NOT the
 * service-role client used by `forAccount()` (AD-7).
 */
export function createCallerClient(
  authHeader: string,
  env: BaseEnv,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

/**
 * Hono middleware that re-runs `public.ai_entitlement()` server-side before any
 * AI-calling route spends inference budget. The client-side `useAiEntitlement`
 * hook is a UI hint only; this gate is the authority.
 *
 * - `/health` is always ungated.
 * - Missing Authorization header -> 401.
 * - RPC error or `is_entitled !== true` -> 402 (fail-closed, calm).
 * - Success -> stashes the caller-scoped client and entitlement payload on
 *   Hono context for downstream handlers.
 */
export const requireAiEntitlement: MiddlewareHandler<{
  Bindings: BaseEnv;
  Variables: AiEntitlementVariables;
}> = async (c, next) => {
  if (c.req.path === "/health") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(fail("missing Authorization header"), 401);
  }

  const client = createCallerClient(authHeader, c.env);
  const { data, error } = await client.rpc("ai_entitlement");
  if (error || !data || data.is_entitled !== true) {
    return c.json(fail("not entitled"), 402);
  }

  c.set("supabaseCaller", client);
  c.set("aiEntitlement", data as AiEntitlementInfo);
  return next();
};
