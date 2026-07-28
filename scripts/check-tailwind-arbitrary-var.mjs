#!/usr/bin/env node
// CI guard for the Tailwind v3 -> v4 "bare custom-property arbitrary value"
// bug (ui-audit-plan.md S1 / G1). `-[--foo]` was valid Tailwind v3 shorthand
// for `var(--foo)`; Tailwind v4 does not compile it — the bracket's content
// resolves to the literal string `--foo`, which is not a valid CSS value on
// its own, so the whole declaration is dropped. Nothing errors: eslint,
// tsc, vitest and the production build all stay green while the surface
// silently loses its background, border or easing. The v3-trained instinct
// looks exactly like working code, which is why this needs a permanent gate
// rather than a one-time sweep.
//
// The fix is either the v4 parenthesis shorthand (`-(--foo)`) or an
// explicit `var()` wrapper (`-[var(--foo)]`) — both compile.
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectFiles, toRelPath } from "./fsScan.mjs";

const SCAN_DIRS = ["src"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// Matches an arbitrary-value bracket whose entire content is a bare custom
// property: `-[--identifier]`. The identifier's character class excludes
// "(", so this deliberately does NOT match a genuine v4 theme function call
// like `gap-[--spacing(var(--gap))]` (ui/toggle-group.tsx) — there the "("
// right after the identifier means the match can never reach the closing
// "]" this pattern requires immediately after the identifier. It also does
// not match either fixed form, `-[var(--foo)]` or `-(--foo)`.
const BARE_VAR_PATTERN = /-\[--[a-zA-Z0-9_-]+\]/g;

// Pre-existing violations inside files frozen by the Epic 3 concurrency
// freeze at the time this guard was added (ui-audit-plan.md S1's 6 deferred
// sites, minus one already covered by a v4 theme function and not a
// violation). Keyed by file + matched fragment rather than line number:
// these files are mid-rewrite by an unrelated, actively-committing story
// (line numbers already drifted once between this guard being written and
// its first CI run), and a line-keyed entry would silently stop exempting
// the known violation on the next unrelated edit, breaking the build for
// everyone rather than for the file that earned the debt. This list must
// only shrink: remove an entry the moment its file unfreezes and the syntax
// is fixed there. Never add an entry to silence a newly introduced
// violation — fix the source instead.
export const KNOWN_FROZEN_VIOLATIONS = new Set([
  "src/components/atomic-crm/layout/MobileNavigation.tsx::-[--glass-border]",
  "src/components/atomic-crm/layout/MobileNavigation.tsx::-[--glass-bg]",
  "src/components/atomic-crm/layout/MobileNavigation.tsx::-[--ease-spring]",
  "src/components/atomic-crm/dashboard/DashboardStat.tsx::-[--ease-out]",
  "src/components/atomic-crm/references/ReferenceList.tsx::-[--ease-out]",
  "src/components/atomic-crm/singles/SingleList.tsx::-[--ease-spring]",
]);

function suggestFix(match) {
  // "-[--glass-bg]" -> "-[var(--glass-bg)]"
  const varWrapped = match.replace("-[--", "-[var(--").replace(/\]$/, ")]");
  // "-[--glass-bg]" -> "-(--glass-bg)"
  const shorthand = match.replace("-[--", "-(--").replace(/\]$/, ")");
  return `${shorthand}" or "${varWrapped}`;
}

/**
 * Scans `scanRoot`'s `src/` tree for the v3-syntax bug and returns
 * human-readable violation messages — empty when clean. `knownViolations`
 * defaults to this repo's tracked, shrinking allowlist of pre-existing
 * hits in frozen files; a caller's own test passes an isolated set instead.
 */
export function runTailwindArbitraryVarCheck(
  scanRoot,
  knownViolations = KNOWN_FROZEN_VIOLATIONS,
) {
  const files = collectFiles(scanRoot, SCAN_DIRS, EXTENSIONS);
  const violations = [];

  for (const file of files) {
    const relPath = toRelPath(scanRoot, file);
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const matches = line.match(BARE_VAR_PATTERN);
      if (!matches) return;

      for (const match of matches) {
        if (knownViolations.has(`${relPath}::${match}`)) continue;
        violations.push(
          `${relPath}:${lineNumber}: "${match}" is Tailwind v3 syntax — v4 ` +
            `does not compile a bare custom property inside brackets and ` +
            `silently drops the declaration. Use "${suggestFix(match)}" instead.`,
        );
      }
    });
  }

  return violations;
}

function main() {
  const scanRoot = path.resolve(process.argv[2] ?? process.cwd());
  const violations = runTailwindArbitraryVarCheck(scanRoot);

  if (violations.length > 0) {
    console.error("Tailwind arbitrary-value guard failed:\n");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log("Tailwind arbitrary-value guard OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
