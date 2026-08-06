import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Story 12.3's family-shared-tasks suite against the local Supabase
 * stack.
 *
 * The assertions live in task_assignment.sql, because what they check — the
 * public.context_members view's security_invoker posture and cross-context
 * isolation (AC-4), validate_task_assignee()'s accept/reject boundary and
 * its column-scoped firing (AC-5, AC-6), the archive/re-add identity
 * round-trip (AC-7), a shadchanus context's own assignment path (AC-8), and
 * the AC-9 backfill statement replayed verbatim — only exist inside
 * Postgres and cannot be meaningfully exercised through a mock. The SQL
 * emits one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs the local Supabase stack up (STACK_ID-aware via dbSuiteHelpers). If
 * the database is unreachable the suite reports a single skipped test
 * rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "task_assignment.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// task_assignment.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction before setting up
// its own fixtures — the same isolation shape as every other suite in this
// directory. Opening the real transaction here and clearing the table
// beforehand keeps the "first user bootstraps a membership" behaviour from
// tripping over leftover local seed data; the trailing rollback undoes it,
// so no real membership data is destroyed.
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

describe("family-shared tasks with assignees (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(18);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
