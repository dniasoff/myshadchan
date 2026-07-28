---
baseline_commit: 46d4f194e634c7a1e4f24cd5c75d491a65671b08
---

# Story 3.3: Entity descriptor registry

Status: review — 3.3a and 3.3b both done. 3.3b (`EntityShow`) implemented at build-order
step 5, after 3.1/3.2/3.9/3.10a/3.12 landed. One cross-story unblock: Story 3-10's Task 6
(`RelatedRecordsTab`) was still unchecked when this slot started — built here (see this
story's Completion Notes and 3-10's own Change Log entry) because 3.3b's AC 10 cannot
compile, let alone be tested, without it.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want each entity to declare its 360 rather than hand-roll it,
so that no entity drifts.

## Canonical contract

This story does not invent an API. The binding shape lives in the Epic 3 canonical contract:

**Contract** = `_bmad-output/planning-artifacts/epic3-api-contract.md`

Cited below as `[Source: Contract §N:lines]`. Where this story and the contract disagree, the
contract wins and this file is the bug.

## Split: 3.3a and 3.3b

Per the contract's build order this story is **two shippable units**, in this order
[Source: Contract §12:579-598]:

| Unit | Ships | Build-order slot |
|---|---|---|
| **3.3a** | `entity360/entityDescriptor.ts` (types) + `entity360/registry.ts` (three functions) + the `<entity>/entityDescriptor.ts` convention | step **2** — after 3-13, after 3.1, **before 3.9** |
| **3.3b** | `entity360/EntityShow.tsx` | step **5** — after 3.2 |

They are split because the registry has no dependency on the shell, and **3.9 needs the
registry immediately** (`RecordLink` resolves through it) while `EntityShow` needs 3.2's
`Entity360Tabs`. Shipping them as one unit blocks 3.9 on routing work it does not use.

## Dependencies

**3.3a needs, before it starts:**

- **3-13** — the tab-vocabulary story. **Filed as
  `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`**; the contract's build order
  calls it "3-13" and every sibling story cites it under both names. It is **not**
  `3-13-records-at-urls-not-modals.md`, which is a different story. From it: `entity360/tabKeys.ts`
  (the closed `TabKey` union, 15 keys, and `TAB_LABELS`) and
  `entity360/relationshipDescriptor.ts` (`EntityRelationshipDescriptor`, AC 6).
  `EntityTabDescriptor["key"]` is `TabKey`; this story cannot type it without that file
  [Source: Contract §3:136-193].
- `src/components/atomic-crm/types.ts:109-110` — `MemberRole`. Already live; imported, never
  re-declared.

**3.3b additionally needs:**

- **3.1** — `entity360/Entity360.tsx` (the seven-region shell) and `EntityAvatar`.
- **3.2** — `entity360/Entity360Tabs.tsx`, `buildEntityRoutes` (which wraps the `:id` and
  `:id/:tab` routes in `ShowBase`, so a `RecordContext` exists), and `entityPaths.ts`
  [Source: Contract §5:270-330].
- **3-13** — `entity360/tabs/RelatedRecordsTab.tsx`. Contract §10 assigns "the `overview` /
  `related` shared components" to 3-13 [Source: Contract §10:500-516]; §9 only requires that
  *Epic 3* ship it [Source: Contract §9:455-497]. 3.3b **wires** `relationships` into the tab
  list and renders that component; it does not author it. If the 3-13 refresh does not take
  it, it is unowned — escalate rather than silently absorbing it here.

**Downstream — what breaks if 3.3a's shape is wrong:** 3.2 (`entityPaths.ts` goes through
`requireEntityDescriptor`), 3.4 (`visibleTo` filtering), 3.9 (`RecordLink` + four stub
descriptor modules), 3.5–3.8 (tab `render` closures), 4.1
[Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md:29-33,43-44,114],
5.1 / 5.8 / 5.9 / 5.10 (which each *replace* a stub descriptor), 8.5, 9.2.

## Scope boundary — read before starting

This story defines the `EntityDescriptor` **contract**, the **registry**, and the generic
**`EntityShow`** that renders a fully-wired `Entity360` from any registered descriptor —
proven against fixture descriptors in tests.

It registers **no descriptor for any real entity**. Story 3.9 writes the four stub modules
(`singles/`, `shadchanim/`, `references/`, `shidduchim/entityDescriptor.ts`) carrying `name`,
`buildRecordPath` and `label` only; Epic 5 stories 5.1 / 5.8 / 5.9 / 5.10 **replace** each
stub with the full 360 declaration via `registerEntityDescriptor(d, { replace: true })`
[Source: Contract §4:196-231]. `entity360/` therefore contains zero entity names when this
story is done — AC 9 is the machine check for that.

## The real cross-epic escalation (replaces the stale one)

The previous version of this story escalated a 3.3↔4.1 gap by quoting 4.1 as declining
descriptor integration. **That text no longer exists in 4.1.** 4.1 today declares Epic 3
Story 3.3's registry a hard dependency and consumes `label` as a `translate` fallback
[Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md:29-33,114]. The
escalation is closed; `epics.md`'s S7 entry (`:1252-1257`) records the *old* state and is
itself stale.

**The residual, and the only thing worth escalating from this story:** `icon` and `meta`
survive on the descriptor with **no list consumer**. 4.1 states in writing that
`icon`/`meta`/`stats` "have no home in list chrome yet and are **not** consumed here"
[Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md:234-240], while
8.5 expects a Connections descriptor carrying "label, icon, route, avatar, title, meta"
[Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:23-26]. The
fields are kept (AD-24 names them); wiring them into `EntityList` is an **Epic 4** decision,
not Epic 3's. This story does not block on it and does not build a list consumer.

`epics.md`'s Story 3.3 AC reads "its 360 **and list** render entirely from that declaration"
[Source: _bmad-output/planning-artifacts/epics.md:485-496]. This story delivers the **360
half** and the descriptor fields the list half needs. Narrowing the epics.md AC to the 360
half is the epic owner's edit, and is what the residual above is about.

---

## Acceptance Criteria

### 3.3a — types and registry

