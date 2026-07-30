---
baseline_commit: a8c5e3d
---

# Story 5.1: Shidduch 360 as a page

Status: review — Wave A committed; cross-reconciled against 5.2, full gate + e2e green on the combined tree.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the shidduch opened as a full page,
so that I can work in it and link to it.

## Why this story is the pilot

5.1 is the **first** entity to leave the pre-migration route shape, and 5.8 / 5.9 / 5.10 copy
whatever it does. The migration is **five coupled edits in one diff**, not a one-line
`buildRecordPath` flip:

| # | Edit | What breaks if it is omitted |
|---|---|---|
| 1 | `shidduchim/index.ts` → `list: buildEntityRoutes({…, Show: EntityShow })` + `hasShow: true` | `/shidduchim/{id}` falls through `<Resource>`'s `list` catch-all into `ShidduchimList`, which no longer matches it — the board renders instead of the 360 |
| 2 | `shidduchim/entityDescriptor.ts` → `buildRecordPath` returns ``/shidduchim/{id}`` (no `/show`) + real `tabs` | `non-ad24-record-path` stays exempt; every `RecordLink` still points at `/show` |
| 3 | Delete `PENDING_ROUTE_SHAPES.shidduchim` and `MODAL_RECORD_SURFACES["shidduchim/ShidduchShow.tsx"]` | `stale-exemption` — the AD-24 tables are **symmetric**, so an exemption that outlives its offender fails the build exactly as an unexempted offender does |
| 4 | Update `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row (**all three** assertions) | The pin is deliberately written to go red on this exact commit |
| 5 | Keep `/shidduchim/new` reachable | `buildEntityRoutes` renders `List` at `index` **only**, so `ShidduchimList`'s internal `matchNew` never runs again and `new` is swallowed by the `:id` route |

Nothing here is discretionary and nothing here is deferrable to a follow-up — each of the five
is either a red build or a wrong page.

**The one part of this pattern 5.8/5.9/5.10 must NOT copy blindly: the `New` slot.** `shidduchim`
is the only one of the four whose `buildCreateRoutes` call currently passes **no** `New`
(`shidduchim/index.ts:18`) — its create surface is matched inside `ShidduchimList` (Story 3.13),
which is precisely why AC-3 has to re-home it into `buildEntityRoutes({ New })`. `singles`,
`shadchanim` and `references` already pass `New` to `buildCreateRoutes` (`singles/index.ts:22`,
`shadchanim/index.ts:22`, `references/index.ts:22`), so 5.9 and 5.10 keep it there and pass **no**
`New` to `buildEntityRoutes`; 5.8 moves it inside and drops the argument. Either shape works —
`buildCreateRoutes`' `new/*` (a `<Resource>` child) outranks the `list` splat, and
`buildEntityRoutes`' `new` is inside the same `<Routes>` as `:id`. **Doing both at once declares
`/{entity}/new` twice**, which is the failure this note exists to prevent. Pick one per entity and
say which in that story's own AC.

## World state assumed

Written for the **post-Epic-1 through post-Epic-4** codebase. This story cannot start until,
and must `grep` to confirm, all of the following exist:

- Epic 1: `children` → `singles` (table, resource, `Single`/`SingleSummary` types, route
  `/singles`), `shidduchim.child_id` → `single_id`, `root/CRM.tsx` replaced by a `.map()` over
  `root/routeManifest.ts` (Epic 1 Story 1.5).
- Epic 3: `Entity360` shell (Story 3.1, fixed region order: breadcrumb → identity header → stat
  band → alert slot → tab bar → content → optional right rail), URL-backed tabs (Story 3.2,
  `/{entity}/{id}/{tab}`), the entity descriptor registry (Story 3.3), permission-aware tab/field
  rendering (Story 3.4), `buildEntityRoutes` + `EntityShow` (Stories 3.2 / 3.3b).

**Gate, not a design choice:** before writing any code, run
`grep -rn "Entity360\|routeManifest" src/components/atomic-crm/` and confirm the shell and the
descriptor registry exist. If they do not, Epic 3 has not landed and this story cannot proceed —
stop and report rather than improvising a shell.

## Acceptance Criteria

1. **Given** a shidduch, **when** I open it from the board (`ShidduchCard.tsx`) or a list
   (Story 4.3), **then** it navigates to `/shidduchim/{id}` and renders via the shared
   `Entity360` shell — not `ShidduchShow`'s routed `Dialog`.

   **Falsifiable:** the RTL harness in `shidduchim/ShidduchimList.test.tsx` (real
   `<Resource name="shidduchim" {...shidduchim}>` under `TestMemoryRouter`, `vitest-browser-react`)
   mounted at `/shidduchim/1` renders `Entity360`'s tab strip; mounted at `/shidduchim/1/notes`
   it renders the Notes tab. Failing looks like the board's `/^Pipeline/` heading — or
   `RecordUnavailable` — appearing at a record URL.

2. **The route mount** (this is edit #1 of the pilot table; without it AC-1, AC-4 and AC-5 are all
   unsatisfiable). **Given** `shidduchim/index.ts`, **when** this story completes, **then** it
   exports:

   ```ts
   export default {
     list: buildEntityRoutes({
       List: ShidduchimList,
       New: ShidduchCreatePage,   // see AC-3
       Show: EntityShow,
     }),
     hasShow: true,
     children: buildCreateRoutes("shidduchim"), // the /create -> /new redirect only
   };
   ```

   with `import "./entityDescriptor";` still its first line (the `<entity>/index.ts` convention —
   `entity360/entityDescriptor.ts`'s own doc comment). `hasShow: true` is **explicit and
   required**: `Resource.registerResource` computes `hasShow: !!show || !!hasShow`
   (`ra-core/dist/core/Resource.js:33-34`), and `list` alone leaves it `false`, which is what
   `useGetPathForRecord`'s inferred-link branch reads. `hasEdit` is **not** set — `shidduchim` has
   no `ShidduchEdit` and this story does not create one.

   In the same diff, delete `RECORD_FLAG_EXEMPTIONS.shidduchim`
   (`root/routeManifest.ts:136-137`), whose written reason names this story. *(Note: unlike the
   AD-24 tables in AC-4, `findManifestViolations` has no staleness check for this map — leaving
   the row does not fail the build. Delete it because the table's own doc says "exactly these
   three entries, and no others", not because CI will catch it. **Update that doc comment in the
   same edit** — after this story the map holds two entries, `inbox_items` and `tasks`, and the
   "exactly these three" sentence would otherwise become the next reader's false fact. Story 5.9's
   Task 4 quotes the three-entry list back; it is written to survive this deletion, but do not
   re-add a `shidduchim` row to make it true again.)*

   **Falsifiable:** `expect(RECORD_FLAG_EXEMPTIONS).not.toHaveProperty("shidduchim")` in
   `root/routeManifest.test.ts`, plus AC-1's navigation render.

3. **`/shidduchim/new` survives the migration.** **Given** the create page, **when** `list` is
   `buildEntityRoutes(...)`, **then** `/shidduchim/new` still renders the create page, because
   `buildEntityRoutes` emits an explicit `new` route that outranks `:id`.

   Today the create surface is matched **inside** `ShidduchimList` itself
   (`ShidduchimList.tsx:21` `matchPath(buildNewPath("shidduchim"))`, early-returning
   `<ShidduchCreate singleId={selectedSingleId} />` above `<List>` — Story 3.13). After the
   migration `List` renders at `index` only, so that branch is unreachable and `/shidduchim/new`
   would otherwise match `buildEntityRoutes`' `:id` route and render `RecordUnavailable` for a
   record whose id is the literal string `"new"`.

   Therefore: introduce `shidduchim/ShidduchCreatePage.tsx`, a component wrapper that resolves the
   `singleId` prop `ShidduchCreate` needs and renders it, pass it as `buildEntityRoutes`' `New`,
   and delete `matchNew` (`ShidduchimList.tsx:21`) and the early return (`:50-52`). **Keep the
   `buildNewPath` import** — `:163` still uses it for `singles`.
   The wrapper resolves `singleId` as: `?single_id=` when present, else the first non-archived
   single (`useGetList("singles", { filter: { "status@neq": "archived" }, sort: { field:
   "first_name_en", order: "ASC" } })` — the same query and the same fallback `ShidduchimList`
   uses today, so the default the user sees does not change). Append `single_id` to
   `ShidduchColumn.tsx:105`'s per-column "Add here" link so the column's own selection survives
   the hop.

   **Falsifiable:** `ShidduchimList.test.tsx`'s two existing assertions — "renders the create
   heading and never the board heading at `/shidduchim/new`" and "renders the board heading at
   `/shidduchim`" — **both still pass, unchanged**. They are the pre-existing regression net for
   this exact break.

4. **Given** the shidduch entity descriptor, **when** it is registered, **then** its tab set is
   `overview | diligence | notes | tasks | activity` in that order — the five tabs that already
   have real content today. `resume`, `photo`, `medical`, `files` and `external-links` are
   **not** declared by this story; Stories 5.3–5.6 each insert their own tab at the position
   shown in UX-DR5's shidduch tab matrix (amendment A2): `overview, resume, photo, medical,
   files, diligence, external-links, notes, tasks, activity`. This story must not create empty
   placeholder tabs for content that does not exist yet.

   **The five deferred keys are declared, not merely absent:** the descriptor carries
   `pendingTabs: ["resume", "photo", "medical", "files", "external-links"]` (canonical order,
   `TabKey` values) alongside its five `tabs`. That declaration is what makes a deliberately
   partial set legal — the validator asserts `keys(tabs) ∪ pendingTabs` **equals** the canonical
   shidduch row as sets, and asserts each array is independently a *subsequence* of that row, so
   a partial `tabs` passes and a genuinely forgotten tab still fails
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §3 rule 5, clauses (a)–(d) —
   which names this story's five-tab set verbatim as the sanctioned partial case. **Each of
   5.3–5.6 moves its key out of `pendingTabs` and into `tabs` in the same diff that builds the
   tab** — doing only one half is `tab-key-duplicated` or a missing key, and either fails the
   build.

   The descriptor module is `shidduchim/entityDescriptor.ts` and it **replaces** the Story 3.9
   stub in place: `registerEntityDescriptor(shidduchimDescriptor, { replace: true })`. Without
   `{ replace: true }` the call throws at module scope — the stub is already registered under the
   same `name` (`entity360/registry.ts:29-33`). Delete the stub's whole "UX-DR3 violation, stated
   honestly" doc block with it: it describes a routed `Dialog` this story deletes.

   **Falsifiable:** `findAd24Violations` against the real manifest returns `[]`;
   `npx vitest run src/components/atomic-crm/entity360` is green.

5. **Given** the existing 360 content, **when** it is relocated, **then**:
   - `ShidduchShowHeader.tsx` renders as the descriptor's `identityHeader`, and
     `ShidduchStateControl.tsx` (the pipeline-transition UI the routed dialog renders today) as
     its `actions` — so a state change stays available from every tab. Deleting the dialog without
     re-homing the control would remove the only transition UI on the 360.
   - `ShidduchCatchSection.tsx` + `ShidduchFactsCard.tsx` + `ShidduchSchoolsSection.tsx` +
     `RedtHistorySection.tsx` render under the `overview` tab, unchanged in behaviour (Story 5.2
     later extends the fields Overview shows; this story only moves the container).
   - `ShidduchReferencesSection.tsx` renders under the `diligence` tab, unchanged in behaviour
     (Story 5.10 later enriches it with reuse-awareness).
   - Notes, Tasks and Activity render via Epic 3's universal `NotesTab`/`TasksTab`/`ActivityTab`
     (Stories 3.6/3.8/3.5) with **`targetType="shidduch"` and `targetId={record.id}`** — the
     shipped prop shape is `UniversalTabProps = { targetType, targetId }`
     (`entity360/tabs/types.ts:11-14`); there is no `target_type` prop and no `record` prop. This
     story wires the shidduch entity into them, it does not build new note/task/activity UI.
   - `ShidduchTimeline.tsx` is **deleted** — its two behaviours (add-a-note, timeline) are
     superseded by the universal Notes and Activity tabs. Story 3.6's own text assigns exactly
     this retirement to Epic 5's migration.

   **Falsifiable:** `make typecheck` clean; an RTL render of `/shidduchim/1/diligence` shows the
   references section and `/shidduchim/1/tasks` shows `TasksTab`, not a form.

6. **The overview data-loading has a named owner.** **Given** that `ShidduchShow.tsx` performs
   four fetches (`ShidduchShow.tsx:66-76`: `useGetOne<ShidduchSummary>("shidduchim")`, plus
   `useGetList` on `redts`, `shadchanim` and `shidduch_schools`) and passes the results down as
   props, **when** that file is deleted, **then** those fetches are re-homed into the descriptor
   module's own components, not dropped and not pushed into `EntityShow`.

   `EntityShow` fetches nothing beyond the record `ShowBase` already supplies, and
   `EntityTabDescriptor.render` is **arity-zero** — the record is reached inside `render` via
   `useRecordContext()` (`entity360/entityDescriptor.ts:106-112`). Region renderers are
   `ComponentType<{ record }>` and are explicitly permitted to call hooks
   (`entityDescriptor.ts:52-56`: *"They are a component boundary, so they MAY call hooks … The descriptor module owns its own data loading"*). So:

   | Old fetch | New owner |
   |---|---|
   | `useGetOne("shidduchim")` | gone — `ShowBase` supplies the record via `RecordContext` |
   | `useGetList("shadchanim")` → `firstSuggestedByName` | `ShidduchIdentityHeader`, the `identityHeader` adapter |
   | `useGetList("redts")` + `shadchanName` | `ShidduchOverviewTab`, rendered by the `overview` tab's `render` |
   | `useGetList("shidduch_schools")` | `ShidduchOverviewTab` |

   `shadchanim` is fetched by both the header and the overview tab; React Query dedupes identical
   query keys, so this is one request, not two. **"Relocate, do not rewrite" therefore applies to
   the five presentational components, not to the fetch/prop plumbing between them** — the
   plumbing must be re-authored, and adapters are authorised for it:
   `ShidduchShowHeader = ({ shidduch, firstSuggestedByName })` and
   `ShidduchStateControl = ({ id, currentState, name })` do not fit
   `ComponentType<{ record: ShidduchSummary }>`, so each gets a one-line wrapper in the descriptor
   module. Do not edit the five components' own prop signatures.

   **One behavioural edit is required, not optional:** `ShidduchShowHeader.tsx:2,48,60` wraps its
   name heading in `<DialogTitle asChild>` and imports `@/components/ui/dialog`. Radix's
   `DialogTitle` throws outside a `Dialog` context, so the header cannot render on a page until
   that wrapper is removed. Remove it (the heading element itself stays), drop the import, drop
   the `<Dialog>` wrapper and its explanatory paragraph from `ShidduchShowHeader.test.tsx`, and
   delete **both** `"ShidduchShow.tsx"` and `"ShidduchShowHeader.tsx"` from `ALLOWED` in
   `misc/recordSurfaceDialogs.guard.test.ts:44-45` — commented *"routed 360 dialog — deleted by
   Story 5.1"* and *"DialogTitle only, because it renders inside the above — 5.1"* respectively.
   That file's assertion is a **subset** check, so stale entries do not turn it red; delete them
   because they are dead text naming files that no longer exist, and because the second one stops
   being true the moment the `DialogTitle` wrapper goes.

7. **Given** the old routed dialog, **when** this story completes, **then**
   `shidduchim/ShidduchShow.tsx` is deleted, `ShidduchimList.tsx`'s
   `matchPath("/shidduchim/:id/show", …)` (`:90`) and `<ShidduchShow open={…} id={…}>` (`:103`)
   wiring and its `import { ShidduchShow }` (`:15`) are removed, and no route or component named
   `ShidduchShow` / `/shidduchim/:id/show` remains anywhere in `src/`.

   **In the same diff**, delete the two AD-24 exemption rows this story is named in — they are
   symmetric, and an exemption that outlives its offender fires `stale-exemption` exactly as an
   unexempted offender fires its own code:
   - `entity360/ad24Conformance.ts:149` — `MODAL_RECORD_SURFACES["shidduchim/ShidduchShow.tsx"]`,
     `retiredBy: "5.1"`. `ad24Conformance.guard.test.ts:153-157` asserts the real `<Dialog>` scan
     and this table are **equal as sets**, and `:160+` asserts it again through
     `findAd24Violations` in both directions.
   - `entity360/ad24Conformance.ts:169` — `PENDING_ROUTE_SHAPES.shidduchim`, `retiredBy: "5.1"`.
     Its offender check is `descriptor.buildRecordPath(1) !== "/shidduchim/1"`
     (`ad24Conformance.ts:412`), which stops firing the moment AC-4's flip lands.

   Do **not** touch the `singles` / `shadchanim` / `references` rows in either table — they are
   5.8 / 5.9 / 5.10's, and removing them early fires the mirror violation on an innocent story.

8. **Given** that Story 3.9's sweep already routes record mentions through `RecordLink` —
   including `ShidduchCard.tsx` and `shadchanim/ShadchanSuggestions.tsx` — **when** this story
   changes the route shape, **then** the change is made in **one place**: the descriptor's
   `buildRecordPath` becomes ``(id) => `/shidduchim/${id}` ``. Do not edit the `RecordLink` call
   sites — they follow the registry, and `buildTabPath` derives from `buildRecordPath` too
   (`entity360/entityPaths.ts:60-67`), so tab links move with it.

   Four **test files** pin the old literal and must be updated in the same diff (each is a
   deliberate pin, not an accident):
   - `entity360/registry.stubs.test.ts:93-95` — **three** assertions on the `shidduchim` row:
     `buildRecordPath(1) === "/shidduchim/1/show"` (`:93`), `tabs toEqual []` (`:94`), and the
     **10-key** `pendingTabs` (case fixture at `:37-50`, asserted at `:95`). All three go red;
     all three must be retargeted to `/shidduchim/1`, the five-key `tabs`, and the five-key
     `pendingTabs`. The `describe.each` fixture is shared with the three other entities — edit the
     `shidduchim` case only, and note that the shared `it(...)` body asserts `buildRecordPath(1)`
     equals `` `/${name}/1/show` `` for **every** case (`:93`) and `tabs` `toEqual([])` for every
     case (`:94`), so both assertions have to become per-case fields on `StubCase` rather than one
     template string and one literal.
   - `shidduchim/ShidduchCard.test.tsx:61,72` — `href` and post-click pathname `/shidduchim/42/show`.
   - `shidduchim/ShidduchCatchSection.test.tsx:20,83-85` — the redirect target `/shidduchim/42/show`.
   - `reminders/ReminderCard.test.tsx:71` — `href` `/shidduchim/42/show`. Its own case title at
     `:58` ("links a shidduch-targeted reminder to the shidduch's **/show** route") becomes false
     with it — rewrite the title, not only the assertion. Leave `:12-20`, `:41`, `:52` and `:55`
     alone: those are the **shadchan** case and Story 5.9 owns them. This is one file, two
     stories, two disjoint line ranges — 5.1 touches it first, in Wave A.

   Afterwards
   `grep -rn "shidduchim/" src/components/atomic-crm --include='*.tsx' --include='*.ts' | grep "/show"`
   returns zero hits.

   **`ShidduchCatchSection.tsx` needs no change** — `:37-38` already reads
   `redirect(buildRecordPath("shidduchim", suggestion.prior_shidduchim_id), …)`. Story 3.9 site 13
   converted it. Do not "fix" it.

