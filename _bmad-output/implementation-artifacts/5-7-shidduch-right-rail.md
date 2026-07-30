---
baseline_commit: 08243fe043407313b85fd79dc9fef56e8d2cdc5c
---

# Story 5.7: Shidduch right rail

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want context and actions beside the record,
so that the next step is obvious.

## Position in Epic 5

Depends on **5.1** (which creates the real `shidduchim/entityDescriptor.ts` and mounts the entity
on `buildEntityRoutes` — the shell's optional right-rail region has nothing to hang off until
then) and on **5.3** (the resume file version this story's forward action reads).

**This story adds no tab and flips no path**, so — unlike most of Epic 5 — it does **not** touch
`entity360/registry.stubs.test.ts`, `entity360/ad24Conformance.ts`, or any exemption table. Do not
add them to its file set.

## Two ambiguities the epic text leaves open — resolved here

**"Forward resume and share" is one action, not two.** Read literally as four separate rail
widgets ("the single's input, reminders … forward resume and share") it would require a working
external, revocable share mechanism — that is Epic 9's job (Story 9.5), which has not landed and
whose AD-9 Worker-proxied-stream infrastructure does not exist yet (see Story 5.3's Dev Notes).
Building a second, ad-hoc sharing path here would violate AD-9's single-owner intent for outbound
sharing. This story reads "forward resume and share" as **one combined action**: the OS-native
share/download of the shidduch's newest resume file (Story 5.3), using the Web Share API where
supported and a plain download as the fallback. It explicitly does **not** generate a link, a
token, or anything Epic 9 will later own — when Epic 9 lands, its share-link feature replaces
this button's implementation, not adds a second button beside it.

**"The single's input" has no write path yet.** Epic 6 Story 6.4 ("The single's input") is what
lets a single actually submit input on a shidduch, and it lands after Epic 5. This story
builds the **read-side panel** now — it queries `interactions` for a new `kind = 'single_input'`
value and renders whatever it finds, correctly showing an empty state until Epic 6 wires up the
write path. The panel is not decorative: extending `interactions_kind_check`, and — as of this
story's review-fix pass (finding F2) — widening the UPDATE policy's author-or-owning-role escape
to also cover `single_input` (see Dev Notes below), together mean Epic 6 does not have to touch
this table's constraint or its moderation policy later, only add the write UI. (The first cut of
this story extended the constraint alone and left the escape untouched — a real gap the review
caught: see Dev Notes.)

## Acceptance Criteria

1. **Given** a shidduch's 360, **when** it renders, **then** the right rail shows three panels:
   the single's input, a read-only reminders summary for this shidduch, and a combined
   forward/share action. The rail is mounted by setting `rightRail: ShidduchRightRail` on the
   shidduch descriptor — the field is `ComponentType<{ record: T }>`
   (`entity360/entityDescriptor.ts:59`), so `ShidduchRightRail` takes **`{ record }`**, never
   `{ shidduchId }`; anything else is a `tsc` error at the descriptor literal. No other entity's
   descriptor declares a rail in this story (Story 3.1's regions are optional per entity).
   *Failing looks like:* an `EntityShow` render for a shidduch with no rail region on screen, or
   `make typecheck` red on the descriptor.
2. **Given** `interactions` rows with `target_type = 'shidduch'`, `target_id = {id}`,
   `kind = 'single_input'`, **when** the panel renders, **then** it lists them newest-first; when
   there are none, it shows an empty state explaining nothing has been shared yet (not an error,
   not blank).
3. **Given** the reminders panel, **when** it renders, **then** it is
   `entity360/tabs/TasksRailSummary.tsx` with `{ targetType: "shidduch", targetId }` — a
   **compact, read-only "next few reminders" summary**: the next `limit` (default 3) incomplete
   tasks for this shidduch by due date, plus a link to `buildTabPath("shidduchim", id, "tasks")`.
   It has **no add, no toggle, no edit, no delete**. Adding and completing a reminder happens in
   the shidduch's **Tasks tab** (Story 3.8's `entity360/tabs/TasksTab.tsx`), which is the only
   component in the codebase that mutates tasks from a 360 — the "reflects immediately, without
   leaving the page" behaviour is satisfied by the tab, not the rail. The rail must not duplicate
   the tab's mutation surface. Do not adapt `ReferenceTasks.tsx` — Story 5.10 deletes it — and do
   not write a second task-add/toggle implementation.
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#11 — Ruling 2, points 1–4]
4. **Given** the shidduch has at least one resume file version (Story 5.3), **when** I press
   forward/share, **then** the newest version downloads to my device, invoking the Web Share API
   (`navigator.share` with the file) when the browser supports sharing files, else a plain
   download link. **Given** no resume file exists, **then** the button is disabled with a
   tooltip explaining why — never a silent no-op. **And** the payload contains only that one
   `resumes.files` entry — never anything from `resume_photos`: a unit test asserts it (this is
   Story 5.4's "a photo is never included in a share unless chosen" guarantee, whose executable
   half lands here because the action is built here; AD-9, "photo inclusion is the sharer's
   choice").
5. **Given** `interactions_kind_check` (`01_tables.sql:469-471`), **when** this story's migration
   lands, **then** it includes `'single_input'` in the allowed set; no other constraint on
   `interactions` changes (a `single_input` row is `target_type = 'shidduch'`,
   `scope = 'shidduch'`, `reference_link_id = null` — it already satisfies the existing
   `interactions_scope_link_check` branch for shidduch-targeted rows
   (`01_tables.sql:486-491`, the disjunct at `:488`), so that constraint is untouched).
   *Failing looks like:* a generated migration that also emits
   `interactions_scope_link_check` or `interactions_target_type_check` — stop and re-read it.
6. **Given** the new `InteractionKind` member, **when** it lands, **then** it is added in **all
   four** places the union is mirrored, in the same diff:
   `types.ts:491-497` (`InteractionKind`), `entity360/tabs/interactionLabels.ts:36-39`
   (`INTERACTION_KIND_LABELS` is `Record<InteractionKind, …>` — an immediate `tsc` error until an
   entry exists), `providers/commons/englishCrmMessages.ts:420-427`
   (`crm.entity360.activity.kind.*` — the six entries are `:421-426`) **and**
   `providers/commons/frenchCrmMessages.ts:389-396` (entries `:390-395`).
   The two catalogues are one-entry-per-kind **by hand**, there is no parity test, and
   `i18nProvider` runs `allowMissing: true` — so a missing French `single_input` key falls back to
   English **silently**. That silence is the failure mode; AC-7's temporary assertion is what
   makes it loud.
   *Failing looks like:* `make typecheck` red on `interactionLabels.ts` (the loud half), or a
   French session rendering "Single's input" in English (the quiet half).
7. **Given** AC-3's read-only claim, **when** the guard runs, **then** it scans **the rail
   wrapper**, not only `TasksRailSummary.tsx`. Story 3.8's
   `entity360/tabs/TasksRailSummary.guard.test.ts` globs exactly `./TasksRailSummary.tsx`
   (`:20-24`) — it proves nothing about `shidduchim/ShidduchRightRail.tsx`, which is where a
   re-introduced add/complete affordance would actually live. This story adds its own guard over
   `ShidduchRightRail.tsx` and its panels, using the same `?raw` glob idiom, with the same
   forbidden set (`useCreate`, `useUpdate`, `useDelete`, `useMutation`, and form controls).
   Prove it red once (contract §13 rule 2).
   *Failing looks like:* a guard that passes while `ShidduchRightRail.tsx` imports `useUpdate` —
   which is exactly what the un-widened scan does today.

## Tasks / Subtasks

- [x] **Task 1 — Schema and the four-place kind widening** (AC: 5, 6)
  - [x] `supabase/schemas/01_tables.sql`: add `'single_input'` to `interactions_kind_check`
        (`:469-471`).
  - [x] `types.ts`: add `"single_input"` to `InteractionKind` (`:491-497`).
  - [x] `entity360/tabs/interactionLabels.ts`: add the `single_input` entry to
        `INTERACTION_KIND_LABELS` (`:36-39`) — `{ key: "crm.entity360.activity.kind.single_input",
        fallback: "…" }`. Non-optional: the map is `Record<InteractionKind, …>`.
  - [x] `entity360/tabs/interactionLabels.test.ts`: extend, it enumerates the kinds.
  - [x] **Both** i18n catalogues: `englishCrmMessages.ts:420-427` and
        `frenchCrmMessages.ts:389-396`.
  - [x] Generate + hand-check migration
        (`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f interactions_single_input`):
        a single `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT` on `interactions_kind_check`
        only — verify `db diff` does **not** also touch `interactions_scope_link_check` or
        `interactions_target_type_check`. Then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset` / `db push`.
  - [x] `supabase/tests/interactions_targets.sql` **and its paired
        `interactions_targets.test.ts` runner**: this is the existing home for
        `interactions`-constraint coverage — add the positive case (a `single_input` row with
        `scope = 'shidduch'`, `reference_link_id = null` inserts) and the negative
        (a pre-migration kind value is still rejected). Every `.sql` suite in `supabase/tests/`
        has a paired runner; there are no exceptions.
  - [x] `providers/fakerest/dataProvider.interactions.test.ts`: its fixture pins `kind: "note"`
        (`:15`), so nothing breaks — but the FakeRest mirror is where the `single_input` read path
        gets demo coverage (AD-10). Extend rather than adding a parallel test file.
- [x] **Task 2 — Rail panels** (AC: 1, 2, 3)
  - [x] `src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx`: composes the three panels.
        Signature `({ record }: { record: Shidduch })` — see AC-1.
  - [x] `shidduchim/entityDescriptor.ts`: set `rightRail: ShidduchRightRail`. This is the only
        edit this story makes to that file — it declares **no** tab and touches **neither**
        `tabs` nor `pendingTabs`, so `entity360/registry.stubs.test.ts` stays untouched.
  - [x] `SingleInputPanel.tsx`: `useGetList("interactions", { filter: { target_type: "shidduch",
        target_id, kind: "single_input" } })`, newest-first, empty state. (Those are **database
        column names in a `getList` filter**, not the universal-tab prop shape — the camelCase
        `targetType`/`targetId` rule applies to `UniversalTabProps` mounts only.)
  - [x] Reminders panel: mount 3.8's `TasksRailSummary` with
        `targetType="shidduch"` + `targetId` per AC-3 (read-only; the mutating `TasksTab` stays in
        the Tasks tab, which the summary links to via `buildTabPath`). `TasksRailSummary` calls
        `useResourceContext()` and **throws** without one (`TasksRailSummary.tsx:94-99`); mounted
        through `EntityShow` inside `<Resource name="shidduchim">` that context always exists, but
        any isolated test render must supply a `ResourceContextProvider`.
- [x] **Task 3 — Forward/share action** (AC: 4)
  - [x] `ForwardResumeButton.tsx`: reads the newest entry from Story 5.3's `ResumeVersionList`
        data (or a small shared hook, `useLatestResumeFile(shidduchimId)`, to avoid duplicating
        the "which version is newest" sort logic already written for 5.3 — extract it into
        `resumes/` if it does not already exist as a reusable function).
  - [x] Feature-detect `navigator.canShare?.({ files: [...] })`; fall back to a plain `<a
        download>` when unsupported or when no file exists (disabled state, not hidden).
- [x] **Task 4 — Tests**
  - [x] Component tests: empty state for `SingleInputPanel`; disabled state for
        `ForwardResumeButton` with no resume; the reminders summary lists at most `limit`
        incomplete tasks, nearest due date first, and renders a link to the Tasks tab.
  - [x] Rail-region test: an `EntityShow` render for a shidduch shows the rail. Note that
        `EntityShow` **deliberately withholds `rightRail` while the viewer role is pending**
        (`EntityShow.tsx:116-137`) — assert the settled state, and do not "fix" that withholding.
  - [x] Widened read-only guard per AC-7:
        `shidduchim/ShidduchRightRail.guard.test.ts`, same `?raw` glob idiom as
        `entity360/tabs/TasksRailSummary.guard.test.ts`, scanning `ShidduchRightRail.tsx` and its
        panel modules. 3.8 owns the `TasksRailSummary.tsx` scan; this story owns the wrapper's.
  - [x] Payload test per AC-4: the forward/share payload holds exactly one `resumes.files`
        entry and nothing derived from `resume_photos`.
  - [x] `make typecheck && npm run lint && npx vitest run && npm run test:unit:db`.
- [x] **Task 5 — `registry.json`**
  - [x] Three new non-test source files land under `src/components/atomic-crm/`
        (`ShidduchRightRail.tsx`, `SingleInputPanel.tsx`, `ForwardResumeButton.tsx`), so
        `scripts/generate-registry.mjs` picks them up and `registry.json` changes.
        `.husky/pre-commit` regenerates it; commit the result.

## Dev Notes

### Test stack — what the repo actually uses

Component tests run under **`vitest-browser-react` in Chromium**, with `TestMemoryRouter` for
anything routed — see `entity360/EntityShow.regions.test.tsx` for the canonical
`buildEntityRoutes({ List, Show: EntityShow })`-inside-`TestMemoryRouter` shape, which is exactly
what a rail-region test needs. **React Testing Library is not a dependency of this repo** — do not
import `@testing-library/react`. Source-scanning guards use the `?raw` `import.meta.glob` idiom
(`TasksRailSummary.guard.test.ts:20-24`). Follow AAA and `.claude/rules/testing.md`.

### Reuse

- `entity360/tabs/TasksRailSummary.tsx` (Story 3.8) — the reminders panel, direct mount,
  read-only. `entity360/tabs/TasksTab.tsx` is the canonical mutating surface and belongs to the
  Tasks tab, not the rail (contract §11 Ruling 2). Their shared behaviour is `ReferenceTasks.tsx`
  generalised; the original is deleted by Story 5.10, so nothing may build on it here.
- Story 5.3's `ResumeVersionList` sort/latest-version logic — do not re-derive "which file is
  newest."

### Why no RLS *visibility* branch is needed for `single_input` — but the UPDATE moderation escape did need widening (review finding F2)

Because a `single_input` row is `target_type = 'shidduch'`, it already flows through the existing
`interactions` RLS branch that joins to `shidduchim` and checks `account_id` — the
`target_type = 'shidduch'` `exists` clause at `05_policies.sql:337-345` (select) and its mirror in
`"Interactions insertable within account and parent visibility"` (`:349`). That is the same branch
every other shidduch-targeted interaction (`status_change`, `note` about the shidduch itself)
already uses. This half of the original claim holds: do not add a new *visibility* branch for
this — that would be solving a problem that does not exist.

**What the first cut of this story got wrong**: it reasoned only about that SELECT/INSERT
visibility branch and concluded the `kind` enum was the only thing that needed extending. It never
considered the separate UPDATE policy — `"Interactions updatable by author or owning role"`
(`05_policies.sql`) — which ANDs an *additional*, orthogonal escape onto that same visibility
predicate: `kind <> 'note' or can_moderate_note(actor_member_id)`, governing who may rewrite or
soft-delete a row (not who may read or insert one). Before the review-fix pass, `single_input`
fell into that escape's default "any account member may rewrite it" bucket — the bucket that is
correct for the five machine-written kinds (`call_logged`, `status_change`, `merge`,
`link_created`, `link_removed`) but is the *opposite* of what a kind meaning "the single's own
words" needs: any helper could rewrite, or soft-delete, a single's own submitted input.

The fix (already applied, not merely noted): widen that escape to
`kind not in ('note', 'single_input') or can_moderate_note(actor_member_id)`, in both `using` and
`with check` of the UPDATE policy, mirrored in `interactions_summary.can_moderate`
(`03_views.sql`) — the exact pair `supabase/tests/interaction_note_authorship.sql` already
exercises for `note`, extended here with checks (g2) / AC 5-single for `single_input`, each proven
red against the pre-fix escape before being shown green. No production exposure existed at any
point: Epic 6 Story 6.4 owns the write path and no `single_input` row can exist before it lands,
so there was no window in which a real row was ever moderable by the wrong bucket.

### Project Structure Notes

- `ShidduchRightRail.tsx` and its panels live in `shidduchim/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.7]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-6-The-Singles-Access, Story 6.4] —
  the future write path this story's read-side panel anticipates.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding. §11 Ruling 2 (rail
  vs. tab), §3 (`TabKey`), §8 (`UniversalTabProps`), §13 rule 2 (prove a guard red once),
  §0 (validation commands, vocabulary).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9]
  — why forward/share does not build a revocable link here.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-13]
  — reminders are polymorphic `tasks`, no SMS channel.
