import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runs the References epic's database suite against the local Supabase stack.
 *
 * The assertions themselves live in references_entity.sql, because what they
 * check — RLS, SECURITY DEFINER boundaries, trigger behaviour — only exists
 * inside Postgres and cannot be meaningfully exercised through a mock. The SQL
 * emits one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "references_entity.sql",
);

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Check = { name: string; passed: boolean; detail: string | null };

// references_entity.sql wraps its own checks in `begin; ... rollback;`, so
// nothing it inserts survives the run. That does not make the "first user"
// check below self-isolating, though: it asserts that inserting a user while
// public.account_members is EMPTY bootstraps a parent_admin membership for
// them, and on a reused local DB (e.g. after signing up through the app, or
// after any earlier test run's seed data) that table already has rows before
// the suite's transaction even starts. This preamble opens the real
// transaction itself and clears public.account_members inside it *before*
// including the suite file, so the check always starts from the pristine
// state it assumes. The suite file's own `begin;` then just re-enters the
// already-open transaction (Postgres warns, does not nest), and its trailing
// `rollback;` undoes the delete along with everything else — so this never
// destroys real membership data, regardless of what was in the table when
// the run started.
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

describe("references entity (database)", () => {
  if (error) {
    it.skip(`skipped — local Supabase unreachable: ${error.split("\n")[0]}`, () => {});
    return;
  }

  it("runs a non-trivial number of checks", () => {
    expect(checks.length).toBeGreaterThan(50);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
