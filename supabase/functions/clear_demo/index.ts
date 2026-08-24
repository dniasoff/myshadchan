import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { resolveAccountId } from "../_shared/resolveDemoAccount.ts";

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
 *  3. The lifecycle is service-role-only after an exact run/clear lease is
 *     claimed.  The manifest is authoritative for every relationship,
 *     actor, account, and storage prefix; no browser-supplied row ID is
 *     trusted as a delete scope.
 *  4. Every delete is checked against the run's exact account axes and the
 *     service-owned SQL lease fence.  This is deliberately not a claim that
 *     the delete statements rely on a user JWT/RLS session.
 *
 * Storage objects are removed via the service-role client before row deletion
 * so repeated seed/clear cycles do not leave orphaned files in the `documents`,
 * `entity-files`, or `attachments` buckets — the last of these backs
 * inbox_items.attachments (ShareTarget.tsx's shared-file capture and
 * postmark/extractAndUploadAttachments.ts's emailed attachments); inbox_items
 * rows are otherwise deleted by the explicit account/connection discussion
 * passes in `clearOfficialDemoBundle` below.
 *
 * interactions and identity_signals are never deleted directly (authenticated
 * holds no DELETE grant on either) — they are removed by the
 * purge_polymorphic_dependents trigger on shidduchim/references, and by the
 * ON DELETE CASCADE from reference_links (interactions.reference_link_id).
 * Deletion order is FK-safe: every dependent of shidduchim/references is
 * removed before the parent, and singles go last because
 * shidduchim.single_id/date_records.single_id cascade from singles.
 * inbox_items carries no enforced foreign key to any of these, so it needs no
 * particular position among the explicit account-scoped deletes.
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
/** Thrown by `assertDemoAccount` — caught explicitly by the handler and
 * mapped to 403, kept distinct from the generic 500 every other failure in
 * this function reports. */
class NotDemoAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotDemoAccountError";
  }
}

class DemoRunBusyError extends Error {
  constructor() {
    super(
      "Demo lifecycle is already owned by another operation; please retry.",
    );
    this.name = "DemoRunBusyError";
  }
}

function isAuthUserNotFoundError(error: unknown): boolean {
  const candidate = error as { status?: number; code?: string } | null;
  return (
    candidate?.status === 404 ||
    candidate?.code === "user_not_found" ||
    (error instanceof Error && /user.?not.?found/i.test(error.message))
  );
}

type DemoActorAuthUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};

async function listAllAuthUsers(): Promise<DemoActorAuthUser[]> {
  const users: DemoActorAuthUser[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`list Auth users failed: ${error.message}`);
    users.push(...(data.users as DemoActorAuthUser[]));
    if (data.users.length < 1000) return users;
  }
  throw new Error("list Auth users exceeded pagination safety limit");
}

async function getReleaseReceipt(userId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("get_demo_release_receipt", {
    p_user_id: userId,
  });
  if (error)
    throw new Error(`read demo release receipt failed: ${error.message}`);
  if (!data || typeof data !== "object") return null;
  const rootAccountId = (data as { root_account_id?: unknown }).root_account_id;
  return typeof rootAccountId === "number" ? rootAccountId : null;
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

  if (error || !data) {
    throw new NotDemoAccountError(
      "This account is not a demo account. Clearing demo data is only available for demo accounts.",
    );
  }
  if (data.demo === true) return;

  // A failed/seeding bundle can legitimately reach this guard before the
  // final accounts.demo=true transition. Its caller-scoped manifest is the
  // stronger proof that this is the sandbox's compensating-clear path.
  try {
    const { data: run, error: runError } = await supabaseAdmin
      .from("demo_runs")
      .select("id")
      .eq("root_account_id", accountId)
      .in("status", ["seeding", "active", "clearing", "failed"])
      .limit(1)
      .maybeSingle();
    if (!runError && run) return;
  } catch {
    // Older stacks may not have the manifest table. Fail closed below.
  }
  throw new NotDemoAccountError(
    "This account is not a demo account. Clearing demo data is only available for demo accounts.",
  );
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

/** Recursively enumerate an exact numeric account prefix with pagination.
 * Storage metadata can be committed after a row/manifest response is lost,
 * so the clear pass must discover objects independently of domain rows. */
async function listStoragePrefixPaths(
  bucket: "documents" | "entity-files" | "attachments",
  accountId: number,
): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(prefix, { limit: 100, offset });
      if (error)
        throw new Error(`failed to list ${bucket} storage: ${error.message}`);
      for (const entry of data ?? []) {
        if (!entry?.name || entry.name === "." || entry.name === "..") continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id == null && entry.metadata == null) {
          await walk(path);
        } else {
          paths.push(path);
        }
      }
      if (!data || data.length < 100) break;
    }
  };
  await walk(String(accountId));
  return paths.filter(
    (path) =>
      path.startsWith(`${accountId}/`) && !path.split("/").includes(".."),
  );
}

async function collectStoragePaths(accountId: number): Promise<{
  documentPaths: string[];
  entityFilePaths: string[];
  attachmentPaths: string[];
}> {
  const [
    documentPaths,
    entityFilePaths,
    attachmentPaths,
    listedDocuments,
    listedEntityFiles,
    listedAttachments,
  ] = await Promise.all([
    listDocumentPaths(accountId),
    listEntityFilePaths(accountId),
    listInboxAttachmentPaths(accountId),
    listStoragePrefixPaths("documents", accountId),
    listStoragePrefixPaths("entity-files", accountId),
    listStoragePrefixPaths("attachments", accountId),
  ]);
  return {
    documentPaths: [...new Set([...documentPaths, ...listedDocuments])],
    entityFilePaths: [...new Set([...entityFilePaths, ...listedEntityFiles])],
    attachmentPaths: [...new Set([...attachmentPaths, ...listedAttachments])],
  };
}

