# Story 5.10: Reference 360 and per-shidduch diligence

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want diligence to live under the shidduch it is about,
so that a reference is never orphaned from its context.

## Position in Epic 5

Depends on **5.1** (the shidduch's `diligence` tab already holds `ShidduchReferencesSection.tsx`,
unchanged, per 5.1 Task 3) and **Epic 3** (shell, URL-backed tabs, universal Notes/Tasks/Activity
— this story deletes the reference-specific components those universal tabs make redundant).
Runs **after 5.9 and before 5.11**, serially: 5-8, 5-9 and 5-10 all write
`entity360/{ad24Conformance.ts, registry.stubs.test.ts}`, `types.ts` and `registry.json`, and the
AD-24 exemption checks are symmetric — so the loser of a concurrent edit fails the build on an
*innocent* story.

## This story absorbs RULING 7 R2 (`/references`) — and it has no choice

**The gap is live on `main` today.** `/references` renders `ReferenceList.tsx`: a search box,
three filters, sort, pagination, a `CreateButton`, and every reference in the account — a full
browse surface for the one entity whose browse surface RULING 7 forbids. R1 (shidduch-scoped
creation), R3 (nav / dashboard / tour) and R6 (MCP) are all closed; **R2 is not.**

It lands here rather than in a new story for a structural reason, not for tidiness:
`buildEntityRoutes`' config types `List: ComponentType` as **required**
(`entity360/buildEntityRoutes.tsx:8`) and its `index` route renders it (`:67`). AC-4's route
migration therefore cannot be written without deciding what `/references` renders. The decision
is already inside this story's blast radius; splitting it across two owners is the exact failure
`.claude/rules/parallel-ownership.md` names.

**Worse, the AD-24 guard is green over the violation.** `ad24Conformance.ts:691-692` clause (c)
does `if (resource.name in noBrowseSurfaceEntities) continue;` — it skips the one entity whose
list is forbidden, so a browse surface at `/references` produces no violation. Clause (b) only
matches a `buildListPath("references")` **literal** (`:640-641`) and therefore cannot see
`RecordUnavailable.tsx:37`'s `buildListPath(resource)` or `routeConvention.tsx:88`'s — two live
in-app routes to the browse surface. `ad24Conformance.guard.test.ts:356-361` asserts *"RULING 7
is fully applied on main"* and passes. **Do not read that green as coverage** — closing the blind
spot is part of this story (AC-8).

**In scope here (from RULING 7):** R2 (the unattached-references panel + deleting
`ReferenceList.tsx`) and R8 (`browsable?: false` on the descriptor + its two consumers), because
both live in files this story already opens (`references/**`, `entity360/**`).
**Explicitly NOT in scope, and each still needs an owner:** R4 (`reminders/reminderEntity.ts:24`
still lists `"reference"` in `LINKABLE_TARGET_TYPES` and `ReminderCreateSheet.tsx:49-53` still
does an unscoped `useGetList(…, { perPage: 100 })` — a live 100-row reference roster with no
shidduch in scope), R5 (the `crm.references.list.*` and reference filter-label i18n keys), and
R7's schema hardening (the `create_reference_for_shidduch` RPC, the `before delete` guard on
`shidduchim`, the `reference_links` scope constraint). All three belong to the S16 wave. Naming
them here so they are not lost, **not** so they get pulled in.

## Most of the diligence half already exists

`references/ShidduchReferencesSection.tsx` (relocated into the shidduch's `diligence` tab by
Story 5.1) already renders "N of M conversations done" and a per-reference list with call
status. This story's only addition to it is the **"first conversation or one of several"**
indicator per epic AC — which is a direct reuse of logic that already exists one file over:
`references/RepeatRecognitionPanel.tsx` already computes exactly this
(`others = links.filter(link => link.shidduchim_id != null && link.shidduchim_id !==
excludeShidduchimId)`; `others.length === 0` ⇒ first conversation). Extract that predicate into
a small shared helper (e.g. `references/repeatRecognition.ts`,
`countOtherConversations(links, excludeShidduchimId)`) used by **both**
`RepeatRecognitionPanel.tsx` and the new indicator in `ShidduchReferencesSection.tsx` — do not
duplicate the filter.

## The Reference 360 itself: migrate an existing page, and remove a real duplication

`ReferenceShow.tsx` is already a full `<Show>` page with its own (non-URL-backed) `Tabs`:
Conversations, Timeline and notes, Reminders, Assistant. This story migrates it onto the
`Entity360` shell with Story 3.2's URL-backed tabs, and — in the same pass — **removes a genuine
duplication** that migration exposes: `ReferenceTimeline.tsx` already mixes two things Epic 3
now provides as separate universal tabs (Notes and Activity), and `ReferenceTasks.tsx` is a
bespoke reminders implementation Epic 3's universal Tasks tab supersedes. Keeping all three
alongside the new universal tabs would be two ways to do the same thing (violates the
"Single-owner rule" in
`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`'s
Design Paradigm section) — so this story retires them.

