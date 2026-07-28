---
baseline_commit: a96f49172f97d57f5a1574f6ce9ea9ab36b4d3e4
---

# Story 3.10: Shared tab vocabulary

Status: review

> Part 3.10a (Tasks 1-5) is complete and committed to `main`. Part 3.10b (Task 6,
> `RelatedRecordsTab`) is also done — both its blockers (Story 3.9's `RecordLink`, Story
> 3.3a's `EntityDescriptor`/registry) had landed, but this story wasn't re-opened to pick
> it back up before Story 3.3b's own session needed it: `EntityShow`'s AC 10 cannot compile
> or be tested without `RelatedRecordsTab`, so it was built there and this story's Task 6
> is checked off in the same commit, pointing back to that story's Dev Agent Record for the
> implementation notes. See this file's own Completion Notes for the cross-story note.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want one closed list of tab names and one place each shared tab is built,
so that thirty downstream stories converge on the same six words instead of inventing
a seventh.

## Position in Epic 3

**Build-order step 0 — first story of Epic 3.** (The contract §12 table lists 13 steps; the file set is **14** stories, because 3.12 and 3.13 were split out after §12 was written. Step numbers below are contract-§12 numbers and are stable; the totals are not.) The Epic 3 canonical API contract's build-order
table calls it **3-13** and places it at step 0; it is filed here as
`3-10-tab-vocabulary.md` only because the Epic 3 file set numbers sequentially from
`3-9-recordlink-primitive.md`. Same story, two names — do not create a second one.
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md §3, §10, §12]

This story is delivered in **two parts with two different landing points**, for the same
reason 3.3 is split into 3.3a and 3.3b: one half has no dependencies and blocks
everything, the other half needs two components that do not exist yet.

| Part | Deliverable | Lands | Blocks |
|---|---|---|---|
| **3.10a** | `tabKeys.ts` (the closed `TabKey` union, `TAB_LABELS`, `isTabKey`, `tabLabelKey`), `useTabLabel`, the `crm.entity360.tab.*` catalog entries, `relationshipDescriptor.ts` (type only), `OverviewFactGrid` + `OverviewTab` | **Build-order step 0** — before 3.1 and before 3.3a. Zero code dependencies: pure TypeScript constants plus one presentational component. | **3.3a** (`EntityTabDescriptor["key"]` is `TabKey`; `EntityDescriptor.relationships` is `EntityRelationshipDescriptor[]`), **3.2** (`buildTabPath(name, id, tab: TabKey)` and the unknown-tab fallback need `isTabKey` to narrow the `:tab` URL segment), **3.3b**, **3.4**, and every Epic 5/7/8/9/11 story that declares a tab. |
| **3.10b** | `RelatedRecordsTab` | **After 3.9** (it renders `RecordLink` on every row) **and after 3.3a** (it is reached through `EntityDescriptor.relationships`), **before 3.3b** (`EntityShow` is its only caller). Build-order step 3.5. | **3.3b**, and `5-8` / `5-10` / `8-5`, which would otherwise each hand-roll the same related-records list. |

**Contract deviation, flagged not hidden:** the contract's build-order table puts *all* of
this story at step 0, including "the shared `overview` / `related` components". The
`related` component cannot compile at step 0 — contract §9 requires every row to render a
`RecordLink`, and `RecordLink` is Story 3.9 (step 3). The split above is the smallest
change that keeps every other contract term intact. Nothing else in the contract moves.

**Scope boundary — read before starting.** Same posture as 3.1 and 3.3: this story builds
vocabulary and presentational primitives, not entity wiring. It does **not** register a
descriptor, does not declare any entity's tab set, and does not migrate a show page onto
`Entity360`. Declaring the per-entity tab sets is Epic 5's job (5.1, 5.8, 5.9, 5.10) and
asserting them against the canonical matrix is story 3-15's. Three live files are
nevertheless edited, deliberately, and they are the whole of this story's production
footprint: the i18n catalog (`providers/commons/englishCrmMessages.ts`), because a label
map that no catalog resolves makes the i18n requirement unfalsifiable;
`providers/commons/frenchCrmMessages.ts`, because it is separately type-checked via
`satisfies CrmMessages` with no optional keys, so adding `crm.entity360` to the English
catalogue forces the French object literal to declare it too (see AC 3's corrected note
below); and `shidduchim/ShidduchFactsCard.tsx`, because it already contains the exact
fact-grid this story generalises and shipping a second copy beside it would be the drift
this story exists to stop. (The contract's step-3 note that 3.9 is "the only Epic 3 story
touching live files" is therefore inexact by three files. Flagged, not worked around.)

## What "shared tab vocabulary" means, concretely

UX-DR4 writes the shared vocabulary down — *"Shared tab vocabulary, written once and
reused: Overview, Activity, Notes, Tasks, Files, Related. Entity-specific tabs are the
exception, not the rule."*
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-167]
— and UX-DR5 gives the per-entity matrix at `:168-172`. Epic 3's own charter opens with
*"One shell and one tab vocabulary used by every entity"*
[Source: _bmad-output/planning-artifacts/epics.md:454].

Nothing in the story set enforces it. `3-3:72-74` types `EntityTabDescriptor` as
`{ key: string; label: string; … }`, and drift already exists across three stories that
mean the same thing:

| Story | String it declares | Concept |
|---|---|---|
| `5-8:106-107` | `shidduchim` | the shidduchim related to this single |
| `5-9:62,96` | `suggestions` | the shidduchim related to this shadchan |
| `5-10:69-73,107` | `linked-shidduchim` | the shidduchim related to this reference |
| `7-1:271-278` | `discussions` | an Epic 7 `ThreadPanel` on a shidduch |
| `8-5:36,86-87` | "Conversations" | an Epic 7 `ThreadPanel` on a connection |

Three names for one concept, and two names for another. The live code is no better:
`references/ReferenceShow.tsx:129-146` renders a local four-value tab set —
`conversations | timeline | reminders | assistant` — of which `timeline` and `reminders`
are not vocabulary at all (UX-DR5 calls them Activity and Tasks).

This story closes the union so the drift becomes a type error rather than a review
comment, and builds the two shared tab components UX-DR4 names and no story owns.

## Acceptance Criteria

