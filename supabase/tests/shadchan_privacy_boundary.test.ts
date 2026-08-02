import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the shadchan privacy-boundary database suite (Epic 8 Story 8.4)
 * against the local Supabase stack, exactly as shadchan_redting.test.ts runs
 * Story 8.3's / shadchan_connections.test.ts runs Story 8.2's.
 *
 * The assertions live in shadchan_privacy_boundary.sql, because what they
 * check — RLS's continued cross-scope invisibility, and the mutation-proof
 * that each denial is a real fact about the CURRENT policy rather than a
 * vacuous pass — only exists inside Postgres and cannot be meaningfully
 * exercised through a mock. The SQL emits one JSON row per check; this file
 * turns each into a named test so a failure names the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shadchan_privacy_boundary.sql",
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

describe("the shadchan's privacy boundary (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A floor, not an exact count — new checks are welcome, silently
  // vanishing ones are not. Review fix (F6): the floor used to sit 4 below
  // the suite's own actual count (25 vs 29 emitted), which was loose enough
  // to lose an entire group — both AC-4 checks, the AC-6 positive and the
  // AC-5 summary check together — without this assertion ever going red.
  // The floor is now set to the suite's exact current count (53, after the
  // F1/F2 review-fix additions: shidduchim/resumes/redts fixture rows,
  // existence controls, runtime denials and mutation-proofs; the F2
  // contract-shape block; and the relrowsecurity/policy-presence guards
  // near AC-7), so any future silent drop is caught immediately rather than
  // hiding inside slack.
  it("runs every sanity, existence-control, AC-1 through AC-7, F1/F2 review-fix, and mutation-proof check", () => {
    expect(checks.length).toBeGreaterThanOrEqual(53);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
