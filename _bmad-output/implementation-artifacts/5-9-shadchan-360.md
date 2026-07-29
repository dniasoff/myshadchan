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
  (`nb_suggestions` / `nb_progressed` / `nb_reached_yes` — shidduchim attributed to this
  shadchan, those past `new`, those that reached `yes`; the column names are pre-existing DB
  identifiers and this story does not rename them, but every **label** rendered from them uses
  AD-23 vocabulary: "Shidduchim", not "Suggestions") — reuse as the shell's stat-band region.
  This is also the contract's proof case for `statBand` being a `ComponentType<{record}>` that
  loads its own data (`useGetOne<ShadchanStats>("shadchan_stats", { id })`), not a
  `(record) => ReactNode`
  [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2 — rule 1].
- `ShadchanSuggestions.tsx` (file name unchanged by this story) already lists every shidduch
  from this shadchan, and Story 3.9's
  sweep already converted its link to `RecordLink` (it is in 3.9's 12-site list) — the URL it
  renders follows the shidduchim registry entry Story 5.1 updates. This story's own routing
  change is one line in the registry: the **shadchanim** `buildRecordPath` (see AC-4).

## One data-model cleanup this story owns: `shadchanim.notes`

`shadchanim.notes text` is a single free-text column, predating the polymorphic
`interactions`-backed Notes pattern every other entity uses (the Single-owner rule in
`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`'s
Design Paradigm). Once the shadchan has a real universal Notes tab (this story wires it in per
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
   shell at `/shadchanim/{id}/{tab}` with tabs `overview, shidduchim, notes, tasks, activity`
   — the canonical shadchan tab set and order. The tab **key** is `shidduchim` (label
   "Shidduchim"), taken from the closed `TabKey` union in `entity360/tabKeys.ts`; `suggestions`
   is not a member of that union, so it does not typecheck, and it is an AD-23 vocabulary
   violation as a user-facing word. The identity header is `ShadchanHeader.tsx` unchanged
   (contact quick actions intact) and the stat band is the existing `shadchan_stats` reuse,
   unchanged.
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#3 — the `TabKey` union, the
   drift-closing ruling table, and rule 5's per-entity tab sets]
4. **Given** Story 3.9 already routes every shadchan record mention through `RecordLink`,
   **when** this story changes the shadchan route shape, **then** the change is one line: the
   shadchanim registration's `buildRecordPath` becomes ``(id) => `/shadchanim/${id}` `` and
   3.9's route-pinning test is updated. `ShadchanSuggestions.tsx` needs no structural edit —
   only its user-facing strings follow AD-23 ("Shidduchim", never "Suggestions"). Verify it
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
  - [ ] Re-register the `shadchanim` descriptor over 3.9's stub with
        `registerEntityDescriptor(descriptor, { replace: true })` — the whole descriptor, not a
        partial merge: identity header = `ShadchanHeader`, stat band = `ShadchanStatsRow`, tabs
        `overview, shidduchim, notes, tasks, activity` (keys from `entity360/tabKeys.ts`).
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4 — rule 2]
  - [ ] `overview` tab: **blocked on an open decision — do not build it from this line.** The
        original instruction ("whatever `Shadchan` fields remain outside the header") resolves to
        `name_he` alone after the mobile-redesign wave S, i.e. to an empty tab. See Dev Notes
        "Open decision — the Overview tab has no content left (wave S handoff)" and take the
        option the owner picks.
  - [ ] `shidduchim` tab: `ShadchanSuggestions.tsx`, structurally unchanged (already
        `RecordLink`-based post-3.9), mounted as an explicit `tabs` entry with
        `key: "shidduchim"`. An explicit `tabs` entry legitimately overrides the generic
        `relationships` → `RelatedRecordsTab` rendering for the same key
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#9], which is why this
        story keeps the existing component instead of re-deriving the list. Its heading/label
        text becomes "Shidduchim" per AD-23. Verified live AD-23 violations inside the files this
        story already relocates: `ShadchanSuggestions.tsx:36` `"Suggestions from this shadchan"`
        → `"Shidduchim from this shadchan"`, `:49` `"No suggestions from this shadchan yet."`
        → `"No shidduchim from this shadchan yet."`, and `ShadchanShow.tsx:61`
        `label="Suggestions"` → `label="Shidduchim"` (the stat tile bound to `nb_suggestions`;
        the DB column keeps its name). `ShadchanCard.tsx:70-71`'s `"suggestion"/"suggestions"`
        is the **list** page — out of this story's scope, flagged for the Epic 5 refresh pass.
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
        Cross-tenant negatives are **one login with memberships in two accounts, active in one**
        — never two disjoint users
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 3].
  - [ ] `npm run typecheck && npm run lint && npx vitest run && npm run test:unit:db`.

## Dev Notes

### Ownership note (read before touching the schema)

Neither this story nor 5.8 edits `tasks_target_type_check`, `interactions_target_type_check`
or `interactions_scope_link_check` — Stories 3.5/3.8 already delivered every value both need
(`'shadchan'`, `'single'`, the scope branches, the RLS branches). The only migration in this
story is the `shadchanim.notes` backfill-and-drop (Task 2). If a generated diff contains a
`*_target_type_check` line, the schema files were edited from a stale assumption — revert it.

### What wave S already changed under this story's feet

The mobile-redesign wave S landed on `shadchanim/` after this story was written (commits
`9538463`, `ce3e4c7`). It changed nothing this story's ACs assert, but three of the story's
pointers are now stale — verified against the tree 2026-07-29:

- `ShadchanStatsRow` is **already extracted** to `shadchanim/ShadchanStatsRow.tsx`. Task 3's
  "extract the inline `ShadchanStatsRow` to its own file" and the same aside in "Most of this
  already exists" are done; only the `<Show>` wrapper deletion remains.
- The header's notes block is now `ShadchanHeader.tsx:125-134`, not `~101-110` (Task 2, AC-2).
  It is still exactly one `{shadchan.notes ? … : null}` block and still the only render of the
  column.
- `ShadchanHeader.test.tsx` exists (5 cases: avatar classes, the sparse meta-line fallback, a
  missing `created_at`, quick actions, no-contact-info). **None asserts the notes block**, so
  Task 2 removes the block without touching that file.

### Open decision — the Overview tab has no content left (wave S handoff)

**Do not start Task 3's `overview` bullet until the owner has answered this.** Wave S rewrote
`ShadchanHeader.tsx` as a density-first hero card and in doing so pulled into the header every
`Shadchan` field the Overview tab was going to show. Verified 2026-07-29 against the shipped
files:

- `Shadchan` is exactly `account_id, name, name_he?, location?, contacts?, notes?,
  responsiveness?, created_at, id` (`src/components/atomic-crm/types.ts:220-229`).
- Post-wave-S `ShadchanHeader.tsx` renders `name`, `location` **and** `created_at` (joined into
  one meta line, "…· In your book since {Mon YYYY}"), `responsiveness` (`ResponsivenessChip`),
  `contacts` (the quick actions) and `notes`.
- `notes` is deleted by this story's own Task 2; `account_id` and `id` are never rendered.

What remains outside the header is therefore **`name_he`, alone** — optional, with no input on
the create/edit form (`ShadchanInputs.tsx` collects name, location, responsiveness, notes only)
and `null` in every seed (`dataGenerator/shidduchim.ts`'s four `shadchanimSeed` rows;
`seed_demo/dataset.ts`'s `DemoShadchan` has no such field at all). Built as literally specified,
Overview renders `OverviewTab`'s empty state ("No details on file yet.") for every record in the
product — on the tab a shadchan's URL lands on by default (`Entity360Tabs.tsx:53`: the first
`tabs` entry).

**What wave S proposed, and why it is not free.** Its plan (§6) suggested `entity360/tabs/
OverviewTab` + `OverviewFactGrid` with Location · Responsiveness · In your book since · **Last
redt · Redt for**. The first three are the duplicate render Task 3 already warns against. The
last two are not data that exists to read: `shadchanim` has no redt column
(`supabase/schemas/01_tables.sql:226-236`) and `shadchan_stats` carries only `nb_suggestions`,
`nb_progressed`, `nb_reached_yes` (`03_views.sql:202-211`; `ShadchanStats`, `types.ts:238-243`).
They are *derivable* — `ShadchanSuggestions` already reads this shadchan's shidduchim sorted
`redt_date DESC` — but re-running that unbounded 200-row query behind a second tab to show two
numbers is the argument for widening the aggregate, not against it. Either way it is new work,
not a field read.

**The options. This story must not pick one silently:**

- **A — defer the tab.** Register `tabs` without `overview` and keep `"overview"` in
  `pendingTabs`; the union rule (`keys(tabs) ∪ pendingTabs === canonical set`, contract §3
  rule 5) still holds and nothing ships empty. Cost: AC-3's tab list and the pinned shadchanim
  row in `entity360/registry.stubs.test.ts` both move `overview` from tabs to pending, and the
  default landing tab becomes `shidduchim`. Reversible the day the tab has content.
- **B — give it real content.** Widen `shadchan_stats` with a last-redt date and a
  redt-for-how-many-singles count, then render those (plus `name_he` when set) through
  `OverviewTab`. Cost: a view change, i.e. a second migration in a story that today owns exactly
  one, plus the RLS surface that comes with it. Benefit: the tab answers what a parent actually
  opens a shadchan to ask.
- **C — fold it away.** Drop `overview` from the shadchan canonical tab set outright. This is a
  **contract amendment** (§3 rule 5's per-entity sets, `registry.stubs.test.ts`, AC-3), not a
  story-local choice — it needs the same ruling process that set the tab sets in the first place.

**Recommendation: A now, B when the aggregate earns its migration.** A is the only option that
is reversible, ships nothing empty, needs no schema change, and keeps this story to the single
migration it already owns. B is a real feature and deserves to be scoped as one rather than
smuggled in under "whatever fields remain".

### Reuse checklist (do not re-derive any of these)

- `ShadchanHeader.tsx` — identity header + contact quick actions, unchanged.
- `shadchan_stats` view + `ShadchanStatsRow` — stat band, unchanged.
- `ShadchanSuggestions.tsx` — the shidduchim list, one link-primitive swap plus AD-23 label text.

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
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding. §3 (`TabKey`:
  `shidduchim`, not `suggestions`), §4 (registry `{ replace: true }`), §2 rule 1 (`statBand` is a
  `ComponentType`), §0 (validation commands, AD-23 vocabulary).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — `RecordLink` as the single record-mention primitive;
  the route-shape change flows through the registry, never through call-site edits.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23]
  — the domain vocabulary: shidduch/shidduchim, never "suggestion".
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md#AC-1] — the
  `'shadchan'` interactions widening this story verifies instead of redoing.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
