import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import {
  resolveAccountId,
  userScopedClient,
} from "../_shared/resolveDemoAccount.ts";

/**
 * Wipes every tenant row in the CALLER'S OWN account. Destructive and
 * security-sensitive — see design-artifacts/demo-onboarding-plan.md §6 for
 * the full tenancy-safety argument. Four independent layers make this
 * impossible to turn into a cross-tenant wipe, or into a wipe of a real
 * paying tenant's data:
 *
 *  1. accountId is resolved from the caller's own active account_members
 *     row via supabaseAdmin — never from the request body.
 *  2. `assertDemoAccount` reads `accounts.demo` via supabaseAdmin (so the
 *     check is authoritative regardless of RLS) and fails CLOSED — 403,
 *     zero deletes — unless it is exactly `true`. This runs before any
 *     delete or storage removal.
 *  3. Every delete runs on the USER-scoped client `db`, so RLS confines each
 *     statement to current_context_id() regardless of the WHERE clause.
 *  4. Every delete also carries an explicit `.eq('account_id', accountId)`
 *     filter (belt + braces) — there is no unfiltered/blanket delete here.
 *
 * Storage objects are removed via the service-role client before row deletion
 * so repeated seed/clear cycles do not leave orphaned files in the `documents`
 * or `entity-files` buckets.
 *
 * interactions and identity_signals are never deleted directly (authenticated
 * holds no DELETE grant on either) — they are removed by the
 * purge_polymorphic_dependents trigger on shidduchim/references, and by the
 * ON DELETE CASCADE from reference_links (interactions.reference_link_id).
 * Deletion order is FK-safe: every dependent of shidduchim/references is
 * removed before the parent, and singles go last because
 * shidduchim.single_id/date_records.single_id cascade from singles.
 *
 * accounts.demo release is OPT-IN, via the request body's `releaseDemoFlag`
 * (default `false`/absent — see `parseReleaseDemoFlag`). This function has
 * TWO callers with opposite intent: the customer, via the demo banner's
 * "clear it & start fresh" action, is permanently exiting demo mode and
 * passes `releaseDemoFlag: true`; `admin_reseed_demo_accounts` is refreshing
 * a demo account that must REMAIN one (so it stays in the reseed pool) and
 * never sets it.
 *
 * Earlier this function unconditionally cleared `demo` to `false` at the end
 * of every run. That broke the moment `assertDemoAccount` started guarding on
 * `demo === true`: seed_demo is not transactional with clear_demo, so a
 * seed_demo run that fails partway through (after some rows already
 * inserted, before its own final `demo = true` write) would leave the
 * account permanently unclearable — guarded here as not-demo, and refused by
 * seed_demo's own non-empty-account guard as already-seeded. Removing the
 * flip entirely (treating `demo` as permanent identity) fixed the deadlock
 * but broke the OPPOSITE thing: the customer-facing exit flow, which needs
 * `demo` to go back to `false` so `OnboardingGate`/`DemoBanner` re-arm. An
 * unconditional flip-to-false must never come back — it reintroduces the
 * deadlock — which is why the release is opt-in and caller-chosen instead:
 * only after every delete below has succeeded, and only when the caller
 * explicitly asked for it.
 */

// Deliberately explicit rather than looped over a table-name array — keeping
// the FK-safe order visible in the code is the whole point of this function.
const DELETE_ORDER = [
  "tasks",
  "reference_links",
  "redts",
  "shidduch_schools",
  "resume_photos",
  "resumes",
  "entity_files",
  "medical_notes",
  "shidduchim_external_links",
  "date_records",
  "shidduchim",
  "references",
  "shadchanim",
  "singles",
] as const;

/** Thrown by `assertDemoAccount` — caught explicitly by the handler and
 * mapped to 403, kept distinct from the generic 500 every other failure in
 * this function reports. */
class NotDemoAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotDemoAccountError";
  }
}

/**
 * Fails CLOSED unless the resolved account is currently flagged as a demo
 * account: refuses (throws `NotDemoAccountError`, never returns normally)
 * when the account row can't be read, doesn't exist, or `demo` is anything
 * other than exactly `true` (including `null`/`false`). Reads via
 * supabaseAdmin (service role) rather than the user-scoped client so the
 * check is authoritative regardless of RLS visibility, and must be called
 * before any delete or storage removal — see the module docstring for why
 * this is the only thing standing between "any authenticated user" and an
 * unconditional wipe of their own account, demo or not.
 */
async function assertDemoAccount(accountId: number): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("demo")
    .eq("id", accountId)
    .maybeSingle();

  if (error || !data || data.demo !== true) {
    throw new NotDemoAccountError(
      "This account is not a demo account. Clearing demo data is only available for demo accounts.",
    );
  }
}

async function collectStoragePaths(accountId: number): Promise<{
  documentPaths: string[];
  entityFilePaths: string[];
}> {
  // Resume files live in the `documents` bucket under `{account_id}/resumes/`.
  const { data: resumes, error: resumesError } = await supabaseAdmin
    .from("resumes")
    .select("files")
    .eq("account_id", accountId);
  if (resumesError) {
    throw new Error(`failed to list resumes: ${resumesError.message}`);
  }
  const resumeFilePaths: string[] = (resumes ?? [])
    .flatMap((r) =>
      Array.isArray(r.files) ? (r.files as Array<{ path?: string }>) : [],
    )
    .map((f) => f.path)
    .filter((p): p is string => !!p);

  // Resume photos live in the `documents` bucket under `{account_id}/photos/`.
  const { data: photos, error: photosError } = await supabaseAdmin
    .from("resume_photos")
    .select("path")
    .eq("account_id", accountId);
  if (photosError) {
    throw new Error(`failed to list resume_photos: ${photosError.message}`);
  }
  const photoPaths: string[] = (photos ?? [])
    .map((p) => p.path)
    .filter((p): p is string => !!p);

  // Entity files live in the `entity-files` bucket.
  const { data: entityFiles, error: entityFilesError } = await supabaseAdmin
    .from("entity_files")
    .select("storage_path")
    .eq("account_id", accountId);
  if (entityFilesError) {
    throw new Error(`failed to list entity_files: ${entityFilesError.message}`);
  }
  const entityFilePaths: string[] = (entityFiles ?? [])
    .map((f) => f.storage_path)
    .filter((p): p is string => !!p);

  return {
    documentPaths: [...resumeFilePaths, ...photoPaths],
    entityFilePaths,
  };
}

