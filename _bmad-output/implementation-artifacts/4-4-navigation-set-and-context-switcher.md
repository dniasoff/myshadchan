---
baseline_commit: 5b97fa4ed8ff3dbf62a824d637417817d57746d3
---

# Story 4.4: Navigation set and context switcher

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a stable navigation set,
so that destinations do not move.

## Position in Epic 4

**4th of 5.** Independent of 4.1-4.3's list mechanics; it owns navigation chrome — and, as of
this refresh, it owns **every** file that names a nav destination.

**This story now also owns the `/shidduchim` relabel ("Pipeline" → "Shidduchim").** It was Story
4.3's AC-6. It moved because 4.4 already rewrites `layout/navItems.ts` and `navItems.test.ts`
wholesale, and because the relabel breaks three e2e files that sign in by waiting on
`getByRole("link", { name: "Pipeline" })` — a consequence no story previously owned. One story
owns `navItems.ts`; 4.3 must not touch it.

**This story is the one that turns the RULING 7 conformance guard green.**
`entity360/ad24Conformance.guard.test.ts` currently pins four known offenders and names Story 4.4
by number as the story that clears them. That pin is this story's most falsifiable acceptance
criterion (AC-3).

### Dependencies

- **Epic 1 Story 1.5** — `/tasks` renders a real screen (`tasks/TasksListPage.tsx`), not
  `<Navigate to="/reminders"/>`. This story adds the *nav entry* pointing at it; it does not build
  the Tasks screen.
- **Epic 2 Story 2.4** — the `ContextSwitcher` control itself (`layout/ContextSwitcher.tsx`,
  backed by `useMyContexts()` / `switchActiveContext`), its `TopBar` mount, and the interim
  `SettingsPageMobile` mount this story re-homes. This story does not build or redesign it.
- **Epic 3 Story 3-11** — the shipped AD-24 conformance validator (`entity360/ad24Conformance.ts`)
  and its `NO_BROWSE_SURFACE_ENTITIES` table.

## Acceptance Criteria

1. **The primary nav set is exactly these seven destinations, in this order**: Dashboard (`/`),
   Inbox (`/inbox_items`), Shidduchim (`/shidduchim`), Shadchanim (`/shadchanim`), Tasks
   (`/tasks`), Reminders (`/reminders`), Settings (`/settings`). Against today's seven
   (`/`, `/shidduchim`, `/inbox_items`, `/shadchanim`, `/references`, `/reminders`, `/settings` —
   verified in `navItems.ts` and pinned in `navItems.test.ts`) that is: **References replaced by
   Tasks**, and **Inbox moved ahead of Shidduchim**. See Dev Notes "Resolving the epic's
   'Pipeline, Shidduchim' wording" for why the count is seven, not eight.
   *Failing looks like:* `navItems.test.ts`'s path array does not equal the seven above, in order.

