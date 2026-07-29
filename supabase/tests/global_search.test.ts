import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Story 4.5's negative test (Dev Notes, "The negative test this story
 * owns") against the local Supabase stack.
 *
 * The assertions live in global_search.sql, because what they check — that
 * `singles`, `shidduchim_summary` and `shadchanim` each deny a cross-account
 * caller under a search-shaped query — only exists inside Postgres (RLS) and
 * cannot be exercised through a mock. The SQL emits one JSON row per check;
 * this file turns each into a named test so a failure names the invariant
 * that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "global_search.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// global_search.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction to re-point
// memberships at this suite's own accounts from a pristine state. Opening
// the real transaction here and clearing the table before including the
// suite file keeps that isolation identical to every other database suite
// in this directory (references_entity.test.ts, context_rls_hardening.test.ts,
// household_scope_lift.test.ts); the trailing rollback undoes it, so no real
// membership data is ever destroyed.
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

  // The report is the last line that is a JSON array; everything before it
  // is ordinary psql statement output.
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

describe("global search — cross-account isolation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(8);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
