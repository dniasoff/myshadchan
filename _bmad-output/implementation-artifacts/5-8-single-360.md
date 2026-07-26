# Story 5.8: Single 360

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want my own single to have the same 360,
so that the app is consistent.

## Position in Epic 5

Depends on **Epic 3** (shell, descriptor registry, universal Notes/Tasks/Activity/Files tabs),
**Story 5.3** (Resume — this story extends it to accept a single as its subject rather than
rebuilding it) and **Story 5.4** (Photo, extended the same way). Independent of 5.1/5.2/5.6/5.7
(those are shidduch-only). Written post-Epic-1: the entity and resource are `singles`
(`src/components/atomic-crm/singles/`), route `/singles/{id}`.

## Two schema gaps this story closes

**1. `tasks`/`interactions` cannot target a single today.** Post-Epic-1 (per Story 1.1),
`tasks_target_type_check` is `('shadchan', 'shidduch', 'reference')` and
`interactions_target_type_check` is `('reference', 'shidduch')` — **neither includes
`'single'`.** Epic 3's Stories 3.5/3.6/3.8 build the universal Activity/Notes/Tasks tabs
generically, but their own ACs never mention extending these enums, and at the time Epic 3 runs
neither the single nor the shadchan 360 exists yet to need it. This story is the first to
actually need `target_type = 'single'`, so it owns adding it — narrowly, when the need is real,
rather than Epic 3 speculatively widening enums for entities that don't have pages yet.

**2. `resumes` (and Story 5.4's `resume_photos`) can only attach to a shidduch.** The epic
requires the single's *own* resume ("the one I send out to shadchanim") to live in the same
Resume/Photo tabs already built for a shidduch's suggested candidate — not a second,
parallel resume feature. This story makes `resumes.shidduchim_id` nullable, adds
`resumes.single_id`, and adds a check ensuring exactly one of the two is set. `resume_photos`
needs no schema change at all: it references `resumes.id`, so once `resumes` supports
`single_id`, a single's photos are already representable.

## Acceptance Criteria

1. **Given** `tasks_target_type_check` and `interactions_target_type_check`, **when** this
   story's migration lands, **then** both include `'single'`; `interactions_scope_link_check`
   gains the case `(scope = 'account' and target_type = 'single' and reference_link_id is
   null)` (a single's own notes/tasks/activity are account-scoped — this epic does not ask for
   a dignity-floor restriction on a single's *own* record, only on suggestion visibility, which
   is unaffected by this change).
2. **Given** `public.resumes`, **when** this story's migration lands, **then**
   `shidduchim_id` is nullable, a new nullable `single_id` column exists (FK to
   `singles(account_id, id)`), and a check constraint enforces exactly one of
   `shidduchim_id`/`single_id` is non-null. The old `unique (shidduchim_id)` becomes two partial
   unique indexes (`unique (shidduchim_id) where shidduchim_id is not null` and
   `unique (single_id) where single_id is not null`) — at most one resume per shidduch, at most
   one per single. **Negative test:** inserting a `resumes` row with both or neither set is
   rejected by the check constraint.
3. **Given** Story 5.3's `ResumeVersionList`/`ResumeUpload` and Story 5.4's `PhotoTab`, **when**
   they are reused for a single, **then** they accept either `{ shidduchimId }` or
   `{ singleId }` as their subject prop — a single, shared implementation, two callers. No new
   upload, version-list or reveal component is written in this story.
4. **Given** one of my singles, **when** I open their record, **then** I see Overview, Resume,
   Photo, Files, Shidduchim, Notes, Tasks, Activity on the `Entity360` shell at
   `/singles/{id}/{tab}`.
5. **Given** the Shidduchim tab, **when** it renders, **then** it lists every shidduch where
   `single_id = {id}` (post Epic 1 Story 1.3's rename), each row a `RecordLink` (Story 3.9) to
   that shidduch's own 360 — not a re-implementation of the board or a second ad-hoc `<Link>`.
6. **Given** the single's Resume tab, **when** it holds a file, **then** that file — not a
   second, separate document — is what any future outbound send to a shadchan (Epic 9) will
   read; this story does not build that outbound flow, it only ensures there is exactly one
   canonical resume location for a single.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm gates** (prerequisite)
  - [ ] Confirm Epic 3's shell/descriptor registry and universal tabs exist (per Story 5.1's
        gate). Confirm Story 5.3 (`resumes` upload path) and Story 5.4 (`resume_photos`) have
        landed — this story extends both rather than reimplementing them.
- [ ] **Task 2 — Extend the polymorphic enums** (AC: 1)
  - [ ] `supabase/schemas/01_tables.sql`: add `'single'` to `tasks_target_type_check` and
        `interactions_target_type_check`; add the new case to
        `interactions_scope_link_check`.
  - [ ] `types.ts`: widen `Interaction.target_type` and `Task`'s target-type union to include
        `"single"`.
  - [ ] Generate + hand-check migration; **this is the first of two stories that touch these same
        constraints** — Story 5.9 lands after this one and must re-specify the *full* allowed
        set (including `'single'`) when it adds `'shadchan'`, not blindly append its own value in
        isolation. Leave a comment in the schema file noting this story added `'single'`, so 5.9's
        author sees it.
  - [ ] Negative test: an `interactions` row with `target_type = 'single'` from account B is
        invisible to account A's client (mirrors the existing cross-account pattern in
        `supabase/tests/references_entity.sql`).