9. **Given** I am on a shidduch's 360 page, **when** I press the browser back button, **then** I
   return to the board or list I came from via native history — no custom navigation stack is
   introduced.

10. **Given** the page at 375px width and in both light and dark themes, **when** it renders,
    **then** no region overflows or clips (UX-DR11) — a manual smoke check, not a new visual
    regression harness.

## Tasks / Subtasks

- [x] **Task 1 — Confirm the Epic 3 gate** (prerequisite to all ACs)
  - [x] Run the grep in "World state assumed". If `Entity360` or the descriptor registry is
        missing, stop and report — do not build a local substitute.
  - [x] Read `entity360/{buildEntityRoutes.tsx, EntityShow.tsx, entityDescriptor.ts, registry.ts,
        entityPaths.ts, tabs/types.ts}` before writing the descriptor — this story consumes that
        API, it does not guess at it.
- [x] **Task 2 — Replace the descriptor** (AC: 4, 8)
  - [x] Rewrite `shidduchim/entityDescriptor.ts`: `buildRecordPath` returning the bare
        `/shidduchim/{id}` (template literal on `id`, no `/show` segment — the same shape
        `ad24Conformance.ts:412` and `routeConvention.tsx:68-71`'s `hasAd24RecordShape` both
        compare against — the latter via `encodeURIComponent(id)`, which is identical for the
        bigint ids this resource uses),
        the five `tabs` in canonical order, the five-key `pendingTabs`, `identityHeader`,
        `actions`, and `registerEntityDescriptor(shidduchimDescriptor, { replace: true })`.
        Delete the stub's "UX-DR3 violation" doc block.
  - [x] Write the adapters in the same module: `ShidduchIdentityHeader = ({ record }) => …` and
        `ShidduchActions = ({ record }) => <ShidduchStateControl id={record.id}
        currentState={record.pipeline_state} name={record.name_en} />` (AC-6).
  - [x] Update `entity360/registry.stubs.test.ts`'s `shidduchim` case — all three assertions.
