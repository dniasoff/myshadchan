import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";

/**
 * Shared plumbing for every `ai_parse_attempts` RPC wrapper (`parseQuota.ts`,
 * `parseQuotaRecovery.ts`) — Findings 6/7/8/9/10/12 (Epic 11 adversarial
 * review). Kept in its own file so neither of those grows past the
 * ~400-line typical ceiling (coding-style.md) just to hold this shared
 * client/retry machinery.
 *
 * EXECUTE on every `ai_parse_attempts` RPC is granted to `service_role`
 * ONLY (never `authenticated`/`anon`) — see `06_grants.sql`. A caller-scoped
 * (`supabaseCaller`) client cannot invoke them; that is deliberate (a
 * SECURITY DEFINER function reachable from the browser could claim quota
 * under any `p_account_id`, not just the caller's own — cross-tenant DoS and
 * a data-injection vector via a forged `p_result`). This is why every
 * wrapper builds its OWN service-role client rather than reusing the
 * caller-scoped client `requireAiEntitlement` already stashed on the Hono
 * context, mirroring the same documented exception `workers/share/index.ts`
 * and `workers/ingest/serviceRoleClient.ts` use for calls `forAccount()`
 * cannot cover (there: no `account_id` yet to scope by; here: `forAccount()`
 * only wraps `.from(table)`, never `.rpc()`).
 */
export function getParseQuotaClient(env: BaseEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Findings 9/10 closure: `confirmParseAttempt()` / `releaseParseAttempt()`
 * retry ONLY a genuine RPC-level failure (network blip, transient database
 * error) — never a legitimate, successfully-parsed answer, "superseded"
 * included. Three attempts total: the first try, then one retry after each
 * of these delays. Kept short and bounded on purpose — this runs inline in
 * the HTTP response path, so an unbounded or lengthy retry would hold the
 * caller's connection open for no benefit; the caller already has a
 * correct, already-metered result to serve regardless of how this resolves
 * (see each function's own comment).
 */
export const RETRY_DELAYS_MS: readonly number[] = [200, 600];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
