import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the child_grants listings read-across guard against the local
 * Supabase stack.
 *
 * The assertions live in child_grant_listings_access.sql because they can
 * only be expressed by reading `public.listings` as different callers — an
 * unrelated household, a grantee through pending and revoked statuses, the
 * accepted grantee against the granted single's listing, the SAME accepted
 * grantee against the proposer's other, non-granted single's listing and
 * against the proposer's shadchan-type (single_id IS NULL) listing, and a
 * single-role member inside the grantee household — which no mock
 * reproduces: the grant, the RLS policy, current_context_id() and
 * current_member_role() all have to be simultaneously right for every case
 * to land correctly. The null-single_id case is this increment's point: it
 * only passes if the policy's direct-column comparison correctly evaluates
 * to no-match (not an error, not a false positive) when listings.single_id
 * is NULL.
 *
 * Needs a running stack (`make start`, or `make start-supabase-e2e STACK_ID=n`).
 * If the database is unreachable the suite reports a single skipped test rather
 * than failing the whole run, matching the other db suites.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "child_grant_listings_access.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function isolatedScript(): string {
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
    `\\i ${SQL_FILE}`,
  ].join("\n");
}

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      input: isolatedScript(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { checks: [], error: message };
  }

  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));

  if (!reportLine) {
    return { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
  }

  return { checks: JSON.parse(reportLine) as Check[] };
}

const { checks, error } = runSuite();

describe("child_grants listings read access (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A vacuous run — the SQL erroring early and emitting a short report — must
  // fail here rather than look like a pass, which is the failure mode this
  // whole suite exists to catch one level down.
  it("runs the full set of checks", () => {
    expect(checks.length).toBe(10);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
