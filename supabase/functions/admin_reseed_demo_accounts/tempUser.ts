import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import type { CleanupResult, TempUser } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * Creates a brand-new, single-use auth user for exactly one account's
 * clear+seed cycle. A fresh identity per account — rather than reusing one
 * temp user across every account in the run — is what makes cross-account
 * misdirection structurally impossible: `resolveAccountId`
 * (supabase/functions/_shared/resolveDemoAccount.ts) resolves "first active
 * membership by id" FOR THIS USER ID, so a leftover membership row from a
 * botched cleanup can only ever belong to a user id no later iteration will
 * ever reuse — it cannot be picked up by a different account's resolve
 * call, however that leftover row came to exist.
 */
export async function createTempUser(): Promise<TempUser> {
  const password = crypto.randomUUID() + crypto.randomUUID();
  const email = `demo-reseed-${crypto.randomUUID()}@atomic-crm-demo.internal`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "admin_reseed_demo_accounts" },
  });
  if (error || !data.user) {
    throw new Error(`failed to create temp user: ${error?.message}`);
  }
  return { id: data.user.id, email, password };
}

/**
 * Best-effort cleanup after the account this temp user was scoped to has
 * already been processed — never throws. A failure here leaves an orphaned
 * auth user (a hygiene issue an operator must clean up manually) but cannot
 * cause misdirection, because no later iteration ever reuses this user id.
 * The caller surfaces the returned failure (via `AccountResult.cleanupWarning`)
 * rather than this function swallowing it.
 */
export async function deleteTempUser(userId: string): Promise<CleanupResult> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  return error
    ? {
        ok: false,
        error: `failed to delete temp user ${userId}: ${error.message}`,
      }
    : { ok: true };
}

export async function signInTempUser(
  email: string,
  password: string,
): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "missing SUPABASE_URL/SUPABASE_ANON_KEY environment variables",
    );
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`temp user sign-in failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("temp user sign-in response missing access_token");
  }
  return accessToken;
}