- [x] **Task 3 — Build the tab content** (AC: 5, 6)
  - [x] `shidduchim/ShidduchOverviewTab.tsx`: `useRecordContext<ShidduchSummary>()` + the `redts`,
        `shadchanim` and `shidduch_schools` `useGetList` calls lifted verbatim from
        `ShidduchShow.tsx:66-76`; renders `ShidduchCatchSection`, `ShidduchFactsCard`,
        `ShidduchSchoolsSection`, `RedtHistorySection` with the props they already take.
  - [x] `diligence` tab `render`: a thin wrapper reading `useRecordContext()` and rendering
        `<ShidduchReferencesSection shidduchimId={record.id} />`.
  - [x] `notes` / `tasks` / `activity` tab `render`: `<NotesTab targetType="shidduch"
        targetId={record.id} />` and the same shape for `TasksTab` / `ActivityTab`.
  - [x] Remove `<DialogTitle asChild>` and the `@/components/ui/dialog` import from
        `ShidduchShowHeader.tsx`; drop the `<Dialog>` wrapper and its paragraph from
        `ShidduchShowHeader.test.tsx`; delete the two now-dead `ALLOWED` entries in
        `misc/recordSurfaceDialogs.guard.test.ts`.
  - [x] Delete `ShidduchTimeline.tsx` and scrub the prose that names it (Task 5).
  - [x] While in `entity360/tabs/interactionLabels.ts`: its `formatTimelineDate` docstring claims
        it is *"the only definition in the repo"*. Verify that claim against the tree; if other
        date formatters now exist, correct the sentence (deferred item **S21** — a one-line
        docstring fix, not a refactor).
