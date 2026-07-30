import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the standing view-grants guard against the local Supabase stack.
 *
 * The grants-side twin of security_invoker_views.test.ts. `supabase db diff`
 * drops and recreates every view that depends on a table it considers changed,
 * and the `CREATE VIEW` it generates carries forward neither
 * `security_invoker` (guarded by the sibling suite) nor the view's grants
 * (guarded here) — leaving a view either unreadable by `authenticated` or,
 * via this schema's `alter default privileges … grant all on tables to
 * authenticated`, writable when 06_grants.sql narrowed it to SELECT.
 *
 * The assertion lives in view_grants.sql because it replays the real
 * 06_grants.sql inside a rolled-back transaction and compares `pg_class.relacl`
 * before and after — neither the replay nor the catalog exists outside
 * Postgres, so there is nothing here a mock could stand in for.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "view_grants.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// Same isolation preamble as every other suite in this directory (see
// shidduch_catch.test.ts); harmless here since nothing below reads rows.
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

describe("view grants match the declarative schema (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    // Eight views x three per-view checks, plus the coverage floor.
    expect(checks.length).toBeGreaterThanOrEqual(25);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
