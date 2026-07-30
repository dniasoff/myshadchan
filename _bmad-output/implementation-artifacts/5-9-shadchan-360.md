# Story 5.9: Shadchan 360

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want a shadchan's record to match,
so that I can see our history at a glance.

## Position in Epic 5

Depends on **Epic 3** (shell, `RecordLink`, universal Notes/Tasks/Activity tabs — including
Story 3.5, which already made `'shadchan'` a legal `interactions` target with its RLS branch
and scope-check case). Logically independent of 5.8 apart from sharing that same verified ground
— but **not schedulable alongside it**: 5-8, 5-9 and 5-10 all write
`entity360/{ad24Conformance.ts, registry.stubs.test.ts}`, `types.ts`, `registry.json` and
`supabase/migrations/**`. Run them serially, one agent per wave, 5-8 → 5-9 → 5-10. Because the
AD-24 exemption checks are symmetric, the loser of a concurrent edit fails the build on an
*innocent* story, so the corruption does not surface where it was caused.

## Most of this already exists — reuse, do not rebuild

`ShadchanShow.tsx` is **already a real `<Show>` page**, not a modal — unlike Shidduch, this is a
graduation of an existing page onto the shared shell, not a modal-to-page conversion:

- `ShadchanHeader.tsx` already renders the identity header **and already has working contact
  quick actions** (`tel:`, `wa.me`, `mailto:` links reading `shadchan.contacts` jsonb via
  `parseContactInfo()`) — this is exactly the epic's "contact quick actions" requirement,
  fully built. Reuse its body unchanged as the shell's identity-header content — but it is
  `({ shadchan }: ShadchanHeaderProps)` (`shadchanim/ShadchanHeader.tsx:51`) and
  `identityHeader` is `ComponentType<{ record: T }>` (`entity360/entityDescriptor.ts:57`), so
  it needs the one-line shim in Dev Notes → "Adapter wrappers are mandatory". "Reuse verbatim"
  does **not** typecheck.
- `ShadchanStatsRow.tsx` is **already its own file** (mobile wave S density pass) — do not
  "extract" it, and do not re-derive it. It plus the `shadchan_stats` view already provide the
  "stat band" (`nb_suggestions` / `nb_progressed` / `nb_reached_yes` — shidduchim attributed to
  this shadchan, those past `new`, those that reached `yes`). The column names are pre-existing
  DB identifiers and this story does not rename them; every **label** rendered from them already
  uses AD-23 vocabulary (`ShadchanStatsRow.tsx:34` reads `{ label: "Shidduchim", value:
  data?.nb_suggestions ?? 0 }`), so there is no label work left here either. It is also the
  contract's proof case for `statBand` being a `ComponentType<{record}>` that loads its own data
  (`useGetOne<ShadchanStats>("shadchan_stats", { id })`), not a `(record) => ReactNode`
  [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2 — rule 1] — but note the same
  prop mismatch: it takes `{ shadchanId }` (`ShadchanStatsRow.tsx:20`), not `{ record }`. Second
  shim, same Dev Note.
