import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const functions = read("schemas/02_functions.sql");
const triggers = read("schemas/04_triggers.sql");
const storage = read("schemas/07_storage.sql");
const grants = read("schemas/06_grants.sql");
const seed = read("functions/seed_demo/index.ts");
const clear = read("functions/clear_demo/index.ts");
const ingest = read("../workers/ingest/index.ts");
const ingestResolver = read("../workers/ingest/resolveAccount.ts");
const r16Migration = read(
  "migrations/20260823173000_official_demo_r16_lifecycle_fences.sql",
);
const onboarding = read(
  "../src/components/atomic-crm/login/OnboardingChoice.tsx",
);
const migration = read(
  "migrations/20260823170000_official_demo_audit_repairs.sql",
);
const r17Migration = read(
  "migrations/20260823177000_official_demo_r17_convergence_repairs.sql",
);

describe("official demo final repair source", () => {
  it("uses a service-role lease marker for seed writes and preserves the customer barrier", () => {
    expect(seed).toContain("seedServiceClient");
    expect(seed).toContain('"x-demo-run-id"');
    expect(seed).toContain('"x-demo-lease-token"');
    expect(seed).not.toContain("const db = userScopedClient(req)");
    expect(functions).toContain("demo_seed_service_authorized");
    expect(functions).toContain("auth.role()");
    expect(functions).toContain("dr.lease_token = v_lease_token");
    expect(functions).toContain(
      "demo_seed_service_authorized(mapped.account_id)",
    );
    expect(functions).toContain("demo_seed_request_marked");
    expect(functions).toContain("enforce_demo_member_state_write");
    expect(triggers).toContain("z_enforce_demo_member_state_write");
    expect(seed).toContain("await db.storage");
  });

  it("reconciles onboarding safely and never clears an unproven active run", () => {
    expect(seed).toContain("activateDemoRunWithReconciliation");
    expect(seed).toContain('run.status === "active"');
    expect(onboarding).toContain("cleanupIsProvenOwned");
    expect(onboarding).toContain('onboardingState?.state === "completed"');
    expect(onboarding).toContain(
      "did not complete. Your data was left untouched",
    );
    expect(functions).toContain("release_demo_orphan_for_onboarding");
    expect(functions).toContain("demo_assert_empty_account(v_account_id)");
  });

  it("uses the clear lease for operation-aware actor reconciliation", () => {
    expect(clear).toContain(
      "validateDemoActorsBeforeCleanup(runId, leaseToken, accountIds)",
    );
    expect(clear).toContain('p_operation: "clear"');
    expect(clear).toContain("confirm_demo_actor_absent");
    expect(clear).toContain("ambiguous synthetic actor Auth reconciliation");
    expect(functions).toMatch(/"p_operation" text DEFAULT 'seed'::text/);
    expect(functions).toContain("confirmed_absent");
    expect(clear).toContain('row.outcome === "claimed"');
    expect(clear).toContain("row.lease_token === leaseToken");
  });

  it("cleans discussions and storage by exact account prefixes", () => {
    expect(clear).toContain('"thread_participants"');
    expect(clear).toContain('"messages"');
    expect(clear).toContain("listStoragePrefixPaths");
    expect(clear).toContain("limit: 100, offset");
    expect(clear).toContain("pre-final storage sweep");
    expect(clear).toContain("left discussion rows");
    expect(clear).toContain('from("thread_participants")');
    expect(clear).toContain('in("connection_id", ownedConnectionIds)');
    expect(storage).toContain("demo_storage_write_allowed");
    expect(functions).toContain("demo_storage_write_fence");
    expect(functions).toContain("for key share");
  });

  it("keeps inbound ingest claims durable, service-only, and fenced by clear", () => {
    expect(ingestResolver).toContain('"claim_demo_ingest"');
    expect(ingestResolver).toContain('"heartbeat_demo_ingest_claim"');
    expect(ingestResolver).toContain('"release_demo_ingest_claim"');
    expect(ingest).toContain("claimDemoIngest");
    expect(ingest).toContain("heartbeatDemoIngest");
    expect(ingest).toContain("releaseDemoIngest");
    expect(ingest).toContain("finally");
    expect(clear).toContain('"wait_for_demo_ingest_claims"');
    expect(r16Migration).toContain("demo_run_ingest_claims");
    expect(r16Migration).toContain(
      "revoke all on table public.demo_run_ingest_claims from anon, authenticated",
    );
  });

  it("fences persona lifecycle and asserts the complete official inventory", () => {
    expect(triggers).toContain("z_block_demo_persona_mutation");
    expect(functions).toContain("block_demo_persona_mutation");
    expect(functions).toContain("assert_official_demo_inventory");
    // One context, because the demo is one family. The gate must also assert
    // the cross-account resource types are ABSENT, not merely uncounted — a
    // reintroduced companion has to fail activation loudly rather than seed a
    // demo nobody designed.
    expect(functions).toContain("primary-household");
    expect(functions).not.toContain("feldman-shadchanus");
    expect(functions).not.toContain("gross-household");
    for (const goneType of [
      "connection_invite",
      "child_grant",
      "message_notification",
    ]) {
      expect(functions).toContain(`resource_type = '${goneType}')`);
    }
    expect(seed).toContain("activateDemoRunWithReconciliation");
    expect(functions).toContain(
      "assert_official_demo_inventory(p_run_id, false)",
    );
    expect(clear).toContain("assert_official_demo_inventory");
    expect(functions).toContain("<> 19");
    expect(functions).toContain("<> 50");
    expect(functions).toContain("bucket = 'documents') <> 47");
  });

  it("keeps the final migration and service grants in the source bundle", () => {
    expect(migration).toContain("20260823170000");
    expect(grants).toContain("confirm_demo_actor_absent");
    expect(grants).toContain("assert_official_demo_inventory");
    expect(grants).toContain("release_demo_orphan_for_onboarding");
    expect(clear).toContain("service-role-only after an exact run/clear lease");
    expect(functions).toContain("demo_lock_account_axes");
    expect(functions).toContain("assert_demo_resource_ownership");
    expect(functions).toContain("single_preferences");
    expect(functions).toContain("single_notes");
  });

  it("contains the r17 convergence fences", () => {
    expect(seed).toContain("remove synthetic actor rows for");
    expect(seed).toContain("fail_demo_onboarding_seed transport failure");
    expect(seed).toContain("rootManifestRead");
    expect(clear).toContain('from("member_state")');
    expect(clear).toContain("if (actorIds.length > 0)");
    expect(functions).toContain(
      "demo runtime notification cannot cross different demo runs",
    );
    expect(functions).toContain("assert_demo_resource_ownership");
    expect(r17Migration).toContain("assert_demo_resource_ownership");
    expect(r17Migration).toContain(
      "demo_run_storage where run_id = p_run_id) <> 50",
    );
    expect(r17Migration).toContain("20260823177000");
    expect(r17Migration).toContain("not p_require_active");
  });

  it("keeps official trusted senders on household contexts", () => {
    const trustedSenderBlock = seed.match(
      /const trustedSenderRows = \[[\s\S]*?\n\s{4}\];/,
    )?.[0];
    expect(trustedSenderBlock).toBeDefined();
    expect(trustedSenderBlock).toContain("account_id: rootAccountId");
    expect(trustedSenderBlock).toContain(
      "created_by_member_id: dovidMembershipId",
    );
    // BOTH rows sit on this family's own account now: a household whitelists
    // the shadchanim who email it. The second used to live on the companion
    // household, which was the only reason it was ever on another account.
    expect(trustedSenderBlock).not.toContain("accountIdByContext");
    expect(
      trustedSenderBlock?.match(/account_id: rootAccountId/g),
    ).toHaveLength(2);
    expect(seed).toContain('"mrs.feldman@demo.invalid"');
    expect(seed).toContain('"goldenmatches@demo.invalid"');
    expect(triggers).toContain("validate_trusted_senders_household_scope");
    expect(functions).toContain(
      "trusted_senders where account_id = p_account_id",
    );
  });
});
