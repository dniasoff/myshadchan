import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import type { InboxItemRow } from "./buildInboxItemPayload.ts";

/**
 * Resolve the sender's HOUSEHOLD-kind account, keyed by their `members`
 * email -> user_id -> account_members. Capture is a household concern, never
 * a shadchanus one (AD-2: "a shadchanus context may never contain household
 * domain rows") — this is why the filter is `accounts.kind = 'household'`,
 * not merely "any membership".
 *
 * Since Epic 2 (AD-2) a member may hold a household membership AND a
 * shadchanus membership at once, and — separately, family shape 4 — a
 * household member may hold TWO household memberships (e.g. a parent who is
 * also a `helper` in a sibling's household). Returns the account_id only
 * when EXACTLY ONE household-kind membership exists:
 *   - zero (not a known user, or every membership is shadchanus-kind) ->
 *     null, the existing 403 upstream.
 *   - two-plus -> null too, logged. Per AD-6, an ambiguous inbound email is
 *     flagged, never auto-picked (AD-19's arbitrary-selection anti-pattern
 *     is exactly what the old `.order(...).limit(1)` reintroduced the
 *     moment multi-context membership became possible). A refused capture
 *     is recoverable from inside the app; a mis-filed one crosses an
 *     account boundary and is not.
 */
export async function resolveHouseholdAccountIdForMemberEmail(
  memberEmail: string,
): Promise<number | null> {
  const { data: memberRow } = await supabaseAdmin
    .from("members")
    .select("user_id")
    .eq("email", memberEmail)
    .maybeSingle();
  if (!memberRow?.user_id) return null;

  const { data: memberships } = await supabaseAdmin
    .from("account_members")
    .select("account_id, accounts!inner(kind)")
    .eq("user_id", memberRow.user_id)
    .eq("accounts.kind", "household")
    .eq("status", "active");

  if (!memberships || memberships.length === 0) return null;

  if (memberships.length > 1) {
    console.error(
      "postmark: sender holds more than one household membership — refusing rather than guessing",
      { memberEmail, accountIds: memberships.map((m) => m.account_id) },
    );
    return null;
  }

  return memberships[0].account_id;
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
