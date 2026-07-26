# Story 4.4: Navigation set and context switcher

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a stable navigation set,
so that destinations do not move.

## Position in Epic 4

**4th of 5.** Independent of 4.1-4.3's list mechanics; touches only navigation chrome. Reads
the `/shidduchim` label Story 4.3 already set — **does not re-touch it**.

**Depends on Epic 1 Story 1.5** ("Remove dead routes and superseded surfaces"), whose own AC
requires "the `/tasks` redirect is removed in favour of the real Tasks surface" — by this
story's time, `/tasks` renders a real screen, not `<Navigate to="/reminders"/>`. This story
adds the *nav entry* pointing at it; it does not build the Tasks screen itself.

**Depends on Epic 2 Story 2.4** ("Context switcher") for the switcher control itself. This
story does not build or redesign that control — see Dev Notes "What this story does and does
not own about the switcher."

## Acceptance Criteria

1. **The primary nav set is exactly these seven destinations, in this order**: Dashboard
   (`/`), Inbox (`/inbox_items`), Shidduchim (`/shidduchim`), Shadchanim (`/shadchanim`), Tasks
   (`/tasks`), Reminders (`/reminders`), Settings (`/settings`). `References` is not among
   them. Against today's seven (Dashboard/Pipeline/Inbox/Shadchanim/References/Reminders/
   Settings, verified in `navItems.ts`/`navItems.test.ts`) that is: References replaced by
   Tasks, **and Inbox moved ahead of Shidduchim** (epics.md/UX-DR10 list Inbox second; today
   Pipeline sits second). Pipeline was already relabelled Shidduchim by Story 4.3. See Dev
   Notes "Resolving the epic's 'Pipeline, Shidduchim' wording" for why the final count is
   seven, not eight.

2. **`/references` remains directly reachable, just not from primary nav.** Its route, list
   page, and every existing inbound link (e.g. "Add a reference" CTAs, a shidduch's future
   Diligence tab per Story 5.10) continue to work; only its entry in `PRIMARY_NAV` — and hence
   the desktop Sidebar link and the mobile "More" menu item — is removed.

3. **Mobile exposes the same seven destinations, with overflow.** The four physical bottom-bar
   slots (Home, Shidduchim, the center Create button, Shadchanim) are unchanged from today; the
   "More" overflow menu holds Inbox, Tasks, Reminders and Settings (today it is missing Inbox
   entirely and includes References — both fixed by this story).

4. **The context switcher lives in persistent chrome on both surfaces.** Desktop: the
   `ContextSwitcher` pill Story 2.4 already mounted in `layout/TopBar.tsx` is visible on
   every screen — verified by the e2e spec, not rebuilt. Mobile: a context section renders
   inside the bottom bar's "More" menu (the epic's own "overflow where needed"), and the
   interim mount 2.4 placed on `settings/SettingsPageMobile.tsx` is **removed in the same
   change** (a replaced surface is deleted, NFR-14). A user with fewer than two contexts
   sees no context section anywhere (2.4 AC-1 semantics, preserved).

5. **Verification.** `layout/navItems.test.ts` is rewritten to assert the exact 7-item
   `PRIMARY_NAV` array (paths, labels, icons); `make typecheck && npm run lint && make test`
   pass; prettier clean on changed files; an e2e spec (`e2e/navigation.spec.ts`) confirms all
   seven destinations render a non-empty screen and that no link to `/references` appears in
   the Sidebar or the mobile nav.

## Tasks / Subtasks

