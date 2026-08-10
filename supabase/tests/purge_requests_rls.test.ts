import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the purge_requests RLS suite (Story 14.4 / PRV-11) against the local
 * Supabase stack.
 *
 * The assertions live in purge_requests_rls.sql because what they check —
 * RLS predicates deciding who can insert/read/update/delete purge requests,
 * and the verify_purge_request() function behavior — only exists inside
 * Postgres. The migration proved the policies/function could be *created*;
 * this suite is the first thing that makes them *evaluate* for real roles.
 * The SQL emits one JSON row per check; this file turns each into a named
 * test so a failure names the invariant that broke.
 *
 * Needs a stack up (`make start`, or `make start-supabase-e2e STACK_ID=<n>`
 * and the matching STACK_ID in the environment). If the database is
 * unreachable the suite reports a single skipped test rather than failing the
 * whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "purge_requests_rls.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function isolatedScript(): string {
  return ["\\set ON_ERROR_STOP on", "begin;", `\\i ${SQL_FILE}`].join("\n");
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

describe("purge_requests_rls (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not. A suite that emits an empty report is otherwise green, and
  // "green because nothing ran" is the failure mode this whole story's
  // verification has been guarding against.
  it("runs every check group (anon insert, anon denied read/update/delete, verify function)", () => {
    expect(checks.length).toBeGreaterThanOrEqual(10);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
