import { z } from "zod";

import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import {
  RETRY_DELAYS_MS,
  delay,
  getParseQuotaClient,
} from "./parseQuotaClient";

/**
 * Service-role wrappers for the re-read ledger. The ledger is deliberately
 * separate from `ai_parse_attempts`: the latter is keyed to an inbox item and
 * must remain byte-for-byte compatible with the original parse path.
 */

const ClaimOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("reserved"),
    attempt_id: z.number(),
    generation: z.number(),
  }),
  z.object({
    outcome: z.literal("replayed"),
    attempt_id: z.number(),
    generation: z.number(),
  }),
  z.object({
    outcome: z.literal("in_progress"),
    attempt_id: z.number(),
    generation: z.number(),
  }),
  z.object({
    outcome: z.literal("busy"),
    attempt_id: z.number(),
    generation: z.number(),
  }),
  z.object({ outcome: z.literal("no_allowance") }),
  z.object({ outcome: z.literal("not_entitled") }),
]);

export type RereadClaimOutcome = z.infer<typeof ClaimOutcomeSchema>;

export async function claimRereadAttempt(
  env: BaseEnv,
  accountId: number,
  resumeId: number,
  requestId: string,
  schemaVersion: number,
): Promise<{ ok: true; outcome: RereadClaimOutcome } | { ok: false }> {
  const client = getParseQuotaClient(env);
  const totalAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const { data, error } = await client.rpc("claim_ai_reread_attempt", {
        p_account_id: accountId,
        p_resume_id: resumeId,
        p_request_id: requestId,
        p_current_schema_version: schemaVersion,
      });
      if (!error) {
        const parsed = ClaimOutcomeSchema.safeParse(data);
        if (parsed.success) return { ok: true, outcome: parsed.data };
        console.error(
          "parse.claimRereadAttempt.unexpectedShape",
          summarizeErrorForLog(parsed.error),
        );
        return { ok: false };
      }
      console.error(
        "parse.claimRereadAttempt.rpcError",
        summarizeErrorForLog(error),
      );
    } catch (error) {
      console.error(
        "parse.claimRereadAttempt.threw",
        summarizeErrorForLog(error),
      );
    }
    if (attempt < totalAttempts) await delay(RETRY_DELAYS_MS[attempt - 1]);
  }

  return { ok: false };
}

const FencedOutcomeSchema = z.object({
  outcome: z.enum(["applied", "superseded"]),
});

export type RereadFencedOutcome =
  { outcome: "applied" } | { outcome: "superseded" } | { outcome: "failed" };

async function fencedRereadRpc(
  env: BaseEnv,
  functionName: "complete_ai_reread_attempt" | "release_ai_reread_attempt",
  accountId: number,
  attemptId: number,
  generation: number,
  schemaVersion?: number,
): Promise<RereadFencedOutcome> {
  const client = getParseQuotaClient(env);
  const totalAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const args = {
        p_account_id: accountId,
        p_attempt_id: attemptId,
        p_generation: generation,
        ...(schemaVersion === undefined
          ? {}
          : { p_schema_version: schemaVersion }),
      };
      const { data, error } = await client.rpc(functionName, args);
      if (!error) {
        const parsed = FencedOutcomeSchema.safeParse(data);
        if (parsed.success) return parsed.data;
        console.error(
          `parse.${functionName}.unexpectedShape`,
          summarizeErrorForLog(parsed.error),
        );
        return { outcome: "failed" };
      }
      console.error(
        `parse.${functionName}.rpcError`,
        summarizeErrorForLog(error),
      );
    } catch (error) {
      console.error(`parse.${functionName}.threw`, summarizeErrorForLog(error));
    }
    if (attempt < totalAttempts) await delay(RETRY_DELAYS_MS[attempt - 1]);
  }

  return { outcome: "failed" };
}

export function completeRereadAttempt(
  env: BaseEnv,
  accountId: number,
  attemptId: number,
  generation: number,
  schemaVersion: number,
): Promise<RereadFencedOutcome> {
  return fencedRereadRpc(
    env,
    "complete_ai_reread_attempt",
    accountId,
    attemptId,
    generation,
    schemaVersion,
  );
}

export function releaseRereadAttempt(
  env: BaseEnv,
  accountId: number,
  attemptId: number,
  generation: number,
): Promise<RereadFencedOutcome> {
  return fencedRereadRpc(
    env,
    "release_ai_reread_attempt",
    accountId,
    attemptId,
    generation,
  );
}
