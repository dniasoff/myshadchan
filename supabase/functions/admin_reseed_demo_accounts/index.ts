import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

/**
 * Admin bulk reseed: clears and re-seeds every account flagged as `demo = true`.
 *
 * Safety layers:
 *  - Gated by `ADMIN_RESEED_SECRET` env var (Bearer token in Authorization).
 *  - Only processes rows where `accounts.demo = true`.
 *  - Reuses the existing `clear_demo` and `seed_demo` edge functions rather
 *    than duplicating their logic, so any future seed/clear changes apply here.
 *  - Operates via a temporary user that is added to one demo account at a time,
 *    removed immediately after that account is reseeded, and deleted at the end.
 *
 * Invoke with:
 *   curl -X POST https://<project-ref>.supabase.co/functions/v1/admin_reseed_demo_accounts \
 *     -H "Authorization: Bearer $ADMIN_RESEED_SECRET"
 *
 * The caller must set `ADMIN_RESEED_SECRET` in the Supabase project environment.
 * This function should be tested on staging before production use.
 */

const ADMIN_RESEED_SECRET = Deno.env.get("ADMIN_RESEED_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

interface AccountResult {
  accountId: number;
  accountKind: string;
  status: "ok" | "error";
  cleared?: boolean;
  seeded?: boolean;
  summary?: Record<string, unknown>;
  error?: string;
}

function roleForAccountKind(kind: string): string {
  return kind === "shadchanus" ? "shadchan" : "parent_admin";
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

async function createTempUser(): Promise<{
  id: string;
  email: string;
  password: string;
}> {
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

async function deleteTempUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      "admin_reseed_demo_accounts: failed to delete temp user:",
      error,
    );
  }
}

async function signInTempUser(
  email: string,
  password: string,
): Promise<string> {
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

async function addTempMembership(
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

async function removeTempMembership(membershipId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from("account_members")
    .delete()
    .eq("id", membershipId);
  if (error) {
    throw new Error(`failed to remove temp membership: ${error.message}`);
  }
}

async function setTempActiveAccount(
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

async function invokeFunction(
  name: "clear_demo" | "seed_demo",
  accessToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // The functions themselves fall back to SUPABASE_ANON_KEY if
      // SB_PUBLISHABLE_KEY is absent, but passing apikey keeps the header
      // self-contained and mirrors how userScopedClient constructs its client.
      apikey: SUPABASE_ANON_KEY,
    },
  });
  const body = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body);
  } catch {
    json = { raw: body };
  }
  if (!res.ok) {
    throw new Error(`${name} returned ${res.status}: ${body}`);
  }
  return json;
}

async function reseedAccount(
  accountId: number,
  accountKind: string,
  userId: string,
  accessToken: string,
): Promise<AccountResult> {
  let membershipId: number | undefined;
  try {
    membershipId = await addTempMembership(
      userId,
      accountId,
      roleForAccountKind(accountKind),
    );
    await setTempActiveAccount(userId, accountId);

    const cleared = await invokeFunction("clear_demo", accessToken);
    const seeded = await invokeFunction("seed_demo", accessToken);

    return {
      accountId,
      accountKind,
      status: "ok",
      cleared: cleared.cleared === true,
      seeded: seeded.seeded === true,
      summary: seeded as Record<string, unknown>,
    };
  } catch (e) {
    console.error(
      `admin_reseed_demo_accounts: account ${accountId} failed:`,
      e,
    );
    return {
      accountId,
      accountKind,
      status: "error",
      error: (e as Error).message,
    };
  } finally {
    if (membershipId != null) {
      try {
        await removeTempMembership(membershipId);
      } catch (e) {
        console.error(
          `admin_reseed_demo_accounts: failed to clean up membership ${membershipId}:`,
          e,
        );
      }
    }
  }
}

async function handleReseed(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  if (!ADMIN_RESEED_SECRET) {
    return createErrorResponse(500, "ADMIN_RESEED_SECRET is not configured");
  }
  if (getBearerToken(req) !== ADMIN_RESEED_SECRET) {
    return createErrorResponse(401, "Unauthorized");
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return createErrorResponse(500, "Missing Supabase environment variables");
  }

  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from("accounts")
    .select("id, kind")
    .eq("demo", true);
  if (accountsError) {
    return createErrorResponse(500, accountsError.message);
  }

  const accountList = (accounts ?? []) as Array<{ id: number; kind: string }>;
  if (accountList.length === 0) {
    return new Response(
      JSON.stringify({
        reseeded: [],
        message: "no demo-flagged accounts found",
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  let tempUser: { id: string; email: string; password: string } | undefined;
  const results: AccountResult[] = [];
  try {
    tempUser = await createTempUser();
    const accessToken = await signInTempUser(tempUser.email, tempUser.password);

    for (const account of accountList) {
      results.push(
        await reseedAccount(account.id, account.kind, tempUser.id, accessToken),
      );
    }
  } catch (e) {
    console.error("admin_reseed_demo_accounts: top-level failure:", e);
    return createErrorResponse(500, (e as Error).message);
  } finally {
    if (tempUser) {
      await deleteTempUser(tempUser.id);
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  return new Response(
    JSON.stringify({
      processed: accountList.length,
      succeeded: okCount,
      failed: accountList.length - okCount,
      results,
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) => handleReseed(req)),
);