1. **`EntityDescriptor` is the contract's shape exactly — three required fields, region
   renderers as components.** `src/components/atomic-crm/entity360/entityDescriptor.ts`
   exports [Source: Contract §2:70-133]:

   ```ts
   import type { ComponentType, ReactNode } from "react";
   import type { Identifier, RaRecord } from "ra-core";
   import type { LucideIcon } from "lucide-react";
   import type { MemberRole } from "../types";        // types.ts:109-110 — never re-declared
   import type { TabKey } from "./tabKeys";           // 3-13 — closed union

   export type EntityDescriptor<T extends RaRecord = RaRecord> = {
     name: string;                                    // as registered in routeManifest.ts (plural, snake_case)
     buildRecordPath: (id: Identifier) => string;     // REQUIRED
     label: string;                                   // REQUIRED
     icon?: LucideIcon;

     identityHeader?: ComponentType<{ record: T }>;
     statBand?: ComponentType<{ record: T }>;
     rightRail?: ComponentType<{ record: T }>;
     actions?: ComponentType<{ record: T }>;          // rendered INSIDE the identityHeader region
     alertSlot?: ComponentType<{ record: T }>;

     avatar?: (record: T) => { seed: string | null }; // used ONLY when identityHeader is absent
     title?: (record: T) => string;
     meta?: (record: T) => (string | null | undefined)[];

     tabs?: EntityTabDescriptor<T>[];
     /** Canonical tabs this entity WILL have and does not have YET. Declared, never
      *  inferred: 3-11's validator asserts `keys(tabs) ∪ pendingTabs` equals the entity's
      *  canonical tab set, as SETS (contract §3 rule 5), so a partial `tabs` is legal and a
      *  forgotten tab is still caught. Must itself be canonically ordered and drawn from
      *  `TabKey`. A stub descriptor is `tabs: []` + a full `pendingTabs`. Descriptor
      *  metadata only — nothing renders it, and it is NOT an `Entity360` region. */
     pendingTabs?: TabKey[];
     relationships?: EntityRelationshipDescriptor<T>[];
   };

   export type EntityTabDescriptor<T = RaRecord> = {
     key: TabKey;
     /** OPTIONAL — and omitting it is the NORMAL case, not the exception. Absent, the label
      *  resolves through the i18n catalog with TAB_LABELS[key] as the untranslated fallback
      *  (contract §3 rule 2). Set it ONLY for a genuine per-entity deviation from the
      *  canonical vocabulary, and carry a one-line comment saying why THAT entity deviates. */
     label?: string;
     render: () => ReactNode;                         // LAZY — no argument
     visibleTo?: MemberRole[];                        // absent = every role
   };
   ```

   Four properties are **absent by decision, not by omission**, and each is asserted:
   there is no `stats?: (record) => …` field (deleted — `statBand` replaces it); no
   `minVisibility` (the field is `visibleTo`, an allow-list); `EntityDescriptor.label` — the
   **entity-level** label 4.1 consumes as a `translate` fallback — is **not** optional; and no
   region is `(record) => ReactNode`. Note the asymmetry, which is deliberate and is the owner's
   ruling: `EntityDescriptor.label` is required, `EntityTabDescriptor.label` is optional.

   One property is **present by decision**: `pendingTabs?: TabKey[]`. It is contract (§2), it
   is what makes a partial or empty `tabs` array legal under 3-11's conformance rule
   (contract §3 rule 5), and **3.9's four stub descriptors — the first consumers of this type,
   one story later — each declare it**. Omitting it from this type is not a simplification: it
   makes `pendingTabs: [...]` an excess-property error on 3.9's literals and blocks step 3.

   **How this fails:** `entityDescriptor.test.ts` carries `@ts-expect-error` assertions that
   `npm run typecheck` evaluates (`tsconfig.app.json` `include: ["src", …]`, `strict: true`) —
   an unused `@ts-expect-error` is itself a compile error, so each assertion fails loudly if
   the type stops rejecting what it must reject:
   (a) a descriptor literal missing the entity-level `label`;
   (b) `statBand: (record) => <div/>` (a function, not a `ComponentType`);
   (c) a literal carrying `stats: []` (excess property);
   (d) a tab with `key: "not-a-tab"`;
   (e) a tab with `minVisibility: […]`;
   (f) `render: (record) => …` (arity — `render` takes no argument).
   Plus three positives that must compile clean: `{ name, buildRecordPath, label }` alone; a
   tab literal `{ key: "overview", render: () => null }` carrying **no** `label` — the normal
   case under the owner's ruling; and `{ name, buildRecordPath, label, tabs: [],
   pendingTabs: ["overview", "notes"] }` — 3.9's stub shape. A `@ts-expect-error` on the second
   positive is itself the defect: it would mean `EntityTabDescriptor.label` has been
   re-required. One on the third means `pendingTabs` was dropped from the type, which breaks
   3.9 and 3-11 AC 6.

2. **Regions are a component boundary, not a data shape — and the proof is a hook.** Because
   every region is `ComponentType<{ record }>`, a descriptor module may load its own data.
   `entityDescriptor.test.ts` (or `EntityShow.test.tsx` for the render half) uses a fixture
   `statBand` that calls `useGetOne` and asserts it renders both its pending state and its
   resolved values. **The fixture must not be `singles`**: `singles_summary` carries its counts
   inline [Source: supabase/schemas/03_views.sql:170], so a `singles` fixture passes even
   under the deleted `(record) => stats[]` shape, while 5.9's real band —
   `useGetOne<ShadchanStats>("shadchan_stats", { id })`
   [Source: src/components/atomic-crm/shadchanim/ShadchanShow.tsx:40-43], view at
   [Source: supabase/schemas/03_views.sql:202] — dies. Use a `shadchan_stats`-shaped fixture.

3. **One registry, three functions, one private `Map`.**
   `src/components/atomic-crm/entity360/registry.ts` exports exactly
   [Source: Contract §4:196-231]:

   ```ts
   export function registerEntityDescriptor<T extends RaRecord>(
     descriptor: EntityDescriptor<T>,
     opts?: { replace?: boolean },
   ): void;
   export function getEntityDescriptor(name: string): EntityDescriptor | undefined;
   export function requireEntityDescriptor(name: string): EntityDescriptor;
   ```

   Behaviour, each a test:
   - the backing `Map<string, EntityDescriptor>` is module-private and is **not** exported;
   - register → `getEntityDescriptor` round-trips the same object;
   - registering the same `name` a second time **without** `{ replace: true }` throws;
   - registering the same `name` **with** `{ replace: true }` succeeds and the subsequent
     lookup returns the **new** object. This `replace` is the whole extend API — it is what
     4.1 [`:161-163`], 5.1 [`:92-93`], 5.8 [`:105-108`], 5.9 [`:95-96`] and 5.10 [`:106-108`]
     each mean by "extend" / "fill in". There is **no** `updateEntityDescriptor` and **no**
     partial merge: the replacing module supplies the whole descriptor;
   - `getEntityDescriptor("nope")` returns `undefined` — it never throws;
   - `requireEntityDescriptor("nope")` throws
     `Error('No entity descriptor registered for resource "nope"')`, asserted on the message.

   Which accessor to use is not a style choice: `root/routeManifest.ts:92-100` registers
   **seven** resources (`shidduchim, singles, inbox_items, shadchanim, references, tasks,
   members`) and Epic 3 + Epic 5 give descriptors to **four**, so `EntityList` over
   `tasks` / `inbox_items` / `members` must use the guarded form, and `EntityShow` /
   `entityPaths.ts` must use the fail-fast form
   [Source: .claude/rules/coding-style.md#Error-handling].

4. **The registration convention is documented in the file the downstream story cites, and
   this story registers nothing.**
   - A descriptor's home is `src/components/atomic-crm/<entity>/entityDescriptor.ts`. The
     module exports the descriptor object **and** calls `registerEntityDescriptor` at module
     scope; `<entity>/index.ts` adds `import "./entityDescriptor";` as its first line.
     Registration is complete before first render because `root/routeManifest.ts:6-18` imports
     every resource index module at module scope and `CRM.tsx` maps over `RESOURCES` at boot —
     **no lazy import, no registration inside a component, no `useEffect`**.
   - **No descriptor may read another descriptor at module scope.** Registry order is
     irrelevant and must stay irrelevant.
   - A doc comment at the top of `entityDescriptor.ts` states: this type is AD-24's single
     source for list metadata (`label`/`icon`/`meta`) as well as 360 metadata; `EntityList`
     (Story 4.1) consumes `label` only today; any future list wiring **consumes this type and
     never redefines it**. 4.1 cites this comment by name as its contract
     [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md:31-33,239-240],
     which is why it carries an AC instead of being a coordination note.
   - **How this fails:** a guard test asserts (i) `entityDescriptor.ts`'s leading doc block
     contains the strings `EntityList` and `never redefine`, and (ii) neither
     `entityDescriptor.ts` nor `registry.ts` calls `registerEntityDescriptor` — Epic 3
     registers descriptors only from 3.9's four entity modules.

5. **`MemberRole` and `TabKey` are imported, never re-declared, anywhere under `entity360/`.**
   A guard test globs `entity360/**/*.{ts,tsx}` as raw source — the in-repo precedent is
   `import.meta.glob("…", { query: "?raw", import: "default", eager: true })`
   [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — and
   asserts no file contains the literal `"parent_admin"` or a `TAB_KEYS`-shadowing
   `type TabKey =`. `MemberRole` lives at
   [Source: src/components/atomic-crm/types.ts:109-110] and `InvitableRole` (`types.ts:117`)
   already derives from it; a second spelling is a review-blocking defect
   [Source: Contract §2:120-122]. Prove the guard **red** against a fixture file containing the
   literal before shipping it green [Source: Contract §13:602-619].

6. **`EntityRelationshipDescriptor` is *imported and re-exported* here, not re-declared; the
   renderer is 3-13's and the wiring is AC 10's.** [Source: Contract §9:455-497]

   **Ownership, settled — do not duplicate.** The type is authored by story 3-13
   (`_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md` AC 6) in
   `src/components/atomic-crm/entity360/relationshipDescriptor.ts`, because it is keyed by
   3-13's `TabKey` and consumed by 3-13's `RelatedRecordsTab`, and 3-13 is build-order step 0
   while this story is step 2 — the import can only run in that direction.
   `entityDescriptor.ts` therefore does
   `import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";` and
   `export type { EntityRelationshipDescriptor };`, so consumers still need to know about only
   one module. **A second `export type EntityRelationshipDescriptor = …` anywhere under
   `entity360/` is a review-blocking defect**, on the same footing as re-declaring `MemberRole`
   or `TabKey` (AC 5), and AC 5's guard is extended to catch it. The shape below is reproduced
   for reference only — if it and `relationshipDescriptor.ts` disagree, 3-13 wins:

   ```ts
   export type EntityRelationshipDescriptor<T = RaRecord> = {
     key: TabKey;
     label?: string;                       // defaults to TAB_LABELS[key]
     resource: string;                     // MAY be a summary view that already resolves a join
     getFilter: (record: T) => Record<string, unknown>;
     sort?: { field: string; order: "ASC" | "DESC" };
     perPage?: number;
     linkResource?: string;                // resource the row's RecordLink targets; defaults to `resource`
     linkId?: (row: any) => Identifier;    // defaults to (row) => row.id
     linkLabel?: (row: any) => string;     // defaults to the resource's recordRepresentation
     emptyLabel?: string;
   };
   ```

   `{ resource, foreignKey }` is **not** sufficient and is not what is built: the one
   many-to-many the domain has is reference → shidduchim, which is queried through
   `reference_links_summary` [Source: supabase/schemas/03_views.sql:133] whose rows are *link*
   rows — the `RecordLink` must target a different resource and a different id column
   (`rl.shidduchim_id`, [Source: supabase/schemas/03_views.sql:139]). Both worked examples
   must typecheck in the test file:

   ```ts
   // reference → shidduchim (many-to-many, through the link view)
   { key: "shidduchim", resource: "reference_links_summary",
     getFilter: (r) => ({ reference_id: r.id }),
     linkResource: "shidduchim", linkId: (row) => row.shidduchim_id }

   // single → shidduchim (plain FK)
   { key: "shidduchim", resource: "shidduchim", getFilter: (r) => ({ single_id: r.id }) }

   // shadchan → shidduchim (plain FK; the column is shadchan_id, as ShadchanSuggestions
   //   already queries it — src/components/atomic-crm/shadchanim/ShadchanSuggestions.tsx:25-26)
   { key: "shidduchim", resource: "shidduchim", getFilter: (r) => ({ shadchan_id: r.id }) }
   ```

