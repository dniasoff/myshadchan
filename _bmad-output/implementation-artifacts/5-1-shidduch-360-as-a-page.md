# Story 5.1: Shidduch 360 as a page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the suggestion opened as a full page,
so that I can work in it and link to it.

## World state assumed

Written for the **post-Epic-1 through post-Epic-4** codebase. This story cannot start until,
and must `grep` to confirm, all of the following exist:

- Epic 1: `children` → `singles` (table, resource, `Single`/`SingleSummary` types, route
  `/singles`), `shidduchim.child_id` → `single_id`, `root/CRM.tsx` replaced by a `.map()` over
  `root/routeManifest.ts` (Epic 1 Story 1.5).
- Epic 3: `Entity360` shell (Story 3.1, fixed region order: breadcrumb → identity header → stat
  band → alert slot → tab bar → content → optional right rail), URL-backed tabs (Story 3.2,
  `/{entity}/{id}/{tab}`), the entity descriptor registry (Story 3.3), permission-aware tab/field
  rendering (Story 3.4).

**Gate, not a design choice:** before writing any code, run
`grep -rn "Entity360\|routeManifest" src/components/atomic-crm/` and confirm the shell and the
descriptor registry exist. If they do not, Epic 3 has not landed and this story cannot proceed —
stop and report rather than improvising a shell.

## Acceptance Criteria

1. **Given** a suggestion, **when** I open it from the board (`ShidduchCard.tsx`) or a list
   (Story 4.3), **then** it navigates to `/shidduchim/{id}` and renders via the shared
   `Entity360` shell — not `ShidduchShow`'s routed `Dialog`.
