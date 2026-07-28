# Parallel Ownership

Parallel agent waves fail in one specific shape: two or more agents each
hold a locally-correct view of who owns what, and nothing reconciles
those views before they write. During Epic 1, seven agents dispatched in
parallel made incompatible ownership moves — several independently
relocated or deleted the same modules, each correct in isolation. Story
1.1 ended unable to typecheck because another agent had moved code it
depended on. Recovery meant serializing the whole round and re-deciding
ownership by hand. It recurred in weaker forms since: Epic 3's story
refresh produced two stories (3-2 and 3-12) that both owned the routing
work with incompatible mechanisms; three separate times a ruling landed
on a contract file but not on the story files describing the same
mechanism, because different agents owned each.

Being careful has not fixed this. This rule makes the failure
structurally detectable instead.

## No parallel dispatch without a declared manifest

Before a wave of parallel agents runs, the planner declares a manifest:
per agent, the exact set of paths it may create, edit, or delete. A
manifest is a JSON object mapping agent label to an array of path globs
(literal paths or globs like `src/foo/**`). No agent enters a parallel
wave without an entry in the manifest, and no agent edits a path outside
its own entry.

## Disjointness is a precondition, machine-checked

Run the checker before dispatch:

    node scripts/check-wave-ownership.mjs pre-dispatch manifest.json

A non-empty result means the wave does not run as parallel. The
overlapping agents are serialized instead — run one after another, on
the same branch/worktree, in manifest order — or the manifest is
re-drawn so the entries are disjoint and the check is re-run. "Overlap,
but coordinate carefully" is not a resolution the mechanism accepts;
only serialization or a re-drawn manifest is.

## What a green check does and does not mean

`pre-dispatch` covers exactly one failure class: **path collision** —
two agents declaring paths that can resolve to the same file. A green
result means no two agents will fight over a file. It does not mean the
wave is safe.

**Path-disjointness does not imply mechanism-compatibility.** Two agents
can write entirely different files and still produce work that cannot
both be true.

The worked example is Epic 3, and it matters because the checker passes
it. Stories 3-2 and 3-12 went out in the same 14-agent wave, each
editing its own story file, and each then built entity routing. 3-2
built it as `entity360/entityPaths.ts` + `entity360/buildEntityRoutes.tsx`;
3-12 built it as `entity360/routeConvention.tsx` + `root/routeManifest.ts`.
No shared file. The manifest is genuinely pairwise disjoint, the checker
prints `Wave-ownership guard OK`, and what landed was two incompatible
routing mechanisms in one codebase — each with a passing test suite, and
passing precisely because each suite asserted its own mechanism, so
neither could falsify the other.

Replaying that wave gives the honest result: `EXIT=0`. A manifest that
additionally declared each story's intended source files looks like it
catches the collision, but it only fires because both stories declared
one coarse `src/components/admin/**` glob; delete that glob and it goes
green again, because the collision was never in the paths.

That near-miss is worse than a clean miss — it reads as a catch. Treat
`EXIT=0` as "no two agents will fight over a file", nothing more. The
class the checker cannot see is caught by the cross-reconciliation pass
below, which is therefore not optional.

## Cross-reconciliation is a required phase, not a review option

Every parallel wave ends with a **cross-reconciliation pass**: one agent
that reads *all* of the wave's outputs together, as one body of work,
and hunts for what no single agent in the wave could have seen. Each
wave agent saw only its own slice, so by construction none of them could
detect a contradiction with a slice they never read. Only a reader of
the whole wave can. This pass runs after the wave's single commit and
before the wave counts as done; a wave without it is not finished, it is
unreviewed.

It looks for five specific things:

1. **Two agents solving the same problem by different mechanisms** — the
   3-2 / 3-12 shape. Ask of every capability the wave added: is there
   now more than one way to do this in the tree? Two route builders, two
   permission helpers, two ways to resolve an entity path.