- [Source: .claude/rules/testing.md] — AAA, naming, 80% coverage floor.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (developer subagent).

### Debug Log References

AC-7's guard, proven red once then green (contract §13 rule 2). Temporarily added
`useUpdate` to `ShidduchRightRail.tsx`'s import list (no call site — the import alone is
enough, matching the guard's own text-scan design) and ran
`npx vitest run src/components/atomic-crm/shidduchim/ShidduchRightRail.guard.test.ts`:

```
FAIL  |app (chromium)| src/components/atomic-crm/shidduchim/ShidduchRightRail.guard.test.ts
  > references none of the mutation hooks, in any of the three files
AssertionError: ./ShidduchRightRail.tsx references: useUpdate: expected [ 'useUpdate' ] to deeply equal []
Tests  1 failed | 2 passed (3)
```

Reverted the import; re-ran the same command — `Tests  3 passed (3)`.

`supabase db diff --local` reproduces a pre-existing, repo-known quirk on every run
regardless of what changes: it spuriously re-emits `reference_links_summary`,
`shadchan_stats`, `shidduchim_summary`, `singles_summary` (drop + recreate, security_invoker
stripped) even for a change — this story's `interactions_kind_check` widening — that touches
none of their base tables. Confirmed by re-running `db diff --local` with zero local changes
staged: the same four-view block reappears verbatim. Followed the established remediation
(migrations `20260730025903`, `20260730041150`): the four-view block was deleted from the
generated migration file before applying it. Verified post-migration: `pg_class.reloptions`
still reads `{security_invoker=on}` on all four views, and `interactions_kind_check`'s
`pg_get_constraintdef` includes `'single_input'::text`.