- [ ] **Task 1 — Rewrite `PRIMARY_NAV` (AC: 1)**
  - [ ] `layout/navItems.ts`: remove the `/references` entry entirely (its `BookUser` icon
        import becomes unused in this file — remove it too). Move the `/inbox_items` entry
        above `/shidduchim`. Add a new entry for `/tasks`:
        `{ to: "/tasks", labelKey: "crm.navigation.tasks", labelDefault: "Tasks",
        icon: ListChecks, tourId: "tasks" }` (new `lucide-react` import, `ListChecks`), placed
        between Shadchanim and Reminders per AC-1's order. Leave the `/shidduchim` entry's
        label exactly as Story 4.3 set it ("Shidduchim") — do not edit it here.
  - [ ] `layout/navItems.test.ts`: replace the hard-coded 7-path array with the new one
        (`/`, `/inbox_items`, `/shidduchim`, `/shadchanim`, `/tasks`, `/reminders`,
        `/settings`); update the "excludes legacy resources" test's list to also assert
        `/references` is absent (it moves from "primary destination" to "explicitly excluded,"
        matching UX-DR10's letter); the "every item has a label and icon" test needs no
        content change.

- [ ] **Task 2 — Mobile overflow (AC: 3)**
  - [ ] `layout/MobileNavigation.tsx`: the module-scope `referencesItem = findNavItem(...)`
        lookup and its `MoreButton` menu entry are removed (the lookup would otherwise throw
        at module load once Task 1 lands — `findNavItem` throws on a missing path), along
        with this file's own now-unused `BookUser` import; add
        `inboxItem = findNavItem("/inbox_items")` and `tasksItem = findNavItem("/tasks")`,
        and render both as new `<DropdownMenuItem>` entries in `MoreButton`'s dropdown (same
        shape as the existing `remindersItem`/`settingsItem` entries — icon + translated
        label + `data-tour`). Order inside the menu: Inbox, Tasks, Reminders, Settings, then
        the existing `<DropdownMenuSeparator/>` + theme items.
  - [ ] The `currentPath` matcher's `"more"` branch (today: `matchPath` checks for
        `referencesItem.to`/`remindersItem.to`/`settingsItem.to`) loses the
        `referencesItem.to` check and gains `inboxItem.to` and `tasksItem.to`, so visiting
        `/inbox_items` or `/tasks` on mobile correctly highlights "More" as active, matching
        the existing pattern for Reminders/Settings.
  - [ ] The four physical slots (Home/Shidduchim/Create/Shadchanim) are unchanged — this is a
        deliberate scope boundary, not an oversight; see Dev Notes.

- [ ] **Task 3 — Context switcher placement (AC: 4)**
  - [ ] Story 2.4's decided state (read that story before starting): `layout/ContextSwitcher.tsx`
        (backed by `useMyContexts()`/`switchActiveContext`), mounted on desktop in
        `layout/TopBar.tsx` next to `SingleSwitcherPill` — already persistent, nothing to do
        there — and on mobile as an interim section on `settings/SettingsPageMobile.tsx`,
        because no persistent mobile chrome slot existed then. This story is the one that
        owns nav chrome, so it finishes the mobile half:
  - [ ] Export from `layout/ContextSwitcher.tsx` a `ContextMenuItems` sub-component — the
        per-context `<DropdownMenuItem>` rows (name + kind + active check, `onSelect` = the
        existing switch handler), rendering nothing when `useMyContexts()` has fewer than 2
        rows — and render it inside `MoreButton`'s dropdown in `layout/MobileNavigation.tsx`,
        between the nav items and the theme items, each group separated by a
        `<DropdownMenuSeparator/>`. This follows the file's own documented `ThemeMenuItems`
        precedent (inline items, because nesting a second `DropdownMenu` inside the More menu
        is fragile — the existing doc comment in `MobileNavigation.tsx` says exactly this).
        The desktop pill's `DropdownMenuContent` renders the same `ContextMenuItems` — one
        data source, one switch path, two render surfaces.
  - [ ] Remove the interim `ContextSwitcher` section from `settings/SettingsPageMobile.tsx`
        (superseded surface — NFR-14: the replaced thing is deleted in the same change).
  - [ ] **Do not rebuild the switcher's own logic** (context list, `set_active_context` call,
        cache invalidation + navigate-home on switch) — that is Story 2.4's contract; this
        story only re-homes its mobile entry point.

- [ ] **Task 4 — Tests (AC: 5)**
  - [ ] `layout/navItems.test.ts` per Task 1.
  - [ ] `layout/MobileNavigation.test.tsx` (new, if one does not already exist — verified:
        none does today) covering the `MoreButton` dropdown contents (incl. the context
        section rendering for 2+ contexts and rendering nothing for 1) and the `"more"`
        active-path matching for `/inbox_items` and `/tasks`.
  - [ ] `e2e/navigation.spec.ts`: visit each of the seven `PRIMARY_NAV` paths, assert a
        non-empty, resource-appropriate heading renders (mirrors the spirit of Epic 1 Story
        1.5's "no route renders empty" check, scoped to the nav set rather than every
        registered route); assert `/references` has no corresponding link in the desktop
        Sidebar (`nav[aria-label]` should not contain an `href`/`to` of `/references`) nor in
        the mobile bottom bar or its "More" menu; assert the `ContextSwitcher` pill is
        visible in the desktop `TopBar` and the context section appears in the mobile "More"
        menu (seeded with a 2-context user).