- `ShadchanSuggestions.tsx` (file name unchanged by this story) already lists every shidduch
  from this shadchan, and Story 3.9's
  sweep already converted its link to `RecordLink` (it is in 3.9's 12-site list) — the URL it
  renders follows the shidduchim registry entry Story 5.1 updates. Its own AD-23 label sweep is
  **already done** by wave S (`:65` "Shidduchim from this shadchan", `:82` "No shidduchim from
  this shadchan yet.") — do not "fix" it again.

**The routing change is not one line.** See AC-4: flipping `buildRecordPath` while
`shadchanim/index.ts` still declares `edit: ShadchanEdit` makes `ra-core` render **`ShadchanEdit`**
at `/shadchanim/{id}/{tab}`. The registry flip is the link-emission half only.

## One data-model cleanup this story owns: `shadchanim.notes`

`shadchanim.notes text` is a single free-text column, predating the polymorphic
`interactions`-backed Notes pattern every other entity uses (the Single-owner rule in
`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`'s
Design Paradigm). Once the shadchan has a real universal Notes tab (this story wires it in per
Task 3), keeping a second, parallel `notes` column is exactly the kind of duplicate concept
NFR-14 forbids. This story migrates existing `shadchanim.notes` values into `interactions`
(`kind = 'note'`, `target_type = 'shadchan'`) and drops the column in the same migration —
replaced, not left behind. `ShadchanHeader.tsx`'s inline notes block (`:125-134`) is removed in
the same change; notes now live only in the Notes tab.

Dropping the column reaches four more places the original text did not name, all verified
2026-07-29: `ShadchanInputs.tsx:35` (`<TextInput source="notes" multiline rows={3}>` — the form
that *writes* the column), `types.ts:229-238` (`Shadchan.notes?: string | null`), and the field
label `resources.shadchanim.fields.notes` in **both** i18n catalogues
(`providers/commons/englishCrmMessages.ts:38`, `frenchCrmMessages.ts:40`). Leaving the input in
place turns every shadchan save into a PostgREST 400 against a column that no longer exists.

## Acceptance Criteria

1. **Given** the post-Epic-3 schema, **when** this story starts, **then**
   `select pg_get_constraintdef(oid) from pg_constraint where conname in
   ('tasks_target_type_check', 'interactions_target_type_check',
   'interactions_scope_link_check');` confirms `'shadchan'` is already a legal target
   everywhere it needs to be — `tasks` allowed it before Epic 5; Story 3.5 added it to
   `interactions` together with the `scope = 'account'` branch and the RLS branch. This story
   ships **no** migration for these constraints; if `'shadchan'` is missing, Epic 3 has not
   landed — stop and report. **Failing looks like:** a generated diff from either of this
   story's two migrations contains a `*_target_type_check` line. That means a schema file was
   edited from a stale assumption — revert it, do not "widen" anything.
2. **Given** `shadchanim.notes`, **when** this story's migration lands, **then** every non-null
   value has been copied into an `interactions` row (`target_type = 'shadchan'`,
   `scope = 'account'`, `kind = 'note'`, `body = notes`) and the `notes` column is dropped in the
   same migration — the backfill statement positioned **before** the `drop column`. Nothing in
   the tree still names the column: `ShadchanHeader.tsx` renders no notes block (`:125-134`
   deleted), `ShadchanInputs.tsx:35`'s `<TextInput source="notes">` is deleted, `Shadchan`
   (`types.ts:229-238`) has no `notes` field, and `resources.shadchanim.fields.notes` is gone
   from both `englishCrmMessages.ts:38` and `frenchCrmMessages.ts:40`.
   **Failing looks like:** `select count(*) from public.interactions where target_type =
   'shadchan' and kind = 'note'` is smaller than the pre-migration
   `select count(*) from public.shadchanim where notes is not null and notes <> ''` (the drop
   ran first and the data is gone), **or** `make typecheck` is clean but saving a shadchan from
   the edit form returns a PostgREST error naming `notes`.
3. **Given** a shadchan, **when** I open their record, **then** it renders via the `Entity360`
   shell at `/shadchanim/{id}/{tab}` with tabs `overview, shidduchim, notes, tasks, activity`
   — the canonical shadchan tab set and order, matching `CANONICAL_TAB_SETS.shadchanim`
   (`entity360/ad24Conformance.ts:239`) exactly. The tab **key** is `shidduchim` (label
   "Shidduchim"), taken from the closed `TabKey` union in `entity360/tabKeys.ts`; `suggestions`
   is not a member of that union, so it does not typecheck, and it is an AD-23 vocabulary
   violation as a user-facing word. Do **not** set an explicit `label` on it — "Shidduchim" is
   already the i18n default (`tabKeys.ts:54`), and an override would need the "why THAT entity
   deviates" comment (`entityDescriptor.ts:98-104`) for a deviation that does not exist. All
   five keys move **out of `pendingTabs` and into `tabs` in this same diff**, leaving
   `pendingTabs` empty or absent: the AD-24 validator asserts `keys(tabs) ∪ pendingTabs` equals
   the canonical set **as sets**, so a key in both is `tab-key-duplicated` and a key in neither
   is a missing tab — either fails the build.
   The identity header is `ShadchanHeader.tsx`'s existing body and the stat band is
   `ShadchanStatsRow.tsx`, both reached through the one-line adapters in Dev Notes → "Adapter
   wrappers are mandatory". **Failing looks like:** `npx vitest run
   src/components/atomic-crm/entity360` reports `tab-key-duplicated` or a missing-tab violation
   from `ad24Conformance.guard.test.ts`; or the rendered tab strip shows four tabs, not five.
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#3 — the `TabKey` union, the
   drift-closing ruling table, and rule 5's per-entity tab sets]
4. **Given** Story 3.9 already routes every shadchan record mention through `RecordLink`,
   **when** this story changes the shadchan route shape, **then** `/shadchanim/{id}/overview`
   renders the `Entity360` tab strip — **not** `ShadchanEdit`. This is **not** a one-line
   change, and treating it as one is the story's single biggest trap (see Dev Notes →
   "AC-4 is a route migration, not a `buildRecordPath` flip"). In one diff:
   - `shadchanim/entityDescriptor.ts`: `buildRecordPath` becomes ``(id) => `/shadchanim/${id}` ``,
     re-registered with `registerEntityDescriptor(shadchanimDescriptor, { replace: true })`.
   - `shadchanim/index.ts`: `list: buildEntityRoutes({ List: ShadchanList, Edit: ShadchanEdit,
     Show: EntityShow })`, **drop** `edit:` and `show:`, and **add explicit `hasShow: true` /
     `hasEdit: true`** — `ra-core` computes `hasShow: !!show || !!hasShow`
     (`Resource.js:28-37`), so without them every `<DataTable>` row goes unclickable
     (`entity360/buildEntityRoutes.tsx:43-54`). `children: buildCreateRoutes(...)` and
     `hasCreate: true` stay; `import "./entityDescriptor";` stays as line 1.
   - `entity360/ad24Conformance.ts`: delete `RECORD_SURFACE_EXEMPTIONS["shadchanim:show"]` and
     `["shadchanim:edit"]` (`:123-124`) and `PENDING_ROUTE_SHAPES.shadchanim` (`:172`). These
     tables are **symmetric**: leaving a row once the offender is gone fires `stale-exemption`;
     removing the offender without the row fires the mirror violation. Same diff, or red build.
   - the four pinned literals that go red the instant the path flips:
     `entity360/registry.stubs.test.ts:93` (`/shadchanim/1/show`) and `:94` (`tabs toEqual []`)
     and `:66` (the `pendingTabs` row); `shadchanim/ShadchanRow.test.tsx:44`
     (`toHaveAttribute("href", "/shadchanim/7/show")`); `reminders/ReminderCard.test.tsx:55`
     (same, `/shadchanim/9/show`) plus its `:12-20` doc comment, which describes the old
     `/show` shape as the *fix*; and `e2e/entity-list-search.spec.ts:143-147`, whose
     `a[href$="/show"]` locator and its explanatory comment both pin
     `buildRecordPath("shadchanim", id) == /shadchanim/{id}/show`.
   `ShadchanSuggestions.tsx` needs no edit at all — structural or textual (its AD-23 sweep
   landed with wave S). Verify it renders `RecordLink` rows targeting `/shidduchim/{id}`
   (Story 5.1's registry update).
   **Failing looks like:** navigating to `/shadchanim/1/overview` renders a form with a Save
   button; or `grep -rn "/show" src/components/atomic-crm/shadchanim/ e2e/` returns a hit;
   or `findAd24Violations` against the real manifest returns a non-empty array.
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

- [x] **Task 1 — Verify the polymorphic targets, do not migrate them** (AC: 1)
  - [x] Run the AC-1 `pg_get_constraintdef` query; confirm `types.ts`'s
        `Interaction.target_type` already carries `"shadchan"` (Story 3.5's edit). No schema or
        type change here.
- [x] **Task 2 — Migrate and drop `shadchanim.notes`** (AC: 2)
  - [x] Hand-add to the generated migration (data steps are never auto-emitted by `db diff`):
        `insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
        select account_id, 'shadchan', id, 'account', 'note', notes from public.shadchanim where
        notes is not null and notes <> '';` **before** `alter table public.shadchanim drop
        column notes;`.
  - [x] `types.ts:229-238`: remove `notes` from the `Shadchan` type.
  - [x] `ShadchanHeader.tsx`: remove the notes block (`:125-134`) and the now-unused prop path.
        `ShadchanHeader.test.tsx`'s 5 cases assert avatar classes, the sparse meta-line
        fallback, a missing `created_at`, quick actions and no-contact-info — **none** asserts
        the notes block, so that file needs no edit.
  - [x] `ShadchanInputs.tsx:35`: delete `<TextInput source="notes" multiline rows={3}
        helperText={false} />`. This is the form that *writes* the column; leaving it turns
        every shadchan save into a 400.
  - [x] Both i18n catalogues: delete `resources.shadchanim.fields.notes`
        (`providers/commons/englishCrmMessages.ts:38`, `frenchCrmMessages.ts:40`).
  - [x] Seed data needs no value migration — verified 2026-07-26: `seed_demo/dataset.ts`'s
        `DemoShadchan` has no `notes` field and `dataGenerator/shidduchim.ts`'s `shadchanimSeed`
        sets none. Just confirm both still compile once `Shadchan.notes` is removed.
- [x] **Task 2b — Widen `shadchan_stats` for the Overview tab** (AC: 3, 6 — RULING 8, option B)
  - [x] `supabase/schemas/03_views.sql:202-211`: replace the `shadchan_stats` body with exactly
        this — the two new columns **appended after** `nb_reached_yes`, never inserted mid-list:

        ```sql
        create or replace view public.shadchan_stats with (security_invoker = on) as
        select
            sh.id,
            sh.account_id,
            count(s.id) as nb_suggestions,
            count(s.id) filter (where s.pipeline_state <> 'new') as nb_progressed,
            count(s.id) filter (where s.pipeline_state = 'yes') as nb_reached_yes,
            max(s.redt_date) as last_redt_date,
            count(distinct s.single_id) filter (
                where s.pipeline_state in ('new', 'look_into', 'not_sure')
            ) as nb_open_singles
        from public.shadchanim sh
            left join public.shidduchim s on s.shadchan_id = sh.id
        group by sh.id;
        ```

        **Zero new joins.** Both columns come off the `shidduchim` row the view already joins.
        `shidduchim.redt_date` (`01_tables.sql:292`) is kept in sync by
        `refresh_shidduch_redt_summary()` (`02_functions.sql:1594`), whose contract is that
        `redt_date` is the most recent redt and `shadchan_id` is that redt's shadchan — so
        `(s.shadchan_id, s.redt_date)` already *is* "this shadchan's redt of this shidduch".
  - [x] **Do not reach for `redts`.** A `left join public.redts r on r.shadchan_id = sh.id`
        silently inflates all three shipped tiles: the existing `count(s.id)` / `count(s.id)
        filter (…)` are **not** `distinct`, so a second one-to-many join fans them out. The
        repo's own precedent is the opposite — `references_summary` (`03_views.sql:101-125`)
        multi-joins and therefore makes *every* count `count(distinct …)`. If a future story
        wants the true "last time this shadchan redt anything" (a superseded redt is invisible
        to `max(s.redt_date)`), it must be a **scalar subquery**, never a join — and `redts` has
        indexes on `account_id` and `shidduchim_id` only (`01_tables.sql:803-804`), so it would
        need a third schema change. Record the semantic caveat in the view comment: this is
        "last time this shadchan was the current redter of something", matching the
        current-attribution scoping every other tile on the view already uses
        (`03_views.sql:194-201`'s own comment).
  - [x] **`count(distinct s.single_id)` is non-negotiable** — "how many singles" ≠ "how many
        shidduchim". Under the LEFT JOIN a shadchan with no shidduchim yields
        `count(distinct null) = 0`, not null; no `coalesce` needed.
  - [x] Reuse `singles_summary`'s existing "open" predicate **verbatim** — the view is
        `03_views.sql:170-190`, the filter itself `:185-187`
        (`new`/`look_into`/`not_sure`; terminal = `for_sure_not`/`yes`/`unsure`/`no`). Do not
        invent a second definition of open. FakeRest already has the matching
        `OPEN_PIPELINE_STATES` set (`providers/fakerest/dataProvider.ts:435`).
  - [x] **Append at the end; never insert mid-list.** `create or replace view` can only add
        *trailing* columns — placing `last_redt_date` before `nb_suggestions` fails with `42P16`
        and pushes `db diff` into a `drop view` / `create view` pair, which **also drops the
        grants** at `06_grants.sql:483-485`. If the generated diff contains `drop view`, the
        columns were placed wrong; fix the schema file, do not patch the migration.
  - [x] This is this story's **second** migration, separate from Task 2's:
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_stats_overview`.
  - [x] **Hand-add the `security_invoker` line.** `supabase db diff` **never** emits
        `with (security_invoker = on)` — this repo has been bitten before and wrote the
        precedent down:
        `supabase/migrations/20260724112600_add_summary_stats_views.sql:20-27` emits
        `create or replace view "public"."shadchan_stats" as SELECT …` with no `WITH` clause,
        and `:30-37` is a hand-added `MANUAL ADJUSTMENTS` block whose note 1 reads verbatim:
        *"It drops `WITH (security_invoker = on)` when it writes a view. Without it these views
        execute as their owner and RLS never runs."* And `create or replace view` does not carry
        existing reloptions forward. So append to the generated migration:
        `alter view "public"."shadchan_stats" set (security_invoker = on);`
        **RLS consequence:** without that line the view runs as its owner, `shidduchim`' RLS
        never applies, and every account's `last_redt_date` / `nb_open_singles` is readable by
        every caller — silently, because the tab still looks correct to its own tenant. AC-6's
        `pg_class.reloptions` assertion plus the cross-account negative is the guard.
        Note 2 of that same block (`db diff` does not diff privileges) is not triggered so long
        as the two columns are appended, because no `drop view` is generated.
  - [x] `types.ts:247-252`: add to `ShadchanStats`
        `last_redt_date: string | null;` (a `date`; null iff the shadchan has zero attributed
        shidduchim) and `nb_open_singles: number;`.
  - [x] FakeRest (AD-10 lockstep): `providers/fakerest/dataProvider.ts:445-467`
        `computeShadchanStats` must return both fields — reuse `OPEN_PIPELINE_STATES` (`:435`)
        for `nb_open_singles` over a `Set` of `single_id`, and `Math.max` over `redt_date` for
        `last_redt_date` (null when the shadchan has no shidduchim). Extend
        `providers/fakerest/dataProvider.summaryStats.test.ts:91-125`'s two cases to assert
        both new fields, including the zeroed/null row. Skipping this ships an Overview the
        real backend fills and the demo leaves blank.
- [x] **Task 3 — Shell wiring** (AC: 3)
  - [x] Re-register the `shadchanim` descriptor over 3.9's stub with
        `registerEntityDescriptor(shadchanimDescriptor, { replace: true })` — the whole
        descriptor, not a partial merge; without `{ replace: true }`
        `registerEntityDescriptor` **throws at module scope** (`entity360/registry.ts:29-33`),
        because `shadchanim/entityDescriptor.ts` is already a registered stub. Identity header =
        `ShadchanHeader` (via adapter), stat band = `ShadchanStatsRow` (via adapter), tabs
        `overview, shidduchim, notes, tasks, activity` (keys from `entity360/tabKeys.ts`).
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4 — rule 2]
  - [x] **Move all five keys out of `pendingTabs` and into `tabs` in this same edit.** The stub
        (`shadchanim/entityDescriptor.ts:25-26`) is `tabs: []` +
        `pendingTabs: ["overview", "shidduchim", "notes", "tasks", "activity"]`. After this
        story `pendingTabs` is empty or absent. A key left in both is `tab-key-duplicated`; a
        key in neither is a missing tab. Update `entity360/registry.stubs.test.ts`'s pinned
        shadchanim row (`:64-67`, `:93-95`) in the same diff — it pins the `/show` path,
        `tabs toEqual []`, **and** the full `pendingTabs` list, so all three assertions go red
        by design.
  - [x] `overview` tab: build it from the **widened** `shadchan_stats` (RULING 8 — option B; see
        Dev Notes "RULING 8 — the Overview tab gets real content"). Render through
        `entity360/tabs/OverviewTab`: **Last redt** (`last_redt_date`) and **Working on now**
        (`nb_open_singles` — distinct singles this shadchan has in a non-terminal shidduch), plus
        `name_he` when it is set. Do **not** re-render Location / Responsiveness / "In your book
        since": the post-wave-S header already shows all three, and duplicating them is the
        double-render Task 3 warns against elsewhere. Both new fields come from Task 2b's
        migration — if the widened view is not in the schema yet, that migration is the blocker,
        not an open question. `name_he` alone is *not* an acceptable Overview: the original
        instruction ("whatever `Shadchan` fields remain outside the header") is superseded.
  - [x] `shidduchim` tab: `ShadchanSuggestions.tsx`, structurally unchanged (already
        `RecordLink`-based post-3.9), mounted as an explicit `tabs` entry with
        `key: "shidduchim"`. An explicit `tabs` entry legitimately overrides the generic
        `relationships` → `RelatedRecordsTab` rendering for the same key
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#9], which is why this
        story keeps the existing component instead of re-deriving the list.
        **Deliberate divergence from 5.8 and 5.10, recorded so it does not read as drift:** those
        two stories render their own `shidduchim` tab through `entity360/tabs/RelatedRecordsTab.tsx`
        and explicitly forbid hand-rolling a `useGetList("shidduchim", …)` list. This story does
        the opposite *only* because the richer component already exists and already satisfies the
        requirement — `ShadchanSuggestions.tsx` is post-3.9 `RecordLink`-based, carries a
        5-row preview with a "Show all N" toggle and a `StateChip` column that `RelatedRecordsTab`
        does not, and was hardened by wave S. Do **not** generalise from this to a fourth entity,
        and do **not** replace it with `RelatedRecordsTab` (that would be a behaviour regression,
        not a cleanup). **`ShadchanSuggestions.tsx`
        needs no edit** — its AD-23 sweep is already done by the mobile wave S (`:65`
        "Shidduchim from this shadchan", `:82` "No shidduchim from this shadchan yet."), and
        `ShadchanShow.tsx` no longer carries the `label="Suggestions"` stat tile at all (the tile
        moved into `ShadchanStatsRow.tsx:34`, which already reads `label: "Shidduchim"`). Do not
        "fix" either file.
  - [x] **The one live AD-23 violation this story does own:** `ShadchanCard.tsx:71-72`'s
        `{suggestionCount === 1 ? "suggestion" : "suggestions"}` (and its `suggestionCount` prop
        name at `:12`/`:24` and the `:20` doc comment). It is on the shadchanim **list** page.
        Epic 5's pre-flight assigned it here because Epic 4's 4-2 keeps `ShadchanCard` as the
        cards renderer and did not fix it — check first whether 4-2 has since landed the fix,
        and if so, skip. Rename the user-facing words only if the prop rename would collide
        with an in-flight Epic 4 diff.
  - [x] `notes`/`tasks`/`activity`: Epic 3's universal components. The prop shape is
        `UniversalTabProps = { targetType, targetId }` (`entity360/tabs/types.ts:11-14`) —
        **`targetType`, camelCase, plus the required `targetId`**, never the DB's
        `target_type`. e.g. `render: () => <NotesTab targetType="shadchan" targetId={record.id} />`
        (the record is reached inside `render` via `useRecordContext()`; `render` is arity-zero,
        `entityDescriptor.ts:106-112`). Writing `target_type` is an excess-property error plus a
        missing required prop — `make typecheck` catches it, but only if it is run.
  - [x] Delete `ShadchanShow.tsx` entirely once its three rendered components are relocated into the
        descriptor — the file is now only the `<Show>` wrapper, the skeleton and the
        `EditButton` toolbar (48 lines); `Entity360`/`EntityShow` supply all three. Drop the
        `show:` import from `shadchanim/index.ts` with it (Task 4). `ShadchanStatsRow` is
        **already extracted** — there is nothing to extract in this move.
- [x] **Task 4 — Route migration** (AC: 4)
  - [x] `shadchanim/entityDescriptor.ts:24`: `buildRecordPath` → ``(id) => `/shadchanim/${id}` ``.
  - [x] `shadchanim/index.ts`: `list: buildEntityRoutes({ List: ShadchanList, Edit: ShadchanEdit,
        Show: EntityShow })`; **delete** `edit: ShadchanEdit` and `show: ShadchanShow`; **add**
        `hasShow: true` and `hasEdit: true` explicitly. Keep `hasCreate: true`,
        `children: buildCreateRoutes("shadchanim", ShadchanCreate)`, `recordRepresentation`, and
        `import "./entityDescriptor";` as line 1. **`ShadchanCreate` stays where it is — pass
        **no** `New` to `buildEntityRoutes`.** 5.1 and 5.8 do the opposite (they move `New`
        inside `buildEntityRoutes` and drop the second `buildCreateRoutes` argument), which is
        equally valid; doing **both** would declare `/shadchanim/new` twice. Without the two explicit flags `ra-core`
        computes both as `false` and every `<DataTable>` row on the shadchanim list goes
        unclickable (`entity360/buildEntityRoutes.tsx:43-54`).
  - [x] `entity360/ad24Conformance.ts`: delete `RECORD_SURFACE_EXEMPTIONS["shadchanim:show"]`
        and `["shadchanim:edit"]` (`:123-124`) and `PENDING_ROUTE_SHAPES.shadchanim` (`:172`),
        **in this same diff**. Symmetric tables: keeping a row whose offender is gone fires
        `stale-exemption`; removing the offender without the row fires the mirror. Do **not**
        touch `NO_BROWSE_SURFACE_ENTITIES` (it holds `references` only) or
        `RECORD_FLAG_EXEMPTIONS` in `root/routeManifest.ts` (`inbox_items` and `tasks` by the
        time this story runs — it held three until Story 5.1 deleted its own `shidduchim` row;
        `shadchanim` was never one of them and adding it would be wrong).
  - [x] Retarget every literal that pins the old path:
        `entity360/registry.stubs.test.ts:64-67` + `:93-95` (Task 3 covers the tab halves);
        `shadchanim/ShadchanRow.test.tsx:44` `toHaveAttribute("href", "/shadchanim/7/show")`;
        `reminders/ReminderCard.test.tsx:55` `toHaveAttribute("href", "/shadchanim/9/show")`
        **and** its `:12-20` doc comment, its `:41` case title and its `:52` inline comment
        (*"returned /shadchanim/9 (no /show), landing on ShadchanEdit instead"*) — all three
        describe the `/show` shape as the fix this test pins, and all three become the exact
        opposite of the truth once `edit:` is dropped. Rewrite them.
        **Story 5.1 has already edited this file in Wave A** (the shidduch case at `:58`/`:71`);
        re-read it rather than assuming the shape quoted here, and do not touch the shidduch
        case;
        `e2e/entity-list-search.spec.ts:143-147`, whose `a[href$="/show"]` locator **and** its
        three-line explanatory comment both pin `buildRecordPath("shadchanim", id)`. Nothing in
        the unit suite covers that last one — **run the e2e suite at least once in this wave.**
  - [x] `grep -rn "/show" src/components/atomic-crm/shadchanim/ e2e/` returns nothing afterward
        (today: `ShadchanShow.tsx:4`'s `@/components/admin/show` import — which goes with the
        file — `ShadchanRow.test.tsx:44`, `entityDescriptor.ts:24`, and the e2e locator).
- [x] **Task 5 — Tests** (AC: 5, 6)
  - [x] AC-6: assert `shadchan_stats` still carries `security_invoker=on` and that a login active
        in another account reads no row from it — same one-login-two-accounts shape as AC-5.
        SQL suites are **paired**: every `supabase/tests/<name>.sql` has a `<name>.test.ts`
        runner alongside it (13 pairs today, no exceptions). Extending an existing pair costs
        nothing; adding a new `.sql` without its runner means the assertions never execute.
  - [x] Extend the existing cross-account `interactions` test to cover `target_type = 'shadchan'`
        — `supabase/tests/interactions_targets.sql` + its runner is the file that already proves
        this shape for `reference`/`shidduch`. Cross-tenant negatives are **one login with
        memberships in two accounts, active in one** — never two disjoint users
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13 — rule 3].
  - [x] `06_grants.sql:483-485` already grants `select on public.shadchan_stats to
        authenticated`. Appending columns to a `create or replace view` preserves it — but
        **re-read the file after the migration lands** and confirm the three lines are intact;
        if the generated diff contained a `drop view`, they were silently dropped and every
        authenticated read of the stat band 403s.
  - [x] Component tests run in **Chromium via `vitest-browser-react`** with `StoryWrapper` /
        `TestMemoryRouter` (see `references/ReferenceCreate.test.tsx`,
        `dashboard/StatStrip.test.tsx`). **React Testing Library is not a dependency of this
        repo** — do not `import { render } from "@testing-library/react"`. Cover: the adapter
        wrappers render (`EntityShow` for a shadchan shows the header's name and the three stat
        tiles), and the Overview tab renders **Last redt** + **Working on now** from a stubbed
        `shadchan_stats` row, with the empty state only when both are null/0-and-absent.
  - [x] `npm run typecheck && npm run lint && npx vitest run && npm run test:unit:db`, plus one
        e2e run (`e2e/entity-list-search.spec.ts` is the file this story breaks and nothing in
        the unit suite covers).

