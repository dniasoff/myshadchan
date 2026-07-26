# Story 5.10: Reference 360 and per-shidduch diligence

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want diligence to live under the suggestion it is about,
so that a reference is never orphaned from its context.

## Position in Epic 5

Depends on **5.1** (the shidduch's `diligence` tab already holds `ShidduchReferencesSection.tsx`,
unchanged, per 5.1 Task 3) and **Epic 3** (shell, URL-backed tabs, universal Notes/Tasks/Activity
— this story deletes the reference-specific components those universal tabs make redundant).

## Most of the diligence half already exists

`references/ShidduchReferencesSection.tsx` (relocated into the shidduch's `diligence` tab by
Story 5.1) already renders "N of M conversations done" and a per-reference list with call
status. This story's only addition to it is the **"first conversation or one of several"**
indicator per epic AC — which is a direct reuse of logic that already exists one file over:
`references/RepeatRecognitionPanel.tsx` already computes exactly this
(`others = links.filter(link => link.shidduchim_id != null && link.shidduchim_id !==
excludeShidduchimId)`; `others.length === 0` ⇒ first conversation). Extract that predicate into
a small shared helper (e.g. `references/repeatRecognition.ts`,
`countOtherConversations(links, excludeShidduchimId)`) used by **both**
`RepeatRecognitionPanel.tsx` and the new indicator in `ShidduchReferencesSection.tsx` — do not
duplicate the filter.

## The Reference 360 itself: migrate an existing page, and remove a real duplication

`ReferenceShow.tsx` is already a full `<Show>` page with its own (non-URL-backed) `Tabs`:
Conversations, Timeline and notes, Reminders, Assistant. This story migrates it onto the
`Entity360` shell with Story 3.2's URL-backed tabs, and — in the same pass — **removes a genuine
duplication** that migration exposes: `ReferenceTimeline.tsx` already mixes two things Epic 3
now provides as separate universal tabs (Notes and Activity), and `ReferenceTasks.tsx` is a
bespoke reminders implementation Epic 3's universal Tasks tab supersedes. Keeping all three
alongside the new universal tabs would be two ways to do the same thing (violates the
"Single-owner rule" in ARCHITECTURE-SPINE.md's Design Paradigm section) — so this story retires
them.

**One deliberate behaviour simplification, stated so it is not mistaken for a regression:**
`ReferenceTimeline.tsx`'s `AddNote` lets a note be scoped either "generally" or "about a specific
shidduch" (via a `<select>` over that reference's links). The "about a specific shidduch" case is
redundant with diligence's own call-log mechanism (`CallCaptureSheet`/`reference_links.what_they_said`/
`conversation_log`), which already captures per-shidduch commentary about a reference in its
proper place — under that shidduch's own Diligence tab, not the reference's general Notes. This
story's migration to the universal Notes tab keeps only the "general note about this person"
case; per-shidduch commentary continues to live in the call log, where it already belongs. This
removes a second way to record the same kind of information, per NFR-14 — it does not remove any
information that has nowhere else to go.

## Acceptance Criteria

1. **Given** a suggestion, **when** I open its Diligence tab, **then** I see people to speak to
   with progress ("N of M spoken to") — unchanged, already built.
2. **Given** each reference row in the Diligence tab, **when** it renders, **then** it states
   whether this is a first conversation or one of several (via the shared
   `countOtherConversations` helper, excluding the current shidduch).
3. **Given** a reference, **when** I open their own record, **then** it is reached from
   diligence or search — never from primary navigation (`layout/navItems.ts`'s `PRIMARY_NAV`
   already excludes it; this story must not add it there).
4. **Given** a reference's own record, **when** it renders, **then** it is on the `Entity360`
   shell at `/references/{id}/{tab}` with URL-backed tabs: `overview, conversations, notes,
   tasks, activity, assistant`. `overview` holds the identity facts currently inline in
   `ReferenceHeader` (relationship, phone, school, grad year); `conversations` is the existing
   `RepeatRecognitionPanel` + `ReferenceCallLog`, unchanged; `assistant` is the existing
   `ResearchAssistantPanel`, unchanged (still AI-entitlement-gated).
5. **Given** the migration to universal tabs, **when** it completes, **then**
   `ReferenceTimeline.tsx` and `ReferenceTasks.tsx` are deleted — their general-note and
   task-add/toggle behaviour now lives in Epic 3's universal Notes/Tasks components, and no
   second implementation of either remains. The per-shidduch note selector described above is
   not carried forward (per the stated simplification).
