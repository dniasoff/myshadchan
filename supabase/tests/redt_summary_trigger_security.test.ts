import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the refresh_shidduch_redt_summary() SECURITY DEFINER regression guard
 * against the local Supabase stack, exactly as shadchan_redting.test.ts runs
 * Story 8.3's own self-contained suite.
 *
 * The assertions live in redt_summary_trigger_security.sql because what they
 * check -- a SECURITY DEFINER trigger's internal UPDATE succeeding under a
 * caller whose own RLS would have blocked it directly -- only exists inside
 * Postgres and cannot be meaningfully exercised through a mock. The SQL emits
 * one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "redt_summary_trigger_security.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
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

describe("refresh_shidduch_redt_summary() runs SECURITY DEFINER (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A vacuous run -- the SQL erroring early and emitting a short report --
  // must fail here rather than look like a pass.
  it("runs the full set of checks", () => {
    expect(checks.length).toBe(7);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