**One deliberate behaviour simplification, stated so it is not mistaken for a regression:**
`ReferenceTimeline.tsx`'s `AddNote` lets a note be scoped either "generally" or "about a specific
shidduch" (via a `<select>` over that reference's links). The "about a specific shidduch" case is
redundant with diligence's own call-log mechanism (`CallCaptureSheet`/`reference_links.what_they_said`/
`conversation_log`), which already captures per-shidduch commentary about a reference in its
proper place — under that shidduch's own Diligence tab, not the reference's general Notes. This
story's migration to the universal Notes tab keeps only the "general note about this person"
case; per-shidduch commentary continues to live in the call log, where it already belongs. This
removes a second way to record the same kind of information, per NFR-14 — it does not remove any
information that has nowhere else to go.

## Acceptance Criteria

1. **Given** a shidduch, **when** I open its Diligence tab, **then** I see people to speak to
   with progress ("N of M spoken to") — unchanged, already built.
2. **Given** each reference row in the Diligence tab, **when** it renders, **then** it states
   whether this is a first conversation or one of several (via the shared
   `countOtherConversations` helper, excluding the current shidduch).
3. **Given** a reference, **when** I open their own record, **then** it is reached **from a
   shidduch's diligence** — never from primary navigation, never from a list, never from an
   `EntityList`, and **never from search**. The original wording of this AC read "reached from
   diligence **or search**"; that is a defect. RULING 7 clause 1 (`epics.md:132-135`) says
   *"References also leave global search: a global search that returns reference records is a
   browse surface under another name"*, and this story's own epic AC (`epics.md:869`) already
   reads *"never from navigation, a list or search"*. The clause has been rewritten, not
   softened. **Removing references from the search fan-out is 4-5's work, not this story's** —
   do not edit `4-5`'s implementation from here; just do not license it.
   Concretely, after this story:
   - `PRIMARY_NAV` still has no `/references` entry — Story 4.4 removed it and
     `layout/navItems.test.ts:36` already asserts no entry's `to` starts with `/references/`.
     Confirm it still passes; do not add it back.
   - `references/index.ts` mounts **no browse surface**: no `EntityList`, no search input, no
     filters, no sort control, no pagination, no `CreateButton`. `/references` resolves to the
     unattached-references panel of AC-7 and nothing else.
   - `NO_BROWSE_SURFACE_ENTITIES.references` (`entity360/ad24Conformance.ts:201-204`) **stays**.
     It is a standing owner ruling with no retiring story; AC-8 *adds* checks around it, it does
     not remove the entry.
   **Failing looks like:** `grep -rn 'to="/references"' src/` returns a hit, or the rendered
   `/references` route shows a search box.