1. **The tab vocabulary is a closed union with one canonical label per key.**
   `src/components/atomic-crm/entity360/tabKeys.ts` exports:
   ```ts
   export const TAB_KEYS = [
     "overview", "activity", "notes", "tasks", "files", "related",
     "resume", "photo", "medical", "diligence", "external-links",
     "shidduchim", "conversations", "discussions", "assistant",
   ] as const;
   export type TabKey = (typeof TAB_KEYS)[number];
   export const TAB_LABELS: Record<TabKey, string>;      // English fallbacks, AC 3
   export function isTabKey(value: string): value is TabKey;
   export function tabLabelKey(key: TabKey): string;     // `crm.entity360.tab.${key}`
   ```
   The 15 keys and their labels are exactly the contract's §3 block — do not add, drop or
   rename one in this story. `TAB_LABELS` being `Record<TabKey, string>` makes a missing
   or misspelt label a tsc error, so the runtime test does **not** re-assert that; it
   asserts instead the two things the type cannot: (a) every key named in contract §3 is
   present in `TAB_KEYS` — a *rename* of a shipped key fails here; (b) `TAB_KEYS` contains
   no duplicate. Note the test deliberately does **not** pin `TAB_KEYS.length`: contract §3
   rule 3 makes adding a key a sanctioned one-line edit, and a length pin would fight it.

2. **`suggestions` and `linked-shidduchim` are not expressible.** A type-level test case in
   `tabKeys.test.ts` uses `// @ts-expect-error` on a `TabKey`-typed binding assigned
   `"suggestions"`, and another on `"linked-shidduchim"`, and a third on an
   `EntityRelationshipDescriptor` literal whose `key` is `"linked-shidduchim"` (AC 6). An
   unused `@ts-expect-error` is itself a tsc error, so if the union is ever widened to
   `string` — or either name re-admitted — `npm run typecheck` fails
   (`tsconfig.app.json` includes `src`, so `.test.ts` files are covered).
   `isTabKey("suggestions") === false` and `isTabKey("linked-shidduchim") === false` are
   asserted at runtime as well, because 3.2 narrows a URL segment through `isTabKey` and a
   stale bookmark must not resolve.
   **No `?raw` source-scanning guard is written for this AC.** The type system is the
   stronger enforcement here, and a regex over `src/` for the word "suggestions" would
   match the live, out-of-scope `dashboard/RecentSuggestions.tsx` and
   `shadchanim/ShadchanSuggestions.tsx` — a guard that fires on work this story does not
   own is worse than no guard.

