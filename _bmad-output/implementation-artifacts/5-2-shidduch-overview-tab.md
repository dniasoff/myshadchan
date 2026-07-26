# Story 5.2: Shidduch Overview tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the candidate's details in one place,
so that I can assess without hunting.

## Position in Epic 5

Depends on **5.1** (the `overview` tab and its content container already exist; this story
extends the data model it renders). Written for the post-Epic-1 schema (`shidduchim.child_id`
already renamed to `single_id`, `is_child_visible_state` already renamed to
`is_single_visible_state`).

## Under-specification this story resolves

The epic's AC lists fields the schema does not yet have: **DOB, background, separate father and
mother, marital status, and children**. `shidduchim` today has `age` (no `dob`), a single
combined `parents_en`/`parents_he` (no separate father/mother), and nothing for background,
marital status, or existing children. This story adds them — a decision made here, not left
open:

| New field | Column(s) | Rationale |
|---|---|---|
| Father | `father_en text`, `father_he text` | Replaces `parents_en`/`parents_he` (dropped, not kept alongside — NFR-14). Splitting is a real semantic change the epic asks for; a combined "parents" string cannot render "father, mother" as two facts. |
| Mother | `mother_en text`, `mother_he text` | As above. |
| DOB | `dob date` | Added alongside the existing `age`. Epic wording is "age/DOB" — either may be known; Overview shows both when present, and computes an age hint from `dob` when it is set. |
| Background | `background text` | Single-script, matching the existing `children.community text` pattern (not bilingual like a name — it is prose, not a matching signal, so AD-12's bilingual-identity rule does not apply). |
| Marital status | `marital_status text` | Free text (e.g. "single", "divorced", "widowed") — an enum is not warranted; the field exists across an unbounded set of communities' phrasing and this is descriptive, not a matching key. |
| Existing children | `existing_children_note text` | Free text (e.g. "one daughter, age 6"), not a structured sub-record — the epic's own wording is a fact in a list, not a feature request for a children sub-table. Deliberately **not** named `children` — that word is retired for the single being redt for (AD-23); this describes the *suggested person's own* prior children, a different real-world concept, and the column name must not read as a rename-guard false-positive. |

Existing production data is demo/test only (SPEC Assumptions), so `parents_en`/`parents_he` are
dropped outright with no migration-and-carry-forward of their values into father/mother — a
free-text "Mr. and Mrs. Cohen" cannot be split programmatically into two identities without
inventing data, and NFR-14 forbids leaving the old columns as a shim.

## Acceptance Criteria

1. **Given** a suggestion, **when** I open Overview, **then** I see: name (en + he), age and/or
   DOB, height, background, location (en + he), shul (en + he), current and earlier
   yeshiva/seminary (via the existing `ShidduchSchoolsSection`, unchanged), father (en + he),
   mother (en + he), marital status, and the existing-children note.
2. **Given** any of the above fields has no value, **when** Overview renders, **then** that field
   is omitted from the DOM entirely — never rendered blank or with a placeholder (`FactRow`'s
   existing null-guard pattern in `ShidduchFactsCard.tsx` already does this; extend it, do not
   fork a second pattern).
3. **Given** the schema change, **when** it lands, **then** `parents_en`/`parents_he` no longer
   exist anywhere — table, view, RPC parameter, TypeScript type, i18n key, FakeRest generator, or
   seed data. `grep -rniE 'parents_en|parents_he|p_parents'` over `src/` and `supabase/schemas`
   returns zero hits.
4. **Given** `create_shidduch()`, **when** a suggestion is created, **then** it accepts
   `p_father_en`, `p_father_he`, `p_mother_en`, `p_mother_he`, `p_dob`, `p_background`,
   `p_marital_status`, `p_existing_children_note` (all nullable) in place of `p_parents_en`/
   `p_parents_he`, and `ShidduchCreate.tsx`/`ShidduchInputs.tsx` collect them.
5. **Given** the toolchain, **when** run over this story's changed files, **then**
   `make typecheck && npm run lint && make test && npm run test:unit:db` pass, plus a negative
   RLS regression check that the existing `shidduchim` cross-account test in
   `supabase/tests/shidduch_catch.sql` still passes unchanged (this story does not touch RLS,
   only columns — a passing existing test is the proof nothing broke).

## Tasks / Subtasks

- [ ] **Task 1 — Schema** (AC: 3, 4)
  - [ ] `supabase/schemas/01_tables.sql`: on `public.shidduchim`, drop `parents_en`/`parents_he`,
        add `father_en`, `father_he`, `mother_en`, `mother_he`, `dob date`, `background text`,
        `marital_status text`, `existing_children_note text`.
  - [ ] `supabase/schemas/03_views.sql`: update `shidduchim_summary` to select the new columns in
        place of `parents_en`/`parents_he`.
  - [ ] `supabase/schemas/02_functions.sql`: `create_shidduch()` — rename/replace the
        `p_parents_en`/`p_parents_he` parameters and every body reference (see Dev Notes "Files
        verified" for the parameter's other read sites, e.g. `catch_shidduch()` if it echoes
        these fields — verify with `LSP findReferences` before editing, not by re-grepping).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shidduch_overview_fields`,
        hand-check: this is a genuine `DROP COLUMN` + `ADD COLUMN` (not a rename — the concepts
        are different, per the table above), so the generated migration's plain form is correct
        here, unlike a same-meaning rename. Re-verify the view still declares
        `security_invoker = on` and the `create_shidduch` grants survive the
        `DROP FUNCTION`/`CREATE FUNCTION` cycle (a signature change forces a drop-first, exactly
        as `1-3-rename-children-to-singles.md` Task 3 documents for `is_child_visible_state`).
  - [ ] Apply with `migration up --local`. Never `db reset`/`db push`.
- [ ] **Task 2 — Types and providers** (AC: 3, 4)
  - [ ] `types.ts`: `Shidduch`, `ShidduchSummary`, `CreateShidduchInput` — replace
        `parents_en`/`parents_he` with the 8 new fields.
  - [ ] `providers/supabase/dataProvider.ts` (`createShidduchViaRpc`),
        `providers/fakerest/dataProvider.ts`, `providers/fakerest/dataGenerator/shidduchim.ts`,
        `providers/fakerest/internal/shidduchCatch.ts` (+ `.test.ts`).
  - [ ] `providers/commons/englishCrmMessages.ts` / `frenchCrmMessages.ts`: field labels.
  - [ ] `supabase/functions/seed_demo/dataset.ts` / `index.ts`: seed data uses the new fields.
- [ ] **Task 3 — UI** (AC: 1, 2)
  - [ ] `ShidduchFactsCard.tsx`: replace the single "Parents" `FactRow` with "Father"/"Mother"
        rows; add "Background", "Marital status", "Existing children" rows; add a DOB display
        alongside Age (show DOB when present, else the stored `age`).
  - [ ] `ShidduchInputs.tsx` / `ShidduchCreate.tsx`: form fields for the 8 new inputs.
  - [ ] `inbox/InboxResolveDialog.tsx`: update its `parents_en`/`parents_he` reference (it prefills
        `create_shidduch` from a parsed inbox item).
- [ ] **Task 4 — Verify** (AC: 3, 5)
  - [ ] Run `grep -rniE 'parents_en|parents_he|p_parents' src/ supabase/schemas supabase/functions supabase/tests`
        — zero hits (18 files touched this pass, verified 2026-07-26 on `main`; excludes
        `supabase/tests/child_portal.sql`, already deleted by Epic 1 Story 1.4, and
        `supabase/migrations/*`, which are never edited).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Files verified (2026-07-26, current `main`)

`grep -rln "parents_en\|parents_he\|p_parents"` over `src/`, `supabase/schemas`,
`supabase/functions`, `supabase/tests` returns 19 files; excluding
`supabase/tests/child_portal.sql` (deleted by Epic 1 Story 1.4 before this story runs), **18**
remain: `inbox/InboxResolveDialog.tsx`, `providers/commons/{english,french}CrmMessages.ts`,
`providers/fakerest/dataGenerator/shidduchim.ts`, `providers/fakerest/dataProvider.ts`,
`providers/fakerest/internal/shidduchCatch.ts` (+`.test.ts`),
`providers/supabase/dataProvider.ts`, `shidduchim/ShidduchCreate.tsx`,
`shidduchim/ShidduchFactsCard.tsx`, `shidduchim/ShidduchInputs.tsx`, `types.ts`,
`supabase/functions/seed_demo/{dataset.ts,index.ts}`, `supabase/schemas/{01_tables,02_functions,03_views}.sql`,
`supabase/tests/shidduch_catch.sql`. Re-run the grep before starting — Epic 1 stories land first
and may shift line numbers or this file list.

### Reuse

`ShidduchFactsCard.tsx`'s `FactRow` component already implements the exact null-omission pattern
AC-2 requires (`if (!en && !he && !plain) return null;`) — add rows to it, do not write a second
fact-row primitive.

### Testing standard

Per `.claude/rules/testing.md`: AAA structure, 80% coverage on new code paths. The
`shidduchCatch.test.ts` and `pipelineStates.test.ts` suites already exercise `Shidduch`-shaped
fixtures — update their fixtures to the new fields rather than adding parallel fixtures.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.2]
- [Source: AGENTS.md#Database-Management] — schema-first workflow, `db diff` → hand-check → `migration up`.
- [Source: ARCHITECTURE-SPINE.md#AD-12] — bilingual rule scoped to identity/matching fields, not prose.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md#Task-3] — the
  drop-function-before-recreate pattern this story's RPC signature change must follow.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