## Dev Notes

### Ownership note (read before touching the schema)

Neither this story nor 5.8 edits `tasks_target_type_check`, `interactions_target_type_check`
or `interactions_scope_link_check` — Stories 3.5/3.8 already delivered every value both need
(`'shadchan'`, `'single'`, the scope branches, the RLS branches). This story owns exactly two
migrations: the `shadchanim.notes` backfill-and-drop (Task 2) and the `shadchan_stats` widening
RULING 8 added (Task 2b). Nothing else. If a generated diff contains a `*_target_type_check`
line, the schema files were edited from a stale assumption — revert it.

### AC-4 is a route migration, not a `buildRecordPath` flip

The single most expensive mistake available in this story. `shadchanim/index.ts:19-20` declares
`edit: ShadchanEdit` and `show: ShadchanShow`. `ra-core` maps a resource's `edit` prop to the
route `":id/*"` (`ra-core/dist/core/Resource.js:11-15`), so the moment `buildRecordPath` starts
emitting `/shadchanim/{id}`, `/shadchanim/{id}/overview` is swallowed by that wildcard and
**`ShadchanEdit` renders where the 360 should be** — no error, no red unit test, a wrong page.
AC-3 is then unsatisfiable while every test in the suite passes.

The fix is `list: buildEntityRoutes({ … Show: EntityShow })` **plus explicit `hasShow` /
`hasEdit`**, with `edit:`/`show:` dropped — the shape `entity360/buildEntityRoutes.tsx:43-54`
spells out as the REGISTRATION RULE. `buildEntityRoutes` mounts `index`, `new`, `:id/edit`,
`:id` and `:id/:tab` inside one `<Routes>` that *is* the element passed to `<Resource list={…}>`
(`:60-91`), so `list` is the **route mount point**, not "the list page". `List` is a required
field of its config (`:8`) — `ShadchanList` keeps rendering at `/shadchanim`, unchanged.

