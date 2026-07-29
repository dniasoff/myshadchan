.PHONY: build help

# ---------------------------------------------------------------------------
# Parallel test stacks
#
# STACK_ID=<0..9> gives an agent its own Supabase instance (own Docker project
# id, own port block, own workdir), its own Vite port, and its own database for
# `make test`. It exists so several agents can run tests concurrently against
# this one shared checkout on `main` — disjoint file ownership does not help
# when the test stacks are host-global singletons (see
# .claude/rules/parallel-ownership.md, "Running tests in parallel").
#
# STACK_ID unset === stack 0 === exactly the ports, project id and workdir this
# makefile hard-coded before, so every existing workflow and CI job is
# unaffected. scripts/stack-env.mjs owns the allocation; nothing here computes
# a port itself.
#
# Exported so it reaches node, vitest, playwright and recursive make.
# ---------------------------------------------------------------------------
STACK_ID ?=
export STACK_ID

# STACK_ID reaches recipes by textual interpolation (STACK_TAG below, the log
# file names, `[ -n "$(STACK_ID)" ]`), so it is validated here rather than only
# in scripts/stack-env.mjs — by the time a script could reject it, sh has
# already parsed the line it was pasted into. `$(value …)` first, because a
# command-line or environment value is recursively expanded: without it a
# `$(shell …)` inside STACK_ID would run while this guard was reading it.
override STACK_ID := $(value STACK_ID)
ifneq (,$(strip $(STACK_ID)))
ifneq (1,$(words $(STACK_ID)))
$(error STACK_ID must be a single digit 0-9, got '$(STACK_ID)')
endif
ifeq (,$(filter $(STACK_ID),0 1 2 3 4 5 6 7 8 9))
$(error STACK_ID must be a single digit 0-9, got '$(STACK_ID)')
endif
endif

# Per-stack log-file tag, so two agents' silent-run logs do not clobber each
# other in /tmp. Pure make (no node) because it is expanded on every recipe.
STACK_TAG := $(if $(STACK_ID),supabase-e2e-$(STACK_ID),supabase-e2e)

# `eval` this at the top of a recipe to get STACK_WORKDIR, STACK_PROJECT_ID,
# STACK_APP_PORT, SUPABASE_DB_URL, VITE_SUPABASE_URL … in the shell.
STACK_ENV = eval "$$(node scripts/stack-env.mjs --shell)"

# Run silently, show output on failure
run-silent = $1 >/tmp/atomic-crm-$2.log 2>&1 || (cat /tmp/atomic-crm-$2.log && false)

# Same but captures TTY output (for docker/supabase)
ifeq ($(shell uname),Darwin)
run-silent-tty = script -q /tmp/atomic-crm-$2.log $1 >/dev/null 2>&1 || (cat /tmp/atomic-crm-$2.log && false)
else
run-silent-tty = script -eq /dev/null -c "$1" >/tmp/atomic-crm-$2.log 2>&1 || (cat /tmp/atomic-crm-$2.log && false)
endif

help:
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
	@printf '\n\033[1mParallel test stacks (STACK_ID)\033[0m\n'
	@printf '  STACK_ID=<0-9> gives an agent its own Supabase instance (own docker project,\n'
	@printf '  own ports, own database), its own Vite port and its own Playwright output dir,\n'
	@printf '  so several agents can run tests concurrently against this one checkout.\n'
	@printf '  Unset === stack 0 === the ports and project id this repo has always used, so\n'
	@printf '  nothing changes for existing workflows or CI.\n\n'
	@printf '    make start-supabase-e2e STACK_ID=2   # this agent'"'"'s own stack\n'
	@printf '    make test STACK_ID=2                 # db suites hit stack 2, not the dev db\n'
	@printf '    STACK_ID=2 npx playwright test       # e2e against stack 2'"'"'s app + database\n'
	@printf '    make stacks                          # which ids are in use / free\n'
	@printf '    make stop-supabase-e2e STACK_ID=2    # release one\n'
	@printf '    make stop-stacks                     # release all of them\n\n'
	@printf '  Set STACK_OWNER too: start-supabase-e2e refuses an id somebody else holds\n'
	@printf '  rather than destroying their database, and STACK_OWNER is how it tells you\n'
	@printf '  apart (agents in one session otherwise look identical to it).\n\n'
	@printf '  Stack N: supabase ports 54340+10N.., vite 5175+N, docker atomic-crm-e2e-N,\n'
	@printf '  vite dep cache node_modules/.vite-N.\n'
	@printf '  Each stack is ~10 containers / ~1.1GB; 4-6 concurrent is comfortable here.\n'
	@printf '  See .claude/rules/parallel-ownership.md, "Running tests in parallel".\n'

install: package.json ## install dependencies
	npm install

install-playwright-browsers: install ## install the playwright browsers matching the repo's pinned version
	npx playwright install chromium chromium-headless-shell

install-claude-plugins:
	claude plugin marketplace update claude-plugins-official
	claude plugin install typescript-lsp@claude-plugins-official

install-lsp:
	npm install -g typescript-language-server

