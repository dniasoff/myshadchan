import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resume_read.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };
let checks: Check[] = [];
let error: string | undefined;
try {
  const stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const report = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));
  checks = report ? (JSON.parse(report) as Check[]) : [];
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

describe("fill-empty resume read database contract", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the field, section, identity and privilege checks", () => {
    expect(error).toBeUndefined();
    expect(checks.length).toBeGreaterThanOrEqual(4);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
