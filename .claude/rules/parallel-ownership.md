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

## Scope of the machine check

`scripts/check-wave-ownership.mjs` operates on a manifest that exists
only at dispatch time. It is deliberately **not** wired into CI: a CI
job runs against a merged tree with no manifest left to check against,
so it would have nothing to compare. Both of its modes are invoked by
whoever drives the wave — today, the orchestrator/planner — not by a
pipeline.