2. **Contradictory assumptions about a shared type or contract.** A
   widened a type, B assumed the old shape; both compile because neither
   call site is the other's. This is the Epic 1 typecheck break in slow
   motion.
3. **Tests that make each other unfalsifiable.** Two suites that each
   assert their own mechanism is the correct one. Both green, and green
   means nothing: no test in the tree can fail if either mechanism is
   wrong, because each is only ever tested against itself.
4. **Work every agent assumed another was doing** — the gap that is in
   nobody's diff. A ruling applied to a contract file but not to the
   story files describing it is this shape: a *missing* edit, which no
   manifest of intended writes can ever detect.
5. **Declared-but-unbuilt and built-but-undeclared.** Run `post-wave`
   first; its output is the input to this pass, never a substitute for it.

In this project this pass has caught something real **every time it has
run**, and the collisions that shipped — Epic 1's, Epic 3's — were the
waves that had no such pass.

It is a reasoning pass and it cannot be mechanised: every item on that
list requires reading two pieces of work and judging whether they can
both be true, which is not a property of paths. That is why it is a rule
and not a script. Do not substitute a script for it, and do not let a
green `pre-dispatch` stand in for it.

## Indirect overlap counts

Two agents editing the same component is the easy case to see coming.
The real Epic 1 and Epic 3 collisions were indirect: a shared module, a
shared test file, `types.ts`, `registry.json`, an `index.ts`, a schema
file, or any generated artifact more than one agent's work happens to
regenerate. Declare these explicitly, inside whichever single agent's
entry owns them — do not leave a shared file off every entry on the
assumption that nobody's really editing it. A file omitted from every
entry is invisible to the pre-dispatch check (it can only compare paths
that were declared); it surfaces later, if at all, as an unowned
excursion in post-wave reconciliation. Catching it before dispatch is
strictly better than catching it after.

## Generated and shared artifacts need a declared owner

A manifest can be pairwise disjoint and still have two agents rewriting
the same file, because the file is not written by hand.
`{A: singles/**, B: shadchanim/**}` passes clean — but `registry.json`
indexes both directories and `.husky/pre-commit` runs `make
registry-gen`, so both agents' commits rewrite it. In Epic 1
`registry.json` was the single most-contended file in the wave: 5 of 6
stories touched it, none declared it.

`pre-dispatch` therefore also checks a table of **known shared
artifacts** (`SHARED_ARTIFACTS` in the checker). Each entry is a path
that gets rewritten as a side effect of editing some set of *feeder*
paths. When two or more agents declare paths that feed the same artifact
and no agent declares the artifact itself, the checker warns.

Silence the warning the correct way: put the artifact in exactly one
agent's entry. That agent owns it and the others report a needed change
rather than taking it. (Two agents declaring it is an ordinary overlap
and fails the hard check.) Warnings do not set a non-zero exit, so
resolving them is on whoever drives the wave — an unresolved warning is
an undispatched wave, not an accepted risk.

Tabled today: `registry.json`, `package-lock.json`,
`supabase/migrations/**`, and the two CRM i18n catalogues
(`englishCrmMessages.ts` / `frenchCrmMessages.ts`), which every wave that
adds user-facing copy converges on. When a new generated artifact
appears in the repo, add it to the table.

## Order-dependence is declared, and it disqualifies the wave

Disjoint is not the same as independent. Epic 1's cross-check recorded
an ordering blocker (1.5 had to land before 1.2) between two stories
whose paths never touched. A manifest entry may therefore be written
either as a bare array of globs or as an object:

    {
      "story-1.5": ["src/components/atomic-crm/root/routeManifest.ts"],
      "story-1.2": {
        "paths": ["src/components/atomic-crm/sales/**"],
        "after": ["story-1.5"]
      }
    }

Any non-empty `after` fails `pre-dispatch`: a wave with an internal
ordering constraint is not a parallel wave, and those agents run in
dependency order instead. The field exists so the constraint is recorded
where the checker can see it, rather than living in a planner's head and
being forgotten at dispatch.

## Out-of-scope work is reported, not taken

