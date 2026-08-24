// Hosted acceptance harness for the official demo lifecycle.
//
// Drives the REAL deployed project end to end — onboarding, seed, all three
// contexts, public/share containment, admin reseed, clear, a second
// onboard/seed/clear retry, and a final proof that the project is empty again.
// It creates and then removes a disposable Auth user, so it is destructive by
// design and is never run by `npm test`; it lives here (not under
// supabase/tests) so no vitest project picks it up.
//
//   . scripts/hosted-demo-smoke.env   # not committed; see below
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   ADMIN_RESEED_SECRET=... SHARE_WORKER_URL=https://<worker-host> \
//     node scripts/hosted-demo-smoke.mjs
//
// ADMIN_RESEED_SECRET must match the deployed function secret. Rotating it to
// a temporary value is fine: deploy.yml re-sets it from the GitHub secret on
// the next push to main. Exit 0 means every check passed and the project was
// verified empty; any failure runs a best-effort compensating cleanup first.
//
// Last verified green against production on 2026-08-24: 609 checks.

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_SHARE_SHA256 =
  "6cef54fe67244b920569940d665b80a3bafcbda31e9f8b9cb1a50a13c5b3b86c";
const TRUSTED_SENDER_EMAILS = new Set([
  "mrs.feldman@demo.invalid",
  "goldenmatches@demo.invalid",
]);
const CONTEXTS = new Map([
  ["primary-household", { kind: "household", root: true }],
  ["feldman-shadchanus", { kind: "shadchanus", root: false }],
  ["gross-household", { kind: "household", root: false }],
]);
const PIPELINE_STATES = new Set([
  "new",
  "look_into",
  "not_sure",
  "for_sure_not",
  "yes",
  "unsure",
  "no",
]);
const RESOURCE_TYPES = new Set([
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
const BASELINE_RESOURCE_COUNTS = new Map([
  ["invite", 3],
  ["connection_invite", 2],
  ["child_grant", 2],
  ["connection", 1],
  ["thread", 1],
  ["message", 2],
  ["listing", 1],
  ["listing_withdrawal", 1],
  ["share_link", 1],
  ["task", 1],
  ["share_access_log", 1],
  ["inbox_item", 1],
  ["analytics_event", 3],
  ["message_notification", 2],
  ["task_notification", 1],
  ["trusted_sender", 2],
  ["single_preference", 2],
  ["single_note", 2],
]);
const BASELINE_STORAGE_COUNTS = new Map([
  ["resume", 25],
  ["photo", 22],
  ["entity-file", 3],
]);
const ACCOUNT_SCOPED_TABLES = [
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
  "demo_run_ingest_claims",
  "listing_withdrawal_locks",
  "listings",
  "invites",
  "analytics_events",
  "share_links",
  "trusted_senders",
];
// Physical account children outside the demo bundle inventory. These are
// included in the pre-lifecycle deletion proof so a future billing, AI, or
// account-deletion row cannot be silently removed by this smoke-only cleanup.
const PRE_BUNDLE_ACCOUNT_TABLES = [
  ...ACCOUNT_SCOPED_TABLES,
  "demo_onboarding_intents",
  "demo_run_accounts",
  "account_deletion_requests",
  "ai_parse_attempts",
  "ai_usage",
  "stripe_events",
  "subscription",
];
// These are the run-owned manifest tables. demo_clear_receipts is deliberately
// excluded: release clears retain one receipt for response-loss idempotency;
// it is checked explicitly after the run manifest and deleted only by the
// disposable-bundle cleanup proof below.
const CLEAR_RUN_MANIFEST_TABLES = [
  "demo_runs",
  "demo_run_accounts",
  "demo_run_users",
  "demo_run_storage",
  "demo_share_snapshots",
  "demo_run_actor_intents",
  "demo_run_member_state",
  "demo_run_resources",
  "demo_run_auth_cleanup",
];
const EMPTY_PUBLIC_TABLES = [
  "accounts",
  "account_members",
  "members",
  "member_state",
  ...ACCOUNT_SCOPED_TABLES,
  "connections",
  "connection_invites",
  "child_grants",
  "share_access_log",
  "demo_runs",
  "demo_run_accounts",
  "demo_run_users",
  "demo_run_storage",
  "demo_share_snapshots",
  "demo_run_actor_intents",
  "demo_run_member_state",
  "demo_run_resources",
  "demo_run_auth_cleanup",
  "demo_onboarding_intents",
  "demo_clear_receipts",
];
const RESOURCE_TABLES = {
  invite: "invites",
  connection_invite: "connection_invites",
  child_grant: "child_grants",
  connection: "connections",
  thread: "threads",
  message: "messages",
  listing: "listings",
  share_link: "share_links",
  task: "tasks",
  share_access_log: "share_access_log",
  inbox_item: "inbox_items",
  analytics_event: "analytics_events",
  message_notification: "message_notifications",
  task_notification: "task_notifications",
  trusted_sender: "trusted_senders",
  single_preference: "single_preferences",
  single_note: "single_notes",
};

class HarnessFailure extends Error {
  constructor(label) {
    super(label);
    this.label = label;
  }
}

function requireEnvironment() {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  for (const name of names) {
    if (!process.env[name]) throw new HarnessFailure(`env.${name}`);
  }
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    adminReseedSecret: process.env.ADMIN_RESEED_SECRET ?? "",
    shareWorkerUrl:
      process.env.SHARE_WORKER_URL ?? process.env.VITE_SHARE_WORKER_URL ?? "",
  };
}

function pass(label, count) {
  const suffix = Number.isFinite(count) ? ` count=${count}` : "";
  process.stdout.write(`PASS ${label}${suffix}\n`);
}

function assertPass(label, condition, count) {
  if (!condition) throw new HarnessFailure(label);
  pass(label, count);
}

function unwrapRows(data) {
  if (Array.isArray(data)) return data;
  if (data == null) return [];
  return [data];
}

async function resultData(label, operation) {
  let result;
  try {
    result = await operation();
  } catch {
    throw new HarnessFailure(label);
  }
  if (!result || result.error) throw new HarnessFailure(label);
  return result.data;
}

async function queryRows(client, table, columns, configure, label) {
  return resultData(label, async () => {
    let query = client.from(table).select(columns);
    if (configure) query = configure(query);
    return query;
  });
}

async function countRows(client, table, configure, label) {
  let result;
  try {
    let query = client.from(table).select("*", { count: "exact", head: true });
    if (configure) query = configure(query);
    result = await query;
  } catch {
    throw new HarnessFailure(label);
  }
  if (!result || result.error) throw new HarnessFailure(label);
  return result.count ?? 0;
}

async function rpc(client, name, args, label) {
  return resultData(label, () =>
    args === undefined ? client.rpc(name) : client.rpc(name, args),
  );
}

async function expectRpcFailure(client, name, args, label) {
  try {
    await rpc(client, name, args, label);
  } catch {
    pass(label);
    return;
  }
  throw new HarnessFailure(`${label}.unexpected_success`);
}

async function invoke(client, name, options, label) {
  return resultData(label, () => client.functions.invoke(name, options));
}

async function listAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await resultData("auth.list_users", () =>
      admin.auth.admin.listUsers({ page, perPage: 1000 }),
    );
    const pageUsers = result?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) return users;
  }
  throw new HarnessFailure("auth.list_users.pagination");
}

function userIsSyntheticForRun(user, runId) {
  const metadata = user?.app_metadata ?? {};
  return (
    metadata.demo === true &&
    Number(metadata.demo_run_id) === Number(runId) &&
    typeof metadata.demo_actor_key === "string"
  );
}

function assertExactSet(label, values, expected) {
  const actual = new Set(values);
  assertPass(
    label,
    actual.size === expected.size &&
      [...expected].every((value) => actual.has(value)),
    actual.size,
  );
}

function ageAtLeastEighteen(dateValue) {
  const dob = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return dob <= cutoff;
}

async function listStorageObjects(admin, bucket, prefix = "") {
  const objects = [];
  for (let offset = 0; offset <= 100000; offset += 1000) {
    const rows = await resultData("storage.list", () =>
      admin.storage.from(bucket).list(prefix, { limit: 1000, offset }),
    );
    if (!rows || rows.length === 0) return objects;
    for (const row of rows) {
      const name = typeof row.name === "string" ? row.name : "";
      const path = prefix ? `${prefix}/${name}` : name;
      if (row.id == null && name) {
        objects.push(...(await listStorageObjects(admin, bucket, path)));
      } else if (name) {
        objects.push(path);
      }
    }
    if (rows.length < 1000) return objects;
  }
  throw new HarnessFailure("storage.list.pagination");
}

async function allStorageObjects(admin) {
  const buckets = await resultData("storage.list_buckets", () =>
    admin.storage.listBuckets(),
  );
  const objects = [];
  for (const bucket of buckets ?? []) {
    objects.push(...(await listStorageObjects(admin, bucket.name)));
  }
  return objects;
}

async function verifyEmpty(admin) {
  const users = await listAuthUsers(admin);
  assertPass("empty.auth_users", users.length === 0, users.length);
  for (const table of EMPTY_PUBLIC_TABLES) {
    const count = await countRows(
      admin,
      table,
      undefined,
      `empty.public.${table}`,
    );
    assertPass(`empty.public.${table}`, count === 0, count);
  }
  const objects = await allStorageObjects(admin);
  assertPass("empty.storage_objects", objects.length === 0, objects.length);
}

