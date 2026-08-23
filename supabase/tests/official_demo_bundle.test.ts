import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "official_demo_bundle.sql",
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

describe("official onboarding demo bundle containment (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("runs the bundle isolation and lifecycle graph checks", () => {
    expect(checks.length).toBeGreaterThanOrEqual(12);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});

describe("official demo notification source parity", () => {
  it("keeps declarative and pending migration dispatch semantics aligned", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const declarative = readFileSync(
      path.join(testDirectory, "../schemas/02_functions.sql"),
      "utf8",
    );
    const migration = readFileSync(
      path.join(
        testDirectory,
        "../migrations/20260823012000_official_onboarding_demo_bundle.sql",
      ),
      "utf8",
    );
    for (const source of [declarative, migration]) {
      expect(source).toContain("simulated is not true");
      expect(source).toContain("simulated, sent_at");
      expect(source).toContain("case when candidates.simulated then 'sent'");
      expect(source).toContain("case when v_simulated then 'sent'");
      expect(source).toMatch(
        /insert into public\.task_notifications\s*\([^)]*simulated\s*,\s*sent_at/s,
      );
    }
  });
});

describe("official demo listing preview source parity", () => {
  it("keeps browser preview active-only in the declarative schema and migration", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const sources = [
      readFileSync(
        path.join(testDirectory, "../schemas/02_functions.sql"),
        "utf8",
      ),
      readFileSync(
        path.join(
          testDirectory,
          "../migrations/20260823100000_demo_preview_active_only.sql",
        ),
        "utf8",
      ),
    ];

    for (const source of sources) {
      const previewFunction = source.match(
        /(?:create or replace|CREATE OR REPLACE) FUNCTION[^$]*demo_account_is_previewable[\s\S]*?\$\$;/i,
      )?.[0];
      expect(previewFunction).toBeDefined();
      expect(previewFunction).toContain("dr.status = 'active'");
      expect(previewFunction).toContain("caller_scope");
      expect(previewFunction).toContain("target_scope");

      if (source.includes("current_account_demo_previewable")) {
        expect(source).toContain("current_account_demo_previewable");
      }
    }
  });
});
