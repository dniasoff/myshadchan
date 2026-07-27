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

function lineIsExempt(line, exempt) {
  return Boolean(exempt) && exempt.some((term) => line.includes(term));
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
        if (!pattern.compiled.test(line)) continue;
        if (lineIsExempt(line, pattern.exempt)) continue;
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
