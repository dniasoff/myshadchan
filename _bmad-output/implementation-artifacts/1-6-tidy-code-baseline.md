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
implementation time** — re-measure after 1.1–1.5 land (see AC1); many of the offending files
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

By tree: `src/` 59 · `.claude/skills/` 12 · `supabase/functions/` 7 · `_bmad/` 6 ·
`design-artifacts/` 4 · `mockup/` 1 (+1 parse error). Within `src/`:
`src/components/admin/` 26 · `src/components/atomic-crm/` 31 · `src/components/ui/` 1 ·
`src/index.css` 1.

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
| `supabase/tests/billing_entitlement.test.ts:77` | `it.skip("skipped — local Supabase unreachable")` | Conditional escape hatch — must fail instead of skip under `CI` (AC8) |
| `supabase/tests/child_portal.test.ts:78` | same | Same; **file is deleted by Story 1.4** |
| `supabase/tests/references_entity.test.ts:86` | same | Conditional escape hatch — see AC8 |
| `supabase/tests/shidduch_catch.test.ts:75` | same | Conditional escape hatch — see AC8 |
| `e2e/bulkContactTags.spec.ts:11` | `test.skip(isMobile, "Bulk tag is only available on desktop")` | Legitimate capability guard; file is deleted by Story 1.1 anyway |

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

---

## Acceptance Criteria

1. **Prerequisite gate.** This story is executed only on a tree where Stories 1.1, 1.2, 1.3,
   1.4 and 1.5 are all merged. Before any cleanup, the dev re-runs the six baseline commands
   from *Measured baseline* on that tree and records the actual numbers in Completion Notes.
   If any of 1.1–1.5 is missing, the story stops and reports `BLOCKED: awaiting 1.x`.

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

6. **The full test suite is green, warning-free and skip-free.** Running every vitest project
   exits 0, and its combined output contains **zero** lines matching `^Warning:` and zero
   unconditionally-skipped tests. Verification: the run output shows `N skipped` where the only
   skips are conditional capability guards (a `test.skip(condition, reason)` form), and
   `grep -rn "it\.skip(\"\|test\.skip(\"\|describe\.skip(" src/ workers/ supabase/ e2e/`
   returns no unconditional call.

7. **Every declared test project is real.** Each `npm run test:unit:<project>` exits 0 for every
   project declared in `vitest.config.ts`. The `claude` project resolves 0 files today; per
   NFR-14 it is **deleted** — its `projects[]` entry, its `test:unit:claude` script, its slice
   of the `vitest.config.ts` header comment, and the `.claude/**` entry in the `app` project's
   `exclude` list all go in this change. (If 1.1–1.5 introduced harness hook tests under
   `.claude/`, keep the project instead and prove `npm run test:unit:claude` exits 0.)
   `test:unit:app` passes `--project app`, and a single `npm run test` runs all projects;
   `make test` calls it.

8. **The `db` project executes for real in CI.** A CI job boots a local Supabase stack and runs
   `npm run test:unit:db`, and the "local Supabase unreachable" branch in every
   `supabase/tests/*.test.ts` **throws instead of skipping when `process.env.CI` is set**.
   Verification: the CI log for that job shows the db suites' individual check names, not a
   skip line; and running `CI=1 npm run test:unit:db` with the stack stopped exits non-zero.

9. **No suppression was added, and none can be added silently.** After the cleanup:
   - the `eslint-disable` / `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` counts per tree
     are **≤** the post-1.5 re-measured baseline, and the exact numbers are written into
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
     `xit(` / `xdescribe(` appears in a test file.

10. **CI actually fails on a red gate.** `.github/workflows/check.yml` no longer uses
    `wearerequired/lint-action`; the lint job runs plain `run:` steps — `npm run lint` and
    `npm run prettier` — with no `continue-on-error`. Every gate (typecheck, lint, prettier,
    each test project, the suppression guard, the retired-name guard) is its own failing step.
    Verification: with one file deliberately mis-formatted and one `eslint-disable` added
    locally, `npm run prettier` and `node scripts/check-suppressions.mjs` both exit non-zero;
    the seeded violations are reverted before the story is reported done.

11. **The retired-name guard runs in CI (AD-23).** CI invokes a guard that fails on any
    reference to a retired identifier — `contacts`, `companies`, `deals`, `deal_notes`,
    `contact_notes`, `tags`, `favicons_excluded_domains`, `sales`, `children`,
    `child_portal_tokens`, `get_child_portal` — across `src/`, `supabase/`, `workers/` and
    `e2e/`. It must **not** flag React's `children` prop (see Dev Notes for the exact
    disambiguation rule). If 1.1–1.5 already added such a guard, this story only wires it into
    CI — it does not add a second one (NFR-14: one owner, no duplicates).

