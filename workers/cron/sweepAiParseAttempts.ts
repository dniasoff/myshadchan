import { createClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";

/**
 * R2 (Epic 11 external review, Finding 11 closure): calls
 * `public.sweep_expired_ai_parse_attempts()` (supabase/schemas/02_functions.sql)
 * so the age-based TTL half of Finding 11 actually runs. The function itself
 * was already correct and SQL-tested before this file existed — what was
 * missing was a caller. `ai_parse_attempts.result` holds a full extracted
 * draft (names, parents, schools, synagogues, locations, reference names and
 * phone numbers); this sweep is the only thing that ever removes that draft
 * for an inbox item that is resolved and KEPT (never deleted, so the
 * `on delete cascade` FK never fires for it).
 *
 * `sweep_expired_ai_parse_attempts()` is `SECURITY DEFINER`, granted to
 * `service_role` only (`06_grants.sql`) and revoked from `public`/`anon`/
 * `authenticated`. It is account-agnostic maintenance — it deletes rows
 * across every tenant by age, not by any single account_id — so
 * `forAccount()` (AD-7's scoped client, `workers/shared/forAccount.ts`)
 * does not apply here: that helper exists to inject/assert an `account_id`
 * predicate, and this operation has none to inject. A direct service-role
 * client calling the RPC is the correct shape, mirroring
 * `workers/ingest/serviceRoleClient.ts`'s own `getServiceRoleClient()` (see
 * that file's header for the same AD-7 reasoning) and `workers/share/index.ts`'s
 * private helper of the same name — each Worker keeps its own local copy
 * rather than importing across a Worker boundary, matching this repo's
 * existing per-Worker isolation.
 *
 * `noTenantTableAccess.guard.test.ts` (Story 7.5 AC-10, adopted into this
 * Worker by 12-2's AC-7 ruling) forbids a direct Supabase table-query call
 * (the SDK's `from` method, chained with an open paren) anywhere under
 * `workers/cron/**`, non-test files — this module only ever calls the `rpc`
 * method, never a table query, so it does not trip that guard. (Deliberately
 * not spelled out here as the literal method-call substring the guard's own
 * blunt scan matches on — see that guard's own header for why webPush.ts had
 * to be reworded the same way.)
 *
 * Never throws: every failure path (RPC-level error, an unexpected return
 * shape, a network-level throw) is caught here and reduced to `{ ok: false }`
 * via `summarizeErrorForLog` — the caller (`scheduled()`) can log the outcome
 * and move on without risking an uncaught rejection disabling future ticks.
 */

export type SweepAiParseAttemptsResult =
  { ok: true; deleted: number } | { ok: false };

function getServiceRoleClient(env: BaseEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function sweepAiParseAttempts(
  env: BaseEnv,
): Promise<SweepAiParseAttemptsResult> {
  try {
    const { data, error } = await getServiceRoleClient(env).rpc(
      "sweep_expired_ai_parse_attempts",
    );

    if (error) {
      console.error(
        "cron.sweepAiParseAttempts.rpcError",
        summarizeErrorForLog(error),
      );
      return { ok: false };
    }

    if (typeof data !== "number") {
      // The function's documented return type is `integer` — a shape drift
      // here (e.g. `null`) is a genuine defect, not a PII concern in itself,
      // but the value is unknown-shaped so it is never logged raw.
      console.error("cron.sweepAiParseAttempts.unexpectedShape", {
        dataType: typeof data,
      });
      return { ok: false };
    }

    return { ok: true, deleted: data };
  } catch (error) {
    console.error(
      "cron.sweepAiParseAttempts.threw",
      summarizeErrorForLog(error),
    );
    return { ok: false };
  }
}
