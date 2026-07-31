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
 * Runs the thread-model database suite (Story 7.1) against the local
 * Supabase stack.
 *
 * The assertions live in threads_entity.sql, because what they check — RLS,
 * the dual-axis composite FKs, SECURITY DEFINER boundaries, the polymorphic
 * delete cascade — only exists inside Postgres and cannot be meaningfully
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "threads_entity.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// threads_entity.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction before setting up
// its own fixtures — the same isolation shape as every other suite in this
// directory. The shared sibling fixture (dbSuiteHelpers.ts) is spliced in
// HERE, before `\i`, exactly as single_row_scoping.test.ts already does:
// AC-9's dignity-floor check needs the same two-sibling household, so this
// story reuses that shape rather than hand-rolling a second copy.
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

  // The report is the last line that is a JSON array; everything before it is
  // ordinary psql statement output.
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

describe("threads entity (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not.
  it("runs every AC 1 / 2 / 5 / 6 / 7 / 8 / 9 / 10 / 11 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(30);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