**Assert it, don't assume it:** a navigation test that lands on `/shadchanim/{id}/overview` and
finds the `Entity360` tab strip (not a Save button), and `findAd24Violations` against the real
manifest returning `[]`.

### What wave S already changed under this story's feet

The mobile-redesign wave S landed on `shadchanim/` after this story was written (commits
`9538463`, `ce3e4c7`). It changed nothing this story's ACs assert, but several of the story's
pointers were stale and have been corrected in place — verified against the tree 2026-07-29:

- `ShadchanStatsRow` is **already extracted** to `shadchanim/ShadchanStatsRow.tsx`. There is
  nothing to extract; only the `<Show>` wrapper deletion remains. It also already labels its
  first tile "Shidduchim", so it needs no AD-23 work either.
- The header's notes block is `ShadchanHeader.tsx:125-134` (was cited as `~101-110`). It is
  still exactly one `{shadchan.notes ? … : null}` block and still the only *render* of the
  column — but `ShadchanInputs.tsx:35` still **writes** it, which the original text missed.
- `ShadchanHeader.test.tsx` exists (5 cases: avatar classes, the sparse meta-line fallback, a
  missing `created_at`, quick actions, no-contact-info). **None asserts the notes block**, so
  Task 2 removes the block without touching that file.
- `ShadchanSuggestions.tsx`'s two "suggestion" strings and `ShadchanShow.tsx`'s
  `label="Suggestions"` tile — all three named in the original Task 3 as live AD-23 violations
  — **are already fixed**. The claims were deleted rather than retargeted; re-"fixing" them
  would corrupt correct text.