### Completion Notes List

- Task 1: widened `interactions_kind_check` (migration `20260730065512_interactions_single_input.sql`,
  hand-edited per the known `db diff` view-quirk above), `InteractionKind`, `INTERACTION_KIND_LABELS`
  (+ its test), and both i18n catalogues, all in one diff (AC 5, AC 6). Added the positive/negative
  SQL checks to `supabase/tests/interactions_targets.sql` (still-authenticated household-A section,
  after the AC-4 current_member_id() check) rather than a new suite, and one FakeRest round-trip test
  to `dataProvider.interactions.test.ts`, per the story's own file-ownership notes.
- Task 2: `ShidduchRightRail` takes exactly `{ record }` and is the descriptor's only new field
  (`rightRail: ShidduchRightRail`) — no tab, no `pendingTabs` edit, `registry.stubs.test.ts` untouched,
  confirmed by the full suite staying green. `SingleInputPanel` filters `interactions` on the raw
  column names per the story's own clarification (not `UniversalTabProps`).
- Task 3: extracted `sortResumeFilesNewestFirst` out of `ResumeVersionList.tsx` into a new
  `resumes/useLatestResumeFile.ts` (the "small shared hook" the story names) and refactored
  `ResumeVersionList` to call the shared function — no behaviour change, `ResumeVersionList.test.tsx`
  stays green unmodified. `ForwardResumeButton`'s plain-download fallback reuses
  `ResumeVersionList`'s own `window.open(url, "_blank", "noopener,noreferrer")` idiom against the
  same `dataProvider.signResumeFileUrl` call (which already sets `download: fileName` server-side)
  rather than building a separate `<a download>` element — same user-visible behaviour, one fewer
  download mechanism in the codebase. The Web Share payload builder (`buildResumeSharePayload`) was
  pulled into its own `resumes/resumeSharePayload.ts` module (not inlined in the button component)
  because `react-refresh/only-export-components` flags a file mixing a component export with a plain
  function export — the same reason `entityDescriptorRegions.tsx` is split from `entityDescriptor.tsx`.
