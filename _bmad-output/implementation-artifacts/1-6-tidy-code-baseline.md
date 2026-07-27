---
baseline_commit: 3b00014d4f7e406701e4119c26d3413c898af485
---

# Story 1.6: Establish the tidy-code baseline

Status: review

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

- [x] **Task 1 — Confirm the prerequisite and re-measure (AC: 1)**
  - [x] Confirm the pinned order held and that 1.1, 1.4, 1.5, 1.3 and 1.2 are all merged into the
        working base; otherwise stop with `BLOCKED: awaiting 1.x`.
  - [x] Re-run and capture: `npm run typecheck`; `npx eslint "**/*.{mjs,ts,tsx}" --format json`
        (count files/errors/warnings); `npm run prettier`;
        `npx vitest --config vitest.config.ts --run`; each `npm run test:unit:*`; `npm run build`.
  - [x] Re-run the suppression census and record per-tree counts:
        `grep -rn "eslint-disable" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" src/ workers/ supabase/ e2e/ scripts/ .claude/`
        and the same for `@ts-ignore\|@ts-expect-error\|@ts-nocheck`.
  - [x] Write the re-measured numbers into Completion Notes before changing anything — they are
        the ratchet values for AC-10.

- [x] **Task 2 — Close the typecheck coverage hole (AC: 2, 3)**
  - [x] Extend `tsconfig.node.json` (or add one sibling project) to include `e2e/**/*.ts`,
        `playwright.config.ts`, `vitest.config.ts`, `vite.config.ts`, `vite.demo.config.ts`,
        `.storybook/*.ts`, `supabase/tests/**/*.ts`; keep `strict`, `noUnusedLocals`,
        `noUnusedParameters`, `noFallthroughCasesInSwitch` on.
  - [x] Add `"types": ["node", "vitest/globals"]` and the `@/*` path alias so the probe result
        (0 errors) reproduces.
  - [x] Add an explicit `exclude` for `supabase/functions/**` with a one-line comment: Deno
        runtime, `jsr:`/`https:` specifiers and the `Deno` global — 111 `tsc` errors, checked by
        ESLint and the `functions` vitest project instead.
  - [x] Add the new project to the `npm run typecheck` script and to `tsconfig.json` `references`.
  - [x] Verify with `--listFiles`.

