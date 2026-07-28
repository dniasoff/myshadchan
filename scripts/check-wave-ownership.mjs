#!/usr/bin/env node
// Machine check for .claude/rules/parallel-ownership.md (the Epic 1
// ownership-collision postmortem: seven parallel agents made incompatible
// relocate/delete decisions on the same branch because nothing reconciled
// their views of who owned what before they wrote).
//
// Two independent modes, run by whoever drives a parallel wave (today: the
// orchestrator/planner) — never by CI, since a CI job runs against an
// already-merged tree with no manifest left to check against:
//
//   pre-dispatch: given a manifest (agent label -> array of path globs),
//   report every pairwise overlap between two agents' declared paths. A
//   non-empty result means the wave must be serialized or re-drawn, not run
//   as-is.
//
//   post-wave: given the same manifest and the set of paths a completed
//   wave's single commit actually touched, report every excursion: a
//   touched path no agent declared ("unowned"), or a declared path that was
//   never touched ("unclaimed").
//
// Both modes share one primitive, `patternsOverlap`: do two path globs (or
// a glob and a literal path — a literal is just a glob with no wildcards)
// have a common match? Getting this permissive in the wrong direction
// (missing a real overlap) defeats the purpose, so it implements real glob
// semantics rather than a substring or prefix heuristic:
//
//   - `**` as a whole path segment matches zero or more entire segments
//     (so it can cross "/"), e.g. "src/foo/**" overlaps "src/foo/bar.ts",
//     and "src/**" overlaps everything under "src".
//   - `*` matches any run of characters (including empty) within a single
//     segment, and may appear anywhere in that segment — "src/*.test.ts"
//     overlaps "src/foo.test.ts".
//
// Two glob patterns overlap when there exists at least one path that both
// would match, which is a language-intersection question, not a
// pattern-vs-literal match in either direction — segmentsOverlap below
// answers it with a small memoized DP rather than a regex, because a
// regex compiled from one pattern can't be tested against a *pattern*
// (only against a concrete string) without first deciding which side is
// "the string", and both sides can be non-literal at once (e.g. two
// agents each declaring a `*`-glob).
import { readFileSync } from "node:fs";

/**
 * Splits a repo-relative path or glob into its "/"-delimited segments.
 * Patterns are expected to be POSIX-style and relative (no leading "/");
 * a leading "./" and a trailing "/" are stripped so "./src/" and "src"
 * compare the same way.
 */
function splitPattern(pattern) {
  return pattern.replace(/^\.\//, "").replace(/\/+$/, "").split("/");
}

/** True once every remaining character is a "*" — i.e. it can still match zero characters. */
function remainderIsAllStars(token, fromIndex) {
  for (let i = fromIndex; i < token.length; i++) {
    if (token[i] !== "*") return false;
  }
  return true;
}

/**
 * Do two single-segment tokens (no "/"), each optionally containing "*"
 * wildcards, share at least one matching string? Modelled as two tiny NFAs
 * — a literal character must be consumed by both sides in lockstep, a "*"
 * may either consume one shared character and stay (self-loop) or step
 * off with no character consumed (epsilon) — walked as a memoized DP over
 * (i, j) position pairs. Every transition strictly advances i, j, or both,
 * so the recursion always terminates; a "*" vs "*" self-loop step is
 * omitted because it revisits the same (i, j) without narrowing anything
 * an epsilon step doesn't already reach.
 */
function segmentsOverlap(tokenA, tokenB) {
  const memo = new Map();

  function canComplete(i, j) {
    const key = `${i},${j}`;
    if (memo.has(key)) return memo.get(key);

    const aDone = i === tokenA.length;
    const bDone = j === tokenB.length;
    let result;

    if (aDone && bDone) {
      result = true;
    } else if (aDone) {
      result = remainderIsAllStars(tokenB, j);
    } else if (bDone) {
      result = remainderIsAllStars(tokenA, i);
    } else {
      const aIsStar = tokenA[i] === "*";
      const bIsStar = tokenB[j] === "*";

      if (aIsStar && !bIsStar) {
        // A's star absorbs tokenB[j] and stays, or exits consuming nothing.
        result = canComplete(i, j + 1) || canComplete(i + 1, j);
      } else if (!aIsStar && bIsStar) {
        result = canComplete(i + 1, j) || canComplete(i, j + 1);
      } else if (aIsStar && bIsStar) {
        // Neither side needs to consume a character to make progress.
        result = canComplete(i + 1, j) || canComplete(i, j + 1);
      } else {
        result = tokenA[i] === tokenB[j] && canComplete(i + 1, j + 1);
      }
    }

    memo.set(key, result);
    return result;
  }

  return canComplete(0, 0);
}

/**
 * Do two arrays of path segments share at least one matching path? A "**"
 * segment matches zero or more whole segments on the other side — peeled
 * off one segment at a time (either side) until one array empties, at
 * which point only "**" entries can still be satisfied for free. Every
 * recursive call removes one segment from one of the two arrays, so the
 * combined length strictly decreases and the recursion terminates.
 */
function segmentArraysOverlap(segsA, segsB) {
  if (segsA.length === 0 && segsB.length === 0) return true;
  if (segsA.length === 0) return segsB.every((seg) => seg === "**");
  if (segsB.length === 0) return segsA.every((seg) => seg === "**");

  const [headA, ...restA] = segsA;
  const [headB, ...restB] = segsB;

  if (headA === "**") {
    return (
      segmentArraysOverlap(restA, segsB) || segmentArraysOverlap(segsA, restB)
    );
  }
  if (headB === "**") {
    return (
      segmentArraysOverlap(segsA, restB) || segmentArraysOverlap(restA, segsB)
    );
  }

  return segmentsOverlap(headA, headB) && segmentArraysOverlap(restA, restB);
}

/**
 * Whether path-glob `patternA` and path-glob `patternB` can both match at
 * least one common path. A concrete, wildcard-free path is just a pattern
 * with no wildcards, so this is also how a touched file is checked against
 * a declared glob — there is only one primitive, used both ways.
 */
export function patternsOverlap(patternA, patternB) {
  return segmentArraysOverlap(splitPattern(patternA), splitPattern(patternB));
}

function assertValidManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error(
      "Manifest must be a JSON object mapping agent label to an array of path globs.",
    );
  }
  for (const [agent, patterns] of Object.entries(manifest)) {
    const isValid =
      Array.isArray(patterns) &&
      patterns.length > 0 &&
      patterns.every((p) => typeof p === "string" && p.length > 0);
    if (!isValid) {
      throw new Error(
        `Manifest entry "${agent}" must be a non-empty array of non-empty path-glob strings.`,
      );
    }
  }
}

