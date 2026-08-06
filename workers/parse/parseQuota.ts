import { z } from "zod";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import {
  RETRY_DELAYS_MS,
  delay,
  getParseQuotaClient,
} from "./parseQuotaClient";

/**
 * Atomic quota reservation + idempotency for `POST /parse` (Epic 11
 * adversarial review, Findings 6/7/8/9/10/12 closure).
 *
 * Replaces two things that used to live directly in `index.ts`:
 *
 *  - Finding 6/7: a read-modify-write `ai_usage` increment, run AFTER
 *    inference, with every one of its four database calls' errors ignored —
 *    a caller could repeatedly spend inference with the monthly meter never
 *    durably advancing, and two concurrent requests could both observe
 *    allowance remaining and both spend past the cap.
 *  - Finding 8 (the part the Workers Cache API layer, `parseIdempotency.ts`,
 *    could not close — see its own header comment, deleted along with this
 *    change): `caches.default` has no compare-and-set, so two truly
 *    simultaneous requests for the same attachment could both miss and both
 *    call the model.
 *
 * `claim_ai_parse_attempt()` (`supabase/schemas/02_functions.sql`) makes the
 * idempotency check and the quota reservation ONE atomic, SECURITY DEFINER
 * database operation, keyed on the `ai_parse_attempts` table's unique
 * `(account_id, inbox_item_id, attachment_path)` constraint. It is called
 * BEFORE any download or inference — see `index.ts` — so a 200 response is
 * now structurally impossible unless the reservation was already durably
 * recorded. Finding 6 closure (review, second pass): the ADVISORY pre-check
 * that used to run ahead of this call in `index.ts` is gone entirely —
 * `claim_ai_parse_attempt()`'s own `v_limit` check is the sole cap
 * authority; see `resolveParseClaim.ts` and `index.ts` for why a pre-check
 * blocked exactly the two free-cost paths (replay, stale reclaim) this RPC
 * exists to provide even at the cap.
 *
 * Finding 9 closure (review, second pass): `confirmParseAttempt()` used to
 * be fire-and-forget — every failure branch logged and returned `void`, so
 * the caller could never tell "durably applied" from "silently lost". It
 * now returns a real, inspectable outcome, and retries a genuine RPC-level
 * failure (network blip, transient database error) a bounded number of
 * times before giving up — see `parseQuotaClient.ts`'s `RETRY_DELAYS_MS`. A
 * legitimate, successfully-parsed `"superseded"` answer is never retried;
 * only an actual RPC error or a thrown exception is. `releaseParseAttempt()`
 * (Finding 10) and `forceReclaimParseAttempt()` (Finding 12's escape hatch)
 * live in `parseQuotaRecovery.ts` — split out once claim+confirm alone
 * pushed this file well past the ~400-line typical ceiling
 * (coding-style.md).
 *
 * Finding 12 closure: `claimParseAttempt()` now takes the Worker's own
 * `CURRENT_PARSE_RESULT_SCHEMA_VERSION` (`parseResultPayload.ts`) as an
 * explicit parameter, and `confirmParseAttempt()` stamps it onto every
 * result it writes — see that constant's own header comment for why a
 * version mismatch is handled as a free re-claim, never a charge.
 */

// Mirrors claim_ai_parse_attempt()'s documented jsonb return shape exactly
// (02_functions.sql). Validated with Zod rather than cast: this crosses a
// PostgREST/JSON boundary, and typescript.md requires narrowing untrusted
// API responses rather than trusting their shape blindly.
//
// `generation` (review Finding C2) is present ONLY on "claimed" — that is
// the one outcome that hands the caller ownership of a reservation it must
// later confirm/release, and confirm/release now REQUIRE the generation
// they were given to still match the row's current value. "replay" already
// returns the final cached result and never confirms/releases, so it does
// not need one.
//
// `result_schema_version` (Finding 12 closure) is present on "replay" only —
// the SQL side already refuses to serve a replay whose version is behind
// the caller's own `p_current_result_schema_version` (it flips the row back
// to a free "claimed" reclaim instead), so a "replay" the Worker sees here
// is guaranteed to be at-or-ahead of the version it just asked for.
const ClaimOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("claimed"),
    attempt_id: z.number(),
    generation: z.number(),
  }),
  z.object({
    outcome: z.literal("replay"),
    attempt_id: z.number(),
    result: z.unknown(),
    result_schema_version: z.number(),
  }),
  z.object({ outcome: z.literal("conflict"), attempt_id: z.number() }),
  z.object({ outcome: z.literal("cap_reached") }),
]);