async function verifyShareRoutes({ admin, shareWorkerUrl, rootAccountId }) {
  if (!shareWorkerUrl) throw new HarnessFailure("env.SHARE_WORKER_URL");
  let base;
  try {
    base = new URL(shareWorkerUrl);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) {
      throw new Error("unsafe share URL");
    }
  } catch {
    throw new HarnessFailure("env.SHARE_WORKER_URL");
  }
  const links = await queryRows(
    admin,
    "share_links",
    "token",
    (query) => query.eq("account_id", rootAccountId).limit(1),
    "seed.share_link_token",
  );
  const token = links[0]?.token;
  if (typeof token !== "string" || token.length < 16) {
    throw new HarnessFailure("seed.share_link_token");
  }
  let manifestResponse;
  try {
    manifestResponse = await fetch(
      new URL(`/r/${encodeURIComponent(token)}`, base),
    );
  } catch {
    throw new HarnessFailure("seed.share_url_manifest");
  }
  assertPass(
    "seed.share_url_manifest_status",
    manifestResponse.status === 200,
    manifestResponse.status,
  );
  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch {
    throw new HarnessFailure("seed.share_url_manifest_json");
  }
  assertPass(
    "seed.share_url_manifest_success",
    manifest?.success === true && Array.isArray(manifest?.data?.files),
  );
  const fileKey = manifest.data.files[0]?.fileKey;
  assertPass(
    "seed.share_url_file_key",
    typeof fileKey === "string" && fileKey.length > 0,
  );
  let fileResponse;
  try {
    fileResponse = await fetch(
      new URL(
        `/r/${encodeURIComponent(token)}/file/${encodeURIComponent(fileKey)}`,
        base,
      ),
    );
  } catch {
    throw new HarnessFailure("seed.share_file_route");
  }
  assertPass(
    "seed.share_file_route_status",
    fileResponse.status === 200,
    fileResponse.status,
  );
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  assertPass(
    "seed.share_file_route_immutable_digest",
    createHash("sha256").update(bytes).digest("hex") === EXPECTED_SHARE_SHA256,
  );
  assertPass(
    "seed.share_file_route_content_type",
    (fileResponse.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/pdf"),
  );
}

async function verifyContextSurfaces({ normal, accountIds, rootAccountId }) {
  const previewAccountIds = [...new Set(Object.values(accountIds))];
  for (const [contextKey, expected] of CONTEXTS) {
    const accountId = accountIds[contextKey];
    if (!accountId) throw new HarnessFailure(`context.${contextKey}.account`);
    await rpc(
      normal,
      "set_active_context",
      { p_account_id: accountId },
      `context.${contextKey}.activate`,
    );
    const contexts = unwrapRows(
      await rpc(
        normal,
        "my_contexts",
        undefined,
        `context.${contextKey}.my_contexts`,
      ),
    );
    assertPass(
      `context.${contextKey}.active_surface`,
      contexts.some(
        (row) =>
          row.account_id === accountId &&
          row.is_active === true &&
          row.kind === expected.kind,
      ),
    );
    const preview = unwrapRows(
      await rpc(
        normal,
        "current_demo_preview_accounts",
        undefined,
        `context.${contextKey}.preview`,
      ),
    );
    assertExactSet(
      `context.${contextKey}.preview_bundle`,
      preview.map((row) => row.account_id),
      new Set(Object.values(accountIds)),
    );
    const rows = async (table, columns, configure, label) =>
      queryRows(normal, table, columns, configure, label);
    const ownedRows = async (table, columns, label) =>
      rows(table, columns, (query) => query.eq("account_id", accountId), label);
    const rootRows = async (table, columns, label) =>
      rows(
        table,
        columns,
        (query) => query.eq("account_id", rootAccountId),
        label,
      );
    const rootConnectionInviteRows = async (columns, label) =>
      rows(
        "connection_invites",
        columns,
        (query) =>
          query.or(
            `inviter_account_id.eq.${rootAccountId},accepted_by_account_id.eq.${rootAccountId}`,
          ),
        label,
      );

    // The normal customer JWT must see the intended scenario rows in the
    // active context.  These assertions deliberately reject empty-array
    // RLS regressions rather than treating a successful HTTP response as
    // proof that the surface is contained and useful.
    if (contextKey === "primary-household") {
      const [
        singles,
        shidduchim,
        preferences,
        notes,
        invites,
        connectionInvites,
        grants,
        connections,
        threads,
        messages,
        inbox,
        tasks,
        analytics,
        listings,
        shares,
        shareAccess,
        trustedSenders,
      ] = await Promise.all([
        ownedRows("singles", "id", `context.${contextKey}.singles`),
        ownedRows(
          "shidduchim",
          "id,pipeline_state",
          `context.${contextKey}.pipeline`,
        ),
        ownedRows(
          "single_preferences",
          "id",
          `context.${contextKey}.preferences`,
        ),
        ownedRows("single_notes", "id", `context.${contextKey}.notes`),
        ownedRows(
          "invites",
          "id,status",
          `context.${contextKey}.consent_invites`,
        ),
        rootConnectionInviteRows(
          "id,status",
          `context.${contextKey}.connection_invites`,
        ),
        rows(
          "child_grants",
          "id,status",
          (query) => query.eq("proposer_account_id", rootAccountId),
          `context.${contextKey}.child_grants`,
        ),
        rows(
          "connections",
          "id,status",
          (query) =>
            query.or(
              `household_account_id.eq.${rootAccountId},shadchanus_account_id.eq.${accountIds["feldman-shadchanus"]}`,
            ),
          `context.${contextKey}.connections`,
        ),
        rows("threads", "id", undefined, `context.${contextKey}.threads`),
        rows("messages", "id", undefined, `context.${contextKey}.messages`),
        ownedRows("inbox_items", "id,status", `context.${contextKey}.inbox`),
        ownedRows("tasks", "id", `context.${contextKey}.reminders`),
        ownedRows(
          "analytics_events",
          "id,event_type",
          `context.${contextKey}.analytics`,
        ),
        rows(
          "listings",
          "id,account_id",
          (query) => query.in("account_id", previewAccountIds),
          `context.${contextKey}.listings`,
        ),
        ownedRows("share_links", "id", `context.${contextKey}.share_metadata`),
        rows(
          "share_access_log",
          "id",
          undefined,
          `context.${contextKey}.share_receipts`,
        ),
        ownedRows(
          "trusted_senders",
          "id,email",
          `context.${contextKey}.trusted_senders`,
        ),
      ]);
      assertPass(
        `context.${contextKey}.crm_graph`,
        singles.length >= 2 &&
          shidduchim.length >= 20 &&
          preferences.length >= 1 &&
          notes.length >= 1,
      );
      assertPass(
        `context.${contextKey}.consent_graph`,
        invites.length >= 3 &&
          connectionInvites.length >= 2 &&
          grants.length >= 2 &&
          connections.length >= 1,
      );
      assertPass(
        `context.${contextKey}.communication_graph`,
        threads.length >= 1 && messages.length >= 2,
      );
      assertPass(
        `context.${contextKey}.capture_graph`,
        inbox.length >= 1 && tasks.length >= 1 && analytics.length >= 3,
      );
      assertPass(
        `context.${contextKey}.listing_share_graph`,
        listings.length === 1 && shares.length >= 1 && shareAccess.length >= 1,
      );
      assertPass(
        `context.${contextKey}.trusted_sender_graph`,
        trustedSenders.length >= 1,
      );
      assertExactSet(
        `context.${contextKey}.pipeline_states`,
        shidduchim.map((row) => row.pipeline_state),
        PIPELINE_STATES,
      );
    } else if (contextKey === "feldman-shadchanus") {
      const [listings, connections, threads, messages] = await Promise.all([
        ownedRows("listings", "id", `context.${contextKey}.listing_surface`),
        rows(
          "connections",
          "id,status",
          (query) =>
            query.or(
              `household_account_id.eq.${rootAccountId},shadchanus_account_id.eq.${accountId}`,
            ),
          `context.${contextKey}.connection_surface`,
        ),
        rows(
          "threads",
          "id",
          undefined,
          `context.${contextKey}.discussion_threads`,
        ),
        rows(
          "messages",
          "id",
          undefined,
          `context.${contextKey}.discussion_messages`,
        ),
      ]);
      assertPass(
        `context.${contextKey}.shadchan_graph`,
        listings.length === 1 && connections.length >= 1,
      );
      assertPass(
        `context.${contextKey}.discussion_graph`,
        threads.length >= 1 && messages.length >= 2,
      );
    } else {
      const [grants, singles, trustedSenders] = await Promise.all([
        rows(
          "child_grants",
          "id,status",
          undefined,
          `context.${contextKey}.grant_surface`,
        ),
        rows(
          "singles",
          "id",
          undefined,
          `context.${contextKey}.shared_single_surface`,
        ),
        ownedRows(
          "trusted_senders",
          "id,email",
          `context.${contextKey}.trusted_senders`,
        ),
      ]);
      assertPass(
        `context.${contextKey}.grant_graph`,
        grants.some((row) => row.status === "accepted"),
      );
      assertPass(
        `context.${contextKey}.shared_single_graph`,
        singles.length >= 1,
      );
      assertPass(
        `context.${contextKey}.trusted_sender_graph`,
        trustedSenders.length >= 1,
      );
    }

    const deniedRootInbox = await rootRows(
      "inbox_items",
      "id",
      `context.${contextKey}.denied_root_inbox`,
    );
    if (contextKey !== "primary-household") {
      assertPass(
        `context.${contextKey}.root_data_contained`,
        deniedRootInbox.length === 0,
      );
    }
    const history = unwrapRows(
      await rpc(
        normal,
        "demo_delivery_history",
        undefined,
        `context.${contextKey}.delivery_surface`,
      ),
    );
    assertPass(
      `context.${contextKey}.delivery_surface_present`,
      history.length >= 4,
      history.length,
    );
    assertPass(
      `context.${contextKey}.delivery_surface_simulated`,
      history.every((row) => row.simulated === true),
    );
    assertExactSet(
      `context.${contextKey}.delivery_event_types`,
      history.map((row) => row.event_type),
      new Set(["message", "reminder", "share"]),
    );
  }
  await rpc(
    normal,
    "set_active_context",
    { p_account_id: rootAccountId },
    "context.return_to_root",
  );
  pass("context.all_surfaces");
}

