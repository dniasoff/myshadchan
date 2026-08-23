import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const functions = readFileSync(
  path.join(testDirectory, "../schemas/02_functions.sql"),
  "utf8",
);
const tables = readFileSync(
  path.join(testDirectory, "../schemas/01_tables.sql"),
  "utf8",
);
const grants = readFileSync(
  path.join(testDirectory, "../schemas/06_grants.sql"),
  "utf8",
);
const policies = readFileSync(
  path.join(testDirectory, "../schemas/05_policies.sql"),
  "utf8",
);
const databaseSuite = readFileSync(
  path.join(testDirectory, "official_demo_bundle.sql"),
  "utf8",
);
const seedSource = readFileSync(
  path.join(testDirectory, "../functions/seed_demo/index.ts"),
  "utf8",
);
const clearSource = readFileSync(
  path.join(testDirectory, "../functions/clear_demo/index.ts"),
  "utf8",
);
const r16Migration = readFileSync(
  path.join(
    testDirectory,
    "../migrations/20260823173000_official_demo_r16_lifecycle_fences.sql",
  ),
  "utf8",
);

type SqlFunctionDefinition = {
  name: string;
  signature: string;
  source: string;
  body: string;
};

function findMatchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  return -1;
}

function splitSqlArguments(argumentsSource: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index];
    if (quote) {
      if (character === quote && argumentsSource[index - 1] !== "\\")
        quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      result.push(argumentsSource.slice(start, index));
      start = index + 1;
    }
  }
  if (argumentsSource.trim()) result.push(argumentsSource.slice(start));
  return result;
}

