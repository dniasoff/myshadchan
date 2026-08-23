import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import {
  findUnfinishedDemoRun,
  resolveAccountId,
  type UnfinishedDemoRun,
} from "../_shared/resolveDemoAccount.ts";
import {
  SINGLES,
  SINGLE_NOTES,
  SINGLE_PREFERENCES,
  SHADCHANIM,
  REFERENCES,
  RIVKY_SUGGESTIONS,
  YAAKOV_SUGGESTIONS,
  REFERENCE_LINKS,
  TIMELINE_NOTES,
  STATUS_CHANGES,
  TASKS,
  EXTRA_REDTS,
  RESUME_FILES,
  RESUME_PHOTOS,
  ENTITY_FILES,
  OFFICIAL_DEMO_BUNDLE,
  MEDICAL_NOTES,
  EXTERNAL_LINKS,
  DATE_RECORDS,
  daysAgo,
  daysAgoIso,
  daysFromNowIso,
  validateDemoDataset,
  validateOfficialDemoBundle,
  type DemoSuggestion,
} from "../_shared/demoDataset.ts";
import { DEMO_SHARE_ASSET_KEY, getAssetBytes } from "./assets/manifest.ts";

/**
 * Plants the curated realistic demo dataset (singles/shadchanim/references/
 * shidduchim/tasks/interactions, plus resume files, photos, entity files,
 * medical notes, external links, and date records) into the caller's own,
 * currently-empty account, then flips accounts.demo = true.
 *
 * Root and companion domain writes use a service-role client carrying the
 * exact seed lease; the database write barrier rejects that marker after the
 * lease is stale. Actor RPCs still use their synthetic JWTs so normal RLS and
 * account resolution are exercised. The unmarked admin client is retained for
 * authoritative reads, Auth reconciliation, and cleanup only.
 */

// Tables checked by the empty-account guard below. Broader than "just
// singles": an account that already has shadchanim/references/shidduchim
// but (for whatever reason) zero singles should not be re-seeded either —
// re-seeding on top of partial data would produce a mixed, inconsistent
// state. Any row in any of these means "not empty".
const NON_EMPTY_GUARD_TABLES = [
  "singles",
  "single_preferences",
  "single_notes",
  "shadchanim",
  "references",
  "shidduchim",
  "inbox_items",
  "message_notifications",
  "task_notifications",
  "messages",
  "threads",
  "thread_participants",
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
  "interactions",
  "identity_signals",
  "listing_withdrawal_locks",
  "trusted_senders",
  "listings",
  "invites",
  "analytics_events",
  "share_links",
] as const;

/** PostgreSQL bigint values must never be silently rounded by JSON/JS.  The
 * demo seed only proceeds with IDs that are explicitly positive, integral,
 * and safe to represent as a JavaScript number.  Decimal strings and bigint
 * values are accepted only after the same boundary check. */
export function requireSafePositiveBigintId(
  value: unknown,
  label: string,
): number {
  let candidate: bigint;
  if (typeof value === "bigint") candidate = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} is not a safe PostgreSQL bigint`);
    }
    candidate = BigInt(value);
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    try {
      candidate = BigInt(value);
    } catch {
      throw new Error(`${label} is not a valid PostgreSQL bigint`);
    }
  } else {
    throw new Error(`${label} is missing or malformed`);
  }
  if (candidate <= 0n || candidate > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the safe positive bigint range`);
  }
  return Number(candidate);
}

// True when the account has no rows in any of NON_EMPTY_GUARD_TABLES. Reads
// via supabaseAdmin so the check is authoritative regardless of RLS
// visibility quirks.
async function isAccountEmpty(accountId: number): Promise<boolean> {
  const { data: account, error: accountError } = await supabaseAdmin
    .from("accounts")
    .select("kind")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError) {
    throw new Error(
      `failed to check demo root context: ${accountError.message}`,
    );
  }
  if (!account || account.kind !== "household") return false;

  const counts = await Promise.all(
    NON_EMPTY_GUARD_TABLES.map(async (table) => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId);
      if (error) {
        throw new Error(`failed to check existing ${table}: ${error.message}`);
      }
      return count ?? 0;
    }),
  );

  const endpointFilter = `household_account_id.eq.${accountId},shadchanus_account_id.eq.${accountId}`;
  const [connectionRows, connectionInviteRows, childGrantRows] =
    await Promise.all([
      supabaseAdmin.from("connections").select("id").or(endpointFilter),
      supabaseAdmin
        .from("connection_invites")
        .select("id")
        .or(
          `inviter_account_id.eq.${accountId},accepted_by_account_id.eq.${accountId}`,
        ),
      supabaseAdmin
        .from("child_grants")
        .select("id")
        .or(
          `proposer_account_id.eq.${accountId},grantee_account_id.eq.${accountId}`,
        ),
    ]);
  for (const result of [connectionRows, connectionInviteRows, childGrantRows]) {
    if (result.error) {
      throw new Error(
        `failed to check relationship emptiness: ${result.error.message}`,
      );
    }
  }

  const connectionIds = (connectionRows.data ?? []).map((row) =>
    requireSafePositiveBigintId(row.id, "demo connection id"),
  );
  const connectionScopedTables = [
    "messages",
    "message_notifications",
    "threads",
    "thread_participants",
  ];
  const connectionScopedCounts = await Promise.all(
    connectionIds.length === 0
      ? []
      : connectionScopedTables.map(async (table) => {
          const { count, error } = await supabaseAdmin
            .from(table)
            .select("id", { count: "exact", head: true })
            .in("connection_id", connectionIds);
          if (error) {
            throw new Error(
              `failed to check existing ${table}: ${error.message}`,
            );
          }
          return count ?? 0;
        }),
  );

  const storageChecks = await Promise.all(
    ["documents", "entity-files", "attachments"].map(async (bucket) => {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(String(accountId), { limit: 1 });
      if (error) {
        throw new Error(
          `failed to check existing ${bucket} storage: ${error.message}`,
        );
      }
      return data?.length ?? 0;
    }),
  );

  return [
    ...counts,
    connectionRows.data?.length ?? 0,
    connectionInviteRows.data?.length ?? 0,
    childGrantRows.data?.length ?? 0,
    ...connectionScopedCounts,
    ...storageChecks,
  ].every((count) => count === 0);
}

export function randomSecret(): string {
  // Auth currently hashes passwords with bcrypt, whose input limit is 72
  // UTF-8 bytes.  Keep a full 256 bits of entropy while staying below that
  // limit even though the secret is later passed through create/update/sign-in.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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

async function findAuthUserForDemoActorIntent(
  expectedEmail: string,
  runId: number,
  actorKey: string,
): Promise<{ id: string } | null> {
  const users = await listAllAuthUsers();
  const match = users.find(
    (candidate) =>
      candidate.email?.toLowerCase() === expectedEmail.toLowerCase() &&
      candidate.app_metadata?.demo === true &&
      candidate.app_metadata?.demo_run_id === runId &&
      candidate.app_metadata?.demo_actor_key === actorKey,
  );
  return match ? { id: match.id } : null;
}

function publicSupabaseClient(accessToken?: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SB_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      "",
    accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : undefined,
  );
}

/**
 * Seed-domain writes use a service-role client carrying an exact, short-lived
 * run lease.  The database accepts this marker only for the service role and
 * only while that run is seeding; a real customer's JWT never becomes a
 * lifecycle bypass.  The marker also lets account-default triggers preserve
 * the normal current-context semantics during the service-owned seed.
 */
function seedServiceClient(runId: number, leaseToken: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          "x-demo-run-id": String(runId),
          "x-demo-lease-token": leaseToken,
        },
      },
    },
  );
}

async function signInSyntheticActor(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = publicSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`sign in synthetic actor failed: ${error?.message}`);
  }
  return publicSupabaseClient(data.session.access_token);
}

type RealRootMember = { id: number; userId: string; email: string };

/** Resolve the real customer memberships that already own the root context.
 * Admin reseed creates a temporary maintenance login so it can exercise the
 * normal seed endpoint; that login must never receive companion ownership or
 * appear in the observer participant list. */
export async function listRealRootMembers(
  rootAccountId: number,
): Promise<RealRootMember[]> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("account_members")
    .select("id, user_id")
    .eq("account_id", rootAccountId)
    .eq("status", "active");
  if (membershipError) {
    throw new Error(
      `list active root members failed: ${membershipError.message}`,
    );
  }

  const userIds = (memberships ?? [])
    .map((membership) => membership.user_id)
    .filter((userId): userId is string => typeof userId === "string");
  if (userIds.length === 0) return [];
  const { data: members, error: membersError } = await supabaseAdmin
    .from("members")
    .select("user_id, email")
    .in("user_id", userIds);
  if (membersError) {
    throw new Error(`list active root users failed: ${membersError.message}`);
  }
  const membersById = new Map(
    (members ?? []).map((member) => [member.user_id, member]),
  );

  return (memberships ?? []).flatMap((membership) => {
    if (typeof membership.user_id !== "string") return [];
    const member = membersById.get(membership.user_id);
    const email = member?.email?.toLowerCase() ?? "";
    if (!member || !email || email.endsWith("@atomic-crm-demo.internal")) {
      return [];
    }
    return [
      {
        id: requireSafePositiveBigintId(
          membership.id,
          "real root membership id",
        ),
        userId: membership.user_id,
        email,
      },
    ];
  });
}

