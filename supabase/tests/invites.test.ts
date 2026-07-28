import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the Story 2.7 (invite-only signup with 18+ affirmation) database
 * suite against the local Supabase stack. The assertions live in
 * invites.sql, because what they check — that `invites` cannot be written
 * to directly by `authenticated` even with a hand-crafted privileged role
 * (AC-2), that `create_invite()`'s authority/kind checks actually refuse
 * (AC-3), that `get_invite_preview()` is anon-callable and narrow (AC-4),
 * that `check_signup_invite()` allows/refuses per its Auth Hook contract
 * (AC-5), and that `handle_new_user()` binds from a matching invite and
 * creates NO membership otherwise (AC-6/AC-7) — only exists inside Postgres
 * (RLS + grants + triggers) and cannot be exercised through a mock. The SQL
 * emits one JSON row per check; this file turns each into a named test so a
 * failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "invites.sql",
);

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Check = { name: string; passed: boolean; detail: string | null };

// invites.sql wraps its own checks in `begin; ... rollback;` and clears
// public.account_members inside that transaction to start from a clean
// "no membership yet" state. Opening the real transaction here and clearing
// the table before including the suite keeps that isolation identical to the
// other database suites; the trailing rollback undoes it, so no real
// membership or invite data is ever destroyed.
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

describe("invite-only signup with 18+ affirmation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(20);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
