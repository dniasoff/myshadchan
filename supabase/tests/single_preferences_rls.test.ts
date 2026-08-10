import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DB_URL,
  bailIfDbUnreachable,
  siblingHouseholdFixtureSql,
} from "./dbSuiteHelpers";

/**
 * Runs the single_preferences RLS suite (Story 16.1 / FR67) against the local
 * Supabase stack.
 *
 * The assertions live in single_preferences_rls.sql because what they check —
 * two RLS predicates deciding who reads a single's own words — only exists
 * inside Postgres. The migration proved the policies could be *created*; this
 * suite is the first thing that makes them *evaluate* for a real authenticated
 * role. The SQL emits one JSON row per check; this file turns each into a
 * named test so a failure names the invariant that broke.
 *
 * Needs a stack up (`make start`, or `make start-supabase-e2e STACK_ID=<n>`
 * and the matching STACK_ID in the environment). If the database is
 * unreachable the suite reports a single skipped test rather than failing the
 * whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "single_preferences_rls.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// Same isolation shape as single_row_scoping.test.ts: the suite wraps itself
// in `begin; ... rollback;`, and the shared sibling fixture is spliced in HERE
// rather than inside the .sql, because psql cannot import a TypeScript module.
function isolatedScript(): string {
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
    siblingHouseholdFixtureSql(),
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

describe("single_preferences_rls (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not. A suite that emits an empty report is otherwise green, and
  // "green because nothing ran" is the failure mode this whole story's
  // verification has been guarding against.
  it("runs every check group (single's own read, manager's shared-only read, cross-household, writes)", () => {
    expect(checks.length).toBeGreaterThanOrEqual(15);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
