# Story 1.6: Establish the tidy-code baseline

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want typecheck, lint, prettier and the full test suite green with zero warnings and zero
suppressions, and CI wired so that a red gate actually fails the build,
so that "tidy code" is enforced by the pipeline rather than left as an aspiration that
silently rots.

---

## Measured baseline (this is the state the story must clean, not assume)

Measured on `main` @ `8ad49cb`, 2026-07-26, Node v24.18.0. **Do not trust these numbers at
implementation time** — re-measure after 1.1, 1.4, 1.5, 1.3 and 1.2 have all landed, in that
pinned order (see AC-1); many of the offending files
are deleted by those stories. They are recorded here so the dev agent knows exactly what
"clean" costs and can tell a pre-existing problem from one they introduced.

| Gate | Command | Result today |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** — 0 errors (`tsconfig.app.json` + `tsconfig.workers.json`) |
| Lint | `npm run lint` | **PASS** — 632 files, 0 errors, 0 warnings — but prints a Node `ESLintIgnoreWarning` on every run |
| Prettier | `npm run prettier` | **FAIL** — exit 2; 89 files unformatted + 1 file prettier cannot parse |
| Tests | `npx vitest --config vitest.config.ts --run` | **PASS** — 65 files, 626 passed, 1 skipped, exit 0 — but prints 1 runner warning |
| Tests (`claude` project alone) | `npm run test:unit:claude` | **FAIL** — exit 1, `No test files found` |
| Build | `npm run build` | PASS — prints a rollup >500 kB chunk-size warning |

### 1. Prettier is red today: 89 unformatted files + 1 unparseable file (90 total)

**Re-verified against `main` on 2026-07-26 and unchanged: `npm run prettier` emits exactly 89
`[warn]` lines and exits 2.** By tree: `src/` 59 · `.claude/skills/` 12 ·
`supabase/functions/` 7 · `_bmad/` 6 · `design-artifacts/` 4 · `mockup/` 1 (+1 parse error).
Within `src/`: `src/components/admin/` 26 · `src/components/atomic-crm/` 31 ·
`src/components/ui/` 1 · `src/index.css` 1.