/** Reads and validates a manifest JSON file: agent label -> array of path globs. */
export function loadManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertValidManifest(manifest);
  return manifest;
}

/**
 * pre-dispatch: every pairwise overlap between two different agents'
 * declared globs, as human-readable messages (empty when the manifest is
 * pairwise disjoint — safe to dispatch as a parallel wave).
 */
export function runPreDispatchCheck(manifest) {
  const agents = Object.keys(manifest);
  const violations = [];

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const agentA = agents[i];
      const agentB = agents[j];
      for (const patternA of manifest[agentA]) {
        for (const patternB of manifest[agentB]) {
          if (patternsOverlap(patternA, patternB)) {
            violations.push(
              `${agentA} (${patternA}) overlaps ${agentB} (${patternB})`,
            );
          }
        }
      }
    }
  }

  return violations;
}

/**
 * post-wave: reconciles `touchedPaths` (e.g. from
 * `git diff --name-only <base>..HEAD`) against `manifest`. Returns the two
 * excursion kinds separately since they call for different follow-up —
 * `unowned` means the manifest missed a real dependency (fix before the
 * next wave), `unclaimed` means it over-declared (safe, but worth
 * tightening).
 */
export function runPostWaveCheck(manifest, touchedPaths) {
  const entries = Object.entries(manifest);
  const unowned = [];
  const unclaimed = [];

  for (const touched of touchedPaths) {
    const hasOwner = entries.some(([, patterns]) =>
      patterns.some((pattern) => patternsOverlap(pattern, touched)),
    );
    if (!hasOwner) {
      unowned.push(`${touched} was touched but is not declared by any agent`);
    }
  }

  for (const [agent, patterns] of entries) {
    for (const pattern of patterns) {
      const wasTouched = touchedPaths.some((touched) =>
        patternsOverlap(pattern, touched),
      );
      if (!wasTouched) {
        unclaimed.push(
          `${agent} declared "${pattern}" but it was never touched`,
        );
      }
    }
  }

  return { unowned, unclaimed };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readTouchedPaths(filePath) {
  const raw = filePath
    ? readFileSync(filePath, "utf8")
    : readFileSync(0, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function printUsage() {
  console.error(
    [
      "Usage:",
      "  node scripts/check-wave-ownership.mjs pre-dispatch <manifest.json>",
      "  node scripts/check-wave-ownership.mjs post-wave <manifest.json> [touched-paths-file]",
      "",
      "post-wave reads newline-separated touched paths from the given file, or",
      "from stdin when that argument is omitted — pipe in the output of",
      "`git diff --name-only <base>..HEAD`.",
    ].join("\n"),
  );
}

function main() {
  const [, , mode, manifestPath, touchedPathsFile] = process.argv;

  if ((mode !== "pre-dispatch" && mode !== "post-wave") || !manifestPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const manifest = loadManifest(manifestPath);

    if (mode === "pre-dispatch") {
      const violations = runPreDispatchCheck(manifest);
      if (violations.length > 0) {
        console.error(
          "Wave-ownership guard failed — overlapping declarations:\n",
        );
        for (const violation of violations) console.error(`  - ${violation}`);
        process.exitCode = 1;
        return;
      }
      console.log("Wave-ownership guard OK — manifest is pairwise disjoint.");
      return;
    }

    const touchedPaths = readTouchedPaths(touchedPathsFile);
    const { unowned, unclaimed } = runPostWaveCheck(manifest, touchedPaths);

    if (unowned.length === 0 && unclaimed.length === 0) {
      console.log(
        "Wave-ownership guard OK — touched files match the manifest exactly.",
      );
      return;
    }

    console.error("Wave-ownership guard found excursions:\n");
    for (const message of unowned) console.error(`  - UNOWNED: ${message}`);
    for (const message of unclaimed) console.error(`  - UNCLAIMED: ${message}`);
    process.exitCode = 1;
  } catch (error) {
    console.error(`Wave-ownership guard error: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
