# Story 3.3: Entity descriptor registry

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want each entity to declare its 360 rather than hand-roll it,
so that no entity drifts.

## Position in Epic 3

**3rd of 9. Depends on 3.1** (renders through `Entity360`) **and 3.2** (tab routing
comes from `buildEntityRoutes`/`Entity360Tabs`). **3.4-3.9 all depend on the
`EntityDescriptor` type this story defines** — 3.4 adds `minVisibility` to its tab/field
shape, 3.5-3.8 are the four tab kinds a descriptor's `tabs` array can reference, 3.9's
`RecordLink` resolves a record's path through this story's registry.

**Scope boundary — read before starting.** Same posture as 3.1/3.2. This story defines
the `EntityDescriptor` **contract**, the registry, and a generic `EntityShow` component
that renders a fully-wired `Entity360` from any registered descriptor — proven against a
fixture descriptor in tests. It does **not** register descriptors for `shidduchim`,
`singles`, `shadchanim` or `references` — populating a real entity's full descriptor
(avatar, meta, stats, tabs, actions, relationships) and pointing that entity's
`routeManifest.ts` entry at `buildEntityRoutes` is Epic 5's job, one story per entity
(5.1, 5.8, 5.9, 5.10). The one exception, scoped narrowly, is Story 3.9, which registers
only the *routing* half of a descriptor (not the full 360) for the four live entities so
`RecordLink` has something real to resolve today — see 3.9 for why that is not the same
as this epic doing Epic 5's job.

## Epic list AC vs. this story's actual scope — flagged, resolved here

