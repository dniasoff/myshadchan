# Story 5.7: Shidduch right rail

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want context and actions beside the record,
so that the next step is obvious.

## Position in Epic 5

Depends on **5.1** (the shell's optional right-rail region), **5.3** (the resume file version
this story's forward action reads).

## Two ambiguities the epic text leaves open — resolved here

**"Forward resume and share" is one action, not two.** Read literally as four separate rail
widgets ("the single's input, reminders … forward resume and share") it would require a working
external, revocable share mechanism — that is Epic 9's job (Story 9.5), which has not landed and
whose AD-9 Worker-proxied-stream infrastructure does not exist yet (see Story 5.3's Dev Notes).
Building a second, ad-hoc sharing path here would violate AD-9's single-owner intent for outbound
sharing. This story reads "forward resume and share" as **one combined action**: the OS-native
share/download of the suggestion's newest resume file (Story 5.3), using the Web Share API where
supported and a plain download as the fallback. It explicitly does **not** generate a link, a
token, or anything Epic 9 will later own — when Epic 9 lands, its share-link feature replaces
this button's implementation, not adds a second button beside it.

**"The single's input" has no write path yet.** Epic 6 Story 6.4 ("The single's input") is what
lets a single actually submit input on a suggestion, and it lands after Epic 5. This story
builds the **read-side panel** now — it queries `interactions` for a new `kind = 'single_input'`
value and renders whatever it finds, correctly showing an empty state until Epic 6 wires up the
write path. The panel is not decorative: extending `interactions_kind_check` now means Epic 6
does not have to touch this table's constraint later, only add the write UI.

## Acceptance Criteria

1. **Given** a shidduch's 360, **when** it renders, **then** the right rail shows three panels:
   the single's input, reminders on this suggestion, and a combined forward/share action. No
   other entity's descriptor declares this rail in this story (Story 3.1's regions are optional
   per entity).
2. **Given** `interactions` rows with `target_type = 'shidduch'`, `target_id = {id}`,
   `kind = 'single_input'`, **when** the panel renders, **then** it lists them newest-first; when
   there are none, it shows an empty state explaining nothing has been shared yet (not an error,
   not blank).
3. **Given** the reminders panel, **when** I add or complete a task, **then** it writes to
   `tasks` with `target_type = 'shidduch'`, `target_id = {id}` and reflects immediately,
   without leaving the page — the panel **is** Story 3.8's `entity360/tabs/TasksTab.tsx` with
   `{ targetType: "shidduch", targetId }` (3.8 built it precisely by generalising
   `ReferenceTasks.tsx`'s add/toggle behaviour). Do not adapt `ReferenceTasks.tsx` itself —
   Story 5.10 deletes it — and do not write a third task-add/toggle implementation.
4. **Given** the shidduch has at least one resume file version (Story 5.3), **when** I press
   forward/share, **then** the newest version downloads to my device, invoking the Web Share API
   (`navigator.share` with the file) when the browser supports sharing files, else a plain
   download link. **Given** no resume file exists, **then** the button is disabled with a
   tooltip explaining why — never a silent no-op. **And** the payload contains only that one
   `resumes.files` entry — never anything from `resume_photos`: a unit test asserts it (this is
   Story 5.4's "a photo is never included in a share unless chosen" guarantee, whose executable
   half lands here because the action is built here; AD-9, "photo inclusion is the sharer's
   choice").
5. **Given** `interactions_kind_check`, **when** this story's migration lands, **then** it
   includes `'single_input'` in the allowed set; no other constraint on `interactions` changes
   (a `single_input` row is `target_type = 'shidduch'`, `scope = 'shidduch'`,
   `reference_link_id = null` — it already satisfies the existing
   `interactions_scope_link_check` case for shidduch-targeted rows, so that constraint is
   untouched).

## Tasks / Subtasks

- [ ] **Task 1 — Schema** (AC: 5)
  - [ ] `supabase/schemas/01_tables.sql`: add `'single_input'` to `interactions_kind_check`.
  - [ ] `types.ts`: add `"single_input"` to `InteractionKind`.
  - [ ] Generate + hand-check migration (a single `ALTER TABLE … DROP CONSTRAINT … ADD
        CONSTRAINT` — verify `db diff` doesn't also touch `interactions_scope_link_check`, which
        must not change).
- [ ] **Task 2 — Rail panels** (AC: 1, 2, 3)
  - [ ] `src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx`: composes the three panels;
        wire into the shell's right-rail region per the shidduch descriptor.
  - [ ] `SingleInputPanel.tsx`: `useGetList("interactions", { filter: { target_type: "shidduch",
        target_id, kind: "single_input" } })`, newest-first, empty state.
  - [ ] Reminders panel: mount 3.8's `TasksTab` with `targetType: "shidduch"` per AC-3.
- [ ] **Task 3 — Forward/share action** (AC: 4)
  - [ ] `ForwardResumeButton.tsx`: reads the newest entry from Story 5.3's `ResumeVersionList`
        data (or a small shared hook, `useLatestResumeFile(shidduchimId)`, to avoid duplicating
        the "which version is newest" sort logic already written for 5.3 — extract it into
        `resumes/` if it does not already exist as a reusable function).
  - [ ] Feature-detect `navigator.canShare?.({ files: [...] })`; fall back to a plain `<a
        download>` when unsupported or when no file exists (disabled state, not hidden).
- [ ] **Task 4 — Tests**
  - [ ] Component tests: empty state for `SingleInputPanel`; disabled state for
        `ForwardResumeButton` with no resume; add/toggle round-trip for the reminders panel.
  - [ ] Payload test per AC-4: the forward/share payload holds exactly one `resumes.files`
        entry and nothing derived from `resume_photos`.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Reuse

- `entity360/tabs/TasksTab.tsx` (Story 3.8) — the reminders panel, direct mount. Its behaviour
  is `ReferenceTasks.tsx` generalised; the original is deleted by Story 5.10, so nothing may
  build on it here.
- Story 5.3's `ResumeVersionList` sort/latest-version logic — do not re-derive "which file is
  newest."

### Why no RLS change is needed for `single_input`

Because a `single_input` row is `target_type = 'shidduch'`, it already flows through the existing
`interactions` RLS branch that joins to `shidduchim` and checks `account_id`
(`05_policies.sql`, the `target_type = 'shidduch'` `exists` clause) — the same branch every other
shidduch-targeted interaction (`status_change`, `note` about the shidduch itself) already uses.
Only the `kind` enum needs extending; the visibility/scope machinery is unchanged. Do not add a
new RLS branch for this — that would be solving a problem that does not exist.

### Project Structure Notes

- `ShidduchRightRail.tsx` and its panels live in `shidduchim/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.7]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-6-The-Singles-Access, Story 6.4] —
  the future write path this story's read-side panel anticipates.
- [Source: ARCHITECTURE-SPINE.md#AD-9] — why forward/share does not build a revocable link here.
- [Source: ARCHITECTURE-SPINE.md#AD-13] — reminders are polymorphic `tasks`, no SMS channel.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
