#!/usr/bin/env node
// CI guard for AD-24's one route convention (Story 3.12 AC 6). Every pattern
// and every allowlist entry is read from route-convention.json; nothing is
// duplicated here. Modelled line-for-line on check-retired-names.mjs, with
// one structural difference: an allowlist entry here exempts a file from
// exactly ONE named pattern, not from every pattern the way that guard's
// file-level `exactFileAllowlist` does — the three admin-kit buttons that
// keep one `useCreatePath` fallback call each are still checked against
// `create-path-literal` and `redirect-to-show`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, toRelPath } from "./fsScan.mjs";

const DEFAULT_CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "route-convention.json",
);

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function isExcludedDir(relPath, config) {
  return config.excludeDirs.some(
    (dir) => relPath === dir || relPath.startsWith(`${dir}/`),
  );
}

function isAllowlistedForPattern(relPath, pattern) {
  return (pattern.allowlistedFiles ?? []).includes(relPath);
}

/**
 * Scans `scanRoot` per `config` (defaults to the committed
 * route-convention.json) and returns human-readable violation messages —
 * empty when clean. None of the configured patterns use the "g" flag, so a
 * fresh RegExp per pattern has no cross-line state to worry about.
 */
export function runRouteConventionCheck(scanRoot, config = loadConfig()) {
  const files = collectFiles(scanRoot, config.scanPaths, config.extensions);
  const patterns = config.patterns.map((def) => ({
    ...def,
    compiled: new RegExp(def.regex, def.flags ?? ""),
  }));
  const violations = [];

  for (const file of files) {
    const relPath = toRelPath(scanRoot, file);
    if (isExcludedDir(relPath, config)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (isAllowlistedForPattern(relPath, pattern)) continue;
        if (!pattern.compiled.test(line)) continue;
        violations.push(`${relPath}:${index + 1}: matches "${pattern.id}"`);
      }
    });
  }

  return violations;
}

function main() {
  const scanRoot = path.resolve(process.argv[2] ?? process.cwd());
  const violations = runRouteConventionCheck(scanRoot);

  if (violations.length > 0) {
    console.error("Route-convention guard failed:\n");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log("Route-convention guard OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
