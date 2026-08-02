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
//
// "src/components/admin" dropped from 54 to 53 (Epic 8 close-out,
// 2026-08-02) when `isDirectiveComment` below started requiring the needle
// to open its own comment: date-time-input.tsx:328's line was never a real
// directive (a `// TODO: uncomment once we enable ... // eslint-disable-
// next-line ...` comment whose SECOND "//" only looks like a directive —
// the whole line is already one comment from its first "//", so ESLint
// itself never parses that inner text as a directive). Lowered rather than
// left at 54 so the budget still reflects the exact real count, per the
// same reasoning as TS_SUPPRESSION_BUDGETS below.
export const ESLINT_DISABLE_BUDGETS = {
  "src/components/admin": 53,
  "src/components/atomic-crm": 3,
  "src/hooks": 8,
  e2e: 1,
  "src/lib": 3,
  "src/test": 2,
  ".claude/skills": 2,
};

// Epic 3's entity360/ budget was 15 through 2026-07-29's audit: 13 real
// directives are expect-error NEGATIVE TYPE TESTS asserting a wrong shape
// does not compile (EntityDescriptor missing `label`, a retired TabKey, a
// className/variant prop on Entity360, onClick on RecordLink, ...), plus 2
// lines that merely NAME the directive in prose (a describe title and a
// docblock) — at the time counted anyway because this ratchet matched by
// raw line content, unable to tell code from prose about code. Not one of
// the 13 is an ignore- or nocheck-style suppression papering over a real
// error. An expect-error is self-policing in a way those are not: an UNUSED
// directive is itself a tsc error, so each of the 13 fails `make typecheck`
// the moment the type it pins stops rejecting the bad shape — they cannot
// rot silently.
//
// Lowered to 13 (Epic 8 close-out, 2026-08-02): `isDirectiveComment` below
// now requires the needle to be the first content of a comment that opens
// on that same line, which structurally excludes both prose mentions (a
// JSDoc continuation line has no comment-opening token of its own; a
// `describe("...")` title is a string literal, not a comment at all) —
// the fix check-suppressions.mjs's own header already asked for instead of
// a permanently inflated budget. Set to the exact surviving count so a
// 14th requires a deliberate decision.
export const TS_SUPPRESSION_BUDGETS = {
  "src/components/admin": 5,
  "src/components/atomic-crm": 13,
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

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

// Non-test-named helper modules living inside these trees (e.g. a `*.ts` a
// suite imports, not a `*.test.ts`/`*.spec.ts` itself) are scanned for skip
// directives too — Task 8's unreachable-db-suite branch can legitimately be
// hoisted into a shared helper there, and file naming alone must not decide
// whether the rule applies.
const TEST_BEARING_TREES = ["supabase/tests", "e2e"];

function isSkipScanTarget(relPath) {
  if (TEST_FILE_PATTERN.test(relPath)) return true;
  return TEST_BEARING_TREES.some(
    (tree) => relPath === tree || relPath.startsWith(`${tree}/`),
  );
}

// The third element marks a pattern as exemptable under the sanctioned
// "throw in CI, skip locally" shape (Task 8, AC-9): only the plain
// `it`/`test`/`describe`.skip("...") calls that shape produces are
// exemptable. `.only`/`.todo`/`.fixme`/`xit`/`xdescribe` never are — they
// signal a different problem (focused or quarantined tests) that Task 8
// does not legitimize.
const SKIP_PATTERNS = [
  [/\bit\.skip\(\s*["'`]/, 'it.skip("...")', true],
  [/\btest\.skip\(\s*["'`]/, 'test.skip("...")', true],
  [/\bdescribe\.skip\(\s*["'`]/, 'describe.skip("...")', true],
  [/\.only\(/, ".only(", false],
  [/\.todo\(/, ".todo(", false],
  [/\.fixme\(/, ".fixme(", false],
  [/\bxit\(/, "xit(", false],
  [/\bxdescribe\(/, "xdescribe(", false],
];

const CI_ENV_CHECK_PATTERN = /process\.env\.CI/;
const THROW_PATTERN = /\bthrow\b/;

/**
 * Task 8's sanctioned shape: `if (process.env.CI) { throw ... }` earlier in
 * the same file, guarding an unconditional `it.skip(...)` that only runs
 * locally when CI is unset. Recognizing this by content — a CI check
 * followed by a throw, both before the skip line — is what lets this guard
 * scan every file in a test-bearing tree without also flagging Task 8's own
 * sanctioned local-dev skip (e.g. supabase/tests/dbSuiteHelpers.ts).
 */
function hasSanctionedCiThrowGuard(lines, skipLineIndex) {
  let sawCiCheck = false;
  for (let i = 0; i < skipLineIndex; i++) {
    if (CI_ENV_CHECK_PATTERN.test(lines[i])) sawCiCheck = true;
    if (sawCiCheck && THROW_PATTERN.test(lines[i])) return true;
  }
  return false;
}

// A line only functions as a real suppression directive if the needle is
// the very first content of a comment that itself OPENS on that line —
// mirroring how ESLint/TypeScript actually parse directive comments: the
// comment node's own text, trimmed, must start with the directive. Text
// merely mentioning the needle elsewhere never counts:
//
//  - a continuation line of an already-open block comment (JSDoc's leading
//    ` * ...` style, e.g. a docstring explaining why a directive was NOT
//    added) has no comment-opening token of its own on that line at all;
//  - a needle inside a string literal (e.g. a `describe("...eslint-disable
//    ...")` title) has no comment-opening token on the line either;
//  - a needle embedded after other prose inside an ALREADY-open `//`
//    comment (a second "//" later on the same line, e.g. a TODO
//    referencing a disable to add "once we enable X") is preceded by the
//    line's *first* "//", not by its own — so it is never the first thing
//    after the comment actually opens.
//
// A genuine directive can still trail other code on the same line (a
// ternary branch's own `// eslint-disable-next-line ...`) — this only
// requires the needle be the first thing *inside its own, freshly-opened*
// comment, not the first thing on the line.
function isDirectiveComment(line, needle) {
  const slashIdx = line.indexOf("//");
  const blockIdx = line.indexOf("/*");
  const openerIdx =
    slashIdx === -1
      ? blockIdx
      : blockIdx === -1
        ? slashIdx
        : Math.min(slashIdx, blockIdx);
  if (openerIdx === -1) return false;
  const afterOpener = line.slice(openerIdx + 2).replace(/^\s+/, "");
  return afterOpener.startsWith(needle);
}

function countOccurrences(lines, needle) {
  return lines.filter((line) => isDirectiveComment(line, needle)).length;
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

/**
 * The Task 8 "throw in CI, skip locally" shape: an `if (process.env.CI)`
 * throw ahead of an unconditional skip call. Matches SKIP_PATTERNS but is
 * exempted by hasSanctionedCiThrowGuard.
 */
export function buildCiGuardedSkip(prefix, suffix, reason) {
  return [
    "if (process.env.CI) {",
    '  throw new Error("unreachable in CI");',
    "}",
    "",
    buildSuffixCall(prefix, suffix, reason),
  ].join("\n");
}

/** Builds a realistic disable-comment line for the suppression-census tests. */
export function buildDisableComment(rule) {
  return `// ${ESLINT_DISABLE_NEEDLE}-next-line ${rule}`;
}

/**
 * A prose MENTION of the disable needle inside a block-comment continuation
 * line (` * ...`) — the exact shape of the false positive Story 8.1's
 * review-fix commit introduced in adminRouteBuilders.tsx (a docstring
 * explaining that an inline directive was deliberately NOT added). Never a
 * real directive: the line has no comment-opening token of its own, so
 * ESLint would never parse it as one either.
 */
export function buildProseMention(reason) {
  return ` * ${reason}, an inline ${ESLINT_DISABLE_NEEDLE} here was not an option.`;
}

/**
 * A real directive that trails other code on the line (a ternary branch's
 * own comment) rather than opening at column 0. Proves the ratchet still
 * counts a genuine directive that isn't the first token on the LINE, only
 * requiring it be the first thing inside its own, freshly-opened comment.
 */
export function buildTrailingDirective(rule) {
  return `  ? ${"//"} ${ESLINT_DISABLE_NEEDLE}-next-line ${rule}`;
}

/**
 * A directive-shaped fragment embedded inside an ALREADY-open `//` comment
 * — a second "//" appearing later on the same line, e.g. a TODO describing
 * a directive to add once some future condition holds. Never functions as
 * a real directive: the whole line, from its first "//", is one comment
 * already, so this text is never the first thing after a comment opens.
 */
export function buildNestedCommentMention(rule) {
  return `  // TODO: later ${"//"} ${ESLINT_DISABLE_NEEDLE}-next-line ${rule}`;
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

    if (isSkipScanTarget(relPath)) {
      lines.forEach((line, index) => {
        for (const [pattern, label, exemptableUnderCiGuard] of SKIP_PATTERNS) {
          if (!pattern.test(line)) continue;
          if (
            exemptableUnderCiGuard &&
            hasSanctionedCiThrowGuard(lines, index)
          ) {
            continue;
          }
          skipViolations.push(
            `${relPath}:${index + 1}: unconditional ${label}`,
          );
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
