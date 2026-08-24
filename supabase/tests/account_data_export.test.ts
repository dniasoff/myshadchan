import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const sqlFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "account_data_export.sql",
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

describe("account data export", () => {
  if (bailIfDbUnreachable(error)) return;

  // This whole feature raised insufficient_privilege for every caller until
  // the guard was fixed, and then 42P01/42703 for a further nine nonexistent
  // tables and columns underneath it: it had never once been executed. These
  // checks exist so that cannot recur silently — a broken reference anywhere
  // in either function aborts the suite rather than emitting a report.
  it("exports the caller's own account and still refuses an unauthenticated caller", () => {
    expect(DB_URL).not.toContain(":54322/");
    expect(checks).toHaveLength(7);
    for (const check of checks) {
      expect(check.passed, check.detail ?? check.name).toBe(true);
    }
  });
});