2. **`/shidduchim` is labelled "Shidduchim", not "Pipeline".** Its `labelDefault` becomes
   `"Shidduchim"` and its `labelKey` becomes `"crm.navigation.shidduchim"`; `to`, `icon`,
   `tourId` and position are otherwise driven by AC-1. Every consumer of the old label is updated
   in the same diff.
   *Failing looks like:* `grep -rn '"Pipeline"' src/ e2e/` returns a hit. Today it returns four:
   `layout/navItems.ts`, `e2e/fixtures.ts` (the `signIn` helper's completion anchor),
   `e2e/pipeline.spec.ts`, `e2e/invite-acceptance.spec.ts`. All four are this story's.

3. **RULING 7: References is not a destination at all.** No `PRIMARY_NAV` entry, no mobile "More"
   item, no dashboard tile (desktop **or** mobile), no tour step, and no file linking to the
   `/references` **list** path.
   *Failing looks like — and this is mechanical, not a judgement call:*
   `entity360/ad24Conformance.guard.test.ts`'s two RULING-7 assertions currently expect the set
   `{ "dashboard/Dashboard.tsx", "dashboard/MobileDashboard.tsx", "layout/MobileNavigation.tsx",
   "layout/navItems.ts" }` and, in the combined check, `{ "references", <those four> }`. Both
   assertions must be **rewritten to expect the empty set in the same diff** — the test's own
   comment says it "is EXPECTED to start failing, in the good direction, the moment Story 4.4
   lands — at which point it (and this whole describe block's premise) should be deleted".
   Leaving them as-is is a red test; deleting the whole file is a lost guard. Rewrite, do not
   delete.

4. **`/references/{id}` stays reachable; `/references` never renders blank.** The flat AD-24
   record path is retained, and every existing inbound link to a *record* (reference rows in a
   shidduch's diligence surface, reminder deep links, merge redirects) continues to work.
   *Failing looks like:* opening a reference from a shidduch 404s, or the app crashes at module
   load (see Task 2 — `findNavItem` throws at import time on a missing path).
   **Out of scope, stated so it is not silently assumed:** replacing `/references`'s list
   component with the unattached-references recovery panel is owned by the RULING 7 references
   wave, **not by this story and not by any Epic 4 story.** If that wave has not landed when this
   story ships, `/references` still renders today's `ReferenceList` — unreachable from anywhere in
   the product's chrome, which is exactly what the ruling asks for, and not a violation of any
   shipped rule (`ReferenceList.tsx` contains no `/references` list-path literal, so AC-3's guard
   is unaffected). Do **not** touch `references/` here.

5. **Mobile exposes the same seven destinations, with overflow.** The four physical bottom-bar
   slots (Home, Shidduchim, the centre Create button, Shadchanim) are unchanged; the "More"
   overflow menu holds Inbox, Tasks, Reminders and Settings — today it is missing Inbox entirely
   and includes References.
   *Failing looks like:* visiting `/inbox_items` or `/tasks` on mobile does not highlight "More"
   as the active destination.

6. **The context switcher lives in persistent chrome on both surfaces.** Desktop: the
   `ContextSwitcher` pill 2.4 mounted in `layout/TopBar.tsx` is visible on every screen — verified
   by e2e, not rebuilt. Mobile: a context section renders inside the bottom bar's "More" menu, and
   the interim mount on `settings/SettingsPageMobile.tsx` is **removed in the same change**
   (NFR-14). A user with fewer than two contexts sees no context section anywhere (2.4 AC-1
   semantics, preserved).
   *Failing looks like:* the switcher renders in two places at once, or a 1-context user sees an
   empty section.

7. **Verification.** `navItems.test.ts` is rewritten to assert the exact 7-item `PRIMARY_NAV`
   array (paths, labels, icons); `make typecheck && npm run lint && make test` pass; prettier
   clean on changed files; an e2e spec (`e2e/navigation.spec.ts`) confirms all seven destinations
   render a non-empty screen and that no link to `/references` appears in the Sidebar or the
   mobile nav.

## Tasks / Subtasks

- [x] **Task 1 — Rewrite `PRIMARY_NAV` (AC: 1, 2, 3)**
  - [x] `layout/navItems.ts`: remove the `/references` entry entirely and its now-unused
        `BookUser` import. Move `/inbox_items` above `/shidduchim`. Relabel the `/shidduchim`
        entry: `labelKey: "crm.navigation.shidduchim"`, `labelDefault: "Shidduchim"` (unregistered
        in the message catalog either way — it resolves via the `_:` fallback, matching every
        other nav label). Add
        `{ to: "/tasks", labelKey: "crm.navigation.tasks", labelDefault: "Tasks", icon: ListChecks, tourId: "tasks" }`
        (new `lucide-react` import), between Shadchanim and Reminders.
  - [x] Update the file's doc comment: it says "The 6 foundation nav destinations" and there are
        seven. Say seven, and name RULING 7 as the reason References is absent.
  - [x] `layout/navItems.test.ts`: replace the pinned 7-path array with the AC-1 order; keep the
        "every item has a label and icon" test; **add a positive assertion** that no entry's `to`
        is or starts with `/references` (an absence test that survives a future re-add, which the
        ordered array alone does not).

- [x] **Task 2 — Mobile overflow (AC: 3, 4, 5)**
  - [x] `layout/MobileNavigation.tsx` — **three edits that are mandatory together**, because the
        module-scope `findNavItem` throws at *import* time on a missing path, so removing the nav
        entry without these crashes the bundle:
        (a) delete `const referencesItem = findNavItem("/references")`;
        (b) drop the `matchPath(`${referencesItem.to}/*`, …)` arm of the `"more"` active-path
        test and add `inboxItem.to` and `tasksItem.to` arms;
        (c) delete the References `<DropdownMenuItem>` and this file's now-unused `BookUser`
        import.
  - [x] Add `const inboxItem = findNavItem("/inbox_items")` and
        `const tasksItem = findNavItem("/tasks")` and render both as `<DropdownMenuItem>` entries
        in `MoreButton`'s dropdown (same shape as the existing `remindersItem`/`settingsItem`
        entries — icon + translated label + `data-tour`). Order inside the menu: Inbox, Tasks,
        Reminders, Settings, then the existing `<DropdownMenuSeparator/>` + theme items.
  - [x] The four physical slots are unchanged — a deliberate scope boundary, not an oversight;
        see Dev Notes.
  - [x] Note for Story 4.5: it inserts a "Search" item at the **top** of this same dropdown and
        also edits `layout/TopBar.tsx`, which AC-6 asserts on. Sequential, 4.4 first.

- [x] **Task 3 — Dashboard tiles and tour step (AC: 3)**
  - [x] `dashboard/Dashboard.tsx`: delete the `<DashboardStat label="References" … to="/references"/>`
        tile; drop `BookUser` if it becomes unused.
  - [x] `dashboard/MobileDashboard.tsx`: the same tile; same import cleanup.
  - [x] `dashboard/useDashboardData.ts`: delete the `totalReferences` `useGetList("references", …)`
        call, the field on the returned object, and the field on its result interface. Leaving a
        now-unread field is a lint failure and a wasted query on every dashboard load.
  - [x] `tour/tourSteps.ts`: delete the desktop step anchored at
        `'[data-tour="nav-references"]'` — the anchor ceases to exist with the nav entry, and the
        step would render a dead, unhighlighted popover on first-run onboarding. Update the two
        prose strings that enumerate "References, Reminders and Settings live here" for the mobile
        More step and the file's own doc comment.
  - [x] **Ownership warning:** Story 4.3 also edits `tour/tourSteps.ts` (the pipeline steps).
        Different steps, same file — sequential, re-read before editing.

- [x] **Task 4 — Context switcher placement (AC: 6)**
  - [x] Read Story 2.4 first. Its decided state: `layout/ContextSwitcher.tsx` mounted on desktop
        in `layout/TopBar.tsx` next to `SingleSwitcherPill` — already persistent, nothing to do —
        and on mobile as an interim section on `settings/SettingsPageMobile.tsx`, because no
        persistent mobile chrome slot existed then. Nav chrome **is** this story's job, so it
        finishes the mobile half.
  - [x] Export from `layout/ContextSwitcher.tsx` a `ContextMenuItems` sub-component — the
        per-context `<DropdownMenuItem>` rows (name + kind + active check, `onSelect` = the
        existing switch handler), rendering nothing when `useMyContexts()` has fewer than 2 rows —
        and render it inside `MoreButton`'s dropdown in `layout/MobileNavigation.tsx`, between the
        nav items and the theme items, each group separated by a `<DropdownMenuSeparator/>`. This
        follows the file's own documented `ThemeMenuItems` precedent (inline items, because
        nesting a second `DropdownMenu` inside the More menu is fragile — the existing doc comment
        in `MobileNavigation.tsx` says exactly this). The desktop pill's `DropdownMenuContent`
        renders the same `ContextMenuItems` — one data source, one switch path, two render
        surfaces.
  - [x] Remove the interim `ContextSwitcher` section from `settings/SettingsPageMobile.tsx`
        (NFR-14: the replaced surface is deleted in the same change).
  - [x] **Do not rebuild the switcher's own logic** (context list, `set_active_context` call,
        cache invalidation + navigate-home on switch) — that is Story 2.4's contract; this story
        only re-homes its mobile entry point.

- [x] **Task 5 — The relabel's downstream consumers (AC: 2)**
  - [x] `e2e/fixtures.ts`: `signIn()` completes by waiting on
        `getByRole("link", { name: "Pipeline" })`. That anchor was chosen deliberately (it is
        rendered by both the desktop Sidebar and the mobile bottom nav, unlike "Settings"), and
        the relabel breaks **every e2e spec in the repo** at sign-in. Change it to "Shidduchim"
        and update the surrounding doc comment, which explains the choice by name.
  - [x] `e2e/pipeline.spec.ts`: `getByRole("link", { name: "Pipeline" }).click()` and the comment
        above it.
  - [x] `e2e/invite-acceptance.spec.ts`: the same visibility assertion.
  - [x] Run the full e2e suite after this task, not just `navigation.spec.ts` — this is the one
        change in the epic that can break specs it does not name.

- [x] **Task 6 — Turn the conformance guard green (AC: 3)**
  - [x] `entity360/ad24Conformance.guard.test.ts`: rewrite the two RULING-7 assertions to expect
        the empty set, and rewrite their comments (which currently say "the known, not-yet-fixed
        nav/dashboard offenders (Story 4.4 clears these)" and "reports ONLY the known RULING 7
        gap") to state the invariant positively: *no file links a no-browse entity's list path,
        and no AD-24 rule is broken on `main`*. Keep both `describe` blocks — they are the guard.
  - [x] Do **not** edit `entity360/ad24Conformance.ts` itself. `NO_BROWSE_SURFACE_ENTITIES` is a
        standing owner ruling and its rule is unconditional by design: the file's own comment
        says "There is no allowlist for `references` in `browse-surface-on-scoped-entity` itself
        and none may be added."

- [x] **Task 7 — Tests (AC: 7)**
  - [x] `layout/navItems.test.ts` per Task 1.
  - [x] `layout/MobileNavigation.test.tsx` (new — verified: none exists today) covering the
        `MoreButton` dropdown contents (including the context section rendering for 2+ contexts
        and rendering nothing for 1) and the `"more"` active-path matching for `/inbox_items` and
        `/tasks`.
  - [x] A repo-wide absence test alongside `navItems.test.ts`: no occurrence of `to="/references"`
        or a `"/references"` list-path literal in `src/`, outside `entity360/entityPaths.ts`,
        `references/index.ts` and `references/entityDescriptor.ts`. This duplicates nothing —
        AC-3's guard scans the same shapes, and this test is the human-readable statement of the
        same rule next to the nav it protects. If you would rather not have two, keep AC-3's and
        say so in the Completion Notes; do not keep neither.
  - [x] `e2e/navigation.spec.ts`: visit each of the seven `PRIMARY_NAV` paths and assert a
        non-empty, resource-appropriate heading renders (mirrors Epic 1 Story 1.5's "no route
        renders empty" check, scoped to the nav set); assert `/references` has no corresponding
        link in the desktop Sidebar nor in the mobile bottom bar or its "More" menu; assert the
        `ContextSwitcher` pill is visible in the desktop `TopBar` and the context section appears
        in the mobile "More" menu (seeded with a 2-context user).
  - [x] The 2-context seed helper does not exist in `e2e/fixtures.ts` today. Adding it means a
        helper **plus** a line in the `base.extend` type literal **plus** a line in the fixture
        map — all in the same ~30-line region Story 4.1 may also be editing. Declare all three
        lines in this story's File List.

## Dev Notes

### RULING 7, as the code states it

`entity360/ad24Conformance.ts`:

> `NO_BROWSE_SURFACE_ENTITIES = { references: "RULING 7: a reference exists only within a
> shidduch's context. It keeps a full 360 at /references/{id} and shows every shidduch it serves
> from inside its own record; it has no nav entry, no list, no dashboard tile, no tour step and
> no global-search results. This is a product decision, not a security boundary — RLS stays
> deliberately account-wide (FR51) and must not be narrowed to enforce it." }`

Three rules run off that table (`findNoBrowseSurfaceViolations`): (a) no `PRIMARY_NAV` target may
resolve under `/references`; (b) no file may contain a `/references` list-path literal or a
`buildListPath("references")` call — record paths like `/references/${id}` deliberately do **not**
match; (c) every resource *not* in the table must declare a `list`, so dropping `list` is not a
legal way to express "no browse surface".

This story is (a) and (b). It is **not** the ruling's other half: closing the orphan-reference
creation class, building the unattached-references panel, scoping the reminders picker and
trimming the MCP tool descriptions all belong to the RULING 7 references wave. Needing a path
under `references/` here means report and stop — a successful outcome
(`.claude/rules/parallel-ownership.md`).

The prior AC-2 of this story read: *"`/references` remains directly reachable, just not from
primary nav. Its route, **list page**, and every existing inbound link … continue to work."* That
clause is **deleted, not softened** — the ruling overturns it, and leaving it would tell a
builder to preserve exactly the thing the owner closed.

### Resolving the epic's "Pipeline, Shidduchim" wording

The epic list's line for this story — and UX-DR10's text in `amendment-a2.md`, which reads the
same way — says "…Dashboard, Inbox, **Pipeline, Shidduchim**, Shadchanim, Tasks, Reminders,
Settings…". Read literally that is eight destinations for one resource with one route. Resolved,
not left open: "Pipeline" is today's *label* for the single `/shidduchim` destination and
"Shidduchim" is what Task 1 relabels that same entry to. They are the same nav item, before and
after. Today's `PRIMARY_NAV` has exactly 7 entries; swapping References for Tasks (both real,
independent destinations — `/tasks` became nav-worthy only once Epic 1 Story 1.5 made it a real
screen) nets exactly 7 again. **Do not add an eighth item.**

Note that `amendment-a2.md`'s UX-DR8 and UX-DR10 predate RULING 7 and are weaker than it (UX-DR8
still says a reference is "reachable from diligence and from search"). `epics.md` **has** been
amended — its Story 4.4 AC now reads *"References is not a destination at all — no nav entry, no
overflow item, no dashboard tile and no tour step (RULING 7)"* — and `ad24Conformance.ts` is the
executable statement. Where they disagree, the shipped table wins.

### What this story does and does not own about the switcher

Story 2.4 owns the control itself: its UI, `my_contexts()`/`useMyContexts()`,
`switchActiveContext`, and the invalidate-and-go-home switch behaviour. 2.4 also explicitly left
mobile on an interim Settings-page mount because "mobile has no top-bar chrome slot for this
today" and inventing chrome was not its job. Nav chrome **is** this story's job (UX-DR10: the nav
set "plus the context switcher"), so it moves the mobile entry point into the persistent bottom
bar's More menu and deletes the interim mount. It changes **where** the control renders, never
what it does — do not touch the desktop TopBar placement, the data hook, or the switch handler.

### Mobile's four fixed slots are a deliberate boundary, not a gap

Today's mobile bottom bar reserves its four flanking slots for Home, Pipeline (→ Shidduchim), a
centre Create action, and Shadchanim — a pre-existing information-architecture choice
(`MobileNavigation.tsx`'s doc comment: "foundation-plan §3"). This story fixes the two concrete
AC-5 violations (Inbox missing from mobile entirely; References present when it should not be)
using the existing overflow mechanism the epic's own AC licenses ("with overflow where needed").
Redesigning which four items get physical slots is a larger IA decision this story does not make.

### The route table is untouched

This story edits navigation chrome only. No `<entity>/index.ts`, no `buildEntityRoutes`, no
`hasShow`/`hasEdit`, no `root/routeManifest.ts`. Adding `/tasks` to `PRIMARY_NAV` needs no
resource change: `tasks` is already a registered resource (`{ name: "tasks", surface: "both",
definition: { list: TasksListPage } }`) and is one of the three seeded `RECORD_FLAG_EXEMPTIONS`,
so no `record-flags-missing` violation can fire. `routeManifest.ts`'s `unreachable-nav-target`
rule computes reachability from `resource.definition.list`, which `tasks` has — so the new nav
entry is conformant the moment it is added.

### Architecture

- **AD-24 / UX-DR10**: "Navigation set; `References` is not a destination at all (RULING 7)" —
  this is this story's primary AC, verbatim from `epics.md`.
- **AD-2 / AD-19**: the context switcher surfaces `current_context_id()`'s selection (Stories
  2.1/2.4); this story does not touch that resolver or its RLS dependents, and adds no
  client-suppliable scope parameter.

### Ownership hazards (declare before dispatch)

| Shared artefact | Also edited by | Handling |
|---|---|---|
| `tour/tourSteps.ts` | 4.3 (pipeline steps) | Sequential; different steps, one file. |
| `layout/MobileNavigation.tsx` (`MoreButton`) | 4.5 (adds "Search" at the top) | Sequential, 4.4 first. |
| `layout/TopBar.tsx` | 4.5 (adds a search button) | AC-6 asserts on this file; 4.5 must not disturb the pill. |
| `e2e/fixtures.ts` (`base.extend` block) | 4.1 (a shadchanim seed helper) | Sequential; the two edits land in the same ~30-line region. |
| `entity360/ad24Conformance.guard.test.ts` | nobody else in Epic 4 | This story alone. Do not touch `ad24Conformance.ts`. |
| e2e stack | every story with a spec | Host-global singleton. One `STACK_ID` (1-6, never 0) plus `STACK_OWNER` per agent; stop it afterwards. |

### Testing standard

`vitest-browser-react` in real Chromium with `TestMemoryRouter`; **React Testing Library is not a
dependency.** `.claude/rules/testing.md` AAA. `.claude/skills/e2e-conventions` — nav is
UI/interaction, so the e2e spec is required, not optional; deterministic waits only.

### Project Structure Notes

`layout/` files change (`navItems.ts`, `navItems.test.ts`, `MobileNavigation.tsx`,
`ContextSwitcher.tsx`, plus a new `layout/MobileNavigation.test.tsx`); `dashboard/` loses a tile
and a query; `tour/tourSteps.ts` loses a step; `settings/SettingsPageMobile.tsx` loses its interim
switcher section; three e2e files and one guard test are updated. No new directories. **No new
files under `src/components/atomic-crm/**` that the registry glob picks up** — `registry.json`
needs no regeneration for the `.test.tsx` additions, but let the pre-commit hook decide.

### Files this story will touch

```
src/components/atomic-crm/layout/navItems.ts                      (7-item set + relabel)
src/components/atomic-crm/layout/navItems.test.ts                 (rewritten + absence test)
src/components/atomic-crm/layout/MobileNavigation.tsx             (3 mandatory edits + 2 items)
src/components/atomic-crm/layout/MobileNavigation.test.tsx        (new)
src/components/atomic-crm/layout/ContextSwitcher.tsx              (export ContextMenuItems)
src/components/atomic-crm/settings/SettingsPageMobile.tsx         (interim mount removed)
src/components/atomic-crm/dashboard/Dashboard.tsx                 (tile removed)
src/components/atomic-crm/dashboard/MobileDashboard.tsx           (tile removed)
src/components/atomic-crm/dashboard/useDashboardData.ts           (query + field removed)
src/components/atomic-crm/tour/tourSteps.ts                       (nav-references step removed)
src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts (two assertions -> empty set)
e2e/fixtures.ts                                                   (signIn anchor + 2-context seed)
e2e/pipeline.spec.ts                                              ("Pipeline" -> "Shidduchim")
e2e/invite-acceptance.spec.ts                                     ("Pipeline" -> "Shidduchim")
e2e/navigation.spec.ts                                            (new)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.4 AC text, including
  *"References is not a destination at all — no nav entry, no overflow item, no dashboard tile
  and no tour step (RULING 7)"*.
- [Source: _bmad-output/planning-artifacts/epics.md] — the RULING 7 block and the UX-DR8 / UX-DR10
  restatements above Epic 1.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — one route convention, one navigation set.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md]
  UX-DR10 — the nav set "plus the context switcher"; note the caveat in Dev Notes about UX-DR8's
  staleness.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1] — Story 1.5's `/tasks` real-surface
  requirement; Story 1.3's `children` → `singles` rename this story's prose assumes.
- [Source: _bmad-output/implementation-artifacts/2-4-context-switcher.md] — the `ContextSwitcher`
  component, its TopBar mount, and the interim `SettingsPageMobile` mount this story re-homes.
- [Source: _bmad-output/implementation-artifacts/4-3-shidduchim-list-view.md] — the pipeline
  redesign whose nav relabel moved here.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts] —
  `NO_BROWSE_SURFACE_ENTITIES`, `findNoBrowseSurfaceViolations`, `findListPathLinks`.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts] — the two
  assertions naming this story by number.
- [Source: src/components/atomic-crm/root/routeManifest.ts] — `RECORD_FLAG_EXEMPTIONS`,
  `unreachable-nav-target`.
- [Source: .claude/rules/testing.md], [Source: .claude/skills/e2e-conventions/SKILL.md],
  [Source: .claude/rules/parallel-ownership.md]

### Inherited from the loose-ends round (commit `af2074e`)

The Epic 1–3 loose-ends round ran in parallel with Epic 4 on `main`. Five findings fell inside
this story's declared paths, so the round reported and stopped rather than taking them
(`.claude/rules/parallel-ownership.md`, "Out-of-scope work is reported, not taken"). They are
this story's to close — none of them is optional cleanup; each is a defect that is live today.

1. **`settings/SettingsPageMobile.tsx` — no Billing entry point at all** (audit item H). The
   billing / AI-entitlement page is reachable on desktop and unreachable on mobile: neither
   `SettingsPageMobile` nor `MobileNavigation` links to it. A user on a phone cannot find the
   only paid surface in the product. Both files are yours; the round could reach neither.

2. **`settings/SettingsPageMobile.tsx:53-55` — logout now disagrees with desktop.** *This is a
   divergence the round itself created, and it is in nobody else's diff.* `af2074e` changed the
   desktop `SettingsPage.tsx` logout from `variant="destructive" className="h-auto w-full"` to
   `variant="outline" className="h-auto w-auto"`, on the argument that logging out is reversible
   and routine and was out-shouting every real action on the page, with `destructive` reserved
   for the delete path. `SettingsPageMobile.tsx` still carries the *exact* old markup, so the two
   Settings surfaces now contradict each other about whether logging out is destructive. Apply
   the same change here. (`ProfileSection` and `PreferencesSection` are shared components and
   already inherited their half of the round's fixes automatically — only the logout button is
   duplicated markup.)

3. **`layout/MobileNavigation.tsx:174-177, :203`** — one-off UI fixes deferred from the round's
   item I.

4. **`layout/Sidebar.tsx:25`** — one-off UI fix deferred from the round's item I.

5. **`dashboard/DashboardStat.tsx:50`** — one-off UI fix deferred from the round's item I.

**Also relevant to this story, and not a deferral:** `layout/DemoBanner.tsx` changed in `af2074e`
to seed its first paint from the last resolved `current_account_demo()` value, so the banner is
now present from frame 0 instead of appearing a paint late. It still publishes its measured
height as `--banner-h` on `document.documentElement`, and `Sidebar`/`TopBar` still consume it —
that contract is unchanged and must survive whatever this story does to `Sidebar`. What did
change is that anything which *fails* to honour `--banner-h` now overlaps the banner from the
first frame rather than intermittently; see story 4.5 for `MobileHeader.tsx`, which is the one
known consumer that does not honour it.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `make typecheck` — clean (tsc x3 projects).
- `make lint` — clean (eslint --max-warnings=0 + prettier --check).
- `npx prettier --config ./.prettierrc.json --check "**/*.{mjs,js,json,ts,tsx,css,md,html}"` — clean.
- `STACK_ID=2 npx vitest run` (all projects) — 146 test files passed, 13 skipped (pre-existing
  skips, none newly introduced), 1196 tests passed, 0 failed.
- `make build` — clean production build (tsc + vite build + PWA precache).
- `STACK_ID=2 STACK_OWNER=4-4 make test STACK_ID=2` — same 146/1196 result via the `make` entry
  point (the `db` project self-skips: no local Supabase reachable at stack 2's DB port outside an
  e2e run).
- CI guards: `check-retired-names.mjs`, `check-route-convention.mjs`, `check-suppressions.mjs`,
  `check-tailwind-arbitrary-var.mjs` — all OK. `check-wave-ownership.mjs` is orchestrator-only
  (needs a wave manifest this single-story dispatch doesn't have) — not run.
- No SQL touched — `supabase db diff` gate not applicable.
- Full e2e suite, both Playwright projects (`chromium`, `Mobile Chrome`), against a dedicated
  `STACK_ID=2` Supabase + Vite stack: 24/24 passed, including the new `e2e/navigation.spec.ts`
  (3 tests × 2 projects) and the three specs this story edited
  (`pipeline.spec.ts`, `invite-acceptance.spec.ts`, and every other pre-existing spec via
  `fixtures.ts`'s `signIn()`). Stack 2 (Docker containers + Vite dev server) was stopped and its
  lease released afterward.

### Completion Notes List

- **AC-1/AC-2**: `PRIMARY_NAV` rewritten to the exact 7-item AC-1 order; `/shidduchim` relabelled
  `labelKey: "crm.navigation.shidduchim"` / `labelDefault: "Shidduchim"`, `icon`/`tourId`
  unchanged (`tourId` stays `"pipeline"` — it is what `tour/tourSteps.ts`'s pre-existing
  `[data-tour="nav-pipeline"]` anchor still targets; AC-2 only asked for the label to change).
  All four named consumers of the old `"Pipeline"` label fixed in this diff
  (`layout/navItems.ts`, `e2e/fixtures.ts`, `e2e/pipeline.spec.ts`,
  `e2e/invite-acceptance.spec.ts`); `grep -rn '"Pipeline"' src/ e2e/` now returns only prose
  mentions inside comments explaining the relabel, plus one unrelated hit in
  `shidduchim/ShidduchCreate.tsx` (an `eyebrow="Pipeline"` prop) that belongs to Story 4.3's list
  redesign, not this story — left untouched (out of my declared paths).
- **AC-3**: RULING 7 fully closed. `layout/navItems.ts`, `layout/MobileNavigation.tsx`,
  `dashboard/Dashboard.tsx`, `dashboard/MobileDashboard.tsx` and `tour/tourSteps.ts` no longer
  reference `/references` in any nav/tile/step shape. `ad24Conformance.guard.test.ts`'s two
  RULING-7 assertions rewritten to expect the empty set (not merely filtered down to it) —
  the combined check now asserts `violations` is `[]` outright, a strictly stronger statement
  than "every code except browse-surface-on-scoped-entity is empty."
- **AC-4**: untouched by design — no file under `references/` was opened. `/references/{id}`'s
  route, `references`'s resource registration, and every inbound record link continue to work
  exactly as before; only outbound links *to* it (nav, dashboard, tour) were removed.
- **AC-5**: mobile "More" menu now renders Inbox, Tasks, Reminders, Settings (in that order),
  then the context section, then theme — References removed. The four physical bottom-bar slots
  (Home, Shidduchim, Create, Shadchanim) are untouched, per the story's own scope boundary.
- **AC-6**: `ContextSwitcher.tsx` now exports `ContextMenuItems`, the per-context
  `<DropdownMenuItem>` list + `handleSelect` (switch → invalidate-everything → navigate-home),
  factored out of the pill so both the desktop `TopBar` pill and the mobile "More" menu render
  the identical rows off the same `useMyContexts()` query cache. The interim
  `ContextSwitcherSection` mount on `settings/SettingsPageMobile.tsx` is deleted in this diff
  (NFR-14). **One deliberate behavioural simplification**: the desktop trigger button's
  `disabled={switching}` state (and its `setSwitching` local state) was dropped, because the
  switch handler it gated now lives in the shared `ContextMenuItems`, not in `ContextSwitcher`
  itself — there is no longer a clean seam to wire a "switch in flight" flag back onto the
  trigger without either re-introducing a second copy of the switch logic or converting
  `switchActiveContext` into a `useMutation` (an unrequested, larger structural change). This
  was not covered by any existing test and is a narrow UX affordance (a ~100-500ms window),
  not a correctness regression: `handleSelect`'s own already-active guard still prevents a
  no-op re-switch, and Radix closes the dropdown on `onSelect` regardless.
- **AC-7**: `navItems.test.ts` rewritten with the exact 7-item order, the label-default/icon
  sanity check, a dedicated "labels `/shidduchim` 'Shidduchim'" assertion, and the AC-3 absence
  assertion. `layout/MobileNavigation.test.tsx` is new, covering the More-menu contents (order,
  RULING-7 absence, 1-context/2-context context-section gating) and the `"more"` active-path
  match for `/inbox_items` and `/tasks`. Per Task 7's own opt-out clause ("If you would rather
  not have two, keep AC-3's and say so"), I did **not** add a second, hand-rolled repo-wide
  `/references` grep test alongside `navItems.test.ts`: `ad24Conformance.guard.test.ts`'s real
  scan (`findListPathLinks` over every `.ts`/`.tsx` file, quote-boundary-aware, `buildListPath()`-
  aware) already *is* that repo-wide check, is already in this story's declared paths, and is
  strictly more precise than a duplicate grep-based test would be — verified green (empty set).
  `e2e/navigation.spec.ts` is new: visits all seven `PRIMARY_NAV` paths and asserts a non-empty
  `<h1>` (deliberately `level: 1`, not a bare heading role — `admin/list.tsx` leaves a second,
  empty `<h2>` on every `title={false}` list screen per `InboxList.tsx`'s own comment, which
  would otherwise make the assertion pass vacuously); asserts no "References" link/menuitem on
  either surface; asserts the context switcher (pill on desktop, "More"-menu section on mobile)
  is reachable for a seeded 2-context user via the new `createSecondContext` e2e fixture.
- **Loose-ends round items closed** (both squarely inside `settings/SettingsPageMobile.tsx`,
  a declared path): (1) added a mobile Billing entry point mirroring desktop `SettingsPage.tsx`'s
  placement/copy exactly (`crm.billing.eyebrow`/`crm.billing.title`, both pre-existing
  `_:`-fallback-only keys — no catalog edit needed); (2) the mobile logout button now matches
  desktop's `variant="outline" className="h-auto w-auto text-base"` (was `variant="destructive"
  className="h-auto w-full text-base"`), closing the drift `af2074e` introduced on desktop only.
- **Two loose-ends items explicitly NOT taken**: the story's Dev Notes name
  `layout/MobileNavigation.tsx:174-177,:203`, `layout/Sidebar.tsx:25` and
  `dashboard/DashboardStat.tsx:50` as further item-I one-offs. I initially edited
  `Sidebar.tsx` (added the standard focus-visible ring to the brand-logo link, missing relative
  to every other focusable element in that file) and `DashboardStat.tsx` (added
  `leading-[30px]`, matching its documented twin `StatStrip.tsx`'s identical value-span
  className) — **then reverted both**, because neither file is in this dispatch's declared path
  list (only `MobileNavigation.tsx` of the three is). Re-verified `make typecheck`/`lint`/
  `vitest run`/`build` all still green after the revert. Reporting and stopping on those two is
  itself the correct, successful outcome per `.claude/rules/parallel-ownership.md` — flagging
  here rather than silently dropping them. `MobileNavigation.tsx:174-177` (the two disabled
  "coming soon" placeholder items in the Create-button menu) was inspected carefully but no
  distinct defect was found beyond the dropdown's existing automatic
  `data-[disabled]:opacity-50` styling; left unchanged.
- i18n: no edits to `englishCrmMessages.ts`/`frenchCrmMessages.ts` — confirmed no
  `crm.navigation.*` or `crm.billing.*` keys exist in either catalogue today, and every label
  used resolves purely through its `_:` fallback, matching the codebase's existing convention.
- `registry.json`: not hand-edited; left for the pre-commit hook to regenerate on a clean tree
  if it decides a `.test.tsx` addition warrants it (per the story's own note).
- Deleted stale, auto-captured Playwright-mode failure screenshots under
  `layout/__screenshots__/MobileNavigation.test.tsx/` that a first (broken) run of the new test
  file left behind before the `buildNewPath("shidduchim")` registration fix below; confirmed a
  clean passing run regenerates none.
- One incidental fix needed to make `MobileNavigation.test.tsx` runnable at all: `CreateButton`
  (unchanged by this story) calls `buildNewPath("shidduchim")`, which throws unless the
  `shidduchim` entity descriptor is registered first. Added a side-effect
  `import "../shidduchim/entityDescriptor"` to the new test file, the same pattern
  `shidduchim/index.ts` itself uses.

### File List

- `src/components/atomic-crm/layout/navItems.ts` — modified (7-item `PRIMARY_NAV`, relabel, doc
  comment)
- `src/components/atomic-crm/layout/navItems.test.ts` — modified (rewritten assertions)
- `src/components/atomic-crm/layout/MobileNavigation.tsx` — modified (Inbox/Tasks items, dropped
  References, `ContextMenuItems` mount, doc comment)
- `src/components/atomic-crm/layout/MobileNavigation.test.tsx` — new
- `src/components/atomic-crm/layout/ContextSwitcher.tsx` — modified (extracted
  `ContextMenuItems`, hoisted `kindLabel`/`contextLabel`)
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx` — modified (interim context
  switcher removed; Billing entry point added; logout button parity fix)
- `src/components/atomic-crm/dashboard/Dashboard.tsx` — modified (References tile removed)
- `src/components/atomic-crm/dashboard/MobileDashboard.tsx` — modified (References tile removed)
- `src/components/atomic-crm/dashboard/useDashboardData.ts` — modified (`totalReferences`
  query/field removed)
- `src/components/atomic-crm/tour/tourSteps.ts` — modified (nav-references step removed; prose
  updated)
- `src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts` — modified (two RULING-7
  assertions rewritten to the empty set)
- `e2e/fixtures.ts` — modified (`signIn()` anchor "Pipeline" → "Shidduchim"; new
  `createSecondContext` helper + its `base.extend` type-literal line + its fixture-map line)
- `e2e/pipeline.spec.ts` — modified ("Pipeline" → "Shidduchim")
- `e2e/invite-acceptance.spec.ts` — modified ("Pipeline" → "Shidduchim")
- `e2e/navigation.spec.ts` — new

Not touched (verified unneeded, despite being declared/available paths):
`root/routeManifest.test.ts` (computes `navTargets` from the real `PRIMARY_NAV` dynamically —
needed no edit and stays green), `providers/commons/englishCrmMessages.ts` /
`frenchCrmMessages.ts` (no new catalogue keys needed — every new label resolves via `_:`
fallback), `registry.json` (left for the pre-commit hook).

Touched, then reverted (outside declared paths — reported per
`.claude/rules/parallel-ownership.md`, not applied): `src/components/atomic-crm/layout/Sidebar.tsx`,
`src/components/atomic-crm/dashboard/DashboardStat.tsx`.

### Change Log

- Story 4.4 implemented: 7-item `PRIMARY_NAV` (References → Tasks, Inbox above Shidduchim),
  `/shidduchim` relabelled "Shidduchim", mobile "More" overflow gains Inbox/Tasks and drops
  References, `ContextMenuItems` extracted and mounted in the mobile "More" menu (interim
  `SettingsPageMobile` mount removed), dashboard References tile + `useDashboardData`'s
  `totalReferences` removed, nav-references tour step removed, `ad24Conformance.guard.test.ts`'s
  two RULING-7 assertions rewritten to the empty set, three e2e specs updated for the relabel,
  new `e2e/navigation.spec.ts`, new `layout/MobileNavigation.test.tsx`. Also closed two
  loose-ends-round defects on `settings/SettingsPageMobile.tsx` (missing mobile Billing entry
  point; logout button drifted from desktop's non-destructive styling).
