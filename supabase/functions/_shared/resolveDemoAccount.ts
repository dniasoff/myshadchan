import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

/**
 * Resolves the CALLER'S OWN account_id from their active account_members
 * row — never from anything the request supplies. Shared by seed_demo and
 * clear_demo so both demo-data functions always resolve tenancy the same
 * way; a future change to the resolution rule (e.g. once multi-account
 * membership is real and the target account must come from an explicit,
 * membership-validated parameter instead of "first active") only needs to
 * happen here.
 */
export async function resolveAccountId(userId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("id")
    .limit(1)
    .maybeSingle();
  return data?.account_id ?? null;
}

/**
 * A client scoped to the caller's own JWT, so RLS (not application code)
 * confines every query it makes to current_account_id().
 */
export function userScopedClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    },
  );
}