4. **Given** a reference's own record, **when** it renders, **then** it is on the `Entity360`
   shell at `/references/{id}/{tab}` with URL-backed tabs in UX-DR5's order plus one
   entity-specific extra: `overview, conversations, shidduchim, notes, tasks, activity,
   assistant` — the canonical reference tab set and order. The tab **key** for the reference's
   linked shidduchim is `shidduchim` (label "Shidduchim"), from the closed `TabKey` union in
   `entity360/tabKeys.ts`; `linked-shidduchim` is not a member of that union and does not
   typecheck. `conversations` is a **different** key and stays: it is the reference **call log**,
   not a list of shidduchim and not an Epic 7 thread panel — the two are not interchangeable.
   `overview` holds the identity facts currently in `ReferenceShow.tsx`'s internal
   `ReferenceHeader` component (relationship, phone, school, grad year); `conversations` is the
   existing `RepeatRecognitionPanel` + `ReferenceCallLog`, unchanged; `shidduchim` is
   UX-DR5's required tab — the reference's `reference_links_summary` rows, each a `RecordLink`
   to its shidduch (a plain list; no call-log detail, which stays in `conversations`);
   `assistant` is the existing `ResearchAssistantPanel`, unchanged (still AI-entitlement-gated)
   — an entity-specific tab justified by UX-DR4's "entity-specific tabs are the exception, not
   the rule" clause, since the matrix predates the shipped assistant panel.
   All seven keys move **out of `pendingTabs` and into `tabs` in this same diff** (the stub is
   `tabs: []` + a full 7-key `pendingTabs`, `references/entityDescriptor.ts:21-30`), leaving
   `pendingTabs` empty or absent: the validator asserts `keys(tabs) ∪ pendingTabs` equals
   `CANONICAL_TAB_SETS.references` (`ad24Conformance.ts:240-248`) **as sets**, so a key in both
   is `tab-key-duplicated` and a key in neither is a missing tab — either fails the build. Do
   **not** set an explicit `label` on `shidduchim`: "Shidduchim" is already the i18n default
   (`tabKeys.ts:54`).
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#3 — the `TabKey` union, the
   drift-closing ruling table (`conversations` kept and distinct), and rule 5's per-entity tab
   sets]
   **This is not a `buildRecordPath` one-liner.** `references/index.ts:18-20` declares
   `list: ReferenceList`, `show: ReferenceShow`, `edit: ReferenceEdit`, and `ra-core` maps
   `edit` to the route `":id/*"` (`ra-core/dist/core/Resource.js:11-15`) — so the moment
   `buildRecordPath` emits `/references/{id}`, **`ReferenceEdit` renders where the 360 should
   be**: no error, no red test, a wrong page, and this AC unsatisfiable while the suite is
   green. In one diff:
   - `references/entityDescriptor.ts:20`: `buildRecordPath` → ``(id) => `/references/${id}` ``,
     re-registered with `registerEntityDescriptor(referencesDescriptor, { replace: true })`
     (without `{ replace: true }` `registry.ts:29-33` **throws at module scope**).
   - `references/index.ts`: `list: buildEntityRoutes({ List: ReferencesIndex, Edit:
     ReferenceEdit, Show: EntityShow })`, **drop** `show:` and `edit:`, **add** explicit
     `hasShow: true` / `hasEdit: true` (`ra-core` computes both from the dropped props
     otherwise, and every inferred record link stops resolving —
     `entity360/buildEntityRoutes.tsx:43-54`). Keep `hasCreate: true`,
     `children: buildCreateRoutes("references", ReferenceCreate)` — **`ReferenceCreate` stays
     there; pass no `New` to `buildEntityRoutes`.** (5.1 and 5.8 move `New` inside
     `buildEntityRoutes` instead and drop that second argument; either is valid, but doing both
     declares `/references/new` twice.) Keep `recordRepresentation`, and
     `import "./entityDescriptor";` as line 1 — that side-effect import is the **only** thing
     that registers the descriptor, and `root/routeManifest.ts:10` is its only importer.
   - `entity360/ad24Conformance.ts`: delete `RECORD_SURFACE_EXEMPTIONS["references:show"]` and
     `["references:edit"]` (`:125-126`) and `PENDING_ROUTE_SHAPES.references` (`:173`) in the
     same diff — the tables are symmetric, so leaving a row whose offender is gone fires
     `stale-exemption` and removing the offender without the row fires the mirror.
   - retarget every literal pinning the old path: `entity360/registry.stubs.test.ts:93`
     (`/references/1/show`), `:94` (`tabs toEqual []`), `:68-79`+`:95` (the 7-key `pendingTabs`
     row), and `references/ReferenceCreate.test.tsx:150` and `:176`
     (`expect.poll(() => getPathname()).toBe("/references/100/show")` — the post-create redirect
     assertions, which no story currently declares).
   **Failing looks like:** navigating to `/references/1/overview` renders a form with a Save
   button; or `findAd24Violations` against the real manifest returns a non-empty array.
5. **Given** the migration to universal tabs, **when** it completes, **then**
   `ReferenceTimeline.tsx` and `ReferenceTasks.tsx` are deleted — their general-note and
   task-add/toggle behaviour now lives in Epic 3's universal Notes/Tasks components, and no
   second implementation of either remains. The per-shidduch note selector described above is
   not carried forward (per the stated simplification).
   **Failing looks like:** `make typecheck` errors on `ReferenceHeader.test.tsx:7`
   (`import { ReferenceHeader } from "./ReferenceShow";` — the header export must be re-homed
   before `ReferenceShow.tsx` is gutted), or on a dangling import of either deleted module.
6. **Given** the reference merge action, **when** it runs after this story, **then**
   `ReferenceMergeButton.tsx` still works unchanged — this story does not touch merge logic.
   Its candidate picker queries the **resource**, not the route, so replacing the list cannot
   break it; its post-merge redirect targets the record, which now resolves through the flipped
   `buildRecordPath`.
7. **Given** RULING 7 R2, **when** I open `/references`, **then** I see the
   **unattached-references panel** — `ReferencesIndex.tsx`, showing only references with
   `linked_shidduchim_count@eq: 0`, each row a `RecordLink` plus an inline
   `ReferenceAttachToShidduch` action; no search box, no filters, no sort, no pagination, no
   `CreateButton`, no unfiltered set. When it is empty it renders the "references are reached
   from a shidduch" explainer with a link to `/shidduchim`. `ReferenceList.tsx` is **deleted**
   (all ~200 lines: `referenceFilters`, `ReferenceListActions`, `ReferenceRow`,
   `ReferenceListHeader`, `ReferenceListLayout`).
   This is not a loophole: a reference with zero shidduchim has by definition *no shidduch
   context to be reached from*, so the ruling's own premise does not reach it. The panel is
   **self-emptying** — R1 already closed orphan creation (`ReferenceCreate.tsx` refuses without
   a resolvable `?shidduchim_id=`), so once each existing orphan is attached it stays empty
   permanently. It is also the only honest answer for a class of records that is counted in
   `PrivacySection`, included in the GDPR export, and otherwise openable by nobody.
   **Failing looks like:** `ReferencesIndex` issues a `getList("references")` with no
   `linked_shidduchim_count@eq` filter, or a reference that *is* linked to a shidduch appears
   in the panel.