start-supabase: ## start supabase locally
	npx supabase start

start-supabase-functions: ## start the supabase Functions watcher
	npx supabase functions serve

supabase-migrate-database: ## apply the migrations to the database
	npx supabase migration up

supabase-reset-database: ## reset (and clear!) the database
	npx supabase db reset

start-app: ## start the app locally
	npm run dev

# No `--force`: it wipes and re-optimises Vite's dependency cache on every
# start. That cache is now per-stack (STACK_CACHE_DIR, wired in vite.config.ts),
# but forcing it is still a full re-optimisation per run for no benefit — Vite
# re-optimises by itself when the lockfile, dependency set or config changes.
# See playwright.config.ts's webServer block for the measurements.
start-app-e2e: ## start the app pointing to the e2e supabase instance (honours STACK_ID)
	@$(STACK_ENV); \
	if [ -n "$(STACK_ID)" ]; then export VITE_SUPABASE_URL; fi; \
	npx vite --port $$STACK_APP_PORT --mode e2e &

stop-app-e2e:
	@$(STACK_ENV); kill $$(lsof -t -i:$$STACK_APP_PORT)

# CI only: serves the shared `dist/` build, which is NOT stack-scoped. Two
# concurrent agents would race the same build output — use start-app-e2e (the
# Vite dev server) for parallel local runs.
start-app-e2e-ci: build-e2e ## start the app pointing to the e2e supabase instance in CI mode (no open, no watch)
	@$(STACK_ENV); npx serve -l $$STACK_APP_PORT -L -s dist &

start: start-supabase start-app ## start the stack locally

start-demo: ## start the app locally in demo mode
	npm run dev:demo

stop-supabase: ## stop local supabase
	npx supabase stop

stop: stop-supabase ## stop the stack locally

# The lease check is the first thing in the recipe, before the `supabase stop
# --no-backup` below can destroy an incumbent's database. It exits non-zero
# naming the holder; `|| exit 1` is required because everything here is one
# `;`-joined shell. See scripts/stack-lease.mjs.
start-supabase-e2e: ## start a separate supabase instance for e2e, fresh DB every run (STACK_ID=<0-9> for an isolated one)
	@$(STACK_ENV); \
	node scripts/stack-lease.mjs acquire || exit 1; \
	npx supabase stop --workdir $$STACK_WORKDIR --no-backup 2>/dev/null || true; \
	rm -rf $$STACK_WORKDIR/supabase; \
	mkdir -p $$STACK_WORKDIR/supabase; \
	node scripts/stack-config.mjs $$STACK_WORKDIR/supabase/config.toml; \
	cp -r supabase/migrations $$STACK_WORKDIR/supabase/migrations; \
	cp -r supabase/schemas $$STACK_WORKDIR/supabase/schemas; \
	cp -r supabase/functions $$STACK_WORKDIR/supabase/functions; \
	cp -r supabase/templates $$STACK_WORKDIR/supabase/templates; \
	cp supabase/seed.sql $$STACK_WORKDIR/supabase/seed.sql; \
	cp supabase/signing_keys.json $$STACK_WORKDIR/supabase/signing_keys.json; \
	$(call run-silent-tty,npx supabase start --workdir $$STACK_WORKDIR,$(STACK_TAG))

stop-supabase-e2e: ## stop the e2e supabase instance and release its lease (honours STACK_ID)
	@$(STACK_ENV); npx supabase stop --workdir $$STACK_WORKDIR --no-backup; \
	node scripts/stack-lease.mjs release

stop-stacks: ## stop and remove every parameterised e2e stack (all STACK_IDs)
	@for workdir in .supabase-e2e .supabase-e2e-[0-9]; do \
	  [ -d "$$workdir" ] || continue; \
	  echo "stopping $$workdir"; \
	  npx supabase stop --workdir "$$workdir" --no-backup 2>/dev/null || true; \
	done; \
	for id in "" 0 1 2 3 4 5 6 7 8 9; do \
	  port=$$(STACK_ID=$$id node scripts/stack-env.mjs --shell | sed -n "s/^STACK_APP_PORT='\(.*\)'$$/\1/p"); \
	  pids=$$(lsof -t -i:$$port 2>/dev/null || true); \
	  [ -n "$$pids" ] && echo "killing app on :$$port" && kill $$pids || true; \
	  STACK_ID=$$id node scripts/stack-lease.mjs release; \
	done; \
	echo "all stacks stopped"

stacks: ## list the e2e stacks currently running (docker + app port)
	@node scripts/stack-status.mjs

start-e2e: start-supabase-e2e start-app-e2e ## start the stack in e2e mode (fresh supabase instance + app pointing to it)

start-e2e-ci: start-supabase-e2e start-app-e2e-ci ## start the stack in e2e mode in CI (fresh supabase instance + built app pointing to it)

stop-e2e: stop-supabase-e2e stop-app-e2e ## stop the stack in e2e mode

build: ## build the app
	npm run build

build-e2e: ## build the app in e2e mode (with the e2e supabase config)
	@$(call run-silent,npm run build:e2e,build-e2e)

