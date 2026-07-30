import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DB_URL,
  bailIfDbUnreachable,
  householdFixtureDataSql,
  ownerHouseholdFixtureSql,
} from "./dbSuiteHelpers";

/**
 * Runs Story 6.5's self-manager/parent_admin parity database suite against
 * the local Supabase stack.
 *
 * The assertions live in self_manager_parity.sql, because what they check —
 * that NO Epic 6 row-narrowing or candid-content deny (Stories 6.2/6.3, all
 * phrased as `= 'single'`/`<> 'single'`, never `parent_admin`-specific)
 * catches a `self_manager` caller, that add_persona('single') really
 * provisions one atomic household+membership+singles row for a
 * membership-less caller, and that role_authority()'s invite ladder still
 * treats self_manager and parent_admin differently — only exists inside
 * Postgres and cannot be meaningfully exercised through a mock. The SQL
 * emits one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "self_manager_parity.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// self_manager_parity.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction before provisioning
// its own two households — the same isolation shape as every other suite in
// this directory. Household S (self-manager) and household P (parent_admin)
// are each provisioned via the REAL add_persona() RPC and seeded with an
// identical data shape by the SAME two dbSuiteHelpers.ts functions
// (ownerHouseholdFixtureSql / householdFixtureDataSql), spliced in HERE,
// before `\i`, exactly like single_row_scoping.test.ts/
// single_field_scoping.test.ts splice their own shared sibling fixture —
// this story's "seeded by the same code" requirement (Task 2), so the two
// households cannot silently drift apart in shape.
function isolatedScript(): string {
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
    ownerHouseholdFixtureSql("s"),
    householdFixtureDataSql("s"),
    ownerHouseholdFixtureSql("p"),
    householdFixtureDataSql("p"),
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

describe("self_manager_parity (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently vanishing
  // ones are not (the same reasoning single_row_scoping.test.ts's own floor
  // comment gives). 2 AC-2 checks + 29 count-parity checks (21 base tables +
  // 4 summary views + 4 storage keys) + 2 close_reason checks + 6 write-parity
  // checks (3 per household) + 4 invite-authority checks = 43.
  it("runs every AC 1 / AC 2 / AC 3 / AC 5 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(43);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
