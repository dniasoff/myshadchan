import type { BaseEnv } from "../shared/env";
import { claimParseAttempt } from "./parseQuota";
import { forceReclaimParseAttempt } from "./parseQuotaRecovery";
import {
  CURRENT_PARSE_RESULT_SCHEMA_VERSION,
  ParseResultPayloadSchema,
  type ParseResultPayload,
} from "./parseResultPayload";

/**
 * Findings 6/8/10/12 (Epic 11 adversarial review) closure: resolves
 * `claim_ai_parse_attempt()` all the way to either a final answer (a replay
 * payload, a refusal) or a claimed reservation the route should proceed to
 * download/extract/confirm for. Framework-agnostic on purpose — no Hono
 * `Context` here — `index.ts` maps a `ClaimResolution` to an HTTP response;
 * this module only ever decides WHAT the answer is.
 *
 * Finding 6: there is no cap pre-check anywhere upstream of this module
 * (removed from `index.ts` entirely) — `claim_ai_parse_attempt()` is the
 * SOLE cap authority. Its own "replay" and stale-in_progress-reclaim
 * branches both return before `v_limit` is ever consulted, so a replay and
 * a stale reclaim both succeed at ANY usage level, including exactly at the
 * cap; only a genuinely NEW reservation ever checks it, and that check
 * belongs entirely to the RPC — never duplicated here.
 *
 * Finding 12: a "replay" outcome from the RPC is guaranteed, by the SQL
 * side's own `result_schema_version` gate, to be at-or-ahead of the version
 * this Worker just asked for — a version MISMATCH never reaches here at all
 * (the RPC serves it as a free re-claim instead). What CAN still reach here
 * is genuine data corruption: the SAME version, but a `result` that fails
 * THIS Worker's own Zod re-validation anyway (a manual edit, a bug in a
 * previous release). That is rare enough to warrant its own escape hatch
 * (`force_reclaim_ai_parse_attempt()`, `parseQuota.ts`) rather than looping
 * the ordinary claim path, which would just keep agreeing the row looks
 * fine.
 */

// A `force_reclaim` "not_reclaimable" result means a concurrent request
// already resolved the row out from under this one — re-claiming once more
// should settle it. A SECOND not-reclaimable in a row would mean a live,
// persistent race far outside anything this rare corruption path is meant
// to absorb; fail closed rather than loop indefinitely.
const MAX_CLAIM_ATTEMPTS = 2;

export type ClaimResolution =
  | { kind: "claim_error" }
  | { kind: "cap_reached" }
  | { kind: "conflict"; attemptId: number }
  | { kind: "replay"; payload: ParseResultPayload }
  | { kind: "claimed"; attemptId: number; generation: number };

export async function resolveParseClaim(
  env: BaseEnv,
  accountId: number,
  inboxItemId: number,
  attachmentPath: string,
): Promise<ClaimResolution> {
  for (
    let attemptNumber = 1;
    attemptNumber <= MAX_CLAIM_ATTEMPTS;
    attemptNumber++
  ) {
    const claim = await claimParseAttempt(
      env,
      accountId,
      inboxItemId,
      attachmentPath,
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );
    if (!claim.ok) {
      return { kind: "claim_error" };
    }
    if (claim.outcome.outcome === "cap_reached") {
      return { kind: "cap_reached" };
    }
    if (claim.outcome.outcome === "conflict") {
      return { kind: "conflict", attemptId: claim.outcome.attempt_id };
    }
    if (claim.outcome.outcome === "claimed") {
      return {
        kind: "claimed",
        attemptId: claim.outcome.attempt_id,
        generation: claim.outcome.generation,
      };
    }

    // "replay" — guaranteed current-version by the SQL side's own gate (see
    // header comment); re-validate the SHAPE as defense-in-depth.
    const validated = ParseResultPayloadSchema.safeParse(claim.outcome.result);
    if (validated.success) {
      return { kind: "replay", payload: validated.data };
    }

    // Same-version corruption (Finding 12) — never the caller's fault, and
    // never charged to them (`force_reclaim_ai_parse_attempt()` does not
    // touch `ai_usage`). Flip the row back to reclaimable and try again.
    console.error("parse.resolveParseClaim.replayCorrupted", {
      accountId,
      attemptId: claim.outcome.attempt_id,
    });
    const reclaim = await forceReclaimParseAttempt(
      env,
      accountId,
      claim.outcome.attempt_id,
    );
    if (!reclaim.ok) {
      return { kind: "claim_error" };
    }
    if (reclaim.outcome.outcome === "reclaimed") {
      // Same shape as an ordinary fresh claim — the route proceeds through
      // download/extract/confirm exactly as it would for any "claimed"
      // outcome, with no special-casing needed downstream.
      return {
        kind: "claimed",
        attemptId: claim.outcome.attempt_id,
        generation: reclaim.outcome.generation,
      };
    }
    // "not_reclaimable" — a concurrent request already resolved this row;
    // loop and claim again (bounded by MAX_CLAIM_ATTEMPTS above).
  }

  return { kind: "claim_error" };
}