8. **Given** the AD-24 guard, **when** it runs after this story, **then** it can no longer be
   green over a live browse surface on a no-browse entity. Two widenings, both **additive**:
   - clause (c) (`ad24Conformance.ts:688-699`) currently does
     `if (resource.name in noBrowseSurfaceEntities) continue;` — skipping the one entity the
     rule exists for. Replace the skip with a positive assertion: a no-browse entity's `list`
     **must be** its declared index panel, never an `EntityList`-shaped browse surface.
   - clause (b)'s matcher (`findListPathLinks`, `:629-647`) matches only a literal
     `buildListPath("references")`. Widen it to catch **variable-argument**
     `buildListPath(<identifier>)` sites, which is how the two live ones are written:
     `entity360/RecordUnavailable.tsx:37` and `entity360/routeConvention.tsx:88`.
   Both call sites are then fixed by R8's descriptor field (AC-9), not by suppressing the rule.
   **Failing looks like:** re-pointing `references/index.ts` back at `ReferenceList` and
   re-running `npx vitest run src/components/atomic-crm/entity360` still passes.
9. **Given** RULING 7 R8, **when** `RecordUnavailable` or `redirectToRecord` needs a fallback
   destination for a no-browse entity, **then** it resolves to `/` and not to the unattached
   panel. Mechanism: one new optional `EntityDescriptor` field, `browsable?: false`
   (`entity360/entityDescriptor.ts`), set on the `references` descriptor and consulted by both
   `RecordUnavailable.tsx:37` and `routeConvention.tsx:88`. One field, additive, two consumers —
   do **not** make `buildEntityRoutes`' `List` optional instead: this story passes
   `ReferencesIndex`, so that change would have no consumer (YAGNI). `RecordUnavailable`'s link
   text ("Back to the list", `crm.entity360.record_unavailable_link`) must change with the
   destination — a link to `/` labelled "Back to the list" is worse than the bug.
   **Failing looks like:** the "Back to the list" link on an unavailable reference lands on the
   orphan panel.

## Tasks / Subtasks

- [ ] **Task 1 — Shared reuse-awareness helper** (AC: 2)
  - [ ] Extract `countOtherConversations(links: ReferenceLinkSummary[], excludeShidduchimId?:
        Identifier | null): number` into a new small module (e.g.
        `references/repeatRecognition.ts`), pulling the exact filter predicate out of
        `RepeatRecognitionPanel.tsx` (its `others` computation).
  - [ ] Update `RepeatRecognitionPanel.tsx` to use the extracted helper (no behaviour change —
        verify its existing tests still pass unchanged).
- [ ] **Task 2 — Enrich the Diligence tab** (AC: 1, 2)
  - [ ] In `ShidduchReferencesSection.tsx`, add a small "first conversation" / "one of several"
        label per row, computed via the Task 1 helper.
  - [ ] **Decided at planning time — no schema change.** The section already holds this
        shidduch's `reference_links` rows (`ShidduchReferencesSection.tsx:27-31`); collect their
        `reference_id`s and issue **one** batched
        `useGetList<ReferenceSummary>("references", { filter: { "id@in": \`(${ids.join(",")})\` },
        pagination: { page: 1, perPage: 50 } })`. Both providers already map
        `getList("references")` onto `references_summary`
        (`providers/supabase/dataProvider.ts:105-109`, `providers/fakerest/dataProvider.ts:589-594`),
        which **already carries `linked_shidduchim_count`** (`03_views.sql:115`). "One of several"
        is `linked_shidduchim_count > 1`; "first conversation" is `<= 1`. The `id@in` operator is
        supported by `ra-data-postgrest` and by the FakeRest adapter
        (`providers/fakerest/internal/transformInFilter.ts`).
        **Rejected: adding `linked_shidduchim_count` to `reference_links_summary`.** The column
        does not exist there (`03_views.sql:133-160`) and adding it drags in a migration,
        a `06_grants.sql` re-check, `types.ts#ReferenceLinkSummary`, both
        `providers/fakerest/internal/{referenceSummary,referenceLinks}.ts` mirrors and
        `dataProvider.summaryStats.test.ts` — a five-file cascade to duplicate a column that
        already exists one view over.
        **Rejected: an N+1 `useReferenceLinks` per row.** Same answer, N queries.
        **Consequence, stated so the wave planner can use it: this story is now schema-free.**
        It needs no `supabase/**` edit and no migration lease. If a generated migration appears
        in this story's diff, something went wrong — most likely R7 (see "Position in Epic 5")
        being pulled in.