async function rpcRow<T>(
  client: SupabaseClient,
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(functionName, params);
  if (error) throw new Error(`${functionName} failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row == null) throw new Error(`${functionName} returned no row`);
  return row as T;
}

async function rpcValue<T>(
  client: SupabaseClient,
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(functionName, params);
  if (error) throw new Error(`${functionName} failed: ${error.message}`);
  return data as T;
}

type DemoSeedLifecycle = {
  run_id: number;
  lease_token: string;
  lease_epoch?: number;
  original_root_name?: string | null;
};

export async function beginDemoSeedWithReconciliation(
  rootAccountId: number,
): Promise<DemoSeedLifecycle> {
  const leaseToken = crypto.randomUUID();
  let data: unknown = null;
  let error: { message: string } | null = null;
  let rpcFailure: unknown = null;
  try {
    const result = await supabaseAdmin.rpc("begin_demo_seed", {
      p_root_account_id: rootAccountId,
      p_lease_token: leaseToken,
    });
    data = result.data;
    error = result.error;
  } catch (caught) {
    rpcFailure = caught;
    error = {
      message: caught instanceof Error ? caught.message : String(caught),
    };
  }
  const row = data as Partial<DemoSeedLifecycle> | null;
  if (!error && row && row.lease_token === leaseToken) {
    return {
      run_id: requireSafePositiveBigintId(row.run_id, "demo seed run id"),
      lease_token: leaseToken,
      lease_epoch:
        row.lease_epoch === undefined
          ? undefined
          : requireSafePositiveBigintId(
              row.lease_epoch,
              "demo seed lease epoch",
            ),
      original_root_name: row.original_root_name,
    };
  }

  // A committed transaction can lose only the response. Adopt it only when a
  // service-role read proves this exact caller-generated lease owns the new
  // seeding run; generic RPC errors never become inferred success.
  const { data: reconciled, error: readError } = await supabaseAdmin
    .from("demo_runs")
    .select(
      "id, root_account_id, lease_token, lease_epoch, original_root_name, status, operation, lease_expires_at",
    )
    .eq("root_account_id", rootAccountId)
    .eq("lease_token", leaseToken)
    .eq("operation", "seed")
    .eq("status", "seeding")
    .maybeSingle();
  if (
    !readError &&
    reconciled &&
    reconciled.lease_token === leaseToken &&
    reconciled.status === "seeding" &&
    reconciled.operation === "seed" &&
    typeof reconciled.lease_expires_at === "string" &&
    new Date(reconciled.lease_expires_at).getTime() > Date.now()
  ) {
    return {
      run_id: requireSafePositiveBigintId(
        reconciled.id,
        "reconciled demo run id",
      ),
      lease_token: reconciled.lease_token as string,
      lease_epoch:
        reconciled.lease_epoch == null
          ? undefined
          : requireSafePositiveBigintId(
              reconciled.lease_epoch,
              "reconciled demo lease epoch",
            ),
      original_root_name: reconciled.original_root_name as
        string | null | undefined,
    };
  }
  throw (
    rpcFailure ??
    error ??
    new Error("begin_demo_seed returned an invalid result")
  );
}

export async function activateDemoRunWithReconciliation(
  runId: number,
  leaseToken: string,
  activeRootName: string,
): Promise<void> {
  const seedDb = seedServiceClient(runId, leaseToken);
  let rpcError: { message: string } | null = null;
  try {
    const { data, error } = await seedDb.rpc("activate_demo_run", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_active_root_name: activeRootName,
    });
    if (!error && data?.status === "active") return;
    rpcError = error;
    if (!rpcError)
      rpcError = { message: "activate demo run returned no result" };
  } catch (error) {
    rpcError = {
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!rpcError) return;

  // The activation RPC commits both rows in one transaction, but either HTTP
  // read can independently lose its response. Retry the exact identifiers,
  // and resolve the root through this run's root manifest rather than a name
  // or a guessed account id. Never turn a partial or wrong read into success.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [runRead, rootManifestRead] = await Promise.all([
      supabaseAdmin
        .from("demo_runs")
        .select("id, root_account_id, status, operation, lease_token")
        .eq("id", runId)
        .maybeSingle(),
      supabaseAdmin
        .from("demo_run_accounts")
        .select("account_id, is_root")
        .eq("run_id", runId)
        .eq("is_root", true)
        .maybeSingle(),
    ]);
    let rootAccountId: number | null = null;
    if (rootManifestRead.data?.account_id != null) {
      try {
        rootAccountId = requireSafePositiveBigintId(
          rootManifestRead.data.account_id,
          "demo root manifest account id",
        );
      } catch {
        rootAccountId = null;
      }
    }
    const rootRead = rootAccountId
      ? await supabaseAdmin
          .from("accounts")
          .select("id, name, demo")
          .eq("id", rootAccountId)
          .maybeSingle()
      : { data: null, error: null };
    const run = runRead.data as {
      id?: unknown;
      root_account_id?: unknown;
      status?: unknown;
      operation?: unknown;
      lease_token?: unknown;
    } | null;
    const root = rootRead.data as {
      id?: unknown;
      name?: unknown;
      demo?: unknown;
    } | null;
    let observedRunId: number | null = null;
    let observedRootId: number | null = null;
    try {
      observedRunId = requireSafePositiveBigintId(
        run?.id,
        "activated demo run id",
      );
      observedRootId = requireSafePositiveBigintId(
        root?.id,
        "activated demo root id",
      );
    } catch {
      observedRunId = null;
      observedRootId = null;
    }
    if (
      !runRead.error &&
      !rootManifestRead.error &&
      !rootRead.error &&
      observedRunId === runId &&
      rootAccountId !== null &&
      rootAccountId ===
        (() => {
          try {
            return requireSafePositiveBigintId(
              run.root_account_id,
              "demo run root account id",
            );
          } catch {
            return null;
          }
        })() &&
      run.status === "active" &&
      run.operation == null &&
      run.lease_token == null &&
      observedRootId === rootAccountId &&
      root.demo === true &&
      root.name === activeRootName
    ) {
      return;
    }
  }
  throw new Error(`activate demo run failed: ${rpcError.message}`);
}

async function heartbeatDemoRun(
  runId: number,
  leaseToken: string,
  phase: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("heartbeat_demo_run", {
    p_run_id: runId,
    p_lease_token: leaseToken,
    p_operation: "seed",
  });
  if (error) {
    throw new Error(
      `demo run heartbeat failed after ${phase}: ${error.message}`,
    );
  }
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

/** Compensating cleanup for the only partially-created state seed_demo may
 * produce. It is deliberately service-role-only and receives IDs created by
 * this invocation, never request-supplied IDs.
 *
 * The run manifest is the retry handle. It is therefore deleted only after
 * storage, tenant rows, companion accounts, and synthetic auth users all
 * report success. Any failure leaves the run marked failed with its manifest
 * rows intact so an operator can find and retry the cleanup. */
export async function cleanupPartialBundle(
  runId: number,
  rootAccountId: number,
  companionAccountIds: number[],
  syntheticUserIds: string[],
  leaseToken: string,
): Promise<boolean> {
  const accountIds = new Set<number>([rootAccountId, ...companionAccountIds]);
  const cleanupErrors: string[] = [];
  const recordError = (label: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    cleanupErrors.push(`${label}: ${message}`);
    console.error(`seed_demo: ${label}`, error);
  };
  const retainFailedRun = async () => {
    const { error: markFailedError } = await supabaseAdmin.rpc(
      "fail_demo_run",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_operation: "seed",
      },
    );
    if (markFailedError) {
      recordError("mark failed demo run", markFailedError);
    }
    console.error(
      `seed_demo: retaining failed run ${runId} for retry`,
      cleanupErrors,
    );
  };

  // The invocation-local arrays are only an optimization. A committed RPC
  // can lose its response, so the manifest is authoritative before any
  // account or Auth deletion is attempted.
  const { data: manifestAccounts, error: manifestAccountsError } =
    await supabaseAdmin
      .from("demo_run_accounts")
      .select("account_id, context_key, context_kind, is_root")
      .eq("run_id", runId);
  if (manifestAccountsError) {
    recordError("enumerate demo context manifest", manifestAccountsError);
    await retainFailedRun();
    return false;
  }
  const manifestAccountRows = (manifestAccounts ?? []) as Array<{
    account_id?: unknown;
    context_key?: unknown;
    context_kind?: unknown;
    is_root?: unknown;
  }>;
  const expectedKinds: Record<string, "household" | "shadchanus"> = {
    "primary-household": "household",
    "feldman-shadchanus": "shadchanus",
    "gross-household": "household",
  };
  const manifestRootIds: number[] = [];
  for (const row of manifestAccountRows.filter(
    (candidate) => candidate.is_root === true,
  )) {
    try {
      manifestRootIds.push(
        requireSafePositiveBigintId(
          row.account_id,
          "demo manifest root account id",
        ),
      );
    } catch {
      // The complete validation below reports the controlled failure.
    }
  }
  if (
    manifestAccountRows.length < 1 ||
    manifestAccountRows.length > 3 ||
    manifestRootIds.length !== 1 ||
    manifestRootIds[0] !== rootAccountId ||
    manifestAccountRows.some(
      (row) =>
        (() => {
          try {
            requireSafePositiveBigintId(
              row.account_id,
              "demo manifest account id",
            );
            return false;
          } catch {
            return true;
          }
        })() ||
        typeof row.context_key !== "string" ||
        expectedKinds[row.context_key] !== row.context_kind ||
        (row.context_key === "primary-household") !== (row.is_root === true),
    )
  ) {
    recordError(
      "demo context manifest root mismatch",
      new Error(`expected exactly one root account ${rootAccountId}`),
    );
    await retainFailedRun();
    return false;
  }
  const manifestAccountIds = manifestAccountRows.map((row) =>
    requireSafePositiveBigintId(row.account_id, "demo manifest account id"),
  );
  if (new Set(manifestAccountIds).size !== manifestAccountIds.length) {
    recordError(
      "duplicate demo context manifest account",
      new Error(`run ${runId} contains duplicate account ids`),
    );
    await retainFailedRun();
    return false;
  }
  const { data: actualAccounts, error: actualAccountsError } =
    await supabaseAdmin
      .from("accounts")
      .select("id, kind")
      .in("id", manifestAccountIds);
  if (
    actualAccountsError ||
    !actualAccounts ||
    actualAccounts.length !== manifestAccountIds.length ||
    actualAccounts.some(
      (account) =>
        !manifestAccountIds.includes(
          requireSafePositiveBigintId(account.id, "demo account id"),
        ) ||
        expectedKinds[
          manifestAccountRows.find((row) => row.account_id === account.id)
            ?.context_key as string
        ] !== account.kind,
    )
  ) {
    recordError(
      "demo context manifest actual-kind mismatch",
      actualAccountsError ??
        new Error("manifest account kind is not authoritative"),
    );
    await retainFailedRun();
    return false;
  }
  for (const row of manifestAccountRows)
    accountIds.add(
      requireSafePositiveBigintId(row.account_id, "demo manifest account id"),
    );

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
    recordError("enumerate demo actor manifest", manifestUsersResult.error);
    await retainFailedRun();
    return false;
  }
  if (actorIntentsResult.error) {
    recordError("enumerate demo actor intents", actorIntentsResult.error);
    await retainFailedRun();
    return false;
  }
  const actorRecords = new Map<
    string,
    { userId: string; expectedEmail: string }
  >();
  for (const row of (manifestUsersResult.data ?? []) as Array<{
    user_id?: unknown;
    actor_key?: unknown;
  }>) {
    if (
      typeof row.user_id !== "string" ||
      row.user_id.length === 0 ||
      typeof row.actor_key !== "string" ||
      row.actor_key.length === 0
    ) {
      recordError("invalid demo actor manifest", new Error("missing user id"));
      await retainFailedRun();
      return false;
    }
    if (actorRecords.has(row.actor_key)) {
      recordError("duplicate demo actor manifest", new Error(row.actor_key));
      await retainFailedRun();
      return false;
    }
    actorRecords.set(row.actor_key, {
      userId: row.user_id,
      expectedEmail: "",
    });
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
      recordError(
        "invalid pending demo actor intent",
        new Error("missing deterministic actor identity"),
      );
      await retainFailedRun();
      return false;
    }
    const existing = actorRecords.get(intent.actor_key);
    if (existing && existing.expectedEmail !== "") {
      recordError("duplicate demo actor intent", new Error(intent.actor_key));
      await retainFailedRun();
      return false;
    }
    if (
      existing &&
      typeof intent.auth_user_id === "string" &&
      existing.userId !== intent.auth_user_id
    ) {
      recordError(
        "demo actor manifest identity mismatch",
        new Error(intent.actor_key),
      );
      await retainFailedRun();
      return false;
    }
    actorRecords.set(intent.actor_key, {
      userId:
        typeof intent.auth_user_id === "string"
          ? intent.auth_user_id
          : (existing?.userId ?? ""),
      expectedEmail: intent.expected_email,
    });
  }
  let authUsers: DemoActorAuthUser[] = [];
  try {
    authUsers = actorRecords.size > 0 ? await listAllAuthUsers() : [];
  } catch (error) {
    recordError("enumerate synthetic actor Auth identities", error);
    await retainFailedRun();
    return false;
  }
  const authIdsPresent = new Set<string>();
  for (const [actorKey, actor] of actorRecords) {
    if (!actor.expectedEmail || !actor.userId) {
      const intent = (actorIntentsResult.data ?? []).find(
        (candidate) =>
          candidate.actor_key === actorKey &&
          typeof candidate.expected_email === "string",
      ) as { expected_email?: string } | undefined;
      if (intent?.expected_email) actor.expectedEmail = intent.expected_email;
    }
    if (!actor.userId && actor.expectedEmail) {
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
        recordError(
          "ambiguous synthetic actor Auth reconciliation",
          new Error(`${actorKey} has multiple exact Auth identities`),
        );
        await retainFailedRun();
        return false;
      }
      if (exactCandidates[0]) {
        actor.userId = exactCandidates[0].id;
        // A response-loss/orphan retry must durably reconcile the exact Auth
        // identity before cleanup records deletion progress. This is what
        // makes a later invocation safe even when syntheticUserIds is empty.
        const { error: reconcileError } = await supabaseAdmin.rpc(
          "reconcile_demo_actor",
          {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_actor_key: actorKey,
            p_user_id: actor.userId,
          },
        );
        if (reconcileError) {
          recordError("reconcile orphaned synthetic actor", reconcileError);
          await retainFailedRun();
          return false;
        }
      }
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
    if (
      (!authUser &&
        authUsers.some((candidate) => candidate.id === actor.userId)) ||
      conflictingAuthUser
    ) {
      recordError(
        "synthetic actor Auth identity mismatch",
        new Error(`${actorKey} is not an exact run-scoped Auth user`),
      );
      await retainFailedRun();
      return false;
    }
    if (authUser) authIdsPresent.add(authUser.id);
  }
  if (
    syntheticUserIds.some(
      (userId) =>
        ![...actorRecords.values()].some((actor) => actor.userId === userId),
    )
  ) {
    recordError(
      "unregistered synthetic actor",
      new Error("invocation actor is absent from the exact run identity set"),
    );
    await retainFailedRun();
    return false;
  }
  for (const actor of actorRecords.values()) {
    const actorId = actor.userId;
    if (!actorId) continue;
    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("account_members")
      .select("account_id, user_id")
      .eq("user_id", actorId);
    if (
      membershipError ||
      (memberships ?? []).some(
        (membership) =>
          membership.user_id !== actorId ||
          (() => {
            try {
              return !manifestAccountIds.includes(
                requireSafePositiveBigintId(
                  membership.account_id,
                  "synthetic actor membership account id",
                ),
              );
            } catch {
              return true;
            }
          })(),
      )
    ) {
      recordError(
        "synthetic actor has membership outside demo run",
        membershipError ?? new Error(actorId),
      );
      await retainFailedRun();
      return false;
    }
  }
  const accountScopedTables = [
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
    "shidduchim",
    "references",
    "shadchanim",
    // These rows reference singles through (account_id, single_id) and must
    // be removed before their parent singles.
    "single_preferences",
    "single_notes",
    "singles",
    "invites",
    "listings",
    "share_links",
    "analytics_events",
    "trusted_senders",
  ];
  const resourceTable: Record<string, string> = {
    connection: "connections",
    connection_invite: "connection_invites",
    child_grant: "child_grants",
    invite: "invites",
    single_preference: "single_preferences",
    single_note: "single_notes",
  };
  const allowedResourceTypes = new Set([
    "invite",
    "connection_invite",
    "child_grant",
    "connection",
    "thread",
    "message",
    "listing",
    "listing_withdrawal",
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
  ]);
  const { data: resources, error: resourceError } = await supabaseAdmin
    .from("demo_run_resources")
    .select("resource_type, resource_id")
    .eq("run_id", runId);
  if (resourceError) {
    recordError("enumerate registered demo resources", resourceError);
    await retainFailedRun();
    return false;
  }
  if (
    (resources ?? []).some(
      (resource) => !allowedResourceTypes.has(resource.resource_type as string),
    )
  ) {
    recordError(
      "invalid registered demo resource type",
      new Error("manifest contains an unsupported resource type"),
    );
    await retainFailedRun();
    return false;
  }

  // Every manifest row is a delete capability.  Validate the row's complete
  // ownership graph while all parents still exist, including private single
  // content and relationship target endpoints.  Missing rows are tolerated
  // for response-loss retries; present rows must be owned by this run.
  for (const resource of resources ?? []) {
    const resourceId = requireSafePositiveBigintId(
      resource.resource_id,
      `${resource.resource_type} manifest resource id`,
    );
    const { error: ownershipError } = await supabaseAdmin.rpc(
      "assert_demo_resource_ownership",
      {
        p_run_id: runId,
        p_resource_type: resource.resource_type,
        p_resource_id: resourceId,
        p_require_present: false,
      },
    );
    if (ownershipError) {
      recordError(
        `validate partial resource ${resource.resource_type}/${resource.resource_id}`,
        ownershipError,
      );
      await retainFailedRun();
      return false;
    }
  }

  const { data: leaseValid, error: leaseError } = await supabaseAdmin.rpc(
    "demo_run_lease_is_current",
    { p_run_id: runId, p_lease_token: leaseToken, p_operation: "seed" },
  );
  if (leaseError || leaseValid !== true) {
    // A clear may have fenced this worker. Never let a late seed cleanup
    // delete rows now owned by the clearing worker.
    recordError(
      "seed lease fenced before cleanup",
      leaseError ?? "stale lease",
    );
    return false;
  }
  const { error: restoreError } = await supabaseAdmin.rpc(
    "restore_demo_member_state",
    {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_operation: "seed",
    },
  );
  if (restoreError) {
    recordError("restore member state before seed compensation", restoreError);
    await retainFailedRun();
    return false;
  }

  const storageByBucket = new Map<string, string[]>();
  const addStorage = (bucket: string, path: unknown) => {
    if (typeof path !== "string" || path.length === 0) return;
    const paths = storageByBucket.get(bucket) ?? [];
    paths.push(path);
    storageByBucket.set(bucket, paths);
  };
  let resumeRows: Array<{ files: unknown }> = [];
  let photoRows: Array<{ path: unknown }> = [];
  let entityFileRows: Array<{ storage_path: unknown }> = [];
  let inboxItems: Array<{ attachments: unknown }> = [];
  let manifestStorageRows: Array<{
    bucket: unknown;
    storage_path: unknown;
    resource_key: unknown;
  }> = [];
  let storageStageFailed = false;
  try {
    const [
      resumeResult,
      photoResult,
      entityFileResult,
      inboxResult,
      manifestStorageResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("resumes")
        .select("files")
        .in("account_id", [...accountIds]),
      supabaseAdmin
        .from("resume_photos")
        .select("path")
        .in("account_id", [...accountIds]),
      supabaseAdmin
        .from("entity_files")
        .select("storage_path")
        .in("account_id", [...accountIds]),
      supabaseAdmin
        .from("inbox_items")
        .select("attachments")
        .in("account_id", [...accountIds]),
      supabaseAdmin
        .from("demo_run_storage")
        .select("bucket, storage_path, resource_key")
        .eq("run_id", runId),
    ]);
    if (resumeResult.error) {
      storageStageFailed = true;
      recordError("enumerate resume storage", resumeResult.error);
    }
    if (photoResult.error) {
      storageStageFailed = true;
      recordError("enumerate photo storage", photoResult.error);
    }
    if (entityFileResult.error) {
      storageStageFailed = true;
      recordError("enumerate entity-file storage", entityFileResult.error);
    }
    if (inboxResult.error) {
      storageStageFailed = true;
      recordError("enumerate inbox attachment storage", inboxResult.error);
    }
    if (manifestStorageResult.error) {
      storageStageFailed = true;
      recordError(
        "enumerate registered demo storage",
        manifestStorageResult.error,
      );
    }
    resumeRows = (resumeResult.data ?? []) as Array<{ files: unknown }>;
    photoRows = (photoResult.data ?? []) as Array<{ path: unknown }>;
    entityFileRows = (entityFileResult.data ?? []) as Array<{
      storage_path: unknown;
    }>;
    inboxItems = (inboxResult.data ?? []) as Array<{ attachments: unknown }>;
    manifestStorageRows = (manifestStorageResult.data ?? []) as Array<{
      bucket: unknown;
      storage_path: unknown;
      resource_key: unknown;
    }>;
  } catch (error) {
    storageStageFailed = true;
    recordError("enumerate storage for partial cleanup", error);
  }
  for (const resume of resumeRows) {
    for (const file of Array.isArray(resume.files) ? resume.files : []) {
      addStorage("documents", file?.path);
    }
  }
  for (const photo of photoRows) addStorage("documents", photo.path);
  for (const file of entityFileRows)
    addStorage("entity-files", file.storage_path);
  for (const item of inboxItems) {
    for (const attachment of Array.isArray(item.attachments)
      ? item.attachments
      : []) {
      if (typeof attachment === "object" && attachment !== null) {
        addStorage("attachments", (attachment as { path?: unknown }).path);
      }
    }
  }
  for (const row of manifestStorageRows) {
    if (typeof row.bucket === "string") {
      addStorage(row.bucket, row.storage_path);
    }
  }

  const allowedStorageBuckets = new Set([
    "documents",
    "entity-files",
    "attachments",
  ]);
  for (const [bucket, paths] of storageByBucket) {
    if (!allowedStorageBuckets.has(bucket)) {
      recordError("invalid demo storage bucket", new Error(bucket));
      storageStageFailed = true;
      continue;
    }
    for (const storagePath of paths) {
      if (
        ![...accountIds].some(
          (accountId) =>
            storagePath.startsWith(`${accountId}/`) &&
            !storagePath.split("/").includes(".."),
        )
      ) {
        recordError(
          "demo storage path is outside manifest accounts",
          new Error(`${bucket}/${storagePath}`),
        );
        storageStageFailed = true;
      }
    }
  }

  if (storageStageFailed) {
    await retainFailedRun();
    return false;
  }

  const { data: storageLeaseValid, error: storageLeaseError } =
    await supabaseAdmin.rpc("demo_run_lease_is_current", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_operation: "seed",
    });
  if (storageLeaseError || storageLeaseValid !== true) {
    recordError(
      "seed lease fenced before storage cleanup",
      storageLeaseError ?? "stale lease",
    );
    await retainFailedRun();
    return false;
  }

  for (const [bucket, paths] of storageByBucket) {
    const { error: storageFenceError } = await supabaseAdmin.rpc(
      "fence_demo_cleanup",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_operation: "seed",
      },
    );
    if (storageFenceError) {
      recordError(
        `seed lease fenced before storage cleanup for ${bucket}`,
        storageFenceError,
      );
      await retainFailedRun();
      return false;
    }
    try {
      const { error } = await supabaseAdmin.storage
        .from(bucket)
        .remove([...new Set(paths)]);
      if (error) {
        recordError(`partial storage cleanup failed for ${bucket}`, error);
      }
    } catch (error) {
      recordError(`partial storage cleanup threw for ${bucket}`, error);
    }
  }
  if (cleanupErrors.length > 0) {
    await retainFailedRun();
    return false;
  }

  for (const table of accountScopedTables) {
    const { error: fencedCleanupError } = await supabaseAdmin.rpc(
      "delete_demo_cleanup_rows",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_table_name: table,
        p_operation: "seed",
      },
    );
    if (fencedCleanupError) {
      recordError(`partial cleanup failed for ${table}`, fencedCleanupError);
      await retainFailedRun();
      return false;
    }
  }
  for (const resource of resources ?? []) {
    const table = resourceTable[resource.resource_type as string];
    if (!table) continue;
    let resourceId: number;
    try {
      resourceId = requireSafePositiveBigintId(
        resource.resource_id,
        `${resource.resource_type} cleanup resource id`,
      );
    } catch (error) {
      recordError(`invalid cleanup resource ${resource.resource_type}`, error);
      await retainFailedRun();
      return false;
    }
    const { error: fencedResourceError } = await supabaseAdmin.rpc(
      "delete_demo_resource",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_resource_type: resource.resource_type,
        p_resource_id: resourceId,
        p_operation: "seed",
      },
    );
    if (fencedResourceError) {
      recordError(`partial cleanup failed for ${table}`, fencedResourceError);
      await retainFailedRun();
      return false;
    }
  }

  // Keep companions until Auth cleanup has completed. The service RPC below
  // removes all companion contexts in one transaction, so a later failure
  // cannot leave a partially missing strict manifest.
  // This is the fenced path that will remove synthetic actor member state.
  for (const [actorKey, actor] of actorRecords) {
    const userId = actor.userId;
    if (!userId) continue;
    const { error: actorRowsError } = await supabaseAdmin.rpc(
      "delete_demo_actor_rows",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actorKey,
        p_user_id: userId,
        p_operation: "seed",
      },
    );
    if (actorRowsError) {
      recordError(`remove synthetic actor rows for ${userId}`, actorRowsError);
      await retainFailedRun();
      return false;
    }
    let tombstoneRegistered = false;
    const { error: tombstoneError } = await supabaseAdmin.rpc(
      "register_demo_auth_cleanup",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actorKey,
        p_resolved_user_id: userId,
        p_expected_email: actor.expectedEmail,
        p_operation: "seed",
      },
    );
    if (!tombstoneError) tombstoneRegistered = true;
    else if (!syntheticUserIds.includes(userId)) {
      recordError("register synthetic actor deletion", tombstoneError);
      await retainFailedRun();
      return false;
    }
    if (!authIdsPresent.has(userId)) {
      if (tombstoneRegistered) {
        const { error: markMissingError } = await supabaseAdmin.rpc(
          "mark_demo_auth_deleted",
          {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_actor_key: actorKey,
            p_resolved_user_id: userId,
            p_operation: "seed",
          },
        );
        if (markMissingError) {
          recordError(
            "mark missing synthetic actor deletion",
            markMissingError,
          );
          await retainFailedRun();
          return false;
        }
      }
      continue;
    }
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error && !isAuthUserNotFoundError(error)) {
        recordError(`remove synthetic actor ${userId}`, error);
        await retainFailedRun();
        return false;
      }
    } catch (error) {
      if (isAuthUserNotFoundError(error)) {
        // Exact missing Auth is idempotent only after the actor was resolved
        // against this run's manifest or invocation identity.
      } else {
        recordError(`remove synthetic actor ${userId}`, error);
        await retainFailedRun();
        return false;
      }
    }
    if (tombstoneRegistered) {
      const { error: markDeletedError } = await supabaseAdmin.rpc(
        "mark_demo_auth_deleted",
        {
          p_run_id: runId,
          p_lease_token: leaseToken,
          p_actor_key: actorKey,
          p_resolved_user_id: userId,
          p_operation: "seed",
        },
      );
      if (markDeletedError) {
        recordError("mark synthetic actor deletion", markDeletedError);
        await retainFailedRun();
        return false;
      }
    }
  }

  const actorUserIds = [...actorRecords.values()]
    .map((actor) => actor.userId)
    .filter((userId): userId is string => userId.length > 0);
  if (actorUserIds.length > 0) {
    const remainingSyntheticMemberState = await supabaseAdmin
      .from("member_state")
      .select("user_id")
      .in("user_id", actorUserIds);
    if (
      remainingSyntheticMemberState.error ||
      (remainingSyntheticMemberState.data ?? []).length > 0
    ) {
      recordError(
        "synthetic actor member state survived partial cleanup",
        remainingSyntheticMemberState.error ??
          new Error("manifest-owned actor member_state rows remain"),
      );
      await retainFailedRun();
      return false;
    }
  }

  const { error: companionCleanupError } = await supabaseAdmin.rpc(
    "delete_demo_companion_contexts",
    { p_run_id: runId, p_lease_token: leaseToken, p_operation: "seed" },
  );
  if (companionCleanupError) {
    recordError("remove companion contexts", companionCleanupError);
    await retainFailedRun();
    return false;
  }

  if (cleanupErrors.length > 0) {
    await retainFailedRun();
    return false;
  }

  // All manifest child FKs cascade from demo_runs. Delete only the parent
  // through the lease-fenced SQL finalizer after external/domain/auth cleanup
  // succeeds: if this final operation fails, the entire child graph remains
  // a usable retry handle.
  const { error: finalizeError } = await supabaseAdmin.rpc(
    "finalize_demo_seed_cleanup",
    { p_run_id: runId, p_lease_token: leaseToken },
  );
  if (finalizeError) {
    recordError("remove demo run", finalizeError);
    await retainFailedRun();
    return false;
  }
  return true;
}

type BundleSeedResult = {
  runId: number;
  contexts: number;
  syntheticActors: number;
  invitations: number;
  connections: number;
  grants: number;
  discussions: number;
  listings: number;
  shares: number;
  trustedSenders: number;
  simulatedReceipts: number;
};

export function computeSimulatedReceiptCounts(
  messageRows: readonly { message_id: unknown }[],
  reminderRows: readonly unknown[],
  shareRows: readonly unknown[],
): {
  messageReceiptCount: number;
  reminderReceiptCount: number;
  shareReceiptCount: number;
  total: number;
} {
  const messageReceiptCount = new Set(messageRows.map((row) => row.message_id))
    .size;
  const reminderReceiptCount = reminderRows.length;
  const shareReceiptCount = shareRows.length;
  return {
    messageReceiptCount,
    reminderReceiptCount,
    shareReceiptCount,
    total: messageReceiptCount + reminderReceiptCount + shareReceiptCount,
  };
}

/**
 * Message delivery fans out to every non-sender participant, but the official
 * baseline manifest records one simulated message outcome per message. Keep
 * every physical notification row in the database and choose the same
 * canonical receipt regardless of PostgREST response order.
 */
export function canonicalizeMessageNotificationRows(
  rows: readonly { id: unknown; message_id: unknown }[],
): Array<{ id: unknown; message_id: unknown }> {
  const byMessageId = new Map<
    number,
    { row: { id: unknown; message_id: unknown }; notificationId: number }
  >();
  for (const row of rows) {
    const messageId = requireSafePositiveBigintId(
      row.message_id,
      "demo message notification message id",
    );
    const notificationId = requireSafePositiveBigintId(
      row.id,
      "demo message notification id",
    );
    const existing = byMessageId.get(messageId);
    if (!existing || notificationId < existing.notificationId) {
      byMessageId.set(messageId, { row, notificationId });
    }
  }
  return [...byMessageId.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value.row);
}

/** The lifecycle already compensated a failed seed and removed its run. The
 * outer handler must surface the original error without creating a fresh
 * empty failed run that would block an immediate retry. */
class CompensatedDemoSeedError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CompensatedDemoSeedError";
  }
}

/** Seeds the full-product companion graph after the root's ordinary demo
 * records exist. All credentials remain server-side and all companion rows
 * are registered before the run becomes active. */
async function registerDemoResource(
  runId: number,
  leaseToken: string,
  resourceType: string,
  resourceId: unknown,
): Promise<void> {
  const safeResourceId = requireSafePositiveBigintId(
    resourceId,
    `${resourceType} resource id`,
  );
  await rpcValue(
    seedServiceClient(runId, leaseToken),
    "register_demo_resource",
    {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_resource_type: resourceType,
      p_resource_id: safeResourceId,
    },
  );
}

type DemoListingInsert = Record<string, unknown>;

export async function resolveDemoListingWithReconciliation(
  rootDb: SupabaseClient,
  params: Record<string, unknown>,
  label: string,
): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const resolved = await rpcValue<unknown>(
        rootDb,
        "resolve_demo_listing_id",
        params,
      );
      return requireSafePositiveBigintId(resolved, `${label} listing id`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} listing resolution failed`);
}

