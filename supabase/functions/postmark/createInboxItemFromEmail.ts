import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import type { InboxItemRow } from "./buildInboxItemPayload.ts";

/**
 * Resolve the MyShadchan account for a forwarding user, keyed by their `members`
 * email → user_id → account_members. Returns null when the sender is not a
 * known user or belongs to no account (the webhook then refuses the capture,
 * rather than filing it into an arbitrary account).
 */
export async function resolveAccountIdForMemberEmail(
  memberEmail: string,
): Promise<number | null> {
  const { data: memberRow } = await supabaseAdmin
    .from("members")
    .select("user_id")
    .eq("email", memberEmail)
    .maybeSingle();
  if (!memberRow?.user_id) return null;

  const { data: membership } = await supabaseAdmin
    .from("account_members")
    .select("account_id")
    .eq("user_id", memberRow.user_id)
    .order("account_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  return membership?.account_id ?? null;
}

/**
 * Insert a captured email as an unresolved inbox item (service_role, so RLS is
 * bypassed and account_id must be set explicitly — done in the payload).
 */
export async function createInboxItemFromEmail(
  row: InboxItemRow,
): Promise<void> {
  const { error } = await supabaseAdmin.from("inbox_items").insert(row);
  if (error) {
    throw new Error(`Failed to file inbox item: ${error.message}`);
  }
}