3. **Labels render through the `i18nProvider`, and the catalog actually resolves them.**
   `providers/commons/englishCrmMessages.ts` gains a `crm.entity360` block containing
   `tab.<key>` for every `TabKey` — values identical to `TAB_LABELS`'s — plus
   `overview.empty` (AC 5).
   `entity360/useTabLabel.ts` exports
   `useTabLabel(key: TabKey, override?: string): string` returning
   `override ?? translate(tabLabelKey(key), { _: TAB_LABELS[key] })`.

   `EntityTabDescriptor.label` is **optional and normally absent** (contract §2 rule 8), so
   the override is the exception, not the rule. **Three assertions, all falsifiable** — a
   suite that only proves an explicit override is returned proves nothing about i18n and is
   worse than no test, because it stays green while the feature it guards is inert:

   (a) for **every** key in `TAB_KEYS`, `testI18nProvider.translate(tabLabelKey(key))` equals
   `TAB_LABELS[key]` — this fails the moment the union grows and the catalog does not, the
   drift the `_:` fallback would otherwise hide, because `polyglotI18nProvider` here is
   configured `{ allowMissing: true }` (`i18nProvider.ts:48`);
   (b) a tab descriptor with **no** `label` renders the canonical label — i.e.
   `useTabLabel("shidduchim")` with no second argument returns `"Shidduchim"`; and
   (c) with a translation registered for `crm.entity360.tab.shidduchim` that **differs** from
   `TAB_LABELS.shidduchim`, that registered translation **wins** for the same label-less
   descriptor.

   **(c) is the assertion that goes red if resolution bypasses the catalog** — if anything
   between the descriptor and `useTabLabel` synthesises an override out of `TAB_LABELS`, (c)
   returns the canonical string instead of the registered one and the test fails. Keep the
   explicit-override case (`useTabLabel("shidduchim", "Linked shidduchim")` returns the
   override) as a fourth, subordinate assertion; it documents §3 rule 2's "an entity may
   override the string, never the key" but it is **not** the i18n proof.
   **Namespace note:** the key is `crm.entity360.tab.<key>`. The catalog nests everything
   under a single `crm` root (`englishCrmMessages.ts:104`), so a bare `entity360.*` key can
   never resolve and would make this AC vacuous. (Earlier revisions of the contract wrote the
   bare form; §3 rule 2 now carries `crm.entity360.tab.<key>` and the two agree.)

   **Correction — a `frenchCrmMessages.ts` edit *is* required.** At **runtime**, French
   inherits English automatically (`frenchCatalog = mergeTranslations(englishCatalog, …)`,
   `i18nProvider.ts:16-21`), so a missing French key would still resolve through the merge.
   But `frenchCrmMessages.ts` is separately declared `satisfies CrmMessages`, and
   `CrmMessages` (`MessageSchema<typeof englishCrmMessages>`) has no optional keys — so the
   moment `crm.entity360` is added to `englishCrmMessages.ts`, `make typecheck` fails on
   `frenchCrmMessages.ts` unless the same block is added there too. This story therefore adds
   the 15 tab labels + `overview.empty` to `frenchCrmMessages.ts` in French as well; it is not
   out of scope, and the original wording above ("no `frenchCrmMessages.ts` edit is required,
   and adding one is out of scope") was wrong about this type-level completeness check. See
   Dev Agent Record → Debug Log References for the verified `tsc` failure this correction
   fixes.

4. **`OverviewFactGrid` renders a bilingual fact list, omits empty facts, and has an empty
   state.** `entity360/tabs/OverviewFactGrid.tsx` exports
   ```ts
   export type OverviewFact = {
     label: string;                 // already-translated
     en?: string | null;
     he?: string | null;
     plain?: string | null;
   };
   export function OverviewFactGrid(props: {
     facts: OverviewFact[];
     emptyLabel: string;
   }): ReactElement;
   ```
   Behaviour is `ShidduchFactsCard.tsx:8-36`'s `FactRow` generalised, unchanged: a fact
   with no `en`, `he` or `plain` renders **nothing** (not an empty row); a Hebrew value
   renders with `dir="rtl"` and the `font-hebrew` class (AD-12, spine `:113-116` — both
   scripts are a data invariant, so the shared grid must render both); the
   grid is a `<dl>` of `<dt>`/`<dd>` pairs; when every fact is empty, `emptyLabel` renders
   instead of the `<dl>` (UX-DR11 empty state). Tests: three facts of which one is
   value-less → exactly two `<dt>` elements; a Hebrew-only fact → its `<dd>` child carries
   `dir="rtl"`; all-empty → `emptyLabel` present and no `<dl>` in the container.

5. **`OverviewTab` is the tab-level wrapper every entity's Overview composes from.**
   `entity360/tabs/OverviewTab.tsx` exports
   `OverviewTab(props: { facts: OverviewFact[]; emptyLabel?: string; children?: ReactNode }): ReactElement`
   — it renders `OverviewFactGrid` followed by `children` (the entity-specific sections:
   `ShidduchSchoolsSection` / `ShidduchCatchSection` for 5.1, the `singles_summary` block
   for 5.8, and so on). `emptyLabel` defaults to
   `translate("crm.entity360.overview.empty", { _: "No details on file yet." })` — the
   string `ShidduchFactsCard.tsx:87` already uses. A test asserts that with an empty
   `facts` array **and** children present, the children render and the empty label does
   **not** (an entity whose Overview is entirely custom sections is not "empty").

6. **`EntityRelationshipDescriptor` is declared here, keyed by `TabKey`.**
   `entity360/relationshipDescriptor.ts` exports the contract §9 type verbatim:
   ```ts
   export type EntityRelationshipDescriptor<T = RaRecord> = {
     key: TabKey;
     label?: string;
     resource: string;
     getFilter: (record: T) => Record<string, unknown>;
     sort?: { field: string; order: "ASC" | "DESC" };
     perPage?: number;
     linkResource?: string;
     linkId?: (row: any) => Identifier;
     linkLabel?: (row: any) => string;
     emptyLabel?: string;
   };
   ```
   It lives in its own module rather than in 3.3a's `entityDescriptor.ts` because it is
   keyed by this story's union and consumed by this story's component, and because 3.3a
   lands after this story. 3.3a's `EntityDescriptor.relationships` imports it from here and
   re-exports it, so `entity360/entityDescriptor.ts` remains the one import site consumers
   need to know about. **This story registers no relationship** — the two worked examples
   in Dev Notes are test fixtures and Epic 5 reference material, not registrations.

7. **`RelatedRecordsTab` renders one `RecordLink` per related row, including the
   many-to-many case (Part B).** `entity360/tabs/RelatedRecordsTab.tsx` exports
   `RelatedRecordsTab(props: { relationship: EntityRelationshipDescriptor }): ReactElement`.
   It reads the subject record from `useRecordContext()`, queries
   `useGetList(relationship.resource, { filter: relationship.getFilter(record), sort, pagination: { page: 1, perPage: relationship.perPage ?? 25 } })`,
   and renders each row as
   `<RecordLink resource={linkResource ?? resource} id={linkId?.(row) ?? row.id}>{linkLabel?.(row) ?? getRecordRepresentation(row)}</RecordLink>`
   (`useGetRecordRepresentation` from `ra-core`, resolved once for the link resource).
   Three states are the tab's own, not the caller's (UX-DR11): pending → a skeleton;
   error → an inline error message, not a blank tab; zero rows →
   `relationship.emptyLabel` or a translated default.
   Tests, against a stubbed `dataProvider` (the `buildDataProvider` shape of
   `ContextSwitcher.test.tsx:58-72`) and with a fixture descriptor registered for the link
   resource:
   (a) **the many-to-many case** — `{ key: "shidduchim", resource: "reference_links_summary", getFilter: (r) => ({ reference_id: r.id }), linkResource: "shidduchim", linkId: (row) => row.shidduchim_id, linkLabel: (row) => row.shidduch_name_en }`
   over two rows produces two anchors whose `href` is the **shidduch's** path, not the
   link row's, and whose text is `shidduch_name_en`;
   (b) **the plain-FK case** — `{ key: "shidduchim", resource: "shidduchim", getFilter: (r) => ({ single_id: r.id }) }`
   produces anchors resolved by the queried resource's own `recordRepresentation`;
   (c) `getFilter` is called with the record from context and its result is passed through
   to `dataProvider.getList` unmodified (assert on the recorded call arguments);
   (d) a rejecting `getList` renders the error state and no anchors.

8. **`ShidduchFactsCard` renders through the shared grid — behaviour unchanged.**
   `shidduchim/ShidduchFactsCard.tsx` no longer declares a local `FactRow`; it imports
   `OverviewFactGrid` from `../entity360/tabs/OverviewFactGrid` and passes the same six
   facts (Parents, Seminary, Shul, Location, Age, Height) with the same `emptyLabel`
   (`"No details on file yet."`). `grep -n "FactRow" src/components/atomic-crm/shidduchim/ShidduchFactsCard.tsx`
   returns no hits afterwards. A test renders the card with a `ShidduchSummary` fixture and
   asserts the same six labels appear, and with an all-empty fixture asserts the empty
   string appears — i.e. the extraction is provably behaviour-preserving.
   **One deliberate text change, and only one:** the card's heading
   (`ShidduchFactsCard.tsx:59-61`) reads "Suggestion facts" and becomes **"Shidduch
   facts"** — a live, user-facing AD-23 violation in the one live file this story already
   edits.
   [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23]
   Nothing else in the file's rendered output changes; the field list itself is Story
   5.2's to rewrite.

## Tasks / Subtasks

- [x] **Task 1 — `tabKeys.ts`** (AC: 1, 2) *(part 3.10a)*
  - [x] Create `src/components/atomic-crm/entity360/` if 3.1 has not already — build order
        puts this story first, so it normally creates the directory 3.1's story text claims
        to create. Either way, one directory, no duplication.
  - [x] Write `TAB_KEYS`, `TabKey`, `TAB_LABELS`, `isTabKey`, `tabLabelKey` exactly as
        AC 1 lists them. File is constants only — no React, no imports from any sibling
        directory of `entity360/`.
  - [x] Doc comment at the top recording contract §3 rule 3: adding a key is a one-line
        edit to `TAB_KEYS` plus one to `TAB_LABELS` plus one catalog entry, made in the
        same diff as the story that needs it — and that falling back to a free string
        instead is a review-blocking defect.
  - [x] `tabKeys.test.ts` — AC 1's presence/duplicate assertions, AC 2's three
        `@ts-expect-error` cases and two `isTabKey` negatives. AAA.

- [x] **Task 2 — Labels through i18n** (AC: 3) *(part 3.10a)*
  - [x] Add the `entity360: { tab: { … }, overview: { empty: … } }` block under `crm` in
        `providers/commons/englishCrmMessages.ts`, one entry per `TabKey`.
  - [x] `entity360/useTabLabel.ts` — `useTranslate()` from `ra-core`, the override rule
        from AC 3, nothing else.
  - [x] `useTabLabel.test.tsx` — AC 3's assertions (a) whole-union catalog round-trip,
        (b) label-less descriptor renders the canonical label, (c) a registered
        `crm.entity360.tab.<key>` translation beats the canonical label, plus the subordinate
        explicit-override case. (c) is the one that must be shown red against a build in which
        the label is pre-filled from `TAB_LABELS`.
        The catalog round-trip needs no React: assert directly against
        `testI18nProvider.translate` (`providers/commons/i18nProvider.ts:51-56`). The
        override case renders a one-line probe component inside `CoreAdminContext` with
        `i18nProvider={testI18nProvider}`.

- [x] **Task 3 — `OverviewFactGrid` + `OverviewTab`** (AC: 4, 5) *(part 3.10a)*
  - [x] `entity360/tabs/OverviewFactGrid.tsx` — lift `ShidduchFactsCard.tsx:8-36`'s
        `FactRow` verbatim (same classes, same `dir="rtl"`, same null-return) and wrap it
        in the `<dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">` of
        `:63` with the `:86-88` empty branch. No new visual vocabulary — the tokens are
        already the app's.
  - [x] `entity360/tabs/OverviewTab.tsx` — the thin wrapper of AC 5. Keep the two files
        separate: `ShidduchFactsCard` needs the grid inside its own `<section>` card and
        must not import a component named `…Tab`.
  - [x] `OverviewTab.test.tsx` — AC 4's three cases and AC 5's children-without-facts case.
        (Filed as two focused test files instead of one: `OverviewFactGrid.test.tsx` carries
        AC 4's three cases against the grid directly, `OverviewTab.test.tsx` carries AC 5's
        children-without-facts case plus two composition sanity checks — see Completion
        Notes.)

- [x] **Task 4 — `EntityRelationshipDescriptor`** (AC: 6) *(part 3.10a)*
  - [x] `entity360/relationshipDescriptor.ts` — the type, plus a doc comment carrying both
        worked examples from Dev Notes and the rule that a relationship whose
        `linkResource` differs from its `resource` **must** supply `linkLabel` (the queried
        row is a link/summary row; the link target's `recordRepresentation` will not
        resolve against it).
  - [x] Confirm with `LSP hover` that `Identifier` and `RaRecord` resolve from `ra-core`
        before importing them (`.claude/rules/lsp-usage.md`). (No `LSP` tool was available in
        this session; confirmed instead by reading `node_modules/ra-core/dist/types.d.ts`
        directly, which exports both.)

- [x] **Task 5 — Rewire `ShidduchFactsCard`** (AC: 8) *(part 3.10a)*
  - [x] Delete the local `FactRow`; render `OverviewFactGrid` with the six existing facts.
  - [x] Change the heading string to "Shidduch facts". Do not touch the field list, the
        `hasAnyFact` computation's replacement, or `ShidduchShow.tsx`.
  - [x] `ShidduchFactsCard.test.tsx` — the two behaviour-preserving assertions in AC 8.
        Use `LSP findReferences` on `ShidduchFactsCard` first to confirm the single call
        site (`shidduchim/ShidduchShow.tsx:115`) before editing. (Confirmed by `grep -rn` —
        no `LSP` tool available in this session; single call site verified.)

- [x] **Task 6 — `RelatedRecordsTab`** (AC: 7) *(part 3.10b — built during Story 3.3b's
      session, see this file's Completion Notes and
      `3-3-entity-descriptor-registry.md`'s Dev Agent Record)*
  - [x] `entity360/tabs/RelatedRecordsTab.tsx` per AC 7, importing `RecordLink` from
        `../RecordLink` (3.9) and `EntityRelationshipDescriptor` from
        `../relationshipDescriptor`.
  - [x] `RelatedRecordsTab.test.tsx` — AC 7's four cases (a)-(d), plus pending/empty-label
        coverage.

## Dev Notes

### The 15 keys, and where each one comes from

Every key was taken from a declaration that already exists in the story set or the PRD
amendment — none is speculative.

| Key | Label | Declared by |
|---|---|---|
| `overview` | Overview | UX-DR4 (`amendment-a2.md:166-167`); `5-1:37`, `5-8:107`, `5-9:62`, `5-10:69` |
| `activity` | Activity | UX-DR4; Story 3.5 |
| `notes` | Notes | UX-DR4; Story 3.6 |
| `tasks` | Tasks | UX-DR4; Story 3.8 |
| `files` | Files | UX-DR4; Story 3.7, `5-6:15-17` |
| `related` | Related | UX-DR4 — the generic key for `RelatedRecordsTab` where no entity-specific key applies (contract §3 rule 4) |
| `resume` | Resume | `5-3:15,115` |
| `photo` | Photo | `5-4:15` |
| `medical` | Medical | `5-5:15` |
| `diligence` | Diligence | `5-1:37`; `11-3:98-99,171` mounts its dossier card here and adds no key |
| `external-links` | External links | `5-6:15-17` |
| `shidduchim` | Shidduchim | `5-8:107`; absorbs `5-9:62`'s `suggestions` and `5-10:69`'s `linked-shidduchim` |
| `conversations` | Conversations | UX-DR5's reference row (`amendment-a2.md:172`); `5-10:71-72` = `RepeatRecognitionPanel` + `ReferenceCallLog` |
| `discussions` | Discussions | `7-1:271-278`; absorbs `8-5:36,86-87`'s "Conversations" |
| `assistant` | Assistant | `5-10:69-70`; `11-3:28` keeps `ResearchAssistantPanel` here |

Three drift rulings, all from contract §3, none of them re-litigable in a build ticket:

1. **`shidduchim` absorbs `suggestions` and `linked-shidduchim`.** All three are "the
   shidduchim related to this record"; only the query differs, and the query lives in
   `EntityRelationshipDescriptor.getFilter`, not in the tab name. `suggestions` is
   additionally a user-facing AD-23 violation. **5-8, 5-9 and 5-10 must be amended to the
   single key** — 5-9's Task 3 (`:96`) and 5-10's AC 4 / Task 3 (`:69,107`) both name the
   retired strings today. Story 3-15's conformance test asserts each registered
   descriptor's tab set against the canonical matrix below, so this converges even if a
   story file is never edited: the descriptor cannot compile with the old key (AC 2) and
   cannot pass 3-15 with the wrong set.
2. **`discussions` is the one key for every Epic 7 `ThreadPanel` surface**, including the
   Connection 360's, which `8-5` calls "Conversations".
3. **`conversations` is kept and is *not* the same thing as `discussions`.** It is the
   reference **call log** — `RepeatRecognitionPanel` + `ReferenceCallLog` — which UX-DR5
   names in the reference row. The two keys now sit adjacent in `TAB_KEYS` and will be
   conflated by anyone who does not read this paragraph: `conversations` = who we have
   phoned about a reference; `discussions` = an in-app thread. (Recorded as a live
   readability risk in the contract; renaming the call-log tab to `calls` would remove the
   ambiguity but is a UX-DR5 amendment, not a build decision.)

`9-2:151-153` rules a "Listing" tab out explicitly; no key is reserved for it.

### Canonical per-entity tab sets (reference only — this story declares none)

From UX-DR5 (`amendment-a2.md:168-172`) with the sanctioned exceptions, in order
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md §3 rule 5]:

- **Shidduch** — `overview, resume, photo, medical, files, diligence, external-links, notes, tasks, activity` (+ `discussions` appended by 7-1)
- **Single** — `overview, resume, photo, files, shidduchim, notes, tasks, activity`
- **Shadchan** — `overview, shidduchim, notes, tasks, activity`
- **Reference** — `overview, conversations, shidduchim, notes, tasks, activity, assistant`
- **Connection** (Epic 8) — `overview, discussions`

One visible deviation from the PRD amendment's literal wording: UX-DR5's shadchan row says
"Suggestions". AD-23 forbids that word in user-facing text, so the label is "Shidduchim".
Worth one line of owner confirmation; it is not a builder's call to reverse.

### The two worked relationship examples — with the column names verified

Contract §9's reference example cites `row.shidduch_id`. **That column does not exist.**
The view's column is `shidduchim_id`
[Source: supabase/schemas/03_views.sql:133-160 — `reference_links_summary`, `rl.shidduchim_id` at `:139`, `s.shidduch_name_en` in the same select]. Correct form:

```ts
// reference → its shidduchim (many-to-many, through the link table's summary view)
{ key: "shidduchim",
  resource: "reference_links_summary",
  getFilter: (r) => ({ reference_id: r.id }),
  linkResource: "shidduchim",
  linkId: (row) => row.shidduchim_id,
  linkLabel: (row) => row.shidduch_name_en }

// single → its shidduchim (plain FK)
{ key: "shidduchim",
  resource: "shidduchim",
  getFilter: (r) => ({ single_id: r.id }) }

// shadchan → its shidduchim (plain FK)
{ key: "shidduchim",
  resource: "shidduchim",
  getFilter: (r) => ({ shadchan_id: r.id }) }
```

The shadchan filter column is `shidduchim.shadchan_id`
[Source: supabase/schemas/01_tables.sql:270, FK at `:621`] — the contract left this one
open; it is closed here. `shidduchim.single_id` is at `01_tables.sql:269`, FK at
`:618-619`. These are DB identifiers, so they were found with `grep` over the schema, not
with LSP (`.claude/rules/lsp-usage.md` — LSP covers TS symbols only).

### Why `EntityRelationshipDescriptor` needs `linkResource` / `linkId` / `linkLabel`

`{ resource, foreignKey }` — 3.3's original sketch — cannot express the reference case,
which is the one many-to-many the domain actually has and which UX-DR9 requires be visible
(*"you've spoken to them about N other shidduchim"*,
`amendment-a2.md:180-182`). The queried row is a **link row**: its `id` is the link's id,
and the `RecordLink` must target a different resource at a different id column. Without the
three fields, `5-8:113`, `5-10:106-114` and `8-5:24` each hand-roll the same list — which is
the pattern this epic exists to end.

### Why the label map and the i18n rule are not in conflict

Contract §13 rule 6 forbids cementing hardcoded English label maps inside `entity360/`;
contract §3 mandates `TAB_LABELS: Record<TabKey, string>`. Both hold at once because
`TAB_LABELS` is the **`_:` fallback set**, not the rendering path: rendering goes
`translate("crm.entity360.tab.<key>", { _: TAB_LABELS[key] })` via `useTabLabel`, exactly
as `references/ReferenceShow.tsx:73-75` already does for
`crm.references.header.relationshipNote`. The catalog is where a translator edits; the map
is where TypeScript proves nothing was forgotten. AC 3's whole-union round-trip test is
what keeps the two in step — without it, `allowMissing: true`
(`providers/commons/i18nProvider.ts:48`) would silently hide a missing catalog entry behind
the fallback forever.

The nearest existing precedent for per-entity tab labels is `crm.references.tabs.*`
(`englishCrmMessages.ts:383-388`), which 5.10 replaces with the canonical keys when the
reference 360 moves onto the shell.

### Testing standard

`app` vitest project (`npm run test:unit:app`), which runs in a real headless Chromium via
`vitest-browser-react` — **not** React Testing Library, which is not a dependency
[Source: vitest.config.ts:37-49]. Render with `render()` from `vitest-browser-react` inside
`CoreAdminContext` and, where a route is needed, `TestMemoryRouter` from `ra-core`; the
established pattern in this repo is `layout/ContextSwitcher.test.tsx:1-12,58-72`. The
negative idiom is `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`
(`ContextSwitcher.test.tsx:95,210`) — there is no `screen.queryByText`. `render()` returns
`container`, so `container.textContent` assertions work.

AAA, descriptive `it` names, no shared mutable state, no `waitForTimeout`
[Source: .claude/rules/testing.md]. ≥80% coverage on the new modules. The
`@ts-expect-error` cases in AC 2 are enforced by `npm run typecheck`
(`package.json:17` — `tsc --noEmit --project tsconfig.app.json && …`), not by the runner;
an unused `@ts-expect-error` is itself a tsc error, which is what makes AC 2 falsifiable.
The validation set is `npm run typecheck`, `npx vitest run`, `npm run lint`, `npm run build`
(equivalently `make typecheck`, `make test`, `make lint`, `make build` — the repo's lowercase
`makefile` resolves these).

No backend surface: no migration, no RLS, no policy, no `npm run test:unit:db` involvement.

### Project Structure Notes

- New: `entity360/tabKeys.ts`, `entity360/useTabLabel.ts`,
  `entity360/relationshipDescriptor.ts`, `entity360/tabs/OverviewFactGrid.tsx`,
  `entity360/tabs/OverviewTab.tsx`, `entity360/tabs/RelatedRecordsTab.tsx` (part B), plus
  one test file per module.
- Modified: `providers/commons/englishCrmMessages.ts`,
  `shidduchim/ShidduchFactsCard.tsx`.
- `entity360/tabs/` is the same directory 3.5-3.8 fill with `ActivityTab`, `NotesTab`,
  `FilesTab` and `TasksTab`; the two components this story adds are their siblings, not a
  parallel hierarchy.
- Every file here is well under the 200-400 line typical ceiling
  [Source: .claude/rules/coding-style.md#File-organization]; `tabKeys.ts` is ~40 lines and
  must stay constants-only — no hook, no component, no import from a sibling directory of
  `entity360/`, so that 3.2 and 3.3a can import it without pulling React in.
- English-only in all new files and comments [Source: .claude/rules/english-only.md].
- `.claude/rules/typescript.md`: `linkId`/`linkLabel` take `(row: any)` per contract §9 —
  that is the one sanctioned `any` in this story (the row's shape belongs to a summary view
  the descriptor's author knows and the framework cannot). Do not widen it elsewhere.

### References

- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md §3 (TabKey union + rulings), §9 (`relationships`), §10 (ownership), §12 step 0, §13 (test shape)] — the binding contract; this story implements §3 and §9 and does not restate the other sections' shapes
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-167] — UX-DR4, the shared tab vocabulary this story writes down
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172] — UX-DR5, the per-entity tab matrix
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:180-182] — UX-DR9, the reuse-awareness requirement `RelatedRecordsTab` serves
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187] — UX-DR11, the empty/loading/error requirement in AC 4, 5 and 7
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180] — AD-24: "An entity contributes a descriptor … and no bespoke layout code"
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-176] — AD-23: the vocabulary that rules out `suggestions` and "Suggestion facts"
- [Source: _bmad-output/planning-artifacts/epics.md:452-455] — Epic 3's charter, "One shell and one tab vocabulary used by every entity"
- [Source: _bmad-output/planning-artifacts/epics.md:112-113] — UX-DR4 / UX-DR5 in the epic-level requirement list
- [Source: src/components/atomic-crm/shidduchim/ShidduchFactsCard.tsx:8-36,59-63,86-88] — the `FactRow` + `<dl>` + empty-state implementation `OverviewFactGrid` generalises, and the "Suggestion facts" heading AC 8 fixes
- [Source: src/components/atomic-crm/shidduchim/ShidduchShow.tsx:12,115] — the card's only call site
- [Source: src/components/atomic-crm/references/ReferenceShow.tsx:129-146] — the live, local, non-canonical tab set (`conversations | timeline | reminders | assistant`) this vocabulary replaces when 5.10 migrates the reference 360
- [Source: src/components/atomic-crm/providers/commons/i18nProvider.ts:10-21,36-49,51-56] — catalog merge order (French inherits English), `allowMissing: true`, and `testI18nProvider`
- [Source: src/components/atomic-crm/providers/commons/englishCrmMessages.ts:104,383-388] — the single `crm` root and the existing per-entity tab labels
- [Source: src/components/atomic-crm/types.ts:109-110] — `MemberRole`, imported by 3.3a's `visibleTo`; never re-declared here or anywhere
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,58-72,95,210] — the browser-mode test pattern and the negative-assertion idiom
- [Source: supabase/schemas/03_views.sql:133-160] — `reference_links_summary`, including `shidduchim_id` (`:139`), the column contract §9's worked example gets wrong
- [Source: supabase/schemas/01_tables.sql:269-270,618-621] — `shidduchim.single_id` / `shidduchim.shadchan_id` and their FKs, the two plain-FK relationship filters
- [Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:36-42,45-46] — the shidduch tab set and the Overview content 5.1 relocates
- [Source: _bmad-output/implementation-artifacts/5-8-single-360.md:104-113] — the `singles` tab set and its hand-rolled shidduchim list
- [Source: _bmad-output/implementation-artifacts/5-9-shadchan-360.md:60-64,96-97] — the `suggestions` key this story retires
- [Source: _bmad-output/implementation-artifacts/5-10-reference-360-and-diligence.md:67-73,106-114] — the `linked-shidduchim` key this story retires, and the reference→shidduchim list it hand-rolls
- [Source: _bmad-output/implementation-artifacts/7-1-thread-model.md:271-278] — the `discussions` key
- [Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:34-37,84-90] — the Connection 360's "Conversations" tab, folded into `discussions`
- [Source: _bmad-output/implementation-artifacts/9-2-publish-single-listing.md:149-155] — "Listing" is explicitly not a tab
- [Source: _bmad-output/implementation-artifacts/11-3-diligence-dossier.md:28,98-99,171] — the dossier mounts on `diligence` and adds no key
- [Source: package.json:7,17,20] — `test:unit:app`, `typecheck`, `lint`
- [Source: vitest.config.ts:37-49] — the `app` project's real-Chromium browser mode
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md, .claude/rules/typescript.md,
  .claude/rules/lsp-usage.md, .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