- [ ] **Task 3 — Reference descriptor and shell migration** (AC: 3, 4)
  - [ ] Re-register the `references` descriptor over 3.9's stub with
        `registerEntityDescriptor(referencesDescriptor, { replace: true })` — the whole
        descriptor, not a partial merge; without `{ replace: true }` it **throws at module
        scope** (`entity360/registry.ts:29-33`). Tabs `overview, conversations, shidduchim,
        notes, tasks, activity, assistant`, in that order (keys from `entity360/tabKeys.ts`);
        `buildRecordPath` → ``(id) => `/references/${id}` ``.
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4 — rule 2]
  - [ ] **Move all seven keys out of `pendingTabs` into `tabs` in this same edit**
        (`references/entityDescriptor.ts:21-30`), and retarget `entity360/registry.stubs.test.ts`'s
        pinned references row (`:68-79`, `:93-95`) — it pins the `/show` path, `tabs toEqual []`
        **and** the full `pendingTabs` list, so all three assertions go red by design.
  - [ ] `references/index.ts`: `list: buildEntityRoutes({ List: ReferencesIndex, Edit:
        ReferenceEdit, Show: EntityShow })`; **delete** `show:` and `edit:`; **add**
        `hasShow: true` / `hasEdit: true`. Keep `hasCreate: true`, `children:
        buildCreateRoutes("references", ReferenceCreate)`, `recordRepresentation`, and
        `import "./entityDescriptor";` as line 1. `ReferencesIndex` comes from Task 6.
  - [ ] `entity360/ad24Conformance.ts`: delete `RECORD_SURFACE_EXEMPTIONS["references:show"]`
        and `["references:edit"]` (`:125-126`) and `PENDING_ROUTE_SHAPES.references` (`:173`) in
        the same diff (symmetric tables — see AC-4). **Do not remove
        `NO_BROWSE_SURFACE_ENTITIES.references`** (`:201-204`): standing owner ruling, no
        retiring story.
  - [ ] Extract the identity-fact block (relationship/phone/school/grad_year) from
        `ReferenceShow.tsx`'s internal `ReferenceHeader` (`:34-42`, `:57-73`) into an `overview`
        tab; keep contact-style facts (name, avatar) in the shell's identity header region.
        **Two things this forces, neither of which any story currently declares:**
        (a) `ReferenceHeader` is `({ reference }: { reference: Reference })` — `identityHeader`
        is `ComponentType<{ record: T }>` (`entity360/entityDescriptor.ts:57`), so it needs a
        one-line `({ record }) => <ReferenceHeader reference={record} />` adapter in the
        descriptor module (same class of shim as 5-8's `{ single }` and 5-9's `{ shadchan }`);
        (b) `references/ReferenceHeader.test.tsx:7` does
        `import { ReferenceHeader } from "./ReferenceShow";` — re-home the export (its own home
        file, or the descriptor module) and update that import **in the same diff**, or
        `make typecheck` breaks outright.
  - [ ] Wire `conversations` to the existing `RepeatRecognitionPanel` + `ReferenceCallLog`
        (unchanged); wire `assistant` to the existing `ResearchAssistantPanel` (unchanged).
        Re-homing `ResearchAssistantPanel` — if the migration moves it — does **not** affect the
        entitlement guard: `references/entitlementGate.guard.test.ts:16` globs `../**/*.{ts,tsx}`
        and keys its `ALLOWED` set by **basename** (`:26-30`).
  - [ ] Do **not** hand-roll the `shidduchim` list — Epic 3 ships the renderer at
        `entity360/tabs/RelatedRecordsTab.tsx`, whose own doc names this story by number as a
        reuser (`:24-27`). But do **not** declare it as a `relationships` entry either:
        `entity360/mergeEntityTabs.tsx:79-91` **appends** every relationship-derived tab after
        every explicit `tabs` entry, so `shidduchim` would render **last** instead of third, and
        `tab-order-drift` reads the *declaration*, not the render, so the validator will not
        catch it — it ships silent. `mergeEntityTabs.tsx:55-76` names this exact case verbatim
        and prescribes the fix. **Declare an explicit `tabs` entry at position 3 that renders
        `<RelatedRecordsTab relationship={…}/>` itself:**

        ```ts
        const referenceShidduchim: EntityRelationshipDescriptor = {
          key: "shidduchim",
          resource: "reference_links_summary",
          getFilter: (r) => ({ reference_id: r.id, "shidduchim_id@not.is": null }),
          linkResource: "shidduchim",
          linkId: (row) => row.shidduchim_id,
          linkLabel: (row) => row.shidduch_name_en,
        };
        // …then, third in `tabs`:
        { key: "shidduchim", render: () => <RelatedRecordsTab relationship={referenceShidduchim} /> }
        ```

        **`linkLabel` is mandatory, not optional.** `entity360/relationshipDescriptor.ts:22-25`:
        *"a relationship whose `linkResource` differs from its `resource` MUST supply
        `linkLabel`"* — the queried row is a link/summary row, so `shidduchim`'
        `recordRepresentation` will not resolve against it and every row renders an unresolved
        label. `shidduch_name_en` is the column (`03_views.sql:150`), and it is exactly what
        `relationshipDescriptor.ts:35-42`'s worked example uses.
        **Filter out null `shidduchim_id`.** The column is nullable
        (`reference_links.shidduchim_id`, `01_tables.sql`), and `RepeatRecognitionPanel.tsx:36-39`
        and `ReferenceCallLog.tsx:42` already guard it; an unguarded row renders a `RecordLink` to
        `/shidduchim/null`.
        **Column-name check:** the contract's worked example writes `row.shidduch_id`; the
        verified column is **`shidduchim_id`** (`supabase/schemas/03_views.sql:139`). Use
        `shidduchim_id`. Empty / loading / error states belong to `RelatedRecordsTab`, not to
        this story (UX-DR11).
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#9]
  - [ ] Wire `notes`/`tasks`/`activity` to Epic 3's universal components. The prop shape is
        `UniversalTabProps = { targetType, targetId }` (`entity360/tabs/types.ts:11-14`) —
        **`targetType`, camelCase, plus the required `targetId`**, never the DB's `target_type`.
        e.g. `render: () => <NotesTab targetType="reference" targetId={record.id} />` (the
        record is reached inside `render` via `useRecordContext()`; `render` is arity-zero,
        `entityDescriptor.ts:106-112`).
  - [ ] Confirm `layout/navItems.ts`'s `PRIMARY_NAV` is untouched by this story (AC-3) — Story
        4.4's `navItems.test.ts:36` already pins `/references` absent; just confirm it still
        passes.
