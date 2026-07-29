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
6. **Given** the widened `shadchan_stats` (RULING 8 / Task 2b), **when** a login active in a
   different account reads the view, **then** it returns no row for this account's shadchanim,
   and `select reloptions from pg_class where relname = 'shadchan_stats';` still shows
   `security_invoker=on`. Both halves are asserted: a view recreated **without**
   `security_invoker` runs as its owner, bypasses `shidduchim`' RLS and would publish every
   account's `last_redt_date` and `nb_open_singles` to every caller — and it would do so
   silently, because the tab still looks correct to its own tenant. Same one-login-two-accounts
   shape as AC-5 [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 3].

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
- [ ] **Task 2b — Widen `shadchan_stats` for the Overview tab** (AC: 3, 6 — RULING 8, option B)
  - [ ] `supabase/schemas/03_views.sql`: add two columns to `public.shadchan_stats` —
        `max(s.redt_date) as last_redt_date` and
        `count(distinct s.single_id) filter (where s.pipeline_state in ('new', 'look_into',
        'not_sure')) as nb_open_singles`. Reuse `singles_summary`'s existing "open" predicate
        **verbatim** (`03_views.sql:166-190`); do not invent a second definition of open.
  - [ ] Keep `with (security_invoker = on)` on the recreated view and keep the existing three
        columns and their names untouched (`nb_suggestions`, `nb_progressed`, `nb_reached_yes` —
        `ShadchanStatsRow` and Task 3's stat band read them).
  - [ ] This is this story's **second** migration, separate from Task 2's:
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_stats_overview`.
  - [ ] `types.ts`: add `last_redt_date: string | null` and `nb_open_singles: number` to
        `ShadchanStats`. FakeRest: extend the emulated `shadchan_stats` view so the demo provider
        returns both fields.
- [ ] **Task 3 — Shell wiring** (AC: 3)
  - [ ] Re-register the `shadchanim` descriptor over 3.9's stub with
        `registerEntityDescriptor(descriptor, { replace: true })` — the whole descriptor, not a
        partial merge: identity header = `ShadchanHeader`, stat band = `ShadchanStatsRow`, tabs
        `overview, shidduchim, notes, tasks, activity` (keys from `entity360/tabKeys.ts`).
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4 — rule 2]
  - [ ] `overview` tab: build it from the **widened** `shadchan_stats` (RULING 8 — option B; see
        Dev Notes "RULING 8 — the Overview tab gets real content"). Render through
        `entity360/tabs/OverviewTab`: **Last redt** (`last_redt_date`) and **Working on now**
        (`nb_open_singles` — distinct singles this shadchan has in a non-terminal shidduch), plus
        `name_he` when it is set. Do **not** re-render Location / Responsiveness / "In your book
        since": the post-wave-S header already shows all three, and duplicating them is the
        double-render Task 3 warns against elsewhere. Both new fields come from Task 2b's
        migration — if the widened view is not in the schema yet, that migration is the blocker,
        not an open question. `name_he` alone is *not* an acceptable Overview: the original
        instruction ("whatever `Shadchan` fields remain outside the header") is superseded.
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
- [ ] **Task 5 — Tests** (AC: 5, 6)
  - [ ] AC-6: assert `shadchan_stats` still carries `security_invoker=on` and that a login active
        in another account reads no row from it — same one-login-two-accounts shape as AC-5.
  - [ ] Extend the existing cross-account `interactions` test to cover `target_type = 'shadchan'`.
        Cross-tenant negatives are **one login with memberships in two accounts, active in one**
        — never two disjoint users
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 3].
  - [ ] `npm run typecheck && npm run lint && npx vitest run && npm run test:unit:db`.

## Dev Notes

### Ownership note (read before touching the schema)

Neither this story nor 5.8 edits `tasks_target_type_check`, `interactions_target_type_check`
or `interactions_scope_link_check` — Stories 3.5/3.8 already delivered every value both need
(`'shadchan'`, `'single'`, the scope branches, the RLS branches). This story owns exactly two
migrations: the `shadchanim.notes` backfill-and-drop (Task 2) and the `shadchan_stats` widening
RULING 8 added (Task 2b). Nothing else. If a generated diff contains a `*_target_type_check`
line, the schema files were edited from a stale assumption — revert it.

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

### RULING 8 — the Overview tab gets real content (decided 2026-07-29)

**Decided: option B.** The owner was asked what a shadchan's Overview tab should show now that
the mobile-redesign wave S has moved every existing `Shadchan` field into the header, and ruled:
**give the tab real content — the last redt, and how many singles this shadchan is currently
working on.** Options A (defer the tab to `pendingTabs`) and C (drop `overview` from the shadchan
canonical tab set) are closed; the earlier "Recommendation: A now, B when the aggregate earns its
migration" is superseded — the aggregate has earned it. Do not re-litigate inside the story.

AC-3's tab list is unchanged by the ruling (`overview, shidduchim, notes, tasks, activity`, with
`overview` first and therefore the default landing tab), and `registry.stubs.test.ts`'s pinned
shadchanim row keeps `overview` in `tabs`. What the ruling changes is the story's **cost**: see
"What option B costs" below.

**Why the question was asked** (verified 2026-07-29 against the shipped files):

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

**What option B costs — read this as the story's scope, not as a caveat.**

1. **A second migration. Say it out loud: 5-9 now owns two, not one.** Before the ruling this
   story's only schema change was Task 2's `shadchanim.notes` backfill-and-drop. RULING 8 adds
   Task 2b: `shadchan_stats` gains `last_redt_date` (`max(s.redt_date)`) and `nb_open_singles`
   (`count(distinct s.single_id) filter (where s.pipeline_state in ('new', 'look_into',
   'not_sure'))`). Two schema edits ⇒ two `db diff` runs ⇒ two migration files; the Ownership
   note above and the Migration workflow section are written for both. `nb_open_singles` counts
   **distinct singles**, not shidduchim — that is what "how many singles they're working on"
   means, and it is why this is not just another `count(s.id) filter (...)` tile.
2. **"Open" is already defined — do not define it twice.** `singles_summary` (`03_views.sql:166-190`)
   fixes open as the three active triage states `new/look_into/not_sure`, terminal being
   `for_sure_not/yes/unsure/no`. Task 2b reuses that predicate verbatim. A second, subtly
   different notion of "currently working on" in the same schema is exactly the duplicate-concept
   failure NFR-14 forbids.
3. **The RLS surface a view change carries.** `shadchan_stats` is `security_invoker = on`
   (`03_views.sql:202`) — that one setting is the whole reason it is account-safe: base-table RLS
   on `shadchanim`/`shidduchim` applies to the **caller**, so the view can only aggregate rows the
   caller may already read. `create or replace view` does not preserve that setting for you if the
   replacing statement omits it, and a view that runs as its owner leaks silently: the tab still
   looks right to its own tenant while publishing every account's last-redt dates. So Task 2b
   keeps `with (security_invoker = on)` explicitly, and **AC-6 asserts both** the setting and a
   cross-account read returning nothing. Widening a view widens what a mis-created view would
   leak — the two new columns are per-account activity data, not counts of nothing.
4. **Typed and demo surfaces follow the view.** `ShadchanStats` (`types.ts:238-243`) gains both
   fields, and the FakeRest-emulated `shadchan_stats` view must return them too, or the demo
   provider renders an Overview that the real backend fills and the demo leaves blank.

**What B does not change.** The stat band stays the existing three tiles — `ShadchanStatsRow` is
not where the new fields render; the Overview tab is. And the header keeps Location /
Responsiveness / "In your book since": Overview shows Last redt, Working on now, and `name_he`
when set, nothing wave S already renders.

### Reuse checklist (do not re-derive any of these)

- `ShadchanHeader.tsx` — identity header + contact quick actions, unchanged.
- `shadchan_stats` view + `ShadchanStatsRow` — stat band, unchanged. The view itself is
  **widened** by Task 2b (RULING 8) for the Overview tab, but its three existing columns and the
  component that renders them are not touched.
- `ShadchanSuggestions.tsx` — the shidduchim list, one link-primitive swap plus AD-23 label text.

### Migration workflow

Edit `supabase/schemas/*`, then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_notes_migration`,
hand-check: `db diff` never emits the `insert into interactions select … from shadchanim`
backfill (Task 2) — add it by hand, positioned **before** the `drop column notes` statement, or
the data is gone before it is copied. Then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`/`db push`.

Task 2b's view widening is a **separate** diff, run after the notes migration is applied:
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_stats_overview`.
Hand-check it re-emits `with (security_invoker = on)` (AC-6) and that it touches nothing but
`shadchan_stats`; a `create or replace view` diff that drops the option, or that drags in an
unrelated view, means the schema file was edited from a stale dump.

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
