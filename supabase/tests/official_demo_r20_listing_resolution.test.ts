import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(testDirectory, "../schemas/02_functions.sql");
const grantsFile = path.join(testDirectory, "../schemas/06_grants.sql");
const policiesFile = path.join(testDirectory, "../schemas/05_policies.sql");
const seedFile = path.join(testDirectory, "../functions/seed_demo/index.ts");
const migrationFile = path.join(
  testDirectory,
  "../migrations/20260823190000_official_demo_r21_convergence.sql",
);
const sqlFile = path.join(
  testDirectory,
  "official_demo_r20_listing_resolution.sql",
);

const schema = readFileSync(schemaFile, "utf8");
const grants = readFileSync(grantsFile, "utf8");
const policies = readFileSync(policiesFile, "utf8");
const seed = readFileSync(seedFile, "utf8");
const migration = readFileSync(migrationFile, "utf8");

function functionBody(definition: string): string {
  const starts = [
    definition.indexOf(
      'CREATE OR REPLACE FUNCTION "public"."resolve_demo_listing_id"',
    ),
    definition.indexOf(
      "CREATE OR REPLACE FUNCTION public.resolve_demo_listing_id",
    ),
    definition.indexOf(
      "create or replace function public.resolve_demo_listing_id",
    ),
  ].filter((index) => index >= 0);
  const start = Math.min(...starts);
  if (!Number.isFinite(start)) throw new Error("resolver function is missing");
  const asMatch = definition.slice(start).match(/\n\s*AS\s+(\$\w*\$|\$\$)\n/i);
  if (!asMatch || asMatch.index === undefined) {
    throw new Error("resolver function has no SQL body");
  }
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const bodyEnd = definition.indexOf(`\n${asMatch[1]}`, bodyStart);
  if (bodyEnd < 0) throw new Error("resolver function body is unterminated");
  return definition.slice(bodyStart, bodyEnd).trimEnd();
}

function listingInsertBlocks(source: string): string[] {
  return [...source.matchAll(/\.from\("listings"\)\s*\.insert\([^;]*;/g)].map(
    (match) => match[0],
  );
}

describe("official demo listing resolver source", () => {
  it("keeps the declarative function byte-for-byte aligned with r21", () => {
    expect(functionBody(schema)).toBe(functionBody(migration));
    const body = functionBody(schema);
    expect(body).toContain("select dr.* into strict v_run");
    expect(body).toContain("dr.operation = 'seed'");
    expect(body).toContain("dr.lease_expires_at > clock_timestamp()");
    expect(body).toContain("select count(*), min(l.id)");
    expect(body).toContain(
      "on conflict (run_id, resource_type, resource_id) do nothing",
    );
  });

  it("keeps resolver execution service-role-only and leaves listing visibility narrow", () => {
    const grant =
      "revoke all on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) from public, anon, authenticated;";
    expect(grants).toContain(grant);
    expect(grants).toContain(
      "grant execute on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) to service_role;",
    );
    expect(migration).toContain(grant);
    expect(migration).toContain(
      "grant execute on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) to service_role;",
    );
    expect(policies).toContain('create policy "Listings readable by anon"');
    expect(policies).toContain(
      "not public.demo_account_in_active_run(account_id)",
    );
    expect(policies).toContain(
      'create policy "Demo listings readable in bundle preview"',
    );
    expect(policies).toContain(
      "public.demo_account_is_previewable(account_id)",
    );
    expect(schema).toContain("dr.status = 'active'");
  });

  it("keeps both actor inserts return-minimal and uses exactly one resolver per listing", () => {
    const inserts = listingInsertBlocks(seed);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).not.toContain(".select(");
    expect(seed).not.toMatch(
      /\.from\("listings"\)\s*\.insert\([^;]*\)\s*\.select\(/s,
    );
    expect(seed).toContain("insertAndResolveDemoListing(");
    expect(seed).toContain("resolveDemoListingWithReconciliation(");
    const helper = seed.slice(
      seed.indexOf("export async function insertAndResolveDemoListing"),
      seed.indexOf("async function registerTokenResource"),
    );
    expect(helper).not.toContain('.from("listings").insert(values).select(');
    expect(seed).toContain('"resolve_demo_listing_id"');
    const listingSection = seed.slice(
      seed.indexOf("Demo listings are deliberately invisible"),
      seed.indexOf("// Capture this once so the bearer link"),
    );
    expect(listingSection).not.toContain("registerDemoResource(");
  });
});

let databaseError: string | undefined;
let checks: Array<{ name: string; passed: boolean; detail: string | null }> =
  [];
try {
  const stdout = execFileSync("psql", ["-X", "-q", "-f", sqlFile, DB_URL], {
    env: { ...process.env, PGPASSWORD: "postgres" },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));
  if (!reportLine) databaseError = `no report emitted:\n${stdout}`;
  else checks = JSON.parse(reportLine) as typeof checks;
} catch (error) {
  databaseError = error instanceof Error ? error.message : String(error);
}

describe("official demo r20 listing resolver Stack 2 proof", () => {
  if (bailIfDbUnreachable(databaseError)) return;

  it("runs the rollback-safe Stack 2 proof", () => {
    expect(databaseError).toBeUndefined();
    expect(checks).toHaveLength(22);
    for (const check of checks) {
      expect(check.passed, check.detail ?? check.name).toBe(true);
    }
  });
});
