# Story 5.9: Shadchan 360

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want a shadchan's record to match,
so that I can see our history at a glance.

## Position in Epic 5

Depends on **Epic 3** (shell, `RecordLink`, universal Notes/Tasks/Activity tabs — including
Story 3.5, which already made `'shadchan'` a legal `interactions` target with its RLS branch
and scope-check case). Independent of 5.8 apart from sharing that same verified ground.

## Most of this already exists — reuse, do not rebuild

`ShadchanShow.tsx` is **already a real `<Show>` page**, not a modal — unlike Shidduch, this is a
graduation of an existing page onto the shared shell, not a modal-to-page conversion:

- `ShadchanHeader.tsx` already renders the identity header **and already has working contact
  quick actions** (`tel:`, `wa.me`, `mailto:` links reading `shadchan.contacts` jsonb via
  `parseContactInfo()`) — this is exactly the epic's "contact quick actions" requirement,
  fully built. Reuse verbatim as the shell's identity-header content.
- `ShadchanStatsRow` (defined inside `ShadchanShow.tsx` — extract it to its own file when the
  `<Show>` wrapper is deleted) / the `shadchan_stats` view already provide the "stat band"
  (suggestions, progressed, reached-yes counts) — reuse as the shell's stat-band region.
- `ShadchanSuggestions.tsx` already lists every suggestion from this shadchan, and Story 3.9's
  sweep already converted its link to `RecordLink` (it is in 3.9's 12-site list) — the URL it
  renders follows the shidduchim registry entry Story 5.1 updates. This story's own routing
  change is one line in the registry: the **shadchanim** `buildRecordPath` (see AC-4).

## One data-model cleanup this story owns: `shadchanim.notes`

`shadchanim.notes text` is a single free-text column, predating the polymorphic
`interactions`-backed Notes pattern every other entity uses (the Single-owner rule in
ARCHITECTURE-SPINE.md's Design Paradigm). Once the shadchan has a real universal Notes tab (this story wires it in per
Task 3), keeping a second, parallel `notes` column is exactly the kind of duplicate concept
NFR-14 forbids. This story migrates existing `shadchanim.notes` values into `interactions`
(`kind = 'note'`, `target_type = 'shadchan'`) and drops the column in the same migration —
replaced, not left behind. `ShadchanHeader.tsx`'s inline notes block (lines ~101-110) is removed
in the same change; notes now live only in the Notes tab.

## Acceptance Criteria

1. **Given** the post-Epic-3 schema, **when** this story starts, **then**
   `select pg_get_constraintdef(oid) from pg_constraint where conname in
   ('tasks_target_type_check', 'interactions_target_type_check',
   'interactions_scope_link_check');` confirms `'shadchan'` is already a legal target
   everywhere it needs to be — `tasks` allowed it before Epic 5; Story 3.5 added it to
   `interactions` together with the `scope = 'account'` branch and the RLS branch. This story
   ships **no** migration for these constraints; if `'shadchan'` is missing, Epic 3 has not
   landed — stop and report.
2. **Given** `shadchanim.notes`, **when** this story's migration lands, **then** every non-null
   value has been copied into an `interactions` row (`target_type = 'shadchan'`,
   `scope = 'account'`, `kind = 'note'`, `body = notes`) and the `notes` column is dropped in the
   same migration. `ShadchanHeader.tsx` no longer renders a notes block.
3. **Given** a shadchan, **when** I open their record, **then** it renders via the `Entity360`
   shell at `/shadchanim/{id}/{tab}` with tabs `overview, suggestions, notes, tasks, activity`;
   the identity header is `ShadchanHeader.tsx` unchanged (contact quick actions intact) and the
   stat band is the existing `shadchan_stats` reuse, unchanged.
4. **Given** Story 3.9 already routes every shadchan record mention through `RecordLink`,
   **when** this story changes the shadchan route shape, **then** the change is one line: the
   shadchanim registration's `buildRecordPath` becomes ``(id) => `/shadchanim/${id}` `` and
   3.9's route-pinning test is updated. `ShadchanSuggestions.tsx` needs no edit — verify it
   renders `RecordLink` rows targeting `/shidduchim/{id}` (Story 5.1's registry update) and
   that `grep -rn "/show" src/components/atomic-crm/shadchanim/` returns nothing.
5. **Given** the migration, **when** a negative RLS test runs, **then** a member with no
   membership in the account cannot read that account's shadchan-targeted `interactions`/`tasks`
   rows (the existing account-scope branch already proves this shape for `reference`/`shidduch`
   targets — extend the same test, do not write a new test style).

## Tasks / Subtasks

- [ ] **Task 1 — Verify the polymorphic targets, do not migrate them** (AC: 1)
  - [ ] Run the AC-1 `pg_get_constraintdef` query; confirm `types.ts`'s
        `Interaction.target_type` already carries `"shadchan"` (Story 3.5's edit). No schema or
        type change here.
- [ ] **Task 2 — Migrate and drop `shadchanim.notes`** (AC: 2)
  - [ ] Hand-add to the generated migration (data steps are never auto-emitted by `db diff`):
        `insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
        select account_id, 'shadchan', id, 'account', 'note', notes from public.shadchanim where
        notes is not null and notes <> '';` **before** `alter table public.shadchanim drop
        column notes;`.
  - [ ] `types.ts`: remove `notes` from the `Shadchan` type.
  - [ ] `ShadchanHeader.tsx`: remove the notes block (~lines 101-110) and the now-unused prop
        path.
  - [ ] Seed data needs no value migration — verified 2026-07-26: `seed_demo/dataset.ts`'s
        `DemoShadchan` has no `notes` field and `dataGenerator/shidduchim.ts`'s `shadchanimSeed`
        sets none. Just confirm both still compile once `Shadchan.notes` is removed.
- [ ] **Task 3 — Shell wiring** (AC: 3)
  - [ ] Register the `shadchanim` descriptor: identity header = `ShadchanHeader`, stat band =
        `ShadchanStatsRow`, tabs `overview, suggestions, notes, tasks, activity`.
  - [ ] `overview` tab: whatever `Shadchan` fields remain outside the header (location, if not
        already in the header — check `ShadchanHeader.tsx` before adding a duplicate render of
        the same field).
  - [ ] `suggestions` tab: `ShadchanSuggestions.tsx`, unchanged (already `RecordLink`-based
        post-3.9).
  - [ ] `notes`/`tasks`/`activity`: Epic 3's universal components with `target_type: "shadchan"`.
  - [ ] Delete `ShadchanShow.tsx`'s standalone `<Show>` wrapper once its content is relocated
        into the descriptor (extract the inline `ShadchanStatsRow` to its own file in the same
        move; mirrors Story 5.1's pattern for Shidduch, applied here to an already-real page).
- [ ] **Task 4 — Routing** (AC: 4)
  - [ ] Update the shadchanim `buildRecordPath` registration to `/shadchanim/{id}` and 3.9's
        route-pinning test with it.
  - [ ] `grep -rn "/show" src/components/atomic-crm/shadchanim/` returns nothing afterward.
- [ ] **Task 5 — Tests** (AC: 5)
  - [ ] Extend the existing cross-account `interactions` test to cover `target_type = 'shadchan'`.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Ownership note (read before touching the schema)

Neither this story nor 5.8 edits `tasks_target_type_check`, `interactions_target_type_check`
or `interactions_scope_link_check` — Stories 3.5/3.8 already delivered every value both need
(`'shadchan'`, `'single'`, the scope branches, the RLS branches). The only migration in this
story is the `shadchanim.notes` backfill-and-drop (Task 2). If a generated diff contains a
`*_target_type_check` line, the schema files were edited from a stale assumption — revert it.

### Reuse checklist (do not re-derive any of these)

- `ShadchanHeader.tsx` — identity header + contact quick actions, unchanged.
- `shadchan_stats` view + `ShadchanStatsRow` — stat band, unchanged.
- `ShadchanSuggestions.tsx` — suggestions list, one link-primitive swap only.

### Migration workflow

Edit `supabase/schemas/*`, then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_notes_migration`,
hand-check: `db diff` never emits the `insert into interactions select … from shadchanim`
backfill (Task 2) — add it by hand, positioned **before** the `drop column notes` statement, or
the data is gone before it is copied. Then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`/`db push`.

### Project Structure Notes

- No new folder; all changes are inside the existing `shadchanim/` directory.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.9]
- [Source: ARCHITECTURE-SPINE.md#AD-24] — `RecordLink` as the single record-mention primitive;
  the route-shape change flows through the registry, never through call-site edits.
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md#AC-1] — the
  `'shadchan'` interactions widening this story verifies instead of redoing.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
