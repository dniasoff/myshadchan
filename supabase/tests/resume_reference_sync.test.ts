import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resume_reference_sync.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  try {
    const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    const reportLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("[") && line.endsWith("]"));
    return reportLine
      ? { checks: JSON.parse(reportLine) as Check[] }
      : { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const result = runSuite();

describe("resume reference reconciliation (database)", () => {
  if (bailIfDbUnreachable(result.error)) return;

  it("runs the populated-tenant proof", () => {
    expect(result.checks.length).toBeGreaterThanOrEqual(14);
  });

  for (const check of result.checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