export type ClaimOutcome = z.infer<typeof ClaimOutcomeSchema>;

export type ClaimAttemptResult =
  | { ok: true; outcome: ClaimOutcome }
  // The RPC itself failed (network, permission, database error) or returned
  // a shape this Worker does not recognize — the caller MUST fail closed
  // (Finding 16): no download, no inference, no 200.
  | { ok: false };

/**
 * Atomically reserve this month's usage for one (account, inbox item,
 * attachment), or discover it was already reserved/claimed/exhausted. See
 * `ClaimOutcome` for the possible outcomes and `resolveParseClaim.ts` for
 * how each maps to a route response.
 *
 * `currentResultSchemaVersion` MUST be the Worker's own
 * `CURRENT_PARSE_RESULT_SCHEMA_VERSION` (`parseResultPayload.ts`) — see
 * that constant's header comment for what it gates (Finding 12).
 */
export async function claimParseAttempt(
  env: BaseEnv,
  accountId: number,
  inboxItemId: number,
  attachmentPath: string,
  currentResultSchemaVersion: number,
): Promise<ClaimAttemptResult> {
  try {
    const { data, error } = await getParseQuotaClient(env).rpc(
      "claim_ai_parse_attempt",
      {
        p_account_id: accountId,
        p_inbox_item_id: inboxItemId,
        p_attachment_path: attachmentPath,
        p_current_result_schema_version: currentResultSchemaVersion,
      },
    );
    if (error) {
      console.error(
        "parse.claimParseAttempt.rpcError",
        summarizeErrorForLog(error),
      );
      return { ok: false };
    }
    const parsed = ClaimOutcomeSchema.safeParse(data);
    if (!parsed.success) {
      console.error(
        "parse.claimParseAttempt.unexpectedShape",
        summarizeErrorForLog(parsed.error),
      );
      return { ok: false };
    }
    return { ok: true, outcome: parsed.data };
  } catch (error) {
    console.error("parse.claimParseAttempt.threw", summarizeErrorForLog(error));
    return { ok: false };
  }
}

// Mirrors confirm_ai_parse_attempt()'s documented jsonb return shape
// (02_functions.sql, Finding 8 closure): the "superseded" branch now tells
// the caller what actually happened to the WINNING generation instead of a
// bare `{"outcome":"superseded"}` — if the winner already completed, its
// `result`/`result_schema_version` ride along; if it is still working,
// there is nothing final to offer yet and only `status` comes back. Two
// object shapes under the same "superseded" literal (not a
// `discriminatedUnion`, which requires a unique literal per branch) — a
// plain `z.union` tries each in order, which is fine at this size.
const ConfirmOutcomeSchema = z.union([
  z.object({ outcome: z.literal("applied") }),
  z.object({
    outcome: z.literal("superseded"),
    status: z.literal("completed"),
    result: z.unknown(),
    result_schema_version: z.number(),
  }),
  z.object({
    outcome: z.literal("superseded"),
    status: z.enum(["in_progress", "failed"]),
  }),
]);

/**
 * `confirmParseAttempt()`'s result. Findings 8/9 closure:
 *  - `"applied"`: this call durably wrote the result.
 *  - `"superseded"` with `status: "completed"`: a NEWER generation already
 *    finished and its `result`/`resultSchemaVersion` are attached — the
 *    caller can serve THAT (the one future replays will actually return)
 *    instead of its own, never-replayable draft.
 *  - `"superseded"` with `status: "in_progress" | "failed"`: a newer
 *    generation exists but has nothing final yet — the caller has nothing
 *    durable to offer.
 *  - `"failed"`: every retry exhausted without a durable answer either way
 *    — see `index.ts` for how this is surfaced (never silently swallowed).
 */