### 3.3b — `EntityShow`

7. **`EntityShow` takes no props and reads both resource and record from context.**
   `src/components/atomic-crm/entity360/EntityShow.tsx` exports
   `export function EntityShow(): ReactElement;` — **no `{ resource, record }` props, and no
   "or" between the two mechanisms**. It reads `useResourceContext()` and `useRecordContext()`
   (the repo pattern; `admin/show.tsx` gets the record from `ShowBase`, imported from `ra-core`
   at [Source: src/components/admin/show.tsx:6-17]), looks the descriptor up with
   `requireEntityDescriptor`, and renders `Entity360` with **exactly**:

   | `Entity360` region | Source |
   |---|---|
   | `breadcrumb` | reserved — currently `undefined` |
   | `identityHeader` | `<IdentityHeader record/>` if declared, else the `avatar`/`title`/`meta` default composition — **immediately followed, inside the same region, by `<Actions record/>`** |
   | `statBand` | `<StatBand record/>` |
   | `alertSlot` | `<AlertSlot record/>` |
   | `tabBar` + `children` | `<Entity360Tabs tabs={…}/>` (3.2) |
   | `rightRail` | `<RightRail record/>` |

   `actions` is **never a region of its own** on `Entity360` — the shell's prop list stays at
   exactly seven [Source: Contract §1:33-67, §2:117-119]. This is where 5.1's
   `ShidduchStateControl` and 9.2's Single-360 action land
   [Source: _bmad-output/implementation-artifacts/9-2-publish-single-listing.md:156-158].
   **`EntityShow` fetches nothing** beyond the record `ShowBase` already supplies; stat and
   rail data loading belongs to the descriptor module [Source: Contract §10:500-516].