async function invokeAdminReseed({ url, secret }) {
  if (!secret) throw new HarnessFailure("env.ADMIN_RESEED_SECRET");
  let response;
  try {
    response = await fetch(
      `${url.replace(/\/$/, "")}/functions/v1/admin_reseed_demo_accounts`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      },
    );
  } catch {
    throw new HarnessFailure("flow.admin_reseed_demo_accounts.request");
  }
  assertPass(
    "flow.admin_reseed_demo_accounts.status",
    response.status === 200,
    response.status,
  );
  let body;
  try {
    body = await response.json();
  } catch {
    throw new HarnessFailure("flow.admin_reseed_demo_accounts.json");
  }
  assertPass(
    "flow.admin_reseed_demo_accounts.succeeded",
    Number(body?.processed) >= 1 &&
      Number(body?.succeeded) >= 1 &&
      Number(body?.failed) === 0,
  );
}

async function verifySeed({ admin, anon, normal, runId, rootAccountId }) {
  const runAccounts = await queryRows(
    admin,
    "demo_run_accounts",
    "account_id,context_key,context_kind,is_root",
    (query) => query.eq("run_id", runId),
    "seed.manifest.contexts",
  );
  assertPass(
    "seed.manifest.context_count",
    runAccounts.length === 3,
    runAccounts.length,
  );
  assertExactSet(
    "seed.manifest.context_keys",
    runAccounts.map((row) => row.context_key),
    new Set(CONTEXTS.keys()),
  );
  assertPass(
    "seed.manifest.root_context",
    runAccounts.filter((row) => row.is_root).length === 1 &&
      runAccounts.some(
        (row) =>
          row.account_id === rootAccountId &&
          row.context_key === "primary-household" &&
          row.context_kind === "household",
      ),
  );
  for (const row of runAccounts) {
    const expected = CONTEXTS.get(row.context_key);
    assertPass(
      `seed.manifest.context_kind.${row.context_key}`,
      expected?.kind === row.context_kind && expected.root === row.is_root,
    );
  }
  const accountIds = runAccounts.map((row) => row.account_id);
  const companionIds = accountIds.filter((id) => id !== rootAccountId);
  const accountIdByContext = new Map(
    runAccounts.map((row) => [row.context_key, row.account_id]),
  );

  const accounts = await queryRows(
    admin,
    "accounts",
    "id,kind,demo",
    (query) => query.in("id", accountIds),
    "seed.accounts",
  );
  assertPass("seed.accounts.count", accounts.length === 3, accounts.length);
  assertPass(
    "seed.accounts.kinds",
    accounts.every((row) =>
      [...CONTEXTS.values()].some((context) => context.kind === row.kind),
    ),
  );
  assertPass(
    "seed.root_demo_flag",
    accounts.some((row) => row.id === rootAccountId && row.demo === true),
  );

  const memberships = await queryRows(
    admin,
    "account_members",
    "id,account_id,user_id,role,status",
    (query) => query.in("account_id", accountIds),
    "seed.memberships",
  );
  assertPass(
    "seed.real_member_companion_memberships",
    accountIds.every((accountId) =>
      memberships.some(
        (row) =>
          row.account_id === accountId &&
          row.user_id === state.userId &&
          row.status === "active",
      ),
    ),
    accountIds.length,
  );

  const runUsers = await queryRows(
    admin,
    "demo_run_users",
    "user_id,actor_key,email_domain",
    (query) => query.eq("run_id", runId),
    "seed.manifest.synthetic_actors",
  );
  assertPass(
    "seed.synthetic_actor_count",
    runUsers.length === 3,
    runUsers.length,
  );
  assertPass(
    "seed.synthetic_actor_domains",
    runUsers.every((row) => row.email_domain === "invalid"),
  );
  assertExactSet(
    "seed.synthetic_actor_keys",
    runUsers.map((row) => row.actor_key),
    new Set(["dovid-klein", "leah-feldman", "miriam-gross"]),
  );
  state.syntheticUserIds = runUsers.map((row) => row.user_id);
  const authUsers = await listAuthUsers(admin);
  const syntheticAuthUsers = authUsers.filter((user) =>
    userIsSyntheticForRun(user, runId),
  );
  assertPass(
    "seed.synthetic_auth_users",
    syntheticAuthUsers.length === 3 &&
      syntheticAuthUsers.every((user) =>
        runUsers.some((row) => row.user_id === user.id),
      ),
    syntheticAuthUsers.length,
  );

  const trustedSenders = await queryRows(
    admin,
    "trusted_senders",
    "account_id,email,created_by_member_id",
    (query) => query.in("account_id", accountIds),
    "seed.trusted_senders",
  );
  assertPass(
    "seed.trusted_sender_count",
    trustedSenders.length === 2,
    trustedSenders.length,
  );
  assertExactSet(
    "seed.trusted_sender_addresses",
    trustedSenders.map((row) => row.email),
    TRUSTED_SENDER_EMAILS,
  );
  const expectedTrustedSenderAccounts = new Map([
    ["mrs.feldman@demo.invalid", accountIdByContext.get("primary-household")],
    ["goldenmatches@demo.invalid", accountIdByContext.get("gross-household")],
  ]);
  const actorUserIdByKey = new Map(
    runUsers.map((row) => [row.actor_key, row.user_id]),
  );
  const expectedTrustedSenderCreators = new Map([
    [
      "mrs.feldman@demo.invalid",
      memberships.find(
        (row) =>
          row.account_id === accountIdByContext.get("primary-household") &&
          row.user_id === actorUserIdByKey.get("dovid-klein"),
      )?.id,
    ],
    [
      "goldenmatches@demo.invalid",
      memberships.find(
        (row) =>
          row.account_id === accountIdByContext.get("gross-household") &&
          row.user_id === actorUserIdByKey.get("miriam-gross"),
      )?.id,
    ],
  ]);
  const accountKindById = new Map(accounts.map((row) => [row.id, row.kind]));
  assertPass(
    "seed.trusted_sender_household_ownership",
    trustedSenders.every(
      (row) =>
        expectedTrustedSenderAccounts.get(row.email) === row.account_id &&
        accountKindById.get(row.account_id) === "household" &&
        expectedTrustedSenderCreators.get(row.email) ===
          row.created_by_member_id,
    ),
  );

  const singles = await queryRows(
    admin,
    "singles",
    "id,gender,dob,status",
    (query) => query.eq("account_id", rootAccountId),
    "seed.singles",
  );
  assertPass("seed.singles.count", singles.length === 2, singles.length);
  assertExactSet(
    "seed.singles.genders",
    singles.map((row) => row.gender),
    new Set(["female", "male"]),
  );
  assertPass(
    "seed.singles.adults",
    singles.every(
      (row) => row.status === "active" && ageAtLeastEighteen(row.dob),
    ),
    singles.length,
  );
  const preferences = await queryRows(
    admin,
    "single_preferences",
    "single_id,body,visible_to_manager",
    (query) => query.eq("account_id", rootAccountId),
    "seed.single_preferences",
  );
  const notes = await queryRows(
    admin,
    "single_notes",
    "single_id,body,visible_to_manager",
    (query) => query.eq("account_id", rootAccountId),
    "seed.single_notes",
  );
  assertPass(
    "seed.single_preferences.exact_count",
    preferences.length === 2,
    preferences.length,
  );
  assertPass("seed.single_notes.exact_count", notes.length === 2, notes.length);
  assertPass(
    "seed.single_private_content.owner_axes",
    preferences.every((row) =>
      singles.some((single) => single.id === row.single_id),
    ) &&
      notes.every((row) =>
        singles.some((single) => single.id === row.single_id),
      ),
  );
  const visiblePreferences = await queryRows(
    normal,
    "single_preferences",
    "id,visible_to_manager",
    (query) => query.eq("account_id", rootAccountId),
    "seed.single_preferences.manager_visibility",
  );
  const visibleNotes = await queryRows(
    normal,
    "single_notes",
    "id,visible_to_manager",
    (query) => query.eq("account_id", rootAccountId),
    "seed.single_notes.manager_visibility",
  );
  assertPass(
    "seed.single_preferences.private_visibility",
    visiblePreferences.length === 1 &&
      visiblePreferences[0].visible_to_manager === true,
    visiblePreferences.length,
  );
  assertPass(
    "seed.single_notes.private_visibility",
    visibleNotes.length === 1 && visibleNotes[0].visible_to_manager === true,
    visibleNotes.length,
  );

  const shidduchim = await queryRows(
    admin,
    "shidduchim",
    "single_id,person_gender,pipeline_state",
    (query) => query.eq("account_id", rootAccountId),
    "seed.shidduchim",
  );
  assertPass(
    "seed.shidduchim.count",
    shidduchim.length === 20,
    shidduchim.length,
  );
  assertExactSet(
    "seed.pipeline.stages",
    shidduchim.map((row) => row.pipeline_state),
    PIPELINE_STATES,
  );
  const genderBySingle = new Map(singles.map((row) => [row.id, row.gender]));
  assertPass(
    "seed.shidduchim.woman_man_only",
    shidduchim.every(
      (row) =>
        (genderBySingle.get(row.single_id) === "female" &&
          row.person_gender === "male") ||
        (genderBySingle.get(row.single_id) === "male" &&
          row.person_gender === "female"),
    ),
    shidduchim.length,
  );
  assertPass(
    "seed.pipeline.balanced_single_counts",
    singles.every(
      (single) =>
        shidduchim.filter((row) => row.single_id === single.id).length > 0,
    ),
  );

  const listings = await queryRows(
    admin,
    "listings",
    "id,account_id,listing_type,single_id,shadchan_name,shadchan_area,shadchan_contact_info",
    (query) => query.in("account_id", accountIds),
    "seed.listings",
  );
  assertPass(
    "seed.listings.exact_count",
    listings.length === 1,
    listings.length,
  );
  // `anon` holds only the public listing projection (06_grants.sql, AD-21 /
  // Story 9.1 finding F6). Keep tenant and subject identifiers in the admin
  // and authenticated-preview checks below; the public containment probe must
  // use only fields an anonymous search is allowed to select and filter on.
  const demoListing = listings[0];
  const anonymousListings = await queryRows(
    anon,
    "listings",
    "listing_type,shadchan_name,shadchan_area,shadchan_contact_info",
    (query) =>
      query
        .eq("shadchan_name", demoListing?.shadchan_name)
        .eq("shadchan_contact_info", demoListing?.shadchan_contact_info),
    "seed.anon_listing_search",
  );
  assertPass(
    "seed.anon_listing_search_excludes_demo_bundle",
    anonymousListings.length === 0,
    anonymousListings.length,
  );
  const previewAccounts = unwrapRows(
    await rpc(
      normal,
      "current_demo_preview_accounts",
      undefined,
      "seed.authenticated_preview_rpc",
    ),
  );
  assertExactSet(
    "seed.authenticated_preview_accounts",
    previewAccounts.map((row) => row.account_id),
    new Set(accountIds),
  );
  const authenticatedListings = await queryRows(
    normal,
    "listings",
    "id,account_id,listing_type,single_id",
    (query) => query.in("account_id", accountIds),
    "seed.authenticated_listing_preview",
  );
  assertPass(
    "seed.authenticated_listing_preview_exact_count",
    authenticatedListings.length === 1,
    authenticatedListings.length,
  );

  const snapshots = await queryRows(
    admin,
    "demo_share_snapshots",
    "snapshot,revoked_at,expires_at",
    (query) => query.eq("run_id", runId),
    "seed.share_snapshot",
  );
  assertPass(
    "seed.share_snapshot.count",
    snapshots.length === 1,
    snapshots.length,
  );
  const snapshot = snapshots[0]?.snapshot;
  const file = snapshot?.files?.[0];
  assertPass(
    "seed.share_snapshot.immutable_pathless_pdf",
    snapshot?.files?.length === 1 &&
      file?.preWatermarked === true &&
      file?.mimeType === "application/pdf" &&
      typeof file?.bytesBase64 === "string" &&
      !Object.hasOwn(file, "storagePath") &&
      !Object.hasOwn(file, "path") &&
      !Object.hasOwn(file, "url"),
  );
  const actualShareHash = createHash("sha256")
    .update(Buffer.from(file.bytesBase64, "base64"))
    .digest("hex");
  assertPass(
    "seed.share_snapshot.pdf_sha256",
    actualShareHash === EXPECTED_SHARE_SHA256,
  );

  const resources = await queryRows(
    admin,
    "demo_run_resources",
    "resource_type,resource_id",
    (query) => query.eq("run_id", runId),
    "seed.manifest.resources",
  );
  assertPass(
    "seed.manifest.resources_exact_total",
    resources.length === 29,
    resources.length,
  );
  assertExactSet(
    "seed.manifest.resource_types",
    resources.map((row) => row.resource_type),
    RESOURCE_TYPES,
  );
  state.resources = resources;
  const resourceIds = (type) =>
    resources
      .filter((row) => row.resource_type === type)
      .map((row) => row.resource_id);
  for (const [resourceType, expectedCount] of BASELINE_RESOURCE_COUNTS) {
    assertPass(
      `seed.manifest.resource_count.${resourceType}`,
      resourceIds(resourceType).length === expectedCount,
      resourceIds(resourceType).length,
    );
  }
  const listingIds = resourceIds("listing");
  const withdrawnSingleIds = resourceIds("listing_withdrawal");
  const withdrawnSingleId = withdrawnSingleIds[0];
  assertPass(
    "seed.listing_resource_matches_live_row",
    listingIds.length === 1 && listings[0]?.id === listingIds[0],
    listingIds.length,
  );
  assertPass(
    "seed.listing_withdrawal.single_owned_by_root",
    singles.some((single) => single.id === withdrawnSingleId),
    withdrawnSingleIds.length,
  );
  const withdrawalLocks = await queryRows(
    admin,
    "listing_withdrawal_locks",
    "account_id,single_id",
    (query) =>
      query.in("account_id", accountIds).eq("single_id", withdrawnSingleId),
    "seed.listing_withdrawal.lock",
  );
  assertPass(
    "seed.listing_withdrawal.lock_backing",
    withdrawalLocks.length === 1 &&
      withdrawalLocks[0]?.account_id === rootAccountId &&
      withdrawalLocks[0]?.single_id === withdrawnSingleId,
    withdrawalLocks.length,
  );
  const withdrawnListings = await queryRows(
    admin,
    "listings",
    "id",
    (query) =>
      query
        .eq("account_id", rootAccountId)
        .eq("listing_type", "single")
        .eq("single_id", withdrawnSingleId),
    "seed.listing_withdrawal.no_live_listing",
  );
  assertPass(
    "seed.listing_withdrawal.no_live_listing",
    withdrawnListings.length === 0,
    withdrawnListings.length,
  );
  const messageNotificationIds = resourceIds("message_notification");
  const taskNotificationIds = resourceIds("task_notification");
  const shareAccessIds = resourceIds("share_access_log");
  assertPass(
    "seed.simulated.message_receipts",
    messageNotificationIds.length === 2,
    messageNotificationIds.length,
  );
  assertPass(
    "seed.simulated.task_receipts",
    taskNotificationIds.length === 1,
    taskNotificationIds.length,
  );
  const messageNotifications = await queryRows(
    admin,
    "message_notifications",
    "id,status,simulated",
    (query) => query.in("id", messageNotificationIds),
    "seed.simulated.message_rows",
  );
  const taskNotifications = await queryRows(
    admin,
    "task_notifications",
    "id,status,simulated",
    (query) => query.in("id", taskNotificationIds),
    "seed.simulated.task_rows",
  );
  assertPass(
    "seed.simulated.message_rows_only",
    messageNotifications.length === messageNotificationIds.length &&
      messageNotifications.every(
        (row) => row.simulated === true && row.status === "sent",
      ),
    messageNotifications.length,
  );
  assertPass(
    "seed.simulated.task_rows_only",
    taskNotifications.length === taskNotificationIds.length &&
      taskNotifications.every(
        (row) => row.simulated === true && row.status === "sent",
      ),
    taskNotifications.length,
  );
  const ordinaryMessageQueue = await countRows(
    admin,
    "message_notifications",
    (query) => query.in("id", messageNotificationIds).eq("simulated", false),
    "seed.ordinary_message_queue",
  );
  const ordinaryTaskQueue = await countRows(
    admin,
    "task_notifications",
    (query) => query.in("id", taskNotificationIds).eq("simulated", false),
    "seed.ordinary_task_queue",
  );
  assertPass(
    "seed.no_real_message_delivery",
    ordinaryMessageQueue === 0,
    ordinaryMessageQueue,
  );
  assertPass(
    "seed.no_real_task_delivery",
    ordinaryTaskQueue === 0,
    ordinaryTaskQueue,
  );
  const deliveryHistory = unwrapRows(
    await rpc(
      normal,
      "demo_delivery_history",
      undefined,
      "seed.delivery_history",
    ),
  );
  assertPass(
    "seed.delivery_history.exists",
    deliveryHistory.length > 0,
    deliveryHistory.length,
  );
  assertExactSet(
    "seed.delivery_history.event_types",
    deliveryHistory.map((row) => row.event_type),
    new Set(["message", "reminder", "share"]),
  );
  assertPass(
    "seed.delivery_history.simulated_only",
    deliveryHistory.every((row) => row.simulated === true),
  );
  assertPass(
    "seed.share_access_receipt",
    shareAccessIds.length > 0,
    shareAccessIds.length,
  );
  await verifyShareRoutes({
    admin,
    shareWorkerUrl: state.shareWorkerUrl,
    rootAccountId,
  });

  const storageReceipts = await queryRows(
    admin,
    "demo_run_storage",
    "bucket,resource_key,storage_path",
    (query) => query.eq("run_id", runId),
    "seed.manifest.storage",
  );
  assertPass(
    "seed.manifest.storage_exact_total",
    storageReceipts.length === 50,
    storageReceipts.length,
  );
  assertPass(
    "seed.manifest.storage_documents",
    storageReceipts.filter((row) => row.bucket === "documents").length === 47,
    storageReceipts.filter((row) => row.bucket === "documents").length,
  );
  assertPass(
    "seed.manifest.storage_entity_files",
    storageReceipts.filter((row) => row.bucket === "entity-files").length === 3,
    storageReceipts.filter((row) => row.bucket === "entity-files").length,
  );
  for (const [resourceKey, expectedCount] of BASELINE_STORAGE_COUNTS) {
    const count = storageReceipts.filter(
      (row) => row.resource_key === resourceKey,
    ).length;
    assertPass(
      `seed.manifest.storage_resource.${resourceKey}`,
      count === expectedCount,
      count,
    );
  }
  for (const bucket of ["documents", "entity-files"]) {
    const paths = await listStorageObjects(admin, bucket);
    const expectedCount = bucket === "documents" ? 47 : 3;
    assertPass(
      `seed.storage_objects.${bucket}`,
      paths.length === expectedCount,
      paths.length,
    );
    assertPass(
      `seed.storage_objects.${bucket}_exact_prefixes`,
      paths.every((path) =>
        accountIds.some((accountId) => path.startsWith(`${accountId}/`)),
      ),
      paths.length,
    );
  }
  const storageObjects = await allStorageObjects(admin);
  assertPass(
    "seed.storage_objects.exact_total",
    storageObjects.length === 50,
    storageObjects.length,
  );

  await expectRpcFailure(
    normal,
    "add_persona",
    { p_persona: "single" },
    "seed.live_persona_mutation_blocked",
  );
  const membershipBefore = await queryRows(
    admin,
    "account_members",
    "role,status",
    (query) =>
      query
        .eq("account_id", rootAccountId)
        .eq("user_id", state.userId)
        .single(),
    "seed.live_membership_before_mutation",
  );
  const membershipAttempt = await normal
    .from("account_members")
    .update({ role: "helper" })
    .eq("account_id", rootAccountId)
    .eq("user_id", state.userId)
    .select("role,status");
  assertPass(
    "seed.live_membership_mutation_blocked",
    Boolean(membershipAttempt.error) ||
      (membershipAttempt.data?.[0]?.role === membershipBefore.role &&
        membershipAttempt.data?.[0]?.status === membershipBefore.status),
  );
  pass("seed.official_bundle");
  return { accountIds, companionIds, runAccounts, resources };
}