> **89 is the repo-wide number and is the one this story's AC-5 gates on.** A narrower count of
> **58** circulates — that is `src/components/` alone (26 + 31 + 1), i.e. the 89 minus
> `src/index.css` and the 30 files outside `src/`. Do not substitute it: the 30 non-`src/` files
> are precisely the ones AC-5 resolves with `.prettierignore` (`mockup/`, `design-artifacts/`,
> `_bmad/`, `.claude/skills/`), so a 58-file baseline would silently drop the part of the work
> that also fixes the `mockup/MyShadchan.dc.html` parse error. Two other counts exist and are
> **not** this gate: `npx prettier --check .` reports **113** (a different glob — it has no
> `mjs`/`html` restriction and walks paths the npm script's glob misses), and CI's own glob omits
> `mjs` (see §"CI" below, AC-5 makes the two byte-identical).

Hard parse error (not in the 89; prettier aborts on it):

```
[error] mockup/MyShadchan.dc.html: SyntaxError: Unexpected closing tag "sc-if" ... (1287:9)
```

Full list — `src/components/admin/` (26):
`array-input.tsx`, `autocomplete-array-input.tsx`, `autocomplete-input.tsx`, `badge-field.tsx`,
`data-table.tsx`, `date-field.tsx`, `delete-button.tsx`, `email-field.tsx`, `error.tsx`,
`file-field.tsx`, `filter-form.tsx`, `form.tsx`, `icon-button-with-tooltip.tsx`,
`image-field.tsx`, `list.tsx`, `number-field.tsx`, `number-input.tsx`,
`radio-button-group-input.tsx`, `reference-array-input.tsx`, `reference-many-field.tsx`,
`select-field.tsx`, `show.tsx`, `simple-form-iterator.tsx`, `spinner.tsx`, `text-field.tsx`,
`url-field.tsx`.

`src/components/atomic-crm/` (31):
`contacts/ContactCreate.tsx`, `contacts/ContactEdit.tsx`, `dashboard/bucketByState.ts`,
`dashboard/useDashboardData.ts`, `landing/LandingPage.test.tsx`, `layout/FormToolbar.tsx`,
`login/ConfirmationRequired.tsx`, `login/InviteAcceptance.tsx`, `login/LoginPage.tsx`,
`providers/fakerest/dataProvider.summaryStats.test.ts`, `references/ReferenceList.tsx`,
`references/ReferenceShow.tsx`, `reminders/ReminderCard.tsx`, `reminders/ReminderCreateSheet.tsx`,
`reminders/reminderEntity.ts`, `reminders/useReminders.ts`, `settings/AboutSection.tsx`,
`settings/ChangePasswordButton.tsx`, `settings/FamilySection.tsx`,
`shadchanim/ResponsivenessInput.tsx`, `shadchanim/ShadchanCard.tsx`,
`shadchanim/ShadchanList.tsx`, `shadchanim/ShadchanShow.tsx`,
`shadchanim/ShadchanSuggestions.tsx`, `shadchanim/shadchanUtils.test.ts`,
`shadchanim/shadchanUtils.ts`, `shidduchim/ShidduchFactsCard.tsx`,
`shidduchim/ShidduchInputs.tsx`, `shidduchim/ShidduchSchoolsSection.tsx`,
`shidduchim/ShidduchShow.tsx`, `shidduchim/ShidduchShowHeader.tsx`.

Other source (9): `src/components/ui/spinner.tsx`, `src/index.css`,
`supabase/functions/_shared/authentication.ts`, `supabase/functions/_shared/resolveDemoAccount.ts`,
`supabase/functions/clear_demo/index.ts`, `supabase/functions/merge_references/index.ts`,
`supabase/functions/postmark/index.ts`, `supabase/functions/seed_demo/dataset.ts`,
`supabase/functions/seed_demo/index.ts`.

Non-source / vendored (23): `_bmad/wds/scripts/{wds-add-object,wds-add-spacing,wds-init-page,wds-init-scenario,wds-nav,wds-validate}.js` (6);
`.claude/skills/bmad-brainstorming/assets/brain-selector.html`,
`.claude/skills/bmad-document-project/templates/project-scan-report-schema.json`,
`.claude/skills/bmad-prd/assets/validation-report-template.html`,
`.claude/skills/bmad-ux/assets/validation-report-template.html`,
`.claude/skills/design-system/templates/design-tokens-starter.json`,
`.claude/skills/ui-styling/scripts/tests/coverage-ui.json`,
`.claude/skills/wds-0-project-setup/resources/wds-7-design-system/templates/catalog.template.html`,
`.claude/skills/wds-5-agentic-development/templates/components/{dev-mode.css,dev-mode.html,dev-mode.js}`,
`.claude/skills/wds-5-agentic-development/templates/page-template.html`,
`.claude/skills/wds-7-design-system/templates/catalog.template.html` (12);
`design-artifacts/{calm-ledger-theme.css,MyShadchan.dc.html,reference-board-after.html,support.js}` (4);
`mockup/support.js` (1) and `mockup/MyShadchan.dc.html` (the parse error).

### 2. Lint passes but the run is not warning-free

`.eslintignore` still exists and is dead under ESLint 9 flat config. Every `eslint` invocation
emits on stderr:

```
(node:NNNN) ESLintIgnoreWarning: The ".eslintignore" file is no longer supported.
Switch to using the "ignores" property in "eslint.config.js"
```

`.eslintignore` currently lists: `node_modules`, `build`, `lib`, `esm`, `prism.js`,
`packages/create-react-admin/templates/**`, `.github` — none of which is a real path in this
repo except `node_modules` (already covered by flat-config `ignores`) and `.github` (contains no
lintable `.mjs/.ts/.tsx`).

### 3. Suppression inventory: 89 `eslint-disable` lines + 8 TypeScript suppressions

`eslint-disable` by tree (89 total):

| Count | Tree |
|---|---|
| 54 | `src/components/admin/` |
| 8 | `src/components/atomic-crm/` |
| 8 | `src/hooks/` |
| 6 | `e2e/` |
| 4 | `supabase/functions/` |
| 3 | `src/lib/` |
| 2 | `src/test/` |
| 2 | `scripts/` |
| 2 | `.claude/skills/` |
| 0 | `src/components/ui/`, `workers/` |

The 8 in `src/components/atomic-crm/` are: `deals/DealListContent.tsx:28`,
`reminders/useReminders.ts:97`, `contacts/useContactImport.tsx:37`,
`contacts/useContactImport.tsx:58`, `root/CRM.tsx:171`, `misc/RelativeDate.tsx:1`,
`misc/ContactOption.tsx:6`, `tour/TourAutostart.tsx:39`. Four of these sit in files that
Story 1.1 deletes (`deals/`, `contacts/`), so ~4 survive into this story.

The 6 in `e2e/fixtures.ts` (lines 227, 234, 238, 242, 246, 250) are all
`no-empty-pattern` — idiomatic Playwright fixture destructuring. The 4 in
`supabase/functions/mcp/index.ts` (321, 376, 482, 521) and the 2 in
`scripts/supabase-remote-init.mjs` (162, 212) are all `no-console` in server/CLI code.

TypeScript suppressions (8):

| File:line | Kind |
|---|---|
| `src/lib/genericMemo.ts:15` | `@ts-expect-error` |
| `src/components/atomic-crm/notes/AttachmentField.tsx:33` | `@ts-expect-error` |
| `src/components/atomic-crm/dashboard/DealsChart.tsx:66` | `@ts-expect-error` |
| `src/components/admin/image-field.tsx:42` | `@ts-expect-error` |
| `src/components/admin/reference-array-field.tsx:135` | `@ts-expect-error` |
| `src/components/admin/file-field.tsx:49` | `@ts-expect-error` |
| `src/components/admin/reference-many-field.tsx:105` | `@ts-expect-error` |
| `src/components/admin/columns-button.tsx:10` | `@ts-ignore` (with an `eslint-disable` for `ban-ts-comment` on line 9) |

Config-level blanket suppression: `eslint.config.js` sets
`"@typescript-eslint/no-explicit-any": "off"` for all files, re-enabling it only for
`src/components/admin/*`, `src/hooks/*`, `src/lib/*`. See Dev Notes → *Scope ambiguity*.

### 4. Skipped / conditional tests (6 sites)

| File:line | Kind | Verdict |
|---|---|---|
| `src/components/atomic-crm/contacts/ContactList.test.tsx:39` | `it.skip("renders a skeleton while loading")` | **Unconditional skip — must not survive.** File is deleted by Story 1.1. |
| `supabase/tests/billing_entitlement.test.ts:77` | `it.skip("skipped — local Supabase unreachable")` | Conditional escape hatch — must fail instead of skip under `CI` (AC-9) |
| `supabase/tests/child_portal.test.ts:78` | same | Same; **file is deleted by Story 1.4** |
| `supabase/tests/references_entity.test.ts:86` | same | Conditional escape hatch — see AC-9 |
| `supabase/tests/shidduch_catch.test.ts:75` | same | Conditional escape hatch — see AC-9 |
| `e2e/bulkContactTags.spec.ts:11` | `test.skip(isMobile, "Bulk tag is only available on desktop")` | Legitimate capability guard; file is deleted by Story 1.1 anyway. The replacement spec (AC-7) carries **no** skip — it must pass on both Playwright projects |

No `.only(`, `.todo(`, `.fixme(`, `xit(` or `xdescribe(` anywhere.

### 5. One test-runner warning

```
Warning: A vi.mock("../../misc/fetchWithTimeout") call in
src/components/atomic-crm/providers/commons/getContactAvatar.test.ts is not at the top level
of the module ... This will become an error in a future version.
```

`getContactAvatar.ts` is typed against the fork's `Contact` — expect Story 1.1 to delete both
the helper and the test. If it survives, hoist the `vi.mock` out of `beforeAll`.

### 6. Test projects and what actually runs

`vitest.config.ts` declares five projects. Measured today:

| Project | Files | Tests | Notes |
|---|---|---|---|
| `app` | 47 | 346 passed + 1 skipped | browser (Playwright/Chromium) |
| `functions` | 5 | — | with `workers`: 128 tests total |
| `workers` | 9 | — | |
| `db` | 4 | 152 | passes **only because local Supabase was running** |
| `claude` | **0** | **0** | `include: .claude/**/*.test.mjs` matches nothing; `.claude/hooks/` does not exist and `.claude/settings.json` declares no hooks |

Playwright is separate from vitest and is **not** one of these projects: `playwright.config.ts`
declares two browser projects (`chromium`, `Mobile Chrome`) over `testDir: "./e2e"`, driven by
`make test-e2e-ci` in its own CI job. See §7.8 and AC-7.

### 7. CI enforcement holes (`.github/workflows/check.yml`)

1. The `lint` job delegates to `wearerequired/lint-action@v3`. That action's `continue_on_error`
   input **defaults to `true`**, so a lint or prettier failure does **not** fail the job. This is
   why prettier has been red on `main` without anyone noticing. *(Verify against the pinned v3
   README; the fix below removes the dependency entirely, so the answer does not change the plan.)*
2. Its prettier glob is `"**/*.{js,json,ts,tsx,css,md,html}"` — it omits `mjs`, which the local
   `npm run prettier` script includes. The two gates disagree about what is checked.
3. `npm run test:unit:app` does **not** pass `--project app`; it runs **all five** projects.
   CI then runs `functions` and `workers` a second time. The script names lie.
4. No CI step runs `npm run test:unit:db`. The `db` project does run incidentally (via the
   mis-named `test:unit:app`), but on a GitHub runner there is no Postgres at
   `127.0.0.1:54322`, so all four suites hit the `it.skip("… unreachable")` branch. **The RLS /
   `SECURITY DEFINER` suite that AD-1 leans on has never actually executed in CI.**
5. Nothing passes `--max-warnings=0`.
6. No CI guard exists for retired entity names (AD-23 requires one).
7. `npm run typecheck` covers only `tsconfig.app.json` (`src`, `demo`) and
   `tsconfig.workers.json` (`workers`). Nothing typechecks `e2e/` (4 files),
   `playwright.config.ts`, `vitest.config.ts`, `vite.demo.config.ts`, `.storybook/main.ts`,
   `.storybook/preview.ts`, or `supabase/tests/**/*.ts` (4 files). `tsconfig.node.json` exists,
   includes only `vite.config.ts`, and is not referenced by the `typecheck` script.
   **Probed:** all of those files typecheck clean (0 errors) under a strict Node-flavoured
   config, so closing the hole costs nothing. `supabase/functions/**` is Deno
   (`jsr:` / `https:` specifiers, the `Deno` global) and produces **111** `tsc` errors — it is
   not `tsc`-checkable and must be excluded explicitly.
8. The `e2e-test` job (`.github/workflows/check.yml:97-116`) runs `make test-e2e-ci`
   (`makefile:124-126`) → `npx playwright test` over `testDir: "./e2e"`. `e2e/` holds exactly
   `bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts` and `fixtures.ts`,
   and **story 1.1 deletes all three specs**. Verified empirically: Playwright exits **1** with
   `Error: No tests found` when the directory has no spec, so the job would go red for a reason
   that has nothing to do with code quality. AC-7 closes this by keeping the job and adding one
   real spec — the job is not deleted, and the coverage hole 1.1 opens is not left open.

---

## Acceptance Criteria

1. **Prerequisite gate.** Epic 1's story order is pinned: **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**.
   This story is **6th and last**; it is executed only on a tree where 1.1, 1.4, 1.5, 1.3 and 1.2
   are all merged, in that order. Before any cleanup, the dev re-runs the six baseline commands
   from *Measured baseline* on that tree and records the actual numbers in Completion Notes.
   If any of the five is missing, the story stops and reports `BLOCKED: awaiting 1.x`.

2. **Typecheck is green.** `npm run typecheck` exits 0 and prints no diagnostics.

3. **Typecheck covers every `tsc`-checkable first-party TS file.** A tsconfig project reachable
   from `npm run typecheck` includes `e2e/**/*.ts`, `playwright.config.ts`, `vitest.config.ts`,
   `vite.config.ts`, `vite.demo.config.ts`, `.storybook/*.ts` and `supabase/tests/**/*.ts`.
   Verification: `npx tsc --noEmit -p <that config> --listFiles | grep -c` shows each of those
   files. `supabase/functions/**` is excluded by an explicit `exclude` entry carrying a one-line
   comment naming Deno as the reason; no `@ts-nocheck`, `skipLibCheck` widening or `any` is used
   to make anything pass.

4. **Lint is green and warning-free.** `npm run lint` exits 0, reports 0 errors **and 0
   warnings**, and the script itself passes `--max-warnings=0`. Its stderr contains no
   `ESLintIgnoreWarning`. `.eslintignore` is **deleted** (not emptied, not renamed); any pattern
   still needed moves into the `ignores` array of `eslint.config.js`. Verification:
   `test ! -e .eslintignore` and `npm run lint 2>&1 | grep -c ESLintIgnoreWarning` returns 0.

5. **Prettier is green.** `npm run prettier` exits 0. Every remaining file in the 90-file
   baseline list is either reformatted or excluded via `.prettierignore`, subject to:
   **no file under `src/`, `workers/`, `supabase/`, `e2e/` or `scripts/` may be excluded** —
   those are formatted. The vendored/generated trees `mockup/`, `design-artifacts/`, `_bmad/`
   and `.claude/skills/` are added to `.prettierignore` (this also resolves the
   `mockup/MyShadchan.dc.html` parse error without editing a vendored mockup). The CI prettier
   glob and the `npm run prettier` glob are byte-identical.

6. **The full vitest suite is green, warning-free and skip-free.** Running every vitest project
   exits 0, and its combined output contains **zero** lines matching `^Warning:` and zero
   unconditionally-skipped tests. Verification: the run output shows `N skipped` where the only
   skips are conditional capability guards (a `test.skip(condition, reason)` form), and
   `grep -rn "it\.skip(\"\|test\.skip(\"\|describe\.skip(" src/ workers/ supabase/ e2e/ scripts/`
   returns no unconditional call.

7. **The e2e suite stays real — one genuine smoke spec, and the CI `e2e-test` job stays green.**
   `e2e/`, the `e2e-test` job (`.github/workflows/check.yml:97-116`) and the `test-e2e` /
   `test-e2e-ci` targets (`makefile:121-126`) are **kept, not deleted**. Story 1.1 deletes the
   three fossil specs (`bulkContactTags.spec.ts`, `onboarding.spec.ts`,
   `userAddingATask.spec.ts`), which would leave `e2e/` holding only `fixtures.ts` — and
   Playwright exits **1** with `Error: No tests found` on an empty `testDir`, turning the job red
   for the wrong reason. This story restores it with exactly one real spec, `e2e/pipeline.spec.ts`:

   a. it seeds a member and **one single** through `e2e/fixtures.ts`, then signs that user in
      through the email/password form on `/#/login`
      (`src/components/atomic-crm/login/LoginPage.tsx:151-176`);
   b. it reaches the pipeline through the `Pipeline` nav entry (`PRIMARY_NAV`, `to: "/shidduchim"`,
      `src/components/atomic-crm/layout/navItems.ts`) and asserts the board renders — the
      `data-tour="pipeline-board"` container (`shidduchim/ShidduchimListContent.tsx:107`) plus at
      least one visible `PIPELINE_STATES` column label (`New`, `Look-into`, …,
      `shidduchim/pipelineStates.ts:26-63`);
   c. it passes on **both** Playwright projects — `chromium` and `Mobile Chrome`
      (`playwright.config.ts:39-53`) — since both surfaces carry the same `PRIMARY_NAV` entry
      (1.5 AC-6(d) makes that an invariant);
   d. it uses deterministic waits only — no `waitForTimeout`, no `test.skip`, no `test.fixme`
      [Source: .claude/rules/testing.md];
   e. it reintroduces **no** fixture helper for a resource 1.1 deleted.

   Verification: `make test-e2e-ci` exits 0 and its `list` reporter shows ≥1 passing test per
   Playwright project; `ls e2e/*.spec.ts` lists exactly one file; the `e2e-test` job is still
   present in `check.yml` and carries no `continue-on-error`.

8. **Every declared test project is real.** Each `npm run test:unit:<project>` exits 0 for every
   project declared in `vitest.config.ts`. The `claude` project resolves 0 files today; per
   NFR-14 it is **deleted** — its `projects[]` entry, its `test:unit:claude` script, its slice
   of the `vitest.config.ts` header comment, and the `.claude/**` entry in the `app` project's
   `exclude` list all go in this change. (If 1.1–1.5 introduced harness hook tests under
   `.claude/`, keep the project instead and prove `npm run test:unit:claude` exits 0.)
   A `scripts` project replaces it — `environment: "node"`,
   `include: ["scripts/**/*.test.mjs"]` — as the home for the two guard tests required by AC-10
   and AC-12, with a matching `test:unit:scripts` script; `scripts/**` is added to the `app`
   project's `exclude`, because `app` relies on vitest's default `include` and would otherwise
   drag those Node tests into the browser runner.
   `test:unit:app` passes `--project app`, and a single `npm run test` runs all projects;
   `make test` calls it.

9. **The `db` project executes for real in CI.** A CI job boots a local Supabase stack and runs
   `npm run test:unit:db`, and the "local Supabase unreachable" branch in every
   `supabase/tests/*.test.ts` **throws instead of skipping when `process.env.CI` is set**.
   Verification: the CI log for that job shows the db suites' individual check names, not a
   skip line; and running `CI=1 npm run test:unit:db` with the stack stopped exits non-zero.

10. **No suppression was added, and none can be added silently.** After the cleanup:
    - the `eslint-disable` / `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` counts per tree
      are **≤** the post-1.2 re-measured baseline, and the exact numbers are written into
      Completion Notes;
    - `eslint.config.js` sets `linterOptions.reportUnusedDisableDirectives: "error"`, so a
      suppression that no longer suppresses anything fails the lint gate;
    - the 6 `no-console` line suppressions in `supabase/functions/mcp/index.ts` and
      `scripts/supabase-remote-init.mjs` are **deleted** and replaced by a per-path `no-console`
      override in `eslint.config.js` (a rule that is wrong for a path is configured per path,
      never suppressed per line);
    - `scripts/check-suppressions.mjs` exists, is run by CI, and fails when any per-tree
      suppression count exceeds the recorded number, or when any unconditional
      `it.skip` / `describe.skip` / `test.skip("…")` / `.only(` / `.todo(` / `.fixme(` /
      `xit(` / `xdescribe(` appears in a test file;
    - **it is proven to bite by its own unit test**, not by a manual seed-and-revert: a
      `scripts/check-suppressions.test.mjs` under the `scripts` vitest project (AC-8) builds a
      deliberately-invalid tree in a temp directory (`fs.mkdtemp`), points the guard at it via a
      root-path argument, and asserts non-zero for an over-budget tree and for an unconditional
      `it.skip`, and zero for an at-budget tree and for a conditional
      `test.skip(condition, reason)`. The guard therefore takes its scan root as an argument,
      defaulting to `process.cwd()`. **The offending literals are composed at runtime from the
      guard's own pattern list, never typed into the test source** — a committed
      `it.skip("…")` inside `scripts/check-suppressions.test.mjs` would make the guard fail on
      its own test when it scans `scripts/`.

11. **CI actually fails on a red gate.** `.github/workflows/check.yml` no longer uses
    `wearerequired/lint-action`; the lint job runs plain `run:` steps — `npm run lint` and
    `npm run prettier` — with no `continue-on-error`. Every gate (typecheck, lint, prettier,
    each vitest project, the `e2e-test` job, the `db` job, the suppression guard, the
    retired-name guard) is its own failing step.
    Verification — machine-checkable, no transient seed-and-revert:
    - `grep -nE "continue-on-error|continue_on_error|\|\| true|--no-verify|wearerequired" .github/workflows/check.yml`
      returns nothing;
    - the CI prettier glob and the `npm run prettier` glob are byte-identical (AC-5), asserted by
      comparing the two strings rather than by eye;
    - the two guard scripts prove they bite through their own unit tests over deliberately-invalid
      fixture trees (AC-10, AC-12). Seeding a violation into the working tree and reverting it is
      **not** acceptable evidence for this story — it leaves no artifact and cannot be re-run.

12. **The retired-name guard runs in CI, from one shared pattern artifact (AD-23).**

    a. **One artifact, two consumers.** The pattern list *and* the allowlist live in a single
       committed data file, `scripts/retired-names.json` — the only place either is written down.
       Story 1.1's AC-14 fossil-word gate is the same list, so it reads the same file; this story
       does not create a second list (NFR-14: one owner, no duplicates).
       - If 1.1 already shipped `scripts/retired-names.json` and `scripts/check-retired-names.mjs`,
         this story **extends** them to the full Epic-1 set below and wires them into CI.
       - If 1.1 shipped its AC-14 as an inline `grep` with inline `--exclude-dir` flags instead,
         this story lifts that command's patterns and exclusions **verbatim** into
         `scripts/retired-names.json` and deletes nothing else: 1.1's grep was a one-time gate at
         its own merge, and the guard becomes the standing CI check. The two must agree
         literally — same 5-file `shadchanim.contacts` allowlist, same `admin/` + `ui/`
         exclusions — or the epic ends with two different definitions of "retired".

    b. **The pattern list covers every name Epic 1 retires**, in snake_case, bare and
       camelCase/PascalCase compound form:
       - 1.1 fossils: `contacts`, `contact_notes`, `contact_id`, `companies`, `company_id`,
         `company_name`, `contacts_summary`, `companies_summary`, `nb_contacts`, `deals`,
         `deal_notes`, `deal_id`, `nb_deals`, `tags`, `favicons_excluded_domains`,
         `merge_contacts`, `activity_log`, `position_at_company`;
       - 1.2: `sales`, `sales_id`, `Sale`, plus `[A-Za-z]Sale|Sale[A-Za-z]`;
       - 1.3: `children`, `child_id`, `Child`, `children_summary`, `private_child`, plus
         `[A-Za-z]Child|Child[A-Za-z]`;
       - 1.4: `child_portal_tokens`, `get_child_portal`, `set_child_portal_token_defaults`.

       The camelCase alternation is **mandatory**, not decorative: a `\bchild\b`-style pattern
       silently misses `isChildVisibleState` (`shidduchim/pipelineStates.ts:142`),
       `ChildSwitcherPill`, `ChildSummary`, `selectedChildId`, `setChildId`,
       `enrichChildrenSummary`, `ShidduchimNoChildren` and `desktopChildSwitcherStep` — all of
       which exist on `main` today across `children/ChildList.tsx`, `dashboard/Dashboard.tsx`,
       `dashboard/MobileDashboard.tsx`, `dashboard/useDashboardData.ts`, `layout/TopBar.tsx`,
       `shidduchim/{pipelineStates.ts,ShidduchimList.tsx}`, `tour/tourSteps.ts`, `types.ts` and
       both fakerest providers.

    c. **The allowlist is exact and enumerated**, and nothing else is exempt:
       - the **live** `shadchanim.contacts` jsonb column — `supabase/schemas/01_tables.sql`,
         `src/components/atomic-crm/types.ts`, `shadchanim/shadchanUtils.ts`,
         `shadchanim/shadchanUtils.test.ts`, `shadchanim/ShadchanHeader.tsx` (the same 5 files
         story 1.1's AC-14 allowlists — verified present today);
       - vendored JSDoc in the two mutable-dependency trees `src/components/admin/` and
         `src/components/ui/` — **13 matching lines / 14 occurrences across 10 `admin/` files**
         today (`reference-input.tsx`, `array-field.tsx`, `array-input.tsx`, `badge-field.tsx`,
         `single-field-list.tsx`, `simple-form-iterator.tsx`, `text-array-input.tsx`,
         `autocomplete-array-input.tsx`, `reference-array-input.tsx`,
         `reference-array-field.tsx`), **0** in `ui/`; both are allowlisted as whole trees,
         matching 1.1 AC-14's `--exclude-dir=admin --exclude-dir=ui`
         [Source: AGENTS.md#Mutable Dependencies];
       - React's `children` — `{ children }`, `children?: ReactNode`, `props.children`,
         `React.Children`, `asChild`, and the CSS pseudo-classes `first-child` / `last-child`;
       - `supabase/migrations/` — append-only history, never rewritten (1.1 AC-16, 1.2 AC-14);
       - **the guard's own data file, `scripts/retired-names.json`** — allowlisted by that
         **exact path**, never by directory. `scripts/` is in scope (d), and the file by
         construction spells every retired name it exists to forbid (`sales_id`, `child_id`,
         `Child`, `contacts`, …), so without this entry `node scripts/check-retired-names.mjs`
         fails on itself and can never exit 0 (f). This is the same class of self-defeating gate
         the story avoids for its unit test by deriving identifiers at runtime (e) — the data file
         cannot use that escape, so it is exempted by path instead. Exempting the one path leaves
         every other file under `scripts/` — including `check-retired-names.mjs`, which reads its
         patterns from the JSON and must therefore contain none of them literally — fully checked.
       - Also legitimately containing the retired words, for the same "an assertion that a name is
         gone must spell the name" reason, and allowlisted by exact path:
         `supabase/tests/members_rename.sql` (1.2 AC-13) and
         `src/components/atomic-crm/providers/commons/i18nProvider.test.ts` (1.2 AC-9) — the two
         files 1.2's AC-14 gate `--exclude`s. Keeping the two gates literally in agreement is the
         point of (a).

       `reference` / `references` is **live domain vocabulary** and must never appear in the
       pattern list [Source: _bmad-output/specs/spec-myshadchan/glossary.md].

    d. **Scope:** `src/`, `supabase/schemas/`, `supabase/functions/`, `supabase/tests/`,
       `supabase/seed.sql`, `workers/`, `scripts/` and `e2e/`, minus the exact-path exemptions in
       (c). (`workers/` has zero hits for any of these patterns today, so adding it costs nothing
       and closes it for good. `scripts/` is in scope deliberately — that is what makes the
       `retired-names.json` exemption necessary rather than optional.)

    e. **The guard has its own unit test**, to the same standard AC-10 sets for
       `check-suppressions.mjs`: `scripts/check-retired-names.test.mjs` under the `scripts`
       vitest project asserts that a retired snake_case name fails, that a camelCase compound
       (`selectedChildId`) fails, that an allowlisted file's `shadchanim.contacts` hit passes,
       that a React `children` prop passes, and that a `reference` / `references` domain hit
       passes. Like AC-10's test it builds its invalid input in a temp directory and points the
       guard at it, and it **derives the offending identifiers from `scripts/retired-names.json`
       at runtime rather than hard-coding them** — a committed fixture (or test source) containing
       `selectedChildId` or `sales_id` would make the guard fail on itself once `scripts/` is in
       scope (AC-12d), and deriving them keeps the test correct as the list evolves. One of its
       cases asserts the (c) exemptions bite: a file at the exact path
       `scripts/retired-names.json` full of retired names passes, while the same content at
       `scripts/anything-else.json` fails.

    f. `node scripts/check-retired-names.mjs` exits 0 on the post-Epic-1 tree and is its own CI
       step.

13. **The one dead export Epic 1 leaves behind is deleted (NFR-14).** `useGetMemberName`
    (`src/components/atomic-crm/members/useGetMemberName.ts`; today
    `sales/useGetSalesName.ts`) is **deleted**. **This story takes it explicitly** rather than
    trusting a gate to find it: story 1.2 scope-call #3 deferred the decision here, and nothing
    in this story would otherwise catch it — ESLint's `no-unused-vars` does not flag an unused
    *export*, there is no `knip` / `ts-prune` in the tree and this story adds no dependency
    (Project Structure Notes), and AC-12's guard fires on retired *names*, not on dead code.
    Verified on `main`: the hook has exactly **10 importers**, and story 1.1 deletes every one of
    them — `activity/ActivityLogCompanyCreated.tsx`, `activity/ActivityLogContactCreated.tsx`,
    `activity/ActivityLogContactNoteCreated.tsx`, `activity/ActivityLogDealCreated.tsx`,
    `activity/ActivityLogDealNoteCreated.tsx`, `companies/CompanyAside.tsx`,
    `contacts/ContactBackgroundInfo.tsx`, `notes/Note.tsx`, `notes/NoteShowPage.tsx`,
    `notes/NotesIteratorMobile.tsx`. It reaches this story with zero call sites. There is no
    barrel re-export to clean up: `sales/index.ts` exports only the resource object.
    Verification: LSP `findReferences` on `useGetMemberName` returns nothing, the file does not
    exist, and `npm run typecheck` is green. If story 1.2 already deleted it, this AC is
    satisfied by its absence — do not recreate it.

14. **Final verification sweep.** All of the following exit 0, from a clean checkout with the
    local Supabase stack up, and their outputs are pasted into Completion Notes:
    `npm run typecheck` · `npm run lint` · `npm run prettier` · `npm run test` ·
    `npm run test:unit:db` · `node scripts/check-suppressions.mjs` ·
    `node scripts/check-retired-names.mjs` · `make test-e2e-ci` · `npm run build`.
    No alias, wrapper script, compatibility shim, `--no-verify`, `continue-on-error` or
    `|| true` is used anywhere to reach that state.

---

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the prerequisite and re-measure (AC: 1)**
  - [ ] Confirm the pinned order held and that 1.1, 1.4, 1.5, 1.3 and 1.2 are all merged into the
        working base; otherwise stop with `BLOCKED: awaiting 1.x`.
  - [ ] Re-run and capture: `npm run typecheck`; `npx eslint "**/*.{mjs,ts,tsx}" --format json`
        (count files/errors/warnings); `npm run prettier`;
        `npx vitest --config vitest.config.ts --run`; each `npm run test:unit:*`; `npm run build`.
  - [ ] Re-run the suppression census and record per-tree counts:
        `grep -rn "eslint-disable" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" src/ workers/ supabase/ e2e/ scripts/ .claude/`
        and the same for `@ts-ignore\|@ts-expect-error\|@ts-nocheck`.
  - [ ] Write the re-measured numbers into Completion Notes before changing anything — they are
        the ratchet values for AC-10.

- [ ] **Task 2 — Close the typecheck coverage hole (AC: 2, 3)**
  - [ ] Extend `tsconfig.node.json` (or add one sibling project) to include `e2e/**/*.ts`,
        `playwright.config.ts`, `vitest.config.ts`, `vite.config.ts`, `vite.demo.config.ts`,
        `.storybook/*.ts`, `supabase/tests/**/*.ts`; keep `strict`, `noUnusedLocals`,
        `noUnusedParameters`, `noFallthroughCasesInSwitch` on.
  - [ ] Add `"types": ["node", "vitest/globals"]` and the `@/*` path alias so the probe result
        (0 errors) reproduces.
  - [ ] Add an explicit `exclude` for `supabase/functions/**` with a one-line comment: Deno
        runtime, `jsr:`/`https:` specifiers and the `Deno` global — 111 `tsc` errors, checked by
        ESLint and the `functions` vitest project instead.
  - [ ] Add the new project to the `npm run typecheck` script and to `tsconfig.json` `references`.
  - [ ] Verify with `--listFiles`.

- [ ] **Task 3 — Make lint warning-free (AC: 4)**
  - [ ] Delete `.eslintignore`; move any still-relevant pattern into `ignores` in
        `eslint.config.js`.
  - [ ] Add `--max-warnings=0` to the `lint` script (and to `lint:apply`'s sibling if relevant).
  - [ ] Re-run and confirm 0/0 and no `ESLintIgnoreWarning`.

- [ ] **Task 4 — Make prettier green (AC: 5)**
  - [ ] Add `mockup/`, `design-artifacts/`, `_bmad/`, `.claude/skills/` to `.prettierignore`;
        prune the dead react-admin-era entries (`packages/create-react-admin/templates/**`,
        `examples/**`, `cypress/*`, `.yarn/*`, `docs/_site/`) — none exists in this repo (NFR-14).
  - [ ] Run `npm run prettier:apply`, then `npm run prettier` to confirm exit 0.
  - [ ] Confirm no `src/`, `workers/`, `supabase/`, `e2e/` or `scripts/` path was ignored.
  - [ ] Note the `src/components/ui/*.tsx` prettier override (`semi: false`) — reformatting
        `src/components/ui/spinner.tsx` will strip semicolons; that is the configured intent.

- [ ] **Task 5 — Make the vitest suite warning-free and skip-free (AC: 6)**
  - [ ] If `src/components/atomic-crm/providers/commons/getContactAvatar.test.ts` survived 1.1,
        hoist the `vi.mock(...)` out of `beforeAll` to module top level; if 1.1 deleted it,
        confirm the warning is gone.
  - [ ] If `src/components/atomic-crm/contacts/ContactList.test.tsx` survived 1.1, un-skip
        line 39 or delete the case — never leave it skipped.
  - [ ] Re-run and confirm no `^Warning:` line and no unconditional skip.

- [ ] **Task 6 — Restore one real e2e smoke spec (AC: 7)**
  - [ ] Confirm story 1.1 deleted the three fossil specs and that `e2e/` now holds only
        `fixtures.ts`; confirm `npx playwright test` in that state exits **1** with
        `Error: No tests found` — that is precisely the failure this task prevents.
  - [ ] Do **not** delete `e2e/`, the `e2e-test` job (`.github/workflows/check.yml:97-116`) or the
        `test-e2e` / `test-e2e-ci` targets (`makefile:121-126`).
  - [ ] Extend `e2e/fixtures.ts` with a `createSingle` helper — there is none today. Two traps:
        (a) the pipeline route renders the "no singles yet" empty state, not the board, when the
        account has zero singles (`shidduchim/ShidduchimList.tsx:36,143-155` today), so the seed
        is what makes the assertion meaningful; (b) the fixture's service-role client bypasses the
        `set_account_id_default` trigger, whose `current_account_id()` is NULL for `service_role`,
        so `account_id` must be read off the signed-up member and passed explicitly.
  - [ ] Add `e2e/pipeline.spec.ts`: seed member + one single → sign in via the email/password form
        on `/#/login` → click the `Pipeline` nav entry → assert the `data-tour="pipeline-board"`
        container and at least one `PIPELINE_STATES` column label are visible.
  - [ ] Deterministic waits only (`expect(locator).toBeVisible()`, `waitForResponse`); no
        `waitForTimeout`, no `test.skip`, no `test.fixme` — AC-10's ratchet fails on all three.
  - [ ] Run it on both Playwright projects: locally via `make start-e2e` + `npx playwright test`,
        then `make test-e2e-ci`. Confirm ≥1 passing test per project in the `list` reporter.

- [ ] **Task 7 — Fix the vitest project set and the npm scripts (AC: 8)**
  - [ ] Delete the `claude` project from `vitest.config.ts`, its `test:unit:claude` script, its
        paragraph in the config's header comment, and the `.claude/**` entry from the `app`
        project's `exclude` — unless 1.1–1.5 added `.claude/**/*.test.mjs` files.
  - [ ] Add a `scripts` project (`environment: "node"`, `include: ["scripts/**/*.test.mjs"]`) plus
        a `test:unit:scripts` script — it is the home for the two guard tests (Tasks 10, 11).
  - [ ] Add `scripts/**` to the `app` project's `exclude`: `app` uses vitest's default `include`,
        which would otherwise pull those Node tests into the browser runner.
  - [ ] Change `test:unit:app` to pass `--project app`.
  - [ ] Add `"test": "vitest --config vitest.config.ts --run"` and point `make test` at it;
        remove the now-redundant `test-unit`/`test-app`/`test-functions`/`test-workers` fan-out
        in the `makefile` if it no longer earns its keep. Leave `test-e2e` / `test-e2e-ci` alone.

- [ ] **Task 8 — Make the db suite fail loudly instead of skipping (AC: 9)**
  - [ ] In each surviving `supabase/tests/*.test.ts`, change the unreachable branch to throw
        when `process.env.CI` is set, keeping the local-dev skip.
  - [ ] Do not touch `supabase/tests/child_portal.{sql,test.ts}` — Story 1.4 deletes them.
  - [ ] Verify: stack up → suites run; `CI=1` with stack down → non-zero exit.

- [ ] **Task 9 — Remove line-level suppressions that are really config bugs (AC: 10)**
  - [ ] Add a `no-console` override in `eslint.config.js` for `scripts/**` and
        `supabase/functions/**` (server/CLI code legitimately logs).
  - [ ] Delete the 6 now-redundant `// eslint-disable-next-line no-console` comments in
        `supabase/functions/mcp/index.ts` (321, 376, 482, 521) and
        `scripts/supabase-remote-init.mjs` (162, 212).
  - [ ] Set `linterOptions: { reportUnusedDisableDirectives: "error" }` and fix whatever it
        surfaces by **deleting** the dead directive.

- [ ] **Task 10 — Write the suppression ratchet and its test (AC: 10)**
  - [ ] Add `scripts/check-suppressions.mjs`: per-tree budgets for `eslint-disable`,
        `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, seeded with Task 1's re-measured
        numbers; plus a hard zero for unconditional `it.skip` / `describe.skip` /
        `test.skip("…")` / `.only(` / `.todo(` / `.fixme(` / `xit(` / `xdescribe(` in test files.
  - [ ] Give it a scan-root argument defaulting to `process.cwd()`, so the test can point it at a
        temp tree.
  - [ ] Keep it ≤ ~150 lines, no new dependency, exit 1 with a diff-style message naming the
        offending file and tree.
  - [ ] Add `scripts/check-suppressions.test.mjs` under the `scripts` project: build the input
        with `fs.mkdtemp` and assert over-budget fails, at-budget passes, unconditional skip
        fails, conditional `test.skip(cond, reason)` passes. This test — not a working-tree
        seed-and-revert — is the evidence that the gate bites.
  - [ ] Compose the offending literals at runtime from the guard's own pattern list. A literal
        `it.skip("…")` typed into the test source would be found by the guard's repo-wide run
        over `scripts/` and fail its own test.

- [ ] **Task 11 — Land the retired-name guard on one shared artifact (AC: 12)**
  - [ ] Check what story 1.1 shipped for its AC-14 gate. If it created
        `scripts/retired-names.json` + `scripts/check-retired-names.mjs`, **extend** them; if it
        shipped an inline `grep` with `--exclude-dir=admin --exclude-dir=ui`, lift that command's
        patterns and exclusions verbatim into the JSON and create the script here. Never a second
        list or a second script (NFR-14).
  - [ ] Put the full Epic-1 pattern set from AC-12(b) into `scripts/retired-names.json`, including
        the `[A-Za-z]Child|Child[A-Za-z]` and `[A-Za-z]Sale|Sale[A-Za-z]` alternations —
        `\bchild\b` alone misses `isChildVisibleState`, `selectedChildId`, `ChildSwitcherPill`,
        `enrichChildrenSummary`, `ShidduchimNoChildren`, `desktopChildSwitcherStep`,
        `ChildSummary` and `setChildId`.
  - [ ] Put the allowlist from AC-12(c) in the same file: the 5 `shadchanim.contacts` files, the
        `src/components/admin/` and `src/components/ui/` trees, the React-`children` forms, and
        `supabase/migrations/`. Keep `reference` / `references` out of the pattern list entirely.
  - [ ] Give the guard the same scan-root argument, then add
        `scripts/check-retired-names.test.mjs` covering the five cases in AC-12(e), with the
        invalid input built in a temp directory and the offending identifiers **read out of
        `scripts/retired-names.json` at runtime** — a committed fixture, or a hard-coded
        `selectedChildId` in the test source, would make the guard fail on its own test once
        `scripts/` is in scope.
  - [ ] Confirm `node scripts/check-retired-names.mjs` exits 0 on the post-Epic-1 tree.

- [ ] **Task 12 — Delete the dead `useGetMemberName` hook (AC: 13)**
  - [ ] Run LSP `findReferences` on `useGetMemberName` (post-1.2 name of `useGetSalesName`) and
        confirm zero call sites — story 1.1 deleted all 10 importers.
  - [ ] Delete `src/components/atomic-crm/members/useGetMemberName.ts`. There is no barrel
        re-export to clean (`members/index.ts` exports only the resource object) — confirm that
        is still true, then re-run `npm run typecheck`.
  - [ ] If story 1.2 already deleted it, record that in Completion Notes and move on.

- [ ] **Task 13 — Rebuild the CI gates so a red gate fails the build (AC: 11, 12)**
  - [ ] Replace the `lint` job's `wearerequired/lint-action@v3` step with plain
        `run: npm run lint` and `run: npm run prettier` steps.
  - [ ] Split the test job into one step per vitest project, each with `--project <name>`
        (including the new `scripts` project).
  - [ ] Add a job that boots the local Supabase stack and runs `npm run test:unit:db` (reuse the
        `make start-supabase-e2e` pattern already used by the `e2e-test` job).
  - [ ] Add steps for `node scripts/check-suppressions.mjs` and
        `node scripts/check-retired-names.mjs`.
  - [ ] Leave the `e2e-test` job in place and confirm it is green against the new smoke spec.
  - [ ] Confirm
        `grep -nE "continue-on-error|continue_on_error|\|\| true|--no-verify|wearerequired" .github/workflows/check.yml`
        returns nothing, and that the CI prettier glob is byte-identical to the
        `npm run prettier` glob.

- [ ] **Task 14 — Prove it (AC: 11, 14)**
  - [ ] Run `npm run test:unit:scripts` and confirm both guard tests pass — they are the
        proof-that-it-bites artifact; no file is mis-formatted or suppressed in the working tree
        for evidence.
  - [ ] Run the full AC-14 command list from a clean tree with Supabase up; paste outputs into
        Completion Notes.

---

## Dev Notes

### Where this story sits

Story 1.6 is the closing gate of Epic 1 — *"Remove every trace of the Atomic CRM fork and make
the schema describe shidduchim honestly, so that every later epic is smaller"*
[Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth]. It
changes **no product behaviour**. Its entire deliverable is that the gates are green and that CI
cannot go quietly red again. Anything that looks like feature work, a schema change or a
behaviour change belongs to another story.

Two deliberate exceptions to "touches no product code", both forced by the cross-check and both
narrow:

- **AC-7** adds `e2e/pipeline.spec.ts` (and a `createSingle` fixture helper). Story 1.1 deletes
  the last three Playwright specs, and an empty `testDir` makes `npx playwright test` exit 1 —
  so the choice is between deleting the `e2e-test` job and giving it one real test. Epic 1 ends
  with a CI job that proves a user can sign in and see the pipeline, not with one deleted.
- **AC-13** deletes `useGetMemberName`, whose last 10 importers go with story 1.1. Story 1.2
  explicitly deferred the call here; a zero-call-site export is dead code under NFR-14, and no
  gate in this story would ever surface it.

**Hard dependency — and the pinned order.** Epic 1 runs in a fixed sequence:

> **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**

1.1 (delete fossil resources), 1.4 (retire the token portal), 1.5 (remove dead routes), 1.3
(`children` → `singles`) and 1.2 (`sales` → `members`) must all land, in that order, before this
story starts. 1.6 is **6th and last** and depends on all five. Measuring the baseline before they
land produces numbers that are wrong in both directions: files that will be deleted, and files
that will be created. The immediate predecessor is **1.2**, so every "re-measure" in this story is
a post-1.2 measurement.

### Greenfield rules that bind every task

- **NFR-14 / SPEC constraint:** *"no backwards compatibility, deprecation shims, fallbacks or
  aliased names; when something is replaced the replaced thing is deleted in the same change."*
  [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints;
  ARCHITECTURE-SPINE.md#AD-23]. Applied here: the dead `claude` vitest project is **deleted**,
  not left with a placeholder test; `.eslintignore` is **deleted**, not emptied; dead
  `.prettierignore` entries are pruned in the same change.
- **AD-23:** *"CI fails on a reference to a retired name."*
  [Source: ARCHITECTURE-SPINE.md#AD-23]. AC-12 is the CI half of that promise; 1.1–1.4 own the
  deletions themselves, and `scripts/retired-names.json` is the one place the retired vocabulary
  is written down for both halves.
- **AD-1:** *"CI asserts every `public` table has `rowsecurity = true` … each table's migration
  adds its RLS in the same migration."* [Source: ARCHITECTURE-SPINE.md#AD-1]. That assertion
  already exists in SQL —
  `supabase/tests/references_entity.sql:686` (`'RLS is enabled on every new table'`) — but it has
  **never run in CI**, because the `db` project self-skips on a runner with no Postgres. AC-9
  turns the promise into a fact. This is the single highest-value change in the story.
- **Coding style rule:** "many small files over few large files, 200–400 typical, 800 max"
  [Source: .claude/rules/coding-style.md] — keep `scripts/check-suppressions.mjs` and
  `scripts/check-retired-names.mjs` small and focused, and keep the shared pattern data out of
  both of them, in `scripts/retired-names.json`.
- **NFR-14 applies to dead code, not just to aliases.** AC-13 deletes `useGetMemberName` rather
  than parking it "for the members resource" — an export with zero call sites after 1.1 is the
  replaced thing surviving the replacement.

### Migration workflow (this story must produce **no** migration)

No task here changes the schema. Recorded anyway, because if the dev believes a migration is
needed, the change belongs to a different story and they should stop and say so:

- `supabase/schemas/*.sql` is the source of truth; migrations are generated, never hand-authored
  from scratch [Source: AGENTS.md#Database Management].
- Generate with
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f <name>`, then apply with
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. **Never** `db reset`
  or `db push` — the first is destructive, the second is the deploy path.
- The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory: without it every `npx supabase`
  call hangs on the keyring and looks like a Docker fault
  [Source: user memory — *Supabase CLI D-Bus hang*].
- `db diff` historically **drops `security_invoker = on` from views and omits `REVOKE`
  statements**, so any generated migration must be hand-checked and the missing lines restored
  before it is applied.
- Every RLS-touching change needs a **negative** test (a cross-account / cross-context read that
  must return zero rows), added to the matching `supabase/tests/*.sql` suite
  [Source: ARCHITECTURE-SPINE.md#Consistency Conventions — "RLS test suite per table (incl.
  cross-account attempts from a Worker)"].

### The retired-name guard: one artifact, and the two traps

**One artifact.** The pattern list and the allowlist are written down exactly once, in
`scripts/retired-names.json`, and read by two consumers: story 1.1's AC-14 fossil-word gate and
this story's `scripts/check-retired-names.mjs`. Two hand-maintained copies of the same list drift
within one epic — and 1.1's allowlist (5 `shadchanim.contacts` files, plus the
`src/components/admin/` JSDoc tree) is exactly the allowlist this guard needs. If 1.1 shipped the
file, extend it; if not, create it here. Never both.

**Trap 1 — React's `children`.** A naive `grep -rn "children" src/` explodes: the JSX prop appears
in hundreds of components and is **not** a retired name. The guard must distinguish:

- **retired (fail):** the resource string `"children"` in a route or dataProvider key; the SQL
  identifier `public.children`, `children.` column refs, `child_id`, `children_summary`,
  `private_child`, `child_portal_tokens`, `get_child_portal`,
  `set_child_portal_token_defaults`; the directory `src/components/atomic-crm/children/`; the
  type name `Child`.
- **allowed (pass):** `children` as a JSX prop or React type (`{ children }`,
  `children?: ReactNode`, `props.children`, `React.Children`), `asChild`, and the CSS
  pseudo-classes `first-child` / `last-child`.

**Trap 2 — camelCase compounds escape word-boundary patterns.** `\bchild\b` / `\bchild(ren)?\b`
cannot match inside an identifier, so a guard built only from word-boundary patterns silently
passes a tree still full of retired vocabulary. On `main` today that blind spot hides
`isChildVisibleState` (`shidduchim/pipelineStates.ts:142`), `ChildSwitcherPill`, `ChildSummary`,
`selectedChildId`, `setChildId`, `enrichChildrenSummary`, `ShidduchimNoChildren` and
`desktopChildSwitcherStep`, across `children/ChildList.tsx`, `dashboard/Dashboard.tsx`,
`dashboard/MobileDashboard.tsx`, `dashboard/useDashboardData.ts`, `layout/TopBar.tsx`,
`shidduchim/{pipelineStates.ts,ShidduchimList.tsx}`, `tour/tourSteps.ts`, `types.ts` and both
fakerest providers. The guard therefore carries `[A-Za-z]Child|Child[A-Za-z]` (and the
`Sale` equivalent) alongside the word-boundary patterns.

Note also the collision between the retired `contacts` fork table and the *live* `references`
entity — `reference` is first-class domain vocabulary
[Source: _bmad-output/specs/spec-myshadchan/glossary.md] and must never enter the pattern list;
likewise `shadchanim.contacts` is a live jsonb column, which is why the 5-file allowlist exists.

Per the LSP rule, symbol-level questions ("where is `Child` used") go through the `LSP` tool
(`findReferences`, `workspaceSymbol`), not `grep`; `grep`/`rg` is correct for the SQL, string
and non-TS sweeps the guard performs [Source: .claude/rules/lsp-usage.md].

### Files another Epic 1 story also touches — expect churn

| File / tree | Also touched by | Consequence for 1.6 |
|---|---|---|
| `src/components/atomic-crm/{contacts,companies,deals,tags}/` (88 files, 7 test files) | 1.1 | Removes 2 prettier failures, 3 `eslint-disable`s, 1 `@ts-expect-error`, the only unconditional `it.skip`, and 7 test files |
| `src/components/atomic-crm/dashboard/DealsChart.tsx` | 1.1 | Removes 1 `@ts-expect-error` |
| `src/components/atomic-crm/providers/commons/{getContactAvatar,getCompanyAvatar,mergeContacts}.*` | 1.1 | Likely removes the only test-runner warning |
| `src/components/atomic-crm/providers/fakerest/dataProvider.ts` + `dataGenerator/` | 1.1, 1.2, 1.3, 1.4 | Heavy churn — re-measure prettier after they land |
| `src/components/atomic-crm/sales/` (6 files) | 1.2 | Renamed to `members` |
| `src/components/atomic-crm/children/` (9 files) | 1.3 | Renamed to `singles` |
| `src/components/atomic-crm/portal/` (13 files, 3 test files) + `supabase/tests/child_portal.{sql,test.ts}` + `dataProvider.childPortal.test.ts` | 1.4 | Removes 1 db suite and 4 app test files |
| `src/components/atomic-crm/root/CRM.tsx`, `layout/navItems.ts` + `navItems.test.ts` | 1.1, 1.3, 1.4, 1.5 | Registration points; 1.5 adds the "no empty route" check that 1.6 must ensure CI runs |
| `e2e/*.spec.ts` | 1.1 deletes all three | **1.6 owns the outcome (AC-7):** `e2e/` and the `e2e-test` job stay; 1.6 adds `e2e/pipeline.spec.ts` so Playwright has ≥1 test and the job stays meaningful |
| `e2e/fixtures.ts` | 1.1 (prunes fossil tables + `createNotes`/`createCompany`/`createContact`), 1.2 (`createSales` → `createMember`, `sales` → `members`) | 3 of the 6 `no-empty-pattern` disables (lines 227, 234, 238, 242, 246, 250 today) go with the deleted fixtures, leaving 3. 1.6 adds a `createSingle` helper and no new suppression |
| `.github/workflows/check.yml` | 1.5 (route check), 1.1 (retired-name guard + `scripts/retired-names.json`) | **1.6 owns the final shape.** Wire in whatever guards they added; do not create a second copy |
| `scripts/retired-names.json`, `scripts/check-retired-names.mjs` | 1.1 (creates them for its AC-14 gate) | 1.6 extends the pattern list to the full Epic-1 set, adds the allowlist and the unit test, and wires the guard into CI |
| `vitest.config.ts` | none expected | 1.6 owns it |

### Testing standards

- Vitest, AAA, descriptive behaviour names, no shared mutable state, reset mocks in `beforeEach`
  [Source: .claude/rules/testing.md]. The two new guard tests follow this.
- **Guard tests use a temp tree, not a committed fixture.** Both
  `scripts/check-suppressions.test.mjs` and `scripts/check-retired-names.test.mjs` build their
  deliberately-invalid input with `fs.mkdtemp` and point the guard at it through its scan-root
  argument. A committed fixture file containing retired names or stray `eslint-disable`s would be
  picked up by the guards' own repo-wide run and by the lint gate — the guard would fail on
  itself. This replaces the "seed a violation and revert it" step: that leaves no artifact, is
  invisible in review, and cannot be re-run.
- Playwright: deterministic waits only; never `waitForTimeout`; a flaky test must be quarantined
  with `test.fixme()` **and a tracking reference** — note that AC-10's guard fails on `.fixme(`,
  so quarantining now requires an explicit, visible budget bump rather than a silent one. That is
  intentional, and it applies to the new `e2e/pipeline.spec.ts` too: it must be genuinely stable
  on both Playwright projects, not skipped on mobile
  [Source: .claude/skills/playwright-testing; .claude/skills/e2e-conventions].
- ≥80% coverage on new code paths [Source: .claude/rules/testing.md] — applies to the two guard
  scripts, which are the only new *product-adjacent* code in this story.

### Scope ambiguity — flagged, not guessed

1. **`"@typescript-eslint/no-explicit-any": "off"` (global).** `eslint.config.js` disables the
   `any` ban everywhere except `src/components/admin/*`, `src/hooks/*`, `src/lib/*`. This is a
   config-level suppression, arguably in the spirit of "no suppressions", and it collides with
   the Worker convention *"validate every boundary with Zod (no `any`; `unknown`+narrow)"*
   [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]. Turning it on repo-wide is a
   multi-hundred-site change and is **not** in this story. **Recommendation:** turn it on for
   `workers/**` only (currently 0 `eslint-disable`s there — measure first; if it is already
   clean the change is free). If it is not clean, leave it and raise it as an Epic 2 item.
2. **`npm run build` prints a rollup ">500 kB chunk" warning.** Build is a separate CI job and is
   not named in the epic's AC ("typecheck, lint, prettier and the full test suite"). Bundle
   splitting is a real change with real risk. **Not in scope**; recorded here so the dev does not
   chase it, and so nobody later claims 1.6 signed off on it.
3. **Formatting 26 files under `src/components/admin/`.** That tree is a *mutable dependency*
   (shadcn-admin-kit) that the project is explicitly allowed to edit [Source: AGENTS.md#Mutable
   Dependencies], and it holds 54 of the 89 `eslint-disable`s. Formatting it is in scope
   (AC-5 forbids ignoring anything under `src/`); **removing its suppressions is not** — they are
   upstream framework debt, and the ratchet simply freezes them at their current count. The same
   tree is allowlisted wholesale by the retired-name guard (AC-12c) for the 13 fossil-word JSDoc
   lines (14 occurrences) across 10 of its files — the same exclusion 1.1 AC-14 applies.
4. **Whether the `db` CI job should boot the full local stack or a bare Postgres.** The e2e job
   already boots a Supabase instance via `make start-supabase-e2e`, so reuse is the cheap path;
   a bare `postgres:15` service container would be faster but would not have the migrations
   applied. **Dev's call** — AC-9 only requires that the suites genuinely execute and that an
   unreachable DB fails under `CI`.
5. **Deleting the `claude` vitest project.** `.claude/hooks/` does not exist and
   `.claude/settings.json` declares no hooks, so the project is dead config today. But
   `CLAUDE.md` describes hooks in `.claude/settings.json` / `.claude/hooks/` as `.mjs` modules,
   which suggests the harness *expects* them. **If 1.1–1.5 (or the harness) added hook files,
   keep the project and make its script pass instead of deleting it** — AC-8 permits both.
   Either way a **`scripts`** project is added: it is where the two guard tests live, and it is a
   real project with real files, so it does not reintroduce the problem AC-8 exists to fix.
6. **What "sign in → see the pipeline" means for the e2e smoke spec (AC-7).** The route renders
   the empty state, not the board, when the account has no singles, so the spec must seed one —
   which means `e2e/fixtures.ts` needs a `createSingle` helper it does not have today. **Dev's
   call** on whether that helper inserts directly (service-role, explicit `account_id`) or drives
   the UI; AC-7 only requires that the spec genuinely signs in, genuinely reaches the board, and
   passes on both Playwright projects without a skip.

### Project Structure Notes

- Namespaces stay as declared: `src/components/atomic-crm/<domain>/` per resource,
  `providers/{supabase,fakerest,commons}/` as the CRUD seam, `workers/<name>/`,
  `supabase/schemas/` as the DB source of truth [Source: ARCHITECTURE-SPINE.md#Design Paradigm].
  This story adds files in exactly two places, alongside the five existing `scripts/*.mjs`:
  - `scripts/` — `check-suppressions.mjs` + `check-suppressions.test.mjs`,
    `check-retired-names.mjs` + `check-retired-names.test.mjs`, and the shared data file
    `retired-names.json` (the last three only if story 1.1 did not already create them);
  - `e2e/` — `pipeline.spec.ts`, plus a `createSingle` helper inside the existing `fixtures.ts`.

  It deletes exactly one product file: `members/useGetMemberName.ts` (AC-13). No other
  `src/` file is created or deleted by this story.
- No new dependency may be added. The ratchet is plain Node; there is no
  `eslint-plugin-eslint-comments` in the tree and none is to be introduced. The same rule rules
  out `knip` / `ts-prune` for AC-13 — the dead export is deleted by name, not discovered by a
  tool.
- Committed content is English-only, including the new scripts' messages, the new spec's test
  names and any comment added to a tsconfig or CI file [Source: .claude/rules/english-only.md].
- Detected variance: `.eslintignore` and several `.prettierignore` entries
  (`packages/create-react-admin/templates/**`, `examples/**`, `cypress/*`, `docs/_site/`) are
  react-admin-upstream leftovers describing paths that do not exist here. Pruning them is part of
  this story's debt clearance (NFR-14), not an unrelated drive-by.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Establish the tidy-code baseline]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth] — Stories 1.1–1.5, the prerequisites; pinned order **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md] — G1 (e2e job goes red when 1.1 deletes the specs), W4 (retired-name guard under-specified, collides with 1.1's allowlist), W6 ("prove the assertion bites" leaves no artifact), V1 (`useGetMemberName` punted here), O1/O2/O4 (the ordering hazards the pinned order resolves)
- [Source: _bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md#AC-14] — the fossil-word grep and its 5-file `shadchanim.contacts` allowlist, which AC-12 shares
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Greenfield engineering standard … no backwards compatibility, deprecation shims, fallbacks or aliased names"
- [Source: ARCHITECTURE-SPINE.md#AD-23] — entities named for what they hold; "CI fails on a reference to a retired name"
- [Source: ARCHITECTURE-SPINE.md#AD-1] — "CI asserts every `public` table has `rowsecurity = true`"; deny-by-default RLS
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — files/testing row (≥80% new-code coverage, AAA, RLS suite per table); Worker validation row (no `any`)
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md] — `single`, `shidduch`, `reference`, and the deliberately unused fork words
- [Source: AGENTS.md#Database Management] — declarative schema, `db diff` / `migration up`
- [Source: AGENTS.md#Mutable Dependencies] — `src/components/admin/`, `src/components/ui/`
- [Source: .claude/rules/testing.md] · [Source: .claude/rules/coding-style.md] · [Source: .claude/rules/lsp-usage.md] · [Source: .claude/rules/english-only.md]
- [Source: .claude/skills/playwright-testing] · [Source: .claude/skills/e2e-conventions] — web-first assertions, user-visible locators, fixtures, no timeout-based waits
- Repo files inspected for the baseline: `package.json`, `makefile`, `vitest.config.ts`,
  `eslint.config.js`, `.eslintignore`, `.prettierrc.json`, `.prettierignore`, `.lintstagedrc`,
  `.husky/pre-commit`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.workers.json`,
  `tsconfig.node.json`, `playwright.config.ts`, `.github/workflows/check.yml`,
  `.github/workflows/deploy.yml`, `supabase/tests/*.test.ts`, `supabase/tests/references_entity.sql`
- Repo files verified for the cross-check fixes: `e2e/` (4 files), `e2e/fixtures.ts`,
  `src/components/atomic-crm/layout/navItems.ts`,
  `src/components/atomic-crm/login/LoginPage.tsx`,
  `src/components/atomic-crm/shidduchim/{ShidduchimList.tsx,ShidduchimListContent.tsx,ShidduchColumn.tsx,pipelineStates.ts}`,
  `src/components/atomic-crm/sales/{index.ts,useGetSalesName.ts}` + its 10 importers,
  `src/components/atomic-crm/shadchanim/{shadchanUtils.ts,shadchanUtils.test.ts,ShadchanHeader.tsx}`,
  `src/components/admin/` (13 fossil-word JSDoc hits in 10 files), `src/components/ui/` (0 hits),
  `supabase/schemas/{01_tables,03_views,06_grants}.sql`, `workers/` (0 hits)

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