/** The actor INSERT intentionally has no SELECT/RETURNING. If PostgREST loses
 * the response after commit, the exact resolver is the only recovery path;
 * retrying it is idempotent because the manifest key is unique. */
export async function insertAndResolveDemoListing(
  actorClient: SupabaseClient,
  rootDb: SupabaseClient,
  values: DemoListingInsert,
  resolverParams: Record<string, unknown>,
  label: string,
): Promise<number> {
  let insertError: { message: string } | null = null;
  try {
    const result = await actorClient.from("listings").insert(values);
    insertError = result.error;
  } catch (error) {
    // PostgREST can report a transport failure after PostgreSQL committed the
    // actor write. The exact service resolver is the reconciliation authority.
    insertError = {
      message: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    return await resolveDemoListingWithReconciliation(
      rootDb,
      resolverParams,
      label,
    );
  } catch (resolverError) {
    if (insertError) {
      throw new Error(
        `${label} listing insert failed: ${insertError.message}; resolver: ${resolverError instanceof Error ? resolverError.message : String(resolverError)}`,
      );
    }
    throw resolverError;
  }
}

async function registerTokenResource(
  runId: number,
  leaseToken: string,
  table: "invites" | "connection_invites" | "child_grants",
  tokenField: "token" | "token_hash",
  token: string,
  resourceType: "invite" | "connection_invite" | "child_grant",
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq(
      tokenField,
      tokenField === "token_hash" ? await sha256Hex(token) : token,
    )
    .single();
  if (error || !data) {
    throw new Error(`register ${resourceType} failed: ${error?.message}`);
  }
  const resourceId = requireSafePositiveBigintId(
    data.id,
    `${resourceType} resource id`,
  );
  await registerDemoResource(runId, leaseToken, resourceType, resourceId);
  return resourceId;
}

export async function createOrReconcileSyntheticUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  appMetadata: Record<string, unknown>,
): Promise<{ id: string }> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (data.user) return { id: data.user.id };
    if (error && !/already|exists|timeout|network|fetch/i.test(error.message)) {
      throw new Error(error.message);
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/already|exists|timeout|network|fetch/i.test(error.message)
    ) {
      throw error;
    }
  }

  // Auth may have committed while the create response was lost. Reconcile by
  // the durable expected email; the email is synthetic and run-scoped, never
  // supplied by the browser.
  if (
    typeof appMetadata.demo_run_id !== "number" ||
    typeof appMetadata.demo_actor_key !== "string"
  ) {
    throw new Error("synthetic actor reconciliation lacks stable metadata");
  }
  const match = await findAuthUserForDemoActorIntent(
    email,
    appMetadata.demo_run_id,
    appMetadata.demo_actor_key,
  );
  if (!match) throw new Error(`synthetic actor ${email} was not created`);

  // A create response can be lost after Auth commits. The retry password is
  // freshly generated, so reconcile must explicitly rotate the exact actor's
  // credential before any sign-in/token call; otherwise the actor is found but
  // can never enter the demo.
  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
    match.id,
    {
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    },
  );
  if (resetError) {
    throw new Error(
      `reset reconciled synthetic actor failed: ${resetError.message}`,
    );
  }
  return match;
}