async function verifyCleanup({
  admin,
  normal,
  runId,
  rootAccountId,
  accountIds,
  companionIds,
  resources,
}) {
  for (const table of CLEAR_RUN_MANIFEST_TABLES) {
    // demo_runs is the only manifest table whose primary key is `id`; all
    // dependent lifecycle tables carry the run foreign key as `run_id`.
    const runColumn = table === "demo_runs" ? "id" : "run_id";
    const count = await countRows(
      admin,
      table,
      (query) => query.eq(runColumn, runId),
      `clear.manifest.${table}`,
    );
    assertPass(`clear.manifest.${table}_empty`, count === 0, count);
  }
  const accountRows = await queryRows(
    admin,
    "accounts",
    "id,demo",
    (query) => query.in("id", accountIds),
    "clear.accounts",
  );
  // The root household must NOT survive the demo. This assertion is the
  // inverse of what it used to be: the harness asserted the root was RETAINED,
  // because that is what finalize_demo_clear() did — archive the bootstrap
  // membership, release `demo`, keep the account. Since my_contexts() requires
  // an ACTIVE membership, that account was unreachable to everyone forever,
  // and a fresh one was built on the next demo, so the husks accumulated. The
  // harness's own cleanup was sweeping them, which is exactly why the leak
  // never surfaced as a failure here.
  assertPass(
    "clear.root_account_deleted",
    accountRows.every((row) => row.id !== rootAccountId),
    accountRows.length,
  );
  assertPass(
    "clear.companion_accounts_removed",
    accountRows.every((row) => row.id === rootAccountId),
    accountRows.length,
  );

  for (const table of ACCOUNT_SCOPED_TABLES) {
    const count = await countRows(
      admin,
      table,
      (query) => query.in("account_id", accountIds),
      `clear.account_rows.${table}`,
    );
    assertPass(`clear.account_rows.${table}_empty`, count === 0, count);
  }
  const clearedConnectionIds = resources
    .filter((resource) => resource.resource_type === "connection")
    .map((resource) => resource.resource_id);
  for (const table of [
    "message_notifications",
    "threads",
    "messages",
    "thread_participants",
  ]) {
    const count = await countRows(
      admin,
      table,
      (query) =>
        clearedConnectionIds.length === 0
          ? query.eq("id", -1)
          : query.in("connection_id", clearedConnectionIds),
      `clear.connection_discussion.${table}`,
    );
    assertPass(
      `clear.connection_discussion.${table}_empty`,
      count === 0,
      count,
    );
  }
  const membershipCount = await countRows(
    admin,
    "account_members",
    (query) => query.in("account_id", companionIds),
    "clear.account_members",
  );
  assertPass(
    "clear.companion_memberships_removed",
    membershipCount === 0,
    membershipCount,
  );
  const rootActiveMemberships = await countRows(
    admin,
    "account_members",
    (query) =>
      query
        .eq("account_id", rootAccountId)
        .eq("user_id", state.userId)
        .eq("status", "active"),
    "clear.root_bootstrap_membership",
  );
  assertPass(
    "clear.root_bootstrap_membership_released",
    rootActiveMemberships === 0,
    rootActiveMemberships,
  );
  // The account is gone, so its membership rows must be gone with it —
  // including the archived bootstrap one, which dispose_orphaned_account()
  // deletes explicitly rather than leaving to a cascade.
  const rootMemberships = await queryRows(
    admin,
    "account_members",
    "status",
    (query) => query.eq("account_id", rootAccountId),
    "clear.root_memberships",
  );
  assertPass(
    "clear.root_memberships_removed",
    rootMemberships.length === 0,
    rootMemberships.length,
  );
  const trustedCount = await countRows(
    admin,
    "trusted_senders",
    (query) => query.in("account_id", accountIds),
    "clear.trusted_senders",
  );
  assertPass("clear.trusted_senders_removed", trustedCount === 0, trustedCount);

  for (const resource of resources) {
    if (resource.resource_type === "listing_withdrawal") {
      const count = await countRows(
        admin,
        "listing_withdrawal_locks",
        (query) =>
          query
            .in("account_id", accountIds)
            .eq("single_id", resource.resource_id),
        "clear.resource.listing_withdrawal",
      );
      assertPass(
        "clear.resource.listing_withdrawal_removed",
        count === 0,
        count,
      );
      continue;
    }
    const table = RESOURCE_TABLES[resource.resource_type];
    const count = await countRows(
      admin,
      table,
      (query) => query.eq("id", resource.resource_id),
      `clear.resource.${resource.resource_type}`,
    );
    assertPass(
      `clear.resource.${resource.resource_type}_removed`,
      count === 0,
      count,
    );
  }
  const syntheticIds = state.syntheticUserIds;
  const syntheticMembers = await countRows(
    admin,
    "members",
    (query) => query.in("user_id", syntheticIds),
    "clear.synthetic_members",
  );
  const syntheticStates = await countRows(
    admin,
    "member_state",
    (query) => query.in("user_id", syntheticIds),
    "clear.synthetic_member_state",
  );
  assertPass(
    "clear.synthetic_members_removed",
    syntheticMembers === 0,
    syntheticMembers,
  );
  assertPass(
    "clear.synthetic_member_state_removed",
    syntheticStates === 0,
    syntheticStates,
  );
  const onboardingIntentCount = await countRows(
    admin,
    "demo_onboarding_intents",
    (query) => query.eq("user_id", state.userId),
    "clear.onboarding_intent",
  );
  assertPass(
    "clear.onboarding_intent_removed",
    onboardingIntentCount === 0,
    onboardingIntentCount,
  );
  const releaseReceiptCount = await countRows(
    admin,
    "demo_clear_receipts",
    (query) =>
      query.eq("user_id", state.userId).eq("root_account_id", rootAccountId),
    "clear.release_receipt",
  );
  assertPass(
    "clear.release_receipt_retained",
    releaseReceiptCount === 1,
    releaseReceiptCount,
  );
  const authUsers = await listAuthUsers(admin);
  assertPass(
    "clear.synthetic_auth_users_removed",
    authUsers.filter((user) => userIsSyntheticForRun(user, runId)).length === 0,
  );
  const activeState = await queryRows(
    admin,
    "member_state",
    "active_account_id",
    (query) => query.eq("user_id", state.userId).maybeSingle(),
    "clear.real_member_state",
  );
  const activeAccountId = activeState?.active_account_id ?? null;
  if (activeAccountId != null) {
    const activeMembership = await countRows(
      admin,
      "account_members",
      (query) =>
        query
          .eq("user_id", state.userId)
          .eq("account_id", activeAccountId)
          .eq("status", "active"),
      "clear.real_active_membership",
    );
    assertPass(
      "clear.real_active_pointer_is_live",
      activeMembership === 1,
      activeMembership,
    );
  } else {
    pass("clear.real_active_pointer_is_null");
  }
  const contexts = unwrapRows(
    await rpc(normal, "my_contexts", undefined, "clear.real_contexts"),
  );
  assertPass(
    "clear.real_context_is_valid_or_null",
    contexts.length === 0 || contexts.some((row) => row.is_active === true),
  );
  const objects = await allStorageObjects(admin);
  assertPass(
    "clear.demo_storage_removed",
    objects.every((path) =>
      accountIds.every((accountId) => !path.startsWith(`${accountId}/`)),
    ),
    objects.length,
  );
  pass("clear.official_bundle");
}

