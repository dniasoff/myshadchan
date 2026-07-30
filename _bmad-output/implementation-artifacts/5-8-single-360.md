---
baseline_commit: 3662dd679e8eccd40f5560b441117fa247061aab
---

# Story 5.8: Single 360

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want my own single to have the same 360,
so that the app is consistent.

## Position in Epic 5

Depends on **Epic 3** (shell, descriptor registry, `buildEntityRoutes`, universal
Notes/Tasks/Activity/Files tabs, `RelatedRecordsTab`), **Story 5.3** (Resume — this story extends
it to accept a single as its subject rather than rebuilding it) and **Story 5.4** (Photo, extended
the same way). Independent of 5.1/5.2/5.6/5.7 (those are shidduch-only). Written post-Epic-1: the
entity and resource are `singles` (`src/components/atomic-crm/singles/`), route `/singles/{id}`.

This is a **full 360 migration**, not a tab addition: it flips a route shape, deletes a bespoke
record surface, retires four exemption rows, and moves **all eight** of the entity's canonical tab
keys out of `pendingTabs` in one diff. Read AC-4 and AC-5 together before starting — they are one
change described from two angles, and doing either half alone ships a wrong page with no red test.

## One schema gap this story closes (and one it must NOT re-close)

**Already done by Epic 3 — verify, do not redo.** `target_type = 'single'` needs no migration
here: Story 3.5's AC-1 widened `interactions_target_type_check` to
`('reference', 'shidduch', 'shadchan', 'single')` (`01_tables.sql:466-468`) **and** added the
`(scope = 'account' and target_type in ('shadchan', 'single') and reference_link_id is null)`
branch to `interactions_scope_link_check` (`:486-491`), with RLS branches for both new targets
(`05_policies.sql:315-324`); Story 3.8's AC-1 made `tasks_target_type_check` carry `'single'`. A
migration here that re-specifies those constraints from a stale assumption would silently drop
what 3.5/3.8 shipped. This story only *verifies* the live constraints (Task 2) and consumes them.

