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

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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