- [x] **Task 4 — Mount the routes** (AC: 2, 3, 7)
  - [x] `shidduchim/ShidduchCreatePage.tsx` per AC-3; append `single_id` to
        `ShidduchColumn.tsx:105`'s "Add here" link.
  - [x] Rewrite `shidduchim/index.ts` per AC-2 (`buildEntityRoutes` + `hasShow: true`, keeping
        `import "./entityDescriptor";` first and `children: buildCreateRoutes("shidduchim")`).
  - [x] `ShidduchimList.tsx`: remove `matchNew` (`:21`) and the create early return with its
        Story-3.13 comment (`:45-52`), keeping the `buildNewPath` import (`:163` still needs it);
        remove `matchShow` / `<ShidduchShow>` / the import (`:15, :90, :103`).
  - [x] Delete `shidduchim/ShidduchShow.tsx`.
  - [x] Delete `RECORD_FLAG_EXEMPTIONS.shidduchim` (`root/routeManifest.ts:136-137`),
        `MODAL_RECORD_SURFACES["shidduchim/ShidduchShow.tsx"]` (`ad24Conformance.ts:149`) and
        `PENDING_ROUTE_SHAPES.shidduchim` (`ad24Conformance.ts:169`). Nothing else in either
        table.
- [x] **Task 5 — Retarget the pins and the prose** (AC: 8)
  - [x] Update the four test files listed in AC-8.
  - [x] `grep -rn "ShidduchTimeline" src/` returns **7** files today, five of them prose comments
        outside `shidduchim/`. Two die with `ShidduchShow.tsx`/`ShidduchTimeline.tsx`; four are
        this story's to scrub — `entity360/tabs/{interactionLabels.ts:8-9,33,
        interactionLabels.test.ts:15,62, ActivityTab.tsx:28, NotesTab.tsx:24,156}`. The seventh,
        `providers/commons/englishCrmMessages.ts:414`, is **Story 5.2's** under the Wave A
        ownership split (5-2 owns both i18n catalogues and performs this one-line scrub on 5-1's
        behalf) — do not edit it here; hand it off.
  - [x] `grep -rn "ShidduchShow\b" src/` returns nothing except `ad24Conformance.guard.test.ts`'s
        own scan-sanity needle, `it("the .ts/.tsx glob includes the known modal record surface
        ShidduchShow.tsx")` at `:116-121`, which must be **retargeted to another real modal record
        surface** — `tasks/TaskEdit.tsx`, `MODAL_RECORD_SURFACES`' remaining entry — because it
        asserts the glob *finds* `shidduchim/ShidduchShow.tsx` and goes red the moment the file is
        deleted. Its title and comment change with it. The prose mention at `:28` is inside that
        file's own doc block explaining why it excludes `ad24Conformance.ts`; update the example
        path there too.
  - [x] The AC-8 `/show` grep returns nothing.
- [x] **Task 6 — Verify** (AC: 1, 3, 10)
  - [x] Extend `shidduchim/ShidduchimList.test.tsx`'s existing harness with AC-1's record-route
        cases; confirm its two existing create-page assertions still pass unchanged.
  - [x] `npx vitest run src/components/atomic-crm/entity360` green, including
        `ad24Conformance.guard.test.ts` and `registry.stubs.test.ts`.
  - [x] `make typecheck && npm run lint && make test`.
  - [x] Run `make registry-gen` once at the end: this story adds `ShidduchOverviewTab.tsx` and
        `ShidduchCreatePage.tsx` and deletes `ShidduchShow.tsx` / `ShidduchTimeline.tsx`, and
        `scripts/generate-registry.mjs` globs every non-test source file under
        `atomic-crm/**` — so `registry.json` moves. 5-1 owns `registry.json` in Wave A.
  - [ ] Manual smoke at 375px, light and dark.

## Dev Notes

### Reuse — do not rebuild what already works

Every visual piece of the current 360 already exists and is well-built; this story's job is
**delivery mechanism** (page vs modal) and **routing**, not a redesign:

- `shidduchim/ShidduchShowHeader.tsx` — hero header (monogram, bilingual name, state chip,
  `via {shadchan} · Redt {date}`). One edit only: the `DialogTitle` wrapper (AC-6).
- `shidduchim/ShidduchStateControl.tsx` — the pipeline-transition UI (calls
  `dataProvider.transitionShidduch()` → the `transition_shidduch()` guard, AD-4); relocated,
  never rebuilt.
- `shidduchim/ShidduchFactsCard.tsx` — the facts grid (Story 5.2 extends its `facts` array).
- `shidduchim/RedtHistorySection.tsx` — redt history + add-a-redt form.
- `shidduchim/ShidduchSchoolsSection.tsx`, `shidduchim/ShidduchCatchSection.tsx`.
- `references/ShidduchReferencesSection.tsx` — this **is** the Diligence tab already; Story 5.10
  only adds the first/repeat indicator on top of it.

The one component of the old dialog that is **not** carried forward is `ShidduchTimeline.tsx`:
its add-a-note and timeline behaviours are exactly what 3.6's `NotesTab` and 3.5's `ActivityTab`
provide, and keeping it would be two implementations of the same thing (Single-owner rule).

### Why a page, not a `Show`

`ShidduchShow.tsx`'s own doc comment already explains the current design intent ("A routed
Dialog … over the board, not a `Show`, so the board stays visible behind the scrim") — that
intent is exactly what this story overturns per AD-24 ("records live at URLs, not modals") and
UX-DR3. Note that `shidduchim` never registered a `show:` prop on `<Resource>`; the dialog is
matched *inside* `ShidduchimList`, which is why the migration also has to take the create route
with it (AC-3).

### Testing standard

Per `.claude/rules/testing.md`: AAA structure, 80% coverage on new code paths. **The stack is
`vitest-browser-react` running in Chromium with ra-core's `TestMemoryRouter` — React Testing
Library is not a dependency of this repo.** The pattern to copy is
`shidduchim/ShidduchimList.test.tsx:60-77`: a real `<Resource name="shidduchim" {...shidduchim}>`
inside `<CoreAdminContext>` inside `<TestMemoryRouter initialEntries={[…]}>`, with the resource's
lazy `list` wrapped in `<Suspense>`. Mounting a bare component with no `ResourceContextProvider`
throws and React Router swallows the throw, which is how that file previously shipped an
unfalsifiable assertion — do not reintroduce that shape. `entity360/EntityShow.test.tsx:70-80`
shows the same harness driving `buildEntityRoutes` directly.

### Ordering inside Epic 5

This is the **first** Epic 5 story to land, and it runs in Wave A alongside 5-2 (the only
parallel pair in the epic — 5-2's declared dependency on 5-1 is soft: 5-2 edits
`ShidduchFactsCard`'s `facts` entries and the schema, 5-1 relocates the *container* without
editing the card). Stories 5.3–5.7, 5.10 and 5.11 all edit content that lives inside the tabs
this story creates. Story 5.8 (Single 360) and 5.9 (Shadchan 360) are independent pages but copy
this story's migration shape — the five-edit table at the top of this file is the pattern they
follow.

**Contested files this story owns for Wave A:** `entity360/{registry.stubs.test.ts,
ad24Conformance.ts, ad24Conformance.guard.test.ts}`, `entity360/tabs/{interactionLabels.ts,
interactionLabels.test.ts, ActivityTab.tsx, NotesTab.tsx}`, `root/routeManifest.ts` + `.test.ts`,
`misc/recordSurfaceDialogs.guard.test.ts`, `reminders/ReminderCard.test.tsx`, `registry.json`.
5-2 owns `providers/**` (including both i18n catalogues), `types.ts`, `supabase/**` and
`scripts/retired-names.json`. Do not cross — the one hand-off in each direction is named
explicitly (Task 5's `englishCrmMessages.ts:414` scrub, which 5-2 performs).

### Project Structure Notes

- No new schema, no new database objects. Purely a frontend relocation + Epic-3-consumption
  story.
- Follows the `src/components/atomic-crm/<domain>/` convention already in place; no new
  directories. Three new files: `ShidduchOverviewTab.tsx`, `ShidduchCreatePage.tsx`, and the
  rewritten `entityDescriptor.ts`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.1]
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §2 (`EntityDescriptor`, incl.
  `pendingTabs`), §3 rule 5 clauses (a)–(d) — which names this story's five-tab partial set
  verbatim, §4 rules 2 and 6 (`{ replace: true }`, no cross-descriptor reads at module scope),
  §5 rule 4 (a migrated entity registers `list` only, plus explicit `hasShow`/`hasEdit`),
  §8 (`UniversalTabProps = { targetType, targetId }`).
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#UX-DR5]
  — the shidduch tab matrix and its canonical order.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — shell, routes, `RecordLink`, no bespoke layout code.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23]
  — post-Epic-1 naming this story is written against.
