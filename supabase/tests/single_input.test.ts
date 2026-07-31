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
 * Runs the single's-input database suite (Story 6.4, AC 1-4, AC 7) against
 * the local Supabase stack.
 *
 * The assertions live in single_input.sql, because what they check — the
 * narrow INSERT carve-out's visibility join, server-set unforgeable
 * attribution, the append-only UPDATE denial for every role via a real
 * `GET DIAGNOSTICS ROW_COUNT` (never a raise), and the SELECT carve-out's
 * exact row set — only exist inside Postgres and cannot be meaningfully
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "single_input.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// single_input.sql wraps its own checks in `begin; ... rollback;` and clears
// public.account_members inside that transaction before setting up its own
// fixtures — the same isolation shape as every other suite in this
// directory. The shared sibling fixture (dbSuiteHelpers.ts) is spliced in
// HERE, before `\i`, exactly like single_row_scoping.test.ts /
// single_field_scoping.test.ts do for Stories 6.2/6.3.
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

describe("single_input (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // Review should-fix precedent (single_field_scoping.test.ts): an exact
  // count catches any check silently vanishing (a naive `insert into
  // results (...) select ... from <view> where id = ...` with no matching
  // row inserts nothing at all), not just a large drop. Update this number
  // in the same diff as any change to the number of `insert into results`
  // statements in single_input.sql.
  it("runs every AC 1 / AC 2 / AC 3 / AC 4 / AC 7 check", () => {
    expect(checks.length).toBe(19);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
