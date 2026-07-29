import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs Story 3.6's note-authorship suite (AC 4's eight-check negative
 * matrix + AC 5's four `interactions_summary` view checks) against the
 * local Supabase stack.
 *
 * The assertions live in interaction_note_authorship.sql, because what they
 * check — that `can_moderate_note()` and the split interactions policies
 * genuinely restrict UPDATE to a note's author or an owning-role member,
 * that a soft-delete is indistinguishable from a policy denial only via
 * `GET DIAGNOSTICS ROW_COUNT`, and that `interactions_summary` resolves
 * author identity through the SAME predicate the policy uses — only exist
 * inside Postgres and cannot be meaningfully exercised through a mock. The
 * SQL emits one JSON row per check; this file turns each into a named test
 * so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable the
 * suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "interaction_note_authorship.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// interaction_note_authorship.sql wraps its own checks in `begin; ...
// rollback;` and clears public.account_members inside that transaction
// before setting up its own fixtures — the same isolation shape as every
// other suite in this directory.
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

describe("note authorship and moderation (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the full set of checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(17);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
