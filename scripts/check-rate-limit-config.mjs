#!/usr/bin/env node
// External review Finding 4 (2026-08-06): the numbers Cloudflare actually
// enforces for the `ai`/`parse` Workers' rate limiters live ENTIRELY in the
// `[[ratelimits]]` blocks of workers/parse/wrangler.toml and
// workers/ai/wrangler.toml — `RateLimitConfig.limit`
// (workers/shared/rateLimit.ts) is never read at runtime by anything (only
// `.periodSeconds`, to compute the `Retry-After` header). The two numbers
// can drift apart silently: every existing rateLimit.test.ts case exercises
// the TypeScript side alone, against a fabricated `TEST_CONFIG` fixture that
// is not connected to either wrangler.toml. This guard reads all three
// sources of truth and fails loudly the moment any two disagree, instead of
// trusting either to stay in sync with the others by hand.
//
// Three files/locations, three roles:
//   - workers/shared/rateLimit.ts     — the named `RateLimitConfig` exports
//                                        (what the app code THINKS the limit is).
//   - workers/{parse,ai}/wrangler.toml — the `[[ratelimits]]` bindings
//                                        (what Cloudflare ACTUALLY enforces).
//   - every non-test .ts file under    — wherever `createRateLimitMiddleware`
//     workers/{parse,ai}/                is actually called says which config
//                                        export is wired to which binding name
//                                        (its `config:`/`getBinding:` pair).
//                                        Read-only here — this script never
//                                        edits application code.
//
// Layout robustness (2026-08-06, Finding 4 repair round 2): this guard used
// to hardcode a single `indexTs` file per worker. That broke silently the
// first time a worker's route file was split — `workers/parse/index.ts`'s
// two `createRateLimitMiddleware` calls moved to the new
// `workers/parse/registerParseMiddleware.ts`, and the guard exited 1 against
// the real tree ("found no createRateLimitMiddleware(...) call") even though
// nothing was actually wrong. Naming a second file would only move the same
// failure to the NEXT split. Instead, this guard scans every non-test
// TypeScript source file directly under a worker's own directory (recursing
// into subdirectories, skipping build/dependency directories) and aggregates
// every `createRateLimitMiddleware` call it finds across all of them,
// wherever the wiring happens to live. A future file split cannot break this
// on its own — the guard only breaks if a worker directory has NO
// `createRateLimitMiddleware` call in ANY of its source files, which is
// exactly the "wiring genuinely can't be found" case this guard must fail
// loudly on, not silently pass.
//
// This is a targeted, single-purpose reader for this repo's own hand-authored
// `[[ratelimits]]` table-array syntax — not a general TOML parser (no such
// dependency exists in this repo, and both files are small and stable in one
// narrow shape). If either wrangler.toml's shape changes enough that this
// parser stops matching, `runRateLimitConfigCheck` reports that explicitly
// (see the "found no createRateLimitMiddleware(...) call" / missing-binding
// branches below) rather than silently passing with nothing checked.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const WORKERS = [
  {
    worker: "parse",
    wranglerToml: "workers/parse/wrangler.toml",
    workerDir: "workers/parse",
  },
  {
    worker: "ai",
    wranglerToml: "workers/ai/wrangler.toml",
    workerDir: "workers/ai",
  },
];

const RATE_LIMIT_TS = "workers/shared/rateLimit.ts";

// Directories that can legitimately exist under a worker directory but never
// contain hand-authored wiring source: build output, dependency caches, VCS
// metadata. Skipping these keeps the scan fast and keeps generated/bundled
// code (which can contain its own copies of matching strings) from being
// read as if it were the source of truth.
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".wrangler",
  "dist",
  ".git",
]);

/**
 * Recursively collects every non-test TypeScript source file under `dir`,
 * skipping build/dependency directories and `.d.ts` ambient declaration
 * files. This is what makes the guard layout-robust: it does not need to be
 * told which file inside a worker's directory wires up
 * `createRateLimitMiddleware` — it reads all of them.
 */
export function collectWorkerSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectWorkerSourceFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    files.push(full);
  }
  return files.sort();
}

/**
 * Parses every `[[ratelimits]]` block in one of this repo's wrangler.toml
 * files into `{ name, limit, period }`. Matches from each `[[ratelimits]]`
 * header up to (but not including) the next `[` — safe for this format
 * specifically because none of its values themselves contain `[`.
 */
export function parseWranglerRatelimits(text) {
  const blocks = text.match(/\[\[ratelimits\]\][^[]*/g) ?? [];
  return blocks.map((block) => {
    const name = block.match(/name\s*=\s*"([^"]+)"/)?.[1];
    const simple = block.match(
      /simple\s*=\s*\{\s*limit\s*=\s*(\d+)\s*,\s*period\s*=\s*(\d+)\s*\}/,
    );
    return {
      name,
      limit: simple ? Number(simple[1]) : undefined,
      period: simple ? Number(simple[2]) : undefined,
    };
  });
}