- Task 4: added `ShidduchRightRail.guard.test.ts` (AC 7, widened scan over all three new files, proven
  red once — see Debug Log), unit tests for `SingleInputPanel`, `ForwardResumeButton` (disabled state,
  download fallback, error handling) and `resumeSharePayload`/`useLatestResumeFile`, and three
  descriptor-level integration tests in `shidduchim/entityDescriptor.test.tsx` mounting the REAL
  registered descriptor through `EntityShow` + FakeRest (the file's own established pattern): the
  settled rail renders all three panels; the single-input panel is scoped correctly (own shidduch, own
  kind, excluding a wrong-target_id and a wrong-kind row); the forward button enables once a resume
  exists.
- Task 5: `make registry-gen` picked up the three new non-test source files
  (`ShidduchRightRail.tsx`, `SingleInputPanel.tsx`, `ForwardResumeButton.tsx`) plus
  `resumes/useLatestResumeFile.ts` and `resumes/resumeSharePayload.ts`; committed the regenerated
  `registry.json`.
- Gates run for real, not assumed: `make typecheck` (three tsconfigs) clean; `make lint` (ESLint 0
  warnings + Prettier) clean after moving the payload builder out of the component file;
  `npx vitest run` — 200 files / 2051 tests passed; `npm run test:unit:db` — 19 files / 563 tests
  passed; `make build` succeeded; all four CI guards
  (`check-retired-names`/`check-suppressions`/`check-route-convention`/`check-tailwind-arbitrary-var`)
  printed `OK`/exit 0; `make test STACK_ID=3` (leased under `STACK_OWNER=5-7`, stopped afterward) —
  200 files / 2051 tests passed against the isolated stack-3 database. `npx prettier --check .`
  (repo-wide) flags 16 pre-existing files (`.github/workflows/*.yml`, `.lintstagedrc`, several
  `doc/**/*.mdx`) outside this story's File List and outside `make lint`'s own glob — not introduced
  or touched by this change.
- Nothing could not be done; no scope was cut.

### Review Fix Notes (commit `b213582`'s review — findings F1, F2, F3)

- **F1 (blocking, fixed)**: AC-3's binding claim (`TasksRailSummary` mounted with
  `{ targetType: "shidduch", targetId }`) had zero coverage — the only rail-integration test
  touching it asserted the "Reminders" heading and the "See all tasks" link's presence, never a
  task actually belonging to this shidduch, never the link's `href`. Added a test to
  `entityDescriptor.test.tsx` mirroring the sibling single-input scoping test: seeds one task with
  `target_type: "shidduch", target_id: <this shidduch>` and one under a foreign `target_id`,
  asserts the first renders and the second does not, and asserts the "See all tasks" link's `href`
  equals `buildTabPath("shidduchim", id, "tasks")`. Proved red against both of the review's
  mutations (`targetType="reference"` and `targetId={999999}` on `ShidduchRightRail.tsx:50`) before
  restoring the clean file.
