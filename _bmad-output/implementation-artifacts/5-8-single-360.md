# Story 5.8: Single 360

Status: ready-for-dev

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
   - `singles/index.ts` registers **`list: buildEntityRoutes({ List: SingleList, New:
     SingleCreate, Edit: SingleEdit, Show: EntityShow })`** plus explicit **`hasShow: true`** and
     **`hasEdit: true`**, and **drops** its own `show:` and `edit:` props
     (`singles/index.ts:18-20` today). It keeps `hasCreate: true` and keeps
     `children: buildCreateRoutes("singles")` — **called with no `New` argument**, since `New` now
     lives inside `buildEntityRoutes`; what remains in `children` is only the `/create` → `/new`
     compatibility redirect (`entity360/routeConvention.tsx:43-56`).
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
   `resource` **is** the link target here, so no `linkResource`/`linkId`/`linkLabel` is needed.
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

- [ ] **Task 1 — Confirm gates** (prerequisite)
  - [ ] Confirm Epic 3's shell/descriptor registry, `buildEntityRoutes` and universal tabs exist.
        Confirm Story 5.3 (`resumes` upload path) and Story 5.4 (`resume_photos`) have landed —
        this story extends both rather than reimplementing them.
- [ ] **Task 2 — Verify the polymorphic targets, do not migrate them** (AC: 1)
  - [ ] Run the AC-1 `pg_get_constraintdef` query; confirm the TypeScript unions
        (`Interaction.target_type`, `TaskTargetType` — both alias `EntityTargetType`,
        `types.ts:79-94`) already carry `"single"`. No schema or type change here.
  - [ ] Confirm 3.5's cross-account negative tests cover `target_type = 'single'`
        (`supabase/tests/interactions_targets.sql` + its runner); if that suite somehow lacks the
        case, extend it rather than writing a new style.
- [ ] **Task 3 — Extend `resumes` to a single** (AC: 2)
  - [ ] `01_tables.sql`: `alter column shidduchim_id drop not null`; add `single_id bigint`;
        composite FK `(account_id, single_id)` → `singles(account_id, id)` `on delete cascade`;
        drop `resumes_shidduchim_id_key`, add the two partial unique indexes; add
        `constraint resumes_owner_check check ((shidduchim_id is not null) <> (single_id is not null))`.
        Leave `resumes_account_id_id_key` alone (AC-2).
  - [ ] No view work: `grep -n "resumes" supabase/schemas/03_views.sql` returns nothing at HEAD —
        no view joins `resumes`, so no `security_invoker` or view grant is at risk. Re-run the
        grep rather than trusting this line.
  - [ ] Generate + hand-check migration (workflow below).
- [ ] **Task 4 — Generalise the Resume/Photo components** (AC: 3)
  - [ ] `resumes/ResumeVersionList.tsx`, `ResumeUpload.tsx`, `PhotoTab.tsx`: change their subject
        prop from a bare `shidduchimId: Identifier` to a discriminated union
        `{ shidduchimId: Identifier } | { singleId: Identifier }`, and thread it through to
        `add_resume_file` / `add_resume_photo` (Stories 5.3/5.4's RPCs) — update their SQL
        signatures to accept `p_single_id` as an alternative to `p_shidduchim_id` (same
        exactly-one-of check as the table).
  - [ ] **`06_grants.sql`:** changing an RPC's argument list changes its **signature**, so the
        migration is `DROP FUNCTION … ; CREATE FUNCTION …` — which **drops the function's
        grants**. Re-issue the `revoke all on function … from public, anon; grant execute … to
        authenticated; … to service_role;` triple for each changed RPC, following the pattern at
        `06_grants.sql:291-293` and `:334-336`. Function grants live in `06_grants.sql`, never in
        `02_functions.sql`.
- [ ] **Task 5 — Mount `singles` on the AD-24 route shape** (AC: 4, 5)
  - [ ] `singles/index.ts`: adopt `buildEntityRoutes` + explicit `hasShow`/`hasEdit`, drop
        `show:`/`edit:`, keep `hasCreate: true` and `children: buildCreateRoutes("singles")` with
        no `New` argument. Keep `import "./entityDescriptor";` as the first line
        (`entity360/entityDescriptor.ts:29-36`).
  - [ ] Delete the three exemption rows named in AC-5, in this same diff.
  - [ ] Run `findAd24Violations` against the real manifest — it must return `[]`.
- [ ] **Task 6 — Single descriptor and tabs** (AC: 6, 7, 8, 9)
  - [ ] **Edit `singles/entityDescriptor.ts` in place**, keeping exactly **one**
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
  - [ ] Flip `buildRecordPath` per AC-4; declare all eight tabs in canonical order; set
        `pendingTabs: []`.
  - [ ] Add the `identityHeader` adapter and re-home `SingleProfileHeader` per AC-9; delete
        `SingleShow.tsx` and repoint `SingleProfileHeader.test.tsx:5`.
  - [ ] Add **no** `label` overrides. All eight labels already ship
        (`entity360/tabKeys.ts:42-58`, `englishCrmMessages.ts:382-398`); an override needs a
        "why THAT entity deviates" comment (`entityDescriptor.ts:97-104`) for a deviation that
        does not exist. **Epic 5 adds no `crm.entity360.tab.*` keys.**
  - [ ] Overview: `render` is arity-zero and reaches the record via `useRecordContext<Single>()`.
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
  - [ ] Shidduchim tab: the explicit `tabs` entry at position 5 rendering
        `<RelatedRecordsTab relationship={…}/>` per AC-8.
  - [ ] Files / Notes / Tasks / Activity: mount Epic 3's universal components with
        `targetType="single"` + `targetId` (AC-7).
  - [ ] `entity360/registry.stubs.test.ts`: update the pinned `singles` row (AC-6).
- [ ] **Task 7 — Lockstep and generated artifacts**
  - [ ] `types.ts`: `Resume` gains `single_id` and `shidduchim_id` becomes nullable.
  - [ ] FakeRest per AD-10: `providers/fakerest/dataProvider.ts`, the resumes generator, and
        `providers/fakerest/internal/accountDomainData.ts` (`resumes` is already in
        `DOMAIN_RESOURCES`, `:19-32` — verify it still reads correctly with a single-owned
        resume). Also verify `providers/fakerest/internal/removePersona.ts`, whose single-archive
        path runs through the same domain-data check; record "no change needed" in the File List
        rather than silently omitting it.
  - [ ] `supabase/tests/`: a new `.sql` suite for AC-2's negative cases needs a **paired
        `.test.ts` runner** — every `.sql` suite has one, 13 pairs at HEAD, no exceptions.
        Alternatively extend an existing pair.
  - [ ] `registry.json`: this story adds (`SingleProfileHeader.tsx`) and deletes
        (`SingleShow.tsx`) non-test source files under `src/components/atomic-crm/`, so
        `scripts/generate-registry.mjs` output changes. `.husky/pre-commit` regenerates it; commit
        the result.
  - [ ] `e2e/entity-list-view-toggle.spec.ts` drives `/#/singles` — the list route now resolves
        through `buildEntityRoutes`' `index` route rather than `<Resource>`'s `/*` catch-all.
        **Run the e2e suite at least once in this story's wave**; a path/route change that reaches
        e2e is the Epic-4 failure mode, and the unit suite does not cover it.
- [ ] **Task 8 — Verify**
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
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

### Debug Log References

### Completion Notes List

### File List