- `npx tsc --noEmit --project tsconfig.app.json` failed once, mid-implementation, with
  `frenchCrmMessages.ts(106,3): error TS2741: Property 'entity360' is missing in type
  '...' but required in type 'MessageSchema<...>'`. `frenchCrmMessages.ts` is declared
  `satisfies CrmMessages`, and `CrmMessages` is a mapped type over
  `typeof englishCrmMessages` with no optional keys — adding `crm.entity360` to
  `englishCrmMessages.ts` makes it a *required* key of `CrmMessages`, so the French
  catalogue object literal must also declare it or the `satisfies` check fails. This
  contradicts the story's own AC 3 claim ("French inherits English automatically …
  so no `frenchCrmMessages.ts` edit is required, and adding one is out of scope") —
  that claim is correct about the **runtime** merge order but does not account for
  this **type-level** completeness check, which pre-dates this story. Fixed by adding
  the same 15 tab labels + `overview.empty` to `frenchCrmMessages.ts` in French
  (mirroring the established `crm.<section>` block pattern already in that file).
  Flagged in the report as a story-text inaccuracy rather than a contract error — see
  final report.
- Proved AC 3(c) actually falsifiable per the story's own instruction: temporarily
  rewrote `useTabLabel` to return `override ?? TAB_LABELS[key]` (bypassing
  `translate` entirely), reran `useTabLabel.test.tsx`, and confirmed exactly the (c)
  case ("prefers a catalog translation over TAB_LABELS…") went red — locator for
  "Registered translation" not found, `<span>Shidduchim</span>` rendered instead.
  Restored the real implementation and reran; all 4 tests green again.