12. **Final verification sweep.** All of the following exit 0, from a clean checkout with the
    local Supabase stack up, and their outputs are pasted into Completion Notes:
    `npm run typecheck` · `npm run lint` · `npm run prettier` · `npm run test` ·
    `npm run test:unit:db` · `node scripts/check-suppressions.mjs` · the retired-name guard ·
    `npm run build`. No alias, wrapper script, compatibility shim, `--no-verify`,
    `continue-on-error` or `|| true` is used anywhere to reach that state.

---

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the prerequisite and re-measure (AC: 1)**
  - [ ] Confirm 1.1–1.5 are merged into the working base; otherwise stop with `BLOCKED`.
  - [ ] Re-run and capture: `npm run typecheck`; `npx eslint "**/*.{mjs,ts,tsx}" --format json`
        (count files/errors/warnings); `npm run prettier`;
        `npx vitest --config vitest.config.ts --run`; each `npm run test:unit:*`; `npm run build`.
  - [ ] Re-run the suppression census and record per-tree counts:
        `grep -rn "eslint-disable" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" src/ workers/ supabase/ e2e/ scripts/ .claude/`
        and the same for `@ts-ignore\|@ts-expect-error\|@ts-nocheck`.
  - [ ] Write the re-measured numbers into Completion Notes before changing anything — they are
        the ratchet values for AC9.

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

- [ ] **Task 5 — Make the test suite warning-free and skip-free (AC: 6)**
  - [ ] If `src/components/atomic-crm/providers/commons/getContactAvatar.test.ts` survived 1.1,
        hoist the `vi.mock(...)` out of `beforeAll` to module top level; if 1.1 deleted it,
        confirm the warning is gone.
  - [ ] If `src/components/atomic-crm/contacts/ContactList.test.tsx` survived 1.1, un-skip
        line 39 or delete the case — never leave it skipped.
  - [ ] Re-run and confirm no `^Warning:` line and no unconditional skip.

- [ ] **Task 6 — Fix the vitest project set and the npm scripts (AC: 7)**
  - [ ] Delete the `claude` project from `vitest.config.ts`, its `test:unit:claude` script, its
        paragraph in the config's header comment, and the `.claude/**` entry from the `app`
        project's `exclude` — unless 1.1–1.5 added `.claude/**/*.test.mjs` files.
  - [ ] Change `test:unit:app` to pass `--project app`.
  - [ ] Add `"test": "vitest --config vitest.config.ts --run"` and point `make test` at it;
        remove the now-redundant `test-unit`/`test-app`/`test-functions`/`test-workers` fan-out
        in the `makefile` if it no longer earns its keep.

- [ ] **Task 7 — Make the db suite fail loudly instead of skipping (AC: 8)**
  - [ ] In each surviving `supabase/tests/*.test.ts`, change the unreachable branch to throw
        when `process.env.CI` is set, keeping the local-dev skip.
  - [ ] Do not touch `supabase/tests/child_portal.{sql,test.ts}` — Story 1.4 deletes them.
  - [ ] Verify: stack up → suites run; `CI=1` with stack down → non-zero exit.

- [ ] **Task 8 — Remove line-level suppressions that are really config bugs (AC: 9)**
  - [ ] Add a `no-console` override in `eslint.config.js` for `scripts/**` and
        `supabase/functions/**` (server/CLI code legitimately logs).
  - [ ] Delete the 6 now-redundant `// eslint-disable-next-line no-console` comments in
        `supabase/functions/mcp/index.ts` (321, 376, 482, 521) and
        `scripts/supabase-remote-init.mjs` (162, 212).
  - [ ] Set `linterOptions: { reportUnusedDisableDirectives: "error" }` and fix whatever it
        surfaces by **deleting** the dead directive.

