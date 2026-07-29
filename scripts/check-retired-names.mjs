#!/usr/bin/env node
// CI guard for AD-23 ("CI fails on a reference to a retired name") — Story
// 1.6 AC-12. Every pattern and every allowlist entry is read from
// retired-names.json (the one shared artifact both this guard and Story
// 1.1's fossil-word gate consume); nothing is duplicated here.
//
// This module must never spell out a retired identifier itself: unlike
// retired-names.json (exempted by exact path because it has to name what it
// forbids), this file is scanned by its own repo-wide run like everything
// else under scripts/, so every retired word it "knows about" only ever
// exists as data loaded from the JSON at runtime.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, toRelPath } from "./fsScan.mjs";

const DEFAULT_CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "retired-names.json",
);

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function isAllowlisted(relPath, config) {
  if (config.exactFileAllowlist.includes(relPath)) return true;
  return config.excludeDirs.some(
    (dir) => relPath === dir || relPath.startsWith(`${dir}/`),
  );
}

/**
 * Blanks every exempt term out of `line`, so a pattern can be re-tested
 * against only the text its exemptions do NOT account for.
 *
 * This replaced a whole-line test (`exempt.some((t) => line.includes(t))`),
 * which exempted the ENTIRE line the moment any exempt term appeared
 * anywhere on it. A genuine fossil that merely shared a line with an exempt
 * term was therefore masked — `<Slot asChild /> // <fossil>` passed. The
 * exemptions are per-term, not per-line; this makes the code say so.
 *
 * Three properties this function has to hold, each load-bearing:
 *
 *  - **Blank to a space, never to the empty string.** Deleting a term
 *    splices the characters either side of it together, which can
 *    manufacture a match that was never in the source — most obviously for
 *    the exemptions that are ordinary English words merely *containing* a
 *    retired stem: drop such a word from between two innocent fragments and
 *    they fuse into the stem itself. A false positive is the one failure a
 *    guard must not have — it turns CI red on innocent code and teaches
 *    people to weaken the guard. A space cannot join anything.
 *  - **Longest term first.** When one exempt term contains another
 *    (`Children.forEach` vs `React.Children`), the most specific one must
 *    be consumed first so no partial residue is left for the pattern.
 *  - **Case-SENSITIVE**, exactly as `includes()` was — even for the
 *    case-insensitive patterns. Matching case-insensitively here would
 *    exempt *more* than the previous rule did, and this change is only ever
 *    allowed to exempt less.
 */
function stripExemptTerms(line, exempt) {
  if (!exempt || exempt.length === 0) return line;
  return [...exempt]
    .sort((a, b) => b.length - a.length)
    .reduce((text, term) => (term ? text.split(term).join(" ") : text), line);
}

/**
 * Scans `scanRoot` per `config` (defaults to the committed retired-names.json)
 * and returns human-readable violation messages — empty when clean. None of
 * the configured patterns use the "g" flag, so a fresh RegExp per pattern
 * has no cross-line state to worry about.
 */
export function runRetiredNameCheck(scanRoot, config = loadConfig()) {
  const files = collectFiles(scanRoot, config.scanPaths, config.extensions);
  const patterns = config.patterns.map((def) => ({
    ...def,
    compiled: new RegExp(def.regex, def.flags ?? ""),
  }));
  const violations = [];

  for (const file of files) {
    const relPath = toRelPath(scanRoot, file);
    if (isAllowlisted(relPath, config)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        // Cheap gate first: the overwhelming majority of lines match
        // nothing, and those never pay for the exempt-term strip.
        if (!pattern.compiled.test(line)) continue;
        // Then re-test only what the exemptions do not cover. An exemption
        // excuses its own term, not everything that happens to share a line
        // with it.
        if (!pattern.compiled.test(stripExemptTerms(line, pattern.exempt)))
          continue;
        violations.push(`${relPath}:${index + 1}: matches "${pattern.id}"`);
      }
    });
  }

  return violations;
}

function main() {
  const scanRoot = path.resolve(process.argv[2] ?? process.cwd());
  const violations = runRetiredNameCheck(scanRoot);

  if (violations.length > 0) {
    console.error("Retired-name guard failed:\n");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log("Retired-name guard OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