- [x] **Task 3 — Make lint warning-free (AC: 4)**
  - [x] Delete `.eslintignore`; move any still-relevant pattern into `ignores` in
        `eslint.config.js`.
  - [x] Add `--max-warnings=0` to the `lint` script (and to `lint:apply`'s sibling if relevant).
  - [x] Re-run and confirm 0/0 and no `ESLintIgnoreWarning`.

- [x] **Task 4 — Make prettier green (AC: 5)**
  - [x] Add `mockup/`, `design-artifacts/`, `_bmad/`, `.claude/skills/` to `.prettierignore`;
        prune the dead react-admin-era entries (`packages/create-react-admin/templates/**`,
        `examples/**`, `cypress/*`, `.yarn/*`, `docs/_site/`) — none exists in this repo (NFR-14).
  - [x] Run `npm run prettier:apply`, then `npm run prettier` to confirm exit 0.
  - [x] Confirm no `src/`, `workers/`, `supabase/`, `e2e/` or `scripts/` path was ignored.
  - [x] Note the `src/components/ui/*.tsx` prettier override (`semi: false`) — reformatting
        `src/components/ui/spinner.tsx` will strip semicolons; that is the configured intent.

- [x] **Task 5 — Make the vitest suite warning-free and skip-free (AC: 6)**
  - [x] If `src/components/atomic-crm/providers/commons/getContactAvatar.test.ts` survived 1.1,
        hoist the `vi.mock(...)` out of `beforeAll` to module top level; if 1.1 deleted it,
        confirm the warning is gone.
  - [x] If `src/components/atomic-crm/contacts/ContactList.test.tsx` survived 1.1, un-skip
        line 39 or delete the case — never leave it skipped.
  - [x] Re-run and confirm no `^Warning:` line and no unconditional skip.

- [x] **Task 6 — Restore one real e2e smoke spec (AC: 7)**
  - [x] Confirm story 1.1 deleted the three fossil specs and that `e2e/` now holds only
        `fixtures.ts`; confirm `npx playwright test` in that state exits **1** with
        `Error: No tests found` — that is precisely the failure this task prevents.
  - [x] Do **not** delete `e2e/`, the `e2e-test` job (`.github/workflows/check.yml:97-116`) or the
        `test-e2e` / `test-e2e-ci` targets (`makefile:121-126`).
  - [x] Extend `e2e/fixtures.ts` with a `createSingle` helper — there is none today. Two traps:
        (a) the pipeline route renders the "no singles yet" empty state, not the board, when the
        account has zero singles (`shidduchim/ShidduchimList.tsx:36,143-155` today), so the seed
        is what makes the assertion meaningful; (b) the fixture's service-role client bypasses the
        `set_account_id_default` trigger, whose `current_account_id()` is NULL for `service_role`,
        so `account_id` must be read off the signed-up member and passed explicitly.
  - [x] Add `e2e/pipeline.spec.ts`: seed member + one single → sign in via the email/password form
        on `/#/login` → click the `Pipeline` nav entry → assert the `data-tour="pipeline-board"`
        container and at least one `PIPELINE_STATES` column label are visible.
  - [x] Deterministic waits only (`expect(locator).toBeVisible()`, `waitForResponse`); no
        `waitForTimeout`, no `test.skip`, no `test.fixme` — AC-10's ratchet fails on all three.
  - [x] Run it on both Playwright projects: locally via `make start-e2e` + `npx playwright test`,
        then `make test-e2e-ci`. Confirm ≥1 passing test per project in the `list` reporter.

- [x] **Task 7 — Fix the vitest project set and the npm scripts (AC: 8)**
  - [x] Delete the `claude` project from `vitest.config.ts`, its `test:unit:claude` script, its
        paragraph in the config's header comment, and the `.claude/**` entry from the `app`
        project's `exclude` — unless 1.1–1.5 added `.claude/**/*.test.mjs` files.
  - [x] Add a `scripts` project (`environment: "node"`, `include: ["scripts/**/*.test.mjs"]`) plus
        a `test:unit:scripts` script — it is the home for the two guard tests (Tasks 10, 11).
  - [x] Add `scripts/**` to the `app` project's `exclude`: `app` uses vitest's default `include`,
        which would otherwise pull those Node tests into the browser runner.
  - [x] Change `test:unit:app` to pass `--project app`.
  - [x] Add `"test": "vitest --config vitest.config.ts --run"` and point `make test` at it;
        remove the now-redundant `test-unit`/`test-app`/`test-functions`/`test-workers` fan-out
        in the `makefile` if it no longer earns its keep. Leave `test-e2e` / `test-e2e-ci` alone.

- [x] **Task 8 — Make the db suite fail loudly instead of skipping (AC: 9)**
  - [x] In each surviving `supabase/tests/*.test.ts`, change the unreachable branch to throw
        when `process.env.CI` is set, keeping the local-dev skip.
  - [x] Do not touch `supabase/tests/child_portal.{sql,test.ts}` — Story 1.4 deletes them.
  - [x] Verify: stack up → suites run; `CI=1` with stack down → non-zero exit.

- [x] **Task 9 — Remove line-level suppressions that are really config bugs (AC: 10)**
  - [x] Add a `no-console` override in `eslint.config.js` for `scripts/**` and
        `supabase/functions/**` (server/CLI code legitimately logs).
  - [x] Delete the 6 now-redundant `// eslint-disable-next-line no-console` comments in
        `supabase/functions/mcp/index.ts` (321, 376, 482, 521) and
        `scripts/supabase-remote-init.mjs` (162, 212).
  - [x] Set `linterOptions: { reportUnusedDisableDirectives: "error" }` and fix whatever it
        surfaces by **deleting** the dead directive.

- [x] **Task 10 — Write the suppression ratchet and its test (AC: 10)**
  - [x] Add `scripts/check-suppressions.mjs`: per-tree budgets for `eslint-disable`,
        `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, seeded with Task 1's re-measured
        numbers; plus a hard zero for unconditional `it.skip` / `describe.skip` /
        `test.skip("…")` / `.only(` / `.todo(` / `.fixme(` / `xit(` / `xdescribe(` in test files.
  - [x] Give it a scan-root argument defaulting to `process.cwd()`, so the test can point it at a
        temp tree.
  - [x] Keep it ≤ ~150 lines, no new dependency, exit 1 with a diff-style message naming the
        offending file and tree.
  - [x] Add `scripts/check-suppressions.test.mjs` under the `scripts` project: build the input
        with `fs.mkdtemp` and assert over-budget fails, at-budget passes, unconditional skip
        fails, conditional `test.skip(cond, reason)` passes. This test — not a working-tree
        seed-and-revert — is the evidence that the gate bites.
  - [x] Compose the offending literals at runtime from the guard's own pattern list. A literal
        `it.skip("…")` typed into the test source would be found by the guard's repo-wide run
        over `scripts/` and fail its own test.

- [x] **Task 11 — Land the retired-name guard on one shared artifact (AC: 12)**
  - [x] Check what story 1.1 shipped for its AC-14 gate. If it created
        `scripts/retired-names.json` + `scripts/check-retired-names.mjs`, **extend** them; if it
        shipped an inline `grep` with `--exclude-dir=admin --exclude-dir=ui`, lift that command's
        patterns and exclusions verbatim into the JSON and create the script here. Never a second
        list or a second script (NFR-14).
  - [x] Put the full Epic-1 pattern set from AC-12(b) into `scripts/retired-names.json`, including
        the `[A-Za-z]Child|Child[A-Za-z]` and `[A-Za-z]Sale|Sale[A-Za-z]` alternations —
        `\bchild\b` alone misses `isChildVisibleState`, `selectedChildId`, `ChildSwitcherPill`,
        `enrichChildrenSummary`, `ShidduchimNoChildren`, `desktopChildSwitcherStep`,
        `ChildSummary` and `setChildId`.
  - [x] Put the allowlist from AC-12(c) in the same file: the 5 `shadchanim.contacts` files, the
        `src/components/admin/` and `src/components/ui/` trees, the React-`children` forms, and
        `supabase/migrations/`. Keep `reference` / `references` out of the pattern list entirely.
  - [x] Give the guard the same scan-root argument, then add
        `scripts/check-retired-names.test.mjs` covering the five cases in AC-12(e), with the
        invalid input built in a temp directory and the offending identifiers **read out of
        `scripts/retired-names.json` at runtime** — a committed fixture, or a hard-coded
        `selectedChildId` in the test source, would make the guard fail on its own test once
        `scripts/` is in scope.
  - [x] Confirm `node scripts/check-retired-names.mjs` exits 0 on the post-Epic-1 tree.

- [x] **Task 12 — Delete the dead `useGetMemberName` hook (AC: 13)**
  - [x] Run LSP `findReferences` on `useGetMemberName` (post-1.2 name of `useGetSalesName`) and
        confirm zero call sites — story 1.1 deleted all 10 importers.
  - [x] Delete `src/components/atomic-crm/members/useGetMemberName.ts`. There is no barrel
        re-export to clean (`members/index.ts` exports only the resource object) — confirm that
        is still true, then re-run `npm run typecheck`.
  - [x] If story 1.2 already deleted it, record that in Completion Notes and move on.

- [x] **Task 13 — Rebuild the CI gates so a red gate fails the build (AC: 11, 12)**
  - [x] Replace the `lint` job's `wearerequired/lint-action@v3` step with plain
        `run: npm run lint` and `run: npm run prettier` steps.
  - [x] Split the test job into one step per vitest project, each with `--project <name>`
        (including the new `scripts` project).
  - [x] Add a job that boots the local Supabase stack and runs `npm run test:unit:db` (reuse the
        `make start-supabase-e2e` pattern already used by the `e2e-test` job).
  - [x] Add steps for `node scripts/check-suppressions.mjs` and
        `node scripts/check-retired-names.mjs`.
  - [x] Leave the `e2e-test` job in place and confirm it is green against the new smoke spec.
  - [x] Confirm
        `grep -nE "continue-on-error|continue_on_error|\|\| true|--no-verify|wearerequired" .github/workflows/check.yml`
        returns nothing, and that the CI prettier glob is byte-identical to the
        `npm run prettier` glob.

- [x] **Task 14 — Prove it (AC: 11, 14)**
  - [x] Run `npm run test:unit:scripts` and confirm both guard tests pass — they are the
        proof-that-it-bites artifact; no file is mis-formatted or suppressed in the working tree
        for evidence.
  - [x] Run the full AC-14 command list from a clean tree with Supabase up; paste outputs into
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

Claude Opus 5 (claude-opus-5), implementing directly (bmad-dev-story workflow), on a tree
where stories 1.1, 1.4, 1.5, 1.3 and 1.2 were already merged into `main` in the pinned order
(HEAD at start: `3b00014`).

### Debug Log References

None — no HALT conditions were hit. One in-flight correction is worth recording: two
`make test-e2e-ci` runs were accidentally piped through `tail -150`, which buffers until EOF
and never got it because `start-app-e2e-ci`'s `serve` process is intentionally backgrounded
and stays alive; the runs had actually finished (visible via `test-results/.last-run.json`)
but produced no console output. Killed the stuck shells, reran with output redirected to a
file instead of a pipe, and confirmed both Playwright projects pass.

### Completion Notes List

**AC-1 (prerequisite gate).** Confirmed 1.1, 1.4, 1.5, 1.3, 1.2 all merged, in that order
(`git log --oneline`, HEAD `3b00014`). Re-measured the six baseline commands on that tree
before changing anything — **numbers differ from the story's measured baseline** because the
tree moved since it was written (1.1/1.2 already landed). Reported as real numbers, not the
story's stale ones, per the working rules:

| Gate | Result on `3b00014` (before this story) |
|---|---|
| Typecheck | PASS — 0 errors |
| Lint | PASS — 0 errors, 0 warnings, but prints `ESLintIgnoreWarning` |
| Prettier | FAIL — exit 2; **69** unformatted files + 1 parse error (`mockup/MyShadchan.dc.html`) = **70 total**, not 89+1=90 |
| Tests (default `vitest --run`, all projects) | PASS — 52 files, 516 tests, 0 skipped, 0 `^Warning:` lines |
| `test:unit:claude` | FAIL — exit 1, "No test files found" (confirmed dead, as the story expected) |
| Build | PASS — only the pre-existing >500kB chunk-size warning |

Suppression census on `3b00014` (before Task 9's cleanup — this is the **pre-ratchet** number):
`eslint-disable` **81** total (54 `admin`, **3** `atomic-crm` [not 8 — 1.1 already deleted 5 of
the 8 sites the story listed], 8 `hooks`, **3** `e2e` [not 6 — 1.1/1.2 already pruned 3 of the
fixtures], 4 `supabase/functions`, 3 `lib`, 2 `test`, 2 `scripts`, 2 `.claude/skills`, 0 `ui`,
0 `workers`). TS suppressions **6** (not 8 — `AttachmentField.tsx` and `DealsChart.tsx` were
already deleted by 1.1).

**Tasks 2–4 (typecheck/lint/prettier gates).**
- Extended `tsconfig.node.json` in place (kept the same file rather than adding a sibling —
  simpler, and nothing else referenced it) to cover `e2e/**/*.ts`, `playwright.config.ts`,
  `vitest.config.ts`, `vite.config.ts`, `vite.demo.config.ts`, `.storybook/*.ts`,
  `supabase/tests/**/*.ts`, plus `src/vite-env.d.ts` (ambient `vite/client` types only, needed
  because `.storybook/preview.ts` imports a `.css` file). Added an explicit
  `exclude: ["supabase/functions/**"]` with the Deno-runtime comment. **Discovered and fixed a
  pre-existing, previously-unexercised bug**: `tsconfig.node.json`'s original
  `moduleResolution: "nodenext"` made `tsc` resolve `@swc/html` (a transitive type-only import
  from `vite-plugin-simple-html`) to that package's checked-in `index.ts` source instead of its
  `index.d.ts`, producing 5 errors from inside `node_modules`. Switched `module`/`moduleResolution`
  to `ESNext`/`bundler` (matching `tsconfig.app.json`'s convention and upstream Vite's own
  `tsconfig.node.json` template) — this was never caught before because nothing ran this
  config directly; it's wired into `npm run typecheck` now. Verified with `--listFiles` that
  every named file is covered and `supabase/functions/**` is excluded.
- Deleted `.eslintignore` (its 5 non-`node_modules` entries matched nothing real, confirmed by
  hand). Added `--max-warnings=0` to the `lint` script.
- Added `mockup/`, `design-artifacts/`, `_bmad/`, `.claude/skills/` to `.prettierignore` and
  pruned the dead react-admin-era entries named in Task 4 (`packages/create-react-admin/…`,
  `examples/**`, `cypress/*`, `.yarn/*` + its negations, `docs/_site/` + siblings,
  `yarn-error.log`, `lerna-debug.log`, `.pnp.*`, `.github`) — left `*.md`, `node_modules`, `lib`,
  `esm`, `es6`, `dist`, `.astro`, `/public`, `/storybook-static` alone (untouched by the story's
  named list, and `/public`/`/storybook-static` hold generated/served assets outside AC-5's
  scope). Ran `prettier:apply`; 45 files reformatted (69 unformatted + the 1 that was previously
  a hard parse error, now excluded via `mockup/`). No file under `src/`, `workers/`,
  `supabase/`, `e2e/` or `scripts/` was excluded.

**Task 5 (vitest warnings/skips).** No-op: `getContactAvatar.test.ts` and `ContactList.test.tsx`
were both already deleted by story 1.1, so the `vi.mock`-in-`beforeAll` warning and the one
unconditional `it.skip` are already gone. Confirmed via a full run: 0 `^Warning:` lines, 0
unconditional skips.

**Task 6 (e2e smoke spec, AC-7).** Confirmed `e2e/` held only `fixtures.ts` and that
`npx playwright test` exited 1 with "No tests found" before this task. Added a `createSingle`
fixture and `e2e/pipeline.spec.ts`. Two things needed fixing beyond the story's own callouts:
1. **`resetDb()` didn't clear `account_members`/`accounts`.** `handle_new_user()`'s "first user
   bootstraps the tenant" logic checks `not exists (select 1 from public.account_members)`, and
   `account_members.user_id` is `ON DELETE SET NULL` (not cascade) — so after the first ever
   test run, stale `account_members` rows survive a `members`-table wipe forever, and every
   later signup gets **zero** membership. This only surfaces when the same spec runs twice
   against one live stack (exactly what happens across the two Playwright projects). Fixed by
   adding `"accounts"` to `TABLES` — deleting it cascades away `account_members`, `singles`,
   `shidduchim`, etc. in one shot (all FKs to `accounts` are `on delete cascade`).
2. **`PasswordInput.tsx` has an accessibility bug**: its `FormControl` `Slot` wraps two children
   (`<Input>` + the reveal-toggle `<button>`), so the injected `id` lands on the wrapping `<div>`
   instead of the `<input>`, and `getByLabel("Password")` matches the toggle button's
   `aria-label="Show password"` instead of the real field. **Not fixed** — out of this story's
   "touches no product code beyond two exceptions" scope; worked around in the spec with
   `input[autocomplete="current-password"]` and documented inline. Flagging here for whichever
   story next touches the login form.

   Verified: `make test-e2e-ci` → `2 passed (3.1s)` on both `chromium` and `Mobile Chrome`, run
   twice for stability.

**Tasks 7–8 (vitest project set, DB CI failure mode).** Deleted the `claude` project (confirmed
zero `.claude/**/*.test.mjs` files exist), added a `scripts` project, added `scripts/**` to
`app`'s exclude, changed `test:unit:app` to pass `--project app`, added `npm run test` and
pointed `make test` at it (removed the now-redundant `test-unit`/`test-app`/`test-functions`/
`test-workers` makefile fan-out — nothing else referenced those targets). For AC-9, extracted
the repeated "skip locally / throw in CI" idiom out of the 4 `supabase/tests/*.test.ts` files
into one shared `supabase/tests/dbSuiteHelpers.ts` (`bailIfDbUnreachable`) rather than
patching each file's `if (error) { it.skip(...); return; }` block separately — same behavior,
DRY. Verified both directions: stack up → all 4 suites run (143 tests); `CI=1` with the DB
pointed at a dead port → all 4 files fail loudly (exit 1) instead of skipping.

**Task 9 (no-console cleanup).** Added a per-path `no-console: "off"` override for
`scripts/**/*.mjs` and `supabase/functions/**/*.ts`, deleted the 6 now-redundant
`eslint-disable-next-line no-console` comments (4 in `mcp/index.ts`, 2 in
`supabase-remote-init.mjs`), and set `linterOptions.reportUnusedDisableDirectives: "error"`.
Re-measured suppressions **after** this cleanup (per the build-plan warning — seeding the
ratchet before Task 9 would leave it 6 slots loose): `eslint-disable` **73** total (54 admin, 3
atomic-crm, 8 hooks, 1 e2e, 0 supabase/functions, 3 lib, 2 test, 0 scripts, 2 `.claude/skills`,
0 ui, 0 workers). TS suppressions unchanged at 6 (5 admin, 1 lib). These are the numbers seeded
into `check-suppressions.mjs`'s budgets.

**Tasks 10–11 (the two guards).** Story 1.1 shipped its AC-14 gate as an inline `grep`, not a
file — confirmed by reading `1-1-delete-fossil-resources.md`, no `scripts/retired-names.json`
or `check-retired-names.mjs` existed. Created both fresh, lifting 1.1's two verbatim grep
patterns (word-boundary fossil words + camelCase compounds) into the JSON, and added the
1.2/1.3/1.4 families. For the `sale` and `children` families, re-verified 1.2's and 1.3's own
**already-shipped, already-verified** gate commands against the current tree (not reinvented)
and encoded them the same way:
- `sale` is a bare, case-insensitive **substring** (not word-bounded), exempting only
  `wholesale` — a word-boundary form misses `sales_id`/`salesId`/`SalesCreate`.
- `children`/`Child` uses two separate patterns, not one blanket word-boundary match: a
  contextual one (`child_`, `_child`, `public.children`, `"children"`, `/children`, …) and a
  case-sensitive camelCase-compound one, each with its own exemption list. **Verified this is
  load-bearing, not cosmetic**: `src/components/admin/` and `src/components/ui/` alone contain
  dozens of legitimate, unrelated `child`/`Children` uses (`Children` imported from `react`,
  generic-guesser locals named `child`/`setChild`/`inferredChild`, `childText`,
  `BulkActionsToolbarChildren`) that a blanket substring match would flag — which is exactly why
  AC-12(c) excludes those two trees wholesale rather than trying to exempt each one.

Extracted a shared `scripts/fsScan.mjs` (file-tree walking) so the two guards don't duplicate
it — extended it to accept a bare file path (not just a directory) so `supabase/seed.sql` could
be scanned as a single entry per AC-12(d)'s scope list.

**The self-reference trap (AC-10/AC-12's "derive at runtime, never hard-code" requirement) was
real, not theoretical** — it fired three times while writing this:
1. `check-suppressions.mjs`'s own source necessarily contains the strings `"eslint-disable"`,
   `"@ts-ignore"`, etc. (it has to search for them) — its own repo-wide run flagged itself.
   Fixed by building every needle via runtime concatenation (`` `${"eslint"}-${"disable"}` ``)
   so the contiguous substring never appears in the file's committed bytes, and rewording every
   comment that had spelled the same substrings out in prose.
2. The first draft of `check-suppressions.test.mjs` wrote literal
   `` `// eslint-disable-next-line no-explicit-any` `` fixture strings directly in its own
   source — caught by the same mechanism, since `.test.mjs` files are in scope for the
   eslint-disable census (not just the skip-pattern check). Fixed with a `buildDisableComment()`
   builder exported from the guard itself.
3. `retired-names.json`'s `.json` extension was originally **excluded** from the scan, which
   would have made the AC-12(e) "exact-path exemption" test meaningless (a file that's never
   scanned "passes" for the wrong reason). Added `.json` to the retired-name guard's scanned
   extensions specifically (checked the only other `.json` file in scope,
   `supabase/functions/postmark/deno.json`, is clean) so the exact-path allowlist entry for
   `scripts/retired-names.json` is doing real work, and added a test case that proves the
   sibling path `scripts/anything-else.json` (same content) does fail.

Both guards' tests derive every offending fixture at runtime from the guard's own exported
builders / the real `retired-names.json`'s `exampleFragments` — nothing resembling a retired
name or a suppression directive is typed contiguously into either `.test.mjs` file.

**Task 12 (AC-13).** `useGetMemberName` does not exist anywhere in the tree — story 1.2 already
deleted it along with its 10 importers via story 1.1. Confirmed via `grep` (zero hits for
`useGetMemberName`/`useGetSalesName`/`getSalesName`/`getMemberName`) and by reading
`members/index.ts` (exports only the resource object, no barrel re-export). AC satisfied by
absence, as the story anticipated; nothing to delete.

**Task 13 (CI).** Replaced the `wearerequired/lint-action@v3` step with plain `npm run lint` +
`npm run prettier` steps — this also makes the CI prettier glob **byte-identical by
construction** rather than by keeping two copies in sync: there is now only one glob, in
`package.json`, and CI just calls the script. Added a `test:unit:scripts` step to the
`test-app` job. Added two new jobs: `test-db` (boots the local stack via the existing
`make start-supabase-e2e`, runs `test:unit:db` against its port 54342, tears it down in an
`if: always()` step) and `guards` (runs both new guard scripts). Left `e2e-test` and `build`
untouched. `grep -nE "continue-on-error|continue_on_error|\|\| true|--no-verify|wearerequired"`
returns nothing.

**Task 14 (final proof).** Ran the full AC-14 command list from the working tree with the local
Supabase stack up. All nine commands exit 0:

```
npm run typecheck        → 0 errors (app + workers + node projects)
npm run lint              → 0 errors, 0 warnings, no ESLintIgnoreWarning
npm run prettier           → "All matched files use Prettier code style!"
npm run test               → 54 test files, 529 tests passed, 0 skipped, 0 warnings
npm run test:unit:db       → 4 test files, 143 tests passed
node scripts/check-suppressions.mjs   → "Suppression ratchet OK."
node scripts/check-retired-names.mjs  → "Retired-name guard OK."
make test-e2e-ci            → 2 passed (chromium, Mobile Chrome) — run twice, both green
npm run build               → built in ~3.7s (only the pre-existing chunk-size warning)
```

**Deviations from the story's own numbers, all because the tree moved since it was written
(1.1 and 1.2 already landed):** prettier baseline was 69+1=70, not 89+1=90; `eslint-disable`
baseline (before Task 9) was 81, not 89 (`atomic-crm` 3 not 8, `e2e` 3 not 6); TS suppressions
were 6, not 8. No AC's substance changed as a result — every gate still closes the same hole,
just measured against the real tree instead of the stale one.

**Not touched, on purpose:** the `@typescript-eslint/no-explicit-any` global-off config-level
suppression (Dev Notes scope ambiguity #1 — a multi-hundred-site change, explicitly out of
scope); the rollup >500kB chunk-size build warning (scope ambiguity #2); the 54 `eslint-disable`s
in `src/components/admin/` (scope ambiguity #3 — upstream framework debt, frozen at its current
count, not removed); `MobileBackButton.tsx` (build-plan landmine L3 — resolved by 1.5 already
having 0 importers after landing, so nothing was left for this story to find); the newly
discovered `PasswordInput.tsx` label-association bug (see Task 6 above).

### File List

**Modified:**
- `.github/workflows/check.yml` — replaced `wearerequired/lint-action`, added `test-db` and
  `guards` jobs, added a `test:unit:scripts` step
- `.prettierignore` — added `mockup/`, `design-artifacts/`, `_bmad/`, `.claude/skills/`; pruned
  dead react-admin-era entries
- `e2e/fixtures.ts` — added `accounts` to `resetDb()`'s `TABLES`, added a `createSingle`
  fixture, consolidated the `no-empty-pattern` eslint-disables into one disable/enable pair
- `eslint.config.js` — added `linterOptions.reportUnusedDisableDirectives`, added a
  `no-console: off` override for `scripts/**/*.mjs` and `supabase/functions/**/*.ts`
- `makefile` — `test` now calls `npm run test`; removed the `test-unit`/`test-app`/
  `test-functions`/`test-workers` fan-out
- `package.json` — added `test` and `test:unit:scripts` scripts, `test:unit:app` now passes
  `--project app`, `lint` now passes `--max-warnings=0`, `typecheck` now also checks
  `tsconfig.node.json`
- `scripts/supabase-remote-init.mjs` — removed 2 redundant `eslint-disable-next-line no-console`
- `src/components/admin/*.tsx` (26 files) — reformatted only
- `src/components/atomic-crm/**/*.{ts,tsx}` (16 files) — reformatted only
- `src/components/ui/spinner.tsx` — reformatted only (the `semi: false` override strips
  semicolons — intended)
- `src/index.css` — reformatted only
- `supabase/functions/_shared/authentication.ts`, `supabase/functions/_shared/resolveDemoAccount.ts`
  — reformatted only
- `supabase/functions/mcp/index.ts` — removed 4 redundant `eslint-disable-next-line no-console`
- `supabase/tests/billing_entitlement.test.ts`, `references_entity.test.ts`,
  `shidduch_catch.test.ts`, `members_rename.test.ts` — unreachable-DB branch now uses the
  shared `bailIfDbUnreachable()` helper (throws under `CI`, skips locally)
- `tsconfig.node.json` — extended coverage (e2e/, playwright/vitest/vite configs, .storybook/,
  supabase/tests/), fixed `moduleResolution` (`nodenext` → `bundler`) to resolve a pre-existing
  `@swc/html` type-resolution bug
- `vitest.config.ts` — deleted the `claude` project, added the `scripts` project, excluded
  `scripts/**` from `app`

**Deleted:**
- `.eslintignore`

**Added:**
- `e2e/pipeline.spec.ts` — the one e2e smoke spec (AC-7)
- `scripts/check-retired-names.mjs`, `scripts/check-retired-names.test.mjs` — the retired-name
  CI guard (AC-12) and its unit test
- `scripts/check-suppressions.mjs`, `scripts/check-suppressions.test.mjs` — the suppression
  ratchet (AC-10) and its unit test
- `scripts/fsScan.mjs` — shared file-tree walker used by both guards
- `scripts/retired-names.json` — the one shared pattern-list + allowlist artifact (AC-12a)
- `supabase/tests/dbSuiteHelpers.ts` — shared `bailIfDbUnreachable()` used by the 4 db suites
