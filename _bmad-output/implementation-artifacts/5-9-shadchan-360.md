# Story 5.9: Shadchan 360

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want a shadchan's record to match,
so that I can see our history at a glance.

## Position in Epic 5

Depends on **Epic 3** (shell, `RecordLink`, universal Notes/Tasks/Activity tabs) and **Story
5.8** (which lands first and extends the same `tasks`/`interactions` `target_type` constraints
this story also touches — see "Ownership note" below; get this wrong and one story's migration
silently drops the other's allowed value).

## Most of this already exists — reuse, do not rebuild

`ShadchanShow.tsx` is **already a real `<Show>` page**, not a modal — unlike Shidduch, this is a
graduation of an existing page onto the shared shell, not a modal-to-page conversion:

- `ShadchanHeader.tsx` already renders the identity header **and already has working contact
  quick actions** (`tel:`, `wa.me`, `mailto:` links reading `shadchan.contacts` jsonb via
  `parseContactInfo()`) — this is exactly the epic's "contact quick actions" requirement,
  fully built. Reuse verbatim as the shell's identity-header content.
- `ShadchanStatsRow`/the `shadchan_stats` view already provide the "stat band" (suggestions,
  progressed, reached-yes counts) — reuse as the shell's stat-band region.
- `ShadchanSuggestions.tsx` already lists every suggestion from this shadchan — it just uses an
  ad-hoc `<Link to={`/shidduchim/${item.id}/show`}>` instead of `RecordLink`, which is this
  story's one concrete UI change (and the `/show` suffix needs the same fix Story 5.1 applied
  elsewhere, since Story 5.1 deliberately left this link for this story to avoid a diff
  collision).

## One data-model cleanup this story owns: `shadchanim.notes`

`shadchanim.notes text` is a single free-text column, predating the polymorphic
`interactions`-backed Notes pattern every other entity uses (AD's "one code path per
behaviour"). Once the shadchan has a real universal Notes tab (this story wires it in per
Task 2), keeping a second, parallel `notes` column is exactly the kind of duplicate concept
NFR-14 forbids. This story migrates existing `shadchanim.notes` values into `interactions`
(`kind = 'note'`, `target_type = 'shadchan'`) and drops the column in the same migration —
replaced, not left behind. `ShadchanHeader.tsx`'s inline notes block (lines ~101-110) is removed
in the same change; notes now live only in the Notes tab.

## Acceptance Criteria

1. **Given** `tasks_target_type_check` and `interactions_target_type_check`, **when** this
   story's migration lands, **then** both include `'shadchan'` **in addition to** whatever
   Story 5.8 already added (`'single'`) — the full set, re-specified, not appended blindly onto
   a stale assumption. `interactions_scope_link_check` gains
   `(scope = 'account' and target_type = 'shadchan' and reference_link_id is null)`.
2. **Given** `shadchanim.notes`, **when** this story's migration lands, **then** every non-null
   value has been copied into an `interactions` row (`target_type = 'shadchan'`,
   `scope = 'account'`, `kind = 'note'`, `body = notes`) and the `notes` column is dropped in the
   same migration. `ShadchanHeader.tsx` no longer renders a notes block.
3. **Given** a shadchan, **when** I open their record, **then** it renders via the `Entity360`
   shell at `/shadchanim/{id}/{tab}` with tabs `overview, suggestions, notes, tasks, activity`;
   the identity header is `ShadchanHeader.tsx` unchanged (contact quick actions intact) and the
   stat band is the existing `shadchan_stats` reuse, unchanged.
4. **Given** `ShadchanSuggestions.tsx`, **when** it renders, **then** its list uses `RecordLink`
   (Story 3.9) in place of the ad-hoc `<Link>`, and the URL it targets is `/shidduchim/{id}`
   (no `/show` suffix).
5. **Given** the migration, **when** a negative RLS test runs, **then** a member with no
   membership in the account cannot read that account's shadchan-targeted `interactions`/`tasks`
   rows (the existing account-scope branch already proves this shape for `reference`/`shidduch`
   targets — extend the same test, do not write a new test style).

## Tasks / Subtasks

- [ ] **Task 1 — Confirm Story 5.8 landed** (prerequisite to Task 2)
  - [ ] `grep -n "tasks_target_type_check\|interactions_target_type_check" supabase/schemas/01_tables.sql`
        and confirm `'single'` is already present. If not, Story 5.8 has not landed — this
        story's Task 2 must not proceed against a stale constraint.