async function removeStoragePathsInChunks(
  bucket: "documents" | "entity-files" | "attachments",
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const chunk = paths.slice(offset, offset + 100);
    if (chunk.length === 0) continue;
    const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`failed to remove ${bucket}: ${error.message}`);
  }
}

async function removeStorageObjects(
  documentPaths: string[],
  entityFilePaths: string[],
  attachmentPaths: string[],
): Promise<void> {
  if (documentPaths.length > 0) {
    await removeStoragePathsInChunks("documents", documentPaths);
  }
  if (attachmentPaths.length > 0) {
    await removeStoragePathsInChunks("attachments", attachmentPaths);
  }
  if (entityFilePaths.length > 0) {
    await removeStoragePathsInChunks("entity-files", entityFilePaths);
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

type DemoRunRecord = { id: number; status: string; updated_at: string };

export async function findActiveDemoRun(
  rootAccountId: number,
): Promise<DemoRunRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("demo_runs")
    .select("id, status, updated_at")
    .eq("root_account_id", rootAccountId)
    .in("status", ["seeding", "active", "clearing", "failed"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`failed to inspect demo run: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as number,
    status: data.status as string,
    updated_at: data.updated_at as string,
  };
}

async function validateDemoActorsBeforeCleanup(
  runId: number,
  leaseToken: string,
  accountIds: readonly number[],
): Promise<{
  actorIds: string[];
  actors: Array<{ actorKey: string; userId: string; expectedEmail: string }>;
  authIdsPresent: Set<string>;
}> {
  const [manifestUsersResult, actorIntentsResult] = await Promise.all([
    supabaseAdmin
      .from("demo_run_users")
      .select("user_id, actor_key")
      .eq("run_id", runId),
    supabaseAdmin
      .from("demo_run_actor_intents")
      .select("actor_key, expected_email, auth_user_id, state")
      .eq("run_id", runId),
  ]);
  if (manifestUsersResult.error) {
    throw new Error(
      `list demo actors failed: ${manifestUsersResult.error.message}`,
    );
  }
  if (actorIntentsResult.error) {
    throw new Error(
      `list demo actor intents failed: ${actorIntentsResult.error.message}`,
    );
  }

  const actors = new Map<string, { userId: string; expectedEmail: string }>();
  const confirmedAbsentActors = new Set<string>();
  for (const row of (manifestUsersResult.data ?? []) as Array<{
    user_id?: unknown;
    actor_key?: unknown;
  }>) {
    if (
      typeof row.user_id !== "string" ||
      typeof row.actor_key !== "string" ||
      row.user_id.length === 0 ||
      row.actor_key.length === 0 ||
      actors.has(row.actor_key)
    ) {
      throw new Error(
        "demo actor manifest has an invalid or duplicate identity",
      );
    }
    actors.set(row.actor_key, { userId: row.user_id, expectedEmail: "" });
  }
  for (const intent of (actorIntentsResult.data ?? []) as Array<{
    actor_key?: unknown;
    expected_email?: unknown;
    auth_user_id?: unknown;
    state?: unknown;
  }>) {
    if (
      typeof intent.actor_key !== "string" ||
      typeof intent.expected_email !== "string"
    ) {
      throw new Error("demo actor intent lacks deterministic identity");
    }
    const existing = actors.get(intent.actor_key);
    if (existing?.expectedEmail) {
      throw new Error(`duplicate demo actor intent ${intent.actor_key}`);
    }
    if (
      existing &&
      typeof intent.auth_user_id === "string" &&
      existing.userId !== intent.auth_user_id
    ) {
      throw new Error(`demo actor identity mismatch ${intent.actor_key}`);
    }
    actors.set(intent.actor_key, {
      userId:
        typeof intent.auth_user_id === "string"
          ? intent.auth_user_id
          : (existing?.userId ?? ""),
      expectedEmail: intent.expected_email,
    });
    if (intent.state === "confirmed_absent") {
      confirmedAbsentActors.add(intent.actor_key);
      actors.get(intent.actor_key)!.userId = "";
    }
  }

  let authUsers: DemoActorAuthUser[];
  try {
    authUsers = actors.size > 0 ? await listAllAuthUsers() : [];
  } catch (error) {
    throw new Error(
      `enumerate demo actor Auth identities failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const authIdsPresent = new Set<string>();
  for (const [actorKey, actor] of actors) {
    if (!actor.expectedEmail) {
      throw new Error(`demo actor ${actorKey} is missing an exact identity`);
    }
    // Auth creation can commit after the Edge response is lost, before the
    // reconcile RPC commits.  The durable intent is the only recovery key:
    // match the exact lower-cased email and the complete run-scoped metadata,
    // reject ambiguity, then reconcile before any deletion tombstone exists.
    if (!actor.userId) {
      const exactCandidates = authUsers.filter((candidate) => {
        const metadata = candidate.app_metadata ?? {};
        return (
          candidate.email?.toLowerCase() ===
            actor.expectedEmail.toLowerCase() &&
          metadata.demo === true &&
          metadata.demo_run_id === runId &&
          metadata.demo_actor_key === actorKey
        );
      });
      if (exactCandidates.length > 1) {
        throw new Error(
          `ambiguous synthetic actor Auth reconciliation ${actorKey}`,
        );
      }
      if (confirmedAbsentActors.has(actorKey) && exactCandidates.length > 0) {
        throw new Error(
          `confirmed-absent synthetic actor ${actorKey} reappeared in Auth`,
        );
      }
      if (exactCandidates[0]) {
        actor.userId = exactCandidates[0].id;
        const { error: reconcileError } = await supabaseAdmin.rpc(
          "reconcile_demo_actor",
          {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_actor_key: actorKey,
            p_user_id: actor.userId,
            p_operation: "clear",
          },
        );
        if (reconcileError) {
          throw new Error(
            `reconcile synthetic actor ${actorKey} failed: ${reconcileError.message}`,
          );
        }
      }
    }
    if (!actor.userId) {
      const { error: absentError } = await supabaseAdmin.rpc(
        "confirm_demo_actor_absent",
        {
          p_run_id: runId,
          p_lease_token: leaseToken,
          p_actor_key: actorKey,
          p_operation: "clear",
        },
      );
      if (absentError) {
        throw new Error(
          `confirm synthetic actor ${actorKey} absent failed: ${absentError.message}`,
        );
      }
      continue;
    }
    const authUser = authUsers.find((candidate) => {
      const metadata = candidate.app_metadata ?? {};
      return (
        candidate.id === actor.userId &&
        candidate.email?.toLowerCase() === actor.expectedEmail.toLowerCase() &&
        metadata.demo === true &&
        metadata.demo_run_id === runId &&
        metadata.demo_actor_key === actorKey
      );
    });
    const conflictingAuthUser = authUsers.some((candidate) => {
      const metadata = candidate.app_metadata ?? {};
      return (
        candidate.id !== actor.userId &&
        candidate.email?.toLowerCase() === actor.expectedEmail.toLowerCase() &&
        metadata.demo === true &&
        metadata.demo_run_id === runId &&
        metadata.demo_actor_key === actorKey
      );
    });
    if (authUser) {
      authIdsPresent.add(authUser.id);
    } else if (
      authUsers.some((candidate) => candidate.id === actor.userId) ||
      conflictingAuthUser
    ) {
      throw new Error(`demo actor ${actorKey} has mismatched Auth identity`);
    }
  }

  for (const actorId of [...actors.values()]
    .map((actor) => actor.userId)
    .filter((id): id is string => id.length > 0)) {
    const { data: memberships, error } = await supabaseAdmin
      .from("account_members")
      .select("account_id, user_id")
      .eq("user_id", actorId);
    if (
      error ||
      (memberships ?? []).some(
        (membership) =>
          membership.user_id !== actorId ||
          !accountIds.includes(membership.account_id as number),
      )
    ) {
      throw new Error(
        `demo actor ${actorId} has membership outside the exact run`,
      );
    }
  }
  return {
    actorIds: [
      ...new Set(
        [...actors.values()]
          .map((actor) => actor.userId)
          .filter((id): id is string => id.length > 0),
      ),
    ],
    actors: [...actors.entries()]
      .filter(([, actor]) => actor.userId.length > 0)
      .map(([actorKey, actor]) => ({
        actorKey,
        userId: actor.userId,
        expectedEmail: actor.expectedEmail,
      })),
    authIdsPresent,
  };
}

async function clearOfficialDemoBundle(
  rootAccountId: number,
  run: DemoRunRecord & { leaseToken: string },
  releaseDemoFlag: boolean,
  userId: string,
  partialRun = false,
): Promise<{
  cleared: true;
  accountId: number;
  runId: number;
  companionAccounts: number;
  syntheticActors: number;
  lastClearedAt?: string;
}> {
  const runId = run.id;
  const leaseToken = run.leaseToken;

  const heartbeat = async (phase: string) => {
    const { error } = await supabaseAdmin.rpc("heartbeat_demo_run", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_operation: "clear",
    });
    if (error)
      throw new Error(
        `demo clear heartbeat failed after ${phase}: ${error.message}`,
      );
  };
  await heartbeat("claim");

  // Clearing owns the account update lock before it reaches this point, so
  // new demo ingest claims are fenced. Wait for claims acquired before the
  // clear to finish (or expire safely) before sweeping storage/finalizing.
  const { data: ingestClaimsReady, error: ingestClaimsError } =
    await supabaseAdmin.rpc("wait_for_demo_ingest_claims", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_timeout_seconds: 30,
    });
  if (ingestClaimsError || ingestClaimsReady !== true) {
    throw new Error(
      `demo ingest claim fence failed: ${ingestClaimsError?.message ?? "active claims remain"}`,
    );
  }
  await heartbeat("ingest claim fence");

  const { data: runAccounts, error: runAccountsError } = await supabaseAdmin
    .from("demo_run_accounts")
    .select("account_id, context_key, context_kind, is_root")
    .eq("run_id", runId);
  if (runAccountsError)
    throw new Error(`list demo contexts failed: ${runAccountsError.message}`);
  const manifestRows = (runAccounts ?? []) as Array<{
    account_id?: unknown;
    context_key?: unknown;
    context_kind?: unknown;
    is_root?: unknown;
  }>;
  // Single tenant: the demo is one family. See demoDataset.ts's scenario
  // inventory for why the companion contexts are gone rather than hidden.
  const expectedKinds: Record<string, "household" | "shadchanus"> = {
    "primary-household": "household",
  };
  const allAccountIds = manifestRows.map((row) => row.account_id);
  const rootRows = manifestRows.filter((row) => row.is_root === true);
  const manifestContextKeys = new Set(
    manifestRows.map((row) => row.context_key),
  );
  if (
    manifestRows.length < 1 ||
    // One context, because the demo is one family. `partialRun` still allows
    // fewer than the full set, which is what a compensating clear of a seed
    // that died mid-build sees.
    (partialRun
      ? manifestRows.length > Object.keys(expectedKinds).length
      : manifestRows.length !== Object.keys(expectedKinds).length) ||
    rootRows.length !== 1 ||
    rootRows[0]?.account_id !== rootAccountId ||
    manifestRows.some(
      (row) =>
        typeof row.account_id !== "number" ||
        row.account_id <= 0 ||
        typeof row.context_key !== "string" ||
        expectedKinds[row.context_key] !== row.context_kind ||
        (row.context_key === "primary-household") !== (row.is_root === true),
    ) ||
    new Set(allAccountIds).size !== allAccountIds.length ||
    manifestContextKeys.size !== manifestRows.length ||
    (!partialRun &&
      !Object.keys(expectedKinds).every((contextKey) =>
        manifestContextKeys.has(contextKey),
      ))
  ) {
    throw new Error(
      partialRun
        ? "partial demo manifest has an invalid account key/kind graph"
        : "demo manifest has an invalid account key/kind graph",
    );
  }
  const accountIds = allAccountIds as number[];
  const { data: actualAccounts, error: actualAccountsError } =
    await supabaseAdmin
      .from("accounts")
      .select("id, kind")
      .in("id", accountIds);
  if (
    actualAccountsError ||
    !actualAccounts ||
    actualAccounts.length !== accountIds.length ||
    actualAccounts.some((account) => {
      const manifest = manifestRows.find(
        (row) => row.account_id === account.id,
      );
      return (
        !manifest ||
        expectedKinds[manifest.context_key as string] !== account.kind
      );
    })
  ) {
    throw new Error(
      "demo manifest account kind does not match the account row",
    );
  }
  const companionAccountIds = accountIds.filter(
    (id): id is number => typeof id === "number" && id !== rootAccountId,
  );

  // Validate every manifest-owned relationship before deleting any storage
  // or tenant row. In particular, a child grant's target single is itself an
  // account axis; validating after deleting singles would turn a retryable
  // clear into a permanently missing-owner failure.
  const { data: resources, error: resourceError } = await supabaseAdmin
    .from("demo_run_resources")
    .select("resource_type, resource_id")
    .eq("run_id", runId);
  if (resourceError) {
    throw new Error(`list demo resources failed: ${resourceError.message}`);
  }
  const relationshipTables: Record<string, string> = {
    connection: "connections",
    connection_invite: "connection_invites",
    child_grant: "child_grants",
    invite: "invites",
  };
  const allowedResourceTypes = new Set([
    "invite",
    "connection_invite",
    "child_grant",
    "connection",
    "thread",
    "message",
    "listing",
    "share_link",
    "task",
    "share_access_log",
    "inbox_item",
    "analytics_event",
    "message_notification",
    "task_notification",
    "trusted_sender",
    "single_preference",
    "single_note",
    "listing_withdrawal",
  ]);
  const bundleAccountSet = new Set(accountIds);
  const ownedRelationshipResources: Array<{ table: string; id: number }> = [];
  const registeredThreadIds = new Set<number>();
  const registeredMessageIds = new Set<number>();
  for (const resource of resources ?? []) {
    if (!allowedResourceTypes.has(resource.resource_type as string)) {
      throw new Error(
        `refusing to delete unknown demo resource type ${resource.resource_type}`,
      );
    }
    const { error: ownershipError } = await supabaseAdmin.rpc(
      "assert_demo_resource_ownership",
      {
        p_run_id: runId,
        p_resource_type: resource.resource_type,
        p_resource_id: resource.resource_id,
        p_require_present: false,
      },
    );
    if (ownershipError) {
      throw new Error(
        `refusing to delete ${resource.resource_type} ${resource.resource_id}: ${ownershipError.message}`,
      );
    }
    if (resource.resource_type === "thread") {
      registeredThreadIds.add(resource.resource_id as number);
      continue;
    }
    if (resource.resource_type === "message") {
      registeredMessageIds.add(resource.resource_id as number);
      continue;
    }
    const table = relationshipTables[resource.resource_type as string];
    if (!table) continue;

    const ownershipColumns: Record<string, string> = {
      connections: "household_account_id, shadchanus_account_id, status",
      connection_invites: "inviter_account_id, accepted_by_account_id, status",
      child_grants:
        "proposer_account_id, target_single_id, grantee_account_id, status",
      invites: "account_id, status",
    };
    const { data: relationship, error: relationshipError } = await supabaseAdmin
      .from(table)
      .select(ownershipColumns[table])
      .eq("id", resource.resource_id)
      .maybeSingle();
    if (relationshipError) {
      throw new Error(
        `verify demo ${table} ownership failed: ${relationshipError.message}`,
      );
    }
    if (!relationship) continue;

    let endpoints: unknown[];
    if (table === "connections") {
      endpoints = [
        relationship.household_account_id,
        relationship.shadchanus_account_id,
      ];
    } else if (table === "connection_invites") {
      endpoints = [
        relationship.inviter_account_id,
        relationship.accepted_by_account_id,
      ];
    } else if (table === "child_grants") {
      const { data: targetSingle, error: targetSingleError } =
        await supabaseAdmin
          .from("singles")
          .select("account_id")
          .eq("id", relationship.target_single_id)
          .maybeSingle();
      if (targetSingleError) {
        throw new Error(
          `verify demo child grant target ownership failed: ${targetSingleError.message}`,
        );
      }
      if (!targetSingle || targetSingle.account_id == null) {
        throw new Error(
          `refusing to delete ${table} ${resource.resource_id}: grant target single is missing its owner`,
        );
      }
      endpoints = [
        relationship.proposer_account_id,
        targetSingle.account_id,
        relationship.grantee_account_id,
      ];
    } else {
      endpoints = [relationship.account_id];
    }
    const requiredEndpoints = endpoints.filter(
      (endpoint): endpoint is number =>
        endpoint !== null && endpoint !== undefined,
    );
    if (
      requiredEndpoints.length === 0 ||
      requiredEndpoints.some((endpoint) => !bundleAccountSet.has(endpoint))
    ) {
      throw new Error(
        `refusing to delete ${table} ${resource.resource_id}: relationship endpoint is outside demo run ${runId}`,
      );
    }
    if (
      table === "connection_invites" &&
      relationship.status === "accepted" &&
      relationship.accepted_by_account_id == null
    ) {
      throw new Error(
        `refusing to delete accepted connection invite ${resource.resource_id}: missing accepting endpoint`,
      );
    }
    if (
      table === "child_grants" &&
      relationship.status === "accepted" &&
      relationship.grantee_account_id == null
    ) {
      throw new Error(
        `refusing to delete accepted child grant ${resource.resource_id}: missing grantee endpoint`,
      );
    }
    ownedRelationshipResources.push({
      table,
      id: resource.resource_id as number,
    });
  }

  // Validate every actor's exact Auth identity and every membership before
  // storage/domain cleanup begins. A synthetic actor must have no membership
  // outside this manifest; otherwise deleting Auth globally could erase a
  // real account's access.
  const { actorIds, actors, authIdsPresent } =
    await validateDemoActorsBeforeCleanup(runId, leaseToken, accountIds);
  const { error: restoreError } = await supabaseAdmin.rpc(
    "restore_demo_member_state",
    {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_operation: "clear",
    },
  );
  if (restoreError) {
    throw new Error(
      `restore demo member state before cleanup failed: ${restoreError.message}`,
    );
  }

  const { data: storageRows, error: storageError } = await supabaseAdmin
    .from("demo_run_storage")
    .select("bucket, storage_path, resource_key")
    .eq("run_id", runId);
  if (storageError)
    throw new Error(`list demo storage failed: ${storageError.message}`);
  const pathsByBucket = new Map<string, string[]>();
  for (const row of storageRows ?? []) {
    if (
      !["documents", "entity-files", "attachments"].includes(row.bucket) ||
      !accountIds.some(
        (accountId) =>
          row.storage_path.startsWith(`${accountId}/`) &&
          !row.storage_path.split("/").includes(".."),
      ) ||
      !["resume", "photo", "entity-file", "inbox-attachment"].includes(
        row.resource_key,
      )
    ) {
      throw new Error(
        `refusing to remove demo storage outside the exact manifest: ${row.bucket}/${row.storage_path}`,
      );
    }
    const paths = pathsByBucket.get(row.bucket) ?? [];
    paths.push(row.storage_path);
    pathsByBucket.set(row.bucket, paths);
  }

  // Core seeding happens before the official bundle manifest is populated.
  // If that phase fails after an upload, demo_run_storage is empty; enumerate
  // every manifest account's domain rows before deleting any of them and union
  // those paths with the registered manifest. Listing or removal failure is
  // intentionally fatal, leaving the failed run retryable with its rows intact.
  const documentPaths = new Set<string>();
  const entityFilePaths = new Set<string>();
  const attachmentPaths = new Set<string>();
  for (const accountId of accountIds) {
    const discovered = await collectStoragePaths(accountId);
    const addDiscovered = (target: Set<string>, path: string) => {
      if (!path.startsWith(`${accountId}/`) || path.split("/").includes("..")) {
        throw new Error(
          `refusing to remove storage outside demo account ${accountId}: ${path}`,
        );
      }
      target.add(path);
    };
    discovered.documentPaths.forEach((path) =>
      addDiscovered(documentPaths, path),
    );
    discovered.entityFilePaths.forEach((path) =>
      addDiscovered(entityFilePaths, path),
    );
    discovered.attachmentPaths.forEach((path) =>
      addDiscovered(attachmentPaths, path),
    );
  }
  for (const [bucket, paths] of pathsByBucket) {
    const target =
      bucket === "documents"
        ? documentPaths
        : bucket === "entity-files"
          ? entityFilePaths
          : bucket === "attachments"
            ? attachmentPaths
            : null;
    if (target) {
      paths.forEach((path) => target.add(path));
    }
  }
  const { data: leaseValid, error: leaseError } = await supabaseAdmin.rpc(
    "demo_run_lease_is_current",
    { p_run_id: runId, p_lease_token: leaseToken, p_operation: "clear" },
  );
  if (leaseError || leaseValid !== true) {
    throw new Error(
      `demo clear lease fenced before storage cleanup: ${leaseError?.message ?? "stale lease"}`,
    );
  }
  await removeStorageObjects(
    [...documentPaths],
    [...entityFilePaths],
    [...attachmentPaths],
  );
  await heartbeat("storage cleanup");
  // Preserve fail-closed cleanup for any future manifest bucket without
  // silently dropping it into one of the known bucket sets above.
  for (const [bucket, paths] of pathsByBucket) {
    if (
      bucket === "documents" ||
      bucket === "entity-files" ||
      bucket === "attachments"
    ) {
      continue;
    }
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) continue;
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove(uniquePaths);
    if (error) throw new Error(`remove demo storage failed: ${error.message}`);
  }

  const deleteByAccount = [
    "analytics_events",
    "inbox_items",
    "message_notifications",
    "task_notifications",
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
    "listing_withdrawal_locks",
    "trusted_senders",
    "listings",
    "share_links",
    "single_preferences",
    "single_notes",
    "shidduchim",
    "references",
    "shadchanim",
    "singles",
  ];
  for (const table of deleteByAccount) {
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .in("account_id", accountIds);
    if (error) throw new Error(`delete demo ${table} failed: ${error.message}`);
  }
  // Account-axis discussions are runtime customer data and therefore may not
  // rely on the seed manifest.  Connection-axis discussions are deleted from
  // the exact registered connection endpoints.  The order is explicit:
  // notifications/messages, participants, then threads.
  const ownedConnectionIds = ownedRelationshipResources
    .filter((resource) => resource.table === "connections")
    .map((resource) => resource.id);
  const discussionDelete = async (
    table:
      "message_notifications" | "messages" | "thread_participants" | "threads",
    column: "account_id" | "connection_id",
    ids: number[],
  ) => {
    if (ids.length === 0) return;
    const { error } = await supabaseAdmin.from(table).delete().in(column, ids);
    if (error) throw new Error(`delete demo ${table} failed: ${error.message}`);
  };
  await discussionDelete("message_notifications", "account_id", accountIds);
  await discussionDelete("messages", "account_id", accountIds);
  await discussionDelete("thread_participants", "account_id", accountIds);
  await discussionDelete("threads", "account_id", accountIds);
  await discussionDelete(
    "message_notifications",
    "connection_id",
    ownedConnectionIds,
  );
  await discussionDelete("messages", "connection_id", ownedConnectionIds);
  await discussionDelete(
    "thread_participants",
    "connection_id",
    ownedConnectionIds,
  );
  await discussionDelete("threads", "connection_id", ownedConnectionIds);
  if (registeredMessageIds.size > 0) {
    const { error } = await supabaseAdmin
      .from("messages")
      .delete()
      .in("id", [...registeredMessageIds]);
    if (error)
      throw new Error(
        `delete registered demo messages failed: ${error.message}`,
      );
  }
  if (registeredThreadIds.size > 0) {
    const { error: participantError } = await supabaseAdmin
      .from("thread_participants")
      .delete()
      .in("thread_id", [...registeredThreadIds]);
    if (participantError) {
      throw new Error(
        `delete registered demo participants failed: ${participantError.message}`,
      );
    }
    const { error: threadError } = await supabaseAdmin
      .from("threads")
      .delete()
      .in("id", [...registeredThreadIds]);
    if (threadError)
      throw new Error(
        `delete registered demo threads failed: ${threadError.message}`,
      );
  }
  await heartbeat("account data cleanup");

  // Relationship rows have two account axes. Only IDs registered in this
  // run's manifest are eligible for deletion; an external connection/grant/
  // invite touching one bundle endpoint is deliberately left untouched.
  for (const resource of ownedRelationshipResources) {
    const { error } = await supabaseAdmin
      .from(resource.table)
      .delete()
      .eq("id", resource.id);
    if (error) {
      throw new Error(`delete demo ${resource.table} failed: ${error.message}`);
    }
  }
  await heartbeat("relationship cleanup");

  const orphanChecks = await Promise.all([
    supabaseAdmin
      .from("message_notifications")
      .select("id")
      .in("account_id", accountIds),
    supabaseAdmin.from("threads").select("id").in("account_id", accountIds),
    supabaseAdmin.from("messages").select("id").in("account_id", accountIds),
    supabaseAdmin
      .from("thread_participants")
      .select("id")
      .in("account_id", accountIds),
    ownedConnectionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from("message_notifications")
          .select("id")
          .in("connection_id", ownedConnectionIds),
    ownedConnectionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from("threads")
          .select("id")
          .in("connection_id", ownedConnectionIds),
    ownedConnectionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from("messages")
          .select("id")
          .in("connection_id", ownedConnectionIds),
    ownedConnectionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from("thread_participants")
          .select("id")
          .in("connection_id", ownedConnectionIds),
  ]);
  if (
    orphanChecks.some(
      (result) => result.error || (result.data ?? []).length > 0,
    )
  ) {
    throw new Error(
      "demo clear left discussion rows outside the cleanup manifest",
    );
  }
  // A response-loss upload may have become visible while the first storage
  // listing was in flight. Re-fence, sweep every exact account prefix again,
  // and prove the prefixes are empty before Auth/finalization can release the
  // run.
  await heartbeat("pre-final storage sweep");
  const finalStorage = await Promise.all(
    accountIds.map((id) => collectStoragePaths(id)),
  );
  await removeStorageObjects(
    [...new Set(finalStorage.flatMap((row) => row.documentPaths))],
    [...new Set(finalStorage.flatMap((row) => row.entityFilePaths))],
    [...new Set(finalStorage.flatMap((row) => row.attachmentPaths))],
  );
  await heartbeat("final storage sweep");
  const remainingStorage = await Promise.all(
    accountIds.map((id) => collectStoragePaths(id)),
  );
  if (
    remainingStorage.some(
      (row) =>
        row.documentPaths.length ||
        row.entityFilePaths.length ||
        row.attachmentPaths.length,
    )
  ) {
    throw new Error(
      "demo clear left storage objects under an exact manifest prefix",
    );
  }

  // Claims are server-owned lifecycle receipts, not customer data. The
  // account lock and claim wait fence new ordinary work, so successful clear
  // removes every terminal/remaining claim before finalization.
  const { error: ingestClaimCleanupError } = await supabaseAdmin
    .from("demo_run_ingest_claims")
    .delete()
    .in("account_id", accountIds);
  if (ingestClaimCleanupError) {
    throw new Error(
      `delete demo ingest claims failed: ${ingestClaimCleanupError.message}`,
    );
  }
  const { data: remainingIngestClaims, error: remainingIngestClaimsError } =
    await supabaseAdmin
      .from("demo_run_ingest_claims")
      .select("id")
      .in("account_id", accountIds);
  if (remainingIngestClaimsError || (remainingIngestClaims ?? []).length > 0) {
    throw new Error("demo clear left ingest lifecycle claims");
  }

  // Actors may have accepted a normal membership invitation into the root
  // household. Remove every membership/profile row by the manifest-owned
  // actor identity before deleting auth.users; otherwise the account_members
  // row would be nulled by its FK and survive as an unexplained active slot.
  if (actorIds.length > 0) {
    const { error: actorMemberStateError } = await supabaseAdmin
      .from("member_state")
      .delete()
      .in("user_id", actorIds);
    if (actorMemberStateError) {
      throw new Error(
        `delete demo actor member state failed: ${actorMemberStateError.message}`,
      );
    }
    const { data: remainingActorMemberState, error: remainingActorStateError } =
      await supabaseAdmin
        .from("member_state")
        .select("user_id")
        .in("user_id", actorIds);
    if (
      remainingActorStateError ||
      (remainingActorMemberState ?? []).length > 0
    ) {
      throw new Error(
        remainingActorStateError?.message ??
          "demo clear left synthetic actor member_state rows",
      );
    }
  }
  for (const actorId of actorIds) {
    const { error: actorMembershipError } = await supabaseAdmin
      .from("account_members")
      .delete()
      .eq("user_id", actorId)
      .in("account_id", accountIds);
    if (actorMembershipError) {
      throw new Error(
        `delete demo actor memberships failed: ${actorMembershipError.message}`,
      );
    }
    const { error: actorProfileError } = await supabaseAdmin
      .from("members")
      .delete()
      .eq("user_id", actorId);
    if (actorProfileError) {
      throw new Error(
        `delete demo actor profiles failed: ${actorProfileError.message}`,
      );
    }
  }

  // Companion accounts deliberately remain visible in the manifest until the
  // atomic SQL finalizer. This keeps strict account validation retryable after
  // any Auth or heartbeat/finalization failure.
  for (const actor of actors) {
    const actorId = actor.userId;
    const { error: tombstoneError } = await supabaseAdmin.rpc(
      "register_demo_auth_cleanup",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actor.actorKey,
        p_resolved_user_id: actorId,
        p_expected_email: actor.expectedEmail,
        p_operation: "clear",
      },
    );
    if (tombstoneError) {
      throw new Error(
        `register synthetic actor deletion failed: ${tombstoneError.message}`,
      );
    }
    if (!authIdsPresent.has(actorId)) {
      const { error: markMissingError } = await supabaseAdmin.rpc(
        "mark_demo_auth_deleted",
        {
          p_run_id: runId,
          p_lease_token: leaseToken,
          p_actor_key: actor.actorKey,
          p_resolved_user_id: actorId,
          p_operation: "clear",
        },
      );
      if (markMissingError) throw new Error(markMissingError.message);
      continue;
    }
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(actorId);
      const authError = error as
        ({ status?: number; code?: string } & Error) | null;
      // A previous compensating cleanup may already have removed one actor
      // before retaining the failed manifest. Treat that exact idempotent
      // outcome as success; every other auth failure keeps the run retryable.
      if (authError && !isAuthUserNotFoundError(authError)) {
        throw new Error(`delete synthetic actor failed: ${authError.message}`);
      }
    } catch (error) {
      if (isAuthUserNotFoundError(error)) {
        // Exact missing Auth is idempotent only because the actor identity was
        // validated against this run's durable manifest above.
      } else {
        throw error;
      }
    }
    const { error: markDeletedError } = await supabaseAdmin.rpc(
      "mark_demo_auth_deleted",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actor.actorKey,
        p_resolved_user_id: actorId,
        p_operation: "clear",
      },
    );
    if (markDeletedError) throw new Error(markDeletedError.message);
  }
  await heartbeat("auth cleanup");

  // The finalizer is the only operation allowed to restore the root name and
  // real users' member_state, release the optional demo persona/flag, and
  // remove the run manifest. It runs last so every earlier failure retains
  // the run, snapshots, persona, and demo identity for a retry.
  let finalized: unknown = null;
  let finalizeError: { message: string } | null = null;
  try {
    const result = await supabaseAdmin.rpc("finalize_demo_clear", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_release_demo: releaseDemoFlag,
      p_release_persona: releaseDemoFlag,
      p_actor_user_id: userId,
    });
    finalized = result.data;
    finalizeError = result.error;
  } catch (error) {
    finalizeError = {
      message: error instanceof Error ? error.message : String(error),
    };
  }
  let finalizedResult = finalized as {
    outcome?: string;
    completed_at?: unknown;
  } | null;
  if (finalizeError) {
    // Finalization deletes the run as its last statement. If the response was
    // lost, only an exact service-role read proving that this run is absent
    // can turn the error into success; an unreadable or still-present run is
    // retained for retry.
    const { data: remainingRun, error: inspectError } = await supabaseAdmin
      .from("demo_runs")
      .select("id")
      .eq("id", runId)
      .maybeSingle();
    if (inspectError || remainingRun) {
      throw new Error(`finalize demo clear failed: ${finalizeError.message}`);
    }
    finalizedResult = { outcome: "finalized" };
  }
  if (!finalizedResult || finalizedResult.outcome !== "finalized") {
    throw new Error("finalize demo clear returned an invalid result");
  }
  const summary = {
    cleared: true,
    accountId: rootAccountId,
    runId,
    companionAccounts: companionAccountIds.length,
    syntheticActors: actorIds.length,
  } as const;
  return typeof finalizedResult.completed_at === "string"
    ? { ...summary, lastClearedAt: finalizedResult.completed_at }
    : summary;
}