- [ ] **Task 4 — Retire the superseded components** (AC: 5)
  - [ ] Delete `references/ReferenceTimeline.tsx` and `references/ReferenceTasks.tsx` once the
        universal tabs cover their behaviour per AC-5's stated simplification.
  - [ ] `grep -rn "ReferenceTimeline\|ReferenceTasks" src/` currently returns **7 files**, and
        four of them are prose comments *outside* `references/`, so the grep cannot come back
        clean without editing them: `entity360/tabs/interactionLabels.ts:9,26,34`,
        `entity360/tabs/interactionLabels.test.ts:64`, `entity360/tabs/TasksTab.tsx:22,25`
        (whose comment says `ReferenceTasks.tsx` "stays live" — that becomes false here), and
        `providers/commons/englishCrmMessages.ts:414` (the comment names **both**
        `ShidduchTimeline.tsx` and `ReferenceTimeline.tsx`, which is why 5-1, 5-2 and 5-10 all
        land on the same line). **Contention note:** 5-1 also scrubs
        `interactionLabels.ts` and 5-2 holds the i18n-catalogue lease in Wave A; if either has
        already landed its scrub, verify rather than re-edit.
  - [ ] Delete `ReferenceShow.tsx`'s bespoke `Tabs`/`TabsList`/`TabsContent` block once its
        content is relocated onto the shell — and the `activeTabClassName` const (`:19-20`) and
        the `@/components/ui/tabs` import (`:5`) with it. Re-home the `ReferenceHeader` export
        first (Task 3).
- [ ] **Task 5 — Verify** (AC: 6)
  - [ ] Confirm `ReferenceMergeButton.tsx` and `ReferenceMergeCollision.tsx` are unaffected — no
        edits to merge logic in this story.
  - [ ] `npm run typecheck && npm run lint && npx vitest run && npm run build`. **No
        `test:unit:db` run is needed** — Task 2's decision leaves this story schema-free.
- [ ] **Task 6 — RULING 7 R2: `/references` becomes the unattached-references panel** (AC: 3, 7)
  - [ ] New `references/ReferencesIndex.tsx`:
        `useGetList("references", { filter: { "linked_shidduchim_count@eq": 0 }, pagination:
        { page: 1, perPage: 50 } })`; each row a `RecordLink` plus an inline
        `ReferenceAttachToShidduch`. **No** `SearchInput`, no `SelectInput`/`TextInput` filters,
        no sort control, no pagination controls, no `CreateButton`. Empty state: the "references
        are reached from a shidduch" explainer with a link to `/shidduchim`.
  - [ ] New `references/ReferenceAttachToShidduch.tsx`: a shidduch picker calling the existing
        `dataProvider.linkReferenceToShidduch({ reference_id, shidduchim_id })` (idempotent —
        `02_functions.sql:2254-2263` returns the existing link). It is the **only** way an
        orphan surfaced by the panel can be resolved, and it is reused by the 360 (render it in
        the reference's actions region when `useReferenceLinks(record.id).links.length === 0`,
        and only then). **One mechanism, one component** — do not hand-roll a second attach
        affordance inside `ReferencesIndex`.
  - [ ] Delete `references/ReferenceList.tsx` (~200 lines: `referenceFilters` `:25-40`,
        `ReferenceListActions` `:42-46`, `ReferenceRow`, `ReferenceListHeader`,
        `ReferenceListLayout`). Its `buildNewPath("references")` CTA (`:185`) dies with it —
        that is Story 3-12's site 6, which goes green by deletion rather than migration.
  - [ ] New `references/ReferencesIndex.test.tsx`: asserts the `linked_shidduchim_count@eq: 0`
        filter is applied and that a reference **with** links never renders.
