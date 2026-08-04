import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the Epic 11 (inbound email capture) database suite against the local
 * Supabase stack. What it proves — that `accounts.inbound_email_token` is
 * auto-generated for a household account and is exactly 12 lowercase hex
 * characters (the shortened, 48-bit shape), that a client-supplied token is
 * always overwritten, that the kind-correspondence CHECK and the unique
 * index both hold independent of the trigger, and that `trusted_senders`
 * enforces its own account-scoped RLS (including the `single`-role denial)
 * and its per-household `(account_id, email)` uniqueness — only exists
 * inside Postgres (RLS + grants + triggers + constraints) and cannot be
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "inbound_email_capture.sql",
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

describe("inbound email capture (Epic 11) (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently
  // vanishing ones are not. Raised from 19 to 23 when the
  // inbox_items.sender_email checks (Epic 11 review fix) were added.
  it("runs every check group", () => {
    expect(checks.length).toBeGreaterThanOrEqual(23);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
