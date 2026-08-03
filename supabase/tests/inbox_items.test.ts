import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Story 10.3's `inbox_items` account-isolation suite against the local
 * Supabase stack. The assertions live in inbox_items.sql — SELECT isolation,
 * the INSERT/UPDATE with-check, and the service_role bypass the inbound-email
 * webhook depends on can only be exercised through real RLS, not a mock. The
 * SQL emits one JSON row per check; this file turns each into a named test so
 * a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "inbox_items.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// Same isolation shape as shidduch_catch.test.ts / entity_files.test.ts:
// inbox_items.sql wraps its own checks in `begin; ... rollback;` and clears
// public.account_members inside that transaction, so opening the real
// transaction here first and clearing the table before `\i`-ing the suite
// keeps two concurrent runs of this directory's suites from ever seeing each
// other's rows.
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

describe("inbox_items account isolation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    // 11 today: (a) x3 select-isolation, (b)/(b-isolated) x2 INSERT
    // with-check (both-layers-active + trigger-disabled), (c)/(c-isolated)
    // x3 UPDATE with-check (attempt + verify + trigger-disabled), (d) x2
    // service_role bypass. An anti-vacuity floor (migration-guard-integrity.md's
    // pattern): a regression that silently dropped most of this file's
    // checks would still pass a loose ">= 8" one row at a time.
    expect(checks.length).toBeGreaterThanOrEqual(11);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