- [ ] **Task 7 — RULING 7 R8 + close the guard blind spot** (AC: 8, 9)
  - [ ] `entity360/entityDescriptor.ts`: add one optional field, `browsable?: false`, with a
        doc comment naming RULING 7. Set it on the `references` descriptor. Additive only — do
        **not** add an eighth `Entity360` prop, and do **not** make `buildEntityRoutes`' `List`
        optional (this story passes `ReferencesIndex`, so there is no consumer).
  - [ ] `entity360/RecordUnavailable.tsx:37` and `entity360/routeConvention.tsx:88`: consult the
        descriptor and fall back to `/` for a non-browsable entity instead of
        `buildListPath(resource)`. Update `RecordUnavailable`'s link label with it.
  - [ ] `entity360/ad24Conformance.ts`: widen the two rules per AC-8 — clause (c) (`:688-699`)
        asserts a no-browse entity's list **is** its declared index panel instead of `continue`;
        `findListPathLinks` (`:629-647`) also matches variable-argument `buildListPath(<ident>)`
        call sites. Extend `ad24Conformance.test.ts`'s fixture-driven cases for both (the
        validator is a pure function over manifests — every rule already has a one-fixture
        case), and re-run `ad24Conformance.guard.test.ts`, whose `:356-361` assertion is the one
        that was green over this violation.

## Dev Notes

### AC-4 is a route migration, not a `buildRecordPath` flip

The most expensive mistake available here, and the same one 5-1, 5-8 and 5-9 each carry.
`references/index.ts:18-20` declares `list: ReferenceList`, `show: ReferenceShow`,
`edit: ReferenceEdit`. `ra-core` maps a resource's `edit` prop to the route `":id/*"`
(`ra-core/dist/core/Resource.js:11-15`), so the moment `buildRecordPath` emits
`/references/{id}`, `/references/{id}/overview` is swallowed by that wildcard and
**`ReferenceEdit` renders where the 360 should be** — no error, no red test, a wrong page.

The fix is `list: buildEntityRoutes({ …, Show: EntityShow })` **plus explicit `hasShow` /
`hasEdit`**, with `show:`/`edit:` dropped — the shape `entity360/buildEntityRoutes.tsx:43-54`
spells out as the REGISTRATION RULE. Note what `list` means there: it is the **route mount
point**, not "the list page". `buildEntityRoutes` puts `index`, `new`, `:id/edit`, `:id` and
`:id/:tab` inside one `<Routes>` that *is* the element passed to `<Resource list={…}>`
(`:60-91`). Dropping `list` from `references/index.ts` would therefore delete `/references/:id`
along with the list — which is why RULING 7 keeps the prop and points it at `ReferencesIndex`
(Task 6) rather than removing it.

**Assert it, don't assume it:** a navigation test that lands on `/references/{id}/overview` and
finds the `Entity360` tab strip (not a Save button), and `findAd24Violations` against the real
manifest returning `[]`.

### Adapter wrapper for `ReferenceHeader`

`identityHeader` is `ComponentType<{ record: T }>` (`entity360/entityDescriptor.ts:57`);
`ReferenceHeader` is `({ reference }: { reference: Reference })`
(`references/ReferenceShow.tsx:34`). Write a one-line shim in the descriptor module and point
`identityHeader` at it — do not rename the component's own prop. Same class of shim as 5-8's
`{ single }` and 5-9's `{ shadchan }` / `{ shadchanId }`.

```ts
const ReferenceIdentityHeader = ({ record }: { record: Reference }) => (
  <ReferenceHeader reference={record} />
);
```

And re-home the export before gutting `ReferenceShow.tsx`:
`references/ReferenceHeader.test.tsx:7` imports it from `./ReferenceShow`.

### Test guidance — the real stack

Component tests run in **Chromium via `vitest-browser-react`**, with `StoryWrapper` and/or
`TestMemoryRouter` (see `references/ReferenceCreate.test.tsx` and `dashboard/StatStrip.test.tsx`
for the two shapes). **React Testing Library is not a dependency of this repo** — do not
`import { render } from "@testing-library/react"`. What this story specifically needs covered:

| Assertion | Where |
|---|---|
| the `shidduchim` tab renders **third**, not last | an RTL-style render of the tab strip — assert the rendered order, **not** the descriptor literal; `tab-order-drift` reads the declaration and cannot see the merge's append |
| a reference linked to 2 shidduchim renders 2 `RecordLink`s, **each with a resolved label** | proves `linkLabel` is supplied |
| a link row with `shidduchim_id = null` renders **no** row | proves the not-null filter |
| the panel filters on `linked_shidduchim_count@eq: 0`, and an attached reference never appears | `references/ReferencesIndex.test.tsx` (new) |
| both widened AD-24 rules fire on a fixture that breaks them | `ad24Conformance.test.ts` — the validator is a pure function over manifests, so each rule gets a one-fixture case |

Reuse awareness (UX-DR9) is covered by Task 1's `countOtherConversations` — do not duplicate
`crossReferenceSummary.test.ts`, which is a different function (FR61 coverage/contradiction
analysis, not link counting).

### Reuse checklist (do not re-derive)

- `references/RepeatRecognitionPanel.tsx` — reuse-awareness, already correct; only extract its
  filter into a shared helper.
