import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the add_persona('single') two-parent-household guard database suite
 * against the local Supabase stack.
 *
 * The assertions live in two_parent_household_persona_guard.sql, because
 * what they check — that a parent_admin in a REAL 2-parent household (built
 * via the actual add_persona('parent') + create_invite('parent_admin') +
 * accept_invite() flow, never a hand-rolled shortcut) is refused a
 * self-managed shidduch profile, while a genuine solo-parent household and
 * an existing self_manager's idempotent re-tick both keep working — only
 * exists inside Postgres (SECURITY DEFINER functions, real RPCs) and cannot
 * be meaningfully exercised through a mock. The SQL emits one JSON row per
 * check; this file turns each into a named test so a failure names the
 * invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "two_parent_household_persona_guard.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function isolatedScript(): string {
  return ["\\set ON_ERROR_STOP on", `\\i ${SQL_FILE}`].join("\n");
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

describe("add_persona('single') two-parent-household guard (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(8);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
