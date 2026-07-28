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
// pre-dispatch additionally runs two narrower checks that close gaps a plain
// pairwise comparison leaves open (see the rule's "Known limitations"):
// declared order-dependence (an `after` entry means the wave is not parallel
// at all) and shared-artifact contention (two agents editing paths that feed
// the same generated file — e.g. `registry.json` — which neither declares).
//
// What none of this covers is worth stating where the code is: it detects
// PATH collision only. Path-disjointness does not imply
// mechanism-compatibility — Epic 3's stories 3-2 and 3-12 built incompatible
// routing mechanisms in genuinely different files and this script prints OK
// on that wave. That class is caught by the cross-reconciliation pass the
// rule requires, which is a reasoning pass and deliberately not a script.
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

/**
 * A manifest entry is either a bare array of path globs, or an object
 * `{ paths: [...], after: [...] }` where `after` names the agents that must
 * land first. Both forms normalize to the object shape so every check below
 * reads one thing.
 */
function normalizeEntry(entry) {
  return Array.isArray(entry)
    ? { paths: entry, after: [] }
    : { paths: entry?.paths, after: entry?.after ?? [] };
}

/** `[agent, { paths, after }]` pairs, whatever form the manifest was written in. */
function normalizedEntries(manifest) {
  return Object.entries(manifest).map(([agent, entry]) => [
    agent,
    normalizeEntry(entry),
  ]);
}

