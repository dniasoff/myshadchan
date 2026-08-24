import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const sqlFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "official_demo_onboarding_root_discard.sql",
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

describe("released demo onboarding root discard", () => {
  if (bailIfDbUnreachable(error)) return;

  // One green case, five refusals, two grant assertions, and two that the
  // retry itself is never blocked. The refusals are the point: the husk is
  // `demo = false` by the time this runs, so the write-barrier triggers do not
  // protect it and the function's own proofs are the whole fence.
  it("deletes only a provably finished husk and never blocks the retry", () => {
    expect(DB_URL).not.toContain(":54322/");
    expect(checks).toHaveLength(10);
    for (const check of checks) {
      expect(check.passed, check.detail ?? check.name).toBe(true);
    }
  });
});
