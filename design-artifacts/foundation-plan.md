# MyShadchan Foundation Plan — App Shell, Legacy Removal, Per-Child Dashboard

Scope: **foundation only**. (a) desktop left **Sidebar** replacing the top
`Header`, (b) a slim **top app-bar** (child-switcher placeholder + theme toggle +
refresh + user menu), (c) updated **mobile bottom-nav**, (d) **remove
contacts/companies/deals/tags** from the nav and `<Resource>` registration while
keeping `typecheck` green, (e) a **magical per-child Dashboard** driven by the
seeded data. **Out of scope:** entity List/Show/Create/Edit screens (later stage).

Build everything from `design-artifacts/design-language.md` ("Quiet Luminance"),
which is the concrete expansion of the authoritative `DESIGN-DIRECTION.md`.
Validation gate for the whole stage: `make typecheck` **and** `make test` pass.
Do not commit.

---

## 0. Token groundwork (do first)

**File:** `src/index.css`

Append the additive token layer from design-language.md §1 (violet + gradient
pair, `--glow-*`, `--glass-*`, `--wash`, motion tokens) under `:root` and
`.dark`, expose `--color-violet*` in `@theme inline`, and add the `ql-rise`
keyframe + `.ql-enter` + `prefers-reduced-motion` guard (§4.3). **Additive only —
do not change existing Calm Ledger values.**

**Acceptance:** app still builds; existing screens visually unchanged; new
utilities (`bg-[--glass-bg]`, `text-violet`, `.ql-enter`) resolve.

---

## 1. Desktop shell — Sidebar + slim Top app-bar (replaces `Header`)

### Files to CREATE
- `src/components/atomic-crm/layout/Sidebar.tsx` — the desktop left sidebar.
- `src/components/atomic-crm/layout/TopBar.tsx` — the slim top app-bar.
- `src/components/atomic-crm/layout/navItems.ts` — single source of truth for the
  nav item list (shared by Sidebar and mobile bottom-nav so labels/paths/icons
  never drift). Shape:
  ```ts
  export interface NavItem {
    to: string;
    labelKey: string;      // i18n key
    labelDefault: string;  // English fallback
    icon: LucideIcon;
  }
  export const PRIMARY_NAV: NavItem[]; // Dashboard, Pipeline, Shadchanim, References, Reminders, Settings
  ```

### Files to MODIFY
- `src/components/atomic-crm/layout/Layout.tsx` — replace `<Header />` + centered
  `<main>` with a flex shell: `Sidebar` (fixed, inline-start) + a column holding
  `TopBar` and the scrollable `<main>` (offset by the sidebar width via
  `ms-[var(--sidebar-w)]` or a CSS grid `[grid-template-columns:auto_1fr]`).
  Keep `useConfigurationLoader()`, `ErrorBoundary`, `Suspense`, `Notification`.
