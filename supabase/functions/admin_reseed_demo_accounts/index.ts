import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { getErrorMessage } from "./errorMessage.ts";
import { reseedAccount } from "./reseedAccount.ts";
import { timingSafeEqual } from "./timingSafeEqual.ts";
import type { AccountResult } from "./types.ts";

/**
 * Admin bulk reseed: clears and re-seeds every demo root, including roots
 * whose retained failed run has already restored `accounts.demo = false`.
 *
 * Safety layers:
 *  - Gated by `ADMIN_RESEED_SECRET` env var (Bearer token in Authorization),
 *    compared in constant time (timingSafeEqual.ts).
 *  - Processes flagged roots plus every root of an unfinished manifest run;
 *    a retained failed run is itself the cleanup/reseed handle.
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

type DemoAccountRow = { id: number; kind: string };
type DemoRunRow = { id: number; root_account_id: number; status: string };
type DemoRunAccountRow = { account_id: number; run_id: number };

/**
 * Enumerates the reseed set once and normalizes any accidental demo flag on a
 * companion context back to its manifest root. Legacy demo accounts without a
 * manifest remain valid roots. The resulting list is de-duplicated before any
 * destructive clear+seed attempt starts.
 */
async function enumerateDemoRoots(): Promise<DemoAccountRow[]> {
  const { data: demoAccounts, error: accountError } = await supabaseAdmin
    .from("accounts")
    .select("id, kind")
    .eq("demo", true);
  if (accountError) throw accountError;

  const flaggedAccounts = (demoAccounts ?? []) as DemoAccountRow[];
  const { data: runs, error: runError } = await supabaseAdmin
    .from("demo_runs")
    .select("id, root_account_id, status")
    .in("status", ["seeding", "active", "clearing", "failed"]);
  if (runError) throw runError;
  const activeRuns = (runs ?? []) as DemoRunRow[];
  const runIds = [...new Set(activeRuns.map((run) => run.id))];

  const manifestRows: DemoRunAccountRow[] = [];
  if (runIds.length > 0) {
    const { data: runAccounts, error: runAccountError } = await supabaseAdmin
      .from("demo_run_accounts")
      .select("account_id, run_id")
      .in("run_id", runIds);
    if (runAccountError) throw runAccountError;
    manifestRows.push(...((runAccounts ?? []) as DemoRunAccountRow[]));
  }

  const candidateRootIds = [
    ...new Set([
      ...flaggedAccounts.map((account) => account.id),
      ...activeRuns.map((run) => run.root_account_id),
    ]),
  ];
  const knownAccounts = new Map(
    flaggedAccounts.map((account) => [account.id, account]),
  );
  const missingRootIds = candidateRootIds.filter(
    (accountId) => !knownAccounts.has(accountId),
  );
  if (missingRootIds.length > 0) {
    const { data: rootAccounts, error: rootAccountError } = await supabaseAdmin
      .from("accounts")
      .select("id, kind")
      .in("id", missingRootIds);
    if (rootAccountError) throw rootAccountError;
    for (const account of (rootAccounts ?? []) as DemoAccountRow[]) {
      knownAccounts.set(account.id, account);
    }
  }

  const rootByAccount = new Map<number, number>();
  for (const run of [...activeRuns].sort((a, b) => b.id - a.id)) {
    for (const row of manifestRows.filter(
      (candidate) => candidate.run_id === run.id,
    )) {
      if (!rootByAccount.has(row.account_id)) {
        rootByAccount.set(row.account_id, run.root_account_id);
      }
    }
  }

  const accountById = knownAccounts;
  const roots = new Map<number, DemoAccountRow>();
  for (const account of knownAccounts.values()) {
    const rootId = rootByAccount.get(account.id) ?? account.id;
    roots.set(
      rootId,
      accountById.get(rootId) ?? { id: rootId, kind: account.kind },
    );
  }
  return [...roots.values()];
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

  let accountList: DemoAccountRow[];
  try {
    accountList = await enumerateDemoRoots();
  } catch (error) {
    return createErrorResponse(500, getErrorMessage(error));
  }
  if (accountList.length === 0) {
    return jsonResponse({
      ...summarize(0, []),
      message: "no demo roots found",
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