The epic list's AC for this story reads: *"its 360 and list render entirely from that
declaration."* [Source: epics.md#Story-3.3] But `EntityList` (the list framework) is
explicitly **Epic 4 Story 4.1**'s deliverable, per the epic overview table itself (`UX-DR7`
→ Epic 4) [Source: epics.md#Epic-4-Navigation-Lists]. **Resolution:** this story defines
the descriptor fields both consumers need (`label`, `icon`, `route`, `avatar`, `title`,
`meta`, `stats`, `tabs`, `actions`, `relationships`) and proves the **360 half** renders
entirely from a descriptor. The **list half is delivered by no story currently written**:
Story 4.1's own Dev Notes state *"No entity descriptor integration … `EntityList`'s props
are the contract for now"* and defer descriptor consumption to *"a follow-up refactor"*
[Source: 4-1-entity-list-framework.md#Dev-Notes]. So AD-24's "list renders entirely from
the declaration" remains an open cross-epic gap after Epics 3 and 4 as storied — **flag
to the epic owner**: either a later story consumes `EntityDescriptor.label/icon/meta` in
`EntityList`'s retrofitted lists, or epics.md narrows the 3.3 AC. This story's job is
only to make that future consumption possible: the descriptor type carries the
list-relevant fields, and this story does not block on 4.1.

## Acceptance Criteria

1. **`EntityDescriptor` is a typed contract with two required fields and the rest
   optional.** `src/components/atomic-crm/entity360/entityDescriptor.ts` exports:
   ```ts
   interface EntityDescriptor<T extends RaRecord = RaRecord> {
     name: string;                 // matches routeManifest.ts's ResourceEntry.name (plural)
     buildRecordPath: (id: Identifier) => string;
     label?: string;
     icon?: LucideIcon;
     avatar?: (record: T) => { seed: string | null };
     title?: (record: T) => string;
     meta?: (record: T) => (string | null | undefined)[];
     stats?: (record: T) => { label: string; value: number; icon: LucideIcon; to?: string }[];
     tabs?: EntityTabDescriptor<T>[];
     actions?: (record: T) => ReactNode;
     relationships?: EntityRelationshipDescriptor[];
   }
   ```
   `name` and `buildRecordPath` are the only required fields — a descriptor with just
   those two is legal and is exactly what 3.9 registers for the four live entities (see
   "Scope boundary"). `EntityTabDescriptor<T> = { key: string; label: string; render:
   (record: T) => ReactNode }` — the optional `minVisibility` field 3.4 adds (to this
   shape and to the `stats` entry type) is additive, not a redesign.

2. **One registry, one lookup.** `registerEntityDescriptor(descriptor)` and
   `getEntityDescriptor(name): EntityDescriptor | undefined` are the only way to add to or
   read from the registry (a private `Map` keyed by `name`, not exported directly).
   Registering the same `name` twice throws — this is caught by a test — so no descriptor
   can silently shadow another's routing.

3. **`EntityShow` renders a complete 360 from a descriptor and nothing else.**
   `entity360/EntityShow.tsx` exports a component that takes `{ resource: string; record:
   T }` (or reads both from `ra-core` context when mounted inside a resource, matching
   the existing `useRecordContext()`/`useResourceContext()` pattern every current Show
   page already uses — see `singles/SingleShow.tsx`, `references/ReferenceShow.tsx`),
   looks up the descriptor via `getEntityDescriptor(resource)`, and renders `Entity360`
   with: `identityHeader` built from `avatar`/`title`/`meta`; `statBand` built from
   `stats` (each entry rendered as a `DashboardStat`, per 3.1 AC 6); `tabBar` +
   `children` built from `tabs` via `Entity360Tabs` (3.2); nothing else — **no field, tab
   or region is hard-coded per entity inside `EntityShow.tsx`.** A test with a fixture
   descriptor (name, title, one stat, two tabs) asserts the rendered output contains
   exactly the title, exactly one stat tile, and exactly two tabs — and a second test
   with a **different** fixture descriptor (different title, three tabs, no stats)
   asserts the differences without any change to `EntityShow.tsx` itself, proving the
   "entirely from that declaration" half of the AC for the 360 view.

4. **Missing optional fields degrade gracefully, never crash.** A fixture descriptor with
   only `name` + `buildRecordPath` (no `avatar`, no `stats`, no `tabs`) renders through
   `EntityShow` without a stat band, without a tab bar, and without throwing — this is the
   concrete proof of AD-24's "regions are optional per entity."

5. **No entity contains bespoke layout code (structural check).** A vitest `it` imports
   `EntityShow.tsx`'s source as text (Vite `?raw` import — the `app` project runs in a
   browser, so no shelling out; same mechanism as 3.1 AC 3) and asserts it contains no
   import path matching `/(shidduchim|singles|shadchanim|references)\//` — proving the
   generic renderer cannot special-case an entity by construction, not merely by
   convention.

## Tasks / Subtasks

- [ ] **Task 1 — `entityDescriptor.ts`** (AC: 1, 2)
  - [ ] Define `EntityDescriptor`, `EntityTabDescriptor`, `EntityRelationshipDescriptor`
        (a light `{ resource: string; foreignKey: string; label: string }` shape — only
        as much as Epic 5 needs to declare "this entity's suggestions/references live
        over there"; no relationship-rendering behaviour is built by this story).
  - [ ] Implement `registerEntityDescriptor` / `getEntityDescriptor` over a
        module-private `Map<string, EntityDescriptor>`; throw on duplicate `name`.
  - [ ] `entityDescriptor.test.ts`: register/lookup round-trip, duplicate-name throws,
        minimal descriptor (name + buildRecordPath only) is valid at the type level.

- [ ] **Task 2 — `EntityShow.tsx`** (AC: 3, 4, 5)
  - [ ] Build the component per AC 3: descriptor lookup, region composition, delegating
        tabs to `Entity360Tabs` (3.2) and the outer layout to `Entity360` (3.1).
  - [ ] `EntityShow.test.tsx`: the two-fixture comparison test (AC 3), the
        minimal-descriptor no-crash test (AC 4), and the import-boundary `?raw` test
        (AC 5).

- [ ] **Task 3 — Document the split with Epic 4** (AC: none — coordination)
  - [ ] Add a short doc comment atop `entityDescriptor.ts` stating that this type is
        AD-24's intended single source for list metadata (`label`/`icon`/`meta`) as well,
        that `EntityList` (Epic 4 Story 4.1) does **not** consume it yet, and that any
        future list-descriptor wiring must consume this type rather than redefine it — a
        forward pointer, not new code.

## Dev Notes

### Why the registry is separate from `routeManifest.ts`

`root/routeManifest.ts` (created by Epic 1 Story 1.5) answers *"is every registered
route reachable"* — its `ResourceEntry { name, surface, definition }` is deliberately
thin and framework-shaped (`definition` is `Omit<ResourceProps, "name">`, i.e. exactly
what `<Resource>` accepts) [Source:
_bmad-output/implementation-artifacts/1-5-remove-dead-routes.md#Task-1]. The
`EntityDescriptor` registry answers a different question — *"what does this entity's 360
look like"* — and is consumed **by** the route-builder (3.2's `buildEntityRoutes`) rather
than folded into it. Keeping them separate means Epic 1's manifest validator
(`findManifestViolations`) never needs to understand 360 semantics, and this registry
never needs to understand route reachability. When Epic 5 migrates an entity, it does
both: registers the full descriptor here, and points that entity's
`routeManifest.ts` `ResourceEntry.definition` at
`buildEntityRoutes({ Show: () => <EntityShow />, ... })`.

### The `name` vs. target-type distinction — a real gotcha, write it down

Resource names in `routeManifest.ts` are **plural** (`shidduchim`, `singles`,
`shadchanim`, `references`) — that is also `EntityDescriptor.name`. The polymorphic
`interactions`/`tasks` (and, from 3.7, `entity_files`) tables use a **singular**
`target_type` value (`shidduch`, `single`, `shadchan`, `reference`) — see
`01_tables.sql:525-527,134-136`. These are related but not interchangeable strings; a
descriptor's `tabs` entries that render 3.5-3.8's universal tab components must pass the
**singular** `target_type`, derived explicitly (e.g. a small
`ENTITY_NAME_TO_TARGET_TYPE` map, or a `targetType` field the future full descriptor
carries) — not assumed to equal `name` with the trailing letter stripped. This story does
not need to build that map (no real descriptor is registered yet), but Dev Notes for
3.5-3.8 and for Epic 5 point back here so the distinction is not rediscovered per-entity.

### Reuse already confirmed

`DashboardStat` (`dashboard/DashboardStat.tsx`) for `stats`, `EntityAvatar` (3.1) for
`avatar`, `Entity360`/`Entity360Tabs` (3.1/3.2) for layout and tab routing. `EntityShow`
composes these; it introduces no new visual primitive.

### Testing standard

AAA, `app` vitest project, fixture descriptors declared per-test (no shared mutable
registry state between tests — reset or use unique fixture `name`s per test to avoid the
duplicate-registration throw firing across unrelated tests)
[Source: .claude/rules/testing.md].

### Project Structure Notes

- `entity360/entityDescriptor.ts` and `entity360/EntityShow.tsx` are new, alongside
  `Entity360.tsx`, `Entity360Tabs.tsx`, `entityRoutes.tsx`, `avatar.ts`,
  `EntityAvatar.tsx` from 3.1/3.2. The directory is filling out exactly along
  feature lines, not growing one mega-file — keep each under ~300 lines.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.3]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4-Navigation-Lists — Story 4.1;
  _bmad-output/implementation-artifacts/4-1-entity-list-framework.md#Dev-Notes] — the
  cross-epic split this story documents rather than resolves unilaterally (4.1 explicitly
  declines descriptor integration as written)
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "an entity contributes a descriptor … and no
  bespoke layout code"
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md#Task-1] —
  `routeManifest.ts`'s `ResourceEntry`/`CustomRouteEntry` shape this registry sits beside
- [Source: supabase/schemas/01_tables.sql:134-136,525-527] — the singular `target_type`
  vocabulary vs. the plural resource-name vocabulary
- [Source: src/components/atomic-crm/dashboard/DashboardStat.tsx]
- [Source: 3-1-entity360-shell.md, 3-2-url-backed-tabs.md] — this epic's own prior
  stories, whose components this one wires together
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
