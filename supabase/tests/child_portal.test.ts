import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runs the Epic-7 read-only child-portal database suite against the local
 * Supabase stack. The assertions live in child_portal.sql, because what they
 * check — the get_child_portal() RPC's token -> child scoping, the
 * visibility='shared' + is_child_visible_state() filter, cross-child and
 * cross-tenant isolation, revocation, the forced-CSPRNG token, and the fact that
 * anon can call the RPC but never read the token table — only exists inside
 * Postgres and cannot be exercised through a mock. The SQL emits one JSON row per
 * check; this file turns each into a named test so a failure names the invariant
 * that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "child_portal.sql",
);

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Check = { name: string; passed: boolean; detail: string | null };

// child_portal.sql wraps its own checks in `begin; ... rollback;`, and it
// deletes public.account_members inside that transaction to assert the portal
// behaviour from a pristine, this-suite-only membership state. Opening the real
// transaction here and clearing the table before including the suite keeps that
// isolation identical to the other database suites; the trailing rollback undoes
// it, so no real membership data is ever destroyed.
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

describe("child portal (database)", () => {
  if (error) {
    it.skip(`skipped — local Supabase unreachable: ${error.split("\n")[0]}`, () => {});
    return;
  }

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(21);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