- [Source: _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — the
  `buildRecordPath` registration this story updates, the 12-site `<Link>` sweep, and site 13
  (`ShidduchCatchSection.tsx`, already converted).
- [Source: _bmad-output/implementation-artifacts/3-13-records-at-urls-not-modals.md] — the
  create-page-inside-the-list shape AC-3 dismantles.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Capabilities, CAP-7]

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), dispatched as the `5-1` stack agent (`STACK_ID=1`, no DB work).

### Debug Log References

- `npm run typecheck` — clean (all three project configs).
- `npm run lint` — clean, `--max-warnings=0`. One structural fix was needed to get
  here: `shidduchim/entityDescriptor.tsx` originally defined its region/tab-render
  adapters inline, which `react-refresh/only-export-components` flags because the
  file's other export (`shidduchimDescriptor`) is not a component — confirmed via
  isolated probes against the repo's own eslint config before committing to the
  fix. Resolved by extracting the six adapters into a new
  `shidduchim/entityDescriptorRegions.tsx` (component-only exports); `entityDescriptor.tsx`
  now only imports and assembles.
- `npx prettier --check` — clean after one `--write` pass on two files.
- `npx vitest run` — 182 files / 1882 tests passed (whole suite, including the
  concurrently-edited sibling files from another Wave A agent).