function normalizeSqlSignature(name: string, argumentsSource: string): string {
  const argumentTypes = splitSqlArguments(argumentsSource).map((argument) => {
    const withoutDefault = argument.split(/\s+default\s+/i, 1)[0].trim();
    return withoutDefault
      .replace(/^(?:in|out|inout|variadic)\s+/i, "")
      .replace(/^"?[^"\s]+"?\s+/i, "")
      .replace(/"/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  });
  return `${name.toLowerCase()}(${argumentTypes.join(",")})`;
}

function parseFunctionDefinitions(source: string): SqlFunctionDefinition[] {
  const definitions: SqlFunctionDefinition[] = [];
  const declaration = /create\s+or\s+replace\s+function/gi;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source))) {
    const nameStart = match.index + match[0].length;
    const header = source
      .slice(nameStart)
      .match(
        /^\s*(?:(?:"[^"]+"|[a-z_][\w$]*)\s*\.\s*)?(?:"[^"]+"|[a-z_][\w$]*)\s*\(/i,
      );
    if (!header) continue;
    const headerText = header[0];
    const name = headerText
      .replace(/\s*\($/, "")
      .split(".")
      .at(-1)!
      .replace(/"/g, "")
      .trim();
    const open = nameStart + headerText.lastIndexOf("(");
    const close = findMatchingParen(source, open);
    if (close < 0) continue;
    const afterHeader = source.slice(close + 1);
    const bodyDelimiter = afterHeader.match(/\bas\s+(\$[a-z_][\w$]*\$|\$\$)/i);
    if (!bodyDelimiter || bodyDelimiter.index == null) continue;
    const delimiter = bodyDelimiter[1];
    const bodyStart = close + 1 + bodyDelimiter.index + bodyDelimiter[0].length;
    const bodyEnd = source.indexOf(delimiter, bodyStart);
    if (bodyEnd < 0) continue;
    const statementEnd = source.indexOf(";", bodyEnd + delimiter.length);
    const end =
      statementEnd < 0 ? bodyEnd + delimiter.length : statementEnd + 1;
    definitions.push({
      name,
      signature: normalizeSqlSignature(name, source.slice(open + 1, close)),
      source: source.slice(match.index, end),
      body: source.slice(bodyStart, bodyEnd),
    });
  }
  return definitions;
}

const functionDefinitions = parseFunctionDefinitions(functions);

function functionBody(name: string): string {
  return (
    functionDefinitions
      .filter(
        (definition) => definition.name.toLowerCase() === name.toLowerCase(),
      )
      .at(-1)?.source ?? ""
  );
}

describe("official demo lifecycle SQL source", () => {
  it("parses effective function bodies across SQL formatting", () => {
    expect(functionDefinitions.length).toBeGreaterThan(0);
    for (const name of [
      "enforce_demo_write_barrier",
      "begin_demo_seed",
      "claim_demo_clear",
      "register_demo_resource",
      "regrant_child_grant",
    ]) {
      const matches = functionDefinitions.filter(
        (definition) => definition.name.toLowerCase() === name,
      );
      expect(matches, `${name} definition count`).toHaveLength(1);
      expect(matches[0]?.body.length, `${name} body`).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate function signatures in the declarative schema", () => {
    const bySignature = new Map<string, SqlFunctionDefinition[]>();
    for (const definition of functionDefinitions) {
      const entries = bySignature.get(definition.signature) ?? [];
      entries.push(definition);
      bySignature.set(definition.signature, entries);
    }
    const duplicates = [...bySignature.entries()]
      .filter(([, definitions]) => definitions.length > 1)
      .map(([signature]) => signature);
    expect(duplicates).toEqual([]);
  });

  it("keeps the lifecycle manifest physically ordered and uniquely account-owned", () => {
    const demoRuns =
      tables.match(/create table public\.demo_runs \(([\s\S]*?)\n\);/i)?.[1] ??
      "";
    expect(demoRuns.indexOf("lease_epoch bigint")).toBeGreaterThanOrEqual(0);
    expect(demoRuns.indexOf("lease_expires_at timestamp")).toBeGreaterThan(
      demoRuns.indexOf("lease_epoch bigint"),
    );
    expect(demoRuns.indexOf("lease_token text")).toBeGreaterThan(
      demoRuns.indexOf("lease_expires_at timestamp"),
    );
    expect(demoRuns.indexOf("operation text")).toBeGreaterThan(
      demoRuns.indexOf("lease_token text"),
    );
    expect(demoRuns.indexOf("original_root_name text")).toBeGreaterThan(
      demoRuns.indexOf("operation text"),
    );

    expect(tables).toContain(
      "constraint demo_run_accounts_account_key unique (account_id)",
    );
    for (const resourceType of [
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
    ]) {
      expect(tables).toContain(`'${resourceType}'`);
    }
  });

  it("locks and fail-closes the same household empty-account inventory as Edge preflight", () => {
    const assertion = functionBody("demo_assert_empty_account");
    const begin = functionBody("begin_demo_seed");

    expect(assertion).toContain("kind = 'household'");
    for (const table of [
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
      "listings",
      "invites",
      "analytics_events",
      "share_links",
      "connections",
      "connection_invites",
      "child_grants",
      "storage.objects",
    ]) {
      expect(assertion).toContain(table);
    }
    expect(begin).toContain("demo_lock_account_axes");
    expect(begin.indexOf("demo_lock_account_axes")).toBeLessThan(
      begin.indexOf("demo_assert_empty_account"),
    );
    expect(begin).toContain("perform public.demo_assert_empty_account");
  });

  it("closes storage and inbound-ingest lifecycle races in source and migration", () => {
    for (const source of [functions, r16Migration]) {
      expect(source).toContain("demo_storage_write_fence");
      expect(source).toContain("for key share");
      expect(source).toContain("wait_for_demo_ingest_claims");
      expect(source).toContain("wait_for_demo_ingest_account_claims");
      expect(source).toContain("demo_run_ingest_claims");
      expect(source).toContain("state in ('released', 'expired')");
      expect(source).toContain("stale ordinary ingest claim blocks demo seed");
      expect(source).toContain("stale demo ingest claim blocks clear");
      expect(source).toContain("delete from public.demo_run_ingest_claims");
      expect(source).toContain("claim_token_hash");
      expect(source).toContain(
        "status in ('seeding', 'active', 'clearing', 'failed')",
      );
    }
    expect(grants).toContain(
      "grant execute on function public.claim_demo_ingest(bigint, text, integer) to service_role",
    );
    expect(grants).toContain(
      "grant execute on function public.wait_for_demo_ingest_claims(bigint, text, integer) to service_role",
    );
    expect(seedSource).toContain('"interactions"');
    expect(seedSource).toContain('"identity_signals"');
    expect(clearSource).toContain("wait_for_demo_ingest_claims");
    expect(functionBody("begin_demo_seed")).toContain(
      "wait_for_demo_ingest_account_claims",
    );
    expect(policies).toContain(
      "alter table public.demo_run_ingest_claims enable row level security",
    );
    expect(policies).toContain(
      "alter table public.demo_run_ingest_claims force row level security",
    );
    expect(r16Migration).toContain(
      "alter table public.demo_run_ingest_claims enable row level security",
    );
    expect(r16Migration).toContain(
      "alter table public.demo_run_ingest_claims force row level security",
    );
  });

  it("fences storage registration and restores member state idempotently", () => {
    const storage = functionBody("register_demo_storage");
    const restore = functionBody("restore_demo_member_state");

    expect(storage).toContain("for update");
    expect(storage).toContain(
      "v_run.lease_token is distinct from p_lease_token",
    );
    expect(storage).toContain(
      "p_bucket not in ('documents', 'entity-files', 'attachments')",
    );
    expect(storage).toContain(
      "p_resource_key not in ('resume', 'photo', 'entity-file', 'inbox-attachment')",
    );
    expect(storage).toContain(
      "p_storage_path not like p_account_id::text || '/%'",
    );
    expect(storage).toContain(
      "where run_id = p_run_id and account_id = p_account_id",
    );
    expect(storage).toContain("on conflict (bucket, storage_path) do nothing");

    expect(restore).toContain("for update");
    expect(restore).toContain("v_run.operation is distinct from p_operation");
    expect(restore).toContain("on conflict (user_id) do update");
    expect(grants).toContain(
      "grant execute on function public.register_demo_storage(bigint, text, bigint, text, text, text) to service_role",
    );
    expect(grants).toContain(
      "grant execute on function public.restore_demo_member_state(bigint, text, text) to service_role",
    );
  });

  it("uses one deterministic account-axis lock protocol for writers and lifecycle claims", () => {
    expect(functions).toContain("demo_lock_account_axes");
    expect(functions).toContain("p_lock_mode not in ('key share', 'update')");
    expect(functions).toContain("order by account_id");
    expect(functions).toContain(
      "demo_lock_account_axes(v_accounts, 'key share')",
    );
    expect(functions).toContain(
      "demo_lock_account_axes(array[p_root_account_id], 'update')",
    );
    expect(functions).toContain(
      "select array_agg(account_id order by account_id)",
    );
    expect(functions).toContain("for share of dr");
  });

  it("fences resource registration and validates discussions on cleanup", () => {
    expect(functions).toContain("assert_demo_resource_ownership");
    expect(functions).toContain(
      "demo thread % must have exactly one ownership axis",
    );
    expect(functions).toContain(
      "demo message % crosses its parent thread axis",
    );
    expect(functions).toContain(
      "perform public.assert_demo_resource_ownership(",
    );
    expect(databaseSuite).toContain(
      "foreign resource registration fails closed",
    );
    expect(databaseSuite).toContain(
      "active regrant clear leaves zero manifest grants",
    );
  });

  it("treats nullable relationship endpoints as status-aware ownership axes", () => {
    const ownership = functionBody("assert_demo_resource_ownership");
    const barrier = functionBody("enforce_demo_write_barrier");

    for (const source of [ownership, barrier]) {
      expect(source).toContain("inviter_account_id");
      expect(source).toContain("proposer_account_id");
      expect(source).toContain("target_single_id");
      expect(source).toContain("status' = 'accepted'");
      expect(source).toContain("has no accepting endpoint");
      expect(source).toContain("has no grantee endpoint");
      expect(source).toContain("accepted_by_account_id");
      expect(source).toContain("grantee_account_id");
    }
    expect(barrier).toContain("array_remove(v_accounts, null)");
    for (const source of [seedSource, databaseSuite]) {
      expect(source).toContain("pending");
      expect(source).toContain("accepted");
      expect(source).toContain("revoked");
    }
    expect(databaseSuite).toContain(
      "foreign relationship invite registration fails closed",
    );
    expect(databaseSuite).toContain(
      "foreign child grant registration fails closed",
    );
  });

  it("requires both connection endpoints in one run for simulation", () => {
    const body = functionBody("demo_scope_is_simulated");

    expect(body).toContain("c.household_account_id");
    expect(body).toContain("c.shadchanus_account_id");
    expect(body).toContain("dra.run_id = dr.id");
  });

  it("projects only active same-run preview accounts to authenticated callers", () => {
    const body = functionBody("current_demo_preview_accounts");

    expect(body).toContain('RETURNS TABLE("account_id" bigint)');
    expect(body).toContain("public.current_context_id()");
    expect(body).toContain("dr.status = 'active'");
    expect(body).toContain("select distinct dra.account_id");
    expect(body).not.toContain("root_account_id");
    expect(body).not.toContain("context_key");
    expect(body).not.toContain("user_id");
    expect(body).not.toContain("credential");
    expect(grants).toContain(
      "revoke all on function public.current_demo_preview_accounts() from public, anon",
    );
    expect(grants).toContain(
      "grant execute on function public.current_demo_preview_accounts() to authenticated, service_role",
    );
    expect(grants).toContain(
      "grant execute on function public.demo_account_is_previewable(bigint) to authenticated, service_role",
    );
    expect(grants).toContain(
      "grant execute on function public.demo_account_in_active_run(bigint) to anon, authenticated, service_role",
    );
  });

  it("makes delivery history active-only and exact-axis scoped", () => {
    const body = functionBody("demo_delivery_history");

    expect(body).toContain("dr.status = 'active'");
    expect(body).toContain("mn.account_id");
    expect(body).toContain("mn.connection_id");
    expect(body).toContain("c.household_account_id");
    expect(body).toContain("c.shadchanus_account_id");
    expect(body).not.toContain("public.demo_run_for_account()");
    expect(body.match(/simulated is true/g)?.length).toBe(3);
  });

  it("keeps cleanup fail-closed for exact manifest kinds, actors, storage, and every resource type", () => {
    for (const source of [seedSource, clearSource]) {
      expect(source).toContain("context_key, context_kind, is_root");
      expect(source).toContain("actualAccounts");
      expect(source).toContain("expectedKinds");
      expect(source).toContain("demo_actor_key");
      expect(source).toContain("metadata.demo === true");
      expect(source).toContain("metadata.demo_run_id === runId");
      expect(source).toContain("account_members");
      expect(source).toContain('select("account_id, user_id")');
      expect(source).toContain("resource_key");
      expect(source).toContain("startsWith(`${accountId}/`)");
      for (const resourceType of [
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
      ]) {
        expect(source).toContain(`"${resourceType}"`);
      }
      expect(source).toContain("restore_demo_member_state");
      const destructiveMarker =
        source === seedSource
          ? "delete_demo_companion_contexts"
          : "finalize_demo_clear";
      expect(source.indexOf("restore_demo_member_state")).toBeLessThan(
        source.indexOf(destructiveMarker),
      );
    }
  });

  it("registers returned receipt IDs instead of inferring them", () => {
    expect(seedSource).toContain('"share_access_log"');
    expect(seedSource).toContain('"inbox_item"');
    expect(seedSource).toContain('"analytics_event"');
    expect(seedSource).toContain('"message_notification"');
    expect(seedSource).toContain('"task_notification"');
    expect(seedSource).toContain('.select("id")');
    expect(seedSource).toContain("analyticsRows.length !== 3");
    expect(seedSource).toContain('"trusted_senders"');
    expect(seedSource).toContain("mrs.feldman@demo.invalid");
    expect(seedSource).toContain("goldenmatches@demo.invalid");
    expect(seedSource).toContain("trustedSenderRows.length !== 2");
    expect(seedSource).toContain("trustedSenders.length !== 2");
    expect(seedSource).toContain("createdResourceIds.trustedSenders");
    expect(seedSource).toMatch(
      /const accountScopedTables = \[[\s\S]*"trusted_senders"/,
    );
    expect(clearSource).toMatch(
      /const deleteByAccount = \[[\s\S]*"trusted_senders"/,
    );
    expect(clearSource).toContain('"trusted_senders"');
  });

  it("keeps private single cleanup before parent singles in both compensators", () => {
    const seedAccountTables = seedSource.slice(
      seedSource.indexOf("const accountScopedTables"),
      seedSource.indexOf("const resourceTable"),
    );
    const clearAccountTables = clearSource.slice(
      clearSource.indexOf("const deleteByAccount"),
      clearSource.indexOf("for (const table of deleteByAccount)"),
    );
    for (const source of [seedAccountTables, clearAccountTables]) {
      expect(source.indexOf('"single_preferences"')).toBeGreaterThanOrEqual(0);
      expect(source.indexOf('"single_notes"')).toBeGreaterThanOrEqual(0);
      expect(source.indexOf('"singles"')).toBeGreaterThanOrEqual(0);
      expect(source.indexOf('"single_preferences"')).toBeLessThan(
        source.indexOf('"singles"'),
      );
      expect(source.indexOf('"single_notes"')).toBeLessThan(
        source.indexOf('"singles"'),
      );
    }
    expect(seedSource).toContain("p_require_present: false");
    expect(seedSource).toContain("assert_demo_resource_ownership");
    expect(clearSource).toContain("partialRun");
  });

  it("fences acceptance/export at the demo boundary and registers seeding actors", () => {
    const boundary = functionBody("demo_assert_same_active_run");
    const demoInviteAcceptance = functionBody("accept_demo_invite");
    const ordinaryInviteAcceptance = functionBody("accept_invite");

    expect(boundary).toContain("status = 'active'");
    expect(boundary).toContain("status = 'seeding'");
    expect(boundary).toContain("public.demo_run_users");
    expect(functions).toContain("public.demo_assert_same_active_run");
    expect(functions).toContain('"demo_assert_registered_actor"');
    expect(functions).toContain("'membership invite acceptance'");
    expect(functions).toContain("'connection invite acceptance'");
    expect(functions).toContain("'child grant acceptance'");
    expect(functions).toContain("'account export'");
    expect(demoInviteAcceptance).toContain("demo_seed_service_authorized");
    expect(demoInviteAcceptance).toContain("demo_run_accounts");
    expect(demoInviteAcceptance).toContain("demo_run_users");
    expect(demoInviteAcceptance).toContain(
      "demo invite acceptance requires the exact seed service lease",
    );
    expect(demoInviteAcceptance).toContain(
      "and user_id = p_actor_user_id\n      and status = 'active'",
    );
    expect(demoInviteAcceptance).toContain(
      "if v_invite.expires_at <= clock_timestamp()",
    );
    expect(demoInviteAcceptance).toContain(
      "and status = 'pending'\n    and expires_at > clock_timestamp()",
    );
    expect(ordinaryInviteAcceptance).toContain(
      "if v_invite.expires_at <= now()",
    );
    expect(ordinaryInviteAcceptance).not.toContain("clock_timestamp()");
    expect(seedSource).toContain('"accept_demo_invite"');
    expect(seedSource).not.toContain('"accept_invite"');
    expect(grants).toContain(
      "revoke all on function public.accept_demo_invite(bigint, text, uuid, uuid)",
    );
    expect(grants).toContain(
      "revoke all on function public.demo_assert_same_active_run(bigint[], text)",
    );
    expect(grants).toContain(
      "revoke all on function public.demo_assert_registered_actor(bigint, uuid, text)",
    );
  });

  it("atomically registers seeded relationship rows inside their domain RPC", () => {
    const registration = functionBody("demo_register_seed_resource");

    expect(registration).toContain("dr.status = 'seeding'");
    expect(registration).toContain("dru.user_id = auth.uid()");
    expect(registration).toContain(
      "on conflict (run_id, resource_type, resource_id) do nothing",
    );
    for (const name of [
      "create_invite",
      "create_connection_invite",
      "accept_connection_invite",
      "create_child_grant",
    ]) {
      expect(functionBody(name)).toContain("demo_register_seed_resource");
    }
    expect(grants).toContain(
      "revoke all on function public.demo_register_seed_resource(text, bigint, bigint)",
    );
  });

  it("requires an unexpired clear lease at finalization", () => {
    const body = functionBody("finalize_demo_clear");

    expect(body).toContain("v_run.lease_expires_at is null");
    expect(body).toContain("v_run.lease_expires_at <= now()");
    expect(body).toContain(
      "(p_release_persona or p_release_demo) and p_actor_user_id is not null",
    );
  });

  it("keeps retry tables private while preserving the caller-scoped onboarding RPC boundary", () => {
    for (const table of ["demo_run_auth_cleanup", "demo_onboarding_intents"]) {
      expect(policies).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(policies).toContain(
        `alter table public.${table} force row level security`,
      );
      expect(grants).toContain(
        `revoke all on table public.${table} from anon, authenticated`,
      );
      expect(grants).toContain(
        `grant all on table public.${table} to service_role`,
      );
    }
    expect(grants).toContain(
      "grant execute on function public.prepare_demo_onboarding() to authenticated, service_role",
    );
    expect(grants).toContain(
      "grant execute on function public.cancel_demo_onboarding() to authenticated, service_role",
    );
    expect(grants).toContain(
      "revoke all on function public.link_demo_onboarding_intent(uuid, bigint, boolean) from public, anon, authenticated",
    );
    expect(grants).toContain(
      "grant execute on function public.link_demo_onboarding_intent(uuid, bigint, boolean) to service_role",
    );
    expect(functionBody("prepare_demo_onboarding")).toContain("auth.uid()");
    expect(functionBody("cancel_demo_onboarding")).toContain("auth.uid()");
    expect(functions).toContain("p_allow_new_account");
    expect(functions).toContain("v_created_household");
  });

  it("uses caller-generated leases and exact post-response reconciliation", () => {
    expect(
      functionDefinitions.some(
        (definition) => definition.signature === "begin_demo_seed(bigint,text)",
      ),
    ).toBe(true);
    expect(
      functionDefinitions.some(
        (definition) =>
          definition.signature === "claim_demo_clear(bigint,text)",
      ),
    ).toBe(true);
    expect(seedSource).toContain("beginDemoSeedWithReconciliation");
    expect(seedSource).toContain("p_lease_token: leaseToken");
    expect(seedSource).toContain("activateDemoRunWithReconciliation");
    expect(seedSource).toContain('status", "seeding"');
    expect(clearSource).toContain("claimDemoClearWithReconciliation");
    expect(clearSource).toContain("p_lease_token: leaseToken");
    expect(clearSource).toContain('status", "clearing"');
    expect(clearSource).toContain("remainingRun");
    expect(grants).toContain(
      "revoke all on function public.begin_demo_seed(bigint, text)",
    );
    expect(grants).toContain(
      "revoke all on function public.claim_demo_clear(bigint, text)",
    );
  });

  it("exercises mixed endpoints, registered seeding actors, and non-active history", () => {
    expect(databaseSuite).toContain(
      "mixed production/demo connection is simulated locally",
    );
    expect(databaseSuite).toContain(
      "registered synthetic actor may mutate while seeding",
    );
    expect(databaseSuite).toContain(
      "unregistered customer cannot mutate while seeding",
    );
    expect(databaseSuite).toContain("failed run has no delivery history");
    expect(databaseSuite).toContain("seeding run has no delivery history");
    expect(databaseSuite).toContain("clearing run has no delivery history");
    expect(databaseSuite).toContain("authenticated demo preview projection");
    expect(databaseSuite).toContain(
      "authenticated ordinary owner listing access",
    );
    expect(databaseSuite).toContain("anon excludes active demo listing");
  });

  it("keeps the phase-sensitive storage baseline exact before activation", () => {
    expect(functions).toContain("<> 29");
    expect(functions).toContain("<> 50");
    expect(functions).toContain("bucket = 'documents') <> 47");
    expect(functions).toContain("bucket = 'documents') < 47");
  });
});