/**
 * Parses every `export const NAME: RateLimitConfig = { limit: N,
 * periodSeconds: M }` declaration in workers/shared/rateLimit.ts into a
 * `{ [name]: { limit, periodSeconds } }` map.
 */
export function parseRateLimitConfigs(text) {
  const configs = {};
  const re = /export const (\w+): RateLimitConfig = \{([\s\S]*?)\};/g;
  for (const match of text.matchAll(re)) {
    const [, name, body] = match;
    const limit = body.match(/limit:\s*(\d+)/)?.[1];
    const periodSeconds = body.match(/periodSeconds:\s*(\d+)/)?.[1];
    configs[name] = {
      limit: limit === undefined ? undefined : Number(limit),
      periodSeconds:
        periodSeconds === undefined ? undefined : Number(periodSeconds),
    };
  }
  return configs;
}

/**
 * Parses every `createRateLimitMiddleware<...>({ ... })` call in a chunk of
 * TypeScript source, returning the (config export name, binding field name)
 * pair each one wires together — the only place that mapping is declared at
 * all. Caller-agnostic: `runRateLimitConfigCheck` calls this once per source
 * file it scans under a worker's directory, wherever that file happens to
 * live. Non-greedy up to the first `})`, which is safe here because none of
 * these call bodies nest a `{`/`}` of their own (single-expression arrow
 * functions only) — verified against the real files, not assumed.
 */
export function parseMiddlewareWiring(text) {
  const wiring = [];
  const re = /createRateLimitMiddleware<[^>]*>\(\{([\s\S]*?)\}\)/g;
  for (const match of text.matchAll(re)) {
    const body = match[1];
    const configName = body.match(/config:\s*(\w+)/)?.[1];
    const bindingName = body.match(
      /getBinding:\s*\(env\)\s*=>\s*env\.(\w+)/,
    )?.[1];
    if (configName && bindingName) {
      wiring.push({ configName, bindingName });
    }
  }
  return wiring;
}

/**
 * Runs the full cross-check against a repo root, returning a list of
 * human-readable failure messages (empty when every wired limiter agrees
 * across all three sources).
 */
export function runRateLimitConfigCheck(repoRoot) {
  const failures = [];
  const rateLimitConfigs = parseRateLimitConfigs(
    readFileSync(path.join(repoRoot, RATE_LIMIT_TS), "utf8"),
  );

  for (const { worker, wranglerToml, workerDir } of WORKERS) {
    const ratelimits = parseWranglerRatelimits(
      readFileSync(path.join(repoRoot, wranglerToml), "utf8"),
    );

    const absoluteWorkerDir = path.join(repoRoot, workerDir);
    const sourceFiles = collectWorkerSourceFiles(absoluteWorkerDir);
    const wiring = sourceFiles.flatMap((absoluteFile) => {
      const relativeFile = path.relative(repoRoot, absoluteFile);
      return parseMiddlewareWiring(readFileSync(absoluteFile, "utf8")).map(
        (entry) => ({ ...entry, file: relativeFile }),
      );
    });

    if (wiring.length === 0) {
      failures.push(
        `${workerDir}/: found no createRateLimitMiddleware(...) call in any non-test .ts file under this directory — this guard could not verify anything for "${worker}". Either the middleware wiring moved outside ${workerDir}/ (update this script's WORKERS list), the call shape changed (update this script's parseMiddlewareWiring), or rate limiting was removed entirely (update this script's WORKERS list).`,
      );
      continue;
    }

    for (const { configName, bindingName, file } of wiring) {
      const config = rateLimitConfigs[configName];
      if (!config) {
        failures.push(
          `${file} references config "${configName}", which is not an exported RateLimitConfig in ${RATE_LIMIT_TS}.`,
        );
        continue;
      }
      const binding = ratelimits.find((r) => r.name === bindingName);
      if (!binding) {
        failures.push(
          `${file} wires "${configName}" to binding "${bindingName}", but ${wranglerToml} declares no [[ratelimits]] block named "${bindingName}".`,
        );
        continue;
      }
      if (binding.limit !== config.limit) {
        failures.push(
          `${worker}/${bindingName}: ${wranglerToml} declares limit=${binding.limit} (what Cloudflare enforces), but ${RATE_LIMIT_TS}'s ${configName}.limit=${config.limit} (what the app code believes, wired in ${file}) — these must match.`,
        );
      }
      if (binding.period !== config.periodSeconds) {
        failures.push(
          `${worker}/${bindingName}: ${wranglerToml} declares period=${binding.period} (what Cloudflare enforces), but ${RATE_LIMIT_TS}'s ${configName}.periodSeconds=${config.periodSeconds} (what drives the Retry-After header, wired in ${file}) — these must match.`,
        );
      }
    }
  }

  return failures;
}

function main() {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  const failures = runRateLimitConfigCheck(repoRoot);

  if (failures.length > 0) {
    console.error("Rate-limit config check failed:\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Rate-limit config check OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
