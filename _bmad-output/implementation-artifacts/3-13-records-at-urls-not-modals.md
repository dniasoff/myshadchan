---
baseline_commit: d8dc26a5e6c52de7944be507a07baaa88d7af3bc
---

# Story 3.13: Records at URLs, not modals

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a record's own screen to be a page I can link to, refresh and navigate back out of,
so that no primary record is trapped behind a scrim.

## Position in Epic 3

**Depends on 3.2** for `entity360/entityPaths.ts`'s `buildListPath` / `buildNewPath`.
**Depends on 3.12** (`3-12-route-convention-new.md`) for the route-convention *adoption*: the
`/create` → `/new` rename (including `shidduchim/ShidduchimList.tsx:78`'s
`matchPath("/shidduchim/create", …)`), the `/create` → `/new` compatibility redirect, and the
`CreateButton` override. **That work is 3.12's, not 3.2's** — the contract's §10/§12 assignment
to 3.2 was split out by the project owner into 3.12, which is where the 14-site inventory now
lives. **Depends on 3.9** — `buildListPath` resolves through `requireEntityDescriptor`, and 3.9
is what registers the `shidduchim` descriptor.

**One story in Epic 3 depends on this one: 3.11**, the AD-24 conformance validator (the
contract calls it "3-15"; filed as `3-11-ad24-conformance-validator.md`). Its AC 4
`MODAL_RECORD_SURFACES` table consumes this story's two rulings — `ShidduchCreate.tsx`
converted to a page (AC 1) and `TaskEdit.tsx` exempted (AC 4) — instead of re-deriving them,
and deliberately does **not** list `ShidduchCreate.tsx`. **This story must therefore land
before 3.11**, any time after 3.2 / 3.12 / 3.9.

**Numbering note for the reader:** the Epic 3 contract's §12 build-order row labelled
"3-13" is the *tab-vocabulary* story (brief §3-F). **This is not that story.** This one owns
brief **§3-H** — the UX-DR3 residue that the contract's §10 table provisionally parked on
3-15 with the wording *"or explicitly deferred with a written trigger in that story"*. It has
been split out so 3-15 stays a pure validator and the two UX-DR3 rulings below get a real
owner.

**Scope boundary.** Unlike 3.1–3.8, this story touches live screens. That is deliberate and
unavoidable: UX-DR3 is a statement about surfaces that already exist, and it cannot be
satisfied by building machinery in `entity360/`. It changes **six** live files, moves **one**,
and adds **three** test files (see Project Structure Notes). It adds no database object, no
policy, no migration, and no file under `entity360/`.

## What UX-DR3 actually says, and the three modals it applies to

> **UX-DR3 — Records live at URLs, not in modals.** Primary records are deep-linkable,
> shareable, and correct under browser back/forward.
> [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:164-165]

UX-DR3 is mapped to Epic 3 in the FR coverage map
[Source: _bmad-output/planning-artifacts/epics.md:127] and stated again at
[Source: _bmad-output/planning-artifacts/epics.md:111]. AD-24 carries the same clause —
*"records live at URLs, not in modals"*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180].

Three `<Dialog>` surfaces on `main` render or author a record:

| Surface | Disposition | Owner |
|---|---|---|
| `shidduchim/ShidduchShow.tsx:35` — the routed 360 dialog over the board | Deleted, replaced by a page | **5.1** (AC 4 / Task 4) — **out of scope here** |
| `shidduchim/ShidduchCreate.tsx:96` — the "Add a suggestion" dialog over the board | Becomes the page at `/shidduchim/new` | **this story**, AC 1–3 |
| `tasks/TaskEdit.tsx:32` — the desktop task editor | **Exempt**, with the ruling and its reopening trigger recorded in-repo | **this story**, AC 4 |

Nothing else qualifies. Checked and confirmed **not** primary-record surfaces:
`inbox/AddToInboxDialog.tsx` and `inbox/InboxResolveDialog.tsx` (triage actions on an
`inbox_items` row — Epic 10's capture funnel, and neither is the shidduch's own screen),
`references/ReferenceMergeButton.tsx` (a merge confirmation), `settings/DeleteDataDialog.tsx`
(a destructive-action confirmation), `misc/ImageEditorField.tsx` (a field-level editor),
`layout/DemoBanner.tsx` (not a record at all), and `shidduchim/ShidduchShowHeader.tsx` (it
imports `DialogTitle` only because it renders *inside* `ShidduchShow` — 5.1 relocates it).

## The ruling on `tasks/TaskEdit.tsx`

**A task is not a primary record, so UX-DR3 does not require it to have a page.** Four
grounds, each checkable:

1. UX-DR3's own wording scopes the rule to *"primary records"*
   (`amendment-a2.md:164`), not to every editable row.