### Adapter wrappers are mandatory

`identityHeader`, `statBand` and `rightRail` are all `ComponentType<{ record: T }>`
(`entity360/entityDescriptor.ts:57-59`). Neither component this story reuses has that shape:

- `ShadchanHeader = ({ shadchan }: ShadchanHeaderProps)` — `shadchanim/ShadchanHeader.tsx:51`
- `ShadchanStatsRow = ({ shadchanId }: ShadchanStatsRowProps)` — `shadchanim/ShadchanStatsRow.tsx:20`

So "reuse verbatim" / "unchanged" does not typecheck. Write two one-line shims in
`shadchanim/entityDescriptor.ts` and point the descriptor at those; do **not** change either
component's own prop name (both have live callers and tests keyed to it, and
`ShadchanStatsRow`'s `{ shadchanId }` is deliberately an id, not a record — it does its own
`useGetOne`). The same mismatch exists in 5-8 (`{ single }`) and 5-10 (`{ reference }`); it is
a class, not a one-off.

```ts
const ShadchanIdentityHeader = ({ record }: { record: Shadchan }) => (
  <ShadchanHeader shadchan={record} />
);
const ShadchanStatBand = ({ record }: { record: Shadchan }) => (
  <ShadchanStatsRow shadchanId={record.id} />
);
```

