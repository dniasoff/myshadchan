# Story 5.7: Shidduch right rail

Status: ready-for-dev

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
write path. The panel is not decorative: extending `interactions_kind_check` now means Epic 6
does not have to touch this table's constraint later, only add the write UI.

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

- [ ] **Task 1 — Schema and the four-place kind widening** (AC: 5, 6)
  - [ ] `supabase/schemas/01_tables.sql`: add `'single_input'` to `interactions_kind_check`
        (`:469-471`).
  - [ ] `types.ts`: add `"single_input"` to `InteractionKind` (`:491-497`).
  - [ ] `entity360/tabs/interactionLabels.ts`: add the `single_input` entry to
        `INTERACTION_KIND_LABELS` (`:36-39`) — `{ key: "crm.entity360.activity.kind.single_input",
        fallback: "…" }`. Non-optional: the map is `Record<InteractionKind, …>`.
  - [ ] `entity360/tabs/interactionLabels.test.ts`: extend, it enumerates the kinds.
  - [ ] **Both** i18n catalogues: `englishCrmMessages.ts:420-427` and
        `frenchCrmMessages.ts:389-396`.
  - [ ] Generate + hand-check migration
        (`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f interactions_single_input`):
        a single `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT` on `interactions_kind_check`
        only — verify `db diff` does **not** also touch `interactions_scope_link_check` or
        `interactions_target_type_check`. Then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset` / `db push`.
  - [ ] `supabase/tests/interactions_targets.sql` **and its paired
        `interactions_targets.test.ts` runner**: this is the existing home for
        `interactions`-constraint coverage — add the positive case (a `single_input` row with
        `scope = 'shidduch'`, `reference_link_id = null` inserts) and the negative
        (a pre-migration kind value is still rejected). Every `.sql` suite in `supabase/tests/`
        has a paired runner; there are no exceptions.
  - [ ] `providers/fakerest/dataProvider.interactions.test.ts`: its fixture pins `kind: "note"`
        (`:15`), so nothing breaks — but the FakeRest mirror is where the `single_input` read path
        gets demo coverage (AD-10). Extend rather than adding a parallel test file.
- [ ] **Task 2 — Rail panels** (AC: 1, 2, 3)
  - [ ] `src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx`: composes the three panels.
        Signature `({ record }: { record: Shidduch })` — see AC-1.
  - [ ] `shidduchim/entityDescriptor.ts`: set `rightRail: ShidduchRightRail`. This is the only
        edit this story makes to that file — it declares **no** tab and touches **neither**
        `tabs` nor `pendingTabs`, so `entity360/registry.stubs.test.ts` stays untouched.
  - [ ] `SingleInputPanel.tsx`: `useGetList("interactions", { filter: { target_type: "shidduch",
        target_id, kind: "single_input" } })`, newest-first, empty state. (Those are **database
        column names in a `getList` filter**, not the universal-tab prop shape — the camelCase
        `targetType`/`targetId` rule applies to `UniversalTabProps` mounts only.)
  - [ ] Reminders panel: mount 3.8's `TasksRailSummary` with
        `targetType="shidduch"` + `targetId` per AC-3 (read-only; the mutating `TasksTab` stays in
        the Tasks tab, which the summary links to via `buildTabPath`). `TasksRailSummary` calls
        `useResourceContext()` and **throws** without one (`TasksRailSummary.tsx:94-99`); mounted
        through `EntityShow` inside `<Resource name="shidduchim">` that context always exists, but
        any isolated test render must supply a `ResourceContextProvider`.
- [ ] **Task 3 — Forward/share action** (AC: 4)
  - [ ] `ForwardResumeButton.tsx`: reads the newest entry from Story 5.3's `ResumeVersionList`
        data (or a small shared hook, `useLatestResumeFile(shidduchimId)`, to avoid duplicating
        the "which version is newest" sort logic already written for 5.3 — extract it into
        `resumes/` if it does not already exist as a reusable function).
  - [ ] Feature-detect `navigator.canShare?.({ files: [...] })`; fall back to a plain `<a
        download>` when unsupported or when no file exists (disabled state, not hidden).
- [ ] **Task 4 — Tests**
  - [ ] Component tests: empty state for `SingleInputPanel`; disabled state for
        `ForwardResumeButton` with no resume; the reminders summary lists at most `limit`
        incomplete tasks, nearest due date first, and renders a link to the Tasks tab.
  - [ ] Rail-region test: an `EntityShow` render for a shidduch shows the rail. Note that
        `EntityShow` **deliberately withholds `rightRail` while the viewer role is pending**
        (`EntityShow.tsx:116-137`) — assert the settled state, and do not "fix" that withholding.
  - [ ] Widened read-only guard per AC-7:
        `shidduchim/ShidduchRightRail.guard.test.ts`, same `?raw` glob idiom as
        `entity360/tabs/TasksRailSummary.guard.test.ts`, scanning `ShidduchRightRail.tsx` and its
        panel modules. 3.8 owns the `TasksRailSummary.tsx` scan; this story owns the wrapper's.
  - [ ] Payload test per AC-4: the forward/share payload holds exactly one `resumes.files`
        entry and nothing derived from `resume_photos`.
  - [ ] `make typecheck && npm run lint && npx vitest run && npm run test:unit:db`.
- [ ] **Task 5 — `registry.json`**
  - [ ] Three new non-test source files land under `src/components/atomic-crm/`
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

### Why no RLS change is needed for `single_input`

Because a `single_input` row is `target_type = 'shidduch'`, it already flows through the existing
`interactions` RLS branch that joins to `shidduchim` and checks `account_id` — the
`target_type = 'shidduch'` `exists` clause at `05_policies.sql:337-345` (select) and its mirror in
`"Interactions insertable within account and parent visibility"` (`:349`). That is the same branch
every other shidduch-targeted interaction (`status_change`, `note` about the shidduch itself)
already uses. Only the `kind` enum needs extending; the visibility/scope machinery is unchanged.
Do not add a new RLS branch for this — that would be solving a problem that does not exist.

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

### Debug Log References

### Completion Notes List

### File List