const state = {
  admin: null,
  normal: null,
  userId: null,
  runId: null,
  rootAccountId: null,
  // Every root account this disposable user has held. `clear_demo` RETAINS the
  // root, and `prepare_demo_onboarding` then resets a completed intent to
  // account_id = null whenever the caller has no active membership — which is
  // exactly the post-clear state — so each retry lifecycle establishes a NEW
  // root and the previous one survives as an orphan. Disposing only the last
  // one left a real account behind and failed empty.public.accounts.
  rootAccountIds: [],
  companionIds: [],
  syntheticUserIds: [],
  resources: [],
  accountIds: [],
  lastVerifiedClear: null,
  clearSucceeded: false,
  cleanupVerified: false,
  clearAttempted: false,
  shareWorkerUrl: "",
};

async function removePreLifecycleOnboardingState() {
  if (
    !state.normal ||
    !state.userId ||
    state.rootAccountId == null ||
    state.runId != null
  ) {
    return false;
  }

  const rootAccountId = state.rootAccountId;
  try {
    const pendingIntents = await queryRows(
      state.admin,
      "demo_onboarding_intents",
      "id,user_id,account_id,state",
      (query) =>
        query.eq("user_id", state.userId).eq("account_id", rootAccountId),
      "cleanup.prebundle.intent_before_cancel",
    );
    if (
      pendingIntents.length !== 1 ||
      !["pending", "failed"].includes(pendingIntents[0]?.state)
    ) {
      return false;
    }

    // This is the product's authenticated cancellation contract. It deletes
    // the pending/failed intent and releases only a proof-bound demo orphan;
    // it is deliberately not replaced with a client-side intent delete.
    await rpc(
      state.normal,
      "cancel_demo_onboarding",
      undefined,
      "cleanup.cancel_demo_onboarding",
    );

    const accountRows = await queryRows(
      state.admin,
      "accounts",
      "id,kind,demo",
      (query) => query.eq("id", rootAccountId),
      "cleanup.prebundle.account",
    );
    const members = await queryRows(
      state.admin,
      "account_members",
      "id,user_id,role,status",
      (query) => query.eq("account_id", rootAccountId),
      "cleanup.prebundle.membership",
    );
    if (
      accountRows.length !== 1 ||
      accountRows[0]?.kind !== "household" ||
      accountRows[0]?.demo !== false ||
      members.length !== 1 ||
      members[0]?.user_id !== state.userId ||
      members[0]?.role !== "parent_admin" ||
      members[0]?.status !== "active"
    ) {
      return false;
    }

    const liveRunCount = await countRows(
      state.admin,
      "demo_runs",
      (query) =>
        query
          .eq("root_account_id", rootAccountId)
          .in("status", ["seeding", "active", "clearing", "failed"]),
      "cleanup.prebundle.runs",
    );
    if (liveRunCount !== 0) return false;

    const intentCount = await countRows(
      state.admin,
      "demo_onboarding_intents",
      (query) => query.eq("user_id", state.userId),
      "cleanup.prebundle.intent",
    );
    if (intentCount !== 0) return false;

    for (const table of PRE_BUNDLE_ACCOUNT_TABLES) {
      const count = await countRows(
        state.admin,
        table,
        (query) => query.eq("account_id", rootAccountId),
        `cleanup.prebundle.account_rows.${table}`,
      );
      if (count !== 0) return false;
    }

    const endpointFilter = `household_account_id.eq.${rootAccountId},shadchanus_account_id.eq.${rootAccountId}`;
    const [connections, connectionInvites, childGrants] = await Promise.all([
      queryRows(
        state.admin,
        "connections",
        "id",
        (query) => query.or(endpointFilter),
        "cleanup.prebundle.connections",
      ),
      queryRows(
        state.admin,
        "connection_invites",
        "id",
        (query) =>
          query.or(
            `inviter_account_id.eq.${rootAccountId},accepted_by_account_id.eq.${rootAccountId}`,
          ),
        "cleanup.prebundle.connection_invites",
      ),
      queryRows(
        state.admin,
        "child_grants",
        "id",
        (query) =>
          query.or(
            `proposer_account_id.eq.${rootAccountId},grantee_account_id.eq.${rootAccountId}`,
          ),
        "cleanup.prebundle.child_grants",
      ),
    ]);
    if (connections.length || connectionInvites.length || childGrants.length) {
      return false;
    }

    for (const bucket of ["documents", "entity-files", "attachments"]) {
      const objects = await listStorageObjects(
        state.admin,
        bucket,
        String(rootAccountId),
      );
      if (objects.length !== 0) return false;
    }

    // The direct account delete is reachable only after the authenticated
    // cancellation RPC and every ownership/data precondition above pass.
    // This keeps a smoke-only disposable account from surviving a pre-run
    // failure without creating a general-purpose deletion primitive.
    const deleted = await resultData("cleanup.delete_prebundle_account", () =>
      state.admin
        .from("accounts")
        .delete()
        .eq("id", rootAccountId)
        .eq("kind", "household")
        .eq("demo", false)
        .select("id"),
    );
    if (unwrapRows(deleted).length !== 1) return false;
    state.rootAccountId = null;
    return true;
  } catch {
    return false;
  }
}