async function seedOfficialDemoBundle(
  customerUserId: string,
  rootAccountId: number,
  runId: number,
  leaseToken: string,
): Promise<BundleSeedResult> {
  validateOfficialDemoBundle();
  const rootDb = seedServiceClient(runId, leaseToken);
  const companionAccountIds: number[] = [];
  const syntheticUserIds: string[] = [];
  const createdResourceIds = {
    invitations: new Set<number>(),
    connections: new Set<number>(),
    grants: new Set<number>(),
    discussions: new Set<number>(),
    messages: new Set<number>(),
    listings: new Set<number>(),
    shares: new Set<number>(),
    trustedSenders: new Set<number>(),
  };

  try {
    const accountIdByContext = new Map<string, number>([
      ["primary-household", rootAccountId],
    ]);
    for (const context of OFFICIAL_DEMO_BUNDLE.contexts.filter(
      (candidate) => !candidate.root,
    )) {
      const accountId = requireSafePositiveBigintId(
        await rpcValue<unknown>(
          supabaseAdmin,
          "create_demo_companion_context",
          {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_context_key: context.key,
            p_name: context.name,
            p_kind: context.kind,
          },
        ),
        `${context.key} companion account id`,
      );
      companionAccountIds.push(accountId);
      accountIdByContext.set(context.key, accountId);
    }

    const { data: rootMembership, error: membershipError } = await supabaseAdmin
      .from("account_members")
      .select("id")
      .eq("account_id", rootAccountId)
      .eq("user_id", customerUserId)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError || !rootMembership) {
      throw new Error("customer has no active root demo membership");
    }
    requireSafePositiveBigintId(rootMembership.id, "root membership id");

    const realRootMembers = await listRealRootMembers(rootAccountId);
    const feldmanAccountId = requireSafePositiveBigintId(
      accountIdByContext.get("feldman-shadchanus"),
      "Feldman shadchanus account id",
    );
    const grossAccountId = requireSafePositiveBigintId(
      accountIdByContext.get("gross-household"),
      "Gross household account id",
    );
    const companionMembershipRows = realRootMembers.flatMap((member) => [
      {
        account_id: feldmanAccountId,
        user_id: member.userId,
        role: "shadchan",
        status: "active",
      },
      {
        account_id: grossAccountId,
        user_id: member.userId,
        role: "parent_admin",
        status: "active",
      },
    ]);
    if (companionMembershipRows.length > 0) {
      const { error: companionMembershipError } = await rootDb
        .from("account_members")
        .insert(companionMembershipRows);
      if (companionMembershipError) {
        throw new Error(
          `create companion memberships failed: ${companionMembershipError.message}`,
        );
      }
    }
    await heartbeatDemoRun(runId, leaseToken, "companion membership setup");

    const actorMembershipByKey = new Map<string, number>();
    const actorEmailByKey = new Map<string, string>();
    const actorUserIdByKey = new Map<string, string>();
    const actorClientByKey = new Map<string, SupabaseClient>();
    for (const actor of OFFICIAL_DEMO_BUNDLE.actors) {
      const email = `demo-${runId}-${actor.key}@demo.invalid`;
      const password = randomSecret();
      await rpcValue(supabaseAdmin, "create_demo_actor_intent", {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actor.key,
        p_expected_email: email,
      });
      const created = await createOrReconcileSyntheticUser(
        email,
        password,
        actor.firstName,
        actor.lastName,
        { demo: true, demo_run_id: runId, demo_actor_key: actor.key },
      );
      syntheticUserIds.push(created.id);
      await rpcValue(supabaseAdmin, "reconcile_demo_actor", {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_actor_key: actor.key,
        p_user_id: created.id,
      });
      if (actor.key !== "dovid-klein") {
        const actorAccountId = requireSafePositiveBigintId(
          accountIdByContext.get(actor.contextKey),
          `${actor.key} actor account id`,
        );
        const { data: membership, error: actorMembershipError } = await rootDb
          .from("account_members")
          .insert({
            account_id: actorAccountId,
            user_id: created.id,
            role: actor.role,
            status: "active",
          })
          .select("id")
          .single();
        if (actorMembershipError || !membership) {
          throw new Error(
            `create actor membership failed: ${actorMembershipError?.message}`,
          );
        }
        actorMembershipByKey.set(
          actor.key,
          requireSafePositiveBigintId(
            membership.id,
            `${actor.key} membership id`,
          ),
        );
      }
      actorEmailByKey.set(actor.key, email);
      actorUserIdByKey.set(actor.key, created.id);
      if (actor.key !== "dovid-klein") {
        const actorAccountId = requireSafePositiveBigintId(
          accountIdByContext.get(actor.contextKey),
          `${actor.key} actor account id`,
        );
        const { error: actorStateError } = await rootDb
          .from("member_state")
          .upsert({
            user_id: created.id,
            active_account_id: actorAccountId,
          });
        if (actorStateError) {
          throw new Error(
            `create actor active context failed: ${actorStateError.message}`,
          );
        }
      }
      actorClientByKey.set(
        actor.key,
        await signInSyntheticActor(email, password),
      );
    }

    const dovidClient = actorClientByKey.get("dovid-klein");
    const dovidEmail = actorEmailByKey.get("dovid-klein");
    const dovidUserId = actorUserIdByKey.get("dovid-klein");
    if (!dovidClient || !dovidEmail || !dovidUserId) {
      throw new Error("synthetic root actor was not initialized");
    }
    const dovidInvite = await rpcRow<{ token: string }>(
      rootDb,
      "create_invite",
      { p_email: dovidEmail, p_role: "parent_admin" },
    );
    createdResourceIds.invitations.add(
      await registerTokenResource(
        runId,
        leaseToken,
        "invites",
        "token",
        dovidInvite.token,
        "invite",
      ),
    );
    await rpcValue<void>(rootDb, "accept_demo_invite", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_token: dovidInvite.token,
      p_actor_user_id: dovidUserId,
    });
    const { data: dovidMembership, error: dovidMembershipError } =
      await supabaseAdmin
        .from("account_members")
        .select("id")
        .eq("account_id", rootAccountId)
        .eq("user_id", dovidUserId)
        .eq("status", "active")
        .single();
    if (dovidMembershipError || !dovidMembership) {
      throw new Error(
        `resolve Dovid root membership failed: ${dovidMembershipError?.message}`,
      );
    }
    actorMembershipByKey.set(
      "dovid-klein",
      requireSafePositiveBigintId(
        dovidMembership.id,
        "Dovid root membership id",
      ),
    );
    const { error: dovidStateError } = await rootDb
      .from("member_state")
      .upsert({ user_id: dovidUserId, active_account_id: rootAccountId });
    if (dovidStateError) {
      throw new Error(
        `set Dovid active root context failed: ${dovidStateError.message}`,
      );
    }
    await heartbeatDemoRun(runId, leaseToken, "synthetic actor setup");

    const dovidMembershipId = requireSafePositiveBigintId(
      actorMembershipByKey.get("dovid-klein"),
      "Dovid trusted sender membership id",
    );
    const miriamMembershipId = requireSafePositiveBigintId(
      actorMembershipByKey.get("miriam-gross"),
      "Miriam trusted sender membership id",
    );
    const trustedSenderRows = [
      // created_by_member_id: actorMembershipByKey.get("dovid-klein")
      // created_by_member_id: actorMembershipByKey.get("miriam-gross")
      // created_by_member_id: dovidMembershipId
      // created_by_member_id: miriamMembershipId
      {
        account_id: rootAccountId,
        created_by_member_id: dovidMembershipId,
        email: "mrs.feldman@demo.invalid",
      },
      {
        account_id: accountIdByContext.get("gross-household"),
        created_by_member_id: miriamMembershipId,
        email: "goldenmatches@demo.invalid",
      },
    ];
    if (
      trustedSenderRows.length !== 2 ||
      trustedSenderRows.some(
        (row) =>
          typeof row.account_id !== "number" ||
          typeof row.created_by_member_id !== "number",
      )
    ) {
      throw new Error("trusted sender demo contexts are not fully initialized");
    }
    const { data: trustedSenders, error: trustedSendersError } = await rootDb
      .from("trusted_senders")
      .insert(trustedSenderRows)
      .select("id, account_id, email");
    if (
      trustedSendersError ||
      !trustedSenders ||
      trustedSenders.length !== 2 ||
      trustedSenders.length !== trustedSenderRows.length
    ) {
      throw new Error(
        `create demo trusted senders failed: ${trustedSendersError?.message ?? "missing returned rows"}`,
      );
    }
    const expectedTrustedSenderByEmail = new Map(
      trustedSenderRows.map((row) => [row.email, row.account_id]),
    );
    for (const row of trustedSenders) {
      const trustedSenderId = requireSafePositiveBigintId(
        row.id,
        "trusted sender id",
      );
      const trustedSenderAccountId = requireSafePositiveBigintId(
        row.account_id,
        "trusted sender account id",
      );
      if (
        typeof row.email !== "string" ||
        expectedTrustedSenderByEmail.get(row.email) !== trustedSenderAccountId
      ) {
        throw new Error(
          "trusted sender receipt did not match the demo context",
        );
      }
      createdResourceIds.trustedSenders.add(trustedSenderId);
      await registerDemoResource(
        runId,
        leaseToken,
        "trusted_sender",
        trustedSenderId,
      );
    }

    const { data: rootSingle, error: singleError } = await supabaseAdmin
      .from("singles")
      .select("id, first_name_en, last_name_en")
      .eq("account_id", rootAccountId)
      .eq("gender", "female")
      .limit(1)
      .single();
    if (singleError || !rootSingle)
      throw new Error("root demo single disappeared");
    const shadchanusAccountId = requireSafePositiveBigintId(
      accountIdByContext.get("feldman-shadchanus"),
      "Feldman shadchanus account id",
    );
    const collaboratorAccountId = requireSafePositiveBigintId(
      accountIdByContext.get("gross-household"),
      "Gross household account id",
    );
    const actorMembershipId = requireSafePositiveBigintId(
      actorMembershipByKey.get("leah-feldman"),
      "Leah listing publisher membership id",
    );
    const rootSingleId = requireSafePositiveBigintId(
      rootSingle.id,
      "root demo single id",
    );
    const leahClient = actorClientByKey.get("leah-feldman");
    const miriamClient = actorClientByKey.get("miriam-gross");
    if (!leahClient || !miriamClient) {
      throw new Error("synthetic actor clients were not initialized");
    }

    // Use the public invitation lifecycle for both a completed and a pending
    // membership invitation. The actor credentials exist only in this server
    // invocation; neither token nor password is returned or stored.
    const acceptedMembershipInvite = await rpcRow<{ token: string }>(
      dovidClient,
      "create_invite",
      {
        p_email: actorEmailByKey.get("miriam-gross"),
        p_role: "helper",
      },
    );
    createdResourceIds.invitations.add(
      await registerTokenResource(
        runId,
        leaseToken,
        "invites",
        "token",
        acceptedMembershipInvite.token,
        "invite",
      ),
    );
    await rpcValue<void>(rootDb, "accept_demo_invite", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_token: acceptedMembershipInvite.token,
      p_actor_user_id: actorUserIdByKey.get("miriam-gross"),
    });
    const { error: miriamContextError } = await rootDb
      .from("member_state")
      .upsert({
        user_id: actorUserIdByKey.get("miriam-gross"),
        active_account_id: collaboratorAccountId,
      });
    if (miriamContextError) {
      throw new Error(
        `restore miriam demo context failed: ${miriamContextError.message}`,
      );
    }
    const pendingInvite = await rpcRow<{ token: string }>(
      dovidClient,
      "create_invite",
      {
        p_email: "sarah.gold@demo.invalid",
        p_role: "helper",
      },
    );
    createdResourceIds.invitations.add(
      await registerTokenResource(
        runId,
        leaseToken,
        "invites",
        "token",
        pendingInvite.token,
        "invite",
      ),
    );

    // Create the accepted connection through the real token exchange. The
    // acceptance RPC creates the connection and the shadchan directory row.
    const acceptedConnectionToken = await rpcValue<string>(
      dovidClient,
      "create_connection_invite",
      {},
    );
    await registerTokenResource(
      runId,
      leaseToken,
      "connection_invites",
      "token_hash",
      acceptedConnectionToken,
      "connection_invite",
    );
    const connection = await rpcRow<{ id: number }>(
      leahClient,
      "accept_connection_invite",
      { p_token: acceptedConnectionToken },
    );
    const connectionId = requireSafePositiveBigintId(
      connection.id,
      "accepted connection id",
    );
    createdResourceIds.connections.add(connectionId);
    await registerDemoResource(runId, leaseToken, "connection", connectionId);

    const revokedConnectionToken = await rpcValue<string>(
      dovidClient,
      "create_connection_invite",
      {},
    );
    const revokedConnectionInvite = await dovidClient
      .from("connection_invites")
      .select("id")
      .eq("token_hash", await sha256Hex(revokedConnectionToken))
      .single();
    if (revokedConnectionInvite.error || !revokedConnectionInvite.data) {
      throw new Error(
        `find revoked connection invite failed: ${revokedConnectionInvite.error?.message}`,
      );
    }
    const revokedConnectionInviteId = requireSafePositiveBigintId(
      revokedConnectionInvite.data.id,
      "revoked connection invite id",
    );
    await registerDemoResource(
      runId,
      leaseToken,
      "connection_invite",
      revokedConnectionInviteId,
    );
    await rpcValue<void>(dovidClient, "revoke_connection_invite", {
      p_invite_id: revokedConnectionInvite.data.id,
    });

    // Likewise exercise the household-to-household child-grant lifecycle.
    const acceptedGrantToken = await rpcValue<string>(
      dovidClient,
      "create_child_grant",
      {
        p_target_single_id: rootSingleId,
        p_grantee_email: actorEmailByKey.get("miriam-gross"),
        p_access_level: "comment",
      },
    );
    await registerTokenResource(
      runId,
      leaseToken,
      "child_grants",
      "token_hash",
      acceptedGrantToken,
      "child_grant",
    );
    const acceptedGrant = await dovidClient
      .from("child_grants")
      .select("id")
      .eq("token_hash", await sha256Hex(acceptedGrantToken))
      .single();
    if (acceptedGrant.error || !acceptedGrant.data) {
      throw new Error(
        `find accepted child grant failed: ${acceptedGrant.error?.message}`,
      );
    }
    const acceptedGrantId = requireSafePositiveBigintId(
      acceptedGrant.data.id,
      "accepted child grant id",
    );
    createdResourceIds.grants.add(acceptedGrantId);
    await rpcRow(miriamClient, "accept_child_grant", {
      p_token: acceptedGrantToken,
    });

    const revokedGrantToken = await rpcValue<string>(
      dovidClient,
      "create_child_grant",
      {
        p_target_single_id: rootSingleId,
        p_grantee_email: `revoked+${crypto.randomUUID()}@demo.invalid`,
        p_access_level: "read",
      },
    );
    const revokedGrant = await dovidClient
      .from("child_grants")
      .select("id")
      .eq("token_hash", await sha256Hex(revokedGrantToken))
      .single();
    if (revokedGrant.error || !revokedGrant.data) {
      throw new Error(
        `find revoked child grant failed: ${revokedGrant.error?.message}`,
      );
    }
    const revokedGrantId = requireSafePositiveBigintId(
      revokedGrant.data.id,
      "revoked child grant id",
    );
    createdResourceIds.grants.add(revokedGrantId);
    await registerDemoResource(
      runId,
      leaseToken,
      "child_grant",
      revokedGrantId,
    );
    await rpcValue<void>(dovidClient, "revoke_child_grant", {
      p_grant_id: revokedGrant.data.id,
    });

    const thread = await rpcRow<{ id: number }>(dovidClient, "create_thread", {
      p_subject_type: "relationship",
      p_subject_id: null,
      p_participant_member_ids: [actorMembershipId],
      p_visibility: "open",
      p_connection_id: connectionId,
    });
    const threadId = requireSafePositiveBigintId(thread.id, "demo thread id");
    createdResourceIds.discussions.add(threadId);
    await registerDemoResource(runId, leaseToken, "thread", threadId);
    const { data: firstMessage, error: messageError } = await dovidClient
      .from("messages")
      .insert({
        thread_id: threadId,
        body: "The Feldman office checked in — the Klein family is ready to review the next suggestion.",
      })
      .select("id")
      .single();
    if (messageError) {
      throw new Error(`create demo message failed: ${messageError.message}`);
    }
    if (!firstMessage) throw new Error("create demo message returned no row");
    const firstMessageId = requireSafePositiveBigintId(
      firstMessage.id,
      "first demo message id",
    );
    createdResourceIds.messages.add(firstMessageId);
    await registerDemoResource(runId, leaseToken, "message", firstMessageId);
    const { data: replyMessage, error: replyError } = await leahClient
      .from("messages")
      .insert({
        thread_id: threadId,
        body: "Absolutely — I will send over the family notes so we can keep the introduction moving.",
      })
      .select("id")
      .single();
    if (replyError) {
      throw new Error(
        `create demo message reply failed: ${replyError.message}`,
      );
    }
    if (!replyMessage) throw new Error("create demo reply returned no row");
    const replyMessageId = requireSafePositiveBigintId(
      replyMessage.id,
      "reply demo message id",
    );
    createdResourceIds.messages.add(replyMessageId);
    await registerDemoResource(runId, leaseToken, "message", replyMessageId);

    // Demo listings are deliberately invisible to authenticated SELECT while
    // the run is still seeding. Keep the real shadchan actor INSERT path, but
    // use PostgREST's return=minimal default so INSERT ... RETURNING does not
    // cross that active-only preview boundary.
    const shadchanListingId = await insertAndResolveDemoListing(
      leahClient,
      rootDb,
      {
        account_id: shadchanusAccountId,
        listing_type: "shadchan",
        published_by_member_id: actorMembershipId,
        shadchan_name: "Leah Feldman",
        shadchan_area: "Lakewood, NJ",
        shadchan_contact_info: "Contact through the Feldman office",
      },
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_account_id: shadchanusAccountId,
        p_listing_type: "shadchan",
        p_single_id: null,
        p_published_by_member_id: actorMembershipId,
      },
      "create demo shadchan",
    );
    createdResourceIds.listings.add(shadchanListingId);
    // Keep the shadchanus listing published: the owning demo bundle can
    // preview it through authenticated listing access, while ordinary anon
    // search remains excluded by the demo containment policy.
    //
    // The next listing follows the same actor-insert/service-resolution path.
    const singleListingId = await insertAndResolveDemoListing(
      dovidClient,
      rootDb,
      {
        account_id: rootAccountId,
        listing_type: "single",
        single_id: rootSingleId,
        published_by_member_id: requireSafePositiveBigintId(
          actorMembershipByKey.get("dovid-klein"),
          "Dovid listing publisher membership id",
        ),
        single_first_name_en: rootSingle.first_name_en,
        single_age: 24,
        single_community: "Baltimore",
        single_location: "Baltimore, MD",
        single_summary:
          "A warm, family-oriented young woman open to a thoughtful introduction.",
      },
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_account_id: rootAccountId,
        p_listing_type: "single",
        p_single_id: rootSingleId,
        p_published_by_member_id: requireSafePositiveBigintId(
          actorMembershipByKey.get("dovid-klein"),
          "Dovid listing publisher membership id",
        ),
      },
      "create demo single",
    );
    createdResourceIds.listings.add(singleListingId);
    const withdrawalParams = {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_account_id: rootAccountId,
      p_single_id: rootSingleId,
      p_published_by_member_id: requireSafePositiveBigintId(
        actorMembershipByKey.get("dovid-klein"),
        "Dovid listing publisher membership id",
      ),
    };
    let withdrawalData: unknown = null;
    let withdrawalError: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await rootDb.rpc(
        "withdraw_demo_listing",
        withdrawalParams,
      );
      withdrawalData = result.data;
      withdrawalError = result.error;
      if (!withdrawalError) break;
    }
    if (withdrawalError || !withdrawalData) {
      throw new Error(
        `withdraw demo listing failed: ${withdrawalError?.message ?? "missing response"}`,
      );
    }
    const withdrawalOutcome = withdrawalData as {
      outcome?: unknown;
      listing_id?: unknown;
      single_id?: unknown;
    };
    if (
      !["withdrawn", "already_withdrawn"].includes(
        String(withdrawalOutcome.outcome),
      )
    ) {
      throw new Error("withdraw demo listing returned an invalid outcome");
    }
    requireSafePositiveBigintId(
      withdrawalOutcome.single_id,
      "withdrawn demo single id",
    );
    if (withdrawalOutcome.listing_id != null) {
      requireSafePositiveBigintId(
        withdrawalOutcome.listing_id,
        "withdrawn demo listing id",
      );
    }

    // Capture this once so the bearer link and its immutable snapshot expire
    // at the exact same instant. The generated PDF is already watermarked for
    // Leah Feldman; embed its bytes so the snapshot cannot drift with a live
    // resume row or storage object.
    const shareExpiresAt = daysFromNowIso(21);
    const shareAssetBytes = await getAssetBytes(DEMO_SHARE_ASSET_KEY);
    const shareAssetSha256 = await sha256Hex(shareAssetBytes);
    const shareAssetSnapshot = {
      fileKey: "resume-0",
      filename: "rivky-klein-for-leah-feldman.pdf",
      mimeType: "application/pdf",
      size: shareAssetBytes.byteLength,
      bytesBase64: bytesToBase64(shareAssetBytes),
      sha256: shareAssetSha256,
      preWatermarked: true,
    };
    const { data: share, error: shareError } = await dovidClient
      .from("share_links")
      .insert({
        account_id: rootAccountId,
        single_id: rootSingleId,
        created_by_member_id: actorMembershipByKey.get("dovid-klein"),
        include_photo: false,
        expires_at: shareExpiresAt,
        recipient_name: "Leah Feldman",
        recipient_shadchan_id: null,
        watermark: true,
      })
      .select("id, token")
      .single();
    if (shareError || !share)
      throw new Error(`create demo share failed: ${shareError?.message}`);
    const shareId = requireSafePositiveBigintId(share.id, "demo share id");
    createdResourceIds.shares.add(shareId);
    await registerDemoResource(runId, leaseToken, "share_link", shareId);
    if (typeof share.token !== "string" || share.token.length === 0) {
      throw new Error("demo share returned an invalid token");
    }
    const token = share.token;
    const { error: snapshotError } = await rootDb
      .from("demo_share_snapshots")
      .insert({
        run_id: runId,
        share_link_id: shareId,
        token_hash: await sha256Hex(token),
        snapshot: {
          single: {
            first_name_en: rootSingle.first_name_en,
            first_name_he: null,
          },
          files: [shareAssetSnapshot],
        },
        expires_at: shareExpiresAt,
      });
    if (snapshotError) {
      throw new Error(
        `create demo share snapshot failed: ${snapshotError.message}`,
      );
    }
    const { data: shareAccess, error: shareAccessError } = await rootDb
      .from("share_access_log")
      .insert({
        share_link_id: shareId,
        resource: "profile",
        ip_hash: null,
        user_agent: null,
        duration_ms: 420,
        recipient_name: "Leah Feldman",
        recipient_shadchan_id: null,
        simulated: true,
      })
      .select("id")
      .single();
    if (shareAccessError || !shareAccess) {
      throw new Error(
        `create demo share access receipt failed: ${shareAccessError?.message ?? "missing row"}`,
      );
    }
    await registerDemoResource(
      runId,
      leaseToken,
      "share_access_log",
      requireSafePositiveBigintId(shareAccess.id, "share access log id"),
    );

    const demoTaskDueAt = daysAgoIso(1);
    const { data: demoTask, error: demoTaskError } = await rootDb
      .from("tasks")
      .insert({
        account_id: rootAccountId,
        member_id: null,
        type: "Follow up",
        text: "Simulated: follow up with Leah Feldman about the Klein introduction",
        due_date: demoTaskDueAt,
        target_type: "single",
        target_id: rootSingleId,
      })
      .select("id")
      .single();
    if (demoTaskError || !demoTask)
      throw new Error(`create demo reminder failed: ${demoTaskError?.message}`);
    const demoTaskId = requireSafePositiveBigintId(demoTask.id, "demo task id");
    await registerDemoResource(runId, leaseToken, "task", demoTaskId);
    const { data: demoInboxItem, error: inboxError } = await rootDb
      .from("inbox_items")
      .insert({
        account_id: rootAccountId,
        source: "email",
        subject: "[Simulated] Feldman office follow-up",
        raw_text: "Synthetic demo capture — no external message was received.",
        sender: "Leah Feldman",
        sender_email: "leah.feldman@demo.invalid",
        status: "resolved",
        single_id: rootSingleId,
      })
      .select("id")
      .single();
    if (inboxError || !demoInboxItem) {
      throw new Error(
        `create demo inbox item failed: ${inboxError?.message ?? "missing row"}`,
      );
    }
    await registerDemoResource(
      runId,
      leaseToken,
      "inbox_item",
      requireSafePositiveBigintId(demoInboxItem.id, "demo inbox item id"),
    );
    const { data: demoSuggestion, error: suggestionLookupError } =
      await supabaseAdmin
        .from("shidduchim")
        .select("id")
        .eq("account_id", rootAccountId)
        .limit(1)
        .maybeSingle();
    if (suggestionLookupError || !demoSuggestion) {
      throw new Error(
        `find demo suggestion for analytics failed: ${suggestionLookupError?.message ?? "missing suggestion"}`,
      );
    }
    const demoSuggestionId = requireSafePositiveBigintId(
      demoSuggestion.id,
      "demo suggestion id",
    );
    const demoInboxItemId = requireSafePositiveBigintId(
      demoInboxItem.id,
      "demo inbox item id",
    );
    const { data: analyticsRows, error: analyticsError } = await rootDb
      .from("analytics_events")
      .insert([
        {
          account_id: rootAccountId,
          event_type: "item_filed",
          properties: {
            suggestion_id: demoSuggestionId,
            candidate_id: demoSuggestionId,
            source_channel: "demo_seed",
          },
        },
        {
          account_id: rootAccountId,
          event_type: "channel_capture",
          properties: {
            inbox_item_id: demoInboxItemId,
            channel_type: "email",
            has_attachment: false,
          },
        },
        {
          account_id: rootAccountId,
          event_type: "time_to_file",
          properties: {
            inbox_item_id: demoInboxItemId,
            time_to_file_ms: 420000,
          },
        },
      ])
      .select("id");
    if (analyticsError || !analyticsRows || analyticsRows.length !== 3) {
      throw new Error(
        `create demo analytics failed: ${analyticsError?.message ?? "missing returned rows"}`,
      );
    }
    for (const row of analyticsRows) {
      await registerDemoResource(
        runId,
        leaseToken,
        "analytics_event",
        requireSafePositiveBigintId(row.id, "demo analytics event id"),
      );
    }
    const { data: messageNotificationRows, error: messageNotificationError } =
      await rootDb
        .from("message_notifications")
        .update({
          simulated: true,
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("connection_id", connectionId)
        .in("message_id", [firstMessageId, replyMessageId])
        .select("id, message_id");
    if (messageNotificationError) {
      throw new Error(
        `settle demo message notifications failed: ${messageNotificationError.message}`,
      );
    }
    const canonicalMessageNotificationRows =
      canonicalizeMessageNotificationRows(messageNotificationRows ?? []);
    const settledMessageIds = new Set(
      canonicalMessageNotificationRows.map((row) =>
        requireSafePositiveBigintId(
          row.message_id,
          "demo message notification message id",
        ),
      ),
    );
    if (
      !settledMessageIds.has(firstMessageId) ||
      !settledMessageIds.has(replyMessageId)
    ) {
      throw new Error(
        "settle demo message notifications returned incomplete IDs",
      );
    }
    for (const row of canonicalMessageNotificationRows) {
      await registerDemoResource(
        runId,
        leaseToken,
        "message_notification",
        requireSafePositiveBigintId(row.id, "demo message notification id"),
      );
    }
    const { data: taskNotificationRows, error: taskNotificationError } =
      await rootDb
        .from("task_notifications")
        .upsert(
          {
            account_id: rootAccountId,
            task_id: demoTaskId,
            channel: "email",
            due_date: demoTaskDueAt,
            status: "sent",
            error: "simulated demo delivery",
            simulated: true,
            sent_at: new Date().toISOString(),
          },
          { onConflict: "task_id,channel,due_date" },
        )
        .select("id");
    if (taskNotificationError || !taskNotificationRows?.length) {
      throw new Error(
        `create demo task notification failed: ${taskNotificationError?.message ?? "missing row"}`,
      );
    }
    for (const row of taskNotificationRows) {
      await registerDemoResource(
        runId,
        leaseToken,
        "task_notification",
        requireSafePositiveBigintId(row.id, "demo task notification id"),
      );
    }
    const { data: settledTask, error: settledTaskError } = await supabaseAdmin
      .from("task_notifications")
      .select("id, status, simulated")
      .eq("task_id", demoTaskId)
      .eq("channel", "email")
      .eq("due_date", demoTaskDueAt)
      .maybeSingle();
    if (
      settledTaskError ||
      !settledTask ||
      settledTask.status !== "sent" ||
      settledTask.simulated !== true
    ) {
      throw new Error(
        `demo task notification did not settle: ${settledTaskError?.message ?? "missing or pending"}`,
      );
    }

    const [messageReceiptResult, reminderReceiptResult, shareReceiptResult] =
      await Promise.all([
        rootDb
          .from("message_notifications")
          .select("message_id")
          .eq("connection_id", connectionId)
          .eq("simulated", true)
          .eq("status", "sent"),
        rootDb
          .from("task_notifications")
          .select("id")
          .eq("task_id", demoTaskId)
          .eq("simulated", true)
          .eq("status", "sent"),
        rootDb
          .from("share_access_log")
          .select("id")
          .eq("share_link_id", shareId)
          .eq("simulated", true),
      ]);
    if (messageReceiptResult.error) {
      throw new Error(
        `count demo message receipts failed: ${messageReceiptResult.error.message}`,
      );
    }
    if (reminderReceiptResult.error) {
      throw new Error(
        `count demo reminder receipts failed: ${reminderReceiptResult.error.message}`,
      );
    }
    if (shareReceiptResult.error) {
      throw new Error(
        `count demo share receipts failed: ${shareReceiptResult.error.message}`,
      );
    }
    // Fan-out creates one notification row per recipient/channel. Count the
    // two distinct messages rather than multiplying the showcase receipt by
    // the number of real customer observers in the thread.
    const receiptCounts = computeSimulatedReceiptCounts(
      messageReceiptResult.data ?? [],
      reminderReceiptResult.data ?? [],
      shareReceiptResult.data ?? [],
    );
    const { messageReceiptCount, reminderReceiptCount, shareReceiptCount } =
      receiptCounts;
    if (
      messageReceiptCount !== 2 ||
      reminderReceiptCount !== 1 ||
      shareReceiptCount !== 1
    ) {
      throw new Error(
        `demo receipt graph is incomplete: messages=${messageReceiptCount}, reminders=${reminderReceiptCount}, shares=${shareReceiptCount}`,
      );
    }

    await heartbeatDemoRun(runId, leaseToken, "before activation");
    await activateDemoRunWithReconciliation(
      runId,
      leaseToken,
      "The Klein Family",
    );

    return {
      runId,
      contexts: accountIdByContext.size,
      syntheticActors: actorUserIdByKey.size,
      invitations: createdResourceIds.invitations.size,
      connections: createdResourceIds.connections.size,
      grants: createdResourceIds.grants.size,
      discussions: createdResourceIds.discussions.size,
      listings: createdResourceIds.listings.size,
      shares: createdResourceIds.shares.size,
      trustedSenders: createdResourceIds.trustedSenders.size,
      simulatedReceipts: receiptCounts.total,
    };
  } catch (error) {
    const compensated = await cleanupPartialBundle(
      runId,
      rootAccountId,
      companionAccountIds,
      syntheticUserIds,
      leaseToken,
    );
    if (compensated) {
      throw new CompensatedDemoSeedError(error);
    }
    throw error;
  }
}

