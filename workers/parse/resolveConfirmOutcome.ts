import type { ConfirmAttemptOutcome } from "./parseQuota";
import {
  CURRENT_PARSE_RESULT_SCHEMA_VERSION,
  ParseResultPayloadSchema,
  type ParseResultPayload,
} from "./parseResultPayload";

/**
 * Findings 8/9/12 (Epic 11 adversarial review) closure: turns
 * `confirmParseAttempt()`'s outcome into a decision `index.ts` can respond
 * to. Framework-agnostic on purpose (no Hono `Context`), same reasoning as
 * `resolveParseClaim.ts` — split out once this branching, inline in
 * `index.ts`, pushed that file past the ~400-line typical ceiling
 * (coding-style.md).
 */
export type ConfirmResolution =
  | { kind: "applied" }
  // Finding 8 closure: the WINNING generation already finished and its
  // (re-validated — Finding 12) result rides along, so both concurrent
  // callers converge on the SAME durable answer instead of this caller's
  // own now-orphaned draft.
  | { kind: "superseded_replay"; payload: ParseResultPayload }
  // The winner has nothing trustworthy to offer yet (still in progress,
  // failed, or — the rare case — its own result failed re-validation).
  | { kind: "superseded_conflict" }
  // Finding 9 closure: every retry exhausted, never durably confirmed. The
  // caller still has a correct, already-metered draft to serve — see
  // `index.ts` for why this is `ok(...)`, not a failure response.
  | { kind: "unconfirmed" };

export function resolveConfirmOutcome(
  outcome: ConfirmAttemptOutcome,
): ConfirmResolution {
  if (outcome.outcome === "applied") {
    return { kind: "applied" };
  }

  if (outcome.outcome === "failed") {
    return { kind: "unconfirmed" };
  }

  // "superseded"
  if (outcome.status === "completed") {
    const validated = ParseResultPayloadSchema.safeParse(outcome.result);
    if (
      validated.success &&
      outcome.resultSchemaVersion === CURRENT_PARSE_RESULT_SCHEMA_VERSION
    ) {
      return { kind: "superseded_replay", payload: validated.data };
    }
  }
  return { kind: "superseded_conflict" };
}
