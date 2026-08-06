import { z } from "zod";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import {
  RETRY_DELAYS_MS,
  delay,
  getParseQuotaClient,
} from "./parseQuotaClient";

/**
 * The two "give the reservation back" RPC wrappers — split out of
 * `parseQuota.ts` once claim+confirm alone pushed it well past the
 * ~400-line typical ceiling (coding-style.md). See `parseQuota.ts`'s own
 * header comment for the full Findings 6/7/8/9/10/12 picture; this file
 * covers Findings 10 (`releaseParseAttempt`) and 12's escape hatch
 * (`forceReclaimParseAttempt`) specifically.
 */

// Mirrors release_ai_parse_attempt()'s documented jsonb return shape
// (02_functions.sql) — unchanged by Finding 8/12, still just "applied" or
// "superseded".
const ReleaseOutcomeSchema = z.object({
  outcome: z.enum(["applied", "superseded"]),
});

export type ReleaseAttemptOutcome =
  { outcome: "applied" } | { outcome: "superseded" } | { outcome: "failed" };

/**
 * Give back a reservation that will not produce a result (oversized
 * attachment, download failure, extractor throw) so the account is not left
 * charged for a parse it never received. Retries a genuine RPC-level
 * failure the same bounded way `confirmParseAttempt()` does (Finding 10
 * closure) — a `"failed"` result here means the charge was NOT given back;
 * `index.ts`'s `releaseAndFail()` logs that loudly rather than swallowing
 * it, and `claim_ai_parse_attempt()`'s own opportunistic reaper
 * (`02_functions.sql`) self-heals a permanently stuck reservation the next
 * time this account calls `/parse` at all, at latest 15 minutes later.
 *
 * `generation` MUST be the value `claimParseAttempt()` returned for this
 * attempt (review Finding C2) — see `confirmParseAttempt()`'s comment
 * (`parseQuota.ts`) for why a "superseded" outcome is benign, not an error.
 * This is what closes interleaving (b): a release carrying a SUPERSEDED
 * generation can never decrement `ai_usage` for a reservation a newer
 * generation is still legitimately holding.
 */
export async function releaseParseAttempt(
  env: BaseEnv,
  accountId: number,
  attemptId: number,
  generation: number,
): Promise<ReleaseAttemptOutcome> {
  const client = getParseQuotaClient(env);
  const totalAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    let rpcResult: { data: unknown; error: unknown } | undefined;
    try {
      rpcResult = await client.rpc("release_ai_parse_attempt", {
        p_account_id: accountId,
        p_attempt_id: attemptId,
        p_generation: generation,
      });
    } catch (error) {
      console.error(
        "parse.releaseParseAttempt.threw",
        summarizeErrorForLog(error),
      );
    }
    if (rpcResult && !rpcResult.error) {
      const parsed = ReleaseOutcomeSchema.safeParse(rpcResult.data);
      if (!parsed.success) {
        console.error(
          "parse.releaseParseAttempt.unexpectedShape",
          summarizeErrorForLog(parsed.error),
        );
        return { outcome: "failed" };
      }
      if (parsed.data.outcome === "superseded") {
        console.warn("parse.releaseParseAttempt.superseded", {
          accountId,
          attemptId,
          generation,
        });
      }
      return parsed.data;
    }
    if (rpcResult?.error) {
      console.error(
        "parse.releaseParseAttempt.rpcError",
        summarizeErrorForLog(rpcResult.error),
      );
    }
    if (attempt < totalAttempts) {
      await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  return { outcome: "failed" };
}

// Mirrors force_reclaim_ai_parse_attempt()'s documented jsonb return shape
// (02_functions.sql, Finding 12 closure).
const ForceReclaimOutcomeSchema = z.union([
  z.object({ outcome: z.literal("reclaimed"), generation: z.number() }),
  z.object({ outcome: z.literal("not_reclaimable") }),
]);

export type ForceReclaimOutcome = z.infer<typeof ForceReclaimOutcomeSchema>;

export type ForceReclaimResult =
  { ok: true; outcome: ForceReclaimOutcome } | { ok: false };

/**
 * Finding 12 closure: escape hatch for the rare case a replayed result's
 * `result_schema_version` matches the Worker's own current version (so
 * `claim_ai_parse_attempt()`'s own version gate already let it through as a
 * "replay") but the `result` itself still fails this Worker's own Zod
 * re-validation — genuine data corruption (a manual edit, a bug), not
 * version drift. Does NOT touch `ai_usage`: this is the platform's own
 * bug/corruption, never a cost the account should bear. See
 * `resolveParseClaim.ts` for how the "reclaimed" outcome is used to
 * continue the request as an ordinary fresh claim.
 */
export async function forceReclaimParseAttempt(
  env: BaseEnv,
  accountId: number,
  attemptId: number,
): Promise<ForceReclaimResult> {
  try {
    const { data, error } = await getParseQuotaClient(env).rpc(
      "force_reclaim_ai_parse_attempt",
      { p_account_id: accountId, p_attempt_id: attemptId },
    );
    if (error) {
      console.error(
        "parse.forceReclaimParseAttempt.rpcError",
        summarizeErrorForLog(error),
      );
      return { ok: false };
    }
    const parsed = ForceReclaimOutcomeSchema.safeParse(data);
    if (!parsed.success) {
      console.error(
        "parse.forceReclaimParseAttempt.unexpectedShape",
        summarizeErrorForLog(parsed.error),
      );
      return { ok: false };
    }
    return { ok: true, outcome: parsed.data };
  } catch (error) {
    console.error(
      "parse.forceReclaimParseAttempt.threw",
      summarizeErrorForLog(error),
    );
    return { ok: false };
  }
}