- `npm run test:unit:app` (real Chromium via `vitest-browser-react`), `make typecheck`,
  `make lint` (eslint + prettier), `npx vitest run` (full suite, all 5 projects),
  `make build`, `npx prettier --check .` all run on the final pass — see the report
  for full output. No SQL touched, so `npm run test:unit:db` and
  `supabase db diff --local` were not run (per Dev Notes: "No backend surface").
- `LSP` was not available as a tool in this session (`ToolSearch` found no matching
  deferred tool). Task 4's `Identifier`/`RaRecord` resolution and Task 5's
  single-call-site check were both done by reading
  `node_modules/ra-core/dist/types.d.ts` and `grep -rn`, respectively, instead.

### Completion Notes List

- **Task 1.** `entity360/tabKeys.ts` — `TAB_KEYS`, `TabKey`, `TAB_LABELS`, `isTabKey`,
  `tabLabelKey` exactly as AC 1 specifies, constants-only (no React, no import from a
  sibling directory). `tabKeys.test.ts` asserts the contract's 15 keys are all present
  (independent literal, catches a rename), no duplicates, `isTabKey` true for every
  canonical key and false for `"suggestions"`/`"linked-shidduchim"`/an arbitrary
  string, `tabLabelKey`'s namespacing, and AC 2's three `@ts-expect-error` cases
  (a bare `TabKey` binding for each retired name, plus an
  `EntityRelationshipDescriptor` literal keyed `"linked-shidduchim"`).