function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
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

  const agents = Object.keys(manifest);

  for (const [agent, entry] of normalizedEntries(manifest)) {
    if (!isNonEmptyStringArray(entry.paths)) {
      throw new Error(
        `Manifest entry "${agent}" must be a non-empty array of non-empty path-glob strings, or an object with such an array as "paths".`,
      );
    }
    if (!Array.isArray(entry.after)) {
      throw new Error(
        `Manifest entry "${agent}" has an "after" field that is not an array of agent labels.`,
      );
    }
    for (const predecessor of entry.after) {
      if (predecessor === agent) {
        throw new Error(`Manifest entry "${agent}" lists itself in "after".`);
      }
      if (!agents.includes(predecessor)) {
        throw new Error(
          `Manifest entry "${agent}" lists unknown agent "${predecessor}" in "after".`,
        );
      }
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
 * Files this repo rewrites as a *side effect* of editing something else. A
 * manifest can be perfectly pairwise disjoint and still have two agents
 * clobbering one of these — `{A: singles/**, B: shadchanim/**}` is disjoint,
 * yet `registry.json` indexes both directories and `.husky/pre-commit` runs
 * `make registry-gen`, so both agents' commits rewrite it. In Epic 1
 * `registry.json` was the most-contended file in the wave (5 of 6 stories)
 * and no story declared it.
 *
 * `feeders` are the paths whose modification drags the artifact along. The
 * i18n catalogues are hand-maintained rather than generated, but behave the
 * same way: every wave that adds user-facing copy converges on them.
 */
export const SHARED_ARTIFACTS = [
  {
    artifact: "registry.json",
    regeneratedBy: "make registry-gen, run by .husky/pre-commit",
    feeders: [
      "src/components/atomic-crm/**",
      "src/components/supabase/**",
      "src/hooks/**",
      "src/lib/**",
      "CHANGELOG.md",
    ],
  },
  {
    artifact: "package-lock.json",
    regeneratedBy: "npm install",
    feeders: ["package.json"],
  },
  {
    artifact: "supabase/migrations/**",
    regeneratedBy: "npx supabase db diff --local",
    feeders: ["supabase/schemas/**"],
  },
  {
    artifact:
      "src/components/atomic-crm/providers/commons/englishCrmMessages.ts",
    regeneratedBy: "hand-maintained catalogue every user-facing label lands in",
    feeders: [
      "src/components/atomic-crm/**/*.tsx",
      "src/components/admin/**/*.tsx",
    ],
  },
  {
    artifact:
      "src/components/atomic-crm/providers/commons/frenchCrmMessages.ts",
    regeneratedBy: "hand-maintained catalogue every user-facing label lands in",
    feeders: [
      "src/components/atomic-crm/**/*.tsx",
      "src/components/admin/**/*.tsx",
    ],
  },
];

/** Agent labels whose declared paths can match at least one of `targets`. */
function agentsMatching(manifest, targets) {
  return normalizedEntries(manifest)
    .filter(([, entry]) =>
      entry.paths.some((declared) =>
        targets.some((target) => patternsOverlap(declared, target)),
      ),
    )
    .map(([agent]) => agent);
}

/**
 * pre-dispatch (warning tier): shared artifacts that two or more agents will
 * rewrite as a side effect but nobody declared. Silenced by giving the
 * artifact to exactly one agent — two agents declaring it is an ordinary
 * overlap, caught by `runPreDispatchCheck` instead.
 */
export function runSharedArtifactCheck(manifest, artifacts = SHARED_ARTIFACTS) {
  const warnings = [];

  for (const { artifact, regeneratedBy, feeders } of artifacts) {
    if (agentsMatching(manifest, [artifact]).length > 0) continue;

    const feeding = agentsMatching(manifest, feeders);
    if (feeding.length < 2) continue;

    warnings.push(
      `${feeding.join(", ")} declare paths that feed ${artifact} (${regeneratedBy}), which no agent declares — give it exactly one owner`,
    );
  }

  return warnings;
}

/**
 * pre-dispatch (failing tier): declared order-dependence. Disjoint is not the
 * same as independent — Epic 1 had an ordering blocker between two stories
 * whose paths never touched — so an `after` entry disqualifies the wave from
 * running in parallel at all, however clean its paths are.
 */
export function runOrderingCheck(manifest) {
  return normalizedEntries(manifest)
    .filter(([, entry]) => entry.after.length > 0)
    .map(
      ([agent, entry]) =>
        `${agent} declares it must run after ${entry.after.join(", ")} — an order-dependent wave is not a parallel wave`,
    );
}

/**
 * pre-dispatch: every pairwise overlap between two different agents'
 * declared globs, as human-readable messages (empty when the manifest is
 * pairwise disjoint — necessary, but not sufficient, to dispatch as a
 * parallel wave; see the rule's "What a green check does and does not mean").
 */
export function runPreDispatchCheck(manifest) {
  const entries = normalizedEntries(manifest);
  const violations = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [agentA, entryA] = entries[i];
      const [agentB, entryB] = entries[j];
      for (const patternA of entryA.paths) {
        for (const patternB of entryB.paths) {
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
  const entries = normalizedEntries(manifest);
  const unowned = [];
  const unclaimed = [];

  for (const touched of touchedPaths) {
    const hasOwner = entries.some(([, entry]) =>
      entry.paths.some((pattern) => patternsOverlap(pattern, touched)),
    );
    if (!hasOwner) {
      unowned.push(`${touched} was touched but is not declared by any agent`);
    }
  }

  for (const [agent, entry] of entries) {
    for (const pattern of entry.paths) {
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
      const violations = [
        ...runPreDispatchCheck(manifest),
        ...runOrderingCheck(manifest),
      ];
      const warnings = runSharedArtifactCheck(manifest);

      for (const warning of warnings) console.error(`  ! WARNING: ${warning}`);

      if (violations.length > 0) {
        console.error("Wave-ownership guard failed:\n");
        for (const violation of violations) console.error(`  - ${violation}`);
        process.exitCode = 1;
        return;
      }

      console.log(
        warnings.length > 0
          ? `Wave-ownership guard: manifest is pairwise disjoint, but ${warnings.length} shared artifact(s) have no owner (see WARNING above). Path-disjointness does not imply mechanism-compatibility — the cross-reconciliation pass is still required.`
          : "Wave-ownership guard OK — manifest is pairwise disjoint. Path-disjointness does not imply mechanism-compatibility — the cross-reconciliation pass is still required.",
      );
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