async function removeStorageObjects(
  documentPaths: string[],
  entityFilePaths: string[],
): Promise<void> {
  if (documentPaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("documents")
      .remove(documentPaths);
    if (error) {
      throw new Error(`failed to remove documents: ${error.message}`);
    }
  }
  if (entityFilePaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("entity-files")
      .remove(entityFilePaths);
    if (error) {
      throw new Error(`failed to remove entity-files: ${error.message}`);
    }
  }
}

/**
 * Parses the caller-supplied opt-in flag from the request body — the ONLY
 * thing the body may ever influence (accountId always comes from
 * `resolveAccountId(user.id)`, never from here; see the module docstring).
 *
 * Defaults to `false` whenever there is nothing to read: no body at all
 * (`admin_reseed_demo_accounts` sends a plain POST with no body), an empty
 * object, or a body that simply doesn't set the key. That "absent means
 * false" default is load-bearing — it is what keeps every existing caller's
 * behaviour unchanged unless it explicitly opts in.
 *
 * Validated as a strict boolean: anything present but not literally `true`
 * or `false` (a truthy string like `"true"`, a number, `null`, an object) is
 * REJECTED rather than coerced, so a caller can never accidentally enable a
 * destructive-to-identity flip via type juggling.
 */
async function parseReleaseDemoFlag(req: Request): Promise<boolean> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return false;
  }
  if (!raw) return false;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }

  const value = (payload as Record<string, unknown>).releaseDemoFlag;
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new Error("releaseDemoFlag must be a boolean");
  }
  return value;
}

async function clearDemoData(
  req: Request,
  accountId: number,
  releaseDemoFlag: boolean,
) {
  // Server-side tenancy gate: must run before ANY delete or storage removal.
  // See the module docstring and NotDemoAccountError for why this refuses
  // rather than proceeding on any doubt.
  await assertDemoAccount(accountId);

  const db = userScopedClient(req);

  // Clean up storage objects before row deletion so the deletion order stays
  // FK-safe and no orphans are left behind if a later step fails.
  const { documentPaths, entityFilePaths } =
    await collectStoragePaths(accountId);
  await removeStorageObjects(documentPaths, entityFilePaths);

  for (const table of DELETE_ORDER) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) {
      throw new Error(`delete from ${table} failed: ${error.message}`);
    }
  }

  // Opt-in release of the demo flag (module docstring) — deliberately the
  // LAST thing this function does, and only when the caller asked for it.
  // Never runs before every delete above has succeeded: a half-finished
  // clear must never also lose the account's demo identity, or the account
  // becomes unclearable AND un-reseedable (seed_demo refuses a non-empty
  // account; assertDemoAccount refuses a non-demo one).
  if (releaseDemoFlag) {
    const { error: flagError } = await supabaseAdmin
      .from("accounts")
      .update({ demo: false })
      .eq("id", accountId);
    if (flagError) {
      throw new Error(`failed to release accounts.demo: ${flagError.message}`);
    }
  }

  return { cleared: true as const, accountId };
}

/**
 * The authenticated request handler, exported separately from `Deno.serve`
 * below so tests can call it directly with a fake `User` — bypassing real
 * JWT verification (`AuthMiddleware`) the same way `postmark/index.test.ts`
 * tests `handleInboundEmail` directly rather than driving it through HTTP
 * Basic auth end to end.
 */
export async function handleClearDemo(
  req: Request,
  user?: User,
): Promise<Response> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return createErrorResponse(405, "Method Not Allowed");
  }
  if (!user) return createErrorResponse(401, "Unauthorized");

  const accountId = await resolveAccountId(user.id);
  if (!accountId) {
    return createErrorResponse(409, "No active account for user");
  }

  let releaseDemoFlag: boolean;
  try {
    releaseDemoFlag = await parseReleaseDemoFlag(req);
  } catch (e) {
    return createErrorResponse(400, (e as Error).message);
  }

  try {
    const summary = await clearDemoData(req, accountId, releaseDemoFlag);
    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    if (e instanceof NotDemoAccountError) {
      return createErrorResponse(403, e.message);
    }
    console.error("clear_demo failed:", e);
    return createErrorResponse(
      500,
      (e as Error).message || "Failed to clear demo data",
    );
  }
}

// The real Deno Edge Runtime is the only production caller of Deno.serve —
// guarded so importing this module (the "functions" Vitest project,
// index.test.ts) never tries to actually start a server. Mirrors
// postmark/index.ts's own guard; see that file's comment for why `typeof
// Deno` is the safe feature-detection to use here.
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    OptionsMiddleware(req, (req) =>
      AuthMiddleware(req, (req) =>
        UserMiddleware(req, (req, user?: User) => handleClearDemo(req, user)),
      ),
    ),
  );
} else {
  console.error(
    "clear_demo: Deno.serve is unavailable — no request handler registered; this function will not receive any traffic",
  );
}
