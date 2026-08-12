import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the child_grants comment-tier interactions guard against the local
 * Supabase stack.
 *
 * The assertions live in child_grant_interactions_comment_access.sql because
 * they can only be expressed by writing and reading `public.interactions` as
 * five different callers — a stranger household, grantees at each of the
 * three access tiers, a single-role member inside a comment-tier grantee
 * household, and the proposer's own family — which no mock reproduces: the
 * grant, the new INSERT/SELECT policies, the general policies' kind
 * exclusions, `current_context_id()` and `current_member_role()` all have to
 * be simultaneously right for the positive cases to pass and, more
 * importantly, for the family's own private notes to stay invisible to every
 * grantee at every tier. That negative (d)/(e)/(h) is this suite's single
 * most important assertion.
 *
 * Also covers: cross-grantee isolation (a grantee cannot read a DIFFERENT
 * grantee's own commentary), append-only enforcement for both the author and
 * an owning-role family member, and that `interactions_summary.can_moderate`
 * stays in sync with the UPDATE policy's own kind exclusion.
 *
 * Needs a running stack (`make start`, or `make start-supabase-e2e STACK_ID=n`).
 * If the database is unreachable the suite reports a single skipped test rather
 * than failing the whole run, matching the other db suites.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "child_grant_interactions_comment_access.sql",
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

describe("child_grants comment-tier interactions access (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A vacuous run — the SQL erroring early and emitting a short report — must
  // fail here rather than look like a pass, which is the failure mode this
  // whole suite exists to catch one level down.
  it("runs the full set of checks", () => {
    expect(checks.length).toBe(23);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