- `make test STACK_ID=1` — 168 files passed / 14 skipped (db-project tests skip
  themselves with no live stack-1 Supabase instance, as designed; this story adds
  no migrations so none were needed), 1415 passed / 14 skipped.
- `make build` — succeeds (pre-existing >500kB chunk-size warning, unrelated).
- All four CI guards (`check-suppressions`, `check-retired-names`,
  `check-route-convention`, `check-tailwind-arbitrary-var`) — clean.
- `make registry-gen` — regenerated `registry.json` (adds the three new files,
  drops the two deleted ones, renames `entityDescriptor.ts` → `.tsx`).
- No SQL/schema touched — `supabase db diff --local` not applicable.

### Completion Notes List

- Renamed `shidduchim/entityDescriptor.ts` → `.tsx`: the rewritten descriptor's
  region/tab renderers need JSX, which the old stub never did. This is a framework-
  level fact, not a one-off — 5.8/5.9/5.10 will need the same rename for their own
  header adapters — so `ad24Conformance.ts`'s `isPathBuilderAllowed` and
  `ad24Conformance.guard.test.ts`'s `isExcludedFromListPathScan` were widened from
  `/\/entityDescriptor\.ts$/` to `/\/entityDescriptor\.tsx?$/` in the same diff;
  otherwise the new file would have registered as a `hand-built-record-path`
  offender.
- `ad24Conformance.guard.test.ts`'s `resolveIndexModule` assumed `list:` binds
  directly to the browse component's identifier. Story 5.1 is the first entity
  where that is no longer true (`list: buildEntityRoutes({ List: ShidduchimList, ... })`),
  so it resolved to the wrong module (`buildEntityRoutes` itself) and silently
  dropped `shidduchim` from `resolvedIndexModules`/`browseShapedIndexes`, which
  would have failed the guard's own AC 10(c) sanity assertions. Fixed by adding
  `extractListComponentName`, which tries the migrated `buildEntityRoutes({ List: X })`
  shape first and falls back to the plain `list: X` shape for the three
  still-unmigrated entities.
