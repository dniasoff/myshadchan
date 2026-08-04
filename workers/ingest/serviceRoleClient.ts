import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";

/**
 * Raw service-role client — bypasses RLS entirely. This is the documented
 * exception to `forAccount()` (AD-7; see `workers/share/index.ts`'s own
 * `getServiceRoleClient`, which this mirrors), used for exactly the
 * operations `forAccount()` cannot cover because no account_id is known yet
 * to scope by, or because the target isn't a `.from(table)` call at all:
 *
 *   - resolving WHICH account a recipient address belongs to
 *     (`resolveAccount.ts`) — the account_id doesn't exist until this
 *     resolves it
 *   - looking up a `members` row by email (`classifySender.ts`) — `members`
 *     carries no `account_id` column, so it cannot be scoped by
 *     `forAccount()` in a single query
 *   - Storage reads/writes (`attachments.ts`) — `forAccount()` only wraps
 *     `.from(table)`, never `.storage`
 *
 * Every tenant-TABLE read/write once the account_id is known goes through
 * `forAccount()` instead, never this client directly.
 */
export function getServiceRoleClient(env: BaseEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