- **F2 (blocking, fixed)**: the `interactions_kind_check` widening silently enrolled
  `single_input` in the UPDATE policy's default "any account member may rewrite it" escape
  (`kind <> 'note' or can_moderate_note(...)`) — right for the five machine-written kinds, wrong
  for "the single's own words." Widened the escape to
  `kind not in ('note', 'single_input') or can_moderate_note(...)` in
  `"Interactions updatable by author or owning role"` (`05_policies.sql`, both `using` and
  `with check`) and mirrored it in `interactions_summary.can_moderate` (`03_views.sql`). New
  migration `20260730073442_interactions_single_input_moderation.sql` (hand-added
  `alter view … set (security_invoker = on)` after the generated `create or replace view` —
  verified live that, unlike `20260729052308`'s precedent, this `create or replace view` DID clear
  the reloption this time). Extended `supabase/tests/interaction_note_authorship.sql` with checks
  (g2) and AC 5-single, both proved red against the pre-fix escape then green against the fix.
  Corrected the two now-false Dev Notes passages that reasoned only about the SELECT/INSERT
  visibility branch and never considered the UPDATE escape.
- **F3 (strongly recommended, fixed)**: nothing in the suite ever drove `navigator.share` itself —
  the only test touching `navigator.canShare` forced the fallback path. Added a test to
  `ForwardResumeButton.test.tsx` that stubs `navigator.canShare`/`navigator.share` as supported,
  clicks, and asserts the object handed to `navigator.share` holds exactly one file named
  `resume.pdf` — AD-9's photo-exclusion guarantee on the path that actually calls the Web Share
  API, giving AC-4's primary path its first coverage. Proved red against a mutation that added an
  extra file to the share payload.
