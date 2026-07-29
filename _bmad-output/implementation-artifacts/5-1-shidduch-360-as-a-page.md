# Story 5.1: Shidduch 360 as a page

Status: ready-for-dev

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

- [ ] **Task 1 — Confirm the Epic 3 gate** (prerequisite to all ACs)
  - [ ] Run the grep in "World state assumed". If `Entity360` or the descriptor registry is
        missing, stop and report — do not build a local substitute.
  - [ ] Read `entity360/{buildEntityRoutes.tsx, EntityShow.tsx, entityDescriptor.ts, registry.ts,
        entityPaths.ts, tabs/types.ts}` before writing the descriptor — this story consumes that
        API, it does not guess at it.
- [ ] **Task 2 — Replace the descriptor** (AC: 4, 8)
  - [ ] Rewrite `shidduchim/entityDescriptor.ts`: `buildRecordPath` returning the bare
        `/shidduchim/{id}` (template literal on `id`, no `/show` segment — the same shape
        `ad24Conformance.ts:412` and `routeConvention.tsx:68-71`'s `hasAd24RecordShape` both
        compare against — the latter via `encodeURIComponent(id)`, which is identical for the
        bigint ids this resource uses),
        the five `tabs` in canonical order, the five-key `pendingTabs`, `identityHeader`,
        `actions`, and `registerEntityDescriptor(shidduchimDescriptor, { replace: true })`.
        Delete the stub's "UX-DR3 violation" doc block.
  - [ ] Write the adapters in the same module: `ShidduchIdentityHeader = ({ record }) => …` and
        `ShidduchActions = ({ record }) => <ShidduchStateControl id={record.id}
        currentState={record.pipeline_state} name={record.name_en} />` (AC-6).
  - [ ] Update `entity360/registry.stubs.test.ts`'s `shidduchim` case — all three assertions.
- [ ] **Task 3 — Build the tab content** (AC: 5, 6)
  - [ ] `shidduchim/ShidduchOverviewTab.tsx`: `useRecordContext<ShidduchSummary>()` + the `redts`,
        `shadchanim` and `shidduch_schools` `useGetList` calls lifted verbatim from
        `ShidduchShow.tsx:66-76`; renders `ShidduchCatchSection`, `ShidduchFactsCard`,
        `ShidduchSchoolsSection`, `RedtHistorySection` with the props they already take.
  - [ ] `diligence` tab `render`: a thin wrapper reading `useRecordContext()` and rendering
        `<ShidduchReferencesSection shidduchimId={record.id} />`.
  - [ ] `notes` / `tasks` / `activity` tab `render`: `<NotesTab targetType="shidduch"
        targetId={record.id} />` and the same shape for `TasksTab` / `ActivityTab`.
  - [ ] Remove `<DialogTitle asChild>` and the `@/components/ui/dialog` import from
        `ShidduchShowHeader.tsx`; drop the `<Dialog>` wrapper and its paragraph from
        `ShidduchShowHeader.test.tsx`; delete the two now-dead `ALLOWED` entries in
        `misc/recordSurfaceDialogs.guard.test.ts`.
  - [ ] Delete `ShidduchTimeline.tsx` and scrub the prose that names it (Task 5).
  - [ ] While in `entity360/tabs/interactionLabels.ts`: its `formatTimelineDate` docstring claims
        it is *"the only definition in the repo"*. Verify that claim against the tree; if other
        date formatters now exist, correct the sentence (deferred item **S21** — a one-line
        docstring fix, not a refactor).
- [ ] **Task 4 — Mount the routes** (AC: 2, 3, 7)
  - [ ] `shidduchim/ShidduchCreatePage.tsx` per AC-3; append `single_id` to
        `ShidduchColumn.tsx:105`'s "Add here" link.
  - [ ] Rewrite `shidduchim/index.ts` per AC-2 (`buildEntityRoutes` + `hasShow: true`, keeping
        `import "./entityDescriptor";` first and `children: buildCreateRoutes("shidduchim")`).
  - [ ] `ShidduchimList.tsx`: remove `matchNew` (`:21`) and the create early return with its
        Story-3.13 comment (`:45-52`), keeping the `buildNewPath` import (`:163` still needs it);
        remove `matchShow` / `<ShidduchShow>` / the import (`:15, :90, :103`).
  - [ ] Delete `shidduchim/ShidduchShow.tsx`.
  - [ ] Delete `RECORD_FLAG_EXEMPTIONS.shidduchim` (`root/routeManifest.ts:136-137`),
        `MODAL_RECORD_SURFACES["shidduchim/ShidduchShow.tsx"]` (`ad24Conformance.ts:149`) and
        `PENDING_ROUTE_SHAPES.shidduchim` (`ad24Conformance.ts:169`). Nothing else in either
        table.
- [ ] **Task 5 — Retarget the pins and the prose** (AC: 8)
  - [ ] Update the four test files listed in AC-8.
  - [ ] `grep -rn "ShidduchTimeline" src/` returns **7** files today, five of them prose comments
        outside `shidduchim/`. Two die with `ShidduchShow.tsx`/`ShidduchTimeline.tsx`; four are
        this story's to scrub — `entity360/tabs/{interactionLabels.ts:8-9,33,
        interactionLabels.test.ts:15,62, ActivityTab.tsx:28, NotesTab.tsx:24,156}`. The seventh,
        `providers/commons/englishCrmMessages.ts:414`, is **Story 5.2's** under the Wave A
        ownership split (5-2 owns both i18n catalogues and performs this one-line scrub on 5-1's
        behalf) — do not edit it here; hand it off.
  - [ ] `grep -rn "ShidduchShow\b" src/` returns nothing except `ad24Conformance.guard.test.ts`'s
        own scan-sanity needle, `it("the .ts/.tsx glob includes the known modal record surface
        ShidduchShow.tsx")` at `:116-121`, which must be **retargeted to another real modal record
        surface** — `tasks/TaskEdit.tsx`, `MODAL_RECORD_SURFACES`' remaining entry — because it
        asserts the glob *finds* `shidduchim/ShidduchShow.tsx` and goes red the moment the file is
        deleted. Its title and comment change with it. The prose mention at `:28` is inside that
        file's own doc block explaining why it excludes `ad24Conformance.ts`; update the example
        path there too.
  - [ ] The AC-8 `/show` grep returns nothing.
- [ ] **Task 6 — Verify** (AC: 1, 3, 10)
  - [ ] Extend `shidduchim/ShidduchimList.test.tsx`'s existing harness with AC-1's record-route
        cases; confirm its two existing create-page assertions still pass unchanged.
  - [ ] `npx vitest run src/components/atomic-crm/entity360` green, including
        `ad24Conformance.guard.test.ts` and `registry.stubs.test.ts`.
  - [ ] `make typecheck && npm run lint && make test`.
  - [ ] Run `make registry-gen` once at the end: this story adds `ShidduchOverviewTab.tsx` and
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

### Debug Log References

### Completion Notes List

### File List
