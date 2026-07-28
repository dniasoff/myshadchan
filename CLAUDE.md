@AGENTS.md

# Working in this repo

`AGENTS.md` (imported above) covers the project itself: stack, directory layout,
build/test/lint commands, database workflow. This file covers the conventions an
agent working here is expected to follow, and where they are written down.

## Standing rules

Everything in `.claude/rules/` applies to every change. Read the one that matches
what you are touching:

| Rule | Covers |
| --- | --- |
| `coding-style.md` | immutability, KISS/DRY/YAGNI, file size ceilings, error handling, naming |
| `typescript.md` | types over interfaces, no `any`, React props, Zod validation, `console.log` |
| `testing.md` | 80% coverage floor, AAA structure, test isolation, Playwright shape |
| `web-patterns.md` | state management, URL as state, composition, data fetching, API responses |
| `web-security.md` | HTTP headers, XSS, CSP, third-party scripts, forms |
| `security-triggers.md` | which diffs require a security review |
| `lsp-usage.md` | use the `LSP` tool, not `grep`, for TS/JS symbol questions |
| `english-only.md` | everything committed is in English, whatever the chat language |
| `parallel-ownership.md` | declared path ownership for parallel agent waves |

## Parallel agent waves

Before dispatching a wave of parallel agents, declare a per-agent path manifest
and check it, per `.claude/rules/parallel-ownership.md`:

```bash
node scripts/check-wave-ownership.mjs pre-dispatch manifest.json
```

Overlapping declarations mean the wave is serialized, not "coordinated
carefully". A green result is necessary but **not** sufficient: it proves no two
agents will fight over a file, and proves nothing about whether their work is
mutually compatible. Every wave is therefore followed by the
cross-reconciliation pass the rule requires — one agent reading all of the
wave's output together, looking for two mechanisms solving one problem,
contradictory assumptions about a shared contract, tests that make each other
unfalsifiable, and work every agent assumed someone else was doing. That pass is
required, not advisory, and it cannot be replaced by a script.

## Repo checks

`scripts/check-*.mjs` are standalone Node checks with colocated `*.test.mjs`
suites (run by `npm run test:unit:scripts`). Four run in CI via
`.github/workflows/check.yml`: `check-retired-names`, `check-route-convention`,
`check-suppressions`, `check-tailwind-arbitrary-var`. `check-wave-ownership` is
deliberately not in CI — it needs a dispatch-time manifest that no longer exists
by the time a wave has merged.

Gates before considering work done: `make typecheck`, `make lint`, `make test`.

## Tooling configuration

`.claude/settings.json` configures the TypeScript language server that backs the
`LSP` tool, and nothing else. This repo defines **no** Claude Code hooks,
subagents, or slash commands. Skills live in `.claude/skills/`.

The one real commit-time hook is `.husky/pre-commit`, which runs
`make registry-gen` — so any change under `src/components/atomic-crm/`,
`src/components/supabase/`, `src/hooks/`, or `src/lib/` also rewrites
`registry.json`.

## Note: the agent harness is not installed here

Earlier revisions of this file described an agent harness — an `orchestrator`
dispatching planner / developer / quality-reviewer / merger / documentator
through git worktrees, a `block-nested-orchestrator` hook, a PD-ASK migration
round-trip, and Ponytail skills and commands.

**None of it exists in this repository.** There is no `.claude/agents/`, no
`.claude/hooks/`, no `.claude/commands/`, and no ponytail skill, at project or
user level; the rule files that section cited (`worktree-scope.md`,
`agent-output-format.md`, `validation-commands.md`) have never existed in this
repo's history. Two orphaned support scripts survive —
`scripts/harness-monitor.mjs` and `scripts/harness-revert.mjs` — and they
reference the same absent infrastructure.

The description has been removed rather than left standing as instructions
pointing at nothing. If the harness is reinstated, restore its description
alongside the files it describes.