## Dev Notes

### Resolving the epic's "Pipeline, Shidduchim" wording

The epic list's line for this story — and UX-DR10's authoritative text in amendment-a2,
which reads the same way — says "...Dashboard, Inbox, **Pipeline, Shidduchim**,
Shadchanim, Tasks, Reminders, Settings..." — read literally, that is eight destinations for
one resource that only has one route. This is resolved, not left open: "Pipeline" is today's
label for the single `/shidduchim` destination
(`layout/navItems.ts`: `{ to: "/shidduchim", labelDefault: "Pipeline", ... }`,
confirmed present-tense in `navItems.test.ts`'s 7-item array), and "Shidduchim" is what Story
4.3 relabels that same entry to once the list view exists alongside the board. They are the
same nav item, before and after 4.3, not two items. Supporting evidence: today's `PRIMARY_NAV`
has exactly 7 entries; swapping out References for Tasks (both real, independent
destinations — Tasks did not exist as a nav-worthy destination before Epic 1 Story 1.5 made
`/tasks` a real screen) nets exactly 7 again, matching this story's AC-1 count precisely. Do
not add an eighth item.

### What this story does and does not own about the switcher

Story 2.4 owns the control itself: its UI, `my_contexts()`/`useMyContexts()`,
`switchActiveContext` and the invalidate-and-go-home switch behaviour. 2.4 also explicitly
left mobile on an interim Settings-page mount because "mobile has no top-bar chrome slot for
this today" and inventing chrome was not its job. Nav chrome **is** this story's job
(UX-DR10: the nav set "plus the context switcher"), so it moves the mobile entry point into
the persistent bottom bar's More menu and deletes the interim mount. It changes where the
control renders, never what it does — do not touch the desktop TopBar placement, the data
hook, or the switch handler.

### Mobile's four fixed slots are a deliberate boundary, not a gap

Today's mobile bottom bar reserves its four flanking slots for Home, Pipeline (→ Shidduchim),
a center Create action, and Shadchanim — a pre-existing information-architecture choice
(`layout/MobileNavigation.tsx`'s doc comment: "foundation-plan §3"). This story fixes the two
concrete AC-3 violations (Inbox missing from mobile entirely; References present when it
should not be) by using the existing overflow ("More") mechanism the epic's own AC text
licenses ("with overflow where needed"). Redesigning which four items get physical slots is a
larger IA decision this story does not make.

### Architecture

- **AD-24 / UX-DR10**: "Navigation set; References is not a primary destination" — this is
  this story's primary AC, verbatim.
- **AD-2 / AD-19**: the context switcher surfaces `current_context_id()`'s selection
  (Story 2.1/2.4); this story does not touch that resolver or its RLS dependents.

### Testing standard

`.claude/rules/testing.md` AAA. `.claude/skills/e2e-conventions` — nav is UI/interaction, so
the e2e spec is required, not optional.

### Project Structure Notes

`layout/` files change (`navItems.ts`, `MobileNavigation.tsx`, `ContextSwitcher.tsx`, plus a
new `layout/MobileNavigation.test.tsx`), and `settings/SettingsPageMobile.tsx` loses its
interim switcher section. No new directories.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4] — Story 4.4 AC text.
- [Source: ARCHITECTURE-SPINE.md#AD-24]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1] — Story 1.5's `/tasks` real-surface
  requirement, Story 1.3's `children`→`singles` rename this story's prose assumes.
- [Source: _bmad-output/implementation-artifacts/2-4-context-switcher.md] — the
  `ContextSwitcher` component, its TopBar mount, and the interim SettingsPageMobile mount
  this story re-homes.
- [Source: _bmad-output/implementation-artifacts/4-3-shidduchim-list-view.md] — the
  `/shidduchim` → "Shidduchim" relabel this story reads and does not redo.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