### RULING 8 — the Overview tab gets real content (decided 2026-07-29)

**Decided: option B.** The owner was asked what a shadchan's Overview tab should show now that
the mobile-redesign wave S has moved every existing `Shadchan` field into the header, and ruled:
**give the tab real content — the last redt, and how many singles this shadchan is currently
working on.** Options A (defer the tab to `pendingTabs`) and C (drop `overview` from the shadchan
canonical tab set) are closed; the earlier "Recommendation: A now, B when the aggregate earns its
migration" is superseded — the aggregate has earned it. Do not re-litigate inside the story.

AC-3's tab list is unchanged by the ruling (`overview, shidduchim, notes, tasks, activity`, with
`overview` first and therefore the default landing tab). What the ruling changes is the story's
**cost**: see "What option B costs" below.

**`registry.stubs.test.ts` does NOT keep `overview` in shadchanim's `tabs`** — an earlier draft
of this section said it did, and it is false. The file pins
`expect(descriptor?.tabs).toEqual([])` (`:94`) with all five keys in `pendingTabs` (`:66`,
`:95`), plus `buildRecordPath(1) === "/shadchanim/1/show"` (`:93`). All three assertions are
**meant** to go red when this story lands; retarget them, do not work around them.

**Why the question was asked** (verified 2026-07-29 against the shipped files):

- `Shadchan` is exactly `account_id, name, name_he?, location?, contacts?, notes?,
  responsiveness?, created_at, id` (`src/components/atomic-crm/types.ts:229-238`).
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
`nb_progressed`, `nb_reached_yes` (`03_views.sql:202-211`; `ShadchanStats`, `types.ts:247-252`).
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
2. **"Open" is already defined — do not define it twice.** `singles_summary` (`03_views.sql:170-190`,
   the filter itself at `:185-187`)
   fixes open as the three active triage states `new/look_into/not_sure`, terminal being
   `for_sure_not/yes/unsure/no`. Task 2b reuses that predicate verbatim. A second, subtly
   different notion of "currently working on" in the same schema is exactly the duplicate-concept
   failure NFR-14 forbids.
3. **The RLS surface a view change carries — and it is the schema file that is safe, not the
   migration.** `shadchan_stats` is `security_invoker = on` (`03_views.sql:202`); that one
   setting is the whole reason it is account-safe, because base-table RLS on
   `shadchanim`/`shidduchim` then applies to the **caller**, so the view can only aggregate rows
   the caller may already read. `create or replace view` does not carry existing reloptions
   forward, and — the part that actually bites — **`supabase db diff` never emits the `with
   (security_invoker = on)` clause at all.** Keeping it in `03_views.sql` is necessary and not
   sufficient: Task 2b must **hand-add** `alter view "public"."shadchan_stats" set
   (security_invoker = on);` to the generated migration, exactly as
   `supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37` already does for this
   very view. A view that runs as its owner leaks silently — the tab still looks right to its own
   tenant while publishing every account's last-redt dates. **AC-6 asserts both** the
   `pg_class.reloptions` setting and a cross-account read returning nothing. Widening a view
   widens what a mis-created view would leak: the two new columns are per-account activity data,
   not counts of nothing.
   Both source tables carry plain account-scope policies with no visibility walk
   (`05_policies.sql:198-201` for `shidduchim`, `:218-221` for `redts`), so the choice of source
   changes nothing about the RLS posture — only `security_invoker` does.
4. **Typed and demo surfaces follow the view.** `ShadchanStats` (`types.ts:247-252`) gains both
   fields, and the FakeRest-emulated `shadchan_stats` view must return them too, or the demo
   provider renders an Overview that the real backend fills and the demo leaves blank.

**What B does not change.** The stat band stays the existing three tiles — `ShadchanStatsRow` is
not where the new fields render; the Overview tab is. And the header keeps Location /
Responsiveness / "In your book since": Overview shows Last redt, Working on now, and `name_he`
when set, nothing wave S already renders.

### Reuse checklist (do not re-derive any of these)

- `ShadchanHeader.tsx` — identity header + contact quick actions. Body unchanged; reached
  through the one-line `{ record }` adapter above, and with the `:125-134` notes block deleted.
- `shadchan_stats` view + `ShadchanStatsRow.tsx` — stat band. The component is untouched (again,
  behind an adapter); the **view** is widened by Task 2b (RULING 8) for the Overview tab, but
  its three existing columns and their rendering are not.
- `ShadchanSuggestions.tsx` — the shidduchim list. **Zero edits**: `RecordLink` landed with 3.9
  and the AD-23 labels landed with wave S.

### Migration workflow

Edit `supabase/schemas/*`, then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_notes_migration`,
hand-check: `db diff` never emits the `insert into interactions select … from shadchanim`
backfill (Task 2) — add it by hand, positioned **before** the `drop column notes` statement, or
the data is gone before it is copied. Then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`/`db push`.