- `src/components/atomic-crm/layout/Header.tsx` — **delete** (its menu sub-items
  ProfileMenu/UsersMenu/SettingsMenu/ImportFromJsonMenuItem/ChangelogMenuItem move
  into `TopBar`'s user menu; reuse them by moving, not duplicating).

### Sidebar spec
- Fixed, inline-start, ~264px, full height, **glass chrome** (design-language
  §1.2 / §5.2): `bg-[--glass-bg] backdrop-blur-[var(--glass-blur)] border-e
  border-[--glass-border]`.
- Header row: logo (existing dark/light `img` swap from `useConfigurationContext`)
  + wordmark in `font-display`.
- Items from `PRIMARY_NAV`, rendered with the §5.4 recipe: active = indigo tint +
  glow + inline-start accent bar; active detection via `matchPath`/`useMatch`
  (Dashboard `path:"/" end`, others prefix match).
- Icons (Lucide): Dashboard `LayoutDashboard`, Pipeline `KanbanSquare`,
  Shadchanim `Users`, References `BookUser`, Reminders `BellRing`, Settings
  `Settings`.
- Wrap `Reminders`/`Settings` in `CanAccess` only where a permission exists
  (Settings → `configuration`/`edit`, matching the old Header).
- Desktop only — this component is never mounted on mobile (`MobileLayout`).

### Top app-bar spec
- Slim (h-14), full width of the content column, glass, `border-b
  border-[--glass-border]`, sticky top.
- Left (inline-start): **child-switcher placeholder** — a pill button showing the
  current child name (EN + Hebrew) with a chevron; for foundation it is a
  self-contained control backed by `useGetList("children")` + local state (mirror
  the pattern already in `ShidduchimList.tsx`). No global ChildContext yet — leave
  a `// TODO: hoist to shared ChildContext` note; the Dashboard uses the same
  local pattern for now.
- Right (inline-end): `<ThemeModeToggle />`, `<RefreshButton />`, `<UserMenu>`
  with the moved Profile/Users/Settings/Import/Changelog items.

**Acceptance:**
- Desktop shows a left sidebar with exactly the 6 items in §Sidebar list; the
  horizontal top-menu is gone.
- Active item has the glow + accent bar; hover lifts; focus ring visible.
- Top bar shows child pill (placeholder) + theme + refresh + user menu.
- Sidebar/top-bar are glass; `main` content is solid (readability). RTL: sidebar
  sits inline-start and mirrors under Hebrew.
- `make typecheck` green.

---

## 2. Remove legacy resources (contacts / companies / deals / tags)

Keep the code **files** (shadchanim & references re-skin the contacts machinery
later; deleting now is out of scope and risky). Only **unregister** them from the
product surface and remove the now-unused imports so `noUnusedLocals` stays happy.

### `src/components/atomic-crm/root/CRM.tsx`
- **DesktopAdmin** — delete these `<Resource>` lines: `deals`, `contacts`,
  `companies`, `contact_notes`, `deal_notes`, `tags`. **Keep:** `shidduchim`,
  `children`, `shadchanim`, `references`, `reference_links`, `interactions`,
  `redts`, `shidduch_schools`, `tasks` (backs Reminders), `sales` (admin).
- **MobileAdmin** — delete the `contacts` and `companies` `<Resource>` blocks;
  keep `tasks` (Reminders). Keep shidduchim/children/shadchanim/references/
  reference_links/interactions.
- Remove now-unused imports: `companies`, `contacts`, `deals`, `CompanyShow`,
  `ContactListMobile`, `ContactShow`, `NoteShowPage` (verify each has no other
  use in the file after edits — `noUnusedLocals` will flag any miss).
- **Leave** the config props/defaults (`dealCategories`, `dealStages`,
  `dealPipelineStatuses`, `companySectors`) seeded into `ConfigurationContext` —
  they are inert once the resources are gone and removing them is out of scope
  (YAGNI). No typecheck impact.

### Nav
- Desktop: handled by §1 (the new `PRIMARY_NAV` simply omits them).
- Mobile: handled by §3 (rewritten bottom-nav).

### Verification (blast radius)
- After unregistering, `grep`/build to confirm no **reachable, registered**
  component still calls `useGetList("contacts"|"deals"|"companies"|"tags")` or a
  `ReferenceField reference="contacts"` at a route that is still mounted. The
  Dashboard/MobileDashboard are rewritten in §4 (they were the main callers).
  Legacy widget files (`DealsChart`, `HotContacts`, `TasksList`,
  `DashboardActivityLog`) simply become unimported — unused **files** are fine
  under `noUnusedLocals` (it flags unused *locals*, not unused modules); leave
  them in place, do not import them.

**Acceptance:** Contacts/Companies/Deals/Tags appear **nowhere** in the product
nav (desktop or mobile) and have no route; visiting `/contacts` etc. is a
not-found, not a crash. `make typecheck` green (no unused-import errors).

---

## 3. Mobile bottom-nav update

### File to MODIFY
- `src/components/atomic-crm/layout/MobileNavigation.tsx` — rewrite.

### Spec
- 5-slot glass bottom bar (design-language §5.2, `border-t`), safe-area padding
  kept. Items (from a mobile subset of `navItems.ts`):
  1. **Home** → `/` (`Home`)
  2. **Pipeline** → `/shidduchim` (`KanbanSquare`)
  3. **Add (+)** center capture button — raised, gradient primary (§5.3), scale-
     press. For foundation it opens a small menu with **"Add a suggestion"** →
     `/shidduchim/create` (a real, existing route) and disabled/"coming soon"
     rows for future capture channels. **Remove** the legacy
     Contact/Note/Task create sheets and their imports (`ContactCreateSheet`,
     `NoteCreateSheet`, `TaskCreateSheet`, contacts `useMatch`).
  4. **Shadchanim** → `/shadchanim` (`Users`)
  5. **More** → a bottom `Sheet`/`DropdownMenu` with References (`/references`),
     Reminders (`/reminders`), Settings (`/settings`), and the theme toggle
     (`MoreHorizontal`).
- Active state: token indigo + subtle glow dot; inactive `text-muted-foreground`.
- `matchPath` updated to the new routes (drop contacts/companies/deals cases).

**Acceptance:** mobile bottom-nav shows Home · Pipeline · (+) · Shadchanim · More;
no legacy items; center + reaches "Add a suggestion"; targets ≥ 44px; glass; RTL
mirrors.

---

## 4. Per-child Dashboard (the magical screen)

Replace the legacy contact/deal dashboards. Drive from **real seeded data**:
2 children (Rivky, Yaakov), 3 shadchanim, 3 references, 7 shidduchim (one per
state, all under Rivky).

### Files to CREATE
- `src/components/atomic-crm/dashboard/DashboardHeader.tsx` — greeting + child
  switcher (local `useGetList("children")` + state, same pattern as
  `ShidduchimList`; accepts `childId`/`onSelectChild`).
- `src/components/atomic-crm/dashboard/PipelineSnapshot.tsx` — the signature
  distribution bar + legend (design-language §5.6 / §4.4), fed by
  `useGetList("shidduchim", { filter: { child_id }, perPage: 200 })`, bucketed by
  `pipeline_state` using `PIPELINE_STATES` order and each state's `token`.
- `src/components/atomic-crm/dashboard/RecentSuggestions.tsx` — the N most-recent
  shidduchim for the child (sort `created_at DESC`), each a card: name EN + Hebrew,
  shadchan name, `<StateChip>`, redt date (tabular). Staggered `.ql-enter`.
- `src/components/atomic-crm/dashboard/DashboardStat.tsx` — a small reusable stat
  tile (label, big `font-display tabular-nums` number, link).
- `src/components/atomic-crm/dashboard/AttentionSection.tsx` — honey "to review"
  section; for foundation it renders the **calm empty state** ("Nothing to
  review — you're on top of it") since the catch engine is a later epic. Wired so
  a future feed drops in.
- `src/components/atomic-crm/misc/StateChip.tsx` — token-driven 7-state chip
  (design-language §5.5); reused app-wide.
- `src/components/atomic-crm/misc/EmptyState.tsx` — reusable warm empty state with
  an inline SVG illustration slot (design-language §5.7).

### Files to MODIFY
- `src/components/atomic-crm/dashboard/Dashboard.tsx` — rewrite as the desktop
  composition: `DashboardHeader` (child switcher) → responsive grid of
  `PipelineSnapshot` (hero, full width) + `RecentSuggestions` + a right rail of
  `DashboardStat` tiles (Shadchanim count, References count → links) +
  `AttentionSection`. **First-run guard rewritten**: if no children →
  `EmptyState` teaching "Add your first child" (link `/children/create`); if child
  has no suggestions → `EmptyState` "Capture your first suggestion" (link
  `/shidduchim/create`). Drop the old contacts/contact_notes/deals `useGetList`
  gating and the `DashboardStepper`/`HotContacts`/`DealsChart`/`TasksList`/
  `Welcome` imports.
- `src/components/atomic-crm/dashboard/MobileDashboard.tsx` — rewrite to the same
  sections stacked single-column inside the existing `MobileHeader`/
  `MobileContent` wrapper; reuse the same child components (they are responsive).
  Drop legacy contact/note gating.

### Dashboard sections (final)
1. **Header** — greeting + prominent **child switcher** (Rivky / Yaakov, EN+HE).
2. **Pipeline snapshot** — 7-state distribution bar + legend with tabular counts;
   the signature entrance "moment"; click-through to `/shidduchim`.
3. **Recent suggestions** — recently added shidduchim as state-chipped cards.
4. **Directory stats** — Shadchanim (3) and References (3) count tiles, linking to
   their books (the shared address book).
5. **Needs your attention** — honey section; empty-but-ready for catches/overdue.
6. **Empty / first-run** — warm teaching states for no-children and no-suggestions.

### Data notes
- All queries are per-child except the directory stats (account-wide books).
- Use `ShidduchSummary` (has `shadchan_name`, `shadchan_name_he`, `pipeline_state`,
  `created_at`) from the `shidduchim` list path — no new backend, no SQL.
- Reference count via `useGetList("references", { perPage: 1 })` `total`; shadchan
  count likewise. No new views.

**Acceptance:**
- Signed in (test@local.dev), Dashboard shows Rivky selected with a 7-segment
  distribution (each state present once) and correct counts; switching to Yaakov
  shows his empty first-run state.
- Recent suggestions list renders bilingual names + shadchan + state chip.
- Shadchanim=3 / References=3 tiles link correctly.
- Attention section shows the calm empty state.
- Entrance animation plays once, respects reduced-motion; both themes AA; RTL
  clean. `make typecheck` + `make test` green.

---

## 5. Tests (per `.claude/rules/testing.md`, AAA)

- `navItems.test.ts` — asserts `PRIMARY_NAV` contains exactly the 6 foundation
  items with correct paths, and excludes contacts/companies/deals/tags.
- `StateChip.test.tsx` — renders the correct label + token per `PipelineState`;
  gut `for_sure_not` and post-look `no` resolve to different tokens.
- `PipelineSnapshot` bucketing — a small pure helper `bucketByState(summaries)`
  extracted and unit-tested (7 buckets, order preserved, empty child → all zero).
- Keep existing `pipelineStates.test.ts` / `boardUtils.test.ts` green.

---

## 6. Risks & mitigations

1. **Hidden contacts/deals callers.** A settings/profile/sales component may still
   `useGetList("contacts")`. *Mitigation:* grep after unregistering; those screens
   are still reachable, so if any exists, either keep a minimal contacts Resource
   registration or fix the caller. Verify build + a manual click-through of
   Settings/Profile.
2. **`noUnusedLocals` cascade.** Removing resources orphans imports across CRM.tsx,
   Dashboard, MobileDashboard, MobileNavigation. *Mitigation:* run `make typecheck`
   after each file; remove each orphaned import in the same edit.
3. **No global child context yet.** Top-bar switcher and Dashboard switcher hold
   independent local state (both seeded from `useGetList("children")[0]`). Slight
   duplication is acceptable for foundation; leave the `ChildContext` TODO so a
   later epic hoists it. Do **not** build the shared context now (YAGNI).
4. **`/reminders` has no page.** The Reminders nav item would dead-link.
   *Mitigation:* add a tiny `RemindersPlaceholder` CustomRoute rendering a calm
   `EmptyState` ("Reminders are coming soon"), or point Reminders at the existing
   `tasks` list — pick the placeholder to avoid exposing raw legacy Tasks UI.
5. **Glass over dense content.** Easy to over-apply. *Mitigation:* glass strictly
   on Sidebar/TopBar/bottom-nav/sheets; Dashboard cards stay solid (§design-lang §6).
6. **File-size ceiling.** Keep each new component 100–250 lines; the Dashboard is
   a thin composition of the extracted section components (coding-style: grow file
   count, not size).
</content>