2. The primary-record set in this architecture is the set of entities that get an
   `EntityDescriptor` and a 360: `shidduchim`, `singles`, `shadchanim`, `references`
   (Epic 3 contract §3 rule 5 and §8's `ENTITY_TARGET_TYPES`). `tasks` is a registered
   resource [Source: src/components/atomic-crm/root/routeManifest.ts:98] but gets **no**
   descriptor in Epic 3 (contract §4 rule 3 names `tasks`/`inbox_items`/`members` as the
   three that must be reached through the guarded `getEntityDescriptor`), and no story
   through Epic 11 gives it a 360.
3. A task is a **dependent** row, not a subject: it carries `target_type` / `target_id`
   [Source: supabase/schemas/01_tables.sql:44-47] and is reached from its target's Tasks
   tab (contract §11 Ruling 2) or from the global `/tasks` list.
4. Routing the editor would need `buildEditPath("tasks", id)`, which throws — it resolves
   through `requireEntityDescriptor` (contract §4) — and the contract forbids the fallback
   of building `/{entity}/{id}/edit` by template literal. Giving `tasks` a fifth descriptor
   to work around that would contradict contract §4 rule 3 and break 3.9's four-registration
   pinning test.

**The two task editors are not a duplication defect either.** `tasks/TaskEdit.tsx` (a
`<Dialog>`) and `tasks/TaskEditSheet.tsx` (a full-height bottom `<Sheet>` via
`misc/EditSheet.tsx`) are two *responsive presentations*, chosen by `useIsMobile()`
[Source: src/components/atomic-crm/tasks/Task.tsx:183-191], of **one** shared form,
`tasks/TaskFormContent.tsx`. Collapsing them onto `EditSheet` would put a `side="bottom"`,
`h-dvh` full-viewport takeover on desktop [Source:
src/components/atomic-crm/misc/EditSheet.tsx:130-132]. This story therefore changes **no**
behaviour in `tasks/`.

**Reopening trigger (written, so this is a deferral and not an omission):** the first story
that registers an `EntityDescriptor` for `tasks` — none does through Epic 11 — moves this
editor to `/tasks/{id}/edit` built with `buildEditPath`, and removes `TaskEdit.tsx` from AC
5's allowlist. Until then, AC 5 makes a *second* dialog-wrapped record surface under `tasks/`
a build failure.

## Acceptance Criteria

1. **The shidduch create surface is a page, not a dialog.**
   `shidduchim/ShidduchCreate.tsx` imports nothing from `@/components/ui/dialog` and exports
   `ShidduchCreate({ singleId }: { singleId?: Identifier })` — the `open` prop and the
   `handleClose`/`onOpenChange` pair (`:50`, `:62`, `:96`) are **deleted**, because a page has
   no open state and closing it is `CancelButton`'s `navigate(-1)`
   [Source: src/components/admin/cancel-button.tsx:31-36]. `ShidduchimList.tsx` renders it as
   the whole route: when `matchPath("/shidduchim/new", location.pathname)` matches,
   `ShidduchimList` returns `<ShidduchCreate singleId={selectedSingleId} />` **instead of**
   its `<List>` — the early return sits above `<List>` (today's `:42-57`), not inside
   `ShidduchimLayout`, so neither the board nor `ShidduchimLayout`'s
   `if (isPending) return null` list-query gate (`:80-82`) sits behind or in front of the
   page. Verified by a test mounting `ShidduchimList` at `/shidduchim/new`: the create
   heading is present, and
   `await expect.element(screen.getByRole("heading", { name: /^Pipeline/ })).not.toBeInTheDocument()`.

2. **Create behaviour is preserved exactly, and the list path is not hand-built.**
   Unchanged: the `?state=` starting-column param read through
   `useSearchParams()` and validated against `INITIAL_PIPELINE_STATES`
   [Source: src/components/atomic-crm/shidduchim/pipelineStates.ts:101-106], defaulting to
   `"new"`; `redt_date` defaulting to today; and submission through
   `dataProvider.createShidduch(input)` with `origin: "manual"` — the sole INSERT path under
   AD-4, never `dataProvider.create`. The post-save `redirect("/shidduchim")` (`:84`) becomes
   `redirect(buildListPath("shidduchim"))` from `entity360/entityPaths.ts` (3.2), because
   contract §4 forbids any module building an entity path by template literal. Verified by
   three tests: `/shidduchim/new?state=look_into` preselects `look_into`;
   `/shidduchim/new?state=zzz` falls back to `new`; a successful submit calls
   `createShidduch` exactly once, never `create`, and leaves `location.pathname` at
   `/shidduchim`.

3. **The page frame and the primary-CTA recipe are shared, not copied.**
   `singles/SingleFormFrame.tsx` moves to `misc/FormPageFrame.tsx` and gains a required
   `eyebrow: string` prop in place of its hardcoded `"Family roster"`
   [Source: src/components/atomic-crm/singles/SingleFormFrame.tsx:25-27];
   `singles/SingleCreate.tsx` and `singles/SingleEdit.tsx` pass `eyebrow="Family roster"`, so
   both screens render byte-identically to today; `ShidduchCreate` passes `eyebrow="Pipeline"`
   with heading `"Add a suggestion"`. `ShidduchCreate`'s local `PRIMARY_CTA_CLASS` constant
   (`:26-35`) is **deleted** — it is a hand-copy of `login/primaryCtaClassName.ts`'s
   `PRIMARY_CTA_CLASSNAME` plus a sizing overlay that `layout/FormToolbar.tsx:18-21` already
   applies. The page's toolbar is `layout/FormToolbar`, which gains one optional prop,
   `saveLabel?: string`, forwarded to its `SaveButton` so `ShidduchCreate` keeps its
   `"Add a suggestion"` save label and `SingleCreate`/`SingleEdit` keep today's default.
   Verified by grep: `grep -rn "SingleFormFrame" src/` and
   `grep -rn "PRIMARY_CTA_CLASS\b" src/components/atomic-crm/shidduchim/` both return zero
   hits.

4. **The `tasks` exemption is recorded in the file a developer will open, with its
   reopening trigger.** A doc comment at the top of `tasks/TaskEdit.tsx` states: that the
   editor is a deliberate, named exemption from UX-DR3; the four grounds from the
   "ruling on `tasks/TaskEdit.tsx`" section above, in one sentence each; that
   `TaskEditSheet.tsx` is its mobile
   presentation of the same `TaskFormContent`, not a second implementation; and the exact
   reopening trigger (*"the first story that registers an `EntityDescriptor` for `tasks`"*).
   **No behavioural change is made to `tasks/`**: `TaskEdit.tsx`, `TaskEditSheet.tsx`,
   `TaskFormContent.tsx` and `Task.tsx`'s `useIsMobile()` branch keep today's behaviour, and
   `git diff --stat src/components/atomic-crm/tasks/` shows exactly one file changed, comment
   lines only.

5. **A guard test pins the remaining dialog-wrapped record surfaces, and it is proven able
   to fail.** `misc/recordSurfaceDialogs.guard.test.ts` scans the atomic-crm source with
   `import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })`
   — the one in-repo `?raw` precedent
   [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] —
   excludes `.test.`/`.guard.` paths exactly as that file does (`:44-52`), keeps files under
   `shidduchim/`, `singles/`, `shadchanim/`, `references/` or `tasks/` whose source imports
   `@/components/ui/dialog`, and asserts the resulting basename set is a **subset** of:
   ```ts
   const ALLOWED = new Set([
     "ShidduchShow.tsx",       // routed 360 dialog — deleted by Story 5.1
     "ShidduchShowHeader.tsx", // DialogTitle only, because it renders inside the above — 5.1
     "ReferenceMergeButton.tsx", // a merge confirmation, not a record surface — permanent
     "TaskEdit.tsx",           // AC 4's recorded exemption
   ]);
   ```
   Subset, not equality, so Story 5.1 deleting the first two entries leaves the test green.
   It carries a third `it` in the shape of that precedent's own sanity check (`:79-86`),
   asserting the scan **does** find `TaskEdit.tsx` — without it a broken glob or regex would
   make the whole guard vacuous. **Red before green, twice:** run the guard on unmodified
   `main` and record that it fails on `ShidduchCreate.tsx`; then, after AC 1 lands, add a
   throwaway file under `singles/` that imports `@/components/ui/dialog`, record the red run,
   and delete it. Both red runs go in the Debug Log.

6. **Nothing else regresses.** `npm run typecheck`, `npm run lint` and
   `npx vitest run --project app` are green. The e2e board spec (`e2e/pipeline.spec.ts`) does
   not exercise the create surface and needs no change — confirm with
   `grep -n "create\|new" e2e/pipeline.spec.ts` before claiming it.

## Tasks / Subtasks

- [x] **Task 1 — Gate: confirm 3.2, 3.12 and 3.9 have landed** (prerequisite to AC 1, 2)
  - [x] `grep -rn "shidduchim/create" src/` returns **zero** hits (**3.12's** rename, AC 5). If
        it does not, stop and report — do not do 3.12's rename inside this story; five of the
        six call sites are in files (`dashboard/Dashboard.tsx`, `dashboard/MobileDashboard.tsx`,
        `layout/MobileNavigation.tsx`, `shidduchim/ShidduchColumn.tsx`) that 3.12 is editing.
        **One non-zero hit found and judged benign, not a stop condition** — see Debug Log.
  - [x] `src/components/atomic-crm/entity360/entityPaths.ts` exports `buildListPath`, and
        `getEntityDescriptor("shidduchim")` resolves (3.9's stub). If either is missing,
        stop and report.
  - [x] Run the AC 5 guard as it will be written and capture the red output caused by
        `ShidduchCreate.tsx` (this is the first of the two required red proofs).

- [x] **Task 2 — Share the page frame and the CTA recipe** (AC: 3)
  - [x] `git mv src/components/atomic-crm/singles/SingleFormFrame.tsx
        src/components/atomic-crm/misc/FormPageFrame.tsx`; rename the component and its props
        interface to `FormPageFrame` / `FormPageFrameProps`; replace the hardcoded
        `"Family roster"` eyebrow with a required `eyebrow: string` prop.
  - [x] Update `singles/SingleCreate.tsx` and `singles/SingleEdit.tsx` to import from
        `../misc/FormPageFrame` and pass `eyebrow="Family roster"` — no other change; these
        two screens must render identically to today.
  - [x] Add `saveLabel?: string` to `layout/FormToolbar.tsx` and forward it to `SaveButton`'s
        `label`. Leave the toolbar's classes untouched.
  - [x] `grep -rn "SingleFormFrame" src/` returns nothing.

- [x] **Task 3 — Convert `ShidduchCreate` to a page** (AC: 1, 2)
  - [x] Delete the `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`
        import and JSX, the `open` prop, `handleClose`, and the local `PRIMARY_CTA_CLASS`.
  - [x] Wrap the form in `<FormPageFrame eyebrow="Pipeline" heading="Add a suggestion"
        description="A calm start — fill in what you know now, add the rest later.">` (the
        dialog's `DialogTitle`/`DialogDescription` copy, moved verbatim — see Dev Notes
        "Copy is deliberately unchanged").
  - [x] Keep `<Form onSubmit={onSubmit} mode="onBlur" defaultValues={…}>` and
        `<ShidduchInputs />` exactly as they are; replace the inline
        `FormToolbar`/`CancelButton`/`SaveButton` block (`:128-136`) with
        `<FormToolbar saveLabel="Add a suggestion" />` from `../layout/FormToolbar`.
  - [x] Swap `redirect("/shidduchim")` for `redirect(buildListPath("shidduchim"))`.
  - [x] In `ShidduchimList.tsx`: rename `matchCreate` to `matchNew`, move the match up into
        `ShidduchimList` itself (it needs `location`, so `useLocation()` moves with it),
        early-return `<ShidduchCreate singleId={selectedSingleId} />` **before** the `<List>`
        return, and delete the `<ShidduchCreate open={…} …/>` line from `ShidduchimLayout`
        (`:92`). Leave the `matchShow`/`<ShidduchShow>` wiring alone — 5.1 owns it.
  - [x] Confirm by hand at 375px and at desktop width, light and dark, that the page's form
        card does not overflow (UX-DR11,
        `amendment-a2.md:186-187`) — `ShidduchInputs` already branches on `useIsMobile()`.

- [x] **Task 4 — Tests for the page** (AC: 1, 2)
  - [x] New `shidduchim/ShidduchCreate.test.tsx`, browser-mode `app` project:
        `render()` from `vitest-browser-react` inside `ra-core`'s `TestMemoryRouter` +
        `CoreAdminContext` with a stubbed `CrmDataProvider`, following
        `layout/ContextSwitcher.test.tsx:1-10,60-72` (including its `locationCallback` for
        reading `location.pathname`). One `it` each, AAA: renders the heading and **no**
        `role="dialog"` element; `?state=look_into` preselects that starting column;
        `?state=zzz` falls back to `new`; submit calls `createShidduch` once with
        `origin: "manual"` and never calls `create`, and ends at `/shidduchim`.
  - [x] New `shidduchim/ShidduchimList.test.tsx` (or extend an existing one if 3.2 added it):
        mounted at `/shidduchim/new` with a stub provider supplying one `singles` row, assert
        the create heading is present and the board's `/^Pipeline/` heading is
        `.not.toBeInTheDocument()`.
  - [x] Do **not** use React Testing Library, `screen.queryByText` or `MemoryRouter` — none is
        a dependency of this repo.

- [x] **Task 5 — Record the `tasks` exemption** (AC: 4)
  - [x] Add the doc comment to `tasks/TaskEdit.tsx` per AC 4. English only
        (`.claude/rules/english-only.md`).
  - [x] Change nothing else under `tasks/`; verify with
        `git diff --stat src/components/atomic-crm/tasks/`.

- [x] **Task 6 — The guard** (AC: 5)
  - [x] Write `misc/recordSurfaceDialogs.guard.test.ts` per AC 5, copying the filter shape of
        `references/entitlementGate.guard.test.ts:44-52` and its sanity-check `it` (`:79-86`).
  - [x] Produce the second red proof: add a throwaway
        `singles/__dialogGuardFixture.tsx` importing `@/components/ui/dialog`, run the guard,
        record the failure, delete the file, re-run green.
  - [x] Paste both red outputs into the Debug Log References section.

- [x] **Task 7 — Verify** (AC: 6)
  - [x] `npm run typecheck && npm run lint && npx vitest run --project app`.
  - [x] `grep -n "create\|new" e2e/pipeline.spec.ts` — confirm the spec does not touch the
        create surface before asserting no e2e change is needed.

## Dev Notes

### Why the early return sits above `<List>`, not inside `ShidduchimLayout`

Today the create dialog is mounted by `ShidduchimLayout` (`ShidduchimList.tsx:92`), which is
a child of `<List>` and bails out on `if (isPending) return null` (`:80-82`) while the board's
own `shidduchim` query is in flight. Rendering the create **page** from there would gate a
form that needs none of that data behind the board's query, and would keep the board mounted
underneath it — which is the modal shape with the scrim removed, not a page. Both problems
disappear by returning the page from `ShidduchimList` itself, after the `singles` query it
already runs (`:20-40`) resolves the default `singleId`. The `ShidduchimNoSingles` guard
(`:38`) still applies first, and correctly: a shidduch belongs to a single.

### What 5.1 does with this afterwards

Story 5.1 replaces `ShidduchimList`'s hand-rolled `matchPath` switch entirely, by setting
`routeManifest.ts`'s shidduchim entry to `buildEntityRoutes({ List, New: ShidduchCreate,
Show: EntityShow })` (contract §5). `ShidduchCreate` is already the right shape for that
`New` slot after this story — a props-only page component with no open state — so 5.1's edit
is one line and this story's `matchPath` switch is deleted, not migrated. This story does
**not** call `buildEntityRoutes` itself: `EntityRouteConfig.Show` is required (contract §5),
and shidduchim has no page-shaped `Show` until 5.1 deletes `ShidduchShow.tsx`.

### Copy is deliberately unchanged

`"Add a suggestion"` is an AD-23 vocabulary violation as user-facing text (the record is a
**shidduch**). It is **not** fixed here. The string lives in seven places —
`shidduchim/ShidduchCreate.tsx:112,132`, `shidduchim/ShidduchimList.tsx:63`,
`dashboard/Dashboard.tsx:55`, `dashboard/MobileDashboard.tsx:81`,
`layout/MobileNavigation.tsx:172`, `tour/tourSteps.ts:180` — four of which are in files 3.2
is concurrently editing for the `/create` → `/new` rename, and one of which is a guided-tour
step keyed to `data-tour="add-suggestion"` (`ShidduchimList.tsx:62`, `tourSteps.ts:178`).
A partial rename produces two vocabularies on one screen, which is worse than one consistent
wrong one. This is **unowned work**: no story from Epic 3 through Epic 11 renames it (3.9
fixes only `reminders/reminderEntity.ts`'s `"Suggestion"` label). Flag it to the epic owner
rather than doing a third of it here.

### The `?raw` guard, precisely

`references/entitlementGate.guard.test.ts` is the only `?raw` source scan in the repo and the
only shape known to work under this vitest setup: `import.meta.glob` with
`{ query: "?raw", import: "default", eager: true }` (`:16-20`), a `basename()` helper (`:22`),
and a filter that drops `.test.`/`.guard.` paths so the guard does not match its own prose
(`:44-52`). A bare `import src from "./X.tsx?raw"` would need a `*?raw` module declaration to
typecheck under `strict` — do not introduce one.

Scan scope is the five entity/record directories only. `inbox/`, `settings/`, `misc/` and
`layout/` are deliberately outside it: their dialogs are actions and confirmations, and
widening the scan to them would turn the allowlist into a list of every dialog in the app,
which stops being a UX-DR3 statement.

### Why `tasks/` gets a comment and not a route

Summarised in "The ruling on `tasks/TaskEdit.tsx`" above; the load-bearing check for a
reviewer is ground 4. `buildEditPath` (contract §4) routes through `requireEntityDescriptor`,
which **throws** for an unregistered resource by design, and `tasks` deliberately has no
descriptor in Epic 3 (contract §4 rule 3). There is no supported way to give the task editor
a URL in this epic that does not either add a fifth descriptor — breaking 3.9's pinning test
and contract §4 rule 3 — or hand-build the path, which contract §4 forbids outright.

### Testing standard

`app` project, browser-mode vitest (`vitest-browser-react` in real Chromium) with `ra-core`'s
`TestMemoryRouter`; **not** React Testing Library, which is not a dependency. Negative
assertions use
`await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`
[Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:2-3,60-72]. AAA, one
behaviour per `it`, descriptive names, no `waitForTimeout`
[Source: .claude/rules/testing.md]. No backend, RLS or migration surface in this story, so
no `db`-project test. Validation commands are `npm run typecheck`, `npm run lint`,
`npx vitest run --project app` (equivalently `make typecheck` / `make lint` / `make test`).

### Project Structure Notes

Changed (6): `shidduchim/ShidduchCreate.tsx`, `shidduchim/ShidduchimList.tsx`,
`singles/SingleCreate.tsx`, `singles/SingleEdit.tsx`, `layout/FormToolbar.tsx`,
`tasks/TaskEdit.tsx` (comment only).
Moved (1): `singles/SingleFormFrame.tsx` → `misc/FormPageFrame.tsx`.
Added (3): `misc/recordSurfaceDialogs.guard.test.ts`,
`shidduchim/ShidduchCreate.test.tsx`, `shidduchim/ShidduchimList.test.tsx`.
No file in `entity360/` is created or edited — every `entity360/` module this story uses
(`entityPaths.ts`, the registry) is another story's deliverable, consumed unmodified.
Every file stays well under the 200–400 line typical ceiling
[Source: .claude/rules/coding-style.md]. English only in all new files and comments.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:111,127] — UX-DR3 stated, and mapped to
  Epic 3 in the FR coverage map; the mapping that left this story's two surfaces unowned
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:161-165]
  — UX-DR2's route convention (`/{entity}/new`) and UX-DR3's exact wording, including the
  word *"primary"* that AC 4's ruling turns on
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187]
  — UX-DR11, the 375px / light+dark check in Task 3
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]
  — AD-24: *"records live at URLs, not in modals"*, and the `/{entity}/new` route shape
- [Source: _bmad-output/implementation-artifacts/3-2-url-backed-tabs.md] — the `/create` →
  `/new` rename and `entityPaths.ts`, both consumed by this story and neither re-done in it
- [Source: _bmad-output/implementation-artifacts/3-9-recordlink-primitive.md] — the
  `shidduchim` descriptor registration that makes `buildListPath("shidduchim")` resolve
- [Source: _bmad-output/implementation-artifacts/5-1-shidduch-360-as-a-page.md:61-64,105-112]
  — 5.1 owns `ShidduchShow.tsx` and the `matchShow` wiring; this story must not touch either
- [Source: src/components/atomic-crm/shidduchim/ShidduchCreate.tsx:26-35,43-49,62,84,96-139]
  — the CTA duplicate, the `open` prop, the two redirects and the dialog chrome this story
  removes
- [Source: src/components/atomic-crm/shidduchim/ShidduchimList.tsx:42-57,78,92] — the `<List>`
  return the early return goes above, the `matchPath` **3.12** renames, and the dialog mount point
- [Source: src/components/atomic-crm/singles/SingleCreate.tsx:8-19] — the in-repo page-shaped
  create surface this story mirrors, and one of `FormPageFrame`'s two existing callers
- [Source: src/components/atomic-crm/singles/SingleFormFrame.tsx:25-27] — the hardcoded
  eyebrow that becomes a prop
- [Source: src/components/atomic-crm/layout/FormToolbar.tsx:13-23] — the shared toolbar that
  gains `saveLabel`
- [Source: src/components/atomic-crm/login/primaryCtaClassName.ts] — `PRIMARY_CTA_CLASSNAME`,
  which `ShidduchCreate`'s local constant duplicates
- [Source: src/components/atomic-crm/tasks/Task.tsx:183-191] — the `useIsMobile()` branch that
  makes the two task editors responsive presentations rather than duplicates
- [Source: src/components/atomic-crm/misc/EditSheet.tsx:130-132] — `side="bottom" h-dvh`, why
  the mobile sheet is not usable as the desktop editor
- [Source: src/components/atomic-crm/tasks/TaskEdit.tsx:32] — the dialog AC 4 exempts
- [Source: supabase/schemas/01_tables.sql:44-47] — `tasks.target_type` and its check
  constraint: a task is a dependent row, not a subject
- [Source: src/components/atomic-crm/root/routeManifest.ts:98] — `tasks` registered
  `list`-only, with no `show`/`edit` route today
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20,44-52,79-86]
  — the `?raw` scan, the self-exclusion filter, and the sanity-check `it` AC 5 copies
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:2-3,60-72] — the
  browser-mode render + `TestMemoryRouter` + `locationCallback` pattern for all new tests
- [Source: src/components/admin/cancel-button.tsx:31-36] — `navigate(-1)`, what replaces the
  dialog's close affordance
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/english-only.md, .claude/rules/web-patterns.md#URL-as-state]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (`claude-sonnet-5`), via the `bmad-dev-story` skill.

### Debug Log References

**Task 1, bullet 1 — `grep -rn "shidduchim/create" src/` was not literally zero.** One hit:

```
src/components/atomic-crm/entity360/routeConvention.routes.test.tsx:149:  it("redirects /shidduchim/create?state=contacted to /shidduchim/new?state=contacted, query intact", async () => {
```

Judged not a stop condition: this is 3.12's own test *for* the `/create` → `/new`
compatibility redirect (the test's whole point is to mount `/shidduchim/create` and assert it
redirects to `/shidduchim/new`), not a live call site still pointing at `/create`. All five
sibling call sites (`dashboard/Dashboard.tsx`, `dashboard/MobileDashboard.tsx`,
`layout/MobileNavigation.tsx`, `shidduchim/ShidduchColumn.tsx`) were independently confirmed to
already call `buildNewPath("shidduchim")`, and `ShidduchimList.tsx:79` (pre-change) already read
`matchPath(buildNewPath("shidduchim"), …)`, not a hand-written `/create` literal. Proceeded.

**Red proof #1 (AC 5) — guard run against unmodified `ShidduchCreate.tsx`** (before Task 3):

```
FAIL  |app (chromium)| src/components/atomic-crm/misc/recordSurfaceDialogs.guard.test.ts > dialog-wrapped record surfaces stay pinned (UX-DR3) > keeps the dialog-wrapped file set a subset of the recorded exemptions
AssertionError: Unexpected dialog-wrapped record surface(s): ../shidduchim/ShidduchCreate.tsx. ...
- Expected
+ Received

- []
+ [
+   "../shidduchim/ShidduchCreate.tsx",
+ ]
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

The sanity-check `it` (scan finds `TaskEdit.tsx`) passed even in this red run, confirming the
scan mechanics work and only the subset assertion is red.

**Red proof #2 (AC 5) — guard run with a throwaway `singles/__dialogGuardFixture.tsx`**
(after Task 3/5 landed, guard already green for the real tree):

```
FAIL  |app (chromium)| src/components/atomic-crm/misc/recordSurfaceDialogs.guard.test.ts > dialog-wrapped record surfaces stay pinned (UX-DR3) > keeps the dialog-wrapped file set a subset of the recorded exemptions
AssertionError: Unexpected dialog-wrapped record surface(s): ../singles/__dialogGuardFixture.tsx. ...
- Expected
+ Received

- []
+ [
+   "../singles/__dialogGuardFixture.tsx",
+ ]
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

Fixture deleted immediately after; re-run confirmed green (`2 passed`).

**Locator semantics correction during Task 4.** `vitest-browser-react`'s `screen.getByText`
resolves through Playwright-style locators (default substring, "strict mode" — errors on
multiple matches), not `@testing-library/dom`'s exact-leaf-text matching. The first draft of
`ShidduchCreate.test.tsx` used `screen.getByText("Add a suggestion")` /
`screen.getByText("Look-into")` / `screen.getByText("New")` and failed with "strict mode
violation" (matched the `<h1>` heading *and* the submit button; matched the visible Select
trigger *and* Radix's hidden native `<option>` fallback, and — for "New" — the helper-text
prose too). Fixed by scoping: `getByRole("heading", { name: … })` for the heading, and
`screen.getByLabelText("Starting column").getByText(…)` for the Select's displayed value —
the exact chain Playwright's own error message suggested. No other test file in this story set
needed this fix; both new files were run to green before being counted done.

### Completion Notes List

- `shidduchim/ShidduchCreate.tsx` converted to a page (AC 1): no `Dialog` import, no `open`
  prop, `handleClose` removed. `ShidduchimList.tsx` early-returns
  `<ShidduchCreate singleId={…}/>` above `<List>` when `matchPath(buildNewPath("shidduchim"), …)`
  matches; `ShidduchimLayout` no longer mounts `ShidduchCreate` at all.
- Create behaviour preserved exactly (AC 2): `?state=` handling, `redt_date` default, and the
  `dataProvider.createShidduch(input)` call with `origin: "manual"` are byte-identical to the
  prior dialog version. Only the redirect target changed:
  `redirect(buildListPath("shidduchim"))` in place of the literal `"/shidduchim"`.
- `misc/FormPageFrame.tsx` (moved from `singles/SingleFormFrame.tsx`) takes a required
  `eyebrow: string` prop; `SingleCreate`/`SingleEdit` pass `eyebrow="Family roster"` (byte-
  identical render to before), `ShidduchCreate` passes `eyebrow="Pipeline"`.
  `layout/FormToolbar.tsx` gained an optional `saveLabel?: string`, forwarded to `SaveButton`'s
  `label` (undefined preserves `SaveButton`'s own default, so `SingleCreate`/`SingleEdit` are
  unaffected). `ShidduchCreate`'s local `PRIMARY_CTA_CLASS` constant is deleted; grep confirms
  zero hits for both `SingleFormFrame` and `PRIMARY_CTA_CLASS\b` in `shidduchim/` (AC 3).
- `tasks/TaskEdit.tsx` gained a doc comment recording the UX-DR3 exemption, its four grounds,
  the `TaskEditSheet` relationship, and the exact reopening trigger (AC 4). Comment-only change
  — `git diff --stat src/components/atomic-crm/tasks/` shows one file, 26 insertions, 0
  deletions.
- `misc/recordSurfaceDialogs.guard.test.ts` added (AC 5): scans `shidduchim/`, `singles/`,
  `shadchanim/`, `references/`, `tasks/` for `@/components/ui/dialog` imports and asserts the
  basename set is a subset of `{ShidduchShow.tsx, ShidduchShowHeader.tsx,
  ReferenceMergeButton.tsx, TaskEdit.tsx}`, plus a sanity-check `it` proving the scan finds
  `TaskEdit.tsx`. Both required red proofs captured (see Debug Log) before the final green run.
- No file under `entity360/` was created or edited, matching the story's stated scope.
- Two pre-existing, out-of-scope comment inaccuracies were found but deliberately left alone
  (see "Deviations / issues found" below), since the story's Project Structure Notes name
  exactly six changed files, one move, and three additions — not these two.
- All Definition-of-Done gates run and green: `npm run typecheck`, `npm run lint`,
  `npx vitest run` (full — 109 files / 1077 tests, all projects), `npm run build`,
  `npx prettier --check .` (15 pre-existing warnings, all in files this story never touched:
  `.github/workflows/*`, `.lintstagedrc`, `doc/**/*.mdx`). No SQL touched, so `test:unit:db` and
  `supabase db diff` were not run (story adds no database object, per its own scope statement).

**Deviations / issues found (not fixed, per instructions to report rather than deviate
silently):**

1. `shidduchim/index.ts`'s comment ("No `New` here: the create surface is a modal matched
   inside `ShidduchimList`…") is now stale — after this story it is a page. Left untouched:
   the story's Project Structure Notes name exactly six changed files and this is not one of
   them, and the comment's factual claim about *where* the create surface is mounted
   (`ShidduchimList.tsx`) is still correct even though "modal" no longer is.
2. `entity360/routeConvention.routes.test.tsx`'s comment on its `shidduchimWithFixtureList`
   fixture (`:141-142`, "the create surface is a modal matched INSIDE `ShidduchimList`") has
   the same staleness. Also left untouched — the story's Dev Notes explicitly say no file
   under `entity360/` is edited by this story, and the test itself still passes unmodified
   (it substitutes a fixture `list` component, so it never renders the real
   `ShidduchimList`/`ShidduchCreate` pair this story changed).
3. The Task 1 gate's literal `grep -rn "shidduchim/create" src/` wording assumes zero hits;
   one hit exists (a 3.12 redirect-test description string). Judged benign — see Debug Log.
   Flagging in case a future reader takes the story's "zero hits" claim as a strict CI
   assertion rather than a one-time manual gate check.

No contract deviation: the Epic 3 API contract (§4, §5, §10) was conformed to exactly —
`buildListPath` used for the redirect, no path built by template literal, no file under
`entity360/` touched.

### Review Fixes (adversarial review pass, commit `49137c3`/`82c06c1` reviewed)

**Fixed:**

- **Must-fix — AC 1's negative assertion was unfalsifiable.**
  `shidduchim/ShidduchimList.test.tsx` mounted a bare `<ShidduchimList />` with no
  `ResourceContextProvider`, so `<List>` threw (`useListController requires a non-empty
  resource prop or context`) and the throw was swallowed by React Router's default
  `ErrorBoundary` — the board heading could never mount in that harness regardless of the code
  under test, so `.not.toBeInTheDocument()` passed for a reason unrelated to AC 1. Rewrote the
  test to mount the real `shidduchim` resource definition (`<Resource name="shidduchim"
  {...shidduchim} />`, its lazy `list` under a `<Suspense>`) inside a `shidduchim/*` route,
  mirroring `entity360/routeConvention.routes.test.tsx`'s established pattern, and added a
  second `it` mounting the same harness at `/shidduchim` asserting the board heading **does**
  render there — proof the negative assertion in the first test is actually discriminating.
  The auth provider mock needed `checkAuth`/`checkError`/`logout` added (the bare-component
  harness never exercised `ra-core`'s route-level auth check; the real `<Resource>` tree does).
- **Should-fix — four stale "the create surface is a modal" claims left after AC 1 shipped
  a page.** Two were already named in this story's own deviation list
  (`shidduchim/index.ts`'s doc comment, `routeConvention.routes.test.tsx:141-142`'s comment)
  and left untouched as out-of-scope; the review found two more the deviation list missed:
  `entity360/routeConvention.tsx`'s `buildCreateRoutes` doc comment (framework source every
  future entity's `index.ts` author reads, not test prose), and
  `routeConvention.routes.test.tsx`'s `it` title plus its `:172-176` comment ("decide whether
  `ShidduchCreate`'s dialog is open"). Fixed all four for consistency — leaving two corrected
  and two stale would be worse than either extreme, and all four assert the literal opposite
  of what this story shipped, in files 3.11's conformance validator and every Epic 5 story
  will read.

**Not fixed (agree with the review's own classification as informational):**

- **Informational — "5.1's edit is one line" (Dev Notes) is optimistic**, because
  `singleId` is not part of contract §5's propless `New` slot and 5.1 will need to carry the
  preselected single through the query string or context. No code changes result from this
  story either way — it is a forward-looking note for 5.1's author, not a defect in what 3.13
  shipped. Left as recorded.
- **Informational — two CI guards (`check-suppressions.mjs`, `check-retired-names.mjs`) are
  red on `main`.** Re-verified: both guards fail with the exact same output the review
  recorded, and every offending file (`entity360/RecordLink.test.tsx` and the 13
  `@ts-expect-error` comments) is byte-identical to the pre-3.13 baseline `d8dc26a`. Pre-existing
  on an earlier Epic 3 story, not this one's regression, and outside this story's declared DoD
  gate list. No action taken.

**Toolchain re-verified after fixes:** `npm run typecheck` clean, `npm run lint`
(`--max-warnings=0`) clean, `npx vitest run` → **109 files / 1078 tests passed** (+1 test over
the reviewed 1077 — the new discriminating `it`), `npm run build` clean (pre-existing >500 kB
chunk warning only), `npx prettier --check .` → the same 15 pre-existing warnings, none in a
file this story or its fix touched, `make registry-gen` → `registry.json` unchanged. No SQL
touched, so `npm run test:unit:db` / `supabase db diff --local` were not run.

### File List

Changed:
- `src/components/atomic-crm/shidduchim/ShidduchCreate.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.tsx`
- `src/components/atomic-crm/singles/SingleCreate.tsx`
- `src/components/atomic-crm/singles/SingleEdit.tsx`
- `src/components/atomic-crm/layout/FormToolbar.tsx`
- `src/components/atomic-crm/tasks/TaskEdit.tsx`

Moved:
- `src/components/atomic-crm/singles/SingleFormFrame.tsx` → `src/components/atomic-crm/misc/FormPageFrame.tsx`

Added:
- `src/components/atomic-crm/misc/recordSurfaceDialogs.guard.test.ts`
- `src/components/atomic-crm/shidduchim/ShidduchCreate.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchimList.test.tsx`

Changed (review fix pass):
- `src/components/atomic-crm/shidduchim/ShidduchimList.test.tsx` — rewritten to mount the real
  `shidduchim` resource; added the discriminating `/shidduchim` counter-test (finding #1)
- `src/components/atomic-crm/entity360/routeConvention.tsx` — stale "modal" doc comment
  corrected (finding #2)
- `src/components/atomic-crm/shidduchim/index.ts` — stale "modal" doc comment corrected
  (finding #2)
- `src/components/atomic-crm/entity360/routeConvention.routes.test.tsx` — stale "modal"
  comment and `it` title corrected (finding #2)

### Change Log

- Story 3.13 implemented: `ShidduchCreate` converted from a routed `<Dialog>` to the page at
  `/shidduchim/new`; `SingleFormFrame` generalized to `misc/FormPageFrame` (required `eyebrow`
  prop) and shared by `SingleCreate`/`SingleEdit`/`ShidduchCreate`; `FormToolbar` gained
  `saveLabel?`; `tasks/TaskEdit.tsx` documented as a named, reopening-triggered UX-DR3
  exemption; `misc/recordSurfaceDialogs.guard.test.ts` added to pin the remaining
  dialog-wrapped record surfaces, proven red twice before green.
- Review fix: `ShidduchimList.test.tsx` rewritten to mount the real `shidduchim` resource
  (fixing an unfalsifiable negative assertion) plus a discriminating counter-test; four stale
  "create surface is a modal" doc comments corrected across `entity360/routeConvention.tsx`,
  `shidduchim/index.ts`, and `entity360/routeConvention.routes.test.tsx`.