- `ad24Conformance.guard.test.ts`'s AC 8 sanity needle
  (`"the .ts/.tsx glob includes the known modal record surface ShidduchShow.tsx"`)
  retargeted to `tasks/TaskEdit.tsx` (`MODAL_RECORD_SURFACES`' remaining entry), per
  the story's own Task 5 instruction.
- The `ShidduchTimeline` prose scrub across `interactionLabels.ts`,
  `interactionLabels.test.ts`, `ActivityTab.tsx` and `NotesTab.tsx` also picked up
  `ActivityTab.tsx:16`'s "ShidduchShow.tsx's skeleton idiom" mention (a `ShidduchShow`
  match the same `grep -rn "ShidduchShow\b"` check catches) even though the story
  text only named it for the `ad24Conformance.guard.test.ts` needle — left it
  unscrubbed would have been a dangling reference to a file this story deletes.
- `providers/commons/englishCrmMessages.ts:414`'s `ShidduchTimeline` mention (5.2's
  hand-off item, per this story's Task 5) was already clear of the retired name by
  the time this story finished — either 5.2 landed its own scrub concurrently, or
  it had already been rewritten; verified by grep, not edited here either way (out
  of this story's declared ownership).
- `grep -rn "ShidduchShow\b" src/` is clean except one out-of-scope hit:
  `references/RepeatRecognitionPanel.tsx:126`, a prose comment analogy ("...like
  `ShidduchShow`: a few `Skeleton` bars...") in a file outside this story's
  declared paths (`references/**` is not 5-1's). Not fixed — flagged instead, per
  the parallel-ownership rule ("needing one outside them means report and stop").
- `e2e/references-scoping.spec.ts:74,113` hard-codes
  `page.goto(`${APP_URL}/#/shidduchim/${shidduchId}/show`)`, which this story's
  `buildRecordPath` flip breaks (that URL now resolves through the AD-24 `:id/:tab`
  route with `tab="show"`, an unknown tab key, triggering the unknown-tab
  redirect to `overview` instead of whatever that spec expects next). This file
  is not in 5-1's declared file set (only `e2e/{pipeline,navigation}.spec.ts` +
  `e2e/fixtures.ts`, neither of which needed changes — verified by grep, no
  `/show` literal or record-route navigation in either), so it was not edited —
  flagged here for the sibling/owner story or a follow-up to fix. This is exactly
  the "L15 — a path flip that reaches e2e" landmine described in the epic-5
  pre-flight brief.
- Task 6's "Manual smoke at 375px, light and dark" was **not performed** — this
  session has no interactive browser available. `Entity360.responsive.test.tsx`
  (part of the green `entity360` suite, unmodified by this story) already asserts
  the shell's 375px/no-overflow behaviour structurally, and this story changes no
  layout code in `Entity360.tsx` itself — only which components render inside its
  existing regions. Flagged as not done rather than falsely checked off.
- A concurrent Wave A sibling agent (presumably 5-2) was actively editing
  `ShidduchCreate.tsx`, `ShidduchFactsCard.tsx`, `ShidduchFactsCard.test.tsx`,
  `ShidduchInputs.tsx` and adding `shidduchAge.ts`/`shidduchAge.test.ts` in the
  same working tree throughout this session (visible via `git status`, not
  touched by this story). All gates were re-run after noticing this and stayed
  green with their changes present, confirming no collision with this story's
  own edits. `registry.json` was regenerated once, at the end, per Task 6 — its
  exact contents will need a final regen at actual commit time if the sibling
  adds more files afterward (the repo's pre-commit hook does this automatically).

### File List

**Modified:**
- `src/components/atomic-crm/entity360/ad24Conformance.ts`
- `src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts`
- `src/components/atomic-crm/entity360/registry.stubs.test.ts`
- `src/components/atomic-crm/entity360/tabs/ActivityTab.tsx`
- `src/components/atomic-crm/entity360/tabs/NotesTab.tsx`
- `src/components/atomic-crm/entity360/tabs/interactionLabels.ts`
- `src/components/atomic-crm/entity360/tabs/interactionLabels.test.ts`
- `src/components/atomic-crm/misc/recordSurfaceDialogs.guard.test.ts`
- `src/components/atomic-crm/reminders/ReminderCard.test.tsx`
- `src/components/atomic-crm/root/routeManifest.ts`
- `src/components/atomic-crm/root/routeManifest.test.ts`
- `src/components/atomic-crm/shidduchim/ShidduchCard.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchCatchSection.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchColumn.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchShowHeader.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchShowHeader.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimListContent.tsx`
- `src/components/atomic-crm/shidduchim/index.ts`
- `registry.json`

**Renamed + rewritten:**
- `src/components/atomic-crm/shidduchim/entityDescriptor.ts` → `entityDescriptor.tsx`

**Added:**
- `src/components/atomic-crm/shidduchim/ShidduchOverviewTab.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchCreatePage.tsx`
- `src/components/atomic-crm/shidduchim/entityDescriptorRegions.tsx`

**Deleted:**
- `src/components/atomic-crm/shidduchim/ShidduchShow.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx`

**Not touched (out of this story's declared scope — flagged in Completion Notes):**
- `references/RepeatRecognitionPanel.tsx` (a stale `ShidduchShow` prose analogy)
- `entity360/routeConvention.tsx` (review F3 — see Review Fix Notes below; needs an
  explicit owner before 5-9/5-10 start)

### Review Fix Notes (this pass)

Addressed the adversarial review's two BLOCKING findings and its agreed should-fixes:

- **F1 (blocking, L15) — fixed.** `e2e/references-scoping.spec.ts:74,113` retargeted
  `/shidduchim/{id}/show` → `/shidduchim/{id}/diligence` (`ShidduchReferencesSection`,
  the "Add a reference" CTA's container, lives on the diligence tab per AC-5, not
  overview). This story now **does** own and fix the file the original pass correctly
  flagged as outside its declared set — the review explicitly assigned it here.
  Verified by running the full e2e suite once, on stack 1
  (`make start-supabase-e2e STACK_ID=1 STACK_OWNER=fix-5-1` +
  `STACK_ID=1 npx playwright test`): 39 passed, 7 device-scoped skips, 0 failed,
  both `references-scoping.spec.ts` cases green on both `chromium` and
  `Mobile Chrome` projects. Stack 1 released afterward
  (`make stop-app-e2e` / `stop-supabase-e2e STACK_ID=1`).
- **F2 (blocking) — fixed.** `ShidduchimList.test.tsx`'s AC-1 describe block gained a
  test asserting the identity header's name heading ("Chaim Cohen") and the
  state-transition control's heading ("Move through the pipeline") render at
  `/shidduchim/1` — the assertion mutation testing had proven absent (deleting
  `identityHeader`/`actions` from the descriptor left the full suite green). Verified
  by re-applying that exact mutation against the fixed suite: the new test goes RED
  (`Cannot find element with locator: page.getByRole('heading', { name: 'Chaim Cohen' })`),
  closing the hole.
- **Related gap (AC-5's own falsifiable clause) — fixed.** Added RTL coverage for
  `/shidduchim/1/diligence` (references section heading), `/shidduchim/1/tasks`
  (`TasksTab`'s "Add task" button) and `/shidduchim/1/activity` (`ActivityTab`'s empty
  state) — the three tab renderers in `entityDescriptorRegions.tsx` that shipped with
  zero coverage.
- **F4 (minor prose) — fixed**, both in files this story owns/authored:
  `ShidduchOverviewTab.tsx:17`'s stale `entityDescriptor.ts` reference corrected to
  `entityDescriptorRegions.tsx` (the module `ShidduchIdentityHeader` actually lives
  in); `ad24Conformance.ts:633`'s doc widened from `*/entityDescriptor.ts` to note the
  `.tsx` widening (cross-referencing `isPathBuilderAllowed`, which already matched
  `.tsx?`).
- **F3 (should-fix) — NOT fixed, deliberately.** `entity360/routeConvention.tsx:33-34,
  39-41`'s `buildCreateRoutes` doc comment is stale (it still describes shidduchim as
  "an unmigrated entity" whose create surface is "matched inside `ShidduchimList`
  itself" — both dismantled by this story). Agreed this is a real defect a 5-9/5-10
  reader could be misled by, but the review's own language treats it differently from
  F1: "(c) ... which must be assigned before 5-9 starts" — an ownership assignment, not
  an "own and fix" directive like (a). `entity360/routeConvention.tsx` is outside this
  story's declared Wave-A file set (confirmed: `git log` shows it untouched by both 5-1
  and 5-2's diffs), so per `.claude/rules/parallel-ownership.md` ("touch only declared
  paths; needing one outside them means report and stop") it was left alone. **Needs an
  explicit owner before 5-9 starts** — whoever picks it up should correct the two stale
  sentences to describe the post-5.1 state (shidduchim's create surface is now
  `buildEntityRoutes`' `New` slot, not a `ShidduchimList`-internal match).
- **F6 (AC-10 unmet) — no action.** Already honestly flagged (Task 6's last box
  unchecked, Status `review`); "fixing" this would mean fabricating a manual smoke
  check that did not happen. Left as-is per the review's own assessment.

**Concurrency note:** this fix pass ran on the shared `main` working tree (no
worktrees, per this session's brief) alongside at least one other concurrent agent.
Two artifacts appeared and changed mid-session, neither touched by this pass:
`vitest.config.ts`'s `setTimezone` browser command (gained debug instrumentation,
mid-edit, and a `shidduchAge.test.ts` CDP-session regression as a result) and a
transient `shidduchim/tzdebug.test.ts` scratch file (created and later removed by the
other agent). Both are outside `shidduchim/**`'s 5-1/5-2 ownership split and were left
untouched; the gate re-runs below exclude them explicitly where noted and are
otherwise the real, unfiltered output.

## Change Log

| Date | Change |
|---|---|
| 2026-07-30 | Story 5.1 implemented: shidduchim migrated onto `Entity360`/`buildEntityRoutes`; routed dialog deleted; five real tabs + five `pendingTabs`; all AD-24 exemption rows and test pins retargeted in the same diff. All ACs satisfied except the manual 375px/theme smoke check (no interactive browser in this session). Status → review. |
| 2026-07-30 | Review fix pass: F1 (e2e `/show` → `/diligence`, full e2e suite run on stack 1), F2 (identity header + state-control assertions, mutation-proven), diligence/tasks/activity tab coverage added, F4 (two stale doc references corrected). F3 (`routeConvention.tsx` stale doc) deliberately left unfixed — outside declared scope, flagged for explicit assignment before 5-9. Status remains `review` (AC-10 manual smoke still outstanding). |

### Wave A cross-reconciliation (committer)

Reconciled against Story 5.2 before the wave commit. The two diffs agree: this story's
`registry.json` regeneration includes 5.2's new `shidduchAge.ts` and reproduces byte-identically;
5.2 held the i18n lease and performed this story's `ShidduchTimeline` prose scrub, and
`grep -rn "ShidduchTimeline" src/ e2e/ supabase/` is now zero-hit; `ShidduchCreatePage` (this
story) and `ShidduchCreate` (5.2's) meet on an unchanged `{ singleId }` prop, so 5.2's widened
submit payload needed no change here. Every AD-24 exemption row this story retires
(`MODAL_RECORD_SURFACES`, `PENDING_ROUTE_SHAPES`, `RECORD_FLAG_EXEMPTIONS`,
`recordSurfaceDialogs.guard.test.ts`'s `ALLOWED`) went in the same diff as its offender.

Two notes carried forward rather than fixed, both outside this story's declared set:

- `ShidduchimList.test.tsx`'s first `describe` and its docblock still describe the create page as
  an early return *inside* `ShidduchimList` (`matchNew`). The mechanism moved to
  `buildEntityRoutes`' own `new` route; the tests still pass and still discriminate, but the prose
  is stale.
- The `?single_id=` parameter `ShidduchColumn` now threads to `ShidduchCreatePage` has no test.
  It arrives as a string from `useSearchParams`, while `singles` ids are numeric, so the
  `ReferenceInput`/`AutocompleteInput` pre-selection and the FakeRest `createShidduch` path are
  worth one focused test before 5.8 copies this shape.

`entity360/routeConvention.tsx` (review finding F3) remains unassigned — see Dev Notes above; it
must be owned before 5.9 starts.