- [ ] **Task 2 — Extend the polymorphic enums** (AC: 1)
  - [ ] `01_tables.sql`: `tasks_target_type_check` → `('shadchan', 'shidduch', 'reference',
        'single')` (unchanged from 5.8 — `'shadchan'` was already in the set); add `'shadchan'`
        to `interactions_target_type_check` → `('reference', 'shidduch', 'single', 'shadchan')`;
        add the new `interactions_scope_link_check` case.
  - [ ] `types.ts`: widen `Interaction.target_type` to include `"shadchan"` (note: `tasks`
        already allowed `'shadchan'` before Epic 5 — only `interactions` is new here).
  - [ ] Generate + hand-check migration.
- [ ] **Task 3 — Migrate and drop `shadchanim.notes`** (AC: 2)
  - [ ] Hand-add to the generated migration (data steps are never auto-emitted by `db diff`):
        `insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
        select account_id, 'shadchan', id, 'account', 'note', notes from public.shadchanim where
        notes is not null and notes <> '';` **before** `alter table public.shadchanim drop
        column notes;`.
  - [ ] `types.ts`: remove `notes` from the `Shadchan` type.
  - [ ] `ShadchanHeader.tsx`: remove the notes block (~lines 101-110) and the now-unused prop
        path.
  - [ ] `providers/fakerest/dataGenerator/shidduchim.ts` (or wherever shadchan seed data is
        generated) and `supabase/functions/seed_demo/dataset.ts`: drop seeded `notes` values in
        favour of a seeded `interactions` note row, if any demo shadchan currently has one.
- [ ] **Task 4 — Shell wiring** (AC: 3)
  - [ ] Register the `shadchanim` descriptor: identity header = `ShadchanHeader`, stat band =
        `ShadchanStatsRow`, tabs `overview, suggestions, notes, tasks, activity`.
  - [ ] `overview` tab: whatever `Shadchan` fields remain outside the header (location, if not
        already in the header — check `ShadchanHeader.tsx` before adding a duplicate render of
        the same field).
  - [ ] `suggestions` tab: `ShadchanSuggestions.tsx`, updated per Task 5.
  - [ ] `notes`/`tasks`/`activity`: Epic 3's universal components with `target_type: "shadchan"`.
  - [ ] Delete `ShadchanShow.tsx`'s standalone `<Show>` wrapper once its content is relocated
        into the descriptor (mirrors Story 5.1's pattern for Shidduch, applied here to an
        already-real page).
- [ ] **Task 5 — `RecordLink` and routing** (AC: 4)
  - [ ] `ShadchanSuggestions.tsx`: replace the `<Link to={`/shidduchim/${item.id}/show`}>` with
        `RecordLink` targeting `/shidduchim/{id}`.
  - [ ] `grep -rn "shidduchim/\${.*}/show\|shidduchim/.*\.id}/show" src/components/atomic-crm/shadchanim/`
        returns nothing afterward.
- [ ] **Task 6 — Tests** (AC: 5)
  - [ ] Extend the existing cross-account `interactions` test to cover `target_type = 'shadchan'`.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Ownership note (read before touching the schema)

This story and Story 5.8 both edit `tasks_target_type_check`,
`interactions_target_type_check`, and `interactions_scope_link_check`. **5.8 lands first.**
This story's migration must `DROP CONSTRAINT` and re-`ADD CONSTRAINT` with the **full** set
(5.8's `'single'` plus this story's `'shadchan'`), never a bare `ADD` that assumes the
pre-5.8 constraint is still in place. Verify the live constraint definition
(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'interactions_target_type_check';`)
before writing the migration, not from memory of what this document says it should be.

### Reuse checklist (do not re-derive any of these)

- `ShadchanHeader.tsx` — identity header + contact quick actions, unchanged.
- `shadchan_stats` view + `ShadchanStatsRow` — stat band, unchanged.
- `ShadchanSuggestions.tsx` — suggestions list, one link-primitive swap only.

### Migration workflow

Edit `supabase/schemas/*`, then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_targeting_and_notes_migration`,
hand-check: `db diff` never emits the `insert into interactions select … from shadchanim`
backfill (Task 3) — add it by hand, positioned **before** the `drop column notes` statement, or
the data is gone before it is copied. Then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`/`db push`.

### Project Structure Notes

- No new folder; all changes are inside the existing `shadchanim/` directory.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.9]
- [Source: ARCHITECTURE-SPINE.md#AD-24] — `RecordLink` as the single record-mention primitive;
  "no ad-hoc record links remain in the codebase" (Story 3.9's own AC, which this story closes
  out for the last remaining ad-hoc link in `shadchanim/`).
- [Source: _bmad-output/implementation-artifacts/5-8-single-360.md#Ownership-note] — the
  constraint-sequencing dependency this story inherits.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
