import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { getErrorMessage } from "./errorMessage.ts";
import { reseedAccount } from "./reseedAccount.ts";
import { timingSafeEqual } from "./timingSafeEqual.ts";
import type { AccountResult } from "./types.ts";

/**
 * Admin bulk reseed: clears and re-seeds every account flagged as `demo = true`.
 *
 * Safety layers:
 *  - Gated by `ADMIN_RESEED_SECRET` env var (Bearer token in Authorization),
 *    compared in constant time (timingSafeEqual.ts).
 *  - Only processes rows where `accounts.demo = true`.
 *  - Reuses the existing `clear_demo` and `seed_demo` edge functions rather
 *    than duplicating their logic, so any future seed/clear changes apply here.
 *  - Operates via a BRAND-NEW temp user PER ACCOUNT (tempUser.ts), never one
 *    temp user reused across accounts. That is what makes cross-account
 *    misdirection structurally impossible: `resolveAccountId`
 *    (supabase/functions/_shared/resolveDemoAccount.ts) resolves "first
 *    active membership by id" for a given user id, so a leftover active
 *    membership row from a botched cleanup can only ever belong to a user id
 *    no later account's iteration will ever reuse. reseedAccount.ts also
 *    independently confirms the resolved account before touching anything,
 *    as defense in depth.
 *  - clear_demo -> seed_demo is not transactional (a crash between them
 *    leaves an account wiped but unseeded); invokeDemoFunction.ts retries the
 *    whole pair once, and any account left in that state is reported via
 *    `dataState: "wiped_unseeded"` in the response rather than silently
 *    reported as a success.
 *
 * Invoke with:
 *   curl -X POST https://<project-ref>.supabase.co/functions/v1/admin_reseed_demo_accounts \
 *     -H "Authorization: Bearer $ADMIN_RESEED_SECRET"
 *
 * The caller must set `ADMIN_RESEED_SECRET` in the Supabase project environment.
 * This function should be tested on staging before production use.
 */

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function isAuthorized(req: Request, expectedSecret: string): boolean {
  const token = getBearerToken(req);
  // Never short-circuit on a null token by comparing against it directly —
  // route both the "missing header" and "wrong secret" cases through the
  // same constant-time comparison path.
  return timingSafeEqual(token ?? "", expectedSecret);
}

interface ReseedSummary {
  processed: number;
  succeeded: number;
  // Every account that did NOT end this run fully re-seeded — the sum of
  // skipped + errored. Kept as its own field (rather than only exposing the
  // breakdown) because .github/workflows/reseed-demo-accounts.yml gates its
  // job on `failed !== 0`; a skipped account must fail that gate exactly
  // like an errored one, since neither left the account re-seeded.
  failed: number;
  skipped: number;
  errored: number;
  // Accounts whose temp membership row and/or temp auth user could not be
  // torn down — a hygiene issue for an operator to clean up manually, never
  // a sign the account's own data is wrong.
  cleanupWarnings: number;
  // Accounts left cleared but not re-seeded (clear_demo -> seed_demo is not
  // transactional) — currently EMPTY and needing a manual re-seed.
  wipedUnseeded: number;
  results: AccountResult[];
}

function summarize(processed: number, results: AccountResult[]): ReseedSummary {
  const succeeded = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errored = results.filter((r) => r.status === "error").length;
  const cleanupWarnings = results.filter((r) => r.cleanupWarning).length;
  const wipedUnseeded = results.filter(
    (r) => r.dataState === "wiped_unseeded",
  ).length;

  return {
    processed,
    succeeded,
    failed: skipped + errored,
    skipped,
    errored,
    cleanupWarnings,
    wipedUnseeded,
    results,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Read HERE — inside the request handler, not at module scope — mirrors
// postmark/index.ts's `readWebhookSecrets`: a missing/rotated secret then
// produces a per-request, log-visible 500 instead of an import-time
// snapshot, and it is what lets tests drive different secrets per case
// without reloading the module.
export async function handleReseed(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  const adminSecret = Deno.env.get("ADMIN_RESEED_SECRET") ?? "";
  if (!adminSecret) {
    return createErrorResponse(500, "ADMIN_RESEED_SECRET is not configured");
  }
  if (!isAuthorized(req, adminSecret)) {
    return createErrorResponse(401, "Unauthorized");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
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
    return jsonResponse({
      ...summarize(0, []),
      message: "no demo-flagged accounts found",
    });
  }

  // Sequential, not Promise.all: each account gets its own freshly-created
  // temp user (tempUser.ts / reseedAccount.ts), so accounts are already
  // isolated from each other's state. Sequential execution here is about not
  // hammering auth.admin.createUser and the demo functions concurrently, not
  // about correctness.
  const results: AccountResult[] = [];
  for (const account of accountList) {
    try {
      results.push(await reseedAccount(account.id, account.kind));
    } catch (e) {
      // reseedAccount is designed to always catch its own failures and
      // return an AccountResult rather than throw — this branch only runs
      // on a genuine bug in that contract, and exists so such a bug still
      // isolates to one account's result instead of 500ing the whole run
      // and losing every account already processed.
      console.error(
        `admin_reseed_demo_accounts: unexpected failure processing account ${account.id}:`,
        e,
      );
      results.push({
        accountId: account.id,
        accountKind: account.kind,
        status: "error",
        dataState: "unknown",
        cleared: false,
        seeded: false,
        error: getErrorMessage(e),
      });
    }
  }

  return jsonResponse(summarize(accountList.length, results));
}

// The real Deno Edge Runtime is the only production caller of Deno.serve —
// guarded so importing this module under Vitest (which stubs Deno.env.get
// but does not provide Deno.serve) can exercise `handleReseed` directly
// without crashing at import time. Never true in the real Edge Runtime.
// Mirrors clear_demo/index.ts and postmark/index.ts.
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    OptionsMiddleware(req, (req) => handleReseed(req)),
  );
} else {
  console.error(
    "admin_reseed_demo_accounts: Deno.serve is unavailable — no request handler registered; this function will not receive any traffic",
  );
}
