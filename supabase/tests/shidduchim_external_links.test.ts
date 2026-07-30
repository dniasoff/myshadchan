import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the External links tab's database suite (Story 5.6, AC 6 / AC 7)
 * against the local Supabase stack.
 *
 * The assertions live in shidduchim_external_links.sql, because what they
 * check — RLS scoping every command to `account_id`, no role restriction
 * among the household's working roles (unlike medical_notes), Story 6.3's
 * outright denial of the `single` role on every command, the fail-closed
 * case for a caller with zero active memberships, the household-scope
 * trigger, the composite FK's cross-account guard, and the `url` NOT NULL
 * constraint — only exists inside Postgres and cannot be meaningfully
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shidduchim_external_links.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// shidduchim_external_links.sql wraps its own checks in `begin; ...
// rollback;` and clears public.account_members inside that transaction
// before setting up its own fixtures — the same isolation shape as every
// other suite in this directory (see household_scope_lift.test.ts's own
// comment for why).
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

describe("shidduchim_external_links (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not. Raised from 14 to 22 when Story 6.3's `single`-role denial
  // (case c2) was added: a denial suite whose checks can quietly disappear
  // without the run going red is exactly as useless as one that never
  // asserted them.
  it("runs every AC 6 / AC 7 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(22);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