async function removeDisposableUserGlobalState() {
  if (!state.admin || !state.userId) return false;
  const memberStates = await queryRows(
    state.admin,
    "member_state",
    "user_id,active_account_id",
    (query) => query.eq("user_id", state.userId),
    "cleanup.user.member_state_before_delete",
  );
  const members = await queryRows(
    state.admin,
    "members",
    "id,user_id",
    (query) => query.eq("user_id", state.userId),
    "cleanup.user.member_before_delete",
  );
  if (
    memberStates.length !== 1 ||
    members.length !== 1 ||
    memberStates[0]?.user_id !== state.userId ||
    memberStates[0]?.active_account_id != null ||
    members[0]?.user_id !== state.userId
  ) {
    return false;
  }

  const deletedState = await resultData(
    "cleanup.delete_disposable_member_state",
    () =>
      state.admin
        .from("member_state")
        .delete()
        .eq("user_id", state.userId)
        .select("user_id"),
  );
  const deletedMembers = await resultData(
    "cleanup.delete_disposable_member",
    () =>
      state.admin
        .from("members")
        .delete()
        .eq("user_id", state.userId)
        .select("user_id"),
  );
  if (
    unwrapRows(deletedState).length !== 1 ||
    unwrapRows(deletedMembers).length !== 1
  ) {
    return false;
  }
  const remainingState = await countRows(
    state.admin,
    "member_state",
    (query) => query.eq("user_id", state.userId),
    "cleanup.user.member_state_after_delete",
  );
  const remainingMembers = await countRows(
    state.admin,
    "members",
    (query) => query.eq("user_id", state.userId),
    "cleanup.user.member_after_delete",
  );
  return remainingState === 0 && remainingMembers === 0;
}