2. **Given** the shidduch entity descriptor, **when** it is registered, **then** its tab set is
   `overview | diligence | notes | tasks | activity` in that order — the five tabs that already
   have real content today. `resume`, `photo`, `medical`, `files` and `external-links` are
   **not** declared by this story; Stories 5.3–5.6 each insert their own tab at the position
   shown in UX-DR5's shidduch tab matrix (amendment A2): `overview, resume, photo, medical,
   files, diligence, external-links, notes, tasks, activity`. This story must not create empty
   placeholder tabs for content that does not exist yet.
3. **Given** the existing 360 content, **when** it is relocated, **then**:
   - `ShidduchShowHeader.tsx` + `ShidduchFactsCard.tsx` + `RedtHistorySection.tsx` +
     `ShidduchSchoolsSection.tsx` + `ShidduchCatchSection.tsx` render under the `overview` tab,
     unchanged in behaviour (Story 5.2 later extends the fields Overview shows; this story only
     moves the container).
   - `ShidduchReferencesSection.tsx` renders under the `diligence` tab, unchanged in behaviour
     (Story 5.10 later enriches it with reuse-awareness).
   - `ShidduchStateControl.tsx` (the pipeline-transition UI the routed dialog renders today)
     is relocated into the shell's identity-header/actions region per the descriptor contract,
     so a state change stays available from every tab — relocated, not rewritten. Deleting the
     dialog without re-homing it would remove the only transition UI on the 360.
   - Notes, Tasks and Activity render via Epic 3's universal `NotesTab`/`TasksTab`/`ActivityTab`
     (Stories 3.6/3.8/3.5) with `targetType: "shidduch"` — this story wires the shidduch entity
     into them, it does not build new note/task/activity UI.
   - `ShidduchTimeline.tsx` (rendered only by `ShidduchShow.tsx`) is **deleted** — its two
     behaviours (add-a-note, timeline) are superseded by the universal Notes and Activity tabs.
     Story 3.6's own text assigns exactly this retirement to Epic 5's migration.
     `grep -rn "ShidduchTimeline" src/` returns nothing afterwards.
4. **Given** the old routed dialog, **when** this story completes, **then** `ShidduchShow.tsx`
   is deleted, `ShidduchimList.tsx`'s `matchPath("/shidduchim/:id/show", …)` / `<ShidduchShow>`
   wiring is removed, and no route or component named `ShidduchShow`/`/shidduchim/:id/show`
   remains anywhere in `src/`.
5. **Given** that Story 3.9's sweep already routes record mentions through `RecordLink` —
   including `ShidduchCard.tsx` and `shadchanim/ShadchanSuggestions.tsx`, both in its 12-site
   list — **when** this story changes the route shape, **then** the change is made in **one
   place**: the shidduchim registration's `buildRecordPath` becomes
   ``(id) => `/shidduchim/${id}` `` (3.9's Dev Notes name this exact edit as Epic 5's to make),
   and 3.9's route-pinning test is updated to the new shape. Do not edit the `RecordLink`
   call sites — they follow the registry. The **one** hand-built site 3.9's line-based
   verification grep could not see — the multi-line `redirect()` call in
   `ShidduchCatchSection.tsx` (~line 36, URL template on the following line) — is converted to
   the registry path (`getEntityDescriptor("shidduchim").buildRecordPath(id)`). Afterwards
   `grep -rn "shidduchim/" src/components/atomic-crm --include='*.tsx' --include='*.ts' | grep "/show"`
   returns zero hits.
6. **Given** I am on a shidduch's 360 page, **when** I press the browser back button, **then** I
   return to the board or list I came from via native history — no custom navigation stack is
   introduced.
7. **Given** the page at 375px width and in both light and dark themes, **when** it renders,
   **then** no region overflows or clips (UX-DR11) — a manual smoke check, not a new visual
   regression harness.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the Epic 3 gate** (prerequisite to all ACs)
  - [ ] Run the grep in "World state assumed". If `Entity360` or the descriptor registry is
        missing, stop and report — do not build a local substitute.
  - [ ] Read Story 3.1–3.4's actual shipped shape (region props, descriptor field names, the
        URL-tab hook) before writing the descriptor — this story consumes that API, it does not
        guess at it.
- [ ] **Task 2 — Register the shidduch descriptor** (AC: 1, 2)
  - [ ] Add a shidduch entry to the descriptor registry with the tab list from AC-2, in order.
  - [ ] Confirm `/shidduchim/{id}` renders the shell and `/shidduchim/{id}/{tab}` deep-links
        correctly (Story 3.2's contract); an unrecognised tab segment falls back to `overview`.
- [ ] **Task 3 — Relocate existing content into tabs** (AC: 3)
  - [ ] Move `ShidduchShowHeader`, `ShidduchFactsCard`, `RedtHistorySection`,
        `ShidduchSchoolsSection`, `ShidduchCatchSection` into the shell's identity-header /
        `overview`-tab content slots per the descriptor contract — relocate, do not rewrite.
  - [ ] Relocate `ShidduchStateControl` into the shell's identity-header/actions region.
  - [ ] Move `ShidduchReferencesSection` into the `diligence` tab.
  - [ ] Wire the shidduch entity into Epic 3's universal `NotesTab`/`TasksTab`/`ActivityTab`
        with `targetType: "shidduch"`, then delete `ShidduchTimeline.tsx` (superseded;
        `grep -rn "ShidduchTimeline" src/` returns nothing).
- [ ] **Task 4 — Delete the dialog and fix routing** (AC: 4, 5, 6)
  - [ ] Delete `src/components/atomic-crm/shidduchim/ShidduchShow.tsx`.
  - [ ] In `ShidduchimList.tsx`, remove the `matchShow`/`<ShidduchShow open={...} id={...}>`
        wiring (lines ~77, ~91 on current `main`).
  - [ ] Update the shidduchim `buildRecordPath` registration to `/shidduchim/{id}` and 3.9's
        route-pinning test with it; convert `ShidduchCatchSection.tsx`'s multi-line `redirect()`
        to the registry path (AC-5).
  - [ ] `grep -rn "ShidduchShow\b" src/` returns nothing; the AC-5 `/show` grep returns nothing.
- [ ] **Task 5 — Verify** (AC: 7)
  - [ ] Manual smoke at 375px, light and dark.
  - [ ] `make typecheck && npm run lint && make test` on changed files; existing
        `ShidduchCatchPanel.test.tsx` and any `ShidduchimList` tests pass unchanged in intent
        (URLs updated where they assert the old `/show` path).

## Dev Notes

### Reuse — do not rebuild what already works

Every visual piece of the current 360 already exists and is well-built; this story's job is
**delivery mechanism** (page vs modal) and **routing**, not a redesign:

- `shidduchim/ShidduchShowHeader.tsx` — hero header (monogram, bilingual name, state chip,
  `via {shadchan} · Redt {date}`).
- `shidduchim/ShidduchStateControl.tsx` — the pipeline-transition UI (calls
  `dataProvider.transitionShidduch()` → the `transition_shidduch()` guard, AD-4); relocated,
  never rebuilt.
- `shidduchim/ShidduchFactsCard.tsx` — the facts grid (Story 5.2 extends its fields).
- `shidduchim/RedtHistorySection.tsx` — redt history + add-a-redt form.
- `shidduchim/ShidduchSchoolsSection.tsx`, `shidduchim/ShidduchCatchSection.tsx`.
- `references/ShidduchReferencesSection.tsx` — this **is** the Diligence tab already; Story 5.10
  only adds the first/repeat indicator on top of it.

The one component of the old dialog that is **not** carried forward is `ShidduchTimeline.tsx`:
its add-a-note and timeline behaviours are exactly what 3.6's `NotesTab` and 3.5's `ActivityTab`
provide, and keeping it would be two implementations of the same thing (Single-owner rule).

### Why a page, not a `Show`

`ShidduchShow.tsx`'s own doc comment already explains the current design intent ("A routed
Dialog … over the board, not a `Show`, so the board stays visible behind the scrim") — that
intent is exactly what this story overturns per AD-24 ("records live at URLs, not modals") and
UX-DR3. `ShadchanShow.tsx` and `ReferenceShow.tsx` are already real `<Show>` pages (Stories 5.9,
5.10 migrate those onto the shell too) — this story brings Shidduch in line with the pattern
those two already follow structurally, even though they are not yet on `Entity360` either.

### Ordering inside Epic 5

This is the **first** Epic 5 story to land. Stories 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.10 and 5.11
all edit content that lives inside the tabs this story creates — they depend on this story, not
the other way around. Story 5.8 (Single 360) and 5.9 (Shadchan 360) are independent pages but
reuse components this story's siblings build (5.3's Resume, 5.4's Photo) — see their own Dev
Notes.

### Project Structure Notes

- No new schema, no new database objects. Purely a frontend relocation + Epic-3-consumption
  story.
- Follows the `src/components/atomic-crm/<domain>/` convention already in place; no new
  directories.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.1]
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#UX-DR5]
  — the shidduch tab matrix and its canonical order.
- [Source: ARCHITECTURE-SPINE.md#AD-24] — shell, routes, `RecordLink`, no bespoke layout code.
- [Source: ARCHITECTURE-SPINE.md#AD-23] — post-Epic-1 naming this story is written against.
- [Source: _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — the
  `buildRecordPath` registration this story updates, and the 12-site sweep that already
  converted the board card and `ShadchanSuggestions` links.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Capabilities, CAP-7]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