- [ ] **Task 3 — Extend `resumes` to a single** (AC: 2)
  - [ ] `01_tables.sql`: `alter column shidduchim_id drop not null`; add `single_id bigint`; FK
        to `singles(account_id, id)`; drop the old `unique (shidduchim_id)`, add the two partial
        unique indexes; add
        `constraint resumes_owner_check check ((shidduchim_id is not null) <> (single_id is not null))`.
  - [ ] Generate + hand-check migration; confirm `security_invoker`/grants on any view joining
        `resumes` are unaffected (none currently join it, per Story 5.3's investigation — verify
        this is still true).
- [ ] **Task 4 — Generalise the Resume/Photo components** (AC: 3)
  - [ ] `resumes/ResumeVersionList.tsx`, `ResumeUpload.tsx`, `PhotoTab.tsx`: change their subject
        prop from a bare `shidduchimId: Identifier` to a discriminated union
        `{ shidduchimId: Identifier } | { singleId: Identifier }`, and thread it through to
        `add_resume_file`/`add_resume_photo` (Stories 5.3/5.4's RPCs), which already accept
        either target per Task 3's schema change — update their SQL signatures to accept
        `p_single_id` as an alternative to `p_shidduchim_id` (same exactly-one-of check as the
        table).
- [ ] **Task 5 — Single descriptor and tabs** (AC: 4, 5)
  - [ ] Register the `singles` entity descriptor with tabs
        `overview, resume, photo, files, shidduchim, notes, tasks, activity`.
  - [ ] Overview: reuse `singles_summary`'s existing fields (name_en/he, dob, gender, community,
        status) — this data already exists; no new columns needed here.
  - [ ] Shidduchim tab: `useGetList("shidduchim", { filter: { single_id } })`, each row a
        `RecordLink`.
  - [ ] Files/Notes/Tasks/Activity: wire into Epic 3's universal components with
        `target_type: "single"`.
- [ ] **Task 6 — Verify**
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Reuse — the whole point of this story

Do not write a second upload flow, a second version list, or a second reveal-photo component.
Stories 5.3 and 5.4 already built these; this story's only novel work is (a) the two enum/schema
extensions above and (b) threading a single as an alternative subject through existing
components. If a component ends up hard-coded to `shidduchimId` in a way that resists
generalisation, that is a signal 5.3/5.4 under-scoped their own prop design — fix the prop shape
there conceptually, but implement the fix here since this is the story that first needs it.

### Ownership note for Story 5.9

Story 5.9 (Shadchan 360) needs the identical `target_type` extension pattern for `'shadchan'`.
Both stories touch `tasks_target_type_check`/`interactions_target_type_check`/
`interactions_scope_link_check`. This story lands first (per epic order); 5.9's migration must
add `'shadchan'` to the set this story leaves behind (`'shadchan', 'shidduch', 'reference',
'single'`), not redefine the constraint from a stale, pre-5.8 assumption.

### Migration workflow

Edit `supabase/schemas/*`, then run
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_targeting_and_resume_owner`,
hand-check: the constraint edits are plain `DROP`/`ADD CONSTRAINT` (correct as generated), but
`db diff` never emits the partial-unique-index swap or the `resumes_owner_check` constraint
description precisely — read the generated file line by line against Task 2/3 above before
applying. Then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
`db reset`/`db push`.

### Project Structure Notes

- No new top-level folder: `singles/` already exists (post Epic 1 Story 1.3's rename); this story
  adds the descriptor wiring and a `SingleShidduchimTab.tsx` there.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.8]
- [Source: _bmad-output/planning-artifacts/epics.md#Requirements-Inventory, FR92] — "A single has
  a profile and a resume, same person-shape as a candidate."
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "A single sees the same screens as a parent... the
  difference is permission, never a parallel surface" (why this reuses 5.3/5.4 rather than
  forking them).
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md] — the
  post-rename names (`singles`, `single_id`) this story is written against.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
