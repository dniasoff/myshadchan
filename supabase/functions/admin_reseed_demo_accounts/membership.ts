import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import type { CleanupResult } from "./types.ts";

export function roleForAccountKind(kind: string): string {
  return kind === "shadchanus" ? "shadchan" : "parent_admin";
}

export async function addTempMembership(
  userId: string,
  accountId: number,
  role: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("account_members")
    .insert({
      account_id: accountId,
      user_id: userId,
      role,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`failed to add temp membership: ${error?.message}`);
  }
  return data.id;
}

/**
 * Best-effort cleanup — never throws. This used to throw and have its
 * caller swallow the error in a `finally` block, which let a failed removal
 * leave a stale `active` membership row behind with no visible trace: the
 * next account's resolve-then-operate lookup for a DIFFERENT user id can
 * never pick this row up (it is scoped to this user id only, see
 * tempUser.ts), but the row itself would otherwise leak silently forever.
 * The caller now surfaces this result via `AccountResult.cleanupWarning`.
 */
export async function removeTempMembership(
  membershipId: number,
): Promise<CleanupResult> {
  const { error } = await supabaseAdmin
    .from("account_members")
    .delete()
    .eq("id", membershipId);
  return error
    ? {
        ok: false,
        error: `failed to remove temp membership ${membershipId}: ${error.message}`,
      }
    : { ok: true };
}

export async function setTempActiveAccount(
  userId: string,
  accountId: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("member_state")
    .upsert({ user_id: userId, active_account_id: accountId });
  if (error) {
    throw new Error(`failed to set active account: ${error.message}`);
  }
}
