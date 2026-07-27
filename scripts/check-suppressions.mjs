#!/usr/bin/env node
// Ratchets the repo's suppression debt (Story 1.6, AC-10). Fails when a
// tree's count of ESLint disable comments or TypeScript suppression comments
// (ts-ignore / ts-expect-error / ts-nocheck style) exceeds its recorded
// budget, or when a test file carries an unconditional skip/only/todo/fixme
// directive. Takes the tree to scan as its first CLI argument (default
// process.cwd()) so its own unit test can point it at a disposable temp
// fixture instead of the real repo.
//
// This file lives under scripts/, which it scans, so — same rule as its own
// test (see below) — every needle it searches for is built by joining
// fragments at runtime rather than spelled contiguously in this source, or
// a real run would find its own detection logic and fail on itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectFiles, toRelPath } from "./fsScan.mjs";

const ESLINT_DISABLE_NEEDLE = `${"eslint"}-${"disable"}`;
const TS_IGNORE_NEEDLE = `@${"ts"}-${"ignore"}`;
const TS_EXPECT_ERROR_NEEDLE = `@${"ts"}-${"expect-error"}`;
const TS_NOCHECK_NEEDLE = `@${"ts"}-${"nocheck"}`;

// Mirrors Story 1.6 Task 1's re-measurement scope.
const SCAN_DIRS = ["src", "workers", "supabase", "e2e", "scripts", ".claude"];
const CODE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

// Per-tree budgets, seeded from the post-cleanup census (Task 9 removed the
// 6 no-console line-suppressions this ratchet would otherwise have to carry
// forever). A tree with no entry defaults to budget 0 — a suppression
// appearing somewhere new fails the gate instead of going unnoticed.
export const ESLINT_DISABLE_BUDGETS = {
  "src/components/admin": 54,
  "src/components/atomic-crm": 3,
  "src/hooks": 8,
  e2e: 1,
  "src/lib": 3,
  "src/test": 2,
  ".claude/skills": 2,
};

export const TS_SUPPRESSION_BUDGETS = {
  "src/components/admin": 5,
  "src/lib": 1,
};

const KNOWN_TREES = [
  ...new Set([
    ...Object.keys(ESLINT_DISABLE_BUDGETS),
    ...Object.keys(TS_SUPPRESSION_BUDGETS),
    "src/components/ui",
    "supabase/functions",
    "scripts",
    "workers",
  ]),
].sort((a, b) => b.length - a.length); // longest prefix first

function treeFor(relPath) {
  return (
    KNOWN_TREES.find(
      (tree) => relPath === tree || relPath.startsWith(`${tree}/`),
    ) ?? "other"
  );
}

const TEST_FILE_PATTERN = /\.(test\.(ts|tsx|mjs)|spec\.ts)$/;
const SKIP_PATTERNS = [
  [/\bit\.skip\(\s*["'`]/, 'it.skip("...")'],
  [/\btest\.skip\(\s*["'`]/, 'test.skip("...")'],
  [/\bdescribe\.skip\(\s*["'`]/, 'describe.skip("...")'],
  [/\.only\(/, ".only("],
  [/\.todo\(/, ".todo("],
  [/\.fixme\(/, ".fixme("],
  [/\bxit\(/, "xit("],
  [/\bxdescribe\(/, "xdescribe("],
];

function countOccurrences(lines, needle) {
  return lines.filter((line) => line.includes(needle)).length;
}

// --- Fixture builders for this guard's own unit test -----------------------
// AC-10(e): the offending literal a test writes to a temp fixture must be
// composed at runtime, never typed contiguously into the test source — this
// keeps the test's own source (also under scripts/, also scanned) from
// tripping the very check it's proving. These builders join their fragments
// at call time so neither this module's source nor a caller's ever spells a
// violation contiguously.

/** e.g. buildSuffixCall("it", "skip", "reason") -> `it.skip("reason", () => {});` */
export function buildSuffixCall(prefix, suffix, reason) {
  return `${prefix}${"."}${suffix}(${JSON.stringify(reason)}, () => {});`;
}

/** e.g. buildBareCall("xit", "reason") -> `xit("reason", () => {});` */
export function buildBareCall(name, reason) {
  return `${name}(${JSON.stringify(reason)}, () => {});`;
}

/** A conditional skip — same shape, but never matches SKIP_PATTERNS (no leading string arg). */
export function buildConditionalSkip(prefix, suffix, conditionVar, reason) {
  return `${prefix}${"."}${suffix}(${conditionVar}, ${JSON.stringify(reason)});`;
}

/** Builds a realistic disable-comment line for the suppression-census tests. */
export function buildDisableComment(rule) {
  return `// ${ESLINT_DISABLE_NEEDLE}-next-line ${rule}`;
}

/**
 * Runs the ratchet against `scanRoot` and returns the list of human-readable
 * failure messages (empty when everything is within budget).
 */
export function runSuppressionCheck(scanRoot) {
  const files = collectFiles(scanRoot, SCAN_DIRS, CODE_EXTENSIONS);
  const eslintDisableCounts = {};
  const tsSuppressionCounts = {};
  const skipViolations = [];

  for (const file of files) {
    const relPath = toRelPath(scanRoot, file);
    const lines = readFileSync(file, "utf8").split("\n");
    const tree = treeFor(relPath);

    const eslintHits = countOccurrences(lines, ESLINT_DISABLE_NEEDLE);
    if (eslintHits > 0) {
      eslintDisableCounts[tree] = (eslintDisableCounts[tree] ?? 0) + eslintHits;
    }

    const tsHits =
      countOccurrences(lines, TS_IGNORE_NEEDLE) +
      countOccurrences(lines, TS_EXPECT_ERROR_NEEDLE) +
      countOccurrences(lines, TS_NOCHECK_NEEDLE);
    if (tsHits > 0) {
      tsSuppressionCounts[tree] = (tsSuppressionCounts[tree] ?? 0) + tsHits;
    }

    if (TEST_FILE_PATTERN.test(relPath)) {
      lines.forEach((line, index) => {
        for (const [pattern, label] of SKIP_PATTERNS) {
          if (pattern.test(line)) {
            skipViolations.push(
              `${relPath}:${index + 1}: unconditional ${label}`,
            );
          }
        }
      });
    }
  }

  const failures = [];
  for (const [tree, count] of Object.entries(eslintDisableCounts)) {
    const budget = ESLINT_DISABLE_BUDGETS[tree] ?? 0;
    if (count > budget) {
      failures.push(
        `${ESLINT_DISABLE_NEEDLE} comments over budget in "${tree}": ${count} found, budget ${budget} (+${count - budget})`,
      );
    }
  }
  for (const [tree, count] of Object.entries(tsSuppressionCounts)) {
    const budget = TS_SUPPRESSION_BUDGETS[tree] ?? 0;
    if (count > budget) {
      failures.push(
        `TS suppression comments over budget in "${tree}": ${count} found, budget ${budget} (+${count - budget})`,
      );
    }
  }
  failures.push(...skipViolations);
  return failures;
}

function main() {
  const scanRoot = path.resolve(process.argv[2] ?? process.cwd());
  const failures = runSuppressionCheck(scanRoot);

  if (failures.length > 0) {
    console.error("Suppression ratchet failed:\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Suppression ratchet OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