- F4/F5 (noted, not blocking) were left as recorded in the original review — implementation-pin
  and weak-but-not-vacuous, respectively, not addressed in this pass.

### File List

- `supabase/schemas/01_tables.sql` — widen `interactions_kind_check` to accept `'single_input'`.
- `supabase/migrations/20260730065512_interactions_single_input.sql` — new migration (hand-edited to
  drop the spurious four-view re-emit, per Debug Log).
- `supabase/schemas/05_policies.sql` — review fix (F2): widen the UPDATE policy's
  author-or-owning-role escape to `kind not in ('note', 'single_input')`.
- `supabase/schemas/03_views.sql` — review fix (F2): mirror the widened escape in
  `interactions_summary.can_moderate`.
- `supabase/schemas/02_functions.sql` — review fix (F2): comment-only correction of a stale quoted
  escape literal (no function body change).
- `supabase/migrations/20260730073442_interactions_single_input_moderation.sql` — new migration
  (review fix F2; hand-added the `security_invoker` re-assertion `create or replace view` cleared).
- `supabase/tests/interaction_note_authorship.sql` — review fix (F2): checks (g2) / AC 5-single.
- `supabase/tests/interactions_targets.sql` — positive/negative `single_input` kind-check coverage.
- `src/components/atomic-crm/types.ts` — add `"single_input"` to `InteractionKind`.
- `src/components/atomic-crm/entity360/tabs/interactionLabels.ts` — `INTERACTION_KIND_LABELS` entry.
- `src/components/atomic-crm/entity360/tabs/interactionLabels.test.ts` — extended.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — `activity.kind.single_input`
  + new `entity360.rail.*` namespace.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same, in French.
