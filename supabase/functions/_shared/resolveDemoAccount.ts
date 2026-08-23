import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

/**
 * Resolves the CALLER'S OWN active context from the server-held
 * member_state.active_account_id, validates that the pointer still names an
 * active membership, then maps a companion context to its bundle root. The
 * request never supplies an account id. This is intentionally different from
 * selecting the first membership: a customer can clear/reseed while
 * previewing any registered companion context.
 */
export async function resolveAccountId(userId: string): Promise<number | null> {
  const { data: state, error: stateError } = await supabaseAdmin
    .from("member_state")
    .select("active_account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (stateError || state?.active_account_id == null) return null;

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .eq("account_id", state.active_account_id)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || membership?.account_id == null) return null;

  const accountId = membership.account_id;
  if (accountId == null) return null;

  // A customer may clear/reseed while previewing a companion context. The
  // manifest is the authority for the bundle root. A lookup error is not
  // equivalent to an ordinary account: clear_demo is destructive, so a
  // transport/RPC failure must fail closed rather than re-open the legacy
  // account-wide wipe.
  const { data: rootAccountId, error } = await supabaseAdmin.rpc(
    "demo_root_account_for",
    { p_account_id: accountId },
  );
  if (error) return null;
  // A successful NULL means this validated active context is an ordinary
  // root with no unfinished demo run. Keep the first-seed path usable; only
  // malformed non-NULL data is a resolver failure.
  if (rootAccountId == null) return accountId;

  const candidate =
    typeof rootAccountId === "number"
      ? rootAccountId
      : typeof rootAccountId === "string" && /^\d+$/.test(rootAccountId)
        ? Number(rootAccountId)
        : null;
  if (candidate == null || !Number.isSafeInteger(candidate)) return null;
  return candidate;
}

export type UnfinishedDemoRun = {
  id: number;
  status: string;
  updated_at: string;
};

/** The manifest is a retry handle, so seed preflight must see failed runs as
 * well as runs that are still in progress. */
export async function findUnfinishedDemoRun(
  rootAccountId: number,
): Promise<UnfinishedDemoRun | null> {
  const { data, error } = await supabaseAdmin
    .from("demo_runs")
    .select("id, status, updated_at")
    .eq("root_account_id", rootAccountId)
    .in("status", ["seeding", "active", "clearing", "failed"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`failed to inspect unfinished demo run: ${error.message}`);
  }
  return data
    ? {
        id: data.id as number,
        status: data.status as string,
        updated_at: data.updated_at as string,
      }
    : null;
}

/**
 * A client scoped to the caller's own JWT, so RLS (not application code)
 * confines every query it makes to current_context_id().
 */
export function userScopedClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    // Hosted edge functions only auto-inject SUPABASE_ANON_KEY; SB_PUBLISHABLE_KEY
    // is a local-.env-only name, so it is empty on hosted and the user-scoped
    // client would then send no apikey and 401 on every RLS query. Fall back.
    Deno.env.get("SB_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      "",
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    },
  );
}