async function removeVerifiedClearedBundle() {
  const proof = state.lastVerifiedClear;
  if (!state.admin || !state.userId || !proof) return false;
  if (state.runId != null && Number(state.runId) !== Number(proof.runId)) {
    return false;
  }
  const rootAccountId = proof.rootAccountId;
  const accountRows = await queryRows(
    state.admin,
    "accounts",
    "id,kind,demo",
    (query) => query.eq("id", rootAccountId),
    "cleanup.postclear.account",
  );
  // The product now deletes the root itself when the demo ends, so the normal
  // case is that there is nothing here to clean up. This function's job has
  // narrowed to PROVING that — and to retiring the release receipt, which
  // `clear_demo` deliberately keeps as its response-loss ledger.
  //
  // The retained-root branch below is kept as a backstop for a root the
  // product declined to dispose (it refuses rather than strand an account
  // that still holds something), so this harness still finishes empty and
  // still reports the refusal by leaving evidence behind.
  const rootAlreadyDisposed = accountRows.length === 0;
  if (
    !rootAlreadyDisposed &&
    (accountRows.length !== 1 ||
      accountRows[0]?.kind !== "household" ||
      accountRows[0]?.demo !== false)
  ) {
    return false;
  }
  const rootMembershipRows = await queryRows(
    state.admin,
    "account_members",
    "id,status",
    (query) => query.eq("account_id", rootAccountId),
    "cleanup.postclear.memberships",
  );
  if (rootAlreadyDisposed) {
    if (rootMembershipRows.length !== 0) return false;
  } else if (!rootMembershipRows.every((row) => row.status === "archived")) {
    return false;
  }
  const liveRuns = await countRows(
    state.admin,
    "demo_runs",
    (query) => query.eq("root_account_id", rootAccountId),
    "cleanup.postclear.runs",
  );
  if (liveRuns !== 0) return false;
  for (const table of PRE_BUNDLE_ACCOUNT_TABLES) {
    const count = await countRows(
      state.admin,
      table,
      (query) => query.eq("account_id", rootAccountId),
      `cleanup.postclear.account_rows.${table}`,
    );
    if (count !== 0) return false;
  }
  const endpointFilter = `household_account_id.eq.${rootAccountId},shadchanus_account_id.eq.${rootAccountId}`;
  const [connections, connectionInvites, childGrants] = await Promise.all([
    queryRows(
      state.admin,
      "connections",
      "id",
      (query) => query.or(endpointFilter),
      "cleanup.postclear.connections",
    ),
    queryRows(
      state.admin,
      "connection_invites",
      "id",
      (query) =>
        query.or(
          `inviter_account_id.eq.${rootAccountId},accepted_by_account_id.eq.${rootAccountId}`,
        ),
      "cleanup.postclear.connection_invites",
    ),
    queryRows(
      state.admin,
      "child_grants",
      "id",
      (query) =>
        query.or(
          `proposer_account_id.eq.${rootAccountId},grantee_account_id.eq.${rootAccountId}`,
        ),
      "cleanup.postclear.child_grants",
    ),
  ]);
  if (connections.length || connectionInvites.length || childGrants.length)
    return false;
  for (const bucket of ["documents", "entity-files", "attachments"]) {
    if (
      (await listStorageObjects(state.admin, bucket, String(rootAccountId)))
        .length !== 0
    ) {
      return false;
    }
  }
  const receipts = await queryRows(
    state.admin,
    "demo_clear_receipts",
    "id,user_id,root_account_id",
    (query) =>
      query.eq("user_id", state.userId).eq("root_account_id", rootAccountId),
    "cleanup.postclear.receipt",
  );
  if (
    receipts.length !== 1 ||
    receipts[0]?.user_id !== state.userId ||
    receipts[0]?.root_account_id !== rootAccountId
  ) {
    return false;
  }
  const deletedReceipt = await resultData(
    "cleanup.delete_disposable_clear_receipt",
    () =>
      state.admin
        .from("demo_clear_receipts")
        .delete()
        .eq("id", receipts[0].id)
        .eq("user_id", state.userId)
        .eq("root_account_id", rootAccountId)
        .select("id"),
  );
  if (unwrapRows(deletedReceipt).length !== 1) return false;
  // The archived membership holds a foreign key to the account, so it has to
  // go first or the account delete below silently matches zero rows.
  if (!rootAlreadyDisposed && rootMembershipRows.length > 0) {
    const deletedMemberships = await resultData(
      "cleanup.delete_disposable_root_memberships",
      () =>
        state.admin
          .from("account_members")
          .delete()
          .eq("account_id", rootAccountId)
          .eq("status", "archived")
          .select("id"),
    );
    if (unwrapRows(deletedMemberships).length !== rootMembershipRows.length) {
      return false;
    }
  }
  if (!rootAlreadyDisposed) {
    const deletedAccount = await resultData(
      "cleanup.delete_disposable_root_account",
      () =>
        state.admin
          .from("accounts")
          .delete()
          .eq("id", rootAccountId)
          .eq("kind", "household")
          .eq("demo", false)
          .select("id"),
    );
    if (unwrapRows(deletedAccount).length !== 1) return false;
  }
  state.rootAccountId = null;
  state.lastVerifiedClear = null;
  return true;
}

function recordRootAccount(accountId) {
  if (accountId == null) return;
  if (!state.rootAccountIds.includes(accountId)) {
    state.rootAccountIds.push(accountId);
  }
}

/**
 * BACKSTOP. The product now disposes each root when its demo ends, so this
 * should find nothing; it is kept because a root the product declined to
 * dispose must still not be left behind by this harness.
 *
 * Originally it removed the roots earlier lifecycles left behind. Each is proven disposable
 * on exactly the same terms as the tracked bundle before it is touched: the
 * caller's own non-demo household, no demo run, and no membership that is
 * still live (a deleted Auth user leaves `account_members.user_id` NULL via
 * the column's ON DELETE SET NULL, so a NULL user is expected here too).
 */
async function removeOrphanedRootAccounts() {
  if (!state.admin) return true;
  for (const accountId of state.rootAccountIds) {
    const accounts = await queryRows(
      state.admin,
      "accounts",
      "id,kind,demo",
      (query) => query.eq("id", accountId),
      "cleanup.orphan_root.account",
    );
    if (accounts.length === 0) continue;
    if (accounts[0]?.kind !== "household" || accounts[0]?.demo !== false) {
      return false;
    }
    const runs = await countRows(
      state.admin,
      "demo_runs",
      (query) => query.eq("root_account_id", accountId),
      "cleanup.orphan_root.runs",
    );
    if (runs !== 0) return false;
    const memberships = await queryRows(
      state.admin,
      "account_members",
      "id,status",
      (query) => query.eq("account_id", accountId),
      "cleanup.orphan_root.memberships",
    );
    if (!memberships.every((row) => row.status === "archived")) return false;
    if (memberships.length > 0) {
      const removed = await resultData(
        "cleanup.delete_orphan_root_memberships",
        () =>
          state.admin
            .from("account_members")
            .delete()
            .eq("account_id", accountId)
            .eq("status", "archived")
            .select("id"),
      );
      if (unwrapRows(removed).length !== memberships.length) return false;
    }
    const removedAccount = await resultData(
      "cleanup.delete_orphan_root_account",
      () =>
        state.admin
          .from("accounts")
          .delete()
          .eq("id", accountId)
          .eq("kind", "household")
          .eq("demo", false)
          .select("id"),
    );
    if (unwrapRows(removedAccount).length !== 1) return false;
  }
  return true;
}

async function disposeDisposableUser() {
  if (!state.admin || !state.userId) return false;
  let rootRemoved = false;
  if (state.lastVerifiedClear) {
    rootRemoved = await removeVerifiedClearedBundle();
  } else if (state.rootAccountId == null && state.runId == null) {
    rootRemoved = true;
  } else if (state.runId == null) {
    rootRemoved = await removePreLifecycleOnboardingState();
  }
  if (!rootRemoved) return false;
  if (!(await removeOrphanedRootAccounts())) return false;
  return removeDisposableUserGlobalState();
}

async function cleanupBestEffort() {
  let clearResponseSucceeded = false;
  if (state.normal && state.userId && !state.clearSucceeded) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await state.normal.functions.invoke("clear_demo", {
          method: "POST",
          body: { releaseDemoFlag: true },
        });
        if (!result.error && result.data?.cleared === true) {
          state.clearAttempted = true;
          clearResponseSucceeded = true;
          break;
        }
      } catch {
        // Best effort only. Never print the response or error body.
      }
    }
  }
  if (
    clearResponseSucceeded &&
    !state.lastVerifiedClear &&
    state.runId != null &&
    state.rootAccountId != null &&
    state.accountIds.length > 0 &&
    state.resources.length > 0
  ) {
    try {
      await verifyCleanup({
        admin: state.admin,
        normal: state.normal,
        runId: state.runId,
        rootAccountId: state.rootAccountId,
        accountIds: state.accountIds,
        companionIds: state.companionIds,
        resources: state.resources,
      });
      state.lastVerifiedClear = {
        runId: state.runId,
        rootAccountId: state.rootAccountId,
      };
    } catch {
      // A successful HTTP response is not enough to authorize destructive
      // cleanup; the exact post-clear inventory proof must also pass.
    }
  }
  if (state.userId && (state.lastVerifiedClear || state.runId == null)) {
    try {
      if (await disposeDisposableUser()) {
        await state.admin.auth.admin.deleteUser(state.userId);
      }
    } catch {
      // Best effort only; verify-empty reports an exact-user residue.
    }
  }
}