An agent that discovers it needs a file outside its declared set does
not edit it — not even a one-line fix, not even to unblock itself. It
stops and reports the need back to whoever dispatched the wave. That
report is a successful outcome; it is the mechanism working, not the
agent failing. Ownership is re-drawn and the wave is redispatched. The
agent does not improvise a workaround by touching the file anyway.

## Parallel agents do not commit

One committer per wave, after every agent in the wave has finished. This
pattern already works elsewhere in this harness; it is codified here
because it is also what makes post-wave reconciliation possible: a
single diff for the whole wave, attributable back to the manifest, only
exists because nobody committed mid-wave.

## Post-wave reconciliation

After the wave's single commit, diff what was actually touched against
what was declared:

    git diff --name-only <base>..HEAD | node scripts/check-wave-ownership.mjs post-wave manifest.json

This reports two kinds of excursion, neither of which un-does the
commit:

- a touched file that no agent's entry declared ("unowned") — the
  indirect-overlap case that slipped past pre-dispatch
- a declared path that was never touched ("unclaimed") — a sign the
  manifest was drawn wider than the work actually was

Both are reported so the next wave's manifest is more accurate than this
one's.

## A shared decision has exactly one owner

If a ruling touches a contract file and the story files that describe
the same mechanism, one agent owns all of them in the same dispatch —
never split "update the contract" and "update the stories that describe
it" across two agents in the same wave, even when the two edits look
independent. This is the specific defect that recurred three times: a
contract changed, a story didn't, and the two went silently inconsistent
because each side's agent believed the other file was someone else's
job.

## Known limitations — do not read silence as safety

Replaying real waves through the checker turned up manifests that pass
and still collide. Some are handled above; these are not, and no
mechanism here will catch them. They are the standing agenda of the
cross-reconciliation pass.

- **Rename destinations.** `{1.3: children/**, 1.2: sales/**}` passes,
  but both renames *write into* `singles/**` and `members/**`, declared
  by nobody. The mitigation is a rule, not a check: an entry must
  declare a rename's destination as well as its source. Two agents
  choosing the same destination is otherwise invisible until `post-wave`,
  which is after the damage.
- **Shared exported types.** `{A: types.ts + singles/**, B: dashboard/**}`
  passes, yet `dashboard/useDashboardData.ts` imports from `../types`. A
  renames the symbol, B breaks — the Epic 1 failure mode exactly.
  Detecting it needs the import graph and, worse, needs to know whether
  the *meaning* changed. Item 2 of the cross-reconciliation pass.
- **Unpredeclarable paths.** A migration filename is timestamped at
  generation time, so no agent can declare its own in advance. Declare
  the glob `supabase/migrations/**`, never a filename. Two agents both
  declaring it collide and get serialized, which is the right answer:
  migrations are order-dependent by nature.
- **Missing work.** Nothing that inventories intended *writes* can spot
  an edit nobody made. Item 4 of the cross-reconciliation pass.
- **It is advisory, not enforcing.** Nothing at write time stops an
  agent from editing outside its declaration; `pre-dispatch` is a
  precondition and `post-wave` is detective. "Out-of-scope work is
  reported, not taken" is what actually holds the line, and it holds
  only because agents follow it.

## Scope of the machine check

`scripts/check-wave-ownership.mjs` operates on a manifest that exists
only at dispatch time. It is deliberately **not** wired into CI: a CI
job runs against a merged tree with no manifest left to check against,
so it would have nothing to compare. Its modes are invoked by whoever
drives the wave — today, the orchestrator/planner — not by a pipeline.

    node scripts/check-wave-ownership.mjs pre-dispatch manifest.json
    git diff --name-only <base>..HEAD \
      | node scripts/check-wave-ownership.mjs post-wave manifest.json

`pre-dispatch` runs three checks: pairwise path overlap and declared
order-dependence (both fail the wave, exit 1) and shared-artifact
contention (warns, exit 0). None of the three, and no future addition to
that script, replaces the cross-reconciliation pass.