export async function claimDemoClearWithReconciliation(
  rootAccountId: number,
): Promise<{
  outcome?: string;
  run_id?: number;
  lease_token?: string;
  status?: string;
}> {
  const leaseToken = crypto.randomUUID();
  let result: {
    data?: unknown;
    error?: { code?: string; message: string } | null;
  };
  let rpcFailure: unknown = null;
  try {
    result = await supabaseAdmin.rpc("claim_demo_clear", {
      p_root_account_id: rootAccountId,
      p_lease_token: leaseToken,
    });
  } catch (caught) {
    rpcFailure = caught;
    result = {
      data: null,
      error: {
        message: caught instanceof Error ? caught.message : String(caught),
      },
    };
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as {
    outcome?: string;
    run_id?: number;
    lease_token?: string;
    status?: string;
  } | null;
  if (
    !result.error &&
    row &&
    (row.outcome === "no_run" ||
      (row.outcome === "claimed" &&
        typeof row.run_id === "number" &&
        row.lease_token === leaseToken &&
        row.status === "clearing"))
  ) {
    return row;
  }
  if (
    result.error &&
    (result.error.code === "lock_not_available" ||
      /already owns|busy|in progress/i.test(result.error.message))
  ) {
    throw result.error;
  }

  // Adopt a response-loss claim only when the exact caller-generated token is
  // visible on the expected root in clearing state. A generic RPC error or a
  // different lease never becomes ownership by inference.
  const { data: reconciled, error: readError } = await supabaseAdmin
    .from("demo_runs")
    .select("id, lease_token, status")
    .eq("root_account_id", rootAccountId)
    .eq("lease_token", leaseToken)
    .eq("operation", "clear")
    .eq("status", "clearing")
    .maybeSingle();
  if (
    !readError &&
    reconciled &&
    typeof reconciled.id === "number" &&
    reconciled.lease_token === leaseToken &&
    reconciled.status === "clearing"
  ) {
    return {
      outcome: "claimed",
      run_id: reconciled.id as number,
      lease_token: reconciled.lease_token as string,
      status: reconciled.status as string,
    };
  }
  throw (
    rpcFailure ??
    result.error ??
    new Error("claim_demo_clear returned no result")
  );
}

async function clearDemoData(
  accountId: number,
  releaseDemoFlag: boolean,
  userId: string,
) {
  // Server-side tenancy gate: must run before ANY delete or storage removal.
  // See the module docstring and NotDemoAccountError for why this refuses
  // rather than proceeding on any doubt.
  await assertDemoAccount(accountId);
  // Capture the authoritative phase before claim_demo_clear changes an
  // active run to clearing. Failed/seeding partial runs intentionally use
  // the tolerant compensating cleanup path below.
  const preClaimRun = await findActiveDemoRun(accountId);

  let claim: unknown;
  let claimError: { code?: string; message: string } | null = null;
  try {
    claim = await claimDemoClearWithReconciliation(accountId);
  } catch (error) {
    claimError = error as { code?: string; message: string };
  }
  if (claimError) {
    if (
      claimError.code === "lock_not_available" ||
      /already owns|busy|in progress/i.test(claimError.message)
    ) {
      throw new DemoRunBusyError();
    }
    throw new Error(`claim demo clear failed: ${claimError.message}`);
  }

  const claimRow = (Array.isArray(claim) ? claim[0] : claim) as {
    outcome?: string;
    run_id?: number;
    lease_token?: string;
    status?: string;
  } | null;
  if (!claimRow || claimRow.outcome === "no_run") {
    // Receipt reconciliation happens only after the atomic claim attempt and
    // only the SQL proof (released account, no live run, no live membership)
    // can turn a lost finalizer response into success.
    if (releaseDemoFlag) {
      const receiptRootAccountId = await getReleaseReceipt(userId);
      if (receiptRootAccountId === accountId) {
        return { cleared: true as const, accountId, alreadyCleared: true };
      }
      throw new Error("no active demo run and no release proof");
    }
    // A non-release clear is idempotent only after the server-side demo gate
    // above; it never creates a new destructive scope.
    return { cleared: true as const, accountId, alreadyCleared: true };
  }
  if (
    claimRow.outcome !== "claimed" ||
    !Number.isFinite(Number(claimRow.run_id)) ||
    typeof claimRow.lease_token !== "string" ||
    claimRow.status !== "clearing"
  ) {
    throw new Error("claim demo clear returned an invalid result");
  }

  const run = {
    id: Number(claimRow.run_id),
    status: "clearing",
    updated_at: new Date().toISOString(),
    leaseToken: claimRow.lease_token,
  };
  try {
    if (preClaimRun?.status === "active") {
      const { error: inventoryError } = await supabaseAdmin.rpc(
        "assert_official_demo_inventory",
        { p_run_id: run.id, p_require_active: true },
      );
      if (inventoryError) {
        throw new Error(
          `official demo inventory assertion failed: ${inventoryError.message}`,
        );
      }
    }
    return await clearOfficialDemoBundle(
      accountId,
      run,
      releaseDemoFlag,
      userId,
      preClaimRun?.status !== "active",
    );
  } catch (error) {
    const { error: retainError } = await supabaseAdmin.rpc("fail_demo_run", {
      p_run_id: run.id,
      p_lease_token: run.leaseToken,
      p_operation: "clear",
    });
    if (retainError) {
      console.error(
        "clear_demo: failed to retain failed demo run",
        retainError,
      );
    }
    throw error;
  }
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

  let releaseDemoFlag: boolean;
  try {
    releaseDemoFlag = await parseReleaseDemoFlag(req);
  } catch {
    return createErrorResponse(400, "Invalid clear request");
  }

  const accountId = await resolveAccountId(user.id);
  if (!accountId) {
    if (releaseDemoFlag) {
      try {
        const receiptRootAccountId = await getReleaseReceipt(user.id);
        if (receiptRootAccountId !== null) {
          return new Response(
            JSON.stringify({
              cleared: true,
              accountId: receiptRootAccountId,
              alreadyCleared: true,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }
      } catch (error) {
        console.error("clear_demo: release receipt lookup failed", error);
      }
    }
    return createErrorResponse(409, "No active account for user");
  }

  try {
    const summary = await clearDemoData(accountId, releaseDemoFlag, user.id);
    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    if (e instanceof NotDemoAccountError) {
      return createErrorResponse(403, e.message);
    }
    if (e instanceof DemoRunBusyError) {
      return createErrorResponse(409, e.message);
    }
    console.error("clear_demo failed:", e);
    return createErrorResponse(500, "Couldn't clear the demo data. Try again.");
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