6. **Given** the reference merge action, **when** it runs after this story, **then**
   `ReferenceMergeButton.tsx` still works unchanged — this story does not touch merge logic.

## Tasks / Subtasks

- [ ] **Task 1 — Shared reuse-awareness helper** (AC: 2)
  - [ ] Extract `countOtherConversations(links: ReferenceLinkSummary[], excludeShidduchimId?:
        Identifier | null): number` into a new small module (e.g.
        `references/repeatRecognition.ts`), pulling the exact filter predicate out of
        `RepeatRecognitionPanel.tsx` (its `others` computation).
  - [ ] Update `RepeatRecognitionPanel.tsx` to use the extracted helper (no behaviour change —
        verify its existing tests still pass unchanged).
- [ ] **Task 2 — Enrich the Diligence tab** (AC: 1, 2)
  - [ ] In `ShidduchReferencesSection.tsx`, add a small "first conversation" / "one of several"
        label per row, computed via the Task 1 helper against that reference's full link list
        (requires fetching each reference's links, or — cheaper — extending
        `reference_links_summary` with a `linked_shidduchim_count` column mirroring
        `references_summary`'s existing `linked_shidduchim_count`, and reusing that instead of an
        N+1 fetch per row; prefer the view column if it does not already exist there).
- [ ] **Task 3 — Reference descriptor and shell migration** (AC: 3, 4)
  - [ ] Register the `references` entity descriptor: tabs
        `overview, conversations, notes, tasks, activity, assistant`, in that order.
  - [ ] Extract the identity-fact block (relationship/phone/school/grad_year) currently inline in
        `ReferenceHeader` into an `overview` tab; keep contact-style facts (name, avatar) in the
        shell's identity header region.
  - [ ] Wire `conversations` to the existing `RepeatRecognitionPanel` + `ReferenceCallLog`
        (unchanged); wire `assistant` to the existing `ResearchAssistantPanel` (unchanged).
  - [ ] Wire `notes`/`tasks`/`activity` to Epic 3's universal components with
        `target_type: "reference"`.
  - [ ] Confirm `layout/navItems.ts`'s `PRIMARY_NAV` is untouched by this story (AC-3) —
        add a test assertion if one does not already exist pinning "references absent from
        primary nav."
- [ ] **Task 4 — Retire the superseded components** (AC: 5)
  - [ ] Delete `references/ReferenceTimeline.tsx` and `references/ReferenceTasks.tsx` once the
        universal tabs cover their behaviour per AC-5's stated simplification.
  - [ ] `grep -rn "ReferenceTimeline\|ReferenceTasks" src/` returns nothing.
  - [ ] Delete `ReferenceShow.tsx`'s bespoke `Tabs`/`TabsList`/`TabsContent` block once its
        content is relocated onto the shell.
- [ ] **Task 5 — Verify** (AC: 6)
  - [ ] Confirm `ReferenceMergeButton.tsx` and `ReferenceMergeCollision.tsx` are unaffected — no
        edits to merge logic in this story.
  - [ ] `make typecheck && npm run lint && make test`.

## Dev Notes

### Reuse checklist (do not re-derive)

- `references/RepeatRecognitionPanel.tsx` — reuse-awareness, already correct; only extract its
  filter into a shared helper.
- `references/ReferenceCallLog.tsx` + `CallCaptureSheet.tsx` — Conversations tab content,
  unchanged (Story 5.11 extends `CallCaptureSheet`, not this story).
- `references/ResearchAssistantPanel.tsx` — Assistant tab, unchanged.
- `references_summary` view's existing `linked_shidduchim_count` — the closest existing column to
  what Task 2 needs; check before adding a new one to `reference_links_summary`.

### Project Structure Notes

- No new schema for this story unless Task 2 decides to add a column to
  `reference_links_summary` (a view change only, no new table).
- All frontend changes stay inside `references/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.10]
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#The-process] — "reference: reusable
  across suggestions, but always consulted *about* a particular suggestion" — the design
  principle behind keeping diligence on the shidduch, not the reference.
- [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, Single-owner-rule] — rationale for retiring
  `ReferenceTimeline.tsx`/`ReferenceTasks.tsx` rather than keeping them alongside the universal
  tabs.
- [Source: UX-DR8, UX-DR9 in epics.md#UX-Design-Requirements] — references reached from a
  shidduch, not primary nav; reuse awareness mandatory.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