**The real gap: `resumes` (and Story 5.4's `resume_photos`) can only attach to a shidduch.** The
epic requires the single's *own* resume ("the one I send out to shadchanim") to live in the same
Resume/Photo tabs already built for a shidduch's suggested candidate — not a second, parallel
resume feature. This story makes `resumes.shidduchim_id` nullable, adds `resumes.single_id`, and
adds a check ensuring exactly one of the two is set. `resume_photos` needs no schema change at
all: it references `resumes.id`, so once `resumes` supports `single_id`, a single's photos are
already representable.

## Acceptance Criteria

1. **Given** the post-Epic-3 schema, **when** this story starts, **then**
   `select pg_get_constraintdef(oid) from pg_constraint where conname in
   ('tasks_target_type_check', 'interactions_target_type_check',
   'interactions_scope_link_check');` confirms `'single'` is already a legal target on all
   three (delivered by Stories 3.5/3.8) — this story ships **no** migration for these
   constraints. If `'single'` is missing, Epic 3 has not landed: stop and report.
   *Failing looks like:* a generated migration containing any `*_target_type_check` line. Stop
   and re-read it.
2. **Given** `public.resumes`, **when** this story's migration lands, **then**
   `shidduchim_id` is nullable, a new nullable `single_id` column exists (FK
   `(account_id, single_id)` → `singles(account_id, id)` `on delete cascade`, mirroring
   `resumes_shidduchim_id_fkey` at `01_tables.sql:700-702`), and a check constraint enforces
   exactly one of `shidduchim_id`/`single_id` is non-null. The old
   `resumes_shidduchim_id_key unique (shidduchim_id)` (`:703-704`) becomes two partial unique
   indexes (`unique (shidduchim_id) where shidduchim_id is not null` and
   `unique (single_id) where single_id is not null`) — at most one resume per shidduch, at most
   one per single. `resumes_account_id_id_key unique (account_id, id)` (`:653-654`) is
   **untouched**: `reference_links_resume_id_fkey` (`:719-720`) depends on it.
   **Negative test:** inserting a `resumes` row with both or neither set is rejected by the check
   constraint.
3. **Given** Story 5.3's `ResumeVersionList`/`ResumeUpload` and Story 5.4's `PhotoTab`, **when**
   they are reused for a single, **then** they accept either `{ shidduchimId }` or
   `{ singleId }` as their subject prop — a single, shared implementation, two callers. No new
   upload, version-list or reveal component is written in this story.
4. **Given** the `singles` resource, **when** this story lands, **then** it is mounted on the
   AD-24 route shape — **and this is the half that a `buildRecordPath` flip alone does not
   deliver**:
   - `singles/index.ts` registers **`list: buildEntityRoutes({ List: SingleList, Edit: SingleEdit,
     Show: EntityShow })`** plus explicit **`hasShow: true`** and **`hasEdit: true`**, and
     **drops** its own `show:` and `edit:` props (`singles/index.ts:18-20` today). It keeps
     `hasCreate: true` and keeps **`children: buildCreateRoutes("singles", SingleCreate)`** —
     **`New` is NOT passed to `buildEntityRoutes` here**.
     **Review-fix correction (finding 4):** the paragraph below originally said the inverse —
     `New` inside `buildEntityRoutes` and `buildCreateRoutes("singles")` called with no `New`
     argument. That shape is `shidduchim`'s own **one-time exception** (Story 5.1's doc comment,
     `shidduchim/index.ts`, names it explicitly: "the sole entity whose create surface used to be
     matched inside its own list… declaring `New` in both places at once would register
     `/{entity}/new` twice"). `singles` — like `shadchanim`/`references` — keeps its create surface
     routed the way `buildCreateRoutes` already provides it: `hasCreate: true` keeps `<List>`'s
     built-in `CreateButton` rendering, and `children: buildCreateRoutes("singles", SingleCreate)`
     supplies the `new/*` route plus the `/create` → `/new` compatibility redirect
     (`entity360/routeConvention.tsx:43-56`) — the exact pattern `shadchanim/index.ts` (pre-5.9
     stub) and `references/index.ts` (Story 4.x) already use. `shidduchim/index.ts`'s inverse shape
     is `shidduchim`'s own one-time exception, not the default other entities should copy; 5.9 and
     5.10's own story text already state this correctly.
   - `singles/entityDescriptor.ts`'s `buildRecordPath` becomes ``(id) => `/singles/${encodeURIComponent(id)}` ``
     — the `encodeURIComponent` form is what `hasAd24RecordShape` compares against
     (`routeConvention.tsx:67-72`), which is the predicate `EditButton` uses to tell a migrated
     entity from an unmigrated one.
   - **Why both halves, in the same diff:** `<Resource>` maps `edit` to the splat route `":id/*"`
     (`ra-core/dist/core/Resource.js:13`). While `edit:` is still declared, `/singles/{id}` and
     `/singles/{id}/{tab}` both match it, so **`SingleEdit` renders where the 360 should be** — no
     error, no red test, a wrong page. And `<Resource>` computes `hasEdit: !!edit || !!hasEdit` /
     `hasShow: !!show || !!hasShow` (`Resource.js:32-34`), so dropping `show:`/`edit:` without the
     two explicit flags leaves both `false` and every `<DataTable>` row unclickable
     (`root/routeManifest.ts`'s `record-flags-missing`).
   - `RecordLink` call sites follow automatically — they resolve through
     `entityPaths.ts#buildRecordPath`, which delegates to the descriptor.
   *Failing looks like:* navigating to `/singles/{id}/overview` renders a **form**, not the
   `Entity360` tab strip. Assert the tab strip, not the URL.
5. **Given** the AD-24 exemption tables, **when** AC-4's change lands, **then** the following rows
   are deleted **in the same diff**, because the checks are symmetric — leaving them fires
   `stale-exemption`, removing the surface without them fires the mirror violation:
   - `entity360/ad24Conformance.ts:121` `RECORD_SURFACE_EXEMPTIONS["singles:show"]`
     (`retiredBy: "5.8"`)
   - `entity360/ad24Conformance.ts:122` `RECORD_SURFACE_EXEMPTIONS["singles:edit"]`
     (`retiredBy: "5.8"`)
   - `entity360/ad24Conformance.ts:171` `PENDING_ROUTE_SHAPES.singles` (`retiredBy: "5.8"`)
   `root/routeManifest.ts`'s `RECORD_FLAG_EXEMPTIONS` has **no** `singles` entry (`:135-142`) —
   there is nothing to delete there, and none must be added.
   *Failing looks like:* `npx vitest run src/components/atomic-crm/entity360` red on
   `ad24Conformance.guard.test.ts` with `stale-exemption`.
6. **Given** one of my singles, **when** I open their record, **then** I see **Overview, Resume,
   Photo, Files, Shidduchim, Notes, Tasks, Activity** — in that order, matching
   `CANONICAL_TAB_SETS.singles` (`entity360/ad24Conformance.ts:229-238`) — on the `Entity360`
   shell at `/singles/{id}/{tab}`. All eight keys move into the descriptor's `tabs` and
   **`pendingTabs` becomes `[]`** in the same diff: `tabs ∪ pendingTabs` must equal the canonical
   row **as sets**, a key in both is `tab-key-duplicated`, a key in neither is
   `tab-set-incomplete`, and a declaration out of canonical relative order is `tab-order-drift`.
   `entity360/registry.stubs.test.ts`'s pinned `singles` row (`:51-63`, asserted at `:93-95`:
   `buildRecordPath(1) === "/singles/1/show"`, `tabs toEqual []`, the full 8-key `pendingTabs`)
   goes red on **all three** assertions by design — update it in the same diff.
7. **Given** the universal tabs, **when** they are mounted for a single, **then** each is passed
   **`targetType="single"` and `targetId={record.id}`** — the shipped prop shape is
   `UniversalTabProps = { targetType, targetId }` (`entity360/tabs/types.ts:11-14`). **Never
   `target_type`**: that is the database column name, not the prop, and writing it is an
   excess-property `tsc` error plus a missing required prop.
8. **Given** the Shidduchim tab, **when** it renders, **then** it lists every shidduch where
   `single_id = {id}` (post Epic 1 Story 1.3's rename), each row a `RecordLink` to that
   shidduch's own 360 — rendered through **`entity360/tabs/RelatedRecordsTab.tsx`**, which exists
   for exactly this and names this story by number as a reuser (`RelatedRecordsTab.tsx:24-27`);
   `relationshipDescriptor.ts:44-50` ships the worked descriptor verbatim:
   ```ts
   { key: "shidduchim", resource: "shidduchim", getFilter: (r) => ({ single_id: r.id }) }
   ```
   `resource` **is** the link target here, so no `linkResource`/`linkId` is needed.
   **Review-fix correction (finding 1): `linkLabel` IS needed here, despite the contract's own
   worked example saying otherwise.** That example's "no `linkLabel` is needed" holds only when
   the queried resource has a `recordRepresentation`; `shidduchim/index.ts` declares none (unlike
   `singles`/`shadchanim`/`references`/`members`), so without one, `RelatedRecordsTab` renders
   ra-core's bare `#{id}` fallback for every row. Add
   `linkLabel: (row) => row.name_en ?? row.single_first_name_en ?? \`#${row.id}\`` (matching
   `shidduchim/ShidduchCard.tsx`'s own display-name convention) — wholly inside this story's own
   `singles/entityDescriptorRegions.tsx`, not `shidduchim/index.ts`.
   **Declare it as an explicit `tabs` entry rendering `<RelatedRecordsTab relationship={…}/>` at
   position 5, not as a `relationships` entry.** `mergeEntityTabs` **appends** every
   relationship-derived tab after every explicit `tabs` entry (`mergeEntityTabs.tsx:91`, whose own
   doc names this exact case — Single included — at `:55-75`), so a `relationships` declaration
   would render
   `Shidduchim` **last**, diverging from UX-DR5 — and `tab-order-drift` reads the *declaration*,
   not the render, so it ships **silent**.
   *Failing looks like:* an RTL-equivalent render whose tab strip reads `… Activity, Shidduchim`.
   Assert on the rendered strip order, never on the descriptor literal. Do **not** hand-roll a
   `SingleShidduchimTab.tsx` with its own `useGetList("shidduchim", …)`.
9. **Given** `singles/SingleShow.tsx` is deleted, **when** the diff lands, **then**
   `grep -rn "SingleShow" src/` returns nothing **and** `SingleProfileHeader` still has a home:
   `singles/SingleProfileHeader.test.tsx:5` does `import { SingleProfileHeader } from "./SingleShow";`
   and breaks outright otherwise. Move the component into its own
   `singles/SingleProfileHeader.tsx` and repoint the test's import.
   **And** it is wrapped for the descriptor: `identityHeader` is
   `ComponentType<{ record: T }>` (`entity360/entityDescriptor.ts:57`) while
   `SingleProfileHeader` is `({ single }: { single: Single })` (`SingleShow.tsx:45`) — a one-line
   adapter in the descriptor module, e.g.
   `const SingleIdentityHeader = ({ record }: { record: Single }) => <SingleProfileHeader single={record} />;`.
   `PipelineSnapshot` (`SingleShowLayout`'s other half, `SingleShow.tsx:114`) relocates into the
   Overview tab's `children`, not the identity header.
10. **Given** the single's Resume tab, **when** it holds a file, **then** that file — not a
    second, separate document — is what any future outbound send to a shadchan (Epic 9) will
    read; this story does not build that outbound flow, it only ensures there is exactly one
    canonical resume location for a single.

## Tasks / Subtasks

- [x] **Task 1 — Confirm gates** (prerequisite)
  - [x] Confirm Epic 3's shell/descriptor registry, `buildEntityRoutes` and universal tabs exist.
        Confirm Story 5.3 (`resumes` upload path) and Story 5.4 (`resume_photos`) have landed —
        this story extends both rather than reimplementing them.
- [x] **Task 2 — Verify the polymorphic targets, do not migrate them** (AC: 1)
  - [x] Run the AC-1 `pg_get_constraintdef` query; confirm the TypeScript unions
        (`Interaction.target_type`, `TaskTargetType` — both alias `EntityTargetType`,
        `types.ts:79-94`) already carry `"single"`. No schema or type change here.
  - [x] Confirm 3.5's cross-account negative tests cover `target_type = 'single'`
        (`supabase/tests/interactions_targets.sql` + its runner); if that suite somehow lacks the
        case, extend it rather than writing a new style.
- [x] **Task 3 — Extend `resumes` to a single** (AC: 2)
  - [x] `01_tables.sql`: `alter column shidduchim_id drop not null`; add `single_id bigint`;
        composite FK `(account_id, single_id)` → `singles(account_id, id)` `on delete cascade`;
        drop `resumes_shidduchim_id_key`, add the two partial unique indexes; add
        `constraint resumes_owner_check check ((shidduchim_id is not null) <> (single_id is not null))`.
        Leave `resumes_account_id_id_key` alone (AC-2).
  - [x] No view work: `grep -n "resumes" supabase/schemas/03_views.sql` returns nothing at HEAD —
        no view joins `resumes`, so no `security_invoker` or view grant is at risk. Re-run the
        grep rather than trusting this line.
  - [x] Generate + hand-check migration (workflow below).
- [x] **Task 4 — Generalise the Resume/Photo components** (AC: 3)
  - [x] `resumes/ResumeVersionList.tsx`, `ResumeUpload.tsx`, `PhotoTab.tsx`: change their subject
        prop from a bare `shidduchimId: Identifier` to a discriminated union
        `{ shidduchimId: Identifier } | { singleId: Identifier }`, and thread it through to
        `add_resume_file` / `add_resume_photo` (Stories 5.3/5.4's RPCs) — update their SQL
        signatures to accept `p_single_id` as an alternative to `p_shidduchim_id` (same
        exactly-one-of check as the table).
  - [x] **`06_grants.sql`:** changing an RPC's argument list changes its **signature**, so the
        migration is `DROP FUNCTION … ; CREATE FUNCTION …` — which **drops the function's
        grants**. Re-issue the `revoke all on function … from public, anon; grant execute … to
        authenticated; … to service_role;` triple for each changed RPC, following the pattern at
        `06_grants.sql:291-293` and `:334-336`. Function grants live in `06_grants.sql`, never in
        `02_functions.sql`.
- [x] **Task 5 — Mount `singles` on the AD-24 route shape** (AC: 4, 5)
  - [x] `singles/index.ts`: adopt `buildEntityRoutes` + explicit `hasShow`/`hasEdit`, drop
        `show:`/`edit:`, keep `hasCreate: true` and `children: buildCreateRoutes("singles")` with
        no `New` argument. Keep `import "./entityDescriptor";` as the first line
        (`entity360/entityDescriptor.ts:29-36`).
  - [x] Delete the three exemption rows named in AC-5, in this same diff.
  - [x] Run `findAd24Violations` against the real manifest — it must return `[]`.
- [x] **Task 6 — Single descriptor and tabs** (AC: 6, 7, 8, 9)
  - [x] **Edit `singles/entityDescriptor.ts` in place**, keeping exactly **one**
        `registerEntityDescriptor` call. The module is not a "minimal `name` +
        `buildRecordPath` stub" — it already carries `label`, `tabs: []` and the full 8-key
        `pendingTabs` (`:18-33`); read it before editing.
        **Pass `{ replace: true }` on that single call** —
        `registerEntityDescriptor(singlesDescriptor, { replace: true })` — matching 5.1, 5.9 and
        5.10 and the module's **own** doc comment (`singles/entityDescriptor.ts:6`, which already
        says the stub is "replaced wholesale via `registerEntityDescriptor(singlesDescriptor,
        { replace: true })`"). Stated precisely, because three sibling stories state the reason
        wrongly: with one in-place call per module nothing throws either way —
        `registry.ts:29-33` throws only when a **second** registration site for the same `name`
        runs without the flag. The flag is uniform-by-convention here, not a fix for a live
        throw; keep one module and one call.
  - [x] Flip `buildRecordPath` per AC-4; declare all eight tabs in canonical order; set
        `pendingTabs: []`.
  - [x] Add the `identityHeader` adapter and re-home `SingleProfileHeader` per AC-9; delete
        `SingleShow.tsx` and repoint `SingleProfileHeader.test.tsx:5`.
  - [x] Add **no** `label` overrides. All eight labels already ship
        (`entity360/tabKeys.ts:42-58`, `englishCrmMessages.ts:382-398`); an override needs a
        "why THAT entity deviates" comment (`entityDescriptor.ts:97-104`) for a deviation that
        does not exist. **Epic 5 adds no `crm.entity360.tab.*` keys.**
  - [x] Overview: `render` is arity-zero and reaches the record via `useRecordContext<Single>()`.
        **That record is the base `singles` row, not `singles_summary`** — unlike `shidduchim`
        and `references`, the Supabase provider does **not** redirect `singles` reads to a summary
        view (`providers/supabase/dataProvider.ts:103-127`). Compose the Overview from `Single`'s
        own fields (`first_name_en/he`, `last_name_en/he`, `dob`, `gender`, `community`,
        `status`) through `entity360/tabs/OverviewTab.tsx` + `OverviewFactGrid`, with
        `PipelineSnapshot` as `children`. If the aggregate counts (`total_shidduchim`,
        `open_shidduchim`, `singles_summary` at `03_views.sql:170-190`) are wanted, the tab's own
        component owns that `useGetOne("singles_summary", …)` — region and tab renderers are
        component boundaries and MAY call hooks; `EntityShow` fetches nothing beyond the record
        (`entityDescriptor.ts:53-56`). **No new columns are needed either way.**
  - [x] Shidduchim tab: the explicit `tabs` entry at position 5 rendering
        `<RelatedRecordsTab relationship={…}/>` per AC-8.
  - [x] Files / Notes / Tasks / Activity: mount Epic 3's universal components with
        `targetType="single"` + `targetId` (AC-7).
  - [x] `entity360/registry.stubs.test.ts`: update the pinned `singles` row (AC-6).
- [x] **Task 7 — Lockstep and generated artifacts**
  - [x] `types.ts`: `Resume` gains `single_id` and `shidduchim_id` becomes nullable.
  - [x] FakeRest per AD-10: `providers/fakerest/dataProvider.ts`, the resumes generator, and
        `providers/fakerest/internal/accountDomainData.ts` (`resumes` is already in
        `DOMAIN_RESOURCES`, `:19-32` — verify it still reads correctly with a single-owned
        resume). Also verify `providers/fakerest/internal/removePersona.ts`, whose single-archive
        path runs through the same domain-data check; record "no change needed" in the File List
        rather than silently omitting it.
  - [x] `supabase/tests/`: a new `.sql` suite for AC-2's negative cases needs a **paired
        `.test.ts` runner** — every `.sql` suite has one, 13 pairs at HEAD, no exceptions.
        Alternatively extend an existing pair.
  - [x] `registry.json`: this story adds (`SingleProfileHeader.tsx`) and deletes
        (`SingleShow.tsx`) non-test source files under `src/components/atomic-crm/`, so
        `scripts/generate-registry.mjs` output changes. `.husky/pre-commit` regenerates it; commit
        the result.
  - [x] `e2e/entity-list-view-toggle.spec.ts` drives `/#/singles` — the list route now resolves
        through `buildEntityRoutes`' `index` route rather than `<Resource>`'s `/*` catch-all.
        **Run the e2e suite at least once in this story's wave**; a path/route change that reaches
        e2e is the Epic-4 failure mode, and the unit suite does not cover it.
- [x] **Task 8 — Verify**
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        `npx vitest run src/components/atomic-crm/entity360` and one e2e run.

## Dev Notes

### Test stack — what the repo actually uses

Component tests run under **`vitest-browser-react` in Chromium**, with `TestMemoryRouter` for
anything routed. `entity360/EntityShow.test.tsx:78`, `EntityShow.regions.test.tsx:69` and
`EntityShow.permissions.test.tsx:103` all mount
`{buildEntityRoutes({ List: () => null, Show: EntityShow })}` inside a `TestMemoryRouter` — that is
the exact harness AC-4's "renders the tab strip, not a form" and AC-8's tab-order assertion need.
**React Testing Library is not a dependency of this repo** — do not import
`@testing-library/react`. Follow AAA and `.claude/rules/testing.md`.

### Reuse — the whole point of this story

Do not write a second upload flow, a second version list, a second reveal-photo component, or a
hand-rolled related-records list. Stories 5.3 and 5.4 built the first three; Story 3-10 built the
fourth (`RelatedRecordsTab`). This story's only novel work is (a) the `resumes` owner-column
change, (b) threading a single as an alternative subject through existing components, and (c) the
route/descriptor migration. If a component ends up hard-coded to `shidduchimId` in a way that
resists generalisation, that is a signal 5.3/5.4 under-scoped their own prop design — fix the prop
shape there conceptually, but implement the fix here since this is the story that first needs it.

### Ownership note for Story 5.9

Story 5.9 (Shadchan 360) sits on the same Epic 3 ground: `'shadchan'` was added to
`interactions_target_type_check` and the scope branch by Story 3.5, and `tasks` always allowed
it. Neither 5.8 nor 5.9 migrates these constraints; both verify them. If either story finds
itself writing `DROP CONSTRAINT` on them, it is working from a stale assumption — stop.
5.9 carries the **same** route-mount requirement (AC-4/AC-5 above, with `shadchanim` substituted)
and the same `targetType`/`targetId` rule; it is described in its own file, not inherited from
here.

### Migration workflow

Edit `supabase/schemas/*`, then run
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f resume_single_owner`,
hand-check: `db diff` never emits the partial-unique-index swap or the `resumes_owner_check`
constraint precisely — read the generated file line by line against Task 3 before applying, and
confirm it touches **only** `resumes` and the two changed RPCs (no `*_target_type_check` lines —
see Task 2). Then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
`db reset` / `db push`.

### Project Structure Notes

- No new top-level folder: `singles/` already exists (post Epic 1 Story 1.3's rename). This story
  adds `SingleProfileHeader.tsx` and the descriptor wiring there, and adds **no**
  `SingleShidduchimTab.tsx` — see AC-8.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.8]
- [Source: _bmad-output/planning-artifacts/epics.md#Requirements-Inventory, FR92] — "A single has
  a profile and a resume, same person-shape as a candidate."
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding. §3 (`TabKey`, tab-set
  conformance), §4 (registry rules), §5 (route convention, `buildEntityRoutes` + explicit record
  flags), §8 (`UniversalTabProps`), §9 (`RelatedRecordsTab` / relationships), §0 (validation
  commands, vocabulary).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — "A single sees the same screens as a parent… the difference is permission, never a parallel
  surface" (why this reuses 5.3/5.4 rather than forking them).
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md] AC-1,
  [Source: _bmad-output/implementation-artifacts/3-8-universal-tasks-tab.md] AC-1 — the `'single'`
  target-type widening this story verifies instead of redoing.
- [Source: _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — `RecordLink` and
  the four stub descriptors this story replaces one of.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md] — the
  post-rename names (`singles`, `single_id`) this story is written against.
- [Source: .claude/rules/testing.md] — AAA, naming, 80% coverage floor.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow), STACK_ID=3 / STACK_OWNER=5-8.

### Debug Log References

- `supabase db diff --local -f resume_single_owner` was hand-edited before applying: the raw
  diff also proposed `drop view` / `create or replace view` for `reference_links_summary`,
  `shadchan_stats`, `shidduchim_summary`, `singles_summary` — none of which reference `resumes`
  (confirmed by re-running the same diff on the pre-story tree, which reproduces it identically).
  Applying it verbatim would have silently dropped `security_invoker = on` from all four (`db
  diff` never re-emits it — confirmed live: `pg_class.reloptions` already read
  `{security_invoker=on}` on all four before this diff). Stripped from the applied migration;
  documented as a MANUAL ADJUSTMENT in the migration file's own header. This is pre-existing
  drift, not caused by this story.
- `add_resume_file`/`add_resume_photo`'s widened signatures move `p_shidduchim_id`/`p_single_id`
  after the always-required parameters (Postgres requires every defaulted parameter to follow
  every non-defaulted one) — `supabase/tests/documents_storage.sql` and `resume_photos.sql`
  called both positionally and needed converting to named notation (`p_path => …`) to keep
  working; PostgREST/supabase-js already call by name, so the SPA call sites were unaffected.
- Fixed 4 pre-existing tests broken by the AD-24 migration itself (not touched by any earlier
  story, discovered by running the full suite): `SingleRow.test.tsx` and
  `routeConvention.routes.test.tsx` pinned the old `/singles/{id}/show` shape;
  `show-button.test.tsx` / `edit-button.test.tsx` used the real `singlesDescriptor` as their
  "still a stub" fixture — repointed to `shadchanimDescriptor` (Story 5.9 hasn't migrated it
  yet), the same file-repointing fix rather than inventing a synthetic fixture resource.
  `e2e/global-search.spec.ts` hard-coded `/singles/{id}/show` (the exact "Epic-4 failure mode"
  L15 warns about) — fixed and proved red-then-green live against a real e2e run.
  `supabase/tests/references_entity.sql`'s "every account-scoped FK carries account_id" check
  hard-coded `count(*) = 9`; Story 5.8's second composite FK on `resumes` bumps it to 10.
- Verified end-to-end against a FRESH e2e stack (`STACK_ID=3`, migrations replayed from scratch,
  not just applied incrementally to the long-running dev DB): `make test STACK_ID=3` (2075/2075
  unit+DB tests) and the full Playwright suite (`npx playwright test`, 39 passed / 7
  project-skipped, 0 failed), including `e2e/entity-list-view-toggle.spec.ts` (Task 7's named
  file) and `e2e/global-search.spec.ts` (the file this story's own migration broke). Stack
  stopped and lease released afterward.

### Completion Notes List

- AC 1: verified `tasks_target_type_check` / `interactions_target_type_check` /
  `interactions_scope_link_check` already carry `'single'` (Stories 3.5/3.8); shipped no
  migration touching them. `TaskTargetType`/`Interaction.target_type` already alias
  `EntityTargetType`, which already includes `"single"`.
- AC 2: `resumes.shidduchim_id` is now nullable, `resumes.single_id` added, FK `(account_id,
  single_id) -> singles(account_id, id) on delete cascade`, `resumes_owner_check` enforces
  exactly one of the two, `resumes_shidduchim_id_key`/`resumes_single_id_key` are now two
  partial unique indexes. `resumes_account_id_id_key` untouched. New negative-case suite
  `supabase/tests/resume_single_owner.sql` + `.test.ts` (12 checks) proves the check constraint,
  both partial unique indexes, the RPC-level exactly-one-of guard and the account-ownership
  guard for a single subject.
- AC 3: `ResumeUpload`, `ResumeVersionList` and `PhotoTab`'s exported `PhotoTabContent` now take
  a `ResumeSubject` discriminated union (`resumes/resumeSubject.ts`, new) instead of a bare
  `shidduchimId`. No new upload, version-list or reveal component was written — `ResumeTab`
  (shidduch) and the new `singles/entityDescriptorRegions.tsx` adapters (single) are the two
  callers.
- AC 4/AC 5: `singles/index.ts` now registers `list: buildEntityRoutes({ List, Edit, Show:
  EntityShow })` + explicit `hasShow: true`/`hasEdit: true`, dropping `show:`/`edit:`.
  `singles/entityDescriptor.tsx`'s `buildRecordPath` is `` (id) => `/singles/${encodeURIComponent(id)}` ``.
  The three AC-5 exemption rows (`RECORD_SURFACE_EXEMPTIONS["singles:show"/"singles:edit"]`,
  `PENDING_ROUTE_SHAPES.singles`) are deleted. `root/routeManifest.ts`'s `RECORD_FLAG_EXEMPTIONS`
  confirmed to have no `singles` entry (nothing to delete, none added).
- AC 6/7: all eight canonical tab keys (`overview, resume, photo, files, shidduchim, notes,
  tasks, activity`) declared in `singles/entityDescriptor.tsx#tabs`, in canonical order;
  `pendingTabs: []`. Files/Notes/Tasks/Activity wrappers pass `targetType="single"` +
  `targetId={record.id}` (never `target_type`). `entity360/registry.stubs.test.ts`'s `singles`
  case updated to the migrated shape (all three assertions now green by design, not red).
- AC 8: Shidduchim is an explicit `tabs` entry at position 5 rendering `<RelatedRecordsTab
  relationship={singleShidduchimRelationship}/>` (`resource: "shidduchim", getFilter: (r) => ({
  single_id: r.id })` — the worked example verbatim) — never a `relationships` entry, and no
  hand-rolled `useGetList`. **Review fix (finding 1):** the relationship also carries `linkLabel`
  — `shidduchim/index.ts` has no `recordRepresentation`, so without it every row rendered
  ra-core's bare `#{id}`, not a name. See Review Fix Notes below.
- AC 9: `SingleShow.tsx` deleted. `SingleProfileHeader` relocated to its own
  `singles/SingleProfileHeader.tsx` (prop signature unchanged); `SingleProfileHeader.test.tsx`'s
  import repointed. `SingleIdentityHeader` in `singles/entityDescriptorRegions.tsx` is the
  one-line `{ record } -> { single: record }` adapter. `PipelineSnapshot` relocated into
  `SingleOverviewTab.tsx`'s `children`. `grep -rn "SingleShow" src/` returns nothing (including
  in every comment touched by this diff).
- AC 10: not built (out of scope, per the story) — the single's Resume tab is the one canonical
  resume location a future outbound-send flow (Epic 9) will read from.
- Added, beyond the story's explicit ACs, but load-bearing for parity: `actions:
  SingleActions` (an `EditButton`, preserving the one affordance the deleted routed record page
  carried in its own action bar — otherwise `/singles/{id}/edit` becomes unreachable from the
  UI). Kept deliberately minimal (one existing button, no new surface).
- `singles/entityDescriptor.ts` (the 3.9 stub) was deleted and replaced by
  `singles/entityDescriptor.tsx` (needs JSX for the tab `render` functions) — mirrors the
  `shidduchim/entityDescriptor.tsx` rename precedent from Story 5.1.
- Task 7's FakeRest verification: `providers/fakerest/internal/accountDomainData.ts`'s
  `resumes` check filters by `account_id` only, so it already reads correctly for a
  single-owned resume — no change needed. `providers/fakerest/internal/removePersona.ts`'s
  single-archive path runs through the same `accountHasDomainData` check — verified, no change
  needed.
- All eight gates green: `make typecheck`, `npm run lint` (0 warnings), `npx vitest run` (2075/
  2075), `make build`, `npx prettier --check .` (clean except pre-existing, untouched
  `.github/`/`doc/` drift), all four CI guards (`check-retired-names`, `check-suppressions`,
  `check-route-convention`, `check-tailwind-arbitrary-var`), `make test STACK_ID=3` (2075/2075
  against a freshly-bootstrapped e2e stack), `supabase db diff --local` (clean of any
  resumes-related residue after applying).

### Review Fix Notes (commit `d083970`'s review — findings 1, 2, 4, 5)

- **Finding 1 (blocking, fixed)**: the Shidduchim tab (AC 8) listed each row as ra-core's bare
  `#{id}` fallback, not a name — `shidduchim/index.ts` declares no `recordRepresentation` (unlike
  `singles`/`shadchanim`/`references`/`members`), so `RelatedRecordsTab`'s
  `relationship.linkLabel?.(row) ?? getRecordRepresentation(row)` fell through to it. The worked
  example in `relationshipDescriptor.ts` ("no `linkLabel` is needed" when `resource` IS the link
  target) is correct only when the target resource has a representation; it does not here. Fixed
  entirely within this story's own files — no ownership call needed — by adding
  `linkLabel: (row) => row.name_en ?? row.single_first_name_en ?? \`#${row.id}\`` to
  `singleShidduchimRelationship` (`singles/entityDescriptorRegions.tsx`), matching
  `shidduchim/ShidduchCard.tsx`'s own display-name convention. Proved red (reproducing the exact
  `#{id}` regression) with the `linkLabel` line removed, then green with it restored.
- **Finding 2 (blocking, fixed)**: `entityDescriptorRegions.tsx` and `SingleOverviewTab.tsx`
  shipped with zero test coverage, so a `targetType`/`targetId`/subject swap in any of the six
  region adapters was invisible to the suite — proven live in review (`SingleNotesTab`'s
  `targetType="single"` → `"shidduch"`, and all three of
  `ResumeUpload`/`ResumeVersionList`/`PhotoTabContent`'s `singleId` → `shidduchimId`, both left the
  full suite green). New `singles/entityDescriptor.test.tsx` (`shidduchim/entityDescriptor.test.tsx`'s
  pattern applied to `singles`, mounted through the REAL registered `singlesDescriptor` via
  `EntityShow`, real FakeRest data provider): a Files/Notes/Tasks/Activity test per universal tab,
  each seeding this single's own row, a same-type-wrong-`target_id` row, and a same-numeric-id-
  wrong-`targetType` row (mirrors `shidduchim/entityDescriptor.test.tsx`'s own Files-tab pattern);
  a Resume-tab and a Photo-tab test that upload through the real component tree and assert the
  resulting `resumes` row is keyed by `single_id`, never `shidduchim_id`; and the AC-8 test finding
  1 needed anyway. Proved every one of these red against the reviewer's exact mutations
  (`SingleNotesTab` target type, `SingleTasksTab` target type, the Resume-tab subject swap) before
  restoring the clean file and confirming green.
- **Finding 3 (should-fix, agreed and fixed)**: the only existing tab-strip assertion
  (`routeConvention.routes.test.tsx`) checked a tab **count**, not the rendered **order** — AC-8's
  own instruction ("assert on the rendered strip order, never the descriptor literal") was
  unimplemented. Added a "tab strip order" test to the new `entityDescriptor.test.tsx` asserting
  the real rendered `role="tab"` sequence equals all eight canonical labels in order.
- **Finding 4 (should-fix, agreed and fixed)**: AC-4's text mandated
  `buildEntityRoutes({ …, New: SingleCreate, … })` plus `buildCreateRoutes("singles")` called with
  no `New` argument — the shipped code does the opposite (`New` stays out of `buildEntityRoutes`;
  `children: buildCreateRoutes("singles", SingleCreate)`), which is the *correct* shape:
  `shidduchim/index.ts`'s own doc comment names its inverse arrangement as a one-time exception,
  and `shadchanim`/`references` (both already shipped) use the same shape this story shipped.
  Corrected AC-4's text in place so a future reader does not inherit the wrong instruction.
- **Finding 5 (should-fix, agreed and fixed)**: `supabase/schemas/07_storage.sql:158`'s photo
  storage-key-grammar comment still documented only the shidduch form
  (`{shidduchim_id}`); this story also writes `single-{single_id}` there (verified live:
  `191/resumes/single-140/…`). The RLS policies only inspect segments [1]-[3] (never [4]), so
  security reasoning was unaffected — the comment was just incomplete. Extended it to document
  both forms.
- Finding 6 (informational, not actionable within this story) was left as recorded — a pre-existing
  shared DB-test-runner behavior (`supabase/tests/dbSuiteHelpers.ts`'s `bailIfDbUnreachable`),
  outside this story's own File List, and confirmed safe under `CI=1` (the gate this repo's CI
  actually runs with).

### File List

**Schema / migration**
- `supabase/schemas/01_tables.sql` — `resumes`: `shidduchim_id` nullable, `single_id` added,
  `resumes_owner_check`, `resumes_single_id_fkey`, two partial unique indexes replacing
  `resumes_shidduchim_id_key`.
- `supabase/schemas/02_functions.sql` — `add_resume_file`/`add_resume_photo` widened to accept
  `p_single_id` as an alternative to `p_shidduchim_id`.
- `supabase/schemas/06_grants.sql` — grants re-issued for both widened RPC signatures.
- `supabase/migrations/20260730080056_resume_single_owner.sql` — new (hand-adjusted; see Debug
  Log References).
- `supabase/tests/resume_single_owner.sql` — new (AC-2 negative-case suite).
- `supabase/tests/resume_single_owner.test.ts` — new (paired runner).
- `supabase/tests/documents_storage.sql` — `add_resume_file` calls converted to named notation.
- `supabase/tests/resume_photos.sql` — `add_resume_photo` calls converted to named notation.
- `supabase/tests/references_entity.sql` — the account-scoped-FK count bumped 9 -> 10.
- `supabase/schemas/07_storage.sql` — review fix (finding 5): the photo storage-key-grammar
  comment extended to document the `single-{single_id}` form alongside `{shidduchim_id}`.

**Frontend — singles**
- `src/components/atomic-crm/singles/entityDescriptor.ts` — deleted (3.9 stub).
- `src/components/atomic-crm/singles/entityDescriptor.tsx` — new (replaces it; AD-24-migrated
  descriptor).
- `src/components/atomic-crm/singles/entityDescriptorRegions.tsx` — new (identityHeader/actions/
  tab adapters); review fix (finding 1): `singleShidduchimRelationship` gains `linkLabel`.
- `src/components/atomic-crm/singles/entityDescriptor.test.tsx` — new (review fix, findings 2/3):
  tab-strip order; the real Shidduchim tab's rendered label + link (finding 1's coverage);
  Files/Notes/Tasks/Activity targetType/targetId scoping; Resume/Photo `{ singleId }` subject
  wiring proved through a real upload.
- `src/components/atomic-crm/singles/SingleShow.tsx` — deleted.
- `src/components/atomic-crm/singles/SingleProfileHeader.tsx` — new (relocated from
  `SingleShow.tsx`).
- `src/components/atomic-crm/singles/SingleProfileHeader.test.tsx` — import repointed.
- `src/components/atomic-crm/singles/SingleOverviewTab.tsx` — new (Overview tab content).
- `src/components/atomic-crm/singles/singleLabels.ts` — new (shared `GENDER_LABEL`/
  `STATUS_LABEL`, extracted for `react-refresh/only-export-components`).
- `src/components/atomic-crm/singles/index.ts` — mounted on `buildEntityRoutes` + explicit
  `hasShow`/`hasEdit`.
- `src/components/atomic-crm/singles/SingleCard.tsx` — doc comment: no more "SingleShow"
  literal.
- `src/components/atomic-crm/singles/SingleEdit.tsx` — doc comment: no more "SingleShow"
  literal.
- `src/components/atomic-crm/singles/SingleRow.test.tsx` — assertion updated to the AD-24 path
  shape.

**Frontend — resumes (generalised to a single subject)**
- `src/components/atomic-crm/resumes/resumeSubject.ts` — new (`ResumeSubject` discriminated
  union + helpers).
- `src/components/atomic-crm/resumes/resumeSubject.test.ts` — new.
- `src/components/atomic-crm/resumes/ResumeUpload.tsx` — subject prop widened.
- `src/components/atomic-crm/resumes/ResumeVersionList.tsx` — subject prop widened.
- `src/components/atomic-crm/resumes/PhotoTab.tsx` — subject prop widened; `PhotoTabContent`
  exported for the single-side call site.

**Frontend — providers**
- `src/components/atomic-crm/providers/supabase/resumes.ts` — `uploadResumeFile` widened.
- `src/components/atomic-crm/providers/supabase/resumePhotos.ts` — `uploadResumePhoto` widened.
- `src/components/atomic-crm/providers/fakerest/internal/resumes.ts` — FakeRest mirror widened.
- `src/components/atomic-crm/providers/fakerest/internal/resumePhotos.ts` — FakeRest mirror
  widened.
- `src/components/atomic-crm/types.ts` — `Resume.shidduchim_id` optional, `Resume.single_id`
  added.

**entity360 framework**
- `src/components/atomic-crm/entity360/ad24Conformance.ts` — 3 `singles` exemption rows
  deleted.
- `src/components/atomic-crm/entity360/registry.stubs.test.ts` — `singles` case updated to the
  migrated shape; header comment updated.
- `src/components/atomic-crm/entity360/entityPaths.ts` — doc comment example switched from
  `singles` (now migrated) to `shadchanim` (still a stub).
- `src/components/atomic-crm/entity360/routeConvention.routes.test.tsx` — the stale
  pre-migration "singles" assertion replaced with an AD-24-shaped one; `renderResourceAt` gained
  an optional `queryClient` parameter.
- `src/components/atomic-crm/entity360/routeConvention.redirect.test.tsx` — doc comment
  corrected (no longer claims `singlesDescriptor` is "the real stub").
- `src/components/atomic-crm/misc/EditSheet.test.tsx` — doc comment corrected.

**Framework (shared, broken by the migration itself)**
- `src/components/admin/edit-button.tsx` — doc-comment example switched to `shadchanim`.
- `src/components/admin/edit-button.test.tsx` — repointed to `shadchanimDescriptor` (still a
  stub) instead of the now-migrated `singlesDescriptor`.
- `src/components/admin/show-button.test.tsx` — same repointing.

**e2e**
- `e2e/global-search.spec.ts` — the `/singles/{id}/show` assertion (Epic-4 failure mode L15)
  fixed to the AD-24 shape.

**Generated**
- `registry.json` — regenerated (`make registry-gen`) to reflect the added/removed source
  files.