- **Task 2.** Added `crm.entity360.tab.<key>` (all 15) + `crm.entity360.overview.empty`
  to `englishCrmMessages.ts`, values identical to `TAB_LABELS`. `useTabLabel.ts`
  implements exactly `override ?? translate(tabLabelKey(key), { _: TAB_LABELS[key] })`.
  `useTabLabel.test.tsx` covers all four cases in AC 3, including (c) — proven red
  against a catalog-bypassing build, see Debug Log.
- **Task 3.** `OverviewFactGrid.tsx` lifts `ShidduchFactsCard`'s `FactRow` verbatim
  (same classes, same `dir="rtl"`/`font-hebrew` Hebrew handling, same null-return for
  a value-less fact) inside the same `<dl>` + empty-state shape.
  `OverviewFactGrid.test.tsx` covers AC 4's three cases directly against the grid
  (2 of 3 facts render, Hebrew value carries `dir="rtl"`, all-empty shows
  `emptyLabel` with no `<dl>`). `OverviewTab.tsx` wraps the grid with `children`,
  defaulting `emptyLabel` through `translate("crm.entity360.overview.empty", …)`; per
  AC 5, when `facts` is `[]` **and** `children` are given, the grid (and its own empty
  message) is skipped entirely so a fully-custom Overview is never reported "empty" —
  `OverviewTab.test.tsx` proves this plus the default-facts-render and
  default-empty-label-resolves-through-i18n cases. (Filed as two test files rather
  than the one the task line names, so each component's own behaviour is asserted at
  its own unit boundary — coverage is a superset of what the task line lists, not a
  subset.)