- [ ] **Task 9 — Write the suppression ratchet (AC: 9)**
  - [ ] Add `scripts/check-suppressions.mjs`: per-tree budgets for `eslint-disable`,
        `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, seeded with Task 1's re-measured
        numbers; plus a hard zero for unconditional `it.skip` / `describe.skip` /
        `test.skip("…")` / `.only(` / `.todo(` / `.fixme(` / `xit(` / `xdescribe(` in test files.
  - [ ] Keep it ≤ ~150 lines, no new dependency, exit 1 with a diff-style message naming the
        offending file and tree.
  - [ ] Add a unit test for the script under the `workers`-style Node project (or the project it
        naturally belongs to) covering: over-budget fails, at-budget passes, unconditional skip
        fails, conditional `test.skip(cond, reason)` passes.

- [ ] **Task 10 — Rebuild the CI gates so a red gate fails the build (AC: 10, 11)**
  - [ ] Replace the `lint` job's `wearerequired/lint-action@v3` step with plain
        `run: npm run lint` and `run: npm run prettier` steps.
  - [ ] Split the test job into one step per vitest project, each with `--project <name>`.
  - [ ] Add a job that boots the local Supabase stack and runs `npm run test:unit:db` (reuse the
        `make start-supabase-e2e` pattern already used by the `e2e-test` job).
  - [ ] Add steps for `node scripts/check-suppressions.mjs` and the retired-name guard.
  - [ ] Confirm no step carries `continue-on-error`, `|| true` or a swallowed exit code.
  - [ ] If 1.1–1.5 did not already add a retired-name guard, add one here (word-boundary rules
        in Dev Notes) — otherwise only wire the existing one in.

- [ ] **Task 11 — Prove it (AC: 10, 12)**
  - [ ] Seed one mis-formatted file and one stray `eslint-disable`; confirm both gates go red;
        revert.
  - [ ] Run the full AC12 command list from a clean tree with Supabase up; paste outputs into
        Completion Notes.

---

## Dev Notes

### Where this story sits

Story 1.6 is the closing gate of Epic 1 — *"Remove every trace of the Atomic CRM fork and make
the schema describe shidduchim honestly, so that every later epic is smaller"*
[Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth]. It owns
**no product behaviour**. Its entire deliverable is that the four gates are green and that CI
cannot go quietly red again. Anything that looks like feature work, a schema change or a
behaviour change belongs to another story.

**Hard dependency:** 1.1 (delete fossil resources), 1.2 (`sales` → `members`), 1.3
(`children` → `singles`), 1.4 (retire the token portal) and 1.5 (remove dead routes) must all
land first. Measuring the baseline before they land produces numbers that are wrong in both
directions: files that will be deleted, and files that will be created.

### Greenfield rules that bind every task

- **NFR-14 / SPEC constraint:** *"no backwards compatibility, deprecation shims, fallbacks or
  aliased names; when something is replaced the replaced thing is deleted in the same change."*
  [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints;
  ARCHITECTURE-SPINE.md#AD-23]. Applied here: the dead `claude` vitest project is **deleted**,
  not left with a placeholder test; `.eslintignore` is **deleted**, not emptied; dead
  `.prettierignore` entries are pruned in the same change.
- **AD-23:** *"CI fails on a reference to a retired name."*
  [Source: ARCHITECTURE-SPINE.md#AD-23]. AC11 is the CI half of that promise; 1.1–1.3 own the
  deletions themselves.
- **AD-1:** *"CI asserts every `public` table has `rowsecurity = true` … each table's migration
  adds its RLS in the same migration."* [Source: ARCHITECTURE-SPINE.md#AD-1]. That assertion
  already exists in SQL —
  `supabase/tests/references_entity.sql:686` (`'RLS is enabled on every new table'`) — but it has
  **never run in CI**, because the `db` project self-skips on a runner with no Postgres. AC8
  turns the promise into a fact. This is the single highest-value change in the story.
- **Coding style rule:** "many small files over few large files, 200–400 typical, 800 max"
  [Source: .claude/rules/coding-style.md] — keep `scripts/check-suppressions.mjs` small and
  focused.

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

### The retired-name guard: the `children` trap

A naive `grep -rn "children" src/` explodes — React's `children` prop appears in hundreds of
components and is **not** a retired name. The guard must distinguish:

- **retired (fail):** the resource string `"children"` in a `<Resource name=…>` / route /
  dataProvider key; the SQL identifier `public.children`, `children.` column refs, `child_id`,
  `child_portal_tokens`, `get_child_portal`; the directory `src/components/atomic-crm/children/`;
  the type name `Child`.
- **allowed (pass):** `children` as a JSX prop or React type (`{ children }`,
  `children?: ReactNode`, `props.children`, `React.Children`).

Practical rule: scope the SQL/resource-name patterns to `supabase/**`, route strings and
`Resource name` attributes; and for TS/TSX match `\bChild\b` / `child_` / `"children"` (quoted
resource string) rather than the bare identifier. Note also the collision between the retired
`contacts`/`references` fork tables and the *live* `references` entity — `reference` is
first-class domain vocabulary [Source: _bmad-output/specs/spec-myshadchan/glossary.md] and must
never be caught by the guard.

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
| `e2e/bulkContactTags.spec.ts`, `e2e/fixtures.ts` | 1.1 | Removes 1 conditional playwright skip and possibly some of the 6 `no-empty-pattern` disables |
| `.github/workflows/check.yml` | 1.5 (route check), 1.1–1.3 (retired-name guard) | **1.6 owns the final shape.** Wire in whatever guards they added; do not create a second copy |
| `vitest.config.ts` | none expected | 1.6 owns it |

### Testing standards

- Vitest, AAA, descriptive behaviour names, no shared mutable state, reset mocks in `beforeEach`
  [Source: .claude/rules/testing.md]. The new `scripts/check-suppressions.mjs` test follows this.
- Playwright: deterministic waits only; never `waitForTimeout`; a flaky test must be quarantined
  with `test.fixme()` **and a tracking reference** — note that AC9's guard fails on `.fixme(`, so
  quarantining now requires an explicit, visible budget bump rather than a silent one. That is
  intentional.
- ≥80% coverage on new code paths [Source: .claude/rules/testing.md] — applies to the guard
  script, the only new code in this story.

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
   (AC5 forbids ignoring anything under `src/`); **removing its suppressions is not** — they are
   upstream framework debt, and the ratchet simply freezes them at their current count.
4. **Whether the `db` CI job should boot the full local stack or a bare Postgres.** The e2e job
   already boots a Supabase instance via `make start-supabase-e2e`, so reuse is the cheap path;
   a bare `postgres:15` service container would be faster but would not have the migrations
   applied. **Dev's call** — AC8 only requires that the suites genuinely execute and that an
   unreachable DB fails under `CI`.
5. **Deleting the `claude` vitest project.** `.claude/hooks/` does not exist and
   `.claude/settings.json` declares no hooks, so the project is dead config today. But
   `CLAUDE.md` describes hooks in `.claude/settings.json` / `.claude/hooks/` as `.mjs` modules,
   which suggests the harness *expects* them. **If 1.1–1.5 (or the harness) added hook files,
   keep the project and make its script pass instead of deleting it** — AC7 permits both.

### Project Structure Notes

- Namespaces stay as declared: `src/components/atomic-crm/<domain>/` per resource,
  `providers/{supabase,fakerest,commons}/` as the CRUD seam, `workers/<name>/`,
  `supabase/schemas/` as the DB source of truth [Source: ARCHITECTURE-SPINE.md#Design Paradigm].
  This story adds exactly one new file — `scripts/check-suppressions.mjs` — alongside the five
  existing `scripts/*.mjs`.
- No new dependency may be added. The ratchet is plain Node; there is no
  `eslint-plugin-eslint-comments` in the tree and none is to be introduced.
- Committed content is English-only, including the new script's messages and any comment added
  to a tsconfig or CI file [Source: .claude/rules/english-only.md].
- Detected variance: `.eslintignore` and several `.prettierignore` entries
  (`packages/create-react-admin/templates/**`, `examples/**`, `cypress/*`, `docs/_site/`) are
  react-admin-upstream leftovers describing paths that do not exist here. Pruning them is part of
  this story's debt clearance (NFR-14), not an unrelated drive-by.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Establish the tidy-code baseline]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth] — Stories 1.1–1.5, the prerequisites
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Greenfield engineering standard … no backwards compatibility, deprecation shims, fallbacks or aliased names"
- [Source: ARCHITECTURE-SPINE.md#AD-23] — entities named for what they hold; "CI fails on a reference to a retired name"
- [Source: ARCHITECTURE-SPINE.md#AD-1] — "CI asserts every `public` table has `rowsecurity = true`"; deny-by-default RLS
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — files/testing row (≥80% new-code coverage, AAA, RLS suite per table); Worker validation row (no `any`)
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md] — `single`, `shidduch`, `reference`, and the deliberately unused fork words
- [Source: AGENTS.md#Database Management] — declarative schema, `db diff` / `migration up`
- [Source: AGENTS.md#Mutable Dependencies] — `src/components/admin/`, `src/components/ui/`
- [Source: .claude/rules/testing.md] · [Source: .claude/rules/coding-style.md] · [Source: .claude/rules/lsp-usage.md] · [Source: .claude/rules/english-only.md]
- Repo files inspected for the baseline: `package.json`, `makefile`, `vitest.config.ts`,
  `eslint.config.js`, `.eslintignore`, `.prettierrc.json`, `.prettierignore`, `.lintstagedrc`,
  `.husky/pre-commit`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.workers.json`,
  `tsconfig.node.json`, `playwright.config.ts`, `.github/workflows/check.yml`,
  `.github/workflows/deploy.yml`, `supabase/tests/*.test.ts`, `supabase/tests/references_entity.sql`

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