- `src/components/atomic-crm/providers/fakerest/dataProvider.interactions.test.ts` — extended.
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` — `rightRail: ShidduchRightRail`.
- `src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx` — three rail-integration tests,
  plus review fix (F1): the reminders panel's targetType/targetId + link-href coverage.
- `src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx` — new.
- `src/components/atomic-crm/shidduchim/ShidduchRightRail.guard.test.ts` — new.
- `src/components/atomic-crm/shidduchim/SingleInputPanel.tsx` — new.
- `src/components/atomic-crm/shidduchim/SingleInputPanel.test.tsx` — new.
- `src/components/atomic-crm/shidduchim/ForwardResumeButton.tsx` — new.
- `src/components/atomic-crm/shidduchim/ForwardResumeButton.test.tsx` — new, plus review fix (F3):
  the Web Share primary-path coverage.
- `src/components/atomic-crm/resumes/useLatestResumeFile.ts` — new (shared "newest version" hook +
  sort function).
- `src/components/atomic-crm/resumes/useLatestResumeFile.test.tsx` — new.
- `src/components/atomic-crm/resumes/resumeSharePayload.ts` — new.
- `src/components/atomic-crm/resumes/resumeSharePayload.test.ts` — new.
- `src/components/atomic-crm/resumes/ResumeVersionList.tsx` — refactored to reuse
  `sortResumeFilesNewestFirst`.
- `registry.json` — regenerated (`make registry-gen`).