async function runSmoke() {
  const { url, anonKey, serviceRoleKey, adminReseedSecret, shareWorkerUrl } =
    requireEnvironment();
  if (!shareWorkerUrl) throw new HarnessFailure("env.SHARE_WORKER_URL");
  state.shareWorkerUrl = shareWorkerUrl;
  state.admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Keep this client permanently sessionless. The signed-in smoke user must
  // use a different client, otherwise the public listing probe silently runs
  // as `authenticated` and is allowed to preview the active demo bundle.
  const publicAnon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signInClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomUUID().replaceAll("-", "");
  const email = `hosted-demo-smoke-${suffix}@example.invalid`;
  const password = `Smoke-${randomUUID()}-9!aA`;
  const createdUser = await resultData("flow.create_disposable_user", () =>
    state.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: "Hosted",
        last_name: "Demo Smoke",
      },
    }),
  );
  if (!createdUser?.user?.id)
    throw new HarnessFailure("flow.create_disposable_user");
  state.userId = createdUser.user.id;
  pass("flow.create_disposable_user");

  const signedIn = await resultData("flow.sign_in_normal_user", () =>
    signInClient.auth.signInWithPassword({ email, password }),
  );
  if (!signedIn?.session || signedIn.user?.id !== state.userId) {
    throw new HarnessFailure("flow.sign_in_normal_user");
  }
  state.normal = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await resultData("flow.set_normal_session", () =>
    state.normal.auth.setSession(signedIn.session),
  );
  pass("flow.sign_in_normal_user");

  const intent = await rpc(
    state.normal,
    "prepare_demo_onboarding",
    undefined,
    "flow.prepare_demo_onboarding",
  );
  assertPass(
    "flow.prepare_demo_onboarding_pending",
    intent?.state === "pending" && intent.account_id == null,
  );
  await rpc(
    state.normal,
    "add_persona",
    { p_persona: "parent" },
    "flow.add_persona_parent",
  );
  pass("flow.add_persona_parent");
  const contextsBeforeSeed = unwrapRows(
    await rpc(
      state.normal,
      "my_contexts",
      undefined,
      "flow.root_context_after_persona",
    ),
  );
  const rootContext = contextsBeforeSeed.find(
    (row) => row.is_active === true && row.kind === "household",
  );
  if (!rootContext?.account_id)
    throw new HarnessFailure("flow.root_context_after_persona");
  state.rootAccountId = rootContext.account_id;
  recordRootAccount(state.rootAccountId);
  pass("flow.root_context_after_persona");

  const seed = await invoke(
    state.normal,
    "seed_demo",
    { method: "POST" },
    "flow.seed_demo",
  );
  assertPass("flow.seed_demo_succeeded", seed?.seeded === true);
  assertPass(
    "flow.seed_demo_bundle_shape",
    seed?.bundle?.contexts === 3 &&
      seed?.bundle?.trustedSenders === 2 &&
      seed?.bundle?.syntheticActors === 3,
  );
  state.runId = Number(seed.bundle.runId);
  if (!Number.isSafeInteger(state.runId))
    throw new HarnessFailure("flow.seed_demo_run_id");
  pass("flow.seed_demo_run_id");
  const seeded = await verifySeed({
    admin: state.admin,
    anon: publicAnon,
    normal: state.normal,
    runId: state.runId,
    rootAccountId: state.rootAccountId,
  });
  state.accountIds = seeded.accountIds;
  state.companionIds = seeded.companionIds;
  const accountIdByContext = Object.fromEntries(
    seeded.runAccounts.map((row) => [row.context_key, row.account_id]),
  );
  await verifyContextSurfaces({
    normal: state.normal,
    accountIds: accountIdByContext,
    rootAccountId: state.rootAccountId,
  });

  await invokeAdminReseed({ url, secret: adminReseedSecret });
  const reseededRun = await queryRows(
    state.admin,
    "demo_runs",
    "id",
    (query) =>
      query
        .eq("root_account_id", state.rootAccountId)
        .eq("status", "active")
        .order("id", { ascending: false })
        .limit(1),
    "flow.admin_reseed_active_run",
  );
  const reseededRunId = Number(reseededRun[0]?.id);
  if (!Number.isSafeInteger(reseededRunId))
    throw new HarnessFailure("flow.admin_reseed_active_run");
  state.runId = reseededRunId;
  const reseeded = await verifySeed({
    admin: state.admin,
    anon: publicAnon,
    normal: state.normal,
    runId: state.runId,
    rootAccountId: state.rootAccountId,
  });
  state.accountIds = reseeded.accountIds;
  state.companionIds = reseeded.companionIds;
  await verifyContextSurfaces({
    normal: state.normal,
    accountIds: Object.fromEntries(
      reseeded.runAccounts.map((row) => [row.context_key, row.account_id]),
    ),
    rootAccountId: state.rootAccountId,
  });

  const contexts = unwrapRows(
    await rpc(
      state.normal,
      "my_contexts",
      undefined,
      "flow.contexts_before_clear",
    ),
  );
  const companion = contexts.find(
    (row) => row.account_id !== state.rootAccountId && row.is_demo === true,
  );
  if (!companion?.account_id)
    throw new HarnessFailure("flow.companion_context_available");
  await rpc(
    state.normal,
    "set_active_context",
    { p_account_id: companion.account_id },
    "flow.switch_companion_context",
  );
  pass("flow.switch_companion_context");
  const clear = await invoke(
    state.normal,
    "clear_demo",
    { method: "POST", body: { releaseDemoFlag: true } },
    "flow.clear_demo_from_companion",
  );
  assertPass(
    "flow.clear_demo_from_companion_succeeded",
    clear?.cleared === true,
  );
  state.clearAttempted = true;
  pass("flow.clear_demo_from_companion");
  await verifyCleanup({
    admin: state.admin,
    normal: state.normal,
    runId: state.runId,
    rootAccountId: state.rootAccountId,
    accountIds: reseeded.accountIds,
    companionIds: reseeded.companionIds,
    resources: reseeded.resources,
  });
  state.lastVerifiedClear = {
    runId: state.runId,
    rootAccountId: state.rootAccountId,
  };
  state.clearSucceeded = true;
  state.cleanupVerified = true;

  // Retry the same onboarding lifecycle after a completed clear, then clear
  // it again. This proves the retained root and release receipt are reusable.
  state.clearSucceeded = false;
  state.cleanupVerified = false;
  state.lastVerifiedClear = null;
  await rpc(
    state.normal,
    "prepare_demo_onboarding",
    undefined,
    "flow.retry_prepare_demo_onboarding",
  );
  await rpc(
    state.normal,
    "add_persona",
    { p_persona: "parent" },
    "flow.retry_add_persona_parent",
  );
  const retryContexts = unwrapRows(
    await rpc(
      state.normal,
      "my_contexts",
      undefined,
      "flow.retry_root_context",
    ),
  );
  const retryRoot = retryContexts.find(
    (row) => row.is_active === true && row.kind === "household",
  );
  if (!retryRoot?.account_id)
    throw new HarnessFailure("flow.retry_root_context");
  state.rootAccountId = retryRoot.account_id;
  recordRootAccount(state.rootAccountId);
  const retrySeed = await invoke(
    state.normal,
    "seed_demo",
    { method: "POST" },
    "flow.retry_seed_demo",
  );
  assertPass("flow.retry_seed_demo_succeeded", retrySeed?.seeded === true);
  state.runId = Number(retrySeed.bundle.runId);
  const retrySeeded = await verifySeed({
    admin: state.admin,
    anon: publicAnon,
    normal: state.normal,
    runId: state.runId,
    rootAccountId: state.rootAccountId,
  });
  state.accountIds = retrySeeded.accountIds;
  state.companionIds = retrySeeded.companionIds;
  const retryContextsByKey = Object.fromEntries(
    retrySeeded.runAccounts.map((row) => [row.context_key, row.account_id]),
  );
  await verifyContextSurfaces({
    normal: state.normal,
    accountIds: retryContextsByKey,
    rootAccountId: state.rootAccountId,
  });
  const retryClear = await invoke(
    state.normal,
    "clear_demo",
    { method: "POST", body: { releaseDemoFlag: true } },
    "flow.retry_clear_demo",
  );
  assertPass("flow.retry_clear_demo_succeeded", retryClear?.cleared === true);
  state.clearAttempted = true;
  await verifyCleanup({
    admin: state.admin,
    normal: state.normal,
    runId: state.runId,
    rootAccountId: state.rootAccountId,
    accountIds: retrySeeded.accountIds,
    companionIds: retrySeeded.companionIds,
    resources: retrySeeded.resources,
  });
  state.lastVerifiedClear = {
    runId: state.runId,
    rootAccountId: state.rootAccountId,
  };
  state.clearSucceeded = true;
  state.cleanupVerified = true;
  if (!(await disposeDisposableUser())) {
    throw new HarnessFailure("cleanup.dispose_disposable_user_proof");
  }
  await resultData("cleanup.delete_disposable_user", () =>
    state.admin.auth.admin.deleteUser(state.userId),
  );
  state.userId = null;
  pass("cleanup.delete_disposable_user");
  await verifyEmpty(state.admin);
  pass("cleanup.automatic_empty_verification");
}

async function main() {
  const { url, serviceRoleKey } = requireEnvironment();
  state.admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (process.argv.includes("--verify-empty")) {
    await verifyEmpty(state.admin);
    pass("verify_empty.complete");
    return;
  }
  await runSmoke();
  pass("hosted_demo_smoke.complete");
}

try {
  await main();
} catch (error) {
  const label =
    error instanceof HarnessFailure ? error.label : "unlabelled_failure";
  console.error(`FAIL ${label}`);
  try {
    await cleanupBestEffort();
    console.error("CLEANUP attempted");
  } catch {
    console.error("CLEANUP attempted");
  }
  process.exitCode = 1;
}
