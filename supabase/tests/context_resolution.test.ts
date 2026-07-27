import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Story 2.1's context-aware-authorisation and Story 2.2's
 * persona/context data model database suites against the local Supabase
 * stack.
 *
 * The assertions themselves live in context_resolution.sql, because what
 * they check — current_context_id()'s fail-closed resolution, member_state's
 * single-writer RLS posture, the activate_first_context trigger, the
 * account/account_members corrected policy shapes, enforce_household_scope()/
 * enforce_membership_role_matches_context()'s trigger-ordering-dependent
 * enforcement, add_persona()/my_personas()'s provisioning and reporting
 * predicates, and the tightened `members` read policy — only exists inside
 * Postgres and cannot be meaningfully exercised through a mock. The SQL
 * emits one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "context_resolution.sql",
);

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Check = { name: string; passed: boolean; detail: string | null };

// context_resolution.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction before setting up
// its own fixtures — the same isolation shape as references_entity.sql and
// billing_entitlement.sql. Opening the real transaction here and clearing
// the table beforehand keeps the "first user bootstraps a membership" check
// (already covered elsewhere) from tripping over leftover local seed data;
// the trailing rollback undoes it, so no real membership data is destroyed.
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

describe("context-aware authorisation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs a non-trivial number of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(75);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