build-demo: ## build the app in demo mode
	npm run build:demo

prod-start: build supabase-deploy
	open http://127.0.0.1:3000 && npx serve -l tcp://127.0.0.1:3000 dist

prod-deploy: build supabase-deploy
	npm run ghpages:deploy

supabase-remote-init:
	npm run supabase:remote:init
	$(MAKE) supabase-deploy

supabase-deploy:
	npx supabase db push
	npx supabase functions deploy

# STACK_ID points the "db" project's psql at that stack's database instead of
# the shared dev stack on 54322. With STACK_ID unset nothing is exported and
# the suites keep their historical default — see
# supabase/tests/dbSuiteHelpers.ts.
test: ## run the unit test suites (STACK_ID=<n> targets that stack's database)
	@if [ -n "$(STACK_ID)" ]; then \
	  $(STACK_ENV); export SUPABASE_DB_URL; npm run test; \
	else \
	  npm run test; \
	fi

test-e2e: start-e2e ## run the e2e suite with the Playwright UI (honours STACK_ID)
	npx playwright test --ui

test-e2e-ci: start-e2e-ci ## run the e2e suite headless against the built app (honours STACK_ID)
	@$(STACK_ENV); \
	npx wait-on http-get://localhost:$$STACK_API_PORT/auth/v1/health http-get://localhost:$$STACK_APP_PORT
	npx playwright test

# The safe form of `git commit` on a tree with other writers. `git commit -m`
# commits the process-global index, so it silently absorbs whatever another
# agent staged; a pathspec commit builds a temporary index from HEAD plus the
# named paths and cannot. See scripts/safe-commit.mjs and
# .claude/rules/parallel-ownership.md, "Committing on a busy tree".
#
# MSG never touches a shell. `-m "$(MSG)"` in the recipe below cannot be made
# safe for arbitrary text, and commit messages here are routinely multi-line:
#
#   * a newline ends the recipe line, so sh gets `-m "first line` on its own
#     — `Syntax error: Unterminated quoted string`, which is the reported bug;
#   * make expands `$` before sh ever sees it ($HOME -> the empty make variable
#     $H followed by OME) and strips a leading `-`/`@`/`+` from each line, so a
#     `- bullet` line silently becomes an ignore-errors prefix;
#   * inside those double quotes sh still runs `backticks` and $(command
#     substitutions) out of the message text.
#
# No amount of quoting fixes all four, so the message is not interpolated at
# all: `$(value MSG)` takes the raw command-line text before make expands it,
# and `export` hands it to the script through the environment — the only
# channel between make and node that neither make nor sh parses.
#
# PATHS stays interpolated on purpose — sh's word splitting is what turns it
# into several arguments — but `$(value …)` keeps make from eating a `$` in a
# file name. Paths with spaces or shell metacharacters are not supported; call
# `node scripts/safe-commit.mjs --message-env MSG -- <path>...` directly for
# those.
override MSG := $(value MSG)
override PATHS := $(value PATHS)
export MSG

commit: ## commit only the paths you name: make commit MSG="…" PATHS="a b"
	@node scripts/safe-commit.mjs --message-env MSG -- $(PATHS)

lint:
	npm run lint
	npm run prettier

publish:
	npm publish

typecheck:
	npm run typecheck

doc-install:
	@(cd doc && npm install)

doc: doc-dev

doc-dev:
	@(cd doc && npm run dev)

doc-build:
	@(cd doc && npm run build)

doc-preview: doc-build
	@(cd doc && npm run preview)

doc-deploy:
	@(cd doc && npx gh-pages -b gh-pages -d dist -e doc -m "Deploy docs" --remove doc)

registry-build: ## build the shadcn registry
	npm run registry:build

registry-deploy: registry-build ## Deploy the shadcn registry (Automatically done by CI/CD pipeline)
	@(cd public/r && npx gh-pages -b gh-pages -d ./ -s atomic-crm.json -e r -m "Deploy registry" --remove r)

registry-gen: ## Generate the shadcn registry (ran automatically by a pre-commit hook)
	npm run registry:gen
	npx prettier --config ./.prettierrc.json --write "registry.json"

update-changelog: ## Update the changelog with the unreleased changes (ran automatically by a pre-commit hook)
	npm run update-changelog
	npx prettier --config ./.prettierrc.json --write "CHANGELOG.md"

storybook: ## start storybook
	npm run storybook

watch: ## live monitor of the most recent agent session (agents, hooks, diagnosis)
	node scripts/harness-monitor.mjs --watch

# `$(value …)` + single quotes for the same reason as STACK_ID above: SESSION is
# user-supplied text pasted into a shell line. Quoted, a stray space or `;` is a
# bad session id rather than a second command.
override SESSION := $(value SESSION)

monitor: ## one-shot summary of the most recent agent session (pass SESSION=<id> to pick one)
	@node scripts/harness-monitor.mjs $(if $(SESSION),--session '$(SESSION)',)

sessions: ## list known agent sessions, newest first
	@node scripts/harness-monitor.mjs --list
