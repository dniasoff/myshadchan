import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the Files tab's database suite (Story 3.7, AC 8) against the local
 * Supabase stack.
 *
 * The assertions live in entity_files.sql, because what they check — RLS on
 * the new table AND on the `entity-files` storage bucket, the four CHECK
 * constraints, the absence of a household-scope trigger, and the anon
 * denial — only exists inside Postgres and cannot be meaningfully exercised
 * through a mock. The SQL emits one JSON row per check; this file turns each
 * into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "entity_files.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// entity_files.sql wraps its own checks in `begin; ... rollback;` and clears
// public.account_members inside that transaction before setting up its own
// fixtures — the same isolation shape as every other suite in this
// directory (see household_scope_lift.test.ts's own comment for why).
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

describe("entity_files (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs all seven AC 8 check groups, plus the review-fix (h)/(i) purge and attribution checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(28);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
