import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const sqlFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "account_orphan_invariant.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  try {
    const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", sqlFile], {
      env: { ...process.env, PGPASSWORD: "postgres" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    const reportLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("[") && line.endsWith("]"));
    if (!reportLine)
      return { checks: [], error: `no report emitted:\n${stdout}` };
    return { checks: JSON.parse(reportLine) as Check[] };
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const { checks, error } = runSuite();

describe("no orphaned accounts", () => {
  if (bailIfDbUnreachable(error)) return;

  // An account with no active membership is unreachable forever. Four code
  // paths used to commit one, and the demo clear did it on every successful
  // cycle. These checks cover both halves of the repair: the paths delete it
  // (or keep it reachable), and the deferred constraint triggers REJECT the
  // state so a future path that forgets fails loudly instead of leaking.
  //
  // The negative cases force the commit-time check with `set constraints all
  // immediate` — without that they would pass whether or not the triggers
  // exist, because this suite runs inside a transaction it rolls back.
  it("makes an orphaned account impossible and deletes the demo root when the demo ends", () => {
    expect(DB_URL).not.toContain(":54322/");
    expect(checks).toHaveLength(20);
    for (const check of checks) {
      expect(check.passed, check.detail ?? check.name).toBe(true);
    }
  });
});
