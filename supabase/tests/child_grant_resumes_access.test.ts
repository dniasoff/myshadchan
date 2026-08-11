import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the child_grants resumes-read-across guard against the local Supabase
 * stack.
 *
 * The assertions live in child_grant_resumes_access.sql because they can only
 * be expressed by reading `public.resumes` as five different callers — an
 * unrelated household, a grantee through a pending and then the accepted
 * status, a sibling single inside the proposer household, and finally a
 * single-role member inside the grantee household — which no mock reproduces:
 * the grant, the RLS policy, current_context_id() and current_member_role()
 * all have to be simultaneously right for the positive case to pass and for
 * every negative case to stay closed.
 *
 * The sibling-leak assertion ((d) in the SQL) is the reason this increment
 * exists: an accepted grantee whose grant names only the granted single must
 * still see zero rows for a DIFFERENT single in the SAME proposer household —
 * proving the join is pinned to target_single_id, not account_id. A
 * household-wide widening would return that sibling's resume, and this suite
 * would fail.
 *
 * Needs a running stack (`make start`, or `make start-supabase-e2e STACK_ID=n`).
 * If the database is unreachable the suite reports a single skipped test rather
 * than failing the whole run, matching the other db suites.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "child_grant_resumes_access.sql",
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

describe("child_grants resumes read access (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A vacuous run — the SQL erroring early and emitting a short report — must
  // fail here rather than look like a pass, which is the failure mode this
  // whole suite exists to catch one level down.
  it("runs the full set of checks", () => {
    expect(checks.length).toBe(9);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