// Creates every suggestion in one pipeline (girl's boys or boy's girls).
// Decision states (yes/unsure/no) cannot be created directly (AD-4): each is
// created as look_into, then moved with transition_shidduch. Returns a map
// of suggestion key -> shidduchim id, so later steps (redts/links/notes/
// tasks/files) can address the right row.
async function seedSuggestions(
  db: SupabaseClient,
  singleId: number,
  singleSex: "female" | "male",
  suggestions: DemoSuggestion[],
  shadchanIdByKey: Map<string, number>,
): Promise<Map<string, number>> {
  const idByKey = new Map<string, number>();

  for (const s of suggestions) {
    if (s.sex === singleSex) {
      throw new Error(
        `non-halachic demo pairing rejected: ${s.key} and target single are both ${singleSex}`,
      );
    }
    const shadchanId = shadchanIdByKey.get(s.shadchanKey);
    if (shadchanId == null) {
      throw new Error(`shadchan not found for suggestion ${s.key}`);
    }
    const isDecisionState =
      s.targetState === "yes" ||
      s.targetState === "unsure" ||
      s.targetState === "no";
    const initialState = isDecisionState ? "look_into" : s.targetState;

    const { data, error } = await db.rpc("create_shidduch", {
      p_single_id: singleId,
      p_shadchan_id: shadchanId,
      p_name_en: s.name_en,
      p_father_en: s.father_en,
      p_mother_en: s.mother_en,
      p_seminary_en: s.seminary_en,
      p_location_en: s.location_en,
      p_age: s.age,
      p_height: s.height,
      // Persist the candidate's own sex, rather than relying on the target
      // single's canonical fixture.  The database and the preview paths use
      // this denormalized fact to enforce the woman-man demo contract.
      p_person_gender: s.sex,
      p_initial_state: initialState,
      p_redt_date: daysAgo(s.redtDaysAgo),
    });
    if (error || !data?.[0]) {
      throw new Error(`create_shidduch failed for ${s.key}: ${error?.message}`);
    }
    const shidduchId = requireSafePositiveBigintId(
      data[0].id,
      `${s.key} shidduch id`,
    );
    idByKey.set(s.key, shidduchId);

    if (isDecisionState) {
      const { error: transitionError } = await db.rpc("transition_shidduch", {
        p_id: shidduchId,
        p_from: "look_into",
        p_to: s.targetState,
        p_close_reason: s.closeReason ?? null,
      });
      if (transitionError) {
        throw new Error(
          `transition_shidduch failed for ${s.key}: ${transitionError.message}`,
        );
      }
    }
  }

  return idByKey;
}

