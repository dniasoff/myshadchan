// Shared file-tree walker for the two CI guards (check-suppressions.mjs,
// check-retired-names.mjs). Both need the same thing: every source file
// under a fixed set of top-level directories, skipping vendored/build
// output. Kept here once (DRY) instead of duplicated in both scripts.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".supabase-e2e",
]);

function walk(dir, extensions, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, files);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
}

/**
 * Collects every file under `dirs` (relative to `scanRoot`) whose extension
 * is in `extensions`. An entry in `dirs` may also be a single file path
 * (e.g. "supabase/seed.sql") — it's included unconditionally, regardless of
 * extension, since the caller named it explicitly. Missing paths are
 * skipped rather than throwing, so a guard's own unit test can point this at
 * a minimal temp fixture that only creates the trees it needs.
 *
 * @param {string} scanRoot
 * @param {string[]} dirs - directories or file paths relative to scanRoot
 * @param {string[]} extensions - file extensions to include, e.g. [".ts", ".mjs"]
 * @returns {string[]} absolute file paths
 */
export function collectFiles(scanRoot, dirs, extensions) {
  const extensionSet = new Set(extensions);
  const files = [];
  for (const dir of dirs) {
    const full = path.join(scanRoot, dir);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // Path doesn't exist in this tree — nothing to scan.
    }
    if (stat.isFile()) {
      files.push(full);
    } else if (stat.isDirectory()) {
      walk(full, extensionSet, files);
    }
  }
  return files;
}

/** Relative, forward-slash path — stable across platforms for matching. */
export function toRelPath(scanRoot, absPath) {
  return path.relative(scanRoot, absPath).split(path.sep).join("/");
}
