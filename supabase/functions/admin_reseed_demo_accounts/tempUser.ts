import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { formatSupabaseError } from "./errorMessage.ts";
import type { CleanupResult, TempUser } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const TEMP_USER_SOURCE = "admin_reseed_demo_accounts";

type TempAuthUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};

async function listAllAuthUsers(): Promise<TempAuthUser[]> {
  const users: TempAuthUser[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error)
      throw new Error(`list Auth users failed: ${formatSupabaseError(error)}`);
    const pageUsers = (data?.users ?? []) as TempAuthUser[];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) return users;
  }
  throw new Error("list Auth users exceeded pagination safety limit");
}

async function recoverCreatedTempUser(email: string): Promise<string | null> {
  const users = await listAllAuthUsers();
  const matches = users.filter(
    (candidate) =>
      candidate.email?.toLowerCase() === email.toLowerCase() &&
      candidate.app_metadata?.source === TEMP_USER_SOURCE,
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

function isRetryableCreateUserError(error: unknown): boolean {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status = Number(candidate?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return false;
  if (Number.isFinite(status)) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  const detail = [candidate?.code, candidate?.name, candidate?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /abort|connection|fetch|network|retryable|timeout|transport/i.test(
    detail,
  );
}

function safeCreateUserError(
  prefix: string,
  error: unknown,
  email: string,
  password: string,
): Error {
  const detail = formatSupabaseError(error)
    .replaceAll(email, "[redacted email]")
    .replaceAll(password, "[redacted password]");
  return new Error(`${prefix}: ${detail}`);
}

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
  const createRequest = {
    email,
    password,
    email_confirm: true,
    // app_metadata is server-managed. It is the trusted reconciliation
    // marker; user_metadata is writable by the user and must not identify a
    // recovered maintenance account.
    app_metadata: { source: TEMP_USER_SOURCE },
  };
  let response: Awaited<ReturnType<typeof supabaseAdmin.auth.admin.createUser>>;
  try {
    response = await supabaseAdmin.auth.admin.createUser(createRequest);
  } catch (error) {
    // An explicit validation/auth response is authoritative and must never
    // trigger a broad Auth listing. Only a transport-like failure can have
    // committed the row while losing the response.
    if (!isRetryableCreateUserError(error)) {
      throw safeCreateUserError(
        "failed to create temp user",
        error,
        email,
        password,
      );
    }
    try {
      const recoveredId = await recoverCreatedTempUser(email);
      if (recoveredId) return { id: recoveredId, email, password };
    } catch (reconcileError) {
      console.error(
        "admin_reseed_demo_accounts: temp user response-loss reconciliation failed",
        reconcileError,
      );
    }
    throw safeCreateUserError(
      "failed to create temp user after response loss",
      error,
      email,
      password,
    );
  }
  const { data, error } = response;
  if (data?.user) {
    return { id: data.user.id, email, password };
  }

  // GoTrue can commit the user and lose the response. Reconcile only the
  // response-loss shape (no returned user and no API error), using both the
  // generated one-shot email and trusted app metadata so an unrelated user
  // can never become this iteration's cleanup handle.
  if (!error || isRetryableCreateUserError(error)) {
    try {
      const recoveredId = await recoverCreatedTempUser(email);
      if (recoveredId) return { id: recoveredId, email, password };
    } catch (reconcileError) {
      console.error(
        "admin_reseed_demo_accounts: temp user response-loss reconciliation failed",
        reconcileError,
      );
    }
  }

  if (error || !data?.user) {
    if (error) {
      throw safeCreateUserError(
        "failed to create temp user",
        error,
        email,
        password,
      );
    }
    throw new Error("failed to create temp user: no user returned");
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