- **Task 4.** `relationshipDescriptor.ts` — `EntityRelationshipDescriptor<T>` exactly
  per contract §9, doc comment carries both worked examples (with the corrected
  `shidduchim_id` column name) and the `linkResource`-differs-from-`resource` ⇒
  `linkLabel`-required rule. No relationship is registered by this story.
- **Task 5.** `ShidduchFactsCard.tsx` no longer declares `FactRow`; it renders
  `OverviewFactGrid` with the same six facts (Parents, Seminary, Shul, Location, Age,
  Height) and the same `emptyLabel`. Heading changed from "Suggestion facts" to
  "Shidduch facts" (AD-23) — the story's one deliberate text change, nothing else in
  the rendered output changed. `grep -rn "FactRow"` over the file returns no hits.
  `ShidduchFactsCard.test.tsx` asserts the heading plus all six labels render for a
  populated fixture, and the empty-state string renders for an empty one.
- **Task 6 — deliberately not started at the time this note was first written.** Its own
  header gated it on Stories 3.9 (`RecordLink`) and 3.3a (`EntityDescriptor`/registry)
  having landed first; neither existed in the tree as of that commit (`entity360/` did not
  exist before this story). Starting it then would have meant guessing at `RecordLink`'s
  and the registry's real shapes instead of importing them, which is exactly the drift this
  story exists to prevent.
