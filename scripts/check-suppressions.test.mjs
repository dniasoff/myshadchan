import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runSuppressionCheck,
  ESLINT_DISABLE_BUDGETS,
  buildSuffixCall,
  buildBareCall,
  buildConditionalSkip,
  buildDisableComment,
} from "./check-suppressions.mjs";

// This guard's own proof-that-it-bites artifact (Story 1.6 AC-10). Every
// fixture is built fresh under a temp directory (never a committed file) and
// every offending literal is composed at runtime via the guard's own
// builders — never spelled contiguously in this source file — so that this
// test does not itself trip the real, repo-wide run of this same check
// once scripts/ is in scope.

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-suppressions-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeFixture(relPath, content) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("runSuppressionCheck — lint-suppression budgets", () => {
  it("passes when a tree's suppression count is exactly at budget", async () => {
    const budget = ESLINT_DISABLE_BUDGETS["src/lib"];
    const lines = Array.from({ length: budget }, (_, i) =>
      buildDisableComment(`no-explicit-any -- fixture ${i}`),
    ).join("\n");
    await writeFixture("src/lib/example.ts", lines);

    const failures = runSuppressionCheck(tempRoot);

    expect(failures).toEqual([]);
  });

  it("fails when a tree's suppression count exceeds its budget", async () => {
    const budget = ESLINT_DISABLE_BUDGETS["src/lib"];
    const lines = Array.from({ length: budget + 1 }, (_, i) =>
      buildDisableComment(`no-explicit-any -- fixture ${i}`),
    ).join("\n");
    await writeFixture("src/lib/example.ts", lines);

    const failures = runSuppressionCheck(tempRoot);

    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes("src/lib"))).toBe(true);
  });

  it("passes when a tree has no recorded budget and no suppressions", async () => {
    await writeFixture("src/lib/clean.ts", "export const x = 1;\n");

    expect(runSuppressionCheck(tempRoot)).toEqual([]);
  });
});

describe("runSuppressionCheck — unconditional test skips", () => {
  it("fails on an unconditional it.skip in a test file", async () => {
    const line = buildSuffixCall("it", "skip", "not implemented yet");
    await writeFixture("src/lib/example.test.ts", line);

    const failures = runSuppressionCheck(tempRoot);

    expect(failures.some((f) => f.includes("example.test.ts"))).toBe(true);
  });

  it("fails on a bare xdescribe in a test file", async () => {
    const line = buildBareCall("xdescribe", "quarantined suite");
    await writeFixture("e2e/example.spec.ts", line);

    const failures = runSuppressionCheck(tempRoot);

    expect(failures.length).toBeGreaterThan(0);
  });

  it("passes on a conditional test.skip(condition, reason)", async () => {
    const line = buildConditionalSkip(
      "test",
      "skip",
      "isMobile",
      "desktop-only capability",
    );
    await writeFixture("e2e/example.spec.ts", line);

    expect(runSuppressionCheck(tempRoot)).toEqual([]);
  });

  it("ignores the same pattern text outside a test file", async () => {
    // Non-test files are not scanned for skip/only directives at all — only
    // the lint- and TS-suppression census applies to them.
    const line = buildSuffixCall("it", "skip", "not a test file");
    await writeFixture("src/lib/notATest.ts", line);

    expect(runSuppressionCheck(tempRoot)).toEqual([]);
  });
});
