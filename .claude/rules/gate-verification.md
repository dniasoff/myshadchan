# Verifying a Red Gate Before Calling It Pre-existing

## The rule

If a required gate — a CI guard script, `make lint`, `make typecheck`,
`make build`, a test suite, a migration-safety check, anything the merge
pipeline depends on — is red, and you are about to write down (in a Dev
Agent Record, a commit message, a PR description, or a message to another
agent) that the failure is **"pre-existing"** or **"unrelated to this
change"**: prove it first. Do not infer it from the diff, from
`git status`, from `git stash` against your own branch's prior commit, or
from "this file isn't in my declared scope."

None of those checks the one thing that actually matters: whether the gate
is red on the base commit the change branched from. A shared config file,
a scanner's word list, a suppression budget, or a fossil-name pattern can
regress from a change that looks completely unrelated on the surface — the
diff not touching "that kind of file" is not evidence.

## Why this is here

Epic 8's Story 8.1 review-fix commit (`9cf8e13`) introduced two guard
regressions in `adminRouteBuilders.tsx` (a `check-retired-names.mjs` false
positive and a `check-suppressions.mjs` budget overage) as a side effect of
an unrelated refactor. Stories 8.2, 8.3, 8.4, and 8.5 each hit the same two
red guards, each independently reasoned "not in my declared scope" /
"`git stash` shows it's not my uncommitted change" / "`git status` shows no
diff on that file", and each wrote **"pre-existing on `main`, unrelated"**
into its own Dev Agent Record as a stated fact. None of the four actually
checked the gate against `main`. The verifier disproved it in minutes by
running both guards against `git archive 8f44493` (the real pre-Epic-8
base) and finding them clean — the regression was self-inflicted, four
stories old, and had ridden along undetected right up to the deploy gate.
That's the concrete cost of skipping this check: one shared false
assumption, repeated four times, blocking a deploy at the end of an epic
instead of getting caught (and fixed, one line, in one story) at 8.2.

## How — exact command shape

Never open a worktree on the current tree to check out the base commit —
that mutates shared, possibly-dirty state and can race with other agents
working the same repo. Extract a clean, disposable snapshot instead:

```bash
BASE_SHA=<the commit your work branched from, e.g. origin/main's HEAD>
SCRATCH=$(mktemp -d)
git archive "$BASE_SHA" | tar -x -C "$SCRATCH"

# Run the exact failing gate against the snapshot, not your working tree:
node "$SCRATCH/scripts/check-retired-names.mjs" "$SCRATCH"
node "$SCRATCH/scripts/check-suppressions.mjs" "$SCRATCH"
# ...or the equivalent for whatever gate is red (lint, typecheck, a test file).

rm -rf "$SCRATCH"
```

- **Clean on `$BASE_SHA`, red on your branch** → the regression is yours (or
  an earlier story's on this same branch/epic) — not pre-existing. Fix it,
  or if it is truly out of scope for the ticket in front of you, say so
  explicitly and flag it for whoever owns the file, rather than deferring
  four times in a row.
- **Also red on `$BASE_SHA`** → now it is genuinely pre-existing, and you
  can write that down — with the command's output as the evidence, not a
  hunch.

## When this applies

Any time all three of these hold:

1. A required gate is observed red.
2. You are forming a belief that the failure predates your change.
3. That belief is about to be recorded anywhere as a stated fact rather
   than a hypothesis — a Dev Agent Record, a commit message, a PR
   description, or a message relied on by another agent's own decision.

A `git stash` / `git status` check against your own branch's history is
not a substitute for step 3's evidence — it only proves the failure isn't
*your uncommitted diff*, which is a much weaker claim than "pre-existing on
`main`."
