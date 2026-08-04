import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { formatSupabaseError } from "./errorMessage.ts";
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
    throw new Error(
      `failed to create temp user: ${
        error ? formatSupabaseError(error) : "no user returned"
      }`,
    );
  }
  return { id: data.user.id, email, password };
}

/**
 * Deletes the `public.members` row `handle_new_user()`'s `on_auth_user_created`
 * trigger (04_triggers.sql) created for this temp user the moment
 * `createTempUser()` inserted its `auth.users` row.
 *
 * This is the root cause of the leaked-temp-user production defect: every
 * `admin_reseed_demo_accounts` run left exactly this row behind, and
 * `members_user_id_fkey` (01_tables.sql) declares no `on delete` action —
 * Postgres defaults that to `NO ACTION`/RESTRICT. So `auth.admin.deleteUser`
 * below was, unconditionally and on every single run, attempting to delete
 * an `auth.users` row a `public.members` row still referenced — a
 * foreign-key violation, not a transient failure. GoTrue turns any
 * database-level error into a 5xx response, which is exactly the error
 * class `formatSupabaseError`'s doc comment describes losing its message to
 * "{}" upstream. Deleting this row first removes the referencing row before
 * the `auth.users` delete is even attempted, so the FK never fires.
 *
 * No other table has a real foreign key to `public.members(id)` (see the
 * `01_tables.sql` comment on `tasks.member_id` — deliberately FK-less), so
 * this delete cannot itself cascade into anything else.
 */
async function deleteTempUserMembersRow(
  userId: string,
): Promise<CleanupResult> {
  const { error } = await supabaseAdmin
    .from("members")
    .delete()
    .eq("user_id", userId);
  return error
    ? {
        ok: false,
        error: `failed to remove members row for temp user ${userId}: ${formatSupabaseError(error)}`,
      }
    : { ok: true };
}

/**
 * Best-effort cleanup after the account this temp user was scoped to has
 * already been processed — never throws. A failure here leaves an orphaned
 * auth user (a hygiene issue an operator must clean up manually) but cannot
 * cause misdirection, because no later iteration ever reuses this user id.
 * The caller surfaces the returned failure (via `AccountResult.cleanupWarning`)
 * rather than this function swallowing it.
 *
 * Removes the trigger-created `public.members` row FIRST — see
 * `deleteTempUserMembersRow`'s own comment for why skipping this step made
 * `auth.admin.deleteUser` fail on every run, not just occasionally. If that
 * removal itself fails, `auth.admin.deleteUser` is never attempted: it would
 * only repeat the same foreign-key violation, so surfacing the members-row
 * failure directly is the more actionable diagnostic.
 */
export async function deleteTempUser(userId: string): Promise<CleanupResult> {
  const membersRowCleanup = await deleteTempUserMembersRow(userId);
  if (!membersRowCleanup.ok) return membersRowCleanup;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  return error
    ? {
        ok: false,
        error: `failed to delete temp user ${userId}: ${formatSupabaseError(error)}`,
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