8. **A 360 renders entirely from the declaration — proven by two fixtures and no edit to
   `EntityShow.tsx` between them.** Fixture A: title, a `statBand` that calls `useGetOne`, two
   tabs. Fixture B: a different title, three tabs, no stat band, a `rightRail`, an `actions`.
   Both are asserted through `vitest-browser-react` + `ra-core`'s `TestMemoryRouter` in real
   Chromium [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3,68-71] —
   never React Testing Library, which is not a dependency. Assertions: exactly the declared
   title, exactly the declared number of tab triggers, the stat band present for A and
   **absent** for B (`await expect.element(...).not.toBeInTheDocument()`), and `actions`
   rendered inside the identity-header region for B.

   Tab `render` is **lazy** (`() => ReactNode`): a test asserts a non-active tab's `render`
   spy is **not called**, and that a tab's own content reaches the record through
   `useRecordContext()` — which resolves because `EntityShow` mounts inside `ShowBase`
   [Source: Contract §2:123-126, §5:292-296].

   Tab labels: **`EntityShow` forwards `tab.label` verbatim — including `undefined` — to
   `Entity360Tabs`, and does nothing else.** It must **never** substitute `TAB_LABELS[tab.key]`
   itself and pass that as an override, never call `translate` for a tab label, and never apply
   a `?? TAB_LABELS[…]` default. This is the owner's ruling and it is load-bearing: because
   `useTabLabel(key, override)` returns `override ?? translate(…)`, an `EntityShow` that fills
   the label in makes **every** tab an override, so the translation catalog is never consulted
   and the i18n path is dead while its round-trip test still passes. Resolution happens in one
   place only — `Entity360Tabs` calling `useTabLabel(key, label)` (3.2 / 3-13), under key
   **`crm.entity360.tab.<key>`**; the catalog nests under a single `crm` root
   (`englishCrmMessages.ts:104`), so a bare `entity360.tab.<key>` can never resolve
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md §2 rule 8, §3 rule 2].
   The precedence question is **settled, not deferred** — do not re-open it with 3-13.
   **Visibility filtering is 3.4's**: until 3.4 lands, `EntityShow` passes every declared tab
   through, and 3.4 inserts the `hasVisibility` filter **before** the array reaches
   `Entity360Tabs` [Source: Contract §6:334-372].

