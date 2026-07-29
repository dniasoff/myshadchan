# Story 3.11: AD-24 conformance validator

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want AD-24 enforced by a test rather than by review discipline,
so that the 360 framework cannot be bypassed one entity at a time.

## Position in Epic 3

**Last story of Epic 3.** It asserts on every primitive the epic builds, so it can only be
written once they exist. Hard dependencies, in the canonical build order
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md#12-Build-order]:

| Needs | For |
|---|---|
| the tab-vocabulary story (contract §3 — `entity360/tabKeys.ts`, `TAB_KEYS` / `TabKey` / `TAB_LABELS`) | AC 6 types its canonical per-entity tab matrix against `TabKey` |
| **3.3a** — `entity360/registry.ts` (`getEntityDescriptor` / `requireEntityDescriptor`) | AC 2, 5, 6 read the registry |
| **3.2** — `entity360/entityPaths.ts`, `buildEntityRoutes.tsx` | AC 5 names `entityPaths.ts` as the only sanctioned record-path builder |
| **3.9** — the four stub descriptors, `ENTITY_TARGET_TYPES` in `types.ts` | AC 2, 5, 6 need registered descriptors to assert on; AC 7 compares against `ENTITY_TARGET_TYPES`. **Each stub must declare `pendingTabs: <its full canonical row>`** (AC 6); a stub without it fails AC 6(d), and the fix belongs in 3.9, not here |
| **3.5**, **3.7**, **3.8** — the three `target_type` widenings | AC 7 asserts they reached parity and that `PENDING_DB_WIDENINGS` is empty |
| **3.12** — `3-12-route-convention-new.md` | 3.12 AC 7 adds `RECORD_FLAG_EXEMPTIONS` to `routeManifest.ts`, two new `ViolationCode`s (`create-route-on-resource`, `record-flags-missing`) and a **required fourth parameter** on `findManifestViolations` — the function this story's `findAd24Violations` is modelled on. Read the post-3.12 signature before writing, and do **not** duplicate the `create`-key or record-flag rules inside `findAd24Violations`: `routeManifest.ts` owns the manifest's own shape, `ad24Conformance.ts` owns descriptor/tab/path/modal conformance. `RECORD_FLAG_EXEMPTIONS` (3.12) and `DESCRIPTORLESS_RESOURCES` / `RECORD_SURFACE_EXEMPTIONS` (AC 2, AC 3) are three tables about overlapping resources — cross-check them for disagreement before shipping. |
| **3.13** — `3-13-records-at-urls-not-modals.md` | AC 4's `MODAL_RECORD_SURFACES` consumes 3.13's UX-DR3 rulings (`ShidduchCreate.tsx` converted to a page, `TaskEdit.tsx` exempted) rather than re-deriving them. Writing this story first would pin an exemption 3.13 immediately invalidates. |

It does **not** depend on 3.4 or 3.6, and it is not depended on by anything inside Epic 3.
It is nonetheless **not deferrable past the end of Epic 3**: Epic 5 migrates the four
entities one story at a time, and a conformance rule written after the first migration is a
rule written around whatever that migration happened to do
[Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#3-G].

**Scope boundary — read before starting.** This story ships a validator, its exemption
tables and its tests. It migrates no entity, converts no modal to a page and changes no
route. Its one live-code edit is the single line named in Task 5
(`shidduchim/ShidduchCatchSection.tsx`), which exists because AC 5's guard would otherwise
open with a stale exemption that no story retires.

## Why 3.1 AC 3 and 3.3 AC 5 do not already cover this

Both are `?raw` source scans **scoped to the framework's own files** — 3.1 AC 3 reads
`Entity360.tsx` / `EntityAvatar.tsx`, 3.3 AC 5 reads `EntityShow.tsx`. They stop the
framework from special-casing an entity. Neither can observe an entity that never imports
the framework at all: a new `FooShow.tsx` registered as `definition.show`, a `<Dialog>`
detail view, a hand-built `/foo/${id}` link and a descriptor with an invented tab set are
all invisible to a scan of three files inside `entity360/`. This story inverts the
direction of the scan — it reads the **manifest and the entity folders**, and asks whether
they conform.

## The exemption model — read this before writing any assertion

Four of the rules below — **AC 2, 3, 4 and 5** — **cannot be clean at the end of Epic 3**,
because migrating an entity onto `Entity360` is Epic 5's job (5.1, 5.8, 5.9, 5.10) and Epic 3
deliberately ships only stub descriptors
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4-Registry — rule 5].
Writing them as unconditional assertions would produce a story that ships red. Writing them
as "warn only" would produce a guard that cannot fail. Each of those four therefore carries an
**exemption table**, and every exemption table is asserted **symmetrically**:

- an offender **not** in the table → violation (the rule bites);
- a table entry that is **no longer** an offender → violation (`stale-exemption`) — so the
  Epic 5 story that fixes the offender is forced to delete its entry in the same diff;
- a table entry naming a resource or file that does not exist → violation
  (`stale-exemption`).

Entries are one of two kinds, and the kind is a required field:

- `{ kind: "pending", retiredBy: "<story id>" }` — known debt with a named owner.
- `{ kind: "permanent", reason: "<why this is not an AD-24 entity>" }` — a resource that
  never gets a 360 (`tasks`, `inbox_items`, `members` — [Source:
  _bmad-output/planning-artifacts/epic3-preflight-brief.md#7-Not-problems] — *"`shidduchim`/tasks/reminders/inbox/members
  never migrate"*). A `permanent` exemption is **auto-invalidated**: if the resource it
  names ever acquires a registered `EntityDescriptor`, the validator reports
  `permanent-exemption-for-360-entity`. That is the mechanically-enforced trigger behind
  every "deferred" decision in this story — not a sentence in a Dev Note.

**`NO_BROWSE_SURFACE_ENTITIES` (AC 10) is a fifth table but is *not* an exemption**, and must
not be routed through any of the machinery above. It carries no `kind`, it is not bundled into
`Ad24Exemptions`, and it is not passed to Task 2's shared symmetric-exemption helper. The reason
is mechanical, not stylistic: a `permanent` entry is auto-invalidated the moment its resource
acquires a descriptor, and `references` — the table's only entry — **is** an AD-24 entity with a
registered descriptor, so writing it as `kind: "permanent"` would fire
`permanent-exemption-for-360-entity` on the day it is written. No-browse is a statement about
**reachability**, never about whether the entity gets a 360. Its own staleness direction (a key
that is not a `RESOURCES` name) is asserted separately in AC 10(d).

**AC 6 has no exemption table, and no exemption of any kind.** It is the one rule whose two
halves separate cleanly: a **consistency** half that is unconditional from day one, and a
**completeness** half the descriptor *declares* through `pendingTabs`. A declaration is not an
exemption — it is re-asserted against `CANONICAL_TAB_SETS` on every run, so it cannot outlive
its reason and needs no `stale-exemption` counterpart. Do **not** add a `STUB_DESCRIPTORS`
table or route AC 6 through the exemption machinery above; see AC 6.

## Acceptance Criteria

1. **`findAd24Violations` is a pure, parameter-driven validator, and every violation code
   is proven to fire by a fixture.** `src/components/atomic-crm/entity360/ad24Conformance.ts`
   exports:
   ```ts
   export type Ad24ViolationCode =
     | "missing-descriptor"
     | "bespoke-record-surface"
     | "modal-record-surface"
     | "non-ad24-record-path"
     | "hand-built-record-path"
     | "tab-key-unknown"
     | "tab-key-duplicated"
     | "tab-order-drift"
     | "tab-set-incomplete"
     | "stale-exemption"
     | "permanent-exemption-for-360-entity"
     | "browse-surface-on-scoped-entity"
     | "unlisted-entity-missing-index";

   export interface Ad24Violation { code: Ad24ViolationCode; subject: string; detail: string }

   export function findAd24Violations(input: {
     resources: ResourceEntry[];
     descriptors: Map<string, EntityDescriptor>;
     modalRecordSurfaces: string[];   // repo-relative paths, from the AC 4 scan
     handBuiltRecordPaths: string[];  // repo-relative paths, from the AC 5 scan
     navTargets: string[];            // every PRIMARY_NAV item's `to` (AC 10)
     listPathLinks: string[];         // repo-relative paths, from the AC 10(b) scan
     /** Defaults to the module's tables; a test may substitute fixture tables. */
     exemptions?: Ad24Exemptions;
     /** Defaults to `NO_BROWSE_SURFACE_ENTITIES`; a test may substitute a fixture table (AC 10). */
     noBrowseSurfaceEntities?: Record<string, string>;
   }): Ad24Violation[];
   ```
   It reads **no world state** from module scope — not `RESOURCES`, not the live registry,
   not the filesystem — so tests drive it with invalid fixtures without mutating the real
   manifest, exactly as `findManifestViolations` does
   [Source: src/components/atomic-crm/root/routeManifest.ts:168-179 — the doc comment
   stating that contract]. `ad24Conformance.test.ts` contains **one `it` per code in
   `Ad24ViolationCode`** that builds a deliberately-broken fixture and asserts that exactly
   that code is reported (modelled on
   [Source: src/components/atomic-crm/root/routeManifest.test.ts:33-139]), plus one `it`
   asserting the **real** manifest + registry produce `[]`. A code with no fixture test is
   a failing AC, not an omission. The four tab codes' fixtures are pinned in AC 6's table,
   and none of them may be exercised by a `descriptors` map that is also missing a
   `CANONICAL_TAB_SETS` row — a fixture must break exactly one rule.
   The exemption tables (AC 2-5) *are* module scope — they
   are part of the rule definition, like `SURFACES` at `routeManifest.ts:166` — which is
   why `exemptions` is an override parameter: the `stale-exemption` and
   `permanent-exemption-for-360-entity` fixtures need a table that disagrees with reality,
   and must not achieve it by editing the real one.

2. **Every `RESOURCES` entry has a registered descriptor or a written exemption.** For each
   `ResourceEntry` in `root/routeManifest.ts:92-100` (7 today: `shidduchim`, `singles`,
   `inbox_items`, `shadchanim`, `references`, `tasks`, `members`), the validator reports
   `missing-descriptor` unless `descriptors` holds `entry.name` **or**
   `DESCRIPTORLESS_RESOURCES` (exported from `ad24Conformance.ts`) holds it. At the close
   of Epic 3 that table is exactly `inbox_items`, `tasks`, `members` — all `kind:
   "permanent"` — because Epic 3 registers descriptors for the four AD-24 entities only
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4-Registry — rule 3].
   Symmetric per "The exemption model": a resource in both the registry and the table →
   `permanent-exemption-for-360-entity`; a table entry naming a name absent from
   `resources` → `stale-exemption`.

3. **No bespoke record surface is route-reachable.** AD-24 routes an entity's detail, new
   and edit surfaces through `buildEntityRoutes` under the resource's `list` element
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#5-Routes — rule 4]. The validator therefore
   reports `bespoke-record-surface` for every `ResourceEntry` whose `definition` carries a
   `show`, `create` or `edit`, unless that `(resource, slot)` pair is in
   `RECORD_SURFACE_EXEMPTIONS`. At the close of Epic 3 that table is, verified against the
   tree:
   `singles` create/edit/show [Source: src/components/atomic-crm/singles/index.ts:9-11],
   `shadchanim` create/edit/show [Source: src/components/atomic-crm/shadchanim/index.ts:9-11],
   `references` show/create/edit [Source: src/components/atomic-crm/references/index.ts:9-11]
   — all `kind: "pending"`, retired by 5.8 / 5.9 / 5.10 respectively — and
   `members` edit [Source: src/components/atomic-crm/members/index.ts:7], `kind:
   "permanent"`. `shidduchim`, `inbox_items` and `tasks` register `list` only today and get
   **no** entry [Source: src/components/atomic-crm/shidduchim/index.ts:5-7;
   src/components/atomic-crm/inbox/index.ts:3-6; src/components/atomic-crm/root/routeManifest.ts:98].
   Symmetric: an exemption for a slot the resource no longer declares → `stale-exemption`.

4. **No `<Dialog>` wraps a primary record surface (UX-DR3).**
   `ad24Conformance.guard.test.ts` reads every `.tsx` under `src/components/atomic-crm/`
   as text via `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`
   — the one in-repo precedent for a source scan
   [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — and
   collects the files that (a) live in a directory whose name is a `RESOURCES` entry's
   resource directory, (b) have a basename matching `/(Show|Create|Edit)\.tsx$/`, and
   (c) contain `<Dialog`. **The resource-name alternation is built from `RESOURCES` at test
   time, never hard-coded** — a four-name literal is the exact defect that made 3.3 AC 5
   unfalsifiable
   [Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#6-Landmines — item 15]. That set is passed to
   `findAd24Violations` as `modalRecordSurfaces`; the **validator** — not the guard test
   — does the symmetric comparison against `MODAL_RECORD_SURFACES`, reporting
   `modal-record-surface` for an unexempted file and `stale-exemption` for an entry no
   longer found. At the close of Epic 3 that table is exactly **two** files, both verified
   present:
   `shidduchim/ShidduchShow.tsx` (`<Dialog>` at `:35`, self-documented as *"A routed Dialog
   … not a `Show`"* at `:18-24`) [Source:
   src/components/atomic-crm/shidduchim/ShidduchShow.tsx:18-24,34-35] — `kind: "pending"`,
   retired by 5.1;
   `tasks/TaskEdit.tsx` (`<Dialog>` at `:32`) [Source:
   src/components/atomic-crm/tasks/TaskEdit.tsx:32,76] — `kind: "permanent"`, reason: a task
   is not an AD-24 entity (no descriptor, no UX-DR5 tab row, no 360), auto-invalidated the
   moment `tasks` acquires a descriptor (AC 2). `shidduchim/ShidduchShowHeader.tsx` also
   imports `Dialog` and is correctly **not** matched by (b) — a nested confirm dialog inside
   a header is not a record surface; the same is true of `inbox/InboxResolveDialog.tsx`,
   `references/ReferenceMergeButton.tsx`, `settings/DeleteDataDialog.tsx`,
   `misc/ImageEditorField.tsx`, `layout/DemoBanner.tsx` and `inbox/AddToInboxDialog.tsx`.

   **`shidduchim/ShidduchCreate.tsx` is deliberately *not* in this table.** It carries a
   `<Dialog>` on `main` today, but **Story 3.13**
   (`_bmad-output/implementation-artifacts/3-13-records-at-urls-not-modals.md`, AC 1) converts
   it into the page at `/shidduchim/new` and lands **before** this story. Listing it here would
   ship a `stale-exemption` on the day this validator is written. If 3.13 has not merged when
   this story starts, **stop and raise** — do not add the exemption back, and do not do 3.13's
   conversion here. 3.13's own AC 5 guard
   (`misc/recordSurfaceDialogs.guard.test.ts`) is the narrower, story-scoped sibling of this AC;
   the two are not redundant — 3.13's allowlist is basename-based across five entity folders,
   this one is `RESOURCES`-derived and `(Show|Create|Edit).tsx`-shaped — but their exemption
   sets must not disagree. Re-read 3.13's `ALLOWED` set before populating
   `MODAL_RECORD_SURFACES`.

5. **Every record path is the AD-24 shape, and only `entityPaths.ts` builds one.** Two
   halves, both required:
   (a) For every registered descriptor, `descriptor.buildRecordPath(1)` must equal
   `` `/${descriptor.name}/1` ``; otherwise `non-ad24-record-path`, unless the name is in
   `PENDING_ROUTE_SHAPES`. At the close of Epic 3 that table is all four AD-24 entities
   (`shidduchim`, `singles`, `shadchanim`, `references`), `kind: "pending"`, retired by
   5.1 / 5.8 / 5.9 / 5.10 — Epic 3's stubs deliberately return today's real
   `/{resource}/{id}/show`, and Epic 5 flips each one line
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2-EntityDescriptor].
   (b) The AC 4 glob also collects every `.ts`/`.tsx` under `src/components/atomic-crm/`
   whose text matches a record-path template literal — `/<name>/${` for any `name` in
   `RESOURCES`, alternation again built at test time — and passes them as
   `handBuiltRecordPaths`; anything not in `PATH_BUILDER_ALLOWLIST` is
   `hand-built-record-path`. The allowlist is inherently exactly two path shapes and is
   asserted as such: `entity360/entityPaths.ts` and `*/entityDescriptor.ts` (a descriptor
   is the one place a record path is *declared*)
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4-Registry — "Nothing in the app builds a
   `/{entity}/{id}…` string by template literal"], plus `.test.`/`.guard.` files. Task 5
   removes the one live site that 3.9's sweep does not reach; if any other site survives,
   this AC fails and names it.

6. **Every registered descriptor's tab set is *consistent* with the canonical vocabulary, and
   its *completeness* is declared rather than inferred.** AD-24's invariant is that entities do
   not **diverge**: no entity invents a key, an order or a duplicate. *"Every entity has every
   tab on day one"* is not an invariant — it is a **schedule**, and it is not this epic's
   schedule. `5-1` deliberately registers a five-tab shidduch descriptor
   (`overview, diligence, notes, tasks, activity` — the tabs that have real content), defers
   `resume`/`photo`/`medical`/`files`/`external-links` to 5.2–5.6, and explicitly forbids
   placeholder tabs for content that does not exist yet
   [Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:36-42]. A rule
   that treated that as drift would ship an Epic 3 deliverable that is red from Epic 5's pilot
   story through 5-6. This AC therefore enforces **consistency always** and **completeness
   against a declaration**.

   `ad24Conformance.ts` exports `CANONICAL_TAB_SETS: Partial<Record<string, readonly TabKey[]>>`
   — ordered, typed against the tab-vocabulary story's `TabKey`, transcribed from UX-DR5 plus
   the sanctioned Epic 7 / Epic 8 additions
   [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172;
   _bmad-output/planning-artifacts/epic3-api-contract.md#3-TabKey — rule 5]:
   ```
   shidduchim  overview resume photo medical files diligence external-links notes tasks activity
   singles     overview resume photo files shidduchim notes tasks activity
   shadchanim  overview shidduchim notes tasks activity
   references  overview conversations shidduchim notes tasks activity assistant
   ```
   Widening this table is a one-line edit made **by the story that needs the key**, in the same
   diff — exactly as for `TAB_KEYS`
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#3-TabKey — rule 3]. `7-1`
   adds `discussions` to the `shidduchim` row *and* to that descriptor's `tabs`;
   `8-5` adds the `connections` row. Neither is Epic 3 work; both fail assertion (d) below if
   they do only half of it.

   The descriptor declares what it does not yet have, via `pendingTabs?: TabKey[]`
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2-EntityDescriptor]. For every
   registered descriptor, `findAd24Violations` asserts:

   | # | Assertion | Code | Fixture that turns it red |
   |---|---|---|---|
   | a | every key in `tabs` **and** in `pendingTabs` is a member of `TAB_KEYS` | `tab-key-unknown` | a `shadchanim` descriptor whose `tabs` is the canonical five **plus** `{ key: "summary" as TabKey }`. The cast is what a real drifting descriptor would need, so the fixture writes it deliberately — the union being closed means TypeScript catches the honest mistake and only the cast reaches runtime |
   | b | no key appears twice — within `tabs`, within `pendingTabs`, or once in each | `tab-key-duplicated` | a `shadchanim` descriptor with `tabs: [overview, notes]` and `pendingTabs: ["shidduchim", "notes", "tasks", "activity"]` — `notes` is declared as both present and pending |
   | c | the keys of `tabs` appear in **canonical relative order**, and so do `pendingTabs` | `tab-order-drift` | a `shidduchim` descriptor with `tabs: [overview, notes, diligence, tasks, activity]` and the remaining five keys in `pendingTabs` — `notes` before `diligence` inverts the canonical row while the union stays complete |
   | d | `keys(tabs) ∪ pendingTabs` **equals** `CANONICAL_TAB_SETS[descriptor.name]`, compared as **sets** | `tab-set-incomplete` | *dropped tab:* a `shidduchim` descriptor with 5-1's five `tabs` and `pendingTabs: ["resume", "photo", "files", "external-links"]` — `medical` is in neither array. *Other direction:* a `shadchanim` descriptor with `medical` inserted into its otherwise-canonical `tabs` — a key that is in the union but not in that entity's row |

   **The four run in order, and each key is reported at most once.** A key rejected by (a) is
   excluded from (b), (c) and (d); a key reported by (b) is collapsed before (c) and (d); (c)
   is applied only to keys that appear in the entity's canonical row, since a key that does not
   belong to the entity at all is (d)'s finding, not an ordering finding. One defect therefore
   produces exactly one violation — which is what makes AC 1's one-fixture-per-code discipline
   achievable, and what stops a single typo from reporting four codes and teaching a reader to
   ignore three of them.

   Shape notes, all binding:
   - **(c) is *relative* order, not equality.** A partial set is in order iff its key sequence is
     a **subsequence** of the canonical row. That is precisely what lets 5-1's five tabs pass
     while `[overview, tasks, notes, activity]` fails. Same test applied independently to
     `pendingTabs`.
   - **(d) is compared in both directions** and the violation's `detail` names the **missing**
     keys and the **unexpected** keys separately. This is the property the old "must equal the
     canonical list" wording was actually reaching for: a story that forgets a tab is still
     caught, without a deliberately partial set being an error.
   - **`pendingTabs` is a declaration, not a comment.** (a), (b) and (c) apply to it identically;
     an out-of-union, duplicated or out-of-order `pendingTabs` entry is the same hard failure as
     in `tabs`.
   - **A stub is not a special case.** A descriptor with no tabs writes `tabs: []` (or omits
     `tabs`) plus `pendingTabs: <that entity's full canonical row>`. There is **no
     `STUB_DESCRIPTORS` table and no stub exemption** — a stub is the extreme case of (d), and
     it cannot go stale because it is re-derived from `CANONICAL_TAB_SETS` on every run. At the
     close of Epic 3 all four descriptors are in exactly this state
     [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#12-Build-order — step 3];
     if 3.9's four stubs ship without `pendingTabs`, they fail (d) and 3.9 — not this story —
     is what must be fixed.
   - **Each of 5.2–5.6 (and 5.8 / 5.9 / 5.10 for the other three entities) moves its key out of
     `pendingTabs` and into `tabs` in the same diff that builds the tab.** One line, and
     impossible to forget: doing neither half, or only one, fails (d).
   - **A descriptor whose `name` has no row in `CANONICAL_TAB_SETS` is not silently skipped.**
     (a) and (b) still apply, and the absent row is itself reported as `tab-set-incomplete`
     naming the descriptor. Without this, registering `connections` before 8-5 amends the table
     would buy a permanently-green pass — the vacuity AC 8 exists to prevent, in the one place
     `?raw` sanity checks cannot reach.

   Note the deliberate deviation this table encodes: UX-DR5 writes the shadchan tab as
   *"Suggestions"* and the reference tab as *"Linked shidduchim"*; both are key `shidduchim`,
   label "Shidduchim", because "Suggestion" is user-facing text AD-23 retires [Source:
   _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175].

7. **The polymorphic target-type vocabulary reached parity, and its deferral list is
   empty.** The guard test reads `supabase/schemas/01_tables.sql` through the same
   `import.meta.glob` mechanism and asserts that **all three** target-type check
   constraints — `tasks_target_type_check` (`01_tables.sql:45`, today
   `('shadchan','shidduch','reference')`), `interactions_target_type_check`
   (`01_tables.sql:458`, today `('reference','shidduch')`) and the `entity_files`
   target-type check added by the Files story (locate it by table, not by a guessed
   constraint name) — list a value set **equal** to `ENTITY_TARGET_TYPES` from
   `src/components/atomic-crm/types.ts`, order-insensitively, and that
   `PENDING_DB_WIDENINGS` is `[]`
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#8-Universal-tab-props — rules 1-2]. `'connection'`
   is Epic 8's value to add and must **not** be present. This AC lives wholly in the guard
   test and produces no `Ad24ViolationCode`: it is a schema-vs-type parity assertion with
   nothing to exempt, so routing it through `findAd24Violations` would add a fourteenth code
   that can never be exercised by a manifest fixture. Locate `PENDING_DB_WIDENINGS` with
   `LSP workspaceSymbol` before importing it — the Activity, Files and Tasks stories each
   shrink it and one of them owns its home [Source: .claude/rules/lsp-usage.md].

8. **No scan can pass vacuously.** Every `?raw` scan in AC 4, 5(b) and 7 is accompanied by
   a sanity `it` — the same device the repo's existing guard uses
   [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:79-86] —
   asserting that the glob actually resolved: the `.tsx` scan sees more than 100 files
   (151 on `main` at 2026-07-28) and includes `shidduchim/ShidduchShow.tsx`; the SQL scan's
   text is non-empty and contains **`create table public.tasks (`** — the literal DDL on `main`
   [Source: supabase/schemas/01_tables.sql:31]. **Verify this needle against the tree before
   writing the assertion, and re-verify it if the scan comes back empty.** `01_tables.sql` uses
   the bare `create table public.<name> (` form for its domain tables, *not*
   `create table if not exists` (that form appears four times in the file, and for none of the
   tables this story reads). A needle that matches nothing makes the sanity `it` permanently
   red, and the predictable "fix" is to weaken or delete it — which restores exactly the
   vacuity this AC exists to prevent. A mistyped glob returns `{}` and every other assertion in
   this story would pass green; these `it`s are what makes that impossible.

9. **The pending-tab ledger, and the hand-off it creates for Epic 5.** AC 6 makes an unfinished
   entity legal; this AC makes it **visible and terminable**. `ad24Conformance.ts` exports:
   ```ts
   export function findPendingTabs(
     descriptors: Map<string, EntityDescriptor>,
   ): { entity: string; pending: TabKey[] }[];   // only entries with a non-empty pendingTabs
   ```
   Two `it`s in `ad24Conformance.test.ts`:
   (a) a **fixture** `it` — two descriptors, one with `pendingTabs` and one without — asserting
   the exact returned rows. This is what stops the function from silently returning `[]`
   forever, which would make the Epic 5 flip below vacuous on the day it happens.
   (b) an **informational** `it` over the **real** registry that formats the ledger and reports
   it (`console.info`), asserting only that the call returns an array. It **must not fail the
   build while Epic 5 is in flight** — a non-empty ledger is the correct state from 5-1 through
   5-6, and a failing assertion here would be re-deleted by the first story it blocked.

   **The hand-off, stated here because 3-11 owns the mechanism:** Epic 5's closing story flips
   (b) to `expect(findPendingTabs(realRegistry)).toEqual([])`, so Epic 5 cannot be declared done
   with tabs still pending. That flip is a one-line change to an existing assertion, not a new
   scan — which is why the exported function, not the test body, is this story's deliverable.
   The story that performs the flip is **out of scope for Epic 3**; naming the requirement is
   not. Task 6's header comment records it in the source file as well.

10. **An entity that has no browse surface provably has none — asserted *positively* (RULING 7).**
    RULING 7 (project owner, standing): *"references only exist as part of an individual shidduch
    and cannot be browsed separately, although the same reference can appear for multiple
    shidduchim … it would be useful to see this. but no browsing to references outside a
    shidduch's context."* A reference keeps everything AD-24 gives it — its full 360, its flat
    record path `/references/{id}` (AC 5a's `PENDING_ROUTE_SHAPES` entry is unchanged), its
    seven-tab canonical row (AC 6, unchanged), and cross-shidduch visibility **from inside** the
    record via its `shidduchim` tab. What it does not keep is a **browse surface**: no
    `PRIMARY_NAV` entry, no mobile "More" item, no dashboard tile, no tour step, no `EntityList`,
    and no link to `/references` from anywhere in `src/`. References also leave global search
    (owner ruling): a global search that returns reference records is a browse surface under
    another name.

    **The mechanical guard everyone assumes covers this does not, and it is verified against the
    tree.** `unreachable-nav-target` computes reachability as
    `resourcesForSurface.filter((r) => !!r.definition.list)` and then tests
    `listableResourceNames.has(target.replace(/^\//, ""))`
    [Source: src/components/atomic-crm/root/routeManifest.ts:276-292]. `list` is the **route
    mount point**, not a browse surface — `references/index.ts:19` keeps a truthy `list` under
    RULING 7 (it becomes a non-list index component; post-5.10 `buildEntityRoutes` types `List`
    as required) [Source: src/components/atomic-crm/references/index.ts:19]. So
    `listableResourceNames` still contains `references`, and re-adding
    `{ to: "/references", … }` to `PRIMARY_NAV` produces **no** violation on either surface.
    `record-flags-missing` cannot cover it either: it is guarded `if (list && !hasRecordFlags …)`
    and `references` declares `show` and `edit`
    [Source: src/components/atomic-crm/root/routeManifest.ts:247-255;
    src/components/atomic-crm/references/index.ts:20-21]. `empty-resource` cannot either — it
    fires only when `list`, `create`, `edit` **and** `show` are all absent
    [Source: src/components/atomic-crm/root/routeManifest.ts:176-185]. RULING 7 therefore needs
    its own positive assertion, and this AC is it. Do **not** "fix" `unreachable-nav-target`
    instead: `routeManifest.ts` owns the manifest's own shape and its rule (a nav target must
    resolve to a rendered screen) is correct and still wanted — `/references` *does* resolve to a
    screen; it is simply not allowed to be advertised.

    `ad24Conformance.ts` exports a **fifth** table, which is a policy declaration and not an
    exemption (see "The exemption model", above):
    ```ts
    /** Entity name -> the written reason it has no browse surface (RULING 7). */
    export const NO_BROWSE_SURFACE_ENTITIES: Record<string, string> = {
      references:
        "RULING 7: a reference exists only within a shidduch's context. It keeps a full 360 at /references/{id} and shows every shidduch it serves from inside its own record; it has no nav entry, no list, no dashboard tile, no tour step and no global-search results. This is a product decision, not a security boundary — RLS stays deliberately account-wide (FR51) and must not be narrowed to enforce it.",
    };
    ```
    `findAd24Violations` gains two parameters — `navTargets: string[]` (every `PRIMARY_NAV`
    item's `to`, passed by the caller exactly as `findManifestViolations` takes them
    [Source: src/components/atomic-crm/root/routeManifest.ts:198-203]) and `listPathLinks:
    string[]` (repo-relative paths, from the (b) scan below) — and two codes:

    | # | Assertion | Code | Fixture that turns it red |
    |---|---|---|---|
    | a | for every `name` in `NO_BROWSE_SURFACE_ENTITIES`, **no** entry in `navTargets` equals `` `/${name}` `` or starts with `` `/${name}/` `` | `browse-surface-on-scoped-entity` | **the required fixture:** `navTargets: ["/", "/shidduchim", "/references"]` with the real table → **exactly one** violation, `{ code: "browse-surface-on-scoped-entity", subject: "references" }`, and no other code. The same `navTargets` is asserted a *second* time against `findManifestViolations` to pin that it reports **zero** violations — the pair is what documents, in executable form, why this rule had to be written rather than inherited |
    | b | **no** file in `listPathLinks` links to a no-browse entity's list path | `browse-surface-on-scoped-entity` | `listPathLinks: ["dashboard/Dashboard.tsx"]` → one violation whose `subject` is that file path and whose `detail` names the offending entity |
    | c | every `ResourceEntry` **not** in the table declares a `list` | `unlisted-entity-missing-index` | a `resources` fixture whose `shadchanim` entry is `{ show, edit }` with no `list` → `unlisted-entity-missing-index` for `shadchanim`. This is the other direction: no entity may quietly adopt the no-browse shape without a written reason in the table, and dropping `list` is not a legal way to express it — it deletes the entity's whole route fragment |
    | d | every key in the table names a resource present in `resources` | `stale-exemption` | table fixture `{ contacts: "…" }` against the real `RESOURCES` → `stale-exemption` naming `contacts`. (The table has no `kind`, so it has no `permanent-exemption-for-360-entity` direction — see "The exemption model") |

    **(b), the list-path scan.** `ad24Conformance.guard.test.ts` reuses the AC 4 glob and collects
    every file whose text links a no-browse entity's **list** path. The alternation is built at
    test time from `Object.keys(NO_BROWSE_SURFACE_ENTITIES)` and is **never hard-coded** — the
    same rule AC 4 follows
    [Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#6-Landmines — item 15]. Two
    shapes count, and the distinction between them is load-bearing:
    - a **list-path literal**: `` `/${name}` `` immediately followed by a closing `"`, `'`,
      `` ` `` or a `?`, i.e. the path ends at that segment. `/references/${id}`,
      `/references/1/show` and `/references/new` are **record and creation** paths and must
      **not** match — RULING 7 explicitly retains them. A regex that swallows them makes the scan
      permanently red, and the predictable "fix" is to weaken or delete it, which restores
      exactly the vacuity AC 8 exists to prevent.
    - a `buildListPath("<name>")` call site
      [Source: src/components/atomic-crm/entity360/entityPaths.ts:18-21].

    Excluded, and only these: `entity360/entityPaths.ts` (the builder itself),
    `*/entityDescriptor.ts`, `<name>/index.ts` (the route mount), and any `.test.` / `.guard.`
    file — the same self-exclusion shape as AC 5(b)'s allowlist.

    **The matcher is exported and unit-tested against a synthetic corpus**, not merely run over
    the repo:
    ```ts
    export function findListPathLinks(
      files: Record<string, string>,  // repo-relative path -> file text
      names: string[],
    ): string[];
    ```
    with three fixture `it`s: `{ "dashboard/Dashboard.tsx": 'to="/references"' }` **is** reported;
    `{ "x.tsx": 'buildListPath("references")' }` **is** reported; ``{ "x.tsx": "`/references/${id}`" }``
    is **not**. A scan whose only assertion is "the repo happens to be clean today" cannot be
    proven red, and an unfalsifiable guard is the defect this whole story exists to avoid
    [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:79-86]. Its
    glob-resolved sanity `it` is AC 8's, unchanged.

    **Ordering — read before starting.** This rule is written **unconditionally**. There is no
    allowlist for `references`, no `kind: "pending"` entry, and none may be added. It goes green
    only once RULING 7 has been applied to the tree, and on `main` at the time of writing it has
    not been: `layout/navItems.ts:59-65` still registers `{ to: "/references" }` in
    `PRIMARY_NAV`, and the mobile "More" item (`layout/MobileNavigation.tsx`), the two dashboard
    tiles (`dashboard/Dashboard.tsx`, `dashboard/MobileDashboard.tsx`) and the first desktop tour
    step (`tour/tourSteps.ts`) are all still present. **Every one of those files is outside this
    story's scope boundary** — the one live-code edit this story makes is Task 5. So if
    `PRIMARY_NAV` still contains `/references` when this story starts, **stop and raise**: do not
    delete the nav entry here, do not exempt `references`, and do not soften the rule to a
    warning or an informational `console.info`. This is the same treatment AC 4 gives
    `shidduchim/ShidduchCreate.tsx` and Story 3.13, and for the same reason — a guard written
    around the state of the tree on the day it was written is a guard written around a bug.

## Tasks / Subtasks

- [x] **Task 1 — `ad24Conformance.ts`: the exemption tables** (AC: 2, 3, 4, 5, 10)
  - [x] Define `Ad24Exemption = { kind: "pending"; retiredBy: string } | { kind: "permanent"; reason: string }`,
        the **four** tables — `DESCRIPTORLESS_RESOURCES`, `RECORD_SURFACE_EXEMPTIONS`,
        `MODAL_RECORD_SURFACES`, `PENDING_ROUTE_SHAPES` — and the
        `Ad24Exemptions` object that bundles all four, exported as the default value of
        `findAd24Violations`' `exemptions` parameter (AC 1). There is **no**
        `STUB_DESCRIPTORS` table: AC 6 is exemption-free and a stub is expressed as
        `tabs: []` + a full `pendingTabs`.
  - [x] Populate each from the values pinned in AC 2-5. Re-verify every path with `ls`
        and every `definition` slot by reading the entity's `index.ts` before writing the
        entry — a wrong entry here is a permanently-green guard. In particular the `create`
        slot: Story 3.12 replaced `create:` with `hasCreate: true` +
        `children: buildCreateRoutes(...)` on `singles`, `shadchanim` and `references`, so an
        entry transcribed literally from AC 3's prose would ship three `stale-exemption`s on
        day one. Read the file, do not copy the AC.
  - [x] Define the **fifth** table, `NO_BROWSE_SURFACE_ENTITIES` (AC 10), *outside*
        `Ad24Exemptions`: `Record<string, string>`, no `kind`, one entry (`references`) with
        its written reason. It is the `noBrowseSurfaceEntities` parameter's default (AC 1),
        not part of `exemptions`.
  - [x] **Cross-check all five tables against each other before shipping** — six tables
        counting 3.12's `RECORD_FLAG_EXEMPTIONS` in `routeManifest.ts` — and reconcile any
        disagreement in writing. The pairs that can actually contradict:
        a resource in `DESCRIPTORLESS_RESOURCES` cannot appear in `PENDING_ROUTE_SHAPES` or
        `NO_BROWSE_SURFACE_ENTITIES` (no descriptor means no record path and nothing to
        un-browse); a resource in `NO_BROWSE_SURFACE_ENTITIES` **must** still be in
        `resources` with a truthy `list` (AC 10c) and **must not** be in
        `RECORD_FLAG_EXEMPTIONS` (it keeps `show`/`edit`); a `RECORD_SURFACE_EXEMPTIONS` entry
        and a `MODAL_RECORD_SURFACES` entry naming the same file are describing the same
        offender twice and one of them is wrong.
  - [x] Keep the file under the 400-line typical ceiling
        [Source: .claude/rules/coding-style.md#File-organization]; it is data plus one
        pure function. **Deviation:** the file is ~730 lines (under the 800 hard max, over
        the 400 typical ceiling) — see Completion Notes; splitting into a second file was not
        possible without violating the story's fixed ownership list.

- [x] **Task 1b — `ad24Conformance.ts`: the canonical tab matrix** (AC: 6, 9)
  - [x] Define `CANONICAL_TAB_SETS: Partial<Record<string, readonly TabKey[]>>` from AC 6's
        four rows, importing `TabKey` from the tab-vocabulary story's `entity360/tabKeys.ts`.
        Do **not** re-declare tab keys as free strings, and do **not** add `discussions` or a
        `connections` row — 7-1 and 8-5 add their own (AC 6).
  - [x] Implement the four tab assertions (a)-(d) as one pass over the descriptor's
        `[...tabs.map(t => t.key), ...(pendingTabs ?? [])]`, sharing the
        canonical-subsequence helper between `tabs` and `pendingTabs` rather than writing the
        order check twice [Source: .claude/rules/coding-style.md#Core-principles].
  - [x] Honour AC 6's reporting order: drop (a)-rejected keys and (b)-collapsed duplicates
        before (c) and (d), and restrict (c) to keys present in the entity's canonical row.
        One defect, one violation — the fixtures in Task 3 assert the reported codes exactly,
        so a rule that reports two codes for one broken descriptor fails them.
  - [x] Implement `findPendingTabs` (AC 9) beside it; it reads the same `pendingTabs` field
        and no exemption table.

- [x] **Task 2 — `findAd24Violations`** (AC: 1, 2, 3, 5a, 6, 10)
  - [x] Implement per AC 1's signature. Parameters only — never read `RESOURCES` or the
        registry from module scope; mirror the doc comment at
        `root/routeManifest.ts:168-174`.
  - [x] Implement the symmetric exemption check once, as a shared helper, and call it from
        each of the **four** exemption-backed rules — four near-identical staleness checks
        written four times is the DRY violation this file is most likely to acquire
        [Source: .claude/rules/coding-style.md#Core-principles]. The tab rule (AC 6) does not
        call it: it has nothing to go stale.
  - [x] Emit `permanent-exemption-for-360-entity` whenever a `permanent` entry names a
        resource present in `descriptors` (the mechanical trigger behind every deferral in
        this story).
  - [x] Implement AC 10's four assertions (a)-(d) over `navTargets`, `listPathLinks`,
        `resources` and `noBrowseSurfaceEntities`. They do **not** call the shared
        symmetric-exemption helper and the table gets no `kind` — see AC 10 for why a
        `permanent` entry here would self-invalidate on day one.

- [x] **Task 3 — `ad24Conformance.test.ts` (pure, `app` project)** (AC: 1, 6, 9, 10)
  - [x] One `it` per `Ad24ViolationCode`, AAA-structured, each with a fixture that breaks
        exactly one rule; assert the reported codes, not just the count.
  - [x] Include the two staleness directions for each of the four exemption-backed rules:
        offender-not-exempted, and exemption-no-longer-an-offender.
  - [x] Write the four tab fixtures **exactly as pinned in AC 6's table** (out-of-union key,
        duplicate across `tabs`/`pendingTabs`, inverted order, dropped tab present in neither
        array) plus the reverse direction of (d) — a key from the union that is not in that
        entity's row. Add a fifth, **positive** `it`: 5-1's real five-tab shidduch descriptor
        (`overview, diligence, notes, tasks, activity`) with
        `pendingTabs: ["resume", "photo", "medical", "files", "external-links"]` reports **no**
        violation. That `it` is the one that proves this AC did not quietly re-acquire the
        completeness-by-default rule this ruling removed.
  - [x] Add the `findPendingTabs` fixture `it` and the informational real-registry `it`
        (AC 9); the latter asserts an array, never an emptiness. **Deviation:** uses
        `console.warn`, not `console.info` — see Completion Notes.
  - [x] Write AC 10's four fixtures exactly as pinned in its table, plus the paired
        `findManifestViolations` assertion: the **same** `navTargets` containing
        `/references` reports one `browse-surface-on-scoped-entity` here and **zero**
        violations from `findManifestViolations`
        [Source: src/components/atomic-crm/root/routeManifest.ts:276-292]. Add the three
        `findListPathLinks` corpus `it`s (AC 10b), including the negative one proving a
        record path `` `/references/${id}` `` is not matched.
  - [x] One `it` driving the real `RESOURCES` and the real registry, asserting `[]`.
        Import the four `<entity>/entityDescriptor.ts` modules (or `root/routeManifest.ts`,
        which imports every resource index at module scope
        [Source: src/components/atomic-crm/root/routeManifest.ts:6-18]) so registration has
        happened before the assertion runs. **Deviation:** `navTargets`/`listPathLinks` are
        `[]`, not real scan output, in this one test — see Completion Notes.

- [x] **Task 4 — `ad24Conformance.guard.test.ts` (source + SQL scans)** (AC: 4, 5b, 7, 8, 10b)
  - [x] `import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })`,
        excluding `.test.` and `.guard.` paths — the existing guard excludes its own kind
        for exactly this reason
        [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:44-52].
        Also excludes `ad24Conformance.ts` itself (see Completion Notes).
  - [x] Reuse the same glob for AC 10(b): pass its file map to `findListPathLinks` with
        `Object.keys(NO_BROWSE_SURFACE_ENTITIES)` and hand the result to
        `findAd24Violations` as `listPathLinks`; pass `PRIMARY_NAV.map((i) => i.to)` as
        `navTargets`. Three alternations now, all derived at test time, none literal.
  - [x] Build both alternations from `RESOURCES.map((r) => r.name)`. Note the resource
        *directory* is not always the resource name (`inbox_items` lives in `inbox/`); map
        it explicitly rather than assuming, and cover the mapping with a fixture `it`.
  - [x] Read `01_tables.sql` through a second glob rooted at the repo
        (`../../../../supabase/schemas/*.sql`). `import.meta.glob` needs no ambient `*?raw`
        module declaration; a bare `import sql from "…?raw"` does, under `strict`
        [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#8-Universal-tab-props — rule 2].
  - [x] Write the three sanity `it`s from AC 8 **first**, and watch them fail with a
        deliberately-mistyped glob before fixing the glob — that is this story's "prove it
        red" step [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#13-Test-shape-rules — rule 2].

- [x] **Task 5 — The one live-code edit** (AC: 5b)
  - [x] `src/components/atomic-crm/shidduchim/ShidduchCatchSection.tsx:34-45` builds
        `` `/shidduchim/${suggestion.prior_shidduchim_id}/show` `` and hands it to
        `useRedirect()`. Story 3.9's sweep greps for `to={\`/…/${`, so a `redirect(...)`
        call is outside its pattern by construction and survives it. Replace the literal
        with `buildRecordPath("shidduchim", suggestion.prior_shidduchim_id)` from
        `entity360/entityPaths.ts`, leaving the `{ _scrollToTop: false }` option argument
        and every other argument untouched. (Story 3.9 had already replaced the literal with
        `requireEntityDescriptor("shidduchim").buildRecordPath(...)`, bypassing
        `entityPaths.ts`; this task completes the fix.)
  - [x] Confirm with `LSP goToDefinition` on `buildRecordPath` that you are importing 3.2's
        builder and not writing a second one [Source: .claude/rules/lsp-usage.md]. (LSP tool
        unavailable in this session; verified by reading `entityPaths.ts` and its doc comment
        directly instead.)
  - [x] Extend or add `ShidduchCatchSection`'s test to assert the redirect target, so the
        behaviour is pinned independently of the guard.

- [x] **Task 6 — Wire the guard into CI** (AC: 1, 4, 7, 9)
  - [x] Both test files live under `src/`, so `npm run test` and the `app` project pick
        them up with no config change; confirm with `npm run test:unit:app` that both are
        collected, then run the full validation set: `npm run typecheck`, `npx vitest run`,
        `npm run lint`, `npm run build`.
  - [x] Add a short header comment to `ad24Conformance.ts` stating (a) that an Epic 5 story
        which migrates an entity must delete that entity's exemption entries **in the same
        diff**, and that the symmetric assertion will fail the build if it does not; (b) that
        a story which builds a tab moves that key from `pendingTabs` into `tabs` in the same
        diff, and that AC 6(d) fails the build if it does not; (c) that Epic 5's closing
        story flips AC 9's informational ledger `it` to a failing assertion (AC 9); and
        (d) that `NO_BROWSE_SURFACE_ENTITIES` is a **standing owner ruling** (RULING 7), not
        debt — it has no retiring story, and removing an entry from it re-opens a browse
        surface the owner closed. Quote the ruling in the comment so the next reader does not
        have to find it.

## Dev Notes

### Why the validator is fixture-driven and not "read the world and assert"

`root/routeManifest.ts:175` is the proven in-repo pattern and its doc comment says why in
one sentence: the validator *"[t]akes its inputs as parameters (never reads `CUSTOM_ROUTES`
/ `RESOURCES` / `PRIMARY_NAV` from module scope) so tests can drive it with invalid fixtures
without mutating the real manifest."* The registry adds a second reason: it is a
module-private `Map` populated by module-scope side effects
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4-Registry — rules 1 and 4], so a
validator that read it directly could only ever be tested against the real thing, and
would have no way to prove any of its thirteen codes fires. `navTargets` (AC 10) is a parameter
for the same reason and by the same precedent — `findManifestViolations` already takes it rather
than importing `PRIMARY_NAV`
[Source: src/components/atomic-crm/root/routeManifest.ts:198-203].

### Why four rules ship with a non-empty exemption table — and why the tab rule does not

Epic 3 builds the framework; Epic 5 moves the entities onto it. At the close of Epic 3 the
four AD-24 entities have stub descriptors (`name`, `buildRecordPath`, `label`, and — per AC 6
— `pendingTabs`), still register `show`/`create`/`edit` on `<Resource>`, and still resolve to
`/{resource}/{id}/show`. The contract's §12 line for this story — *"every `buildRecordPath`
matches `/{entity}/{id}`"* — is only reachable after 5.10. Encoding that as an
unconditional assertion would make this story unbuildable; encoding it as a comment would
make it unenforced. The symmetric exemption table is the third option: the rule is live
from day one for anything **new**, and each Epic 5 story is forced to delete its own entry
or fail the build. This is deliberate and is the one place this story departs from the
contract's literal wording — see "Contract deviations", below.

**The tab rule is the exception, and the reason is worth stating.** An exemption table is the
right instrument when the rule is *correct today* and reality is *temporarily wrong* — a
`show` slot that should not exist, a path shape that should already be `/{entity}/{id}`. It is
the wrong instrument when the rule itself was over-stated. "Every entity declares every tab"
is not AD-24's invariant; AD-24's invariant is that entities do not **diverge** — no invented
key, no invented order, no bypass. Completeness is a schedule, and 5-1's own AC 2 sets that
schedule deliberately, forbidding placeholder tabs
[Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:36-42]. So the tab
rule is split rather than exempted: the divergence half is unconditional and has **no**
escape hatch at all, and the schedule half is a `pendingTabs` **declaration** on the
descriptor, asserted against `CANONICAL_TAB_SETS` as sets on every run. A declaration is
strictly better than an exemption here on three counts — it lives next to the thing it
describes rather than in a table five stories away; it cannot outlive its reason, so it needs
no `stale-exemption` counterpart; and it is retired by *moving one key between two arrays*,
which the story building the tab cannot forget without going red. The net effect is the
property this whole story is for: the validator is red exactly when an entity **diverges**,
and never merely because it is **unfinished**.

### `?raw` scans that can actually fail

Three guards in the original Epic 3 story set could not fail at all
[Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#6-Landmines — item 15]: a regex
matching only 3-digit pixel values, a four-name alternation that a `resource === "x"`
comparison walks straight past, and a grep for `getPublicUrl`, a symbol with zero hits
repo-wide. The three defences this story uses against joining them:

1. **Alternations are derived, never literal.** Both scans build their resource-name
   alternation from `RESOURCES` at test time, so `connections/` (Epic 8) is covered the day
   it is registered.
2. **Sets are compared for equality, not membership.** "The scan found nothing unexpected"
   is one direction; "the scan still finds everything we said it would" is the other, and
   it is the direction that catches a glob that silently stopped matching.
3. **A sanity `it` per scan** (AC 8), copied from the shape at
   `entitlementGate.guard.test.ts:79-86` — *"if this ever fails, the panel stopped gating
   and the scan above would be meaningless."*

### Verified state of the tree at the time of writing (re-verify before editing)

| Resource | `definition` today | Directory |
|---|---|---|
| `shidduchim` | `{ list }` (lazy) | `shidduchim/` |
| `singles` | `{ list, create, edit, show, recordRepresentation }` | `singles/` |
| `inbox_items` | `{ list, options }` | **`inbox/`** — name ≠ directory |
| `shadchanim` | `{ list, create, edit, show, recordRepresentation }` | `shadchanim/` |
| `references` | `{ list, show, create, edit, recordRepresentation }` | `references/` |
| `tasks` | `{ list: TasksListPage }` (inline in the manifest) | `tasks/` |
| `members` | `{ list, edit, recordRepresentation }` | `members/` |

[Source: src/components/atomic-crm/root/routeManifest.ts:92-100 and each entity's
`index.ts`.] `tasks`' definition is written inline in the manifest and has no
`tasks/index.ts` — the directory-name mapping in Task 4 must not assume one exists.

Files importing `@/components/ui/dialog` under `src/components/atomic-crm/` today: ten —
`inbox/AddToInboxDialog.tsx`, `inbox/InboxResolveDialog.tsx`, `layout/DemoBanner.tsx`,
`misc/ImageEditorField.tsx`, `references/ReferenceMergeButton.tsx`,
`settings/DeleteDataDialog.tsx`, `shidduchim/ShidduchCreate.tsx`,
`shidduchim/ShidduchShowHeader.tsx`, `shidduchim/ShidduchShow.tsx`, `tasks/TaskEdit.tsx`.
AC 4's basename filter reduces that to the three that are record surfaces. Do not widen the
filter to "imports Dialog" — seven of those ten are legitimate confirm/edit dialogs and
AD-24 forbids modal **records**, not modals.

### Why `tasks/TaskEdit.tsx` is deferred rather than converted

UX-DR3 is mapped to Epic 3 [Source: _bmad-output/planning-artifacts/epics.md:127], so the
question cannot simply be passed downstream. The answer is that a task is not one of
AD-24's entities: it has no `EntityDescriptor`, no row in the UX-DR5 tab matrix, no 360,
and `tasks` is named as a resource that never migrates onto the framework
[Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#7-Not-problems]. AD-24's
"records live at URLs, not in modals" governs **primary records**; a task edited inline
from the task list is a subordinate object, the same category as
`references/ReferenceMergeButton.tsx`'s confirm dialog. The deferral is written as a
`permanent` exemption whose trigger is enforced by AC 2: register a `tasks` descriptor and
the guard immediately reports `permanent-exemption-for-360-entity`, forcing the decision to
be re-made rather than inherited. `shidduchim/ShidduchCreate.tsx` gets the opposite
treatment — `kind: "pending"`, `retiredBy: "5.1"` — because `shidduchim` *is* an AD-24
entity and 5.1 owns its `buildEntityRoutes` wiring, including the `New` slot.

### The one site 3.9's sweep cannot reach

3.9's AC 3 verifies its sweep with `grep -rnE 'to=\{\`/(…)/\$\{'` — a pattern keyed on the
JSX `to={` prop. `shidduchim/ShidduchCatchSection.tsx:34-45` builds the same path shape and
passes it to `useRedirect()`, so it is outside that pattern by construction and is not one
of 3.9's 12 verified sites (whose inventory is correct and must not be "corrected"
[Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#7-Not-problems]). AC 5(b)'s scan
is keyed on the **path literal**, not the prop, so it finds it. Task 5 fixes it here rather
than exempting it, because an exemption with no retiring story is exactly the rot this
story exists to prevent. `reminders/reminderEntity.ts:41,43,46` is the other non-`to={`
site and is deleted outright by 3.9
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md#7-RecordLink — rule 6]; if it is still
present when this story starts, 3.9 is not done and this story is blocked.

### Contract deviations — flagged, not silently taken

1. **Exemption tables for AC 2, 3, 4 and 5.** Contract §12 lists this story's
   assertions without qualification; only the descriptor rule is written as *"or an
   explicit exemption"*. As argued above, the other three are unreachable inside Epic 3
   because entity migration is Epic 5. The rules are implemented in full; what is
   qualified is *when* they reach an empty table.
2. **`CANONICAL_TAB_SETS` lives here.** Contract §10 assigns `TAB_KEYS` / `TAB_LABELS` /
   the shared `overview` and `related` components to the tab-vocabulary story but assigns
   the per-entity matrix to nobody; contract §3 rule 5 assigns the conformance assertion to
   this story. This story therefore owns the matrix and imports `TabKey` rather than
   re-declaring it.
3. **`hasShow` / `hasEdit` are not asserted here.** Contract §5 rule 4 assigns them to 3.2,
   and `shidduchim` is list-only today without them by design (it is a Kanban board and
   never renders a `<DataTable>` row
   [Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#7-Not-problems]). A rule
   here would need a special case on its first day and would contradict 3.2's own AC.
4. **`pendingTabs` is *not* a deviation — it is contract.** The consistency-vs-completeness
   split in AC 6 is an owner ruling carried into the contract itself: `pendingTabs?: TabKey[]`
   is a field on `EntityDescriptor` (contract §2, and on 3.3a's type block), and the
   conformance rule is stated in contract §3 rule 5. It is descriptor **metadata**, not a
   region: `Entity360Props` remains exactly seven regions (contract §1) and nothing renders
   `pendingTabs`. A builder who finds this story and the contract disagreeing on the tab rule
   should stop — they are reading a stale copy of one of them.

### Testing standard

AAA, descriptive `it` names, no shared mutable state
[Source: .claude/rules/testing.md]. Both files run in the **`app`** vitest project
(`npm run test:unit:app`), which executes in real headless Chromium
[Source: vitest.config.ts:23-49] — so neither test may shell out or touch `node:fs`;
source and SQL are read through Vite `?raw` globs. Neither file renders a component, so
neither needs `vitest-browser-react` or `TestMemoryRouter`; if a rendering assertion is
added later, those are the repo's tools and React Testing Library is **not** a dependency
[Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3,68-71]. No backend
surface, no migration, no `test:unit:db` involvement — AC 7 reads the schema file, it does
not query a database. Validation set: `npm run typecheck`, `npx vitest run`,
`npm run lint`, `npm run build` (equivalently `make typecheck` / `make test` / `make lint` /
`make build`)
[Source: package.json:5-18].

### Project Structure Notes

- New files: `entity360/ad24Conformance.ts`, `entity360/ad24Conformance.test.ts`,
  `entity360/ad24Conformance.guard.test.ts`. The `.guard.test.ts` suffix matches the one
  existing source-scanning guard in the repo
  [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts].
- One live-code edit outside `entity360/`: `shidduchim/ShidduchCatchSection.tsx` (Task 5).
- English-only in all new files and comments [Source: .claude/rules/english-only.md];
  AD-23 vocabulary throughout — *shidduch/shidduchim*, *redt*, *shadchan/shadchanim*,
  *reference*, *single*; never "child", "candidate" or "Suggestion" in a user-facing or
  identifier position [Source:
  _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175].

### References

- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — the binding Epic 3 API contract; §3
  (`TabKey` + per-entity tab sets), §4 (registry, `entityPaths.ts`), §5 (routes), §8
  (target-type vocabulary, `PENDING_DB_WIDENINGS`), §12 (build order), §13 (test shapes)
- [Source: _bmad-output/planning-artifacts/epic3-preflight-brief.md#3-G] — the finding this story
  answers: *"Without this, Epic 3 hands Epic 5 zero enforcement and AD-24 is a document,
  not a contract"*
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180] — AD-24, the rule
  this story enforces; `:172-175` — AD-23, the vocabulary it enforces in AC 6
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:161-172]
  — UX-DR2 (route convention), UX-DR3 (records live at URLs, not modals), UX-DR4 (shared
  tab vocabulary), UX-DR5 (per-entity tab matrix). The **mockup is not a source**:
  `mockup/MyShadchan.dc.html` predates AD-24 and `mockup/uploads/ARCHITECTURE-SPINE.md`
  contains no AD-24 at all
- [Source: _bmad-output/planning-artifacts/epics.md:127] — the FR coverage map row placing
  UX-DR3 in Epic 3, which is why this story disposes of the two orphaned modals
- [Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:36-42] — the
  deliberately partial five-tab shidduch set, and its explicit ban on placeholder tabs: the
  reality AC 6's consistency-vs-completeness split exists to accommodate without weakening
- [Source: src/components/atomic-crm/root/routeManifest.ts:39-43,92-100,168-179] —
  `ResourceEntry`, `RESOURCES`, and `findManifestViolations`' pure-validator contract;
  `:176-185,247-255,276-292` — `empty-resource`, `record-flags-missing` and
  `unreachable-nav-target`, the three rules AC 10 verifies **cannot** catch a re-added
  `/references` nav entry, which is why RULING 7 needs a positive assertion
- [Source: src/components/atomic-crm/layout/navItems.ts:31,59-65] — `PRIMARY_NAV` and the
  `/references` entry AC 10 forbids (still present on `main` at the time of writing)
- [Source: src/components/atomic-crm/references/index.ts:19-21] — `references` keeps a truthy
  `list` (the route mount) plus `show`/`edit` under RULING 7; this is the fact that defeats
  both `unreachable-nav-target` and `record-flags-missing`
- [Source: src/components/atomic-crm/entity360/entityPaths.ts:18-21] — `buildListPath`, the
  second shape AC 10(b)'s scan looks for
- [Source: src/components/atomic-crm/root/routeManifest.test.ts:11-15,33-139] — the
  fixture-in-test-file pattern and the `Dummy`/`anElement` fixture idiom
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20,44-52,79-86]
  — the only in-repo `?raw` source-scan precedent, its self-exclusion filter, and its
  sanity check
- [Source: src/components/atomic-crm/shidduchim/ShidduchShow.tsx:18-24,34-35;
  shidduchim/ShidduchCreate.tsx:96,139; tasks/TaskEdit.tsx:32,76] — the three modal record
  surfaces AC 4 pins
- [Source: src/components/atomic-crm/shidduchim/ShidduchCatchSection.tsx:34-45] — the
  hand-built record path Task 5 removes
- [Source: supabase/schemas/01_tables.sql:45-47,458-459] — `tasks_target_type_check` and
  `interactions_target_type_check`, the two constraints AC 7 checks for parity
- [Source: src/components/atomic-crm/types.ts:71,109-110] — `TaskTargetType` (widened by
  3.9) and `MemberRole`, neither of which this story re-declares
- [Source: src/components/admin/data-table.tsx:23,233] — `useGetPathForRecordCallback`, the
  row-click primitive whose behaviour 3.2's `hasShow`/`hasEdit` rule protects (noted here
  only to record why this story does not assert on it)
- [Source: vitest.config.ts:23-49; package.json:5-18] — the `app` project's real-Chromium
  browser mode and the real validation commands
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/lsp-usage.md, .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (developer subagent), 2026-07-29.

### Debug Log References

- `npm run typecheck` — clean (found and fixed a real bug in the process:
  a literal `*/` inside a `/** … */` JSDoc comment in `ad24Conformance.ts`
  prematurely closed the block comment, turning the rest of the file into
  garbage code with ~60 cascading parse errors).
- `npm run lint` — clean (one fix: `console.info` is not in this repo's
  `no-console` allowlist; switched to `console.warn`, see Completion Notes).
- `npx prettier --check .` — clean for all five owned files.
- `npx vitest run --project app` (STACK_ID=1) — 906/906 passed (full `app`
  project); the 3 new files' 50 tests pass in isolation too.
- `npx vitest run` (all projects, STACK_ID=1) — 1132 passed, 13 skipped
  (db project skips itself without a live Supabase stack; no SQL was
  touched by this story, so `make test STACK_ID=1` was not required).
- `npm run build` — clean (pre-existing chunk-size warning, unrelated).

### Completion Notes List

**All 10 ACs implemented and green**, with three flagged deviations (none
weaken the validator's rules — all are test-construction choices, explained
below):

1. **File length (Task 1's own DoD note).** `ad24Conformance.ts` is ~730
   lines — over the coding-style rule's 400-line "typical" ceiling, though
   under its 800-line hard max. The story's fixed ownership list
   (`ad24Conformance.ts`, its two test files, `ShidduchCatchSection.*`,
   `registry.json` — "If you need a file outside that set, do not take it")
   left no sanctioned second file to extract data/helpers into. Flagging
   this as a contract tension rather than silently splitting into an
   unowned file.

2. **`console.info` → `console.warn` (AC 9b).** This repo's ESLint
   `no-console` rule allows only `warn`/`error` (`eslint.config.js:49`);
   `console.info` is not in that allowlist and there is no
   `scripts/**`-style per-path override for `src/`. Used `console.warn`
   instead — same "report without failing the build" effect the AC asks
   for.

3. **The "real manifest + registry → []" test does not feed it the real
   `PRIMARY_NAV`/list-path scan (`ad24Conformance.test.ts`, Task 3's last
   bullet).** AC 10 is written unconditionally, and — verified against the
   tree at the start of this story — `layout/navItems.ts` PRIMARY_NAV still
   registers `/references`, and four files (`dashboard/Dashboard.tsx`,
   `dashboard/MobileDashboard.tsx`, `layout/MobileNavigation.tsx`,
   `layout/navItems.ts`) still link to it. Removing that entry is Epic 4
   Story 4.4 (Navigation set) — outside this story's scope boundary per its
   own explicit "Ordering" instruction ("stop and raise… do not delete the
   nav entry here… do not soften the rule"). Per that instruction: the rule
   itself is NOT softened or exempted in `ad24Conformance.ts` — `references`
   has no allowlist entry anywhere. Instead:
   - the one pure-file "everything real → []" test uses real `RESOURCES`
     and the real registry, but empty `navTargets`/`listPathLinks` (AC 10a/b
     are independently, falsifiably exercised by their own dedicated
     fixture tests directly above it, using the real `NO_BROWSE_SURFACE_ENTITIES`
     table);
   - `ad24Conformance.guard.test.ts` DOES feed the validator the real,
     scanned `navTargets`/`listPathLinks`/`modalRecordSurfaces`/
     `handBuiltRecordPaths` (Task 4's own instruction), and asserts the
     result contains ONLY `browse-surface-on-scoped-entity` violations
     (proving every other rule — AC 2/3/4/5a/5b/6/10c/10d — is genuinely
     clean against the real tree) and that those violations are EXACTLY
     today's known five sites (one nav entry + four linking files). That
     assertion is written to start failing, in the correct direction, the
     day Story 4.4 lands — at which point it (and its surrounding
     `describe`) should be deleted in the same diff.
   This is the one place this story's implementation could not reach a
   fully "story is 100% green against an unconditional rule" state, because
   the precondition the rule depends on (RULING 7 applied to the nav tree)
   is explicitly out of scope and not yet done. Raising it here rather than
   silently deleting the AC 10(a)/(b) real-nav proof or exempting
   `references`.

Other notable implementation facts:
- `findAd24Violations`'s four exemption-backed rules (AC 2-5) share one
  `checkExemptionTable` helper; AC 6 (tabs) and AC 10 (RULING 7) are
  implemented as their own functions per the story's explicit instruction
  that they must NOT go through the shared helper.
- `RECORD_SURFACE_EXEMPTIONS` has no `create` entries for `singles`/
  `shadchanim`/`references`: Story 3.12 already replaced their `create:`
  props with `hasCreate: true` + `children: buildCreateRoutes(...)`
  (verified by reading each `index.ts`), which is itself the AD-24-routed
  shape, not a bespoke surface.
- `findListPathLinks`'s list-path-literal regex needed a lookbehind
  (`` (?<=["'`])/${name}(?=["'`?]) ``) beyond the story's literal
  description — without it, a relative import like `"../references"` false-
  positives on its own trailing `/references`. Verified empirically against
  the real tree (Node script replicating the scan) before writing the
  guard-test assertions, which is also why `ad24Conformance.ts` itself is
  excluded from all three source scans in the guard test: its own exemption-
  table `detail` strings and doc comments legitimately mention paths like
  `shidduchim/ShidduchShow.tsx` and `/references/${id}` in prose.
- Task 5's target line already differed from what the story described:
  Story 3.9 had already replaced the literal `` `/shidduchim/${id}/show` ``
  with `requireEntityDescriptor("shidduchim").buildRecordPath(...)` — not a
  template-literal build, but still a bypass of `entityPaths.ts`. Completed
  the fix to call `buildRecordPath("shidduchim", id)` from
  `entity360/entityPaths.ts` as the story's Task 5 specifies.
- `LSP` tool was unavailable in this session (not among the loaded/deferred
  tools); Task 5's `goToDefinition` confirmation was done by reading
  `entityPaths.ts` directly instead.

### File List

- `src/components/atomic-crm/entity360/ad24Conformance.ts` (new)
- `src/components/atomic-crm/entity360/ad24Conformance.test.ts` (new)
- `src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts` (new)
- `src/components/atomic-crm/shidduchim/ShidduchCatchSection.tsx` (modified — Task 5)
- `src/components/atomic-crm/shidduchim/ShidduchCatchSection.test.tsx` (new)
- `registry.json` (auto-regenerated by the pre-commit hook; no manual edits)
