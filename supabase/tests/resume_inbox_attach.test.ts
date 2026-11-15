import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resume_inbox_attach.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      input: [
        "\\set ON_ERROR_STOP on",
        "begin;",
        "delete from public.account_members;",
        `\\i ${SQL_FILE}`,
      ].join("\n"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));

  return reportLine
    ? { checks: JSON.parse(reportLine) as Check[] }
    : { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
}

const { checks, error } = runSuite();

describe("resume_inbox_attach (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs every Inbox attachment boundary check", () => {
    expect(checks.length).toBeGreaterThanOrEqual(7);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
