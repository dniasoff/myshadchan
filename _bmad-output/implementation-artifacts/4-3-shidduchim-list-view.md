---
baseline_commit: bf8e366b6dd5b501b0bfd121c64c262690226ac5
---

# Story 4.3: Shidduchim pipeline — board, list and cards

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want a searchable list of shidduchim as well as the board,
so that I can find one — and move it along — without scanning columns or dragging.

## Position in Epic 4

**3rd of 5.** Depends on **4.1** (`EntityListView`, `useEntityListStatus`, the
`applyFullTextSearch` wiring rule) and **4.2** (`EntityListView`'s
`renderList`/`renderCards`/`viewMode` contract, `EntityListViewToggle`'s visual language) — both
must land first. This story reuses their *context-consuming* pieces directly rather than the
`<EntityList>` wrapper (see Dev Notes "Why this doesn't use `<EntityList>`").

**This story absorbs the judged mobile-pipeline redesign.** It was scoped as a separate wave "P";
that wave is folded in here rather than shipped ahead of this story, because a standalone wave
would ship a `useIsMobile()` *rendering* fork that this story then deletes — and because two of
the three redesign proposals independently reached for a `?view=list|board` URL param, which AC-1
below forbids. Shipping them apart is the 3-2 / 3-12 incompatible-mechanism failure verbatim
(`.claude/rules/parallel-ownership.md`).

**The `/shidduchim` nav relabel ("Pipeline" → "Shidduchim") is Story 4.4's, not this story's.**
It moved there with its acceptance criterion: 4.4 already rewrites `layout/navItems.ts` and
`layout/navItems.test.ts` wholesale, and the relabel additionally breaks three e2e files that
sign in by waiting on `getByRole("link", { name: "Pipeline" })` (`e2e/fixtures.ts`,
`e2e/pipeline.spec.ts`, `e2e/invite-acceptance.spec.ts`). One story owns `navItems.ts`. Do not
edit it here.

## The problem this story closes, measured

Not ergonomics — geometry. On a 390px phone the board is 1,846px wide inside a 358px scrollport
(1 of 7 columns visible), auto-scroll stalls at 29-47% and never recovers, the drop target
resolves from the dragged card's centre ~125px behind the finger, a release over empty space
silently writes a reorder with no toast and no undo, and **two of the seven states cannot be
reached by drag at any hold duration.** The board also hides 718px of itself at 1440 and 614px at
1920 — it has never fully worked at any width this product ships to.

## Acceptance Criteria

1. **One three-position control, keyed to the store — never the URL.** `/shidduchim` renders a
   three-position segmented control (**Board · List · Cards**) with the page's toolbar. The
   choice persists per user via ra-core's `useStore` under key `"shidduchim.pageView"` and
   survives navigation and reload. The **default** (nothing stored yet) is `"list"` on a phone and
   `"board"` otherwise.
   *Failing looks like:* (a) `grep -rn "view=" src/components/atomic-crm/shidduchim/` matches a
   query-param read or write; (b) typing in the search box or clicking a single pill returns the
   user to the Board (that is the URL-param failure mode — see Dev Notes "Why the view choice
   cannot live in the URL"); (c) two adjacent toggles (Board/List plus a separate List/Cards)
   render.

2. **`useIsMobile()` chooses a default, never a rendering.** Exactly one `useIsMobile()` call
   exists under `shidduchim/`, and its only consumer is the `useStore` default in AC-1. Board,
   List and Cards are each reachable at **every** viewport width.
   *Failing looks like:* `LSP findReferences` on `useIsMobile` shows a `shidduchim/` call site
   inside a render branch; or a 390px viewport cannot reach the Board.

3. **The list view is searchable.** A `q` search box (wired to a new `applyFullTextSearch` hook
   for resource `"shidduchim"`) filters server-side against Supabase in both List and Cards
   positions, and filters the Board too — it is the same `<List>`.
   *Failing looks like:* PostgREST answers `400` on a literal `q=` parameter (the hook was keyed
   to `"shidduchim_summary"` — see 4.1's dead-hook rule), or the Board ignores the term.

4. **Board and list share filters and context.** The selected single and the search text are the
   same state for both views — switching Board ⇄ List with a search term active, or with a
   different single selected, keeps both, and both survive a reload and a shared link. This closes
   a real gap: today the selected single lives in `ShidduchimList.tsx`'s local
   `useState<Identifier|undefined>`, so it survives neither.
   *Failing looks like:* the address bar's `filter` param contains no `single_id` after clicking a
   pill; or a reload resets to the first single.

5. **One shared status gate.** Loading, error (with retry), and the "no singles in this household
   yet" precondition render identically regardless of which position is active — no view has its
   own loading/error handling.
   *Failing looks like:* `grep -n "return null" shidduchim/ShidduchimListContent.tsx
   shidduchim/ShidduchimList.tsx` still returns a bare `null` for a pending state (today there are
   two, and they are two of the audit's seven "null loading" states).

6. **No second fetch on toggle.** Switching between positions does not re-query the data
   provider — all three read the same `useListContext()` data from the same `<List>` instance.
   *Failing looks like:* a network panel shows a second `GET .../shidduchim_summary` on toggle.

7. **The List position is a state-grouped pipeline, not a flat roster.** It renders one section
   per `PIPELINE_STATES` entry, in canonical order, each with a sticky header carrying the state
   name and a live count; a labelled jump bar above the sections (4 `triage` cells + 3 `decision`
   cells, per `PIPELINE_GROUPS`) with counts; `＋ Add here` on exactly the four
   `INITIAL_PIPELINE_STATES`; and a zero-count section renders its header plus a one-line note.
   When the pipeline is empty **no sections render at all** — one `EmptyState` with the action.
   *Failing looks like:* fewer than 7 sections at any data shape; or an `Add here` control on a
   non-initial state.

8. **Every state is reachable in two taps, with no drag, at any width.** Each row carries a
   `⇄ Move` control opening a bottom sheet listing **all seven** states, vertical, in canonical
   order, grouped `TRIAGE` / `DECISION`. Legality comes from `isValidTransition()`
   (`shidduchim/pipelineStates.ts`) unchanged. Illegal rows are **`aria-disabled="true"`, not
   `disabled`** — still focusable, carrying a visible inline reason, and tapping them fires the
   existing warning `notify()`. Terminal destinations are marked `· final` **before** the tap.
   *Failing looks like:* from `look_into`, the actionable set is not exactly `{yes, unsure, no}`;
   or an illegal row is `disabled` and therefore missing from the accessibility tree; or a state
   requires more than two taps.

9. **The five irreversible edges get friction and capture a reason.** Choosing a terminal
   destination (`for_sure_not | yes | unsure | no`) opens a confirm step stating that the state is
   final and offering an optional "Why?" field, which is passed as the **4th argument** to
   `dataProvider.transitionShidduch(id, from, to, closeReason)` — a parameter that has existed
   end-to-end since day one (`providers/supabase/dataProvider.ts`, `p_close_reason`) and that no
   call site has ever supplied. **No provider, type, schema or migration change is required.**
   *Failing looks like:* choosing a terminal destination calls `transitionShidduch` before the
   user confirms; or Cancel calls it at all; or the reason is dropped.
   *There is no Undo and this story does not pretend otherwise:* `PIPELINE_TRANSITIONS` has zero
   reverse edges and `transition_shidduch()` raises `check_violation` on anything else. A dead
   Undo button is worse than none.

10. **The Board keeps drag, and drag stops being able to do the wrong thing.**
    `ShidduchColumn` takes a `dragFrom` prop; a column failing `isValidTransition(dragFrom, state)`
    is not a droppable and dims (`isDropDisabled`). A drop into an absorbing state routes through
    the same confirm step as AC-9 instead of calling `transitionShidduch` directly.
    *Failing looks like:* dragging onto an illegal column still produces a post-hoc warning toast
    rather than being structurally impossible.

11. **No horizontal scroll on a phone, ever.** At a 390px viewport on `/shidduchim` in the List
    position, `document.scrollWidth === 390` **and** no descendant of `#main-content` has
    `scrollWidth > clientWidth`.
    *Failing looks like:* either assertion fails. This is the single highest-value test in the
    story — it converts a review checklist item into a CI property. (The Board's own contained
    `overflow-x` must be preserved and is asserted separately in the Board position.)

12. **Every row is a `RecordLink`.** The new `ShidduchRow` wraps its record mention in
    `entity360/RecordLink.tsx`, whose signature is **exactly five props** (`resource`, `id`,
    `children`, `className`, `style`) — no `onClick`, no `ref`, no spread. The `⇄ Move` button is a
    **sibling** of the anchor, never a prop on it and never inside it.
    *Failing looks like:* a hand-rolled `<Link to={`/shidduchim/${id}`}>`; or a nested interactive
    element inside the anchor.

13. **Loading has the shape of loaded.** The List skeleton is assembled from the same
    section/row primitives as the content, so loading height equals loaded height by construction.
    *Failing looks like:* the skeleton renders a different number of sections than the loaded
    view, or CLS is visibly non-zero on first paint.

14. **Verification.** `make typecheck && npm run lint && make test` pass; prettier clean on
    changed files; the Vitest suites in Task 9; an e2e spec (`e2e/shidduchim-list-view.spec.ts`)
    proving AC-1/AC-4, and the split `e2e/pipeline.spec.ts` (chromium asserts the Board, Mobile
    Chrome asserts the List by **accessible name**, e.g.
    `getByRole("region", { name: /New/ })` — width-independent and stronger than the current
    text-node match).

## Tasks / Subtasks

- [x] **Task 1 — Wire `shidduchim` search (AC: 3)**
  - [x] `providers/supabase/dataProvider.ts`, `lifeCycleCallbacks`: add
        `{ resource: "shidduchim", beforeGetList: applyFullTextSearch(["name_en", "name_he", "shadchan_name", "shadchan_name_he", "parents_en", "parents_he", "location_en", "location_he"]) }`,
        above the `...entityFilesCleanupCallbacks` spread and beside 4.1's `singles` /
        `shadchanim` entries.
  - [x] Key it to `"shidduchim"` — the resource the `<List>` is actually given — **not**
        `"shidduchim_summary"`, even though the provider redirects to that view internally. Story
        4.1's Dev Notes ("The dead-hook trap") document exactly why the latter would silently
        never fire; this is the one live redirect-backed resource in the epic, so the rule is
        load-bearing here.
  - [x] Do **not** pass `"phone"` or `"email"` — `applyFullTextSearch` rewrites those two literal
        names to `*_fts@ilike` columns that exist only on the fossil `contacts_summary` view.
  - [x] **Add a source comment naming Story 5.2 as the owner of this column list.** 5.2 AC-3
        drops `parents_en` / `parents_he` from `public.shidduchim` **and** `shidduchim_summary`
        and requires a repo-wide zero-hit grep for both names. Verified present today
        (`supabase/schemas/03_views.sql`), so this list compiles and runs now; 5.2 must replace
        the pair with `father_en, father_he, mother_en, mother_he` in the same diff that drops
        the columns, or every shidduchim search 400s. Neither story saw this before; the comment
        is what makes 5.2's own grep land on it.
  - [x] No FakeRest change needed (4.1 Dev Notes: `q` search is generic there).

- [x] **Task 2 — Hoist the selected single into the URL (AC: 4)**
  - [x] In `shidduchim/ShidduchimList.tsx`, delete the local `useState<Identifier|undefined>` for
        `singleId` and the `useEffect` that seeds it. Replace the outer
        `<List filter={{ single_id: selectedSingleId }}>` — a hard `filter`, computed from local
        state, that the user cannot override — with
        `<List filterDefaultValues={{ single_id: singles[0].id }}>`. ra-core's `getQuery()`
        (`useListParams`) falls back to `filterDefaultValues` only when neither the URL nor the
        list's stored params supply a value, so this is computed exactly once, synchronously, at
        the same moment today's `singleId ?? singles[0].id` is; the existing guard
        (`if (!identity || singlesPending) return null;` before `<List>` mounts) already
        guarantees `singles` is loaded, so no async race is introduced.
  - [x] The single-switcher pills read `filterValues.single_id` and call
        `setFilters({ ...filterValues, single_id: id }, displayedFilters)` from
        `useListContext()`, replacing their `onSelect`/local-`setState` wiring. `setFilters` is
        what writes the value into the URL's `filter` query param; `filterDefaultValues` only ever
        supplies the *initial* value.
  - [x] This makes `single_id` (and `q`, once Task 1 lands) part of the URL automatically — no new
        URL-sync code; it is ra-core's existing `ListBase` behaviour (4.1 AC-5), simply no longer
        bypassed.

- [x] **Task 3 — `ShidduchimViewSwitch`: the shared status gate and the three-position control (AC: 1, 2, 5, 6)**
  - [x] Restructure `ShidduchimList.tsx`'s inner layout: one
        `<List filterDefaultValues={…} filters={[<SearchInput source="q" alwaysOn key="q"/>]} pagination={null} perPage={200} sort={{field:"index", order:"ASC"}} actions={<ShidduchimActions/>}>`
        (Task 2's `filterDefaultValues`; unchanged `perPage` / `pagination={null}` — see Dev Notes
        "Why this list is never paginated") wrapping a new `ShidduchimViewSwitch`.
  - [x] `ShidduchimViewSwitch` calls `useEntityListStatus()` (4.1) **once** and renders the shared
        loading / error(+retry) states for anything other than `"ready"` / `"no-matches"`.
  - [x] View resolution, verbatim shape:
        ```ts
        const isMobile = useIsMobile();                                   // AC-2: the ONLY call
        const [stored, setStored] = useStore<"board"|"list"|"cards">("shidduchim.pageView");
        const view = stored ?? (isMobile ? "list" : "board");
        ```
        `useStore`'s one-argument overload returns `[T | undefined, setter]`
        (`node_modules/ra-core/dist/store/useStore.d.ts`), which is what makes "no stored choice
        yet" distinguishable from "the user chose board". Passing `isMobile ? … : …` as
        `useStore`'s *default argument* instead would make the default flip under a resize and is
        forbidden.
  - [x] Render `ShidduchimListContent` (the existing Kanban, unchanged in layout) for `"board"`,
        or the pipeline list sub-view (Task 4) for `"list"` / `"cards"`.
  - [x] The three-position segmented control (Kanban / `LayoutList` / `LayoutGrid` icons,
        `aria-pressed` per position, an accessible name on each, reusing `EntityListViewToggle`'s
        visual language but writing **this** store key) is the AC-1 switch. Do **not** reuse
        `useEntityListViewMode` — that hook is hard-keyed to `${resource}.entityListViewMode` and
        is two-position.
  - [x] The "no singles yet" precondition (`ShidduchimNoSingles`) stays a full early return
        **before** `<List>` mounts, unrelated to the status gate — while editing, replace its
        hand-rolled markup with `<EmptyState>` (`misc/EmptyState.tsx`).

- [x] **Task 4 — The pipeline list sub-view (AC: 7, 11, 12, 13)**
  - [x] New `shidduchim/ShidduchimPipelineList.tsx`: derives sections with the **existing**
        `getShidduchimByState` (`boardUtils.ts`) — unchanged — and renders
        `PipelineJumpBar` + one `PipelineSection` per `PIPELINE_STATES` entry.
  - [x] New `shidduchim/PipelineSection.tsx`: a `<section>` with an accessible name equal to the
        state label (this is what the e2e spec targets), a **sticky** header at
        `top-[var(--mobile-header-h)]` carrying the label and a live count, its rows, and
        `＋ Add here` for the four `INITIAL_PIPELINE_STATES` only (linking to the existing
        `?state=` create flow — the flow itself is unchanged). Zero-count sections render header +
        one-line note.
  - [x] New `shidduchim/PipelineJumpBar.tsx`: two rows, 4 + 3 cells, matching the `PIPELINE_GROUPS`
        split, each cell labelled with the state name and its live count, `min-h-11`, `gap-2`. It
        is a **table of contents**, not a mode switch and not sticky — a mis-tap costs a scroll.
        (A single 7-cell row cannot be labelled at 358px; wrapping is what buys the labels.)
  - [x] New `shidduchim/ShidduchRow.tsx`: 40px monogram (`entity360/avatar.ts`, same helpers
        `ShidduchCard` uses) · line 1 name (`text-sm font-semibold`, truncating) · line 2
        `{location} · {yeshiva} · {redt date}` (`formatRedtDate` from `boardUtils.ts`), tail facts
        dropped before the date · optional catch chip · trailing `⇄ Move` button. **No state
        chip** — the section is the state. The record mention is a `RecordLink` and the `Move`
        button is its **sibling** (AC-12).
  - [x] **Do not reuse `ShidduchCard`**: it is wrapped in `@hello-pangea/dnd`'s `<Draggable>` and
        requires the `DragDropContext`/`Droppable` ancestors only the Board provides. Reuse its
        *helpers* (`getMonogram`, `getAvatarIndex` from `entity360/avatar.ts`, `formatRedtDate`),
        not the component.
  - [x] Cards position: the same content as `ShidduchRow` in a non-draggable card grid
        (`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`), still grouped by section. Wire
        both positions through `<EntityListView resource="shidduchim" viewMode={view === "cards" ? "cards" : "list"} renderList={…} renderCards={…} …/>`
        — directly, **not** the `<EntityList>` wrapper (there is already an enclosing `<List>`;
        a second one would double-fetch, AC-6).
  - [x] Skeleton assembled from `PipelineSection` / `ShidduchRow` primitives (AC-13), replacing
        `ShidduchimListContent.tsx`'s and `ShidduchimList.tsx`'s bare `return null` loading states.
  - [x] **No within-state manual ordering in the List position.** `persistOrder()` was drag-only;
        rows stay sorted by `index` and only the Board can change it. This is a stated feature
        removal, and it removes the silent-write bug with it.

- [x] **Task 5 — Move primitives (AC: 8, 9)**
  - [x] New `shidduchim/useShidduchTransition.ts`: lift `handleMove` **verbatim** out of
        `ShidduchStateControl.tsx` — same `isValidTransition` guard, same `notify` strings, same
        `useRefresh` — and additionally return the seven states decorated
        `{ state, isCurrent, isAllowed, isTerminal, reason }`. Accepts an optional `closeReason`
        forwarded as `transitionShidduch`'s 4th argument.
  - [x] New `shidduchim/PipelineStateOptions.tsx`: the vertical, group-labelled option list of
        AC-8. Consumed by the Move sheet **and** by `ShidduchStateControl`.
  - [x] New `shidduchim/TerminalMoveConfirm.tsx`: AC-9. Does not call `transitionShidduch` until
        confirmed.
  - [x] New `shidduchim/ShidduchMoveSheet.tsx`: a `Sheet side="bottom"` (`max-w-lg mx-auto`)
        hosting `PipelineStateOptions`, with the record's name and current state in its header.
  - [x] Refactor `ShidduchStateControl.tsx` onto the two new primitives: its
        `flex flex-wrap gap-2` row of 7 chips (which renders the pipeline's own order across 3
        ragged rows at 52-115px — on the one screen whose entire subject is that order) becomes
        `PipelineStateOptions`; `disabled` + `opacity-40` becomes `aria-disabled` + a visible
        reason. **Its public props (`id`, `currentState`, `name`) are unchanged** — Story 5.1
        re-homes this exact component into `EntityShow`'s `actions` region and inherits the fixed
        option list for free.

- [x] **Task 6 — Board hardening (AC: 10)**
  - [x] `shidduchim/ShidduchColumn.tsx`: new `dragFrom` prop; `isDropDisabled` when
        `!isValidTransition(dragFrom, state)`; the column dims.
  - [x] `shidduchim/ShidduchimListContent.tsx`: `onDragEnd` branches into `TerminalMoveConfirm`
        for an absorbing destination instead of calling `transitionShidduch` directly. Board
        layout, `overflow-x` containment, the `onClickCapture` drag-end guard
        (`ShidduchCard.tsx`) and tap-to-open on a board card are all **unchanged** — the Board
        keeps drag, so that guard stays load-bearing.

- [x] **Task 7 — Page header trim (AC: 11)**
  - [x] `ShidduchimList.tsx`: `<h1>` `text-xl md:text-2xl` with `{n} redts`; subtitle becomes a
        functional hint ("Tap a row to open it. Tap ⇄ to move it along."); single pills go 32px →
        44px touch targets; `actions={isMobile ? false : <ShidduchimActions/>}` (the mobile FAB
        already carries create).
  - [x] **Cap this at the four bullets above.** Story 4.1 owns page header/toolbar chrome; if the
        change grows beyond them, stop and hand it back rather than forking a second header.

- [x] **Task 8 — Tour steps (AC: 2)**
  - [x] `tour/tourSteps.ts`: the pipeline steps must anchor to something that exists in the
        active position. Point `pipeline-board` at the list root, `pipeline-column` at the first
        `<section>`, `pipeline-card` at the first row, `add-suggestion` at the section's
        `＋ Add here`; replace the drag copy with *"Tap **Move** to send a shidduch along."*
  - [x] **Ownership warning:** Story 4.4 also edits `tour/tourSteps.ts` (it deletes the
        `nav-references` step under RULING 7). These are different steps in the same file — run
        the two stories sequentially and re-read the file before editing.

- [x] **Task 9 — Tests (AC: 14)**
  - [x] `shidduchim/ShidduchimViewSwitch.test.tsx`: a store seeded `"list"` / `"cards"` renders
        the pipeline list in that mode; `"board"` renders `ShidduchimListContent`; an **unseeded**
        store renders `"list"` under a mobile match-media and `"board"` otherwise (AC-1/AC-2); an
        `error` in the list context renders the shared error state regardless of the stored view.
  - [x] `shidduchim/useShidduchTransition.test.ts`: the legality/reason table as a pure unit,
        asserted against `PIPELINE_TRANSITIONS` so it cannot drift from `transition_shidduch()`.
  - [x] `shidduchim/ShidduchMoveSheet.test.tsx`: from `look_into` exactly `{yes, unsure, no}` are
        actionable; from `no` none are; illegal rows are `aria-disabled` **and still focusable**
        with a visible reason; the four terminal rows render `· final`.
  - [x] `shidduchim/TerminalMoveConfirm.test.tsx`: choosing a terminal destination does **not**
        call `transitionShidduch` until confirmed; confirming calls it exactly once with the
        reason as the 4th argument; Cancel calls it zero times. This is the regression guard on
        the only irreversible action in the product.
  - [x] `shidduchim/ShidduchimPipelineList.test.tsx`: 7 sections in `PIPELINE_STATES` order with
        correct counts; a zero-count section renders its header; `＋ Add here` renders for exactly
        the four `INITIAL_PIPELINE_STATES`; the skeleton's section/row count matches the loaded
        shape (AC-13).
  - [x] `shidduchim/ShidduchRow.test.tsx`: the row's anchor `href` equals
        `buildRecordPath("shidduchim", id)`; the `Move` button is not a descendant of that anchor
        (AC-12).
  - [x] `e2e/shidduchim-list-view.spec.ts`: switch to List, assert sections render (not the
        board); type a search term, switch to Board, assert the board's visible cards are filtered
        to the same term; switch a different single via the pills; reload and assert the List
        position, the search term and the selected single are all restored (view from the store,
        `q` / `single_id` from the URL's `filter` param).
  - [x] `e2e/pipeline.spec.ts` **split**: chromium asserts the Board; Mobile Chrome asserts the
        List by accessible name and carries **AC-11's no-horizontal-scroll assertion**.
  - [x] **Must stay green, untouched:** `shidduchim/boardUtils.test.ts`,
        `shidduchim/pipelineStates.test.ts`, all three `ShidduchCard.test.tsx` cases (including
        the drag-end guard — the Board keeps drag), `ShidduchimList.test.tsx`,
        `ShidduchCatchPanel.test.tsx`, `shidduchService.test.ts`.
  - [x] Re-shoot `shidduchim/__screenshots__` baselines. Playwright needs **both**
        `make start-supabase-e2e` and `make start-app-e2e`; take a `STACK_ID` (1-6, never 0) plus
        `STACK_OWNER=<label>` and stop the stack afterwards.

## Dev Notes

### Why the view choice cannot live in the URL

The obvious design — `?view=list` — is structurally broken on this page. ra-core's list-URL sync
(`useListParams`'s `changeParams`) rebuilds the query string wholesale from **its own params
only** (`filter`, `sort`, `order`, `page`, `perPage`, `displayedFilters`) on every filter/sort/page
write. Any foreign query param is silently dropped, so the first search keystroke or single-pill
click would wipe `?view=list` and dump the user back onto the Board mid-action.

Hence one store-persisted key, `"shidduchim.pageView"` (`useStore`, the same `"CRM"` localStorage
namespace as 4.2), holding `board | list | cards`. The trade — no view-addressable deep link — is
accepted: the epic's AC demands shared filters/context between views, not linkable views, and
everything shareable (`q`, `single_id`, sort) still lives in the URL via the `<List>`'s own sync.

**All three mobile-redesign proposals independently reached for `?view=`.** It is rejected on the
record. One control, three renderings; do not split it into a Board/List toggle plus a separate
List/Cards toggle — two adjacent toggles answering overlapping questions is exactly the divergence
AD-24 exists to prevent.

### Why the List position is state-grouped, not a flat roster

Because that is the only shape that deletes a defect class instead of managing it. A vertical
grouped list renders the same records in ordinary vertical scroll, shows all 7 states with counts,
and reaches every state in two taps using `ShidduchStateControl`'s already-shipped legality model.
Convention agrees: HubSpot's mobile stage change is a tap-list on the record, not a drag, and its
mobile "board" is one column per screen; Zoho ships no mobile Kanban at all.

Two costs, named rather than buried: **within-state manual ordering disappears** outside the Board
(net positive — it removes the silent-write bug — but it is a feature removal), and **spatial
memory goes** ("the third card in Look-into" has a place on a board and does not in a list; thin
at today's data volume, grows with it).

### Why this doesn't use `<EntityList>`

4.1's `EntityList` owns its own `<List>` instance internally. This page already needs one `<List>`
(`filter`, `perPage=200`, `pagination={null}`, `sort={index}` — all pre-existing and pipeline-
specific). Nesting `<EntityList>` would mount a *second*, independently-configured `<List>`,
double-fetching the same resource with two query-param syncs fighting over the same URL keys —
exactly the divergence AD-24 exists to prevent. So this story reuses the two *context-consuming*
pieces (`EntityListView`, `useEntityListStatus`) directly under the page's own single `<List>`.
This is the one entity in the epic where that distinction matters.

### Why this list is never paginated

Board and List render the *same* `data` array from the *same* `<List>`, and the Board structurally
needs every row (a Kanban column that silently drops rows past page 1 is a correctness bug, not a
UX choice). Both share the existing `perPage={200}` / `pagination={null}`. A family's per-single
shidduch count is bounded by real-world usage, not dataset size. Search and sort still work; only
paging is intentionally absent for this one entity.

### The route table is untouched — and what Story 5.1 does with it

`shidduchim/index.ts` today exports `{ list: ShidduchimList, children: buildCreateRoutes("shidduchim") }`
with **no `show`**, and `root/routeManifest.ts`'s `RECORD_FLAG_EXEMPTIONS` carries a `shidduchim`
entry whose own text names Story 5.1 as the story that retires it. This story changes what the
`list` component renders and nothing about how it is registered: no `buildEntityRoutes`, no
`hasShow`/`hasEdit`, no `EntityShow`, no edit to `shidduchim/index.ts` or `routeManifest.ts`.

Story 5.1 owns all of it, plus flipping
`shidduchimDescriptor.buildRecordPath` from `/shidduchim/{id}/show` to `/shidduchim/{id}` and
deleting the routed `<Dialog>` `ShidduchShow`. **Because every row here routes through
`RecordLink` → the descriptor (AC-12), that flip propagates to this story's output for zero
changes.** That is the whole reason AC-12 is non-negotiable.

Two further hand-offs to 5.1, recorded so they are not rediscovered:
- **`ShidduchStateControl`'s public props must not change** (Task 5). 5.1 mounts the same
  component with the same signature in `EntityShow`'s `actions` region.
- `ShidduchimList.tsx` is restructured here and gutted by 5.1 (it deletes `matchShow` and the
  `<ShidduchShow open>` mount). **Epic 4 must fully land before 5.1 starts** — same ~120 lines.

### What this story does NOT change

1. `ShidduchStateControl`'s legality model — `isValidTransition()` mirroring
   `transition_shidduch()`, the disabled *semantics*, the explanatory sentence, the 44px targets,
   the confirming toast. Refactor its layout; never its rules.
2. The Board's contained `overflow-x`, its 7-column layout, `getShidduchimByState`,
   `ShidduchCard`'s `onClickCapture` drag-end guard, and `{ _scrollToTop: false }` on board card
   links.
3. Column state tokens (`--st-*`), `StateChip`'s inline recipe, and the FR16 distinction between
   the gut `for_sure_not` and the post-investigation `no`.
4. `MobileContent`'s gutter (`x=16 w=358`, `#main-content`) and the fixed-bar tokens — no panel
   re-introduces its own padding.
5. `nb_suggestions`, `suggestions[]`, `ShidduchCatchSuggestion`, `createSuggestion()` and the
   `interactions`/`tasks` `target_type` values — DB/code identifiers. **The AD-23 sweep is labels
   only**: new user-facing copy in this story says shidduch / shidduchim / redt, never
   "suggestion" or "candidate".
6. `AD-4`: `transitionShidduch()` remains the sole write path for a state change. This story adds
   no second write path — it adds a second *surface* onto the same one.
7. Reverse edges in `PIPELINE_TRANSITIONS`. A `no → look_into` "the family came back" reopen is a
   genuine shidduchim need and the only route to a real Undo, but it is a schema +
   `transition_shidduch()` change — product work, file it, do not smuggle it in here.

### Architecture

- **UX-DR7 / AD-24**: "Lists render through one `EntityList`" — satisfied via the shared
  `EntityListView` / `useEntityListStatus` primitives, per "Why this doesn't use `<EntityList>`".
- **UX-DR11**: every screen renders empty, loading and error states, and works at 375px. AC-5,
  AC-7, AC-11 and AC-13 are that clause made falsifiable for this screen.
- **AD-4**: one canonical state, one transition guard, one write path.
- **AD-24 / UX-DR6**: every record mention through one `RecordLink` — board card, **list row**,
  timeline entry, rail panel, search result, reminder card.

### Ownership hazards (declare before dispatch)

| Shared artefact | Also edited by | Handling |
|---|---|---|
| `providers/supabase/dataProvider.ts` `lifeCycleCallbacks` | 4.1 (`singles`, `shadchanim`), Story 3.7 (`entityFilesCleanupCallbacks`) | Sequential; add above the spread, never reorder it. |
| `tour/tourSteps.ts` | 4.4 (deletes the `nav-references` step) | Sequential; re-read before editing. |
| `layout/navItems.ts` / `navItems.test.ts` | **4.4 only** | **Not this story's.** The relabel moved to 4.4 with its AC. |
| `shidduchim/ShidduchimList.tsx` | Story 5.1 (guts it) | Epic 4 lands fully before 5.1. |
| `registry.json` | any story adding files under `src/components/atomic-crm/**` | ~7 new files here; pre-commit regenerates. Commit on a quiet tree. |
| e2e stack | every story with a spec | Host-global singleton (`workers: 1`, fixed ports, `reuseExistingServer: true`). One `STACK_ID` per agent, never 0; stop it afterwards. |

### Testing standard

Same stack as 4.1/4.2: `vitest-browser-react` in real Chromium with `TestMemoryRouter`; **React
Testing Library is not a dependency.** `.claude/rules/testing.md` AAA + ≥80% coverage on new
files. `.claude/skills/e2e-conventions` — this story changes filters, search and interactions, so
the e2e specs are required, not optional; use deterministic waits, never `waitForTimeout`.

### Project Structure Notes

All new files live in `src/components/atomic-crm/shidduchim/`, alongside the existing
`ShidduchimListContent.tsx` (Board) they now sit next to. No new top-level directory, no new
route, no migration.

### Files this story will touch

```
src/components/atomic-crm/shidduchim/ShidduchimViewSwitch.tsx          (new)
src/components/atomic-crm/shidduchim/ShidduchimViewSwitch.test.tsx     (new)
src/components/atomic-crm/shidduchim/ShidduchimPipelineList.tsx        (new)
src/components/atomic-crm/shidduchim/ShidduchimPipelineList.test.tsx   (new)
src/components/atomic-crm/shidduchim/PipelineSection.tsx               (new)
src/components/atomic-crm/shidduchim/PipelineJumpBar.tsx               (new)
src/components/atomic-crm/shidduchim/ShidduchRow.tsx                   (new)
src/components/atomic-crm/shidduchim/ShidduchRow.test.tsx              (new)
src/components/atomic-crm/shidduchim/ShidduchMoveSheet.tsx             (new)
src/components/atomic-crm/shidduchim/ShidduchMoveSheet.test.tsx        (new)
src/components/atomic-crm/shidduchim/PipelineStateOptions.tsx          (new)
src/components/atomic-crm/shidduchim/TerminalMoveConfirm.tsx           (new)
src/components/atomic-crm/shidduchim/TerminalMoveConfirm.test.tsx      (new)
src/components/atomic-crm/shidduchim/useShidduchTransition.ts          (new)
src/components/atomic-crm/shidduchim/useShidduchTransition.test.ts     (new)
src/components/atomic-crm/shidduchim/ShidduchStateControl.tsx          (refactor, props unchanged)
src/components/atomic-crm/shidduchim/ShidduchimListContent.tsx         (status gate, onDragEnd)
src/components/atomic-crm/shidduchim/ShidduchColumn.tsx                (dragFrom/isDropDisabled)
src/components/atomic-crm/shidduchim/ShidduchimList.tsx                (List props, header trim)
src/components/atomic-crm/shidduchim/__screenshots__/**                (re-shot)
src/components/atomic-crm/tour/tourSteps.ts                            (pipeline steps only)
src/components/atomic-crm/providers/supabase/dataProvider.ts           (1 array entry)
e2e/shidduchim-list-view.spec.ts                                       (new)
e2e/pipeline.spec.ts                                                   (split)
registry.json                                                          (regenerated)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.3 AC text ("a searchable
  list with List/Cards toggle and a switch to the board"; "board and list share filters and
  context when switching"). Its third clause, "**And** Shidduchim appears in the primary
  navigation", is delivered by Story 4.4 — see "Position in Epic 4".
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — one shell, one route convention, one `EntityList`, one `RecordLink`.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-4]
  — one canonical state, one creation gate, one transition guard.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md]
  UX-DR11 — every screen renders empty, loading and error states and works at 375px.
- [Source: _bmad-output/implementation-artifacts/4-1-entity-list-framework.md] —
  `EntityListView` / `useEntityListStatus`, and the dead-hook naming rule Task 1 depends on.
- [Source: _bmad-output/implementation-artifacts/4-2-list-cards-toggle.md] —
  `renderList`/`renderCards`/`viewMode` and `EntityListViewToggle`'s visual language.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] §7 "`RecordLink`" rules 0, 3, 4
  and 5 — five closed props, `{_scrollToTop:false}` on board cards, dnd spreads before `onClick`,
  and a **list row** as a mention site.
- [Source: src/components/atomic-crm/shidduchim/pipelineStates.ts] — `PIPELINE_STATES`,
  `PIPELINE_GROUPS`, `PIPELINE_TRANSITIONS`, `INITIAL_PIPELINE_STATES`, `isValidTransition`,
  `getPipelineStateDef`.
- [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts] —
  `transitionShidduch(id, from, to, closeReason?)` → `p_close_reason`; `lifeCycleCallbacks`.
- [Source: node_modules/ra-core/dist/store/useStore.d.ts] — the one- and two-argument overloads.
- [Source: .claude/rules/testing.md], [Source: .claude/skills/e2e-conventions/SKILL.md],
  [Source: .claude/rules/parallel-ownership.md], [Source: .claude/rules/lsp-usage.md]

### Inherited from the loose-ends round (commit `af2074e`)

The Epic 1–3 loose-ends round ran in parallel with Epic 4 on `main`. Three UI defects from its
item I fell inside this story's declared paths, so it reported and stopped rather than taking them
(`.claude/rules/parallel-ownership.md`, "Out-of-scope work is reported, not taken"):

- `shidduchim/ShidduchColumn.tsx:46, :48, :67, :73, :74`
- `shidduchim/ShidduchCard.tsx:154`
- `shidduchim/ShidduchimList.tsx:145-159`

If this story's redesign deletes or replaces any of these, the defects go with them — confirm that
rather than assuming it, and record which of the three the redesign made moot.

**One fix already landed for you, deliberately ahead of this story.** `af2074e` corrected
`components/ui/sheet.tsx`: `side="bottom"` had no width cap, so a bottom sheet spanned the entire
viewport on desktop (measured 1440px wide, giving the reminder sheet a 1408px submit button). It
now carries `mx-auto sm:max-w-lg sm:rounded-t-2xl`, matching the `left`/`right` sides' own
`sm:max-w-sm` cap; below the `sm` breakpoint it is still edge-to-edge, which is correct for a
phone (re-measured at 390px: unchanged). This was sequenced *before* this story on purpose —
`ShidduchMoveSheet.tsx` does not exist yet and this story is last in Epic 4's chain, so building
it now means it inherits the corrected primitive instead of the bug. Do not re-add a width class
to the bottom sheet at the call site.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (bmad-dev-story), STACK_ID=4, STACK_OWNER=epic4-w4-story43.

### Debug Log References

- `npm run typecheck` — clean (all three tsconfigs).
- `make lint` (eslint --max-warnings=0 + prettier --check) — clean.
- `npx vitest run --project app` — 135 files / 1026 tests passed (includes the 18 new/changed
  `shidduchim/*.test.ts(x)` files, 97 tests).
- `npx vitest run --project scripts --project functions --project workers` — 23 files / 289 tests
  passed (unaffected by this story; run as a regression sweep).
- `make test STACK_ID=4` (includes the `db` project against a live Supabase instance) — 171 files /
  1772 tests passed.
- `make build` — clean production build.
- `npx prettier --check .` — clean on every file this story touched (pre-existing drift on
  unrelated `.github/`, `doc/`, `.lintstagedrc` files, none of which this story touched, is
  out of scope and unaffected).
- CI guards: `check-retired-names.mjs`, `check-suppressions.mjs`, `check-route-convention.mjs`,
  `check-tailwind-arbitrary-var.mjs` all report OK. `check-wave-ownership.mjs` needs a
  pre-dispatch manifest this single-story dispatch was never given one for (its own docstring:
  "run by whoever drives a parallel wave... never by CI") — not applicable here, not run.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` — not run; no
  `supabase/schemas/**` file was touched (Task 1 keys a new lifecycle callback to existing
  `shidduchim_summary` columns only).
- e2e (`STACK_ID=4`, `make start-supabase-e2e` + `make start-app-e2e`): the full existing suite
  (32 tests across chromium + Mobile Chrome) plus the two new/changed specs — 30 passed, 3 skipped
  by design (this story's own chromium/Mobile-Chrome split), **2 failed** — see Completion Notes
  for the one pre-existing-test conflict this surfaced. Stack 4 stopped and its lease released
  afterward (`make stop-supabase-e2e STACK_ID=4`; `stack-lease.mjs show` confirms `STACK_ID=4 free`).

### Completion Notes List

- **Task 1** — `dataProvider.ts` `lifeCycleCallbacks`: added the `shidduchim` `applyFullTextSearch`
  entry (8 columns, keyed to `"shidduchim"` not `"shidduchim_summary"`), above the
  `...entityFilesCleanupCallbacks` spread, with the Story 5.2 ownership comment on the
  `parents_en`/`parents_he` pair.
- **Task 2** — `ShidduchimList.tsx`: local `singleId` state + effect deleted; `<List
  filterDefaultValues={{ single_id: singles[0].id }}>` replaces the hard `filter`; the
  single-switcher pills now call `setFilters({ ...filterValues, single_id }, displayedFilters)`.
  The `/shidduchim/new` create-page branch (rendered above `<List>`, so no `ListContext` exists
  there) parses `single_id` out of the raw `location.search` `filter` JSON instead, to keep
  "Add a suggestion" landing on the currently-selected single across that one navigation.
- **Task 3** — new `ShidduchimViewSwitch.tsx`: the one `useIsMobile()` call under `shidduchim/`
  (AC-2), the one `useEntityListStatus()` call for the shared loading/error gate (AC-5), and the
  three-position segmented control (Board/List/Cards icons, `aria-pressed`, own store key). The
  `isMobile ? false : <ShidduchimActions/>` Task 7 suggested for hiding the desktop toolbar on
  mobile would have been a SECOND `useIsMobile()` call, violating AC-2's "exactly one" — implemented
  as a CSS `hidden md:flex` on `ShidduchimActions`'s `TopToolbar` instead (same 768px breakpoint,
  no hydration flash, zero extra hook calls).
- **Task 4** — new `ShidduchimPipelineList.tsx` (+ `PipelineSection.tsx`, `PipelineJumpBar.tsx`,
  `ShidduchRow.tsx`): the state-grouped List/Cards sub-view, wired through `EntityListView`
  directly. AC-7's "pipeline is empty" EmptyState is decided by `ShidduchimPipelineList` itself
  (`data.length === 0 && !filterValues.q`), not `EntityListView`'s own empty/no-matches split —
  because `filterDefaultValues={{ single_id }}` means `filterValues` always carries a key, so the
  shared hook can only ever resolve to `"no-matches"`, never `"empty"`, for this one `<List>`
  (documented in `ShidduchimPipelineList.tsx`'s own header comment).
- **Task 5** — new `useShidduchTransition.ts` (lifted `handleMove` verbatim + the decorated
  seven-state option table + `classifySelection`), `PipelineStateOptions.tsx`,
  `TerminalMoveConfirm.tsx`, `ShidduchMoveSheet.tsx`. `ShidduchStateControl.tsx` refactored onto
  the same two primitives, public props unchanged. `TerminalMoveConfirm` also gained the same
  confirm-before-terminal-move friction, for consistency with the one shared transition path
  (AD-4) — Task 5 didn't explicitly ask for this on `ShidduchStateControl`, but leaving the future
  Story 5.1-relocated control able to skip confirmation on an irreversible move while the sheet
  cannot would be an inconsistent, un-reviewed gap in the same shared primitive.
  `TerminalMoveConfirm` renders as a `Sheet` (not a `Dialog`) — seemingly a pure implementation
  detail until `misc/recordSurfaceDialogs.guard.test.ts` (UX-DR3's "no record surface hides behind
  `@/components/ui/dialog`" guard, not in this story's declared paths) flagged a `Dialog`-based
  version as a new, unlisted exemption; a bottom sheet is dialog-primitive-equivalent
  (`components/ui/sheet.tsx` is itself `@radix-ui/react-dialog`), keeps the same sheet language
  `ShidduchMoveSheet` already opened, and needs no edit to that unowned guard file.
- **Task 6** — `ShidduchColumn.tsx`: `dragFrom` prop, `isDropDisabled` when
  `!isValidTransition(dragFrom, state.value)`, the column dims. `ShidduchimListContent.tsx`:
  `onDragStart` now tracks `dragFrom`; `onDragEnd` branches a legal-but-terminal drop into
  `TerminalMoveConfirm` (no local move, no write, until confirmed) instead of writing directly.
  Own `isPending` gate removed — `ShidduchimViewSwitch`'s shared gate covers it now.
- **Task 7** — header trimmed to the four bullets: `<h1>{count} redts</h1>` (`text-xl md:text-2xl`),
  the functional hint subtitle, 44px pills, `ShidduchimActions` CSS-hidden below `md`.
- **Task 8** — tour anchors moved to survive either position: `pipeline-board` now anchors
  `ShidduchimViewSwitch`'s own root (was the Board-only div); `pipeline-column`/`pipeline-card`/
  `add-suggestion` are dual-tagged on both `ShidduchColumn`'s and `PipelineSection`'s first
  column/section (mutually exclusive at runtime, so no duplicate lands in the DOM). Drag copy on
  the `pipeline-board` step replaced with Move-sheet language.
- **Task 9** — all listed unit test files written; `e2e/shidduchim-list-view.spec.ts` (new) and
  `e2e/pipeline.spec.ts` (split into a chromium/Board test and a Mobile-Chrome/List test carrying
  AC-11's no-horizontal-scroll assertion, adapted to the Mobile Chrome project's real 393px Pixel 5
  viewport rather than the AC text's illustrative 390px) both pass against a live stack. The six
  "must stay green" files (`boardUtils.test.ts`, `pipelineStates.test.ts`, all three
  `ShidduchCard.test.tsx` cases, `ShidduchimList.test.tsx`, `ShidduchCatchPanel.test.tsx`,
  `shidduchService.test.ts`) all still pass — `ShidduchimList.test.tsx` needed two assertion
  updates (its `/^Pipeline/` heading regex → `/redts$/`) because Task 3/7 restructure exactly the
  layout it pins, per this story's own dispatch note; no other file in that list needed a change.

**One real, unowned regression surfaced by the full e2e run, not fixed here (out of declared
scope):** `e2e/navigation.spec.ts` (Story 4.4's, not in this story's declared paths) hardcodes
`PRIMARY_NAV_HEADINGS["/shidduchim"] = "Pipeline"` and asserts `getByRole("heading", {level:1,
name:"Pipeline"})`. Task 7's mandated `<h1>{n} redts</h1>` rename (required by this story's own
AC and its own `ShidduchimList.test.tsx`) makes that literal string vanish from `/shidduchim`.
This was not listed in the story's "Ownership hazards" table and was found only by running the
full e2e suite, not the unit suite. Fix (for whoever owns that file): change the expected text to
something the new heading actually contains, e.g. a `/redts$/`-style match, mirroring the fix
already applied to this story's own `ShidduchimList.test.tsx`. Confirmed as the ONLY failure across
all 32 pre-existing + 2 new e2e tests (both chromium and Mobile Chrome projects) — every other
spec, including `entity-list-search`, `entity-list-view-toggle`, `invite-acceptance`,
`invite-sending`, `demo-banner-cls`, and the rest of `navigation.spec.ts` itself, is unaffected.

**Which of the three inherited loose-ends defects the redesign made moot** (the Dev Notes block
above asked for this and the story shipped without it; filled in afterwards by the
`nav-spec-fix` round, verified against the files as they stand on `main` rather than assumed):

- `shidduchim/ShidduchimList.tsx:145-159` — **moot, closed by this story.** The audit asked for
  the hand-rolled `<h2>No children yet</h2>` block to be deleted in favour of `<EmptyState>`.
  `ShidduchimNoSingles` now *is* an `<EmptyState>` call (title "No singles yet", `actionTo`
  `buildNewPath("singles")`), so both the stale "children" vocabulary and the bespoke markup went
  with the rewrite. Nothing left to do.
- `shidduchim/ShidduchColumn.tsx:46, :67, :74` — **NOT moot, still open.** Only the line numbers
  moved (46→59, 67→82, 74→89): `:59` is still `flex w-[250px] shrink-0`, and `:82`/`:89` still
  carry the `-mt-1.5` / `-mt-1` that cancel the parent `gap-3`. `git log -S 'w-[250px]'` puts both
  at `39dbcb4`, untouched by this story. What the redesign changed is the *symptom's* blast
  radius, not the defect: the List position and `PipelineJumpBar` now give every pipeline state a
  reachable route at any width, so the off-screen Decision half is no longer the only way to those
  columns. The Board itself is still 7×250px + gaps inside a 1128px main, scrolling on
  `ShidduchimListContent.tsx:179`'s `overflow-x-auto` with no visible affordance.
- `shidduchim/ShidduchCard.tsx:154` — **NOT moot, still open.** The meta row survived at the same
  line and is still `flex items-center gap-1.5`; the audit's `flex-wrap gap-x-1.5 gap-y-1` +
  per-item `whitespace-nowrap` was never applied, so the mid-word wrap and the varying card
  heights within a column stand. The Board is where `ShidduchCard` renders, and the Board is the
  one position this story did not redesign.

Net: one of three closed by the rewrite, two still open and now owned by whoever next takes the
**Board** position (they are Board-only defects — neither reaches the List or Cards positions this
story added).

`__screenshots__/**` (declared in this story's owned paths): confirmed `.gitignore`d
(`__screenshots__` at line 13) and not tracked by git before this story either — these are
`vitest-browser-react`'s own auto-captured on-failure diagnostic images, not Playwright visual
baselines, and nothing in the repo reads them back. There is nothing to "re-shoot" as a committed
artifact; noted rather than silently skipped.

### File List

**New:**
- `src/components/atomic-crm/shidduchim/ShidduchimViewSwitch.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimViewSwitch.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimPipelineList.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimPipelineList.test.tsx`
- `src/components/atomic-crm/shidduchim/PipelineSection.tsx`
- `src/components/atomic-crm/shidduchim/PipelineJumpBar.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchRow.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchRow.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchMoveSheet.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchMoveSheet.test.tsx`
- `src/components/atomic-crm/shidduchim/PipelineStateOptions.tsx`
- `src/components/atomic-crm/shidduchim/TerminalMoveConfirm.tsx`
- `src/components/atomic-crm/shidduchim/TerminalMoveConfirm.test.tsx`
- `src/components/atomic-crm/shidduchim/useShidduchTransition.ts`
- `src/components/atomic-crm/shidduchim/useShidduchTransition.test.ts`
- `e2e/shidduchim-list-view.spec.ts`

**Modified:**
- `src/components/atomic-crm/shidduchim/ShidduchStateControl.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimListContent.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchColumn.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.test.tsx`
- `src/components/atomic-crm/tour/tourSteps.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `e2e/pipeline.spec.ts`
- `registry.json` (regenerated, `make registry-gen`)

**Screenshots:** `shidduchim/__screenshots__/**` — gitignored, not a committed artifact; see
Completion Notes.