- `references/ReferenceCallLog.tsx` + `CallCaptureSheet.tsx` — Conversations tab content,
  unchanged (Story 5.11 extends `CallCaptureSheet`, not this story).
- `references/ResearchAssistantPanel.tsx` — Assistant tab, unchanged.
- `references_summary`'s existing `linked_shidduchim_count` (`03_views.sql:115`) — **this is what
  Task 2 uses.** It is reached through `getList("references")`, which both providers already map
  onto the view. Do not add a mirroring column to `reference_links_summary`.
- `dataProvider.linkReferenceToShidduch` → `link_reference_to_shidduch`
  (`02_functions.sql:2225`) — the **one** writer of `reference_links`, account-checked on both
  sides and idempotent. `ReferenceAttachToShidduch` calls it; nothing else inserts links.
- `references/crossReferenceSummary.ts` — unrelated (FR61). Not a home for
  `countOtherConversations`.

### Project Structure Notes

- **No schema change, no migration, no migration lease.** Task 2's decision (batched
  `references_summary` read) removes the only candidate. If a `supabase/**` edit appears in this
  story's diff, RULING 7 R7 has been pulled in from the S16 wave — revert it.
- Frontend changes are **not** confined to `references/`. This story also writes
  `entity360/{entityDescriptor.ts, ad24Conformance.ts, ad24Conformance.test.ts,
  registry.stubs.test.ts, RecordUnavailable.tsx, routeConvention.tsx}`,
  `entity360/tabs/interactionLabels.ts` (prose scrub, contended with 5-1),
  `providers/commons/englishCrmMessages.ts` (prose scrub, contended with 5-2's lease), and
  `registry.json` — adding `ReferencesIndex.tsx` / `ReferenceAttachToShidduch.tsx` and deleting
  `ReferenceList.tsx` / `ReferenceTimeline.tsx` / `ReferenceTasks.tsx` all mutate it
  (`scripts/generate-registry.mjs` globs `src/components/atomic-crm/**/*.ts*` minus tests, and
  `.husky/pre-commit` regenerates). Declare every one of these in the ownership manifest;
  declaring `references/**` alone is the exact under-declaration that produced 33 phantom-green
  overlaps in the pre-flight's checker run.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.10]
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding. §3 (`TabKey`:
  `shidduchim`, not `linked-shidduchim`; `conversations` kept and distinct), §4 (registry
  `{ replace: true }`), §9 (`relationships` + `RelatedRecordsTab` — do not hand-roll the list),
  §11 Ruling 2 point 5 (this story deletes `ReferenceTasks.tsx`), §0 (validation commands,
  AD-23 vocabulary).
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#The-process] — "reference: reusable
  across suggestions, but always consulted *about* a particular suggestion" (quoted verbatim; the
  glossary predates AD-23 and reads "shidduchim" today) — the design
  principle behind keeping diligence on the shidduch, not the reference.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#Design-Paradigm, Single-owner-rule]
  — rationale for retiring
  `ReferenceTimeline.tsx`/`ReferenceTasks.tsx` rather than keeping them alongside the universal
  tabs.
- [Source: UX-DR8, UX-DR9 in epics.md#UX-Design-Requirements] — references reached from a
  shidduch, not primary nav; reuse awareness mandatory.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#UX-DR5]
  — the reference tab matrix (`Overview · Conversations · Linked shidduchim · Notes · Tasks ·
  Activity`) this story's tab set implements, plus UX-DR4's exception clause covering
  `assistant`.
- [Source: src/components/atomic-crm/entity360/buildEntityRoutes.tsx:8, :43-54, :60-91] — `List`
  is required, `list` is the route mount, and the REGISTRATION RULE behind AC-4.
- [Source: src/components/atomic-crm/entity360/relationshipDescriptor.ts:22-25, :35-42] —
  `linkLabel` is MANDATORY when `linkResource !== resource`, plus the worked example for exactly
  this reference → shidduchim case.
- [Source: src/components/atomic-crm/entity360/mergeEntityTabs.tsx:55-91] — why `shidduchim`
  must be an explicit `tabs` entry and not a `relationships` entry: relationship-derived tabs are
  **appended**, and the order validator cannot see it.
- [Source: src/components/atomic-crm/entity360/tabs/types.ts:11-14] — `UniversalTabProps`,
  the `{ targetType, targetId }` shape (never `target_type`).
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts:201-204, :629-647, :688-699] —
  `NO_BROWSE_SURFACE_ENTITIES` (keep), and the two rules AC-8 widens.
- [Source: _bmad-output/planning-artifacts/epics.md:126-140] — RULING 7 verbatim, including
  clause 1's "References also leave global search" and clause 2's "`/references/{id}` stays".
  The unattached-references panel, the `browsable?: false` field and the guard widening are
  transcribed into AC-7/AC-8/AC-9 and Tasks 6-7 of this story, so no external planning document
  needs to be opened to build them.
- [Source: _bmad-output/planning-artifacts/epics.md:869] — this story's own epic AC:
  "reached from a shidduch's diligence — never from navigation, a list or search".

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
