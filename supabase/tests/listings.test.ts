import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Stories 9.1, 9.2 and 9.3's database suite (publishing a shadchan or a
 * single's listing, and the dignity-floor withdrawal lock) against the
 * local Supabase stack. What it proves — that `listings` is the sole
 * anon-readable relation and is safe to read by construction (AD-21), that
 * both branches' CHECK constraints and partial unique indexes hold
 * regardless of what any client sends, that only a subject's manager may
 * publish (FR103), that a household can never publish a listing that is not
 * theirs from any angle, and that a single's own withdrawal blocks
 * republication until they consent again — with the lock itself reachable
 * by NO ONE's raw DML, ever (AC-4) — only exists inside Postgres (RLS +
 * grants + constraints + a SECURITY DEFINER trigger/RPC pair) and cannot be
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "listings.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
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

describe("publish a listing — shadchan (9.1), single (9.2) and the dignity-floor lock (9.3) (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently
  // vanishing ones are not. Raised from 90 to 96 by this story's own
  // review fixes (F1's update-repoint checks, F4's account-scoping
  // dual-membership check).
  it("runs every 9.1, 9.2 and 9.3 check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(96);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
