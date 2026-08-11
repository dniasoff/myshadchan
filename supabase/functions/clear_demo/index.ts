import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
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
 * so repeated seed/clear cycles do not leave orphaned files in the `documents`,
 * `entity-files`, or `attachments` buckets — the last of these backs
 * inbox_items.attachments (ShareTarget.tsx's shared-file capture and
 * postmark/extractAndUploadAttachments.ts's emailed attachments); inbox_items
 * rows are otherwise a plain member of DELETE_ORDER below.
 *
 * interactions and identity_signals are never deleted directly (authenticated
 * holds no DELETE grant on either) — they are removed by the
 * purge_polymorphic_dependents trigger on shidduchim/references, and by the
 * ON DELETE CASCADE from reference_links (interactions.reference_link_id).
 * Deletion order is FK-safe: every dependent of shidduchim/references is
 * removed before the parent, and singles go last because
 * shidduchim.single_id/date_records.single_id cascade from singles.
 * inbox_items carries no enforced foreign key to any of these (see
 * DELETE_ORDER's own comment) so it needs no particular position among them.
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
 *
 * `releaseDemoFlag: true` ALSO releases the caller's auto-assigned `parent`
 * bootstrap membership — the role OnboardingChoice.tsx's "Explore with demo
 * data" silently provisions purely so seed_demo's writes pass RLS, never a
 * role the user chose. Nothing else ever removes it, so without this release
 * `my_personas()`/`my_contexts()` stay permanently non-empty and the welcome
 * screen never returns after a clear. Gated the same way as the flag itself
 * (opt-in, customer-exit-only — the reseed orchestrator never sets it) and,
 * on top of that, gated on the caller being the account's SOLE active
 * member: see `releaseBootstrapPersona`'s own docstring for why
 * `guard_persona_removal()` alone is not enough to make that safe. A failure
 * to release the persona is reported back as `personaWarning` rather than
 * failing the clear — the data is already gone by that point.
 */

// Deliberately explicit rather than looped over a table-name array — keeping
// the FK-safe order visible in the code is the whole point of this function.
const DELETE_ORDER = [
  // inbox_items has no enforced foreign key to (or from) any other table
  // here: single_id/shadchan_id/resolved_shidduchim_id are plain bigint
  // columns with no `references` clause (01_tables.sql), connection_id's
  // real FK points OUT to connections — a table this function never touches
  // — and no table holds a foreign key INTO inbox_items. It is a leaf with
  // nothing upstream or downstream to sequence against, so its position here
  // is about logical order, not FK enforcement: first, because it is the
  // "front door" — a capture exists before anything is ever resolved from
  // it, never after.
  "inbox_items",
  "tasks",
  "reference_links",
  "redts",
  "shidduch_education",
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

/** Defensive parse of one `inbox_items.attachments` cell. The column is
 * plain `jsonb` with no shape enforced at the DB layer: `AddToInboxDialog.tsx`'s
 * manual-paste path never sets it (stays NULL), while `ShareTarget.tsx`'s
 * `uploadSharedFiles` and `postmark/extractAndUploadAttachments.ts` both
 * write the `{title, type, path, src}[]` shape `types.ts#InboxAttachment`
 * describes. Anything that isn't an array of objects carrying a non-empty
 * string `path` is skipped rather than thrown — a malformed or legacy cell
 * must never block the surrounding demo-data clear. */
function extractInboxAttachmentPaths(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((entry) =>
      typeof entry === "object" && entry !== null && "path" in entry
        ? (entry as { path?: unknown }).path
        : undefined,
    )
    .filter(
      (path): path is string => typeof path === "string" && path.length > 0,
    );
}

/** Resume files and resume photos both live in the `documents` bucket
 * (`{account_id}/resumes/` and `{account_id}/photos/` respectively). */
async function listDocumentPaths(accountId: number): Promise<string[]> {
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

  return [...resumeFilePaths, ...photoPaths];
}

/** Entity files live in the `entity-files` bucket. */
async function listEntityFilePaths(accountId: number): Promise<string[]> {
  const { data: entityFiles, error: entityFilesError } = await supabaseAdmin
    .from("entity_files")
    .select("storage_path")
    .eq("account_id", accountId);
  if (entityFilesError) {
    throw new Error(`failed to list entity_files: ${entityFilesError.message}`);
  }
  return (entityFiles ?? [])
    .map((f) => f.storage_path)
    .filter((p): p is string => !!p);
}

/** Inbox capture attachments (ShareTarget.tsx / postmark's
 * extractAndUploadAttachments.ts) live in the private `attachments` bucket,
 * account-prefixed exactly like every other bucket here. Read before the
 * inbox_items rows themselves are deleted (DELETE_ORDER), same as every
 * other storage-backed table. */
async function listInboxAttachmentPaths(accountId: number): Promise<string[]> {
  const { data: inboxItems, error: inboxItemsError } = await supabaseAdmin
    .from("inbox_items")
    .select("attachments")
    .eq("account_id", accountId);
  if (inboxItemsError) {
    throw new Error(`failed to list inbox_items: ${inboxItemsError.message}`);
  }
  return (inboxItems ?? []).flatMap((item) =>
    extractInboxAttachmentPaths(item.attachments),
  );
}

async function collectStoragePaths(accountId: number): Promise<{
  documentPaths: string[];
  entityFilePaths: string[];
  attachmentPaths: string[];
}> {
  const [documentPaths, entityFilePaths, attachmentPaths] = await Promise.all([
    listDocumentPaths(accountId),
    listEntityFilePaths(accountId),
    listInboxAttachmentPaths(accountId),
  ]);
  return { documentPaths, entityFilePaths, attachmentPaths };
}

async function removeStorageObjects(
  documentPaths: string[],
  entityFilePaths: string[],
  attachmentPaths: string[],
): Promise<void> {
  if (documentPaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("documents")
      .remove(documentPaths);
    if (error) {
      throw new Error(`failed to remove documents: ${error.message}`);
    }
  }
  if (attachmentPaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("attachments")
      .remove(attachmentPaths);
    if (error) {
      throw new Error(`failed to remove attachments: ${error.message}`);
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

/**
 * Counts the account's currently-active memberships via supabaseAdmin — the
 * authoritative, RLS-bypassing read, exactly like `assertDemoAccount` above
 * — because this is the one thing standing between a solo demo explorer's
 * exit flow and stripping a real, shared household's admin membership out
 * from under it. See `releaseBootstrapPersona` for why this check exists
 * independently of `guard_persona_removal()`.
 */
async function countActiveMembers(accountId: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("account_members")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "active");
  if (error) {
    throw new Error(`failed to count active members: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Releases the auto-assigned bootstrap `parent` persona OnboardingChoice.tsx
 * silently provisions for a brand-new demo explorer, purely so seed_demo's
 * writes pass RLS — that comment says as much; it is never a role the user
 * chose. Nothing else ever removes it (see the module docstring's
 * OnboardingGate discussion), so without this release `my_personas()`/
 * `my_contexts()` stay permanently non-empty and the welcome screen never
 * returns after a clear.
 *
 * SAFETY: this must NEVER strip the caller's admin access from an account
 * that has another active member. `remove_persona()`'s own
 * `guard_persona_removal()` (02_functions.sql) only refuses archiving when
 * the caller is the account's LAST active member AND the account still
 * holds domain data — it does not, and was never meant to, stop a member of
 * a MULTI-member household from voluntarily giving up their own persona.
 * That is a legitimate, user-initiated action on a real account; it must
 * never happen as a silent side effect of a demo-data clear. So this
 * function adds its own, independent gate — `countActiveMembers` — and
 * releases the persona only when the caller is the account's sole active
 * member, never relying on the guard alone.
 *
 * Runs `remove_persona` as an RPC on the CALLER's OWN scoped client `db`
 * (never `supabaseAdmin`), so RLS and the function's own `auth.uid()`-keyed
 * queries apply exactly as they would for a real, user-driven persona
 * removal. This performs no privilege bypass of its own — it only decides
 * WHETHER to invoke something the caller could otherwise invoke themselves.
 *
 * Never throws: any failure — the member count, or the RPC itself — is
 * returned as a warning string instead of failing the surrounding clear.
 * The caller's data is already gone by this point (called last, after every
 * delete/storage-removal/flag-release above has succeeded); losing sight of
 * that behind an unrelated persona-release hiccup would be worse than a
 * visible warning (mirrors admin_reseed_demo_accounts's `cleanupWarning`).
 */
async function releaseBootstrapPersona(
  db: SupabaseClient,
  accountId: number,
): Promise<string | null> {
  try {
    const activeMembers = await countActiveMembers(accountId);
    if (activeMembers !== 1) {
      // A multi-member household (or, defensively, zero — should be
      // unreachable, since the caller's own active membership is what
      // resolved this accountId in the first place): never touch the
      // persona. Not a failure — a correct, silent no-op.
      return null;
    }

    const { error } = await db.rpc("remove_persona", { p_persona: "parent" });
    if (error) {
      throw new Error(error.message);
    }
    return null;
  } catch (e) {
    const message = `failed to release the bootstrap persona: ${
      (e as Error).message
    }`;
    console.error(`clear_demo: ${message}`);
    return message;
  }
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
  const { documentPaths, entityFilePaths, attachmentPaths } =
    await collectStoragePaths(accountId);
  await removeStorageObjects(documentPaths, entityFilePaths, attachmentPaths);

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
  let personaWarning: string | null = null;
  if (releaseDemoFlag) {
    const { error: flagError } = await supabaseAdmin
      .from("accounts")
      .update({ demo: false })
      .eq("id", accountId);
    if (flagError) {
      throw new Error(`failed to release accounts.demo: ${flagError.message}`);
    }

    // Last of all: only after data, storage, and the demo flag are gone.
    // See releaseBootstrapPersona's own docstring for the multi-member
    // safety check and its never-throws contract.
    personaWarning = await releaseBootstrapPersona(db, accountId);
  }

  return {
    cleared: true as const,
    accountId,
    ...(personaWarning ? { personaWarning } : {}),
  };
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