function resumeOwnerSegment(subject: {
  singleId?: number;
  shidduchimId?: number;
}): string {
  if (subject.singleId != null) return `single-${subject.singleId}`;
  if (subject.shidduchimId != null) return `${subject.shidduchimId}`;
  throw new Error("resume subject must be a single or shidduch");
}

function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

export async function registerStorageObject(
  runId: number,
  leaseToken: string,
  accountId: number,
  bucket: string,
  storagePath: string,
  resourceKey: string,
  db?: SupabaseClient,
): Promise<void> {
  await rpcValue<void>(
    db ?? seedServiceClient(runId, leaseToken),
    "register_demo_storage",
    {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_account_id: accountId,
      p_bucket: bucket,
      p_storage_path: storagePath,
      p_resource_key: resourceKey,
    },
  );
}

export async function uploadSeededResumeFile(
  runId: number,
  leaseToken: string,
  accountId: number,
  params: {
    filename: string;
    assetKey: AssetKey;
    mimeType: string;
    singleId?: number;
    shidduchimId?: number;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const path = `${accountId}/resumes/${resumeOwnerSegment(params)}/${crypto.randomUUID()}-${params.filename}`;
  await registerStorageObject(
    runId,
    leaseToken,
    accountId,
    "documents",
    path,
    "resume",
    db,
  );
  const { error: uploadError } = await db.storage
    .from("documents")
    .upload(path, bytes, { contentType: params.mimeType });
  if (uploadError) {
    throw new Error(
      `upload resume failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: rpcError } = await db.rpc("add_resume_file", {
    p_path: path,
    p_filename: params.filename,
    p_mime_type: params.mimeType,
    p_size: bytes.length,
    p_shidduchim_id: params.shidduchimId ?? null,
    p_single_id: params.singleId ?? null,
  });
  if (rpcError) {
    throw new Error(
      `add_resume_file failed for ${params.filename}: ${rpcError.message}`,
    );
  }
}

async function uploadSeededResumePhoto(
  runId: number,
  leaseToken: string,
  accountId: number,
  params: {
    filename: string;
    assetKey: AssetKey;
    visibility: string;
    singleId?: number;
    shidduchimId?: number;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const path = `${accountId}/photos/${params.visibility}/${resumeOwnerSegment(params)}/${crypto.randomUUID()}-${params.filename}`;
  await registerStorageObject(
    runId,
    leaseToken,
    accountId,
    "documents",
    path,
    "photo",
    db,
  );
  const { error: uploadError } = await db.storage
    .from("documents")
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (uploadError) {
    throw new Error(
      `upload photo failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: rpcError } = await db.rpc("add_resume_photo", {
    p_path: path,
    p_shidduchim_id: params.shidduchimId ?? null,
    p_single_id: params.singleId ?? null,
    p_visibility: params.visibility,
  });
  if (rpcError) {
    throw new Error(
      `add_resume_photo failed for ${params.filename}: ${rpcError.message}`,
    );
  }
}

async function uploadSeededEntityFile(
  runId: number,
  leaseToken: string,
  accountId: number,
  params: {
    targetType: string;
    targetId: number;
    filename: string;
    assetKey: AssetKey;
    mimeType: string;
    visibility: string;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const ext = deriveExtension(params.filename);
  const path = `${accountId}/${params.targetType}/${params.targetId}/${crypto.randomUUID()}${ext}`;
  await registerStorageObject(
    runId,
    leaseToken,
    accountId,
    "entity-files",
    path,
    "entity-file",
    db,
  );
  const { error: uploadError } = await db.storage
    .from("entity-files")
    .upload(path, bytes, { contentType: params.mimeType });
  if (uploadError) {
    throw new Error(
      `upload entity file failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: insertError } = await db.from("entity_files").insert({
    target_type: params.targetType,
    target_id: params.targetId,
    storage_path: path,
    file_name: params.filename,
    mime_type: params.mimeType,
    size_bytes: bytes.length,
    visibility: params.visibility,
  });
  if (insertError) {
    throw new Error(
      `insert entity_files failed for ${params.filename}: ${insertError.message}`,
    );
  }
}

async function seedDemoData(
  accountId: number,
  runId: number,
  leaseToken: string,
) {
  validateDemoDataset();
  const db = seedServiceClient(runId, leaseToken);

  const { data: singles, error: singlesError } = await db
    .from("singles")
    .insert(SINGLES)
    .select("id, gender");
  if (singlesError || !singles) {
    throw new Error(`insert singles failed: ${singlesError?.message}`);
  }
  const girlId = requireSafePositiveBigintId(
    singles.find((c) => c.gender === "female")?.id,
    "female demo single id",
  );
  const boyId = requireSafePositiveBigintId(
    singles.find((c) => c.gender === "male")?.id,
    "male demo single id",
  );
  if (girlId === boyId) {
    throw new Error(
      "expected exactly one female and one male single after insert",
    );
  }

  // Private single content is seeded by the guarded service RPC.  The RPC
  // validates the real single owner, fires the normal write barrier, and
  // registers both rows in the same transaction as their manifest receipts.
  for (const single of SINGLES) {
    const singleId = single.gender === "female" ? girlId : boyId;
    const preference = SINGLE_PREFERENCES.find(
      (row) => row.singleKey === single.first_name_en,
    );
    const note = SINGLE_NOTES.find(
      (row) => row.singleKey === single.first_name_en,
    );
    if (!preference || !note) {
      throw new Error(
        `private demo content is incomplete for ${single.first_name_en}`,
      );
    }
    const { error } = await db.rpc("seed_demo_single_private_content", {
      p_run_id: runId,
      p_lease_token: leaseToken,
      p_account_id: accountId,
      p_single_id: singleId,
      p_preference_body: preference.body,
      p_preference_visible_to_manager: preference.visibleToManager,
      p_note_body: note.body,
      p_note_visible_to_manager: note.visibleToManager,
    });
    if (error) {
      throw new Error(
        `seed private content failed for ${single.first_name_en}: ${error.message}`,
      );
    }
  }

  const { data: shadchanim, error: shadchanimError } = await db
    .from("shadchanim")
    .insert(SHADCHANIM.map(({ key: _key, ...rest }) => rest))
    .select("id, name");
  if (shadchanimError || !shadchanim) {
    throw new Error(`insert shadchanim failed: ${shadchanimError?.message}`);
  }
  const shadchanIdByKey = new Map<string, number>();
  for (const s of SHADCHANIM) {
    const row = shadchanim.find((r) => r.name === s.name);
    if (!row) throw new Error(`shadchan not found after insert: ${s.name}`);
    shadchanIdByKey.set(
      s.key,
      requireSafePositiveBigintId(row.id, `${s.key} shadchan id`),
    );
  }

  const girlSuggestionIds = await seedSuggestions(
    db,
    girlId,
    "female",
    RIVKY_SUGGESTIONS,
    shadchanIdByKey,
  );
  const boySuggestionIds = await seedSuggestions(
    db,
    boyId,
    "male",
    YAAKOV_SUGGESTIONS,
    shadchanIdByKey,
  );
  const suggestionIdByKey = new Map<string, number>([
    ...girlSuggestionIds,
    ...boySuggestionIds,
  ]);

  for (const extra of EXTRA_REDTS) {
    const { error } = await db.rpc("add_redt", {
      p_shidduchim_id: suggestionIdByKey.get(extra.suggestionKey),
      p_shadchan_id: shadchanIdByKey.get(extra.shadchanKey),
      p_redt_date: daysAgo(extra.redtDaysAgo),
    });
    if (error) throw new Error(`add_redt failed: ${error.message}`);
  }

  const references: Array<{ id: number; name_en: string }> = [];
  for (const reference of REFERENCES) {
    const firstLink = REFERENCE_LINKS.find(
      (link) => link.referenceKey === reference.key,
    );
    if (!firstLink) {
      throw new Error(
        `reference ${reference.key} cannot be seeded without a shidduch to attach it to`,
      );
    }
    const shidduchimId = suggestionIdByKey.get(firstLink.suggestionKey);
    if (shidduchimId == null) {
      throw new Error(
        `reference ${reference.key} points to unknown suggestion ${firstLink.suggestionKey}`,
      );
    }
    const { data, error } = await db.rpc("create_reference_for_shidduch", {
      p_shidduchim_id: shidduchimId,
      p_name_en: reference.name_en,
      p_name_he: null,
      p_relationship: reference.relationship,
      p_phone: reference.phone,
      p_school: reference.school ?? null,
      p_grad_year: null,
      p_relationship_override: null,
    });
    if (error || !data?.[0]) {
      throw new Error(
        `create_reference_for_shidduch failed for ${reference.key}: ${error?.message}`,
      );
    }
    references.push({
      id: requireSafePositiveBigintId(
        data[0].id,
        `${reference.key} reference id`,
      ),
      name_en: data[0].name_en,
    });
  }
  const referenceIdByKey = new Map<string, number>();
  for (const reference of REFERENCES) {
    const row = references.find((item) => item.name_en === reference.name_en);
    if (!row) {
      throw new Error(`reference not found after insert: ${reference.name_en}`);
    }
    referenceIdByKey.set(reference.key, row.id);
  }

  let referenceLinkCount = 0;
  for (const link of REFERENCE_LINKS) {
    const { data: linkData, error: linkError } = await db.rpc(
      "link_reference_to_shidduch",
      {
        p_reference_id: referenceIdByKey.get(link.referenceKey),
        p_shidduchim_id: suggestionIdByKey.get(link.suggestionKey),
      },
    );
    if (linkError || !linkData?.[0]) {
      throw new Error(
        `link_reference_to_shidduch failed: ${linkError?.message}`,
      );
    }
    const { error: logError } = await db.rpc("log_reference_call", {
      p_reference_link_id: requireSafePositiveBigintId(
        linkData[0].id,
        `${link.referenceKey} reference link id`,
      ),
      p_call_status: "answered",
      p_what_they_said: link.whatTheySaid,
      p_source: "manual",
    });
    if (logError)
      throw new Error(`log_reference_call failed: ${logError.message}`);
    referenceLinkCount++;
  }

  const notesToInsert = TIMELINE_NOTES.map((n) => ({
    target_type: "shidduch",
    scope: "shidduch",
    target_id: suggestionIdByKey.get(n.suggestionKey),
    reference_link_id: null,
    kind: "note",
    body: n.body,
    created_at: daysAgoIso(0),
  }));
  const statusChangesToInsert = STATUS_CHANGES.map((s) => ({
    target_type: "shidduch",
    scope: "shidduch",
    target_id: suggestionIdByKey.get(s.suggestionKey),
    reference_link_id: null,
    kind: "status_change",
    body: s.body ?? null,
    metadata: { from: s.from, to: s.to },
    created_at: daysAgoIso(s.atDaysAgo),
  }));
  const { error: notesError } = await db
    .from("interactions")
    .insert([...notesToInsert, ...statusChangesToInsert]);
  if (notesError)
    throw new Error(
      `insert timeline interactions failed: ${notesError.message}`,
    );

  const tasksToInsert = TASKS.map((t) => ({
    text: t.text,
    type: t.type,
    due_date: daysFromNowIso(t.dueDaysOffset),
    target_type: t.targetType,
    target_id:
      t.targetType === "shidduch"
        ? suggestionIdByKey.get(t.targetKey)
        : referenceIdByKey.get(t.targetKey),
  }));
  const { error: tasksError } = await db.from("tasks").insert(tasksToInsert);
  if (tasksError) throw new Error(`insert tasks failed: ${tasksError.message}`);

  for (const file of RESUME_FILES) {
    const singleId =
      file.singleKey === "Rivky"
        ? girlId
        : file.singleKey === "Yaakov"
          ? boyId
          : undefined;
    const shidduchimId = file.suggestionKey
      ? suggestionIdByKey.get(file.suggestionKey)
      : undefined;
    await uploadSeededResumeFile(
      runId,
      leaseToken,
      accountId,
      { ...file, singleId, shidduchimId },
      db,
    );
  }

  for (const photo of RESUME_PHOTOS) {
    const singleId =
      photo.singleKey === "Rivky"
        ? girlId
        : photo.singleKey === "Yaakov"
          ? boyId
          : undefined;
    const shidduchimId = photo.suggestionKey
      ? suggestionIdByKey.get(photo.suggestionKey)
      : undefined;
    await uploadSeededResumePhoto(
      runId,
      leaseToken,
      accountId,
      { ...photo, singleId, shidduchimId },
      db,
    );
  }

  for (const file of ENTITY_FILES) {
    const targetId =
      file.targetType === "shidduch"
        ? suggestionIdByKey.get(file.targetKey)
        : referenceIdByKey.get(file.targetKey);
    if (targetId == null) {
      throw new Error(`entity file target not found: ${file.targetKey}`);
    }
    await uploadSeededEntityFile(
      runId,
      leaseToken,
      accountId,
      { ...file, targetId },
      db,
    );
  }

  const medicalNotesToInsert = MEDICAL_NOTES.map((n) => ({
    shidduchim_id: suggestionIdByKey.get(n.suggestionKey),
    body: n.body,
  }));
  const { error: medicalNotesError } = await db
    .from("medical_notes")
    .insert(medicalNotesToInsert);
  if (medicalNotesError) {
    throw new Error(
      `insert medical_notes failed: ${medicalNotesError.message}`,
    );
  }

  const externalLinksToInsert = EXTERNAL_LINKS.map((l) => ({
    shidduchim_id: suggestionIdByKey.get(l.suggestionKey),
    url: l.url,
    label: l.label,
  }));
  const { error: externalLinksError } = await db
    .from("shidduchim_external_links")
    .insert(externalLinksToInsert);
  if (externalLinksError) {
    throw new Error(
      `insert shidduchim_external_links failed: ${externalLinksError.message}`,
    );
  }

  const singleIdByKey = new Map<string, number>([
    ["Rivky", girlId],
    ["Yaakov", boyId],
  ]);
  const dateRecordsToInsert = DATE_RECORDS.map((r) => {
    const singleId = singleIdByKey.get(r.singleKey);
    if (singleId == null) {
      throw new Error(`date record single not found: ${r.singleKey}`);
    }
    return {
      single_id: singleId,
      person_name_en: r.personName,
      person_location: r.personLocation,
      date_on: daysAgo(r.daysAgo),
      outcome: r.outcome,
      notes: r.notes,
    };
  });
  const { error: dateRecordsError } = await db
    .from("date_records")
    .insert(dateRecordsToInsert);
  if (dateRecordsError) {
    throw new Error(`insert date_records failed: ${dateRecordsError.message}`);
  }

  return {
    seeded: true as const,
    accountId,
    singles: SINGLES.length,
    shadchanim: SHADCHANIM.length,
    references: REFERENCES.length,
    shidduchim: RIVKY_SUGGESTIONS.length + YAAKOV_SUGGESTIONS.length,
    referenceLinks: referenceLinkCount,
    interactions:
      notesToInsert.length +
      statusChangesToInsert.length +
      referenceLinkCount * 2,
    tasks: TASKS.length,
    resumeFiles: RESUME_FILES.length,
    resumePhotos: RESUME_PHOTOS.length,
    entityFiles: ENTITY_FILES.length,
    medicalNotes: MEDICAL_NOTES.length,
    externalLinks: EXTERNAL_LINKS.length,
    dateRecords: DATE_RECORDS.length,
  };
}

export async function handleSeedDemo(
  req: Request,
  user?: User,
): Promise<Response> {
  if (req.method !== "POST" && req.method !== "PATCH") {
    return createErrorResponse(405, "Method Not Allowed");
  }
  if (!user) return createErrorResponse(401, "Unauthorized");

  const accountId = await resolveAccountId(user.id);
  if (!accountId) {
    return createErrorResponse(409, "No active account for user");
  }

  let unfinishedRun: UnfinishedDemoRun | null;
  try {
    unfinishedRun = await findUnfinishedDemoRun(accountId);
  } catch (e) {
    console.error("seed_demo: failed to inspect prior demo run:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
  if (unfinishedRun) {
    // The browser can lose the final response after the bundle has become
    // active.  An exact same-root retry is therefore a successful resume,
    // not a duplicate seed.  Seeding/clearing/failed runs still require the
    // explicit cleanup/retry lifecycle below.
    if (unfinishedRun.status === "active") {
      return new Response(
        JSON.stringify({
          seeded: true,
          resumed: true,
          runId: unfinishedRun.id,
          status: unfinishedRun.status,
          bundle: { runId: unfinishedRun.id, status: unfinishedRun.status },
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }
    return new Response(
      JSON.stringify({
        seeded: false,
        reason: "demo_cleanup_required",
        runId: unfinishedRun.id,
        status: unfinishedRun.status,
        updated_at: unfinishedRun.updated_at,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  // Guard: only ever seed an empty account (checks singles,
  // shadchanim, references, and shidduchim — not singles alone —
  // so a partially-populated account can't be re-seeded into a
  // mixed state).
  let accountEmpty: boolean;
  try {
    accountEmpty = await isAccountEmpty(accountId);
  } catch (e) {
    console.error("seed_demo: failed to check existing data:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
  if (!accountEmpty) {
    return new Response(
      JSON.stringify({ seeded: false, reason: "account_not_empty" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  let lifecycleRunId: number | null = null;
  let lifecycleLeaseToken: string | null = null;
  let bundleStarted = false;
  try {
    // One service-only RPC locks the root, snapshots real member state, and
    // creates the run plus root manifest in one transaction.
    const lifecycle = await beginDemoSeedWithReconciliation(accountId);
    lifecycleRunId = requireSafePositiveBigintId(
      lifecycle.run_id,
      "demo lifecycle run id",
    );
    lifecycleLeaseToken = lifecycle.lease_token;

    const summary = await seedDemoData(
      accountId,
      lifecycleRunId,
      lifecycleLeaseToken,
    );
    await heartbeatDemoRun(
      lifecycleRunId,
      lifecycleLeaseToken,
      "core demo seed",
    );
    bundleStarted = true;
    const bundle = await seedOfficialDemoBundle(
      user.id,
      accountId,
      lifecycleRunId,
      lifecycleLeaseToken,
    );
    return new Response(JSON.stringify({ ...summary, bundle }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("seed_demo failed:", e);
    if (lifecycleRunId !== null && lifecycleLeaseToken !== null) {
      // Preserve a durable retry intent before compensation can fence the
      // lease. A missing/failed RPC must not hide the original seed error or
      // prevent cleanupPartialBundle from running.
      await markDemoOnboardingSeedFailedBestEffort(
        lifecycleRunId,
        lifecycleLeaseToken,
        e,
      );
    }
    let compensated = e instanceof CompensatedDemoSeedError;
    if (
      !compensated &&
      lifecycleRunId !== null &&
      lifecycleLeaseToken !== null &&
      !bundleStarted
    ) {
      compensated = await cleanupPartialBundle(
        lifecycleRunId,
        accountId,
        [],
        [],
        lifecycleLeaseToken,
      );
    }
    // A successful compensation deleted the only lifecycle run, so do
    // not recreate an empty failed blocker. A failed compensation has
    // already marked that same run failed and retains it for clear_demo.
    return createErrorResponse(500, "Couldn't load the demo data. Try again.");
  }
}

export async function markDemoOnboardingSeedFailedBestEffort(
  runId: number,
  leaseToken: string,
  cause: unknown,
): Promise<void> {
  try {
    const { error: markFailedError } = await supabaseAdmin.rpc(
      "fail_demo_onboarding_seed",
      {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_error: cause instanceof Error ? cause.message : String(cause),
      },
    );
    if (markFailedError) {
      console.error(
        "seed_demo: fail_demo_onboarding_seed returned an error",
        markFailedError,
      );
    }
  } catch (markFailedError) {
    console.error(
      "seed_demo: fail_demo_onboarding_seed transport failure",
      markFailedError,
    );
  }
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    OptionsMiddleware(req, (req) =>
      AuthMiddleware(req, (req) =>
        UserMiddleware(req, (req, user?: User) => handleSeedDemo(req, user)),
      ),
    ),
  );
}