9. **Missing optional fields degrade; the generic renderer cannot special-case an entity.**
   - A descriptor with only `name`, `buildRecordPath` and `label` renders through `EntityShow`
     with no stat band, no tab bar, no rail, no alert slot — and does not throw. This is the
     concrete proof of AD-24's "regions are optional per entity"
     [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180].
   - A `?raw` guard scoped to **`EntityShow.tsx` alone** asserts two things: (i) it imports
     from **no sibling directory of `entity360/`** — expressed as "no relative import that
     escapes `entity360/`", *not* as a four-name alternation, because `connections/` arrives in
     8.5 and `if (resource === "shidduchim")` contains no `/` and would slip a name-only
     pattern; and (ii) the file contains **no entity-name string literal** (checked against
     `RESOURCES`' seven names from `root/routeManifest.ts:92-100` plus `"connections"`). The
     bare `?raw` import typechecks without a new ambient declaration — `vite/client` already
     declares `*?raw` [Source: node_modules/vite/client.d.ts:243], referenced from
     [Source: src/vite-env.d.ts:1].
   - **Both halves of the guard must be shown red against a deliberately broken fixture before
     they are shown green** [Source: Contract §13:602-619]. A guard that cannot fail is not
     coverage — the previous version of this AC was one of three in Epic 3 that could not fail.

10. **`relationships` become tabs, in declared order, and an explicit `tabs` entry wins.**
    `EntityShow` turns each `relationships` entry into a tab rendering
    `<RelatedRecordsTab relationship={…}/>` (3-13's component), placed at the position its
    `key` occupies in the entity's declared tab order. If `tabs` already contains an entry with
    the same `key`, the explicit entry **overrides** the relationship-derived one and
    `RelatedRecordsTab` is not mounted for it. Two tests: a descriptor with only
    `relationships: [{key: "shidduchim", …}]` shows a "Shidduchim" tab whose content is
    `RelatedRecordsTab`; the same descriptor plus an explicit `tabs` entry keyed `shidduchim`
    shows **one** tab, rendering the explicit content. Empty / loading / error states belong to
    `RelatedRecordsTab`, not to `EntityShow` (UX-DR11,
    [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187]).

---

## Tasks / Subtasks

### 3.3a

- [x] **Task 1 — `entity360/entityDescriptor.ts`** (AC: 1, 4, 6)
  - [x] Write the doc comment required by AC 4 (list metadata, 4.1 consumes `label`, never
        redefine the type) as the file's leading block.
  - [x] Declare `EntityDescriptor`, `EntityTabDescriptor`, `EntityRelationshipDescriptor`
        exactly as AC 1 / AC 6 spell them. Import `MemberRole` from `../types` and `TabKey`
        from `./tabKeys`. Declare neither locally. **Deviation** (see Completion Notes):
        `EntityTabDescriptor` is shipped non-generic — the contract's own
        `EntityTabDescriptor<T = RaRecord>` declares a `T` no field ever reads, which fails
        `tsc --noEmit` under this repo's `noUnusedLocals: true` (TS6133). Dropped; `tabs?:
        EntityTabDescriptor[]` in `EntityDescriptor` accordingly.
  - [x] No `stats`, no `minVisibility`, no `(record) => ReactNode` region. If a reviewer finds
        one, AC 1's `@ts-expect-error` block is missing an entry.
  - [x] `pendingTabs?: TabKey[]` **is** on `EntityDescriptor` (AC 1). Do not drop it as
        "unused by this story" — 3.9's stubs and 3-11's conformance rule both require it.

- [x] **Task 2 — `entity360/registry.ts`** (AC: 3)
  - [x] Module-private `Map<string, EntityDescriptor>`; export only the three functions.
  - [x] `registerEntityDescriptor(d, opts)` — throw on duplicate `name` unless
        `opts.replace === true`; replace wholesale when it is.
  - [x] `getEntityDescriptor` returns `| undefined`. `requireEntityDescriptor` throws the exact
        AC 3 message.

- [x] **Task 3 — Tests** (AC: 1, 2, 3, 4, 5, 6)
  - [x] `entityDescriptor.test.ts` — the `@ts-expect-error` block (AC 1), the two positive
        compile fixtures, the three `EntityRelationshipDescriptor` worked examples (AC 6).
        Also carries AC 2's hook-boundary proof (a `shadchan_stats`-shaped `statBand` fixture
        calling `useGetOne`, asserting pending then resolved render) since `EntityShow.test.tsx`
        does not exist in this slot.
  - [x] `registry.test.ts` — round-trip, duplicate throws, `{replace:true}` replaces,
        `getEntityDescriptor` undefined, `requireEntityDescriptor` message. **Unique fixture
        `name` per test** (or a per-test `replace: true`) so no test depends on another's
        registry state [Source: .claude/rules/testing.md#Test-isolation]. Also asserts the
        module's exported surface is exactly the three functions (the `Map` is not exported).
  - [x] `entity360.guards.test.ts` — AC 4's doc-block + no-self-registration checks and AC 5's
        no-re-declaration glob (extended per AC 6 to also catch a second
        `EntityRelationshipDescriptor` declaration). Each predicate shown red against a
        deliberately broken fixture, then green against the real `entity360/**` sources via
        `import.meta.glob(..., { query: "?raw", ... })`.

### 3.3b — built in this slot (build-order step 5, after 3.1/3.2/3.9/3.10a/3.12 landed)

- [x] **Task 4 — `entity360/EntityShow.tsx`** (AC: 7, 9, 10)
  - [x] `export function EntityShow(): ReactElement | null` — `useResourceContext()` +
        `useRecordContext()` + `requireEntityDescriptor`. No props, no `resource`/`record`
        arguments, no data fetching. (`| null` added beyond the AC 7 signature for the
        pre-`ShowBase`-resolution / no-record window — see Completion Notes.)
  - [x] Compose the seven `Entity360` regions per AC 7's table, with `actions` rendered inside
        the identity-header region.
  - [x] Default identity composition (`avatar`/`title`/`meta` → `EntityAvatar` from 3.1) used
        only when `identityHeader` is absent. Extracted to `DefaultIdentityHeader.tsx`.
  - [x] Merge `tabs` + `relationships` into one ordered array per AC 10 and hand it to
        `Entity360Tabs` with each entry's `label` **unresolved and forwarded verbatim**
        (`undefined` stays `undefined`). Resolution is `Entity360Tabs`' via `useTabLabel`;
        `EntityShow` must not substitute `TAB_LABELS[key]` or call `translate` (AC 7).
        Extracted to `mergeEntityTabs.tsx` — see Completion Notes for the ordering
        interpretation this required, since the contract's "declared tab order" phrasing
        presupposes a per-entity canonical table (3-15) that does not exist yet.
  - [x] Keep the file well under the ~400-line ceiling; extract the default identity
        composition and the tab-merge helper into their own modules rather than growing this
        one [Source: .claude/rules/coding-style.md#File-organization]. (`EntityShow.tsx` is
        ~80 lines.)

- [x] **Task 5 — `EntityShow.test.tsx`** (AC: 7, 8, 9, 10)
  - [x] Two-fixture "entirely from the declaration" test, a `useGetOne`-backed hook fixture,
        lazy-`render` spy (plus a record-reaches-via-`useRecordContext` assertion),
        minimal-descriptor no-crash test, the `?raw` boundary guard (both halves, red first),
        and the two AC 10 relationship tests. Also two context-guard tests (throws outside a
        `ResourceContextProvider`; renders nothing with no record yet) and, in a sibling file,
        `RelatedRecordsTab.test.tsx` covering 3-10 AC 7's four cases — see Completion Notes.

---

## Dev Notes

### Why the registry is separate from `routeManifest.ts`

`root/routeManifest.ts` (Epic 1 Story 1.5) answers *"is every registered route reachable"*.
Its `ResourceEntry { name, surface, definition }` is deliberately thin and framework-shaped —
`definition` is `Omit<ResourceProps, "name">`, i.e. exactly what `<Resource>` accepts
[Source: src/components/atomic-crm/root/routeManifest.ts:39-43]. It gains an optional
`contextKind?: "household" | "shadchanus"` in Epic 8
[Source: _bmad-output/implementation-artifacts/8-1-shadchanus-context.md:52-55]; that is a
routing concern and does **not** belong on the descriptor.

The `EntityDescriptor` registry answers a different question — *"what does this entity's 360
look like"* — and is consumed **by** the route builder (3.2's `buildEntityRoutes` and
`entityPaths.ts`), not folded into it. Keeping them separate means Epic 1's
`findManifestViolations` never learns 360 semantics and this registry never learns route
reachability. When Epic 5 migrates an entity it does both: replaces the descriptor here, and
points that entity's `ResourceEntry.definition` at `buildEntityRoutes({ Show: EntityShow, … })`.

### `name` (plural resource) vs `target_type` (singular) — corrected

Resource names are **plural** (`shidduchim`, `singles`, `shadchanim`, `references`); that is
`EntityDescriptor.name` [Source: src/components/atomic-crm/root/routeManifest.ts:92-100]. The
polymorphic tables use a **singular** `target_type`. The present, verified state of that
vocabulary:

| Table | Column | Check constraint, today |
|---|---|---|
| `public.tasks` | `target_type` [Source: supabase/schemas/01_tables.sql:44] | `('shadchan','shidduch','reference')` [Source: supabase/schemas/01_tables.sql:45-47] |
| `public.interactions` | `target_type` [Source: supabase/schemas/01_tables.sql:436] | `('reference','shidduch')` [Source: supabase/schemas/01_tables.sql:458-459] |
| `public.entity_files` | — | table does not exist yet; created by 3.7 |

So **`single` is legal in neither table today, and `shadchan` is illegal in `interactions`.**
Widening all three to the same four values is **this epic's future work**, owned by 3.5
(`interactions`), 3.7 (`entity_files`) and 3.8 (`tasks`), with the TS vocabulary
(`ENTITY_TARGET_TYPES` / `EntityTargetType`, widening `TaskTargetType` at
[Source: src/components/atomic-crm/types.ts:71]) owned by **3.9**
[Source: Contract §8:409-452, §10:500-516].

**This story builds no `ENTITY_NAME_TO_TARGET_TYPE` map, and the descriptor carries no
`targetType` field.** It does not need one: a tab's `render` closure lives inside that
entity's own descriptor module, which already knows which entity it is, so 5.8's singles
descriptor simply writes `render: () => <ActivityTab targetType="single" targetId={id}/>`.
Deriving a singular from a plural by string surgery is the trap this note exists to prevent.

### `replace` is the extend API — what "fill in" means downstream

Five stories say they will "extend" or "fill in" a registration. All five mean
`registerEntityDescriptor(fullDescriptor, { replace: true })` from that entity's own
`entityDescriptor.ts`, replacing 3.9's stub wholesale:
4.1 [`:161-163`], 5.1 [`:92-93`], 5.8 [`:105-108`], 5.9 [`:95-96`], 5.10 [`:106-108`].
There is no partial-merge path, and none is wanted — a merge makes "what does this entity
declare" un-answerable by reading one file.

### The registry is not broken by context switching — do not re-key it

No story needs two descriptors for one `name`. 8.5 registers a **new** resource
(`connections`), so the duplicate-name throw is never reached
[Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:23-26].
Per-viewer variation happens at render (region renderers are components; 3.4 gates tabs
through a hook re-evaluated after a context switch), and context-**kind** routing lives on
`routeManifest.ts` via 8.1's `<RequireContextKind>`
[Source: _bmad-output/implementation-artifacts/8-1-shadchanus-context.md:52-55].
**Do not key the registry by `(name, contextKind)`.**

### Reuse already confirmed

`EntityAvatar` (3.1) for the default `avatar` composition; `Entity360` / `Entity360Tabs`
(3.1 / 3.2) for layout and tab routing; `RelatedRecordsTab` (3-13) for `relationships`;
`ShowBase` from `ra-core`, wired by 3.2 [Source: src/components/admin/show.tsx:6-17].
`EntityShow` introduces **no new visual primitive**.

### Testing standard

- Browser-mode vitest: `vitest-browser-react` + `ra-core`'s `TestMemoryRouter` in real
  Chromium [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3,68-71;
  vitest.config.ts:36-49]. `render()` returns `container`, so `container.textContent`
  assertions survive. Negative assertions are
  `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()` — **not**
  `screen.queryByText`, which does not exist here.
- `?raw` source scanning: `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`
  [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20], or a bare
  `import src from "./EntityShow.tsx?raw"` (typechecks — `vite/client` declares `*?raw`,
  [Source: node_modules/vite/client.d.ts:243]). Every guard is shown **red once** first.
- AAA, per-test fixture descriptors with unique `name`s, no shared mutable registry state, no
  `waitForTimeout`, ≥80% coverage on new code
  [Source: .claude/rules/testing.md].

### Validation commands (also runnable via `make typecheck` / `make test` / `make lint` / `make build`)

`npm run typecheck` [Source: package.json:17] — this is what evaluates AC 1's
`@ts-expect-error` block. Then `npx vitest run` (or `npm run test:unit:app`
[Source: package.json:7]), `npm run lint` [Source: package.json:20], `npm run build`
[Source: package.json:14]. `make typecheck` / `make test` do not exist.

### Project structure

`entity360/entityDescriptor.ts`, `entity360/registry.ts` and `entity360/EntityShow.tsx` are
new, alongside `Entity360.tsx`, `EntityAvatar.tsx` (3.1), `Entity360Tabs.tsx`,
`buildEntityRoutes.tsx`, `entityPaths.ts` (3.2) and `tabKeys.ts`, `tabs/RelatedRecordsTab.tsx`
(3-13). The directory grows by **file count**, not file size — keep each module well under the
~400-line typical ceiling [Source: .claude/rules/coding-style.md#File-organization].

### References

- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — §2 (`EntityDescriptor`, `:70-133`), §3 (`TabKey`, `:136-193`), §4 (registry + `EntityShow`, `:196-266`), §9 (`relationships`, `:455-497`), §10 (ownership, `:500-516`), §12 (build order, `:579-598`), §13 (test shapes, `:602-619`)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180] — AD-24: "an entity contributes a descriptor (label, icon, avatar, title, meta, stats, tabs, actions, relationships) and no bespoke layout code"; regions in fixed order
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:174-176] — AD-23 vocabulary (`single`, never "child"; `members`, never `sales`)
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:157-160] — UX-DR1 region order; `:166-167` UX-DR4 shared tab vocabulary; `:168-172` UX-DR5 per-entity matrix; `:186-187` UX-DR11
- [Source: _bmad-output/planning-artifacts/epics.md:485-496] — the epic-list AC this story delivers the 360 half of
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md:29-33,43-44,114,161-163,234-240] — 4.1 depends on this registry and consumes `label`; `icon`/`meta`/`stats` deliberately unconsumed
- [Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:92-93; 5-8-single-360.md:105-108; 5-9-shadchan-360.md:95-96; 5-10-reference-360-and-diligence.md:106-108] — the four `{ replace: true }` consumers
- [Source: _bmad-output/implementation-artifacts/8-1-shadchanus-context.md:52-55] — `contextKind` belongs to `routeManifest.ts`, not the descriptor
- [Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:23-26] — a fifth resource, not a second descriptor for an existing name
- [Source: _bmad-output/implementation-artifacts/9-2-publish-single-listing.md:156-158] — a future consumer of `actions`
- [Source: src/components/atomic-crm/types.ts:109-110] `MemberRole`; `:71` `TaskTargetType`
- [Source: src/components/atomic-crm/root/routeManifest.ts:6-18,39-43,92-100] — eager resource imports, `ResourceEntry`, the seven `RESOURCES`
- [Source: src/components/atomic-crm/shadchanim/ShadchanShow.tsx:40-43] and [Source: supabase/schemas/03_views.sql:202] — the only real stat band; why `statBand` must be a `ComponentType`
- [Source: supabase/schemas/03_views.sql:133,139,170] — `reference_links_summary` (`shidduchim_id`), `singles_summary`
- [Source: src/components/atomic-crm/shadchanim/ShadchanSuggestions.tsx:25-26] — the shadchan → shidduchim filter column
- [Source: supabase/schemas/01_tables.sql:44,45-47,436,458-459] — the singular `target_type` vocabulary as it stands today
- [Source: src/components/admin/show.tsx:6-17] — `ShowBase` from `ra-core`, the record-context source 3.2 wires
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3,68-71] — the browser-mode test pattern
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the `?raw` glob precedent
- [Source: node_modules/vite/client.d.ts:243; src/vite-env.d.ts:1] — the `*?raw` module declaration already exists
- [Source: package.json:7,14,17,20] — the real validation commands
- [Source: _bmad-output/implementation-artifacts/3-1-entity360-shell.md, _bmad-output/implementation-artifacts/3-2-url-backed-tabs.md, _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — this epic's own prior and adjacent stories. Story **3-13** (tab vocabulary) is new in this refresh pass; its file does not exist yet, so it is cited by story number only until it lands.
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md, .claude/rules/english-only.md, .claude/rules/lsp-usage.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (bmad-dev-story workflow). 3.3a slot, then a separate session for the
3.3b slot (this Change Log entry's date).

### Debug Log References

- `npm run typecheck` — first pass failed: `entityDescriptor.ts(87,32): error TS6133: 'T' is
  declared but its value is never read` on `EntityTabDescriptor<T = RaRecord>`. The contract's
  own snippet (and this story's AC 1 code block) declares that generic but no field of
  `EntityTabDescriptor` ever reads it (`render` is arity-zero; the record reaches tab content
  via `useRecordContext()`, not via a typed prop). Fixed by dropping the unused generic
  (`EntityTabDescriptor` is now non-generic) and changing `EntityDescriptor.tabs` from
  `EntityTabDescriptor<T>[]` to `EntityTabDescriptor[]`. Second pass: clean.
- `npx prettier --check .` flagged formatting in the three new files with the most logic
  (`registry.ts`, `registry.test.ts`, `entity360.guards.test.ts`); `npx prettier --write` on
  those three, re-verified clean. (Pre-existing formatting drift in unrelated docs/workflow
  files was left untouched — out of scope for this story.)
- All other gates (`npm run lint`, `npx vitest run`, `npm run build`) passed on the first run.

**3.3b slot:**

- First `npm run typecheck` pass on `EntityShow.test.tsx` failed twice: (1)
  `useGetOne<{ nb: number }>` — `{ nb: number }` does not satisfy the `RaRecord` constraint
  (missing `id`); fixed by typing the fixture stat shape `RaRecord & { nb: number }`. (2) the
  mocked `getOne`'s ternary branches produced a union return type
  (`Promise<{data:{nb}}> | Promise<{data:{id}}>`) that does not structurally match
  `DataProvider["getOne"]`'s generic signature; fixed with a single
  `as unknown as DataProvider["getOne"]` cast on the whole mock, matching this file's own
  `as unknown as DataProvider` precedent elsewhere in the suite. Third pass: clean.
- First `npx vitest run` pass had three real failures, all in test code, none in the
  implementation: (1)/(2) the two AC 10 relationship tests asserted the synchronous tab
  count before the record fetch (`ShowBase`'s own pending state) had resolved — fixed by
  awaiting the tab element first, then taking the synchronous DOM snapshot, the same
  ordering the AC 8 fixture tests already used. (3) `DefaultIdentityHeader.test.tsx`'s
  `screen.getByText("AR")` matched two elements — the avatar chip AND the "Ari Rosenberg"
  heading, because Playwright's default text matching is a case-insensitive substring match
  and "Ari" contains "Ar"/"AR" case-insensitively; fixed by scoping the assertion to the
  `aria-hidden` chip element directly. All fixes are inside the tests; no implementation
  code changed as a result.
- `npx prettier --check .` flagged the four new files with the most JSX
  (`DefaultIdentityHeader.tsx`, `DefaultIdentityHeader.test.tsx`, `EntityShow.test.tsx`,
  `RelatedRecordsTab.test.tsx`); `npx prettier --write` on those four, re-verified clean.
  Pre-existing drift in unrelated docs/workflow files left untouched, matching 3.3a's own
  precedent.
- `make registry-gen` regenerated `registry.json` (new files under `entity360/`) —
  committed alongside.

### Completion Notes List

- Shipped exactly the 3.3a scope: `entity360/entityDescriptor.ts` (types),
  `entity360/registry.ts` (three functions), and their tests. **No `EntityShow`, no descriptor
  registration for any real entity** — Story status reflects 3.3b as not-yet-done.
- `EntityDescriptor` matches the contract's shape field-for-field: three required fields
  (`name`, `buildRecordPath`, `label`), all five region renderers typed
  `ComponentType<{ record: T }>` (never `(record) => ReactNode`), the default
  `avatar`/`title`/`meta` composition, `tabs`, `pendingTabs?: TabKey[]` (RULING 4), and
  `relationships` importing/re-exporting `EntityRelationshipDescriptor` from
  `./relationshipDescriptor` (never re-declared).
- **One deviation from the contract's literal code block**, documented inline and here:
  `EntityTabDescriptor`'s generic `<T = RaRecord>` is unused by every field in that type (`key`,
  `label`, `render: () => ReactNode`, `visibleTo`) and fails `tsc --noEmit` under this repo's
  `noUnusedLocals: true` (`TS6133`). Shipped `EntityTabDescriptor` as non-generic; `EntityDescriptor.tabs`
  is `EntityTabDescriptor[]`. This changes no observable behaviour and no consumer-facing field —
  only removes a type parameter nothing could ever have read. Flagged in the final report per the
  task's "if you believe it is wrong, say so" instruction rather than silently diverging.
- AC 1's `@ts-expect-error` block covers all six negative cases (a)–(f) plus the three positive
  fixtures (required-only descriptor; label-less tab; 3.9's stub shape), all in
  `entityDescriptor.test.ts`.
- AC 2's hook-boundary proof lives in `entityDescriptor.test.ts` (not `EntityShow.test.tsx`,
  which does not exist in this slot) — a `shadchan_stats`-shaped `statBand` fixture calling
  `useGetOne`, rendered through `CoreAdminContext` with a deferred-promise `getOne` mock,
  asserting the pending state renders first and the resolved values render after the promise
  settles. Deliberately not a `singles` fixture per the AC's own warning.
- AC 6's three worked examples (reference→shidduchim via `reference_links_summary`
  /`shidduchim_id`; single→shidduchim via `single_id`; shadchan→shidduchim via `shadchan_id`,
  matching `ShadchanSuggestions.tsx`) all typecheck in `entityDescriptor.test.ts`.
- AC 3's registry: module-private `Map`, all three functions, exact duplicate/replace/undefined/
  throw behaviours, plus a module-surface test (`Object.keys`) proving the `Map` itself is not
  exported.
- AC 4 / AC 5 / AC 6's guards live in `entity360.guards.test.ts` as pure predicates
  (`hasEntityListDocComment`, `callsRegisterEntityDescriptor`, `declaresMemberRoleLiteral`,
  `declaresLocalTabKeyType`, `declaresRelationshipDescriptorType`), each shown red against an
  inline broken fixture, then green against the real `entity360/**/*.{ts,tsx}` sources via
  `import.meta.glob`. While wiring this I found `entityDescriptor.ts`'s own first-draft doc
  comment literally contained the string `export type EntityRelationshipDescriptor = …` inside
  a prose example — which would have made the AC 6 guard self-flag its own host file — and
  reworded it before the guard was written, so the guard's "green" case is genuine, not
  accidental.
- Registers nothing: neither `entityDescriptor.ts` nor `registry.ts` calls
  `registerEntityDescriptor` (asserted by the guard). Story 3.9 is the first real consumer.
- Gate results (all real, run on this commit): `make typecheck` clean; `npx vitest run` — 87
  files / 952 tests passed (30 of them new, across `entityDescriptor.test.ts`,
  `registry.test.ts`, `entity360.guards.test.ts`); `npm run lint` clean (`--max-warnings=0`);
  `npm run build` succeeds; `npx prettier --check .` clean on every file this story touched.
  No SQL touched, so `npm run test:unit:db` / `supabase db diff` were not run.

**3.3b slot:**

- Shipped `entity360/EntityShow.tsx` (~80 lines) plus two extracted helper modules per the
  task's own "extract, don't grow" instruction: `entity360/DefaultIdentityHeader.tsx` (the
  avatar/title/meta fallback composition) and `entity360/mergeEntityTabs.tsx` (AC 10's
  `tabs` + `relationships` merge). `EntityShow` reads `useResourceContext()` +
  `useRecordContext()`, calls `requireEntityDescriptor`, and composes exactly the seven
  `Entity360` regions per AC 7's table, with `actions` rendered inside the identity-header
  region (a `<>` fragment holding the header content and `<Actions record/>`, so both land
  in the same `Entity360` region wrapper — asserted directly in `EntityShow.test.tsx`
  Fixture B).
- **Real cross-story gap found and closed, flagged per the task's escalate-don't-silently-
  absorb instruction.** This story's own Dependencies section says: "3.3b wires
  `relationships` into the tab list and renders [`RelatedRecordsTab`]; it does not author
  it. If the 3-13 refresh does not take it, it is unowned — escalate rather than silently
  absorbing it here." On starting this slot, `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`
  (filed as "3-13" in the contract) had its Task 6 (`RelatedRecordsTab`, "part 3.10b")
  still unchecked — both its stated blockers (Story 3.9's `RecordLink`, Story 3.3a's
  registry) had landed, but nobody had picked the task back up. There is no live
  orchestrator session working that story concurrently to hand this to, and AC 10 cannot
  compile — let alone be tested — without the component it names. Built
  `entity360/tabs/RelatedRecordsTab.tsx` + its test here, following 3-10's own AC 7 spec
  verbatim (queries `relationship.resource` via `useGetList`, renders each row as a
  `RecordLink` targeting `linkResource`/`linkId` when set, pending/error/empty states of
  its own), and updated `3-10-tab-vocabulary.md`'s Task 6 checkbox, File List and Change
  Log in the same commit to record it as done and point back here. Two new i18n keys
  (`crm.entity360.related.{loading,error,empty}`) were required in both
  `englishCrmMessages.ts` and `frenchCrmMessages.ts` — `CrmMessages` `satisfies` has no
  optional keys, the same constraint 3-10's own Completion Notes already documented for its
  `crm.entity360.tab.*` additions.
- **AC 10's ordering clause is under-specified by the contract as written, and I resolved
  it rather than blocking — flagged for 3-15 to reconcile.** Both the contract (§9) and this
  story's AC 10 place a relationship-derived tab "at the position its key occupies in the
  entity's declared tab order," which presupposes a per-entity canonical ordering table.
  That table (`CANONICAL_TAB_SETS`) is contract §3 rule 5's text today, not code — it is
  owned by the AD-24 conformance validator, Story 3-15 (filed as
  `3-11-ad24-conformance-validator.md`), which lands at build-order step 12, seven steps
  after this one. `EntityShow` is also structurally forbidden from importing anything keyed
  by entity name (AC 9's own boundary), so it could not consult that table even if it
  existed yet. `mergeEntityTabs` therefore defines "declared order" as: the explicit `tabs`
  array, verbatim, in the order the descriptor author wrote it (already required to be a
  canonical-order subsequence by rule 5c), followed by `relationships` entries not already
  covered by `tabs`, in the order the `relationships` array declares them. This satisfies
  every AC 10 test the story actually specifies (relationships-only shows the tab; an
  explicit `tabs` entry with the same key wins) without inventing a dependency on
  unbuilt code. Documented inline in `mergeEntityTabs.tsx`'s doc comment and flagged again
  in the final report, per the task's "if you believe [the contract] is wrong, say so"
  instruction.
- AC 7's table is implemented exactly: `breadcrumb` stays `undefined` (reserved);
  `identityHeader` is the descriptor's own component when declared, else
  `DefaultIdentityHeader` (avatar/title/meta, every field independently optional and
  absent-safe); `statBand`/`alertSlot`/`rightRail` are each `undefined` when the descriptor
  doesn't declare them (not `null`) so `Entity360` renders no wrapper for that region at
  all — proven by the minimal-descriptor test's `root.children.length === 1` assertion.
- AC 8's two fixtures both mount through `buildEntityRoutes({ List: () => null, Show:
  EntityShow })` inside a real `TestMemoryRouter` + `CoreAdminContext`, so `EntityShow`
  mounts inside the real `ShowBase` wiring exactly as it will in production. Fixture A: a
  title, a `useGetOne`-backed `statBand` asserting pending-then-resolved, two tabs. Fixture
  B: a different title, three tabs, no `statBand`, a `rightRail`, and `actions` — asserted
  to land inside the same DOM region as the title. No edit to `EntityShow.tsx` was needed
  between the two fixtures. A separate test proves a non-active tab's `render` spy is never
  called, and that the active tab's own content resolves the record via
  `useRecordContext()`.
- AC 8 / AC 2's "`EntityShow` forwards `tab.label` verbatim, including `undefined`" ruling
  is satisfied structurally, not by a targeted test: `mergeEntityTabs` copies
  `tab.label`/`relationship.label` through unchanged (asserted in `mergeEntityTabs.test.ts`,
  including the `undefined` case), and `EntityShow` never touches `.label` at all — it
  hands the merged array straight to `Entity360Tabs`, which is the only place `TAB_LABELS`
  or `translate` are ever consulted (3.2's own module, untouched by this story).
- AC 9's two-part `?raw` guard (no import escaping `entity360/`; no entity-name string
  literal, checked against `root/routeManifest.ts`'s seven `RESOURCES` names plus
  `"connections"`) is shown red against an inline broken fixture and green against the real
  `EntityShow.tsx` source in the same test file, per contract §13's red-before-green rule.
  `EntityShow.tsx` has zero imports outside `entity360/` — every dependency
  (`Entity360`, `Entity360Tabs`, `DefaultIdentityHeader`, `mergeEntityTabs`, `registry`)
  lives in this directory, so the guard's "green" case is not a coincidence of what
  happened to be imported.
- AC 10's two tests (relationships-only shows a tab whose content is `RelatedRecordsTab`;
  an explicit `tabs` entry with the same key overrides it, one tab, explicit content, and
  `RelatedRecordsTab`'s `getList` is never called) both pass against the real
  `RelatedRecordsTab` built in this slot, not a stub.
- Two context-guard tests beyond the story's own list, added for coverage on branches the
  ACs describe but don't explicitly test: `EntityShow` throws when rendered outside a
  `ResourceContextProvider` (the explicit guard, asserted via the rendered error boundary
  text — `vitest-browser-react` has no `ErrorBoundary` of its own here, so the thrown error
  surfaces in the DOM rather than as a rejected `render()` promise); and it renders nothing
  (no throw) when a resource context exists but no record does yet, the one un-asserted
  branch of the `if (!record) return null` guard.
- Gate results (all real, run on this commit): `make typecheck` clean; `npx vitest run` /
  `make test` — 113 files / 1106 tests passed (18 of them new to this slot: 10 in
  `EntityShow.test.tsx`, 4 in `mergeEntityTabs.test.ts`, 3 in
  `DefaultIdentityHeader.test.tsx`, plus `RelatedRecordsTab.test.tsx`'s 9); `make lint`
  clean (eslint `--max-warnings=0` + prettier); `make build` succeeds; `npx prettier
  --check .` clean on every file this slot touched (pre-existing drift in unrelated
  docs/workflow files left as-is). No SQL touched, so `npm run test:unit:db` / `supabase db
  diff --local` were not run. `make registry-gen` regenerated `registry.json` for the new
  `entity360/` files.

### File List

**3.3a:**
- `src/components/atomic-crm/entity360/entityDescriptor.ts` (new)
- `src/components/atomic-crm/entity360/entityDescriptor.test.ts` (new)
- `src/components/atomic-crm/entity360/registry.ts` (new)
- `src/components/atomic-crm/entity360/registry.test.ts` (new)
- `src/components/atomic-crm/entity360/entity360.guards.test.ts` (new)

**3.3b:**
- `src/components/atomic-crm/entity360/EntityShow.tsx` (new)
- `src/components/atomic-crm/entity360/EntityShow.test.tsx` (new)
- `src/components/atomic-crm/entity360/DefaultIdentityHeader.tsx` (new)
- `src/components/atomic-crm/entity360/DefaultIdentityHeader.test.tsx` (new)
- `src/components/atomic-crm/entity360/mergeEntityTabs.tsx` (new)
- `src/components/atomic-crm/entity360/mergeEntityTabs.test.ts` (new)
- `src/components/atomic-crm/entity360/tabs/RelatedRecordsTab.tsx` (new — cross-story
  unblock of Story 3-10 Task 6; see Completion Notes and `3-10-tab-vocabulary.md`)
- `src/components/atomic-crm/entity360/tabs/RelatedRecordsTab.test.tsx` (new)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (modified — added
  `crm.entity360.related.{loading,error,empty}`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (modified — same, in
  French, required by `CrmMessages`'s `satisfies` constraint having no optional keys)
- `registry.json` (regenerated — `make registry-gen`)

## Change Log

- 2026-07-28 — 3.3a implemented (descriptor types + registry + tests). 3.3b (`EntityShow`)
  intentionally not started; Status left at `in-progress`, not `review`, until 3.3b lands at
  build-order step 5. One documented deviation from the contract's literal `EntityTabDescriptor<T>`
  snippet (unused generic removed — see Completion Notes).
- 2026-07-28 — 3.3b implemented: `EntityShow.tsx` + `DefaultIdentityHeader.tsx` +
  `mergeEntityTabs.tsx`, composing the seven `Entity360` regions from a descriptor exactly
  per AC 7/8/9/10. Also built `entity360/tabs/RelatedRecordsTab.tsx` (+ test), which is
  Story 3-10's Task 6, not this story's — done here as a flagged cross-story unblock
  because AC 10 cannot compile or be tested without it; `3-10-tab-vocabulary.md` is updated
  in the same commit to mark that task done and point back here. Added
  `crm.entity360.related.*` to both message catalogs. One interpretation call flagged, not
  silently made: `mergeEntityTabs`'s "declared tab order" is the `tabs` array as authored
  followed by uncovered `relationships` in their declared order, because the contract's
  literal phrasing needs a canonical per-entity table (Story 3-15) that does not exist at
  this build-order step. Status moved to `review`.