export type ConfirmAttemptOutcome =
  | { outcome: "applied" }
  | {
      outcome: "superseded";
      status: "completed";
      result: unknown;
      resultSchemaVersion: number;
    }
  | { outcome: "superseded"; status: "in_progress" | "failed" }
  | { outcome: "failed" };

function toConfirmAttemptOutcome(
  data: z.infer<typeof ConfirmOutcomeSchema>,
  logContext: { accountId: number; attemptId: number; generation: number },
): ConfirmAttemptOutcome {
  if (data.outcome === "applied") {
    return { outcome: "applied" };
  }
  // "superseded" (Finding 8 closure): expected, not an error — a newer
  // generation already reclaimed this row. Logged at `warn`, never
  // `error`, since nothing was corrupted and nothing needs operator
  // attention beyond visibility.
  console.warn("parse.confirmParseAttempt.superseded", {
    ...logContext,
    status: data.status,
  });
  if (data.status === "completed") {
    return {
      outcome: "superseded",
      status: "completed",
      result: data.result,
      resultSchemaVersion: data.result_schema_version,
    };
  }
  return { outcome: "superseded", status: data.status };
}

/**
 * Mark a claimed attempt completed and cache its result for future replay.
 * Does NOT touch `ai_usage` — the spend already happened, durably, inside
 * `claimParseAttempt()`, so a failure here can never desynchronize "the
 * user got a result" from "the meter reflects that spend" (Findings 6/7's
 * invariant). What it CAN desynchronize is narrower: whether a future
 * replay/retry of this exact key sees the result at all — see
 * `parseQuotaClient.ts`'s `RETRY_DELAYS_MS` and `index.ts`'s handling of the
 * `"failed"` outcome for what happens when even the bounded retry can't
 * land it.
 *
 * `generation` MUST be the value `claimParseAttempt()` returned for this
 * attempt (review Finding C2). `resultSchemaVersion` MUST be the Worker's
 * own `CURRENT_PARSE_RESULT_SCHEMA_VERSION` (`parseResultPayload.ts`).
 */
export async function confirmParseAttempt(
  env: BaseEnv,
  accountId: number,
  attemptId: number,
  generation: number,
  result: unknown,
  resultSchemaVersion: number,
): Promise<ConfirmAttemptOutcome> {
  const client = getParseQuotaClient(env);
  const totalAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    let rpcResult: { data: unknown; error: unknown } | undefined;
    try {
      rpcResult = await client.rpc("confirm_ai_parse_attempt", {
        p_account_id: accountId,
        p_attempt_id: attemptId,
        p_generation: generation,
        p_result: result,
        p_result_schema_version: resultSchemaVersion,
      });
    } catch (error) {
      console.error(
        "parse.confirmParseAttempt.threw",
        summarizeErrorForLog(error),
      );
    }
    if (rpcResult && !rpcResult.error) {
      const parsed = ConfirmOutcomeSchema.safeParse(rpcResult.data);
      if (!parsed.success) {
        // A malformed response is deterministic for this input — retrying
        // it would not help, unlike a transient RPC-level failure.
        console.error(
          "parse.confirmParseAttempt.unexpectedShape",
          summarizeErrorForLog(parsed.error),
        );
        return { outcome: "failed" };
      }
      return toConfirmAttemptOutcome(parsed.data, {
        accountId,
        attemptId,
        generation,
      });
    }
    if (rpcResult?.error) {
      console.error(
        "parse.confirmParseAttempt.rpcError",
        summarizeErrorForLog(rpcResult.error),
      );
    }
    if (attempt < totalAttempts) {
      await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  return { outcome: "failed" };
}