Task 2b's view widening is a **separate** diff, run after the notes migration is applied:
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shadchan_stats_overview`.
Three hand-checks, in this order:

1. **`db diff` will NOT have emitted `with (security_invoker = on)` — that is expected, not a
   bug in your schema edit.** It never emits it for any view. Append
   `alter view "public"."shadchan_stats" set (security_invoker = on);` under a
   `-- MANUAL ADJUSTMENTS` comment, mirroring
   `supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37`, which does exactly
   this for exactly this view. (An earlier draft of this story said to "hand-check it re-emits"
   the clause. That instruction was backwards and has been deleted: waiting for a line that can
   never appear is how the option gets dropped and RLS silently stops running.)
2. **The diff must contain `create or replace view` and no `drop view`.** A `drop view` means
   the two columns were not appended at the end (`42P16`), and it also silently drops the grants
   at `06_grants.sql:483-485`. Fix `03_views.sql` and regenerate; do not patch the migration.
3. **It must touch nothing but `shadchan_stats`.** An unrelated view dragged into the diff means
   the schema file was edited from a stale dump — re-dump per AGENTS.md before continuing.

`db diff` has a documented blind spot list in this repo, and `security_invoker` is only the
first entry: note 2 of that same manual block records that it does not diff view privileges
either, and it does not diff storage-bucket rows. Read the generated file; do not trust it.

### Project Structure Notes

- No new folder; all changes are inside the existing `shadchanim/` directory, plus
  `entity360/{ad24Conformance.ts, registry.stubs.test.ts}`, `reminders/ReminderCard.test.tsx`,
  `providers/{commons/*CrmMessages.ts, fakerest/dataProvider.ts + .summaryStats.test.ts}`,
  `types.ts`, `supabase/{schemas,migrations,tests}/**` and `e2e/entity-list-search.spec.ts`.
  Deleting `ShadchanShow.tsx` and adding no new non-test source file still mutates
  `registry.json` (`scripts/generate-registry.mjs` globs
  `src/components/atomic-crm/**/*.ts*` minus tests, and `.husky/pre-commit` regenerates it) —
  declare it in this story's ownership manifest.

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
- [Source: src/components/atomic-crm/entity360/buildEntityRoutes.tsx:43-54] — the REGISTRATION
  RULE behind AC-4: `list` = the route mount, plus explicit `hasShow`/`hasEdit`.
- [Source: src/components/atomic-crm/entity360/tabs/types.ts:11-14] — `UniversalTabProps`,
  the `{ targetType, targetId }` shape the universal tabs actually take.
- [Source: supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37] — the
  `MANUAL ADJUSTMENTS` precedent for `shadchan_stats`: `db diff` drops `security_invoker` and
  does not diff view privileges. Task 2b's second migration repeats it.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow)

### Debug Log References

- AC-1 verified live: `pg_get_constraintdef` on `tasks_target_type_check` /
  `interactions_target_type_check` / `interactions_scope_link_check` already includes `'shadchan'`
  everywhere required — no migration touched these, per Task 1.
- `supabase db diff --local` reproduces a **pre-existing, no-op false-positive cascade**
  (`drop view` + recreate of `reference_links_summary`, `shadchan_stats`, `shidduchim_summary`,
  `singles_summary`) on *every* diff run that touches anything reachable from
  `shadchanim`/`shidduchim` — reproduced by hand with a completely clean, unmodified schema (zero
  pending edits) and it still appears, byte-identical. Not something this story introduced or
  could fix; handled the same way the repo's own precedent
  (`20260724112600_add_summary_stats_views.sql`'s MANUAL ADJUSTMENTS block) does: accept the
  cascade, hand-restore `security_invoker=on` + the `06_grants.sql` grants for all four views in
  both of this story's migrations, and confirmed a subsequent `db diff` shows the identical
  cascade again post-migration (proving it is the tool, not real drift).
- Story text said the security-invoker check must "hand-check it re-emits" the clause — this is
  backwards (`db diff` never emits it); implemented per the pre-flight brief's correction instead
  (hand-add `alter view … set (security_invoker = on)`), matching AC-6 and both Debug Log entries
  above.
- Two extra files outside the story's declared "Project Structure Notes" list needed edits to
  keep `make typecheck`/`npx vitest run` green, both direct, unavoidable consequences of the AC-4
  route flip (pinned literals in files no story named — the exact landmine class the pre-flight
  brief's L15 describes): `src/components/admin/edit-button.test.tsx` and
  `src/components/admin/show-button.test.tsx` pinned `hasAd24RecordShape`'s two branches against
  `shadchanim`'s *stub* state specifically because it was "an entity that still HAS a
  pre-migration state to pin" — repointed both at `references` (Story 5.10's still-unmigrated
  stub) instead, same assertions, same shape.
- `entity360/entityDescriptor.test.ts`'s `ShadchanStats`-shaped fixture needed the two new fields
  to keep compiling once the type gained them.
- `e2e/entity-list-search.spec.ts`'s sort-mode locator assumed a plain (non-hash) `href` prefix
  match; the app is hash-routed (`#/shadchanim/{id}`), so a `[href^="/shadchanim/"]` prefix match
  can never match the leading `#` — switched to a `*=` contains match, still excluding
  `/shadchanim/new`.

### Completion Notes List

- Task 1: verified, no migration needed (see Debug Log).
- Task 2: `shadchanim.notes` backfilled into `interactions` (`target_type='shadchan'`,
  `scope='account'`, `kind='note'`) and dropped in one migration
  (`20260730093837_shadchan_notes_migration.sql`); `ShadchanHeader.tsx`'s notes block,
  `ShadchanInputs.tsx`'s notes input, `Shadchan.notes` and both i18n catalogues' `fields.notes`
  all removed in the same diff. Seed data needed no change (confirmed no `notes` field anywhere
  in FakeRest seeds).
- Task 2b: `shadchan_stats` widened with `last_redt_date`/`nb_open_singles`, appended at the end
  (no `redts` join — zero new joins, per the ruling), in a second migration
  (`20260730094101_shadchan_stats_overview.sql`) with the hand-added `security_invoker=on` +
  grants restoration. `ShadchanStats` type, FakeRest's `computeShadchanStats`, and
  `dataProvider.summaryStats.test.ts` all extended to match.
- Task 3: `shadchanimDescriptor` rebuilt in `entityDescriptor.tsx` (+ `entityDescriptorRegions.tsx`
  for the adapter components, mirroring the shidduchim/singles split), all five canonical tabs
  moved into `tabs` with `pendingTabs` now `[]`. `ShadchanOverviewTab.tsx` built per RULING 8
  option B (Hebrew name, Last redt, Working on now — Location/Responsiveness/tenure deliberately
  NOT re-rendered). `shidduchim` tab kept `ShadchanSuggestions.tsx` unchanged, per the story's
  explicit divergence ruling. `ShadchanCard.tsx`'s "suggestion"/"suggestions" text (the one live
  AD-23 violation this story owns, per `ShadchanRow.tsx`'s own Story 4.2 doc comment naming this
  story as the remediator) now uses the same `crm.shadchanim.row.shidduchimCount` i18n key
  `ShadchanRow.tsx` already used — `suggestionCount` prop and `countSuggestionsByShadchan` keep
  their existing names, per that same comment. `ShadchanShow.tsx` deleted.
- Task 4: `shadchanim/index.ts` migrated onto `buildEntityRoutes` + explicit `hasShow`/`hasEdit`;
  `buildRecordPath` flipped to the bare `/shadchanim/{id}` shape; the four symmetric
  `ad24Conformance.ts` exemption rows deleted; every pinned `/show` literal retargeted
  (`registry.stubs.test.ts`, `ShadchanRow.test.tsx`, `ReminderCard.test.tsx` incl. its doc
  comment/case title/inline comment, `e2e/entity-list-search.spec.ts`'s locator — the app is
  hash-routed so the fix is a `*=` contains match, not a `^=` prefix match). `grep -rn "/show"
  src/components/atomic-crm/shadchanim/ e2e/` returns nothing.
