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

The hook now regenerates `registry.json` only when the tree is quiet — see
"Committing on a busy tree" below — but the ownership requirement is unchanged,
because that owner is who has to regenerate it when the hook declines to.

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

## Committing on a busy tree

Path partitioning was never the whole problem. An agent once staged exactly its
own four files and still committed a concurrently running workflow's two
unstaged files, caught only by a post-commit stat. `git add <my files>` is not
isolation, because the commit path itself reached outside the staged set.

Three mechanisms did that. All three were reproduced in a throwaway clone with a
second writer present — a scenario that stages A's files, leaves B's edits
unstaged and B's new files untracked, commits as A, and compares md5s — and all
three are now closed in `.husky/pre-commit`.

1. **`git update-index --again` re-staged the working tree.** It was the hook's
   last line. It runs `update-index` on every path whose index entry differs
   from HEAD, refreshing each one *from the working tree* — and it ran after
   lint-staged had restored the unstaged changes it had carefully hidden. So the
   unstaged half of every partially staged path was committed, deterministically,
   with no race required; and any edit a concurrent writer made to a path in the
   index went in with it. Removed. Nothing may replace it: lint-staged already
   stages task modifications for the staged paths and only those. `git add -u`
   and `git add .` are the same bug wearing a different name.

2. **`make registry-gen` enumerated other agents' work-in-progress.**
   `scripts/generate-registry.mjs` globs `src/components/atomic-crm`,
   `src/components/supabase`, `src/hooks` and `src/lib` in the *working tree* and
   writes the resulting path list to `registry.json`. Running it inside a
   concurrent commit is not safe and cannot be made safe: its input is every
   other agent's uncommitted, unstaged and untracked files, so the artifact it
   produces describes a tree that has never existed in history. With mechanism 1
   present, that mixture was then committed. In the reproduction, agent B's
   untracked component appeared in agent A's committed `registry.json` while
   never being staged by anyone.

   The hook now runs it only when both hold: this commit stages a path under a
   feeder directory (so the artifact could have changed at all), and
   `git ls-files --others --exclude-standard` / `--deleted` over the feeder
   directories is empty (so no file outside this commit can enter the glob).
   Otherwise it skips and says so, naming the files that made it skip. It never
   fails the commit for this — a hook that blocks commits is a hook agents route
   around with `--no-verify`, which would disable the real guards too.

   The consequence: **on a busy tree `registry.json` goes stale, by design.**
   Regenerating it is the job of whoever holds the tree alone — the wave's single
   committer, on a quiet tree, after the wave — or of CI on `main`, which is the
   only place it can be derived from a tree that actually exists: check out the
   committed tree, run `make registry-gen`, and fail (or auto-commit) if the
   result differs. That is where it should move; the hook keeps it only for the
   single-writer case.

3. **A failing task reverted the whole tree.** On any task error, lint-staged
   restores its backup with `git reset --hard HEAD` + `git stash apply`. That is
   tree-wide: it discards every other writer's edits made since the backup stash,
   not just the committing agent's. Measured — a second writer's edit landing
   mid-run was silently reverted on every iteration. The hook now passes
   `--no-stash`, which drops both the backup and the revert, and keeps the hook
   out of the shared `refs/stash` (where `stash drop`-by-index is itself racy
   between concurrent committers). `--no-stash` does *not* imply
   `--no-hide-partially-staged`, so partially staged files stay isolated. The
   trade-off is real and accepted: if lint-staged fails to re-apply its unstaged
   patch there is no automatic recovery, but that damage is confined to the
   committing agent's own files, whereas the revert was not.

What the fixed hook is measured to do, with a second writer present: B's files
byte-identical before and after; the commit containing only A's paths; A's own
unstaged edit not committed; `registry.json` — committed and worktree copies
both — free of B's work; nothing of B's left staged; and A's staged content
still formatted, so the hook is not a no-op.

**Do not "fix" this by telling agents to use `--no-verify`.** It disables the
guards along with the hazard, and an instruction is not a mechanism — the whole
reason this section exists is that instructions were not enough.

## Running tests in parallel

Path partitioning is not the only precondition for a parallel wave, and it was
never the binding one. Two agents with perfectly disjoint file ownership still
destroyed each other's test runs, because the test stacks were host-global
singletons: one fixed Supabase port block, one Docker project id, one Vite
port, one `reuseExistingServer: true`, and a `resetDb()` fixture marked
`auto: true` — so it truncated the shared database before **every** e2e test,
including while another agent was mid-assertion. `make test` reached the same
shared local database. This, not file collision, is why every proposed
parallel wave for Epics 4 and 5 had to be serialised.