- **Task 6 — done, added later, cross-story.** Both blockers landed (3.9, then 3.3a), but
  this story was never explicitly re-opened to pick Task 6 back up before Story 3.3b's own
  session reached it and needed it: `EntityShow`'s AC 10 ("relationships become tabs")
  cannot compile — let alone be tested — without `RelatedRecordsTab`. Rather than silently
  absorbing the gap into 3.3b's own scope (that story's Dependencies section explicitly
  says to escalate instead), it was built here, under this story's ownership, in the same
  commit as 3.3b: `entity360/tabs/RelatedRecordsTab.tsx` + `RelatedRecordsTab.test.tsx`,
  following this story's own AC 7 spec verbatim — `useGetList(relationship.resource, {
  filter: relationship.getFilter(record), sort, pagination })`, each row rendered as
  `RecordLink` targeting `linkResource ?? resource` / `linkId?.(row) ?? row.id` /
  `linkLabel?.(row) ?? getRecordRepresentation(row)`, with its own pending (skeleton),
  error and empty states (UX-DR11). All four of AC 7's falsifiable cases are covered
  ((a) many-to-many through a link view, labelled by `linkLabel`; (b) plain-FK, labelled by
  the queried resource's own `recordRepresentation`; (c) `getFilter`'s result reaches
  `dataProvider.getList` unmodified; (d) a rejecting `getList` renders the error state, no
  anchors), plus pending/empty-label coverage beyond the four named cases. Two new i18n
  keys this task needed (`crm.entity360.related.{loading,error,empty}`) were added to both
  `englishCrmMessages.ts` and `frenchCrmMessages.ts` in the same commit, for the same
  `satisfies CrmMessages`-has-no-optional-keys reason the story-text correction below
  already documents. Full implementation notes, gate output and File List entries for this
  work live in `3-3-entity-descriptor-registry.md`'s Dev Agent Record (3.3b slot) — not
  duplicated in full here to avoid the two files drifting apart.
- **Story-text correction (flagged, not silently worked around).** AC 3 / the "two
  live files" framing says this story's whole production footprint is
  `englishCrmMessages.ts` + `ShidduchFactsCard.tsx`, and separately claims
  "French inherits English automatically … so no `frenchCrmMessages.ts` edit is
  required, and adding one is out of scope." Both claims are accurate about the
  **runtime** i18n merge (`frenchCatalog = mergeTranslations(englishCatalog, …)`) but
  miss that `frenchCrmMessages.ts` is separately type-checked via
  `satisfies CrmMessages`, and `CrmMessages` has no optional keys — so adding
  `crm.entity360` to the English catalogue makes it a required key of the French
  object literal too, and `make typecheck` fails without it (verified — see Debug
  Log). Added the same 15 tab labels + `overview.empty` to `frenchCrmMessages.ts` in
  French as the minimal fix; this is a third file touched, not two, and I believe the
  story's "closed footprint" framing is the one part of the story text that doesn't
  survive contact with the existing `satisfies CrmMessages` invariant.
- Everything else in AC 1-6 and AC 8 reproduced as described; no other deviation.

### Review Response (adversarial review of commit `7f202c4`, verdict NEEDS-FIX)

One blocking finding, one story-text finding, two informational findings. The blocking
and story-text findings are FIXED; both informational findings are FLAGGED, not changed
(reasoning below), matching the reviewer's own framing of them as non-defects. Full
re-run after the fix: `make typecheck`, `make lint` (eslint `--max-warnings=0` + prettier),
`npx vitest run` (all 5 projects), `make build`, `npx prettier --check .`, `make
registry-gen` — see the final report for the actual output. No SQL touched, so `npm run
test:unit:db` / `supabase db diff --local` were not re-run.

- **Finding 1 (blocking) — `OverviewTab`'s emptiness predicate disagreed with
  `OverviewFactGrid`'s. FIXED.** `facts.length > 0` (array non-empty) is not the same test
  as "some fact carries a value," and the mismatch was reachable two ways: (1) a non-empty
  `facts` array whose every entry is value-less, with no `children`, rendered completely
  blank — no `<dl>`, no `emptyLabel`, no UX-DR11 empty state at all; (2) the same
  value-less `facts` array **with** `children` present rendered the generic "No details on
  file yet." copy *above* the real custom content, exactly what AC 5's parenthetical
  ("an entity whose Overview is entirely custom sections is not 'empty'") forbids. Fixed
  by computing `hasFactValue = facts.some((f) => f.en || f.he || f.plain)` in `OverviewTab`
  itself and gating the grid on `hasFactValue || !children` instead of `facts.length > 0`:
  the grid (with its own empty-state branch) always renders when there is nothing to fall
  back on, and is suppressed only when children are present and no fact has a value. Two
  new regression tests in `OverviewTab.test.tsx` pin both previously-blank/previously-wrong
  outputs; the doc comment above the component was reworded to describe the corrected rule.
- **Finding 4 (story-text error) — AC 3's `frenchCrmMessages.ts` claim is false. FIXED (text
  only, not code).** The code already carried the correct fix (the French block was added
  during the original implementation — see the story-text correction note above and the
  File List's `frenchCrmMessages.ts` entry). What was still wrong was AC 3's own prose,
  which downstream stories may read as the shape of the contract rather than as
  implementation trivia. AC 3's namespace note and the "Scope boundary" paragraph are now
  corrected in place: "no `frenchCrmMessages.ts` edit is required, and adding one is out of
  scope" is replaced with the real rule (`satisfies CrmMessages` has no optional keys, so
  the English addition forces a matching French one), and "Two live files" becomes "Three
  live files" with `frenchCrmMessages.ts` listed alongside the other two.
- **Finding 2 (informational) — `RelatedRecordsTab` deferral. No change — agree it is not a
  defect.** The reviewer's own read is that contract §12's step-0 row sanctions the split
  ("its `RelatedRecordsTab` half needs 3.9 + 3.3a and lands between steps 3 and 5"), and the
  story already tracks this explicitly (Status: in-progress, Task 6 unchecked, the "Part
  3.10b" callout at the top, Completion Notes' "Task 6 — deliberately not started"). Nothing
  to fix; the tracking the reviewer asked for ("Epic 3 tracking must not treat 3-10 as
  closed") already exists in this file's own Status line and header note.
- **Finding 3 (informational) — the §2 `EntityDescriptor` rewrite / §10 ownership decisions
  named in contract §12's step-0 row. FLAGGED, not implemented — disagree that this is
  3-10's gap to close.** Contract §2 itself is headed "`EntityDescriptor` (Story 3.3a)", and
  §10's ownership table lists `TabKey`/`TAB_LABELS`/`useTabLabel`/`relationshipDescriptor.ts`/
  the shared `overview`/`related` components under 3-10's row — it does **not** list the
  `EntityDescriptor` rewrite there. Only §12's build-order "why here" prose column (not an
  ownership assignment) bundles the two together, and doing the rewrite here would
  contradict this story's own explicit Scope boundary ("does not register a descriptor,
  does not declare any entity's tab set, and does not migrate a show page onto
  `Entity360`") for a component (`EntityDescriptor`) that has zero code dependents until
  3.3a exists. Writing it now means guessing at a shape 3.3a hasn't landed to confirm against
  — the same objection this story already raises for deferring `RelatedRecordsTab` (Finding
  2). Treating this as 3-10's responsibility is, in my reading, the contract's own
  internal inconsistency between §2/§10 (assigns to 3.3a) and §12 (bundles into step 0's
  prose) rather than a gap in this story's implementation; recorded here rather than acted
  on silently, per this task's instruction to flag disagreement with evidence. The
  ownership question remains open for whoever picks up 3.3a or amends the contract.

### File List

**New (3.10a):**
- `src/components/atomic-crm/entity360/tabKeys.ts`
- `src/components/atomic-crm/entity360/tabKeys.test.ts`
- `src/components/atomic-crm/entity360/useTabLabel.ts`
- `src/components/atomic-crm/entity360/useTabLabel.test.tsx`
- `src/components/atomic-crm/entity360/relationshipDescriptor.ts`
- `src/components/atomic-crm/entity360/tabs/OverviewFactGrid.tsx`
- `src/components/atomic-crm/entity360/tabs/OverviewFactGrid.test.tsx`
- `src/components/atomic-crm/entity360/tabs/OverviewTab.tsx`
- `src/components/atomic-crm/entity360/tabs/OverviewTab.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchFactsCard.test.tsx`

**New (3.10b, Task 6 — built during Story 3.3b's session; see that story's Dev Agent
Record for implementation notes):**
- `src/components/atomic-crm/entity360/tabs/RelatedRecordsTab.tsx`
- `src/components/atomic-crm/entity360/tabs/RelatedRecordsTab.test.tsx`

**Modified:**
- `src/components/atomic-crm/shidduchim/ShidduchFactsCard.tsx` — renders through
  `OverviewFactGrid` instead of a local `FactRow`; heading "Suggestion facts" →
  "Shidduch facts".
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — added
  `crm.entity360.tab.*` (15 keys), `crm.entity360.overview.empty` (3.10a), and
  `crm.entity360.related.{loading,error,empty}` (3.10b).
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same additions, in
  French (not anticipated by the 3.10a story text — see Completion Notes' story-text
  correction; the same `satisfies CrmMessages` constraint applies to 3.10b's additions).

## Change Log

- 2026-07-28 — 3.10b (Task 6, `RelatedRecordsTab`) completed during Story 3.3b's session,
  once both blockers (3.9, 3.3a) had landed and 3.3b's own AC 10 needed the component to
  exist. Status moved from `in-progress` to `review`. See Completion Notes for the
  cross-story note and `3-3-entity-descriptor-registry.md` for the full implementation
  record.
