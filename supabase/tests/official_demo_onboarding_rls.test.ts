import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "official_demo_onboarding_rls.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  try {
    const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
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

describe("official demo onboarding RLS and RPC boundary (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the direct-table and caller-scoped RPC checks", () => {
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
