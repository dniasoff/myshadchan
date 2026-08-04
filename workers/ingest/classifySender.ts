import { forAccount } from "../shared/forAccount";
import { getServiceRoleClient } from "./serviceRoleClient";
import type { BaseEnv } from "../shared/env";

export type SenderClassification = "known" | "unknown";

/**
 * Classify a sender against exactly ONE resolved account — never globally.
 * A sender is "known" when EITHER:
 *   - they are an ACTIVE member of THAT household (`members.email` ->
 *     `user_id` -> `account_members`, mirroring the Postmark path's own
 *     two-step lookup in `createInboxItemFromEmail.ts`: `members` carries no
 *     `account_id` column, so this half cannot be scoped by `forAccount()`
 *     in a single query the way `trusted_senders` can), OR
 *   - they have a `trusted_senders` row for THAT account.
 *
 * Both checks are explicitly scoped to `accountId`. A member of a DIFFERENT
 * account, or a `trusted_senders` row belonging to a DIFFERENT account, must
 * never make a sender "known" for this one — that cross-tenant boundary is
 * what `index.test.ts`'s security regression test exists to guard.
 *
 * An unknown sender is never a failure: the caller stores the item with
 * `status: 'held'` rather than rejecting the message.
 */
export async function classifySender(
  senderEmail: string,
  accountId: number,
  env: BaseEnv,
): Promise<SenderClassification> {
  const isMember = await isActiveMemberOfAccount(senderEmail, accountId, env);
  if (isMember) return "known";

  const isTrusted = await isTrustedSenderForAccount(
    senderEmail,
    accountId,
    env,
  );
  return isTrusted ? "known" : "unknown";
}

async function isActiveMemberOfAccount(
  senderEmail: string,
  accountId: number,
  env: BaseEnv,
): Promise<boolean> {
  // Step 1: members carries no account_id column at all, so this lookup is
  // necessarily unscoped — it only ever yields a user_id, never a decision
  // about account membership by itself.
  const { data: memberRow } = await getServiceRoleClient(env)
    .from("members")
    .select("user_id")
    .eq("email", senderEmail)
    .maybeSingle();
  const userId = (memberRow as { user_id: string } | null)?.user_id;
  if (!userId) return false;

  // Step 2: THE scoping step — forAccount() injects/asserts account_id, so
  // this can only ever match a membership row for THIS account (AD-7).
  const { data: membership } = await forAccount(String(accountId), env)
    .from("account_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return !!membership;
}

async function isTrustedSenderForAccount(
  senderEmail: string,
  accountId: number,
  env: BaseEnv,
): Promise<boolean> {
  const { data } = await forAccount(String(accountId), env)
    .from("trusted_senders")
    .select("id")
    .eq("email", senderEmail)
    .maybeSingle();

  return !!data;
}