- Task 5: `interactions_targets.sql` extended with a shadchan-targeted `tasks` cross-account
  negative (AC-5; `interactions` itself already covered `shadchan` via Story 3.5's own AC 10(b)).
  `references_entity.sql` extended with a `shadchan_stats` cross-account negative plus a
  `security_invoker=on` assertion (AC-6; the generic `security_invoker_views.sql` standing guard
  also covers the reloptions half automatically). New `shadchanim/entityDescriptor.test.tsx`
  covers: tab-strip order, the identity-header/stat-band adapters rendering the real record, the
  Overview tab's Last-redt/Working-on-now facts (populated and empty-state), and
  targetType-scoping for Notes/Tasks/Shidduchim (mirroring `singles/entityDescriptor.test.tsx`'s
  pattern).
- Gates run and green: `make typecheck`, `make lint` (eslint + prettier), `npx vitest run`
  (204 files / 2098 tests), `npm run test:unit:db` (589 tests), `make build`, all four CI guards
  (`check-retired-names`, `check-suppressions`, `check-route-convention`,
  `check-tailwind-arbitrary-var`), `make test STACK_ID=3` (against a real e2e Supabase instance,
  204 files / 2098 tests), and `e2e/entity-list-search.spec.ts` plus `global-search.spec.ts` /
  `entity-list-view-toggle.spec.ts` / `navigation.spec.ts` (chromium project) against
  `STACK_ID=3`. Stack 3 released after use.

### Review Fix Notes (STACK_ID=3 / STACK_OWNER=fix-5-9 review — findings F1–F4 + minor)

No shipped behaviour was wrong; every finding was a coverage/contract-conformance gap in the
guards themselves. All fixed within this story's own declared files.

- **F1 (blocking, fixed): `nb_open_singles` was unguarded at all three layers.** No existing
  fixture (UI, FakeRest, or SQL) ever gave a shadchan two open shidduchim sharing one single, so
  `count(distinct s.single_id)` and a plain non-distinct count produced the same answer everywhere
  — the "non-negotiable" DISTINCT was untested. Added the distinguishing fixture at all three
  layers: `providers/fakerest/dataProvider.summaryStats.test.ts` (a new case: one single, two open
  shidduchim, asserts `nb_open_singles === 1` while `nb_suggestions === 2`);
  `supabase/tests/references_entity.sql` (a second shidduch added to the AC-6 isolation shadchan,
  same single, plus a dedicated DISTINCT-vs-plain-count assertion); `shadchanim/entityDescriptor.test.tsx`
  (the Overview-tab fixture now attributes two shidduchim on two different singles — one open, one
  terminal — so `nb_suggestions` (2) and `nb_open_singles` (1) are deliberately different values,
  with an exact-string assertion on the fact row). Proved each fixture falsifiable by reverting the
  guarded code (`Set<single_id>` → plain count, `count(distinct …)` → `count(…)`,
  `nb_open_singles` → `nb_suggestions`) and confirming red, then restoring green.
- **F2 (blocking, fixed): the stat-band adapter test was decoration.** It asserted only that a
  "Progressed" label was present; `StatStrip` renders every tile unconditionally
  (`data?.x ?? 0`), so a `shadchanId` swapped for a nonexistent id still renders the label — just
  with "0". Rewrote the test to attribute a known, non-zero shidduch to the shadchan and assert the
  tile's exact value (`"1Progressed"`, scoped to its own segment), which a wrong/missing id cannot
  coincidentally produce.
- **F3 (blocking, fixed): AC-6's cross-account negative used two disjoint users, not
  one-login-two-accounts.** Contract §13 rule 3 requires the latter shape specifically because two
  disjoint single-membership users cannot distinguish "filtered by the active context" from
  "filtered by any membership the caller holds" — with only one membership each, the two
  coincide. Replaced the negative in `references_entity.sql` with a fourth user carrying active
  memberships in both tenants, switching via `set_active_context()` (the same shape
  `interactions_targets.sql` already uses for AC-5), and corrected the block's own comment, which
  had falsely claimed parity with the (also two-disjoint-user) check above it. Proved the new
  shape's value directly: temporarily rewrote `shadchanim`'s RLS policy from
  `account_id = current_context_id()` to an "any active membership" `exists(...)` check — the new
  one-login-two-accounts assertions went red, while the old-shape two-disjoint-user checks
  elsewhere in the same file (structurally identical to what this block used to be) stayed green,
  confirming that shape genuinely cannot catch this bug class. Restored the real policy and
  reconfirmed all 591 DB tests green.
- **F4 (disclosed originally, now also forwarded): the `src/components/admin/{edit-button,show-button}.test.tsx`
  ownership excursion will recur on 5.10.** Added a note to `5-10-reference-360-and-diligence.md`'s
  own Project Structure Notes flagging both files up front, so 5.10 declares them instead of
  hitting them as a surprise.
- **Minor (fixed): `ShadchanOverviewTab` silently swallowed a `shadchan_stats` fetch error**,
  rendering the generic "No details on file yet." empty state instead of surfacing the failure
  (`.claude/rules/coding-style.md`: never silently swallow errors). Added an explicit `error`
  branch with a translated message, a new test simulating a rejected `getOne("shadchan_stats", …)`,
  and `enabled: record != null` (rather than `id: record?.id ?? ""`, which is not `null` and so
  never actually skipped the request before the record resolved).
- **Minor (fixed): two fact-row assertions used `toContain`, which a value like `"10"` or `"21"`
  would also satisfy.** Switched both (`entityDescriptor.test.tsx`'s empty-state and Overview
  fixtures) to exact-string equality on the fact row's full text content.

Re-ran the full gate after all fixes: `make typecheck` clean, `make lint` (eslint + prettier)
clean, `npx vitest run` 204 files / 2102 tests, `npm run test:unit:db` against a fresh `STACK_ID=3`
stack (20 files / 591 tests), all four CI guards OK, `make registry-gen` zero diff, `make build`
clean, `e2e/entity-list-search.spec.ts` 3/3 chromium against the same stack. Stack 3 released after
use.

### File List

**Migrations (new):**
- `supabase/migrations/20260730093837_shadchan_notes_migration.sql`
- `supabase/migrations/20260730094101_shadchan_stats_overview.sql`

**Schema:**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/03_views.sql`

**DB tests:**
- `supabase/tests/interactions_targets.sql`
- `supabase/tests/references_entity.sql`

**shadchanim/ (new):**
- `src/components/atomic-crm/shadchanim/entityDescriptor.tsx`
- `src/components/atomic-crm/shadchanim/entityDescriptorRegions.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanOverviewTab.tsx`
- `src/components/atomic-crm/shadchanim/entityDescriptor.test.tsx`

**shadchanim/ (deleted):**
- `src/components/atomic-crm/shadchanim/entityDescriptor.ts`
- `src/components/atomic-crm/shadchanim/ShadchanShow.tsx`

**shadchanim/ (modified):**
- `src/components/atomic-crm/shadchanim/index.ts`
- `src/components/atomic-crm/shadchanim/ShadchanHeader.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanInputs.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanCard.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanRow.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanRow.test.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanCardGrid.test.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanList.test.tsx`

**entity360/:**
- `src/components/atomic-crm/entity360/ad24Conformance.ts`
- `src/components/atomic-crm/entity360/registry.stubs.test.ts`
- `src/components/atomic-crm/entity360/entityDescriptor.test.ts`

**providers/:**
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.summaryStats.test.ts`

**Other:**
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/reminders/ReminderCard.test.tsx`
- `src/components/admin/edit-button.test.tsx` (out-of-scope fix — see Debug Log)
- `src/components/admin/show-button.test.tsx` (out-of-scope fix — see Debug Log)
- `e2e/entity-list-search.spec.ts`
- `registry.json` (regenerated)