`STACK_ID` fixes it. It is an integer `0..9` naming an **exclusive lease** on a
whole runtime: its own Supabase Docker set, its own port block, its own
database, its own Vite server, its own Playwright output directory.

    make start-supabase-e2e STACK_ID=2   # this agent's own Supabase stack
    make test STACK_ID=2                 # unit tests; db suites hit stack 2
    STACK_ID=2 npx playwright test       # e2e against stack 2's app + db
    make stop-supabase-e2e STACK_ID=2    # release the lease

    make stacks                          # who holds which id, which are free
    make stop-stacks                     # tear every stack down

The allocation is a pure function of `STACK_ID`, computed in exactly one place
(`scripts/stack-env.mjs`) and consumed by the makefile, `playwright.config.ts`,
`vitest.config.ts`, `e2e/fixtures.ts` and `supabase/tests/dbSuiteHelpers.ts`.
Stack N gets Supabase ports `54340+10N .. 54349+10N`, Docker project
`atomic-crm-e2e-N`, workdir `.supabase-e2e-N`, and Vite on `5175+N`.

Three properties are worth knowing, because they are what make it safe rather
than merely convenient:

1. **Stack 0 is the historical allocation, digit for digit.** An unset
   `STACK_ID` resolves to it, so no existing script, workflow or CI job changes
   behaviour. `scripts/stack-env.test.mjs` asserts the generated stack-0
   `config.toml` is byte-identical to the committed `supabase/config.e2e.toml`,
   so the default path cannot drift as the config is edited.

2. **`STACK_ID` outranks inherited environment variables.** A stale
   `VITE_SUPABASE_URL` (`.env.e2e` pins one) or `SUPABASE_DB_URL` cannot
   re-point an agent's writes at another agent's database. This matters most
   for `resetDb()`, which truncates whatever URL it resolves — an env var
   winning there would silently recreate the original failure.

3. **A non-integer `STACK_ID` is refused, not hashed into a slot.** Hashing an
   agent's name to a stack number is convenient and wrong: a collision hands
   two agents the same database, which is this exact failure again, except
   silent instead of loud.

`reuseExistingServer: true` stays on in `playwright.config.ts` — `make test-e2e`
starts the stack before invoking Playwright, so disabling it would break the
normal entry point — but every URL it can reuse is now stack-scoped, so the
only server it can attach to is the caller's own.

**Cost and ceiling.** Each stack is a full Docker set: 10 containers, ~1.1 GB
resident, ~45 s to boot with migrations and seed. On this machine (24 cores,
123 GB RAM) memory is nowhere near the constraint; CPU during `supabase start`
and concurrent Chromium instances is. Four to six concurrent stacks is
comfortable alongside the long-running dev stack; the port allocation caps it
at ten. Stacks are not reaped automatically — `make stop-stacks` between waves,
and check `make stacks` before claiming an id, since nothing enforces the lease
at runtime.

**Not stack-scoped**, and therefore still serial:

- `dist/` — `make build-e2e` / `start-app-e2e-ci` (the CI path) write one
  shared build directory. Parallel local runs must use `start-app-e2e`, the
  Vite dev server, which is stack-scoped.
- The dev stack on `54320-54329` (`make start`) is a single shared instance;
  `STACK_ID` covers the e2e stacks only. With `STACK_ID` unset the database
  suites still target it, exactly as before.
- Anything writing `node_modules/.vite` or `.vitest-attachments/`.

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
- **The index is shared, and no hook can narrow a commit.** `git commit -m`
  commits the index, and the index is one process-global file for the whole
  clone. If another agent runs `git add` while you commit, its paths are in
  your commit before the hook ever runs, and a pre-commit hook cannot remove
  them — unstaging them would break the other agent instead. Measured: A stages
  `labA1.ts`, B stages `labB1.ts`, A runs `git commit -m` and gets both.
  The mechanism that does close it is **committing with an explicit pathspec** —
  `git commit -m "…" -- <paths>` — which builds a temporary index from HEAD plus
  those paths. Measured on the same setup: the commit contains only A's path,
  B's staged entry survives in the real index, lint-staged's formatting still
  applies under the temporary index, and no leftover diff is left behind. Note
  the semantics differ: a pathspec commit takes the *working tree* content of
  those paths, not what you staged. This is also why "parallel agents do not
  commit" is a rule above and not a nicety.
- **A stack lease is advisory too.** `STACK_ID` guarantees that two
  *different* ids never share a port, a container, a database or an output
  directory. It does not stop two agents from choosing the *same* id — nothing
  claims the lease at runtime. `make stacks` shows which ids are taken; the
  wave's manifest should assign them, exactly as it assigns paths.
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
