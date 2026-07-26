# Story 1.5: Remove dead routes and superseded surfaces

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want no route that renders nothing,
so that the app never dead-ends.

## Acceptance Criteria

1. **The `/tasks` redirect is gone and `/tasks` renders a real Tasks list on both surfaces.**
   `src/components/atomic-crm/root/CRM.tsx` contains no `Navigate` import and no
   `<Route path="/tasks" element={<Navigate .../>} />`. The `tasks` resource is registered with a
   real `list` component on **both** the desktop and the mobile admin, so `/tasks` renders the
   same Tasks list on a desktop viewport and on a mobile viewport. `grep -n "Navigate" src/components/atomic-crm/root/CRM.tsx`
   returns no hits.

2. **No registered resource renders a blank screen.**
   The five component-less `<Resource>` registrations that today render an empty content area are
   removed from the admin tree (desktop `CRM.tsx:285-289`, mobile `CRM.tsx:355-356`):
   `reference_links`, `interactions`, `redts`, `shidduch_schools`, and the component-less desktop
   `tasks`. `reference_links`, `interactions`, `redts` and `shidduch_schools` remain reachable
   through the dataProvider exactly as before (they are read only via `useGetList` /
   `dataProvider.*` — never via `reference=`), and no runtime behaviour of the reference
   timeline, the shidduch timeline, the redt history or the schools section changes.
   `grep -n "<Resource name=\"reference_links\"\|<Resource name=\"interactions\"\|<Resource name=\"redts\"\|<Resource name=\"shidduch_schools\"" src/`
   returns no hits.

3. **`/authentication-error` and `/access-denied` render a real screen.**
   Both admins pass `authenticationError` and `accessDenied` components to `<Admin>`, so neither
   path renders ra-core's `Noop` (routes at `node_modules/ra-core/src/core/CoreAdminRoutes.tsx:118`
   and `:122`; `const Noop = () => null` at `:149`) any more. Each screen renders a heading from the existing
   `ra.page.access_denied` / `ra.page.authentication_error` catalog keys plus a way back, matching
   `src/components/admin/not-found.tsx`. A unit test renders each and asserts a visible heading.

4. **The three superseded surfaces are deleted outright — no alias, no redirect, no shim.**
   `/changelog`, `/import` and `/profile` and every file, menu entry, link and translation key that
   exists only to serve them are removed in this change (full list in Dev Notes §3). Specifically:
   `grep -rn "ChangelogPage\|ImportPage\|ProfilePage\|ProfileForm\|useImportFromJson\|AboutSection\|import-sample" src/`
   returns no hits, and `grep -rn "crm\.changelog\|crm\.import\|import_data\|crm\.profile\.inbound\|crm\.profile\.mcp" src/`
   returns no hits. No redirect from `/changelog`, `/import` or `/profile` to anything survives.

5. **Every registered route is declared in one manifest, and CRM.tsx renders only from it.**
   A new `src/components/atomic-crm/root/routeManifest.ts` is the single source of truth for the
   custom routes and the resources of both surfaces. `CRM.tsx` builds `<Route>` and `<Resource>`
   elements exclusively by mapping over it; the manifest's `CustomRouteEntry` type carries a
   `Component: ComponentType` (never a `ReactElement`), so a redirect-only destination is not
   expressible. `grep -n "<Route path=\|<Resource name=" src/components/atomic-crm/root/CRM.tsx`
   returns only the lines inside the two `.map()` calls.

6. **The automated check fails when a registered route would render empty.**
   `src/components/atomic-crm/root/routeManifest.test.ts` asserts, for the desktop and the mobile
   surface independently:
   a. every custom-route entry's `Component` is a component (function or `React.lazy`) — not
      `Navigate`, not `null`, not an element;
   b. every resource entry declares at least one of `list`, `create`, `edit`, `show`;
   c. route paths are unique within a surface and no custom-route path collides with a resource
      name;
   d. every `PRIMARY_NAV[].to` (`src/components/atomic-crm/layout/navItems.ts`) resolves on **both**
      surfaces — to `/` (the dashboard), to a custom-route path, or to a resource that has a `list`;
   e. `/tasks` resolves to a resource with a `list` on both surfaces.
   Each assertion is proven to bite: temporarily re-adding `{ name: "redts", surface: "both",
   definition: {} }` makes (b) fail, and removing the mobile `tasks` list makes (d)/(e) fail.

7. **Route inventory is complete and honest.** After the change the registered paths are exactly
   those listed in Dev Notes §2 under "Keep", every one of them renders a screen, and each entry
   that is deliberately single-surface declares `surface: "desktop"` or `surface: "mobile"`
   explicitly in the manifest rather than being absent by accident.

8. **Verification.** `npm run typecheck`, `npm run lint`, `npm run prettier` and
   `npm run test:unit:app` all pass with zero new warnings, no `eslint-disable`, no `@ts-ignore`
   and no skipped test. `make registry-gen` has been run so `registry.json` no longer lists the
   deleted files. No migration is added by this story (see Dev Notes §6) and no schema file under
   `supabase/schemas/` is touched.

## Tasks / Subtasks

- [ ] **Task 1 — Build the route manifest** (AC: #5, #7)
  - [ ] Create `src/components/atomic-crm/root/routeManifest.ts` exporting
        `type Surface = "desktop" | "mobile" | "both"`,
        `interface CustomRouteEntry { path: string; Component: ComponentType; surface: Surface; chrome: "shell" | "bare" }`,
        `interface ResourceEntry { name: string; surface: Surface; definition: Omit<ResourceProps, "name"> }`,
        `CUSTOM_ROUTES`, `RESOURCES`, and the helpers
        `routesFor(surface, chrome)` / `resourcesFor(surface)`.
  - [ ] Populate it from the current registrations (Dev Notes §2), minus everything AC #1-#4 removes.
  - [ ] Rewrite `DesktopAdmin` / `MobileAdmin` in `CRM.tsx` to map over the manifest; delete the
        now-unused direct page imports and the `Navigate` import from `react-router`.

- [ ] **Task 2 — Kill the `/tasks` redirect and give `/tasks` one responsive list** (AC: #1, #7)
  - [ ] Delete `CRM.tsx:272-278` (the comment block and the `<Route path="/tasks" element={<Navigate .../>} />`).
  - [ ] Rename `src/components/atomic-crm/tasks/MobileTasksList.tsx` to
        `src/components/atomic-crm/tasks/TasksListPage.tsx` and make it responsive with
        `useIsMobile()` — mobile keeps `<MobileHeader>` + `<MobileContent>`, desktop renders the
        same `<TasksListContent />` under a desktop heading. Follow the existing responsive-page
        pattern in `src/components/atomic-crm/misc/ChangelogPage.tsx:10-43` (copy the pattern
        before you delete that file in Task 4). Title comes from `resources.tasks.name`
        (`smart_count: 2`) — the key already exists in both catalogs.
  - [ ] Register `tasks` once in the manifest: `{ name: "tasks", surface: "both", definition: { list: TasksListPage } }`.
  - [ ] Do **not** add a create affordance — reminders own task creation (`/reminders`); this list
        is read/complete only, exactly as `MobileTasksList` is today.

- [ ] **Task 3 — Drop the component-less resources** (AC: #2)
  - [ ] Remove `reference_links`, `interactions`, `redts`, `shidduch_schools` from the admin tree
        (they do not enter the manifest).
  - [ ] Confirm nothing regressed: they have zero `reference=` usages, zero `resources.*` i18n keys
        and no consumer of `useResourceDefinition(s)` — re-verify with
        `grep -rn 'reference="reference_links"\|reference="interactions"\|reference="redts"\|reference="shidduch_schools"' src/`
        (expect no hits) before deleting.

- [ ] **Task 4 — Delete the superseded surfaces** (AC: #4)
  - [ ] `/changelog`: delete `src/components/atomic-crm/misc/ChangelogPage.tsx` and
        `src/components/atomic-crm/settings/AboutSection.tsx`; drop `<AboutSection />` and its
        import from `settings/SettingsPage.tsx` (import line 16, usage line 88) and
        `settings/SettingsPageMobile.tsx` (import line 8, usage line 42); drop `ChangelogMenuItem`
        and its import from `layout/TopBar.tsx` (import line 24, component lines 187-201, usage
        line 51).
  - [ ] `/import`: delete `misc/ImportPage.tsx`, `misc/useImportFromJson.ts`,
        `misc/import-sample.json`; drop `ImportFromJsonMenuItem` and its import from
        `layout/TopBar.tsx` (import line 25, component lines 171-185, usage line 50).
  - [ ] `/profile`: delete `settings/ProfilePage.tsx` and `settings/ProfileForm.tsx`; drop
        `ProfileMenuItem` and the `User` icon import from `layout/TopBar.tsx` (component lines
        139-153, usage line 43). The profile edit capability is unchanged — it already lives in
        `settings/ProfileSection.tsx`, rendered by both `/settings` surfaces.
  - [ ] Remove the orphaned i18n keys from **both** catalogs:
        `crm.changelog` (english line 566, french 572), `crm.header.import_data` (english 599,
        french 606 — and the now-empty `crm.header` block), `crm.import` (english 608, french 616),
        and inside `crm.profile`: `inbound.*` and `mcp.*` (already unreferenced fossil copy about
        "contacts" / MCP). Keep `crm.profile.title|updated|update_error|record_not_found|password.*|password_reset_sent|family.*|privacy.*`
        — still used by `ProfileSection`, `ChangePasswordButton`, `FamilySection`, `PrivacySection`.

- [ ] **Task 5 — Give the two framework error routes a screen** (AC: #3)
  - [ ] Add `src/components/admin/access-denied.tsx` and
        `src/components/admin/authentication-error.tsx`, modelled on
        `src/components/admin/not-found.tsx` (heading + message + back button, all strings via
        `<Translate i18nKey>`: `ra.page.access_denied` / `ra.message.access_denied` and
        `ra.page.authentication_error` / `ra.message.authentication_error` — all four already ship
        in `ra-language-english`).
  - [ ] Export both from `src/components/admin/index.ts` next to `export * from "./not-found";`.
  - [ ] Pass `accessDenied={AccessDenied}` and `authenticationError={AuthenticationError}` to
        `<Admin>` in **both** `DesktopAdmin` and `MobileAdmin`.
  - [ ] Add a small render test asserting each shows its heading.

- [ ] **Task 6 — Write the automated check** (AC: #6)
  - [ ] Create `src/components/atomic-crm/root/routeManifest.test.ts` with the assertions of AC #6
        (a-e), AAA-structured, one behaviour per `it`, names describing the behaviour
        (e.g. `"fails a resource registered with no list, create, edit or show"`).
  - [ ] It is a plain-logic test (no DOM) like `src/components/atomic-crm/layout/navItems.test.ts`
        — it runs in the existing `app` vitest project (`npm run test:unit:app`).
  - [ ] Prove each assertion bites by temporarily breaking the manifest, then revert.

- [ ] **Task 7 — Verify and tidy** (AC: #8)
  - [ ] Run every `grep` listed in AC #1, #2, #4 and #5 and confirm zero hits.
  - [ ] `npm run typecheck && npm run lint && npm run prettier && npm run test:unit:app`.
  - [ ] `make registry-gen` (removes the deleted files from `registry.json`, which currently lists
        `MobileTasksList.tsx:85`, `ProfilePage.tsx:157`, `ImportPage.tsx:453`,
        `ChangelogPage.tsx:473`).
  - [ ] Manually walk both viewports: `/`, `/shidduchim`, `/inbox_items`, `/shadchanim`,
        `/references`, `/reminders`, `/settings`, `/tasks`, `/billing`, `/share` — none blank.

## Dev Notes

### 1. What governs this story

- **AD-23** — "dead surfaces accumulating behind live ones" is one of the three things this
  decision exists to prevent; retired names and retired surfaces go, and "CI fails on a reference
  to a retired name". [Source: ARCHITECTURE-SPINE.md#AD-23]
- **NFR-14 / greenfield** — "no backwards compatibility, deprecation shims, fallbacks or aliased
  names; when something is replaced the replaced thing is deleted in the same change."
  [Source: SPEC.md#Constraints] A redirect *is* a compatibility shim: `/tasks → /reminders` is
  exactly the pattern this rule forbids, which is why AC #1 removes it rather than repointing it.
- **AD-24** — routes are uniform `/{entity}`, `/{entity}/{id}`, `/{entity}/{id}/{tab}`,
  `/{entity}/new`, `/{entity}/{id}/edit`; "records live at URLs, not in modals"; "a single sees the
  same screens as a parent — the difference is permission, never a parallel surface".
  [Source: ARCHITECTURE-SPINE.md#AD-24] **This story does not implement AD-24's route shape** —
  that is Epic 3/4/5. It only guarantees that whatever *is* registered renders.
- **Epic 1 AC** — "every registered route renders a real screen / the `/tasks` redirect is removed
  in favour of the real Tasks surface / an automated check fails if a registered route renders
  empty." [Source: epics.md#Story 1.5]
- Vocabulary: use **shidduch/shidduchim**, **single**, **shadchan**, **reference**, **member**.
  Never "contact", "company", "deal", "lead", "child".
  [Source: specs/spec-myshadchan/glossary.md#Words we deliberately do not use]

### 2. Verified route inventory (measured, not assumed)

There are **29 distinct registered paths** across the two surfaces (48 registration entries:
desktop 5 bare custom + 8 shell custom + 11 resources; mobile 5 bare custom + 5 shell custom +
8 resources; plus 6 routes ra-core registers itself on both). Mobile has no path desktop lacks.

**How a component-less `<Resource>` produces a blank screen** — `CoreAdminRoutes` registers
`<Route path={`${resource.props.name}/*`} element={resource} />`
(`node_modules/ra-core/src/core/CoreAdminRoutes.tsx:94-101`); `<Resource>` then renders a `<Routes>`
whose only children are the create/show/edit/list routes it was given
(`node_modules/ra-core/src/core/Resource.tsx:9-37`). With none given, nothing matches and nothing
renders — the app shell stays, the content area is empty, and the `*` NotFound catch-all is never
reached because the outer route already matched.

| Path | Surface | Registered at | Renders | Verdict |
|---|---|---|---|---|
| `/` | both | ra-core (`dashboard` prop) | `Dashboard` / `MobileDashboard` | **Keep** |
| `/login` | both | ra-core `CoreAdminUI.tsx:373` (`loginPage`) | `StartPage` | **Keep** |
| `/auth-callback` | both | ra-core `CoreAdminUI.tsx:381` | `AuthCallback` | **Keep** |
| `/sign-up` | both | `CRM.tsx:251,328` | `SignupPage` | **Keep** |
| `/sign-up/confirm` | both | `CRM.tsx:252-255,329-332` | `ConfirmationRequired` | **Keep** |
| `/set-password` | both | `CRM.tsx:256,333` | `SetPasswordPage` | **Keep** — *Epic 2 (2.6) deletes it with password auth* |
| `/forgot-password` | both | `CRM.tsx:257-260,334-337` | `ForgotPasswordPage` | **Keep** — *Epic 2 (2.6)* |
| `/oauth/consent` | both | `CRM.tsx:261,338` | `OAuthConsentPage` | **Keep** — *Epic 2 (2.6)* |
| `/settings` | both | `CRM.tsx:266` / `341-344` | `SettingsPage` / `SettingsPageMobile` | **Keep** |
| `/billing` | both | `CRM.tsx:267,345` | `BillingPage` | **Keep** |
| `/reminders` | both | `CRM.tsx:270,347` | `RemindersPage` | **Keep** |
| `/share` | both | `CRM.tsx:271,348` | `ShareTarget` | **Keep** |
| `/shidduchim` (+ `/create`, `/:id/show`) | both | `CRM.tsx:280,350` | `ShidduchimList` (self-routes create/show via `matchPath`, `ShidduchimList.tsx:73-74`) | **Keep** — *panel-not-page is AD-24 debt owned by Epic 5 (5.1), not this story* |
| `/children` (+ create/edit/show) | both | `CRM.tsx:281,351` | `ChildList/Create/Edit/Show` | **Keep** — *Story 1.3 renames it to `/singles`* |
| `/inbox_items` | both | `CRM.tsx:282,352` | `InboxList` | **Keep** |
| `/shadchanim` (+ create/edit/show) | both | `CRM.tsx:283,353` | `ShadchanList/...` | **Keep** |
| `/references` (+ create/edit/show) | both | `CRM.tsx:284,354` | `ReferenceList/...` | **Keep** |
| `/sales` (+ create/edit) | **desktop only** | `CRM.tsx:290` | `SalesList/Create/Edit` | **Keep** — *Story 1.2 renames it to `members`; declare `surface: "desktop"` explicitly* |
| `/tasks` | desktop | `CRM.tsx:275-278` | `<Navigate to="/reminders" replace />` | **DEAD (D1)** — the named target of this story |
| `/tasks` | mobile | `CRM.tsx:357` | `MobileTasksList` | Real, but **mobile-only** — desktop must get the same screen |
| `/tasks/*` | desktop | `CRM.tsx:289` | *nothing* (component-less resource) | **DEAD (D6)** |
| `/reference_links` | both | `CRM.tsx:285,355` | *nothing* | **DEAD (D2)** |
| `/interactions` | both | `CRM.tsx:286,356` | *nothing* | **DEAD (D3)** |
| `/redts` | desktop | `CRM.tsx:287` | *nothing* | **DEAD (D4)** |
| `/shidduch_schools` | desktop | `CRM.tsx:288` | *nothing* | **DEAD (D5)** |
| `/authentication-error` | both | ra-core `CoreAdminRoutes.tsx:118` | `Noop = () => null` (`:149`; no `authenticationError` prop passed) | **DEAD (D7)** — reachable: `CanAccess` navigates here on error (`ra-core/src/auth/CanAccess.tsx:55`), and `<CanAccess>` is used in `Sidebar.tsx:49` and `TopBar.tsx:44,47` |
| `/access-denied` | both | ra-core `CoreAdminRoutes.tsx:122` | `Noop` (`:149`) | **DEAD (D8)** — reachable via `useRequireAccess` (`ra-core/src/auth/useRequireAccess.tsx:59`) |
| `/changelog` | both | `CRM.tsx:269,346` | `ChangelogPage` | **SUPERSEDED (S1)** — see §3 |
| `/import` | **desktop only** | `CRM.tsx:268` | `ImportPage` | **SUPERSEDED (S2)** — see §3 |
| `/profile` | **desktop only** | `CRM.tsx:265` | `ProfilePage` | **SUPERSEDED (S3)** — see §3 |
| `*` | both | ra-core `CoreAdminRoutes.tsx:125` | `NotFound` (`src/components/admin/not-found.tsx`) | **Keep** — a real 404 screen |

Outside `<Admin>` entirely, in `src/App.tsx`: the `#/portal` branch (`App.tsx:37-39`) and the
unauthenticated landing gate at `/` (`App.tsx:42`). The portal is **Story 1.4's**, not this
story's — do not touch `App.tsx`'s portal branch or `src/components/atomic-crm/portal/`.

**Counted dead findings: 8 (D1-D8). Counted superseded surfaces: 3 (S1-S3).**

### 3. Why the three superseded surfaces go, and exactly what goes with each

**S1 `/changelog`.** It renders the repository `CHANGELOG.md` via `?raw`
(`ChangelogPage.tsx:7`), and that file is the **upstream Atomic CRM fork's release notes** — its
first entry is "v1.5.0 … table `contactNotes` has been renamed `contact_notes` … column
`stateAbbr` in table `companies`". Shipping the fork's changelog as a product screen is precisely
the "dead surface behind a live one" AD-23 forbids. Files: `misc/ChangelogPage.tsx` (46 L),
`settings/AboutSection.tsx` (33 L, its only in-app entry point), `TopBar.tsx` `ChangelogMenuItem`,
`CRM.tsx:269` + `:346`, i18n `crm.changelog` in both catalogs. `CHANGELOG.md` itself stays as a
repo file — only its exposure as a route goes. `misc/Markdown.tsx` and `misc/MobileBackButton.tsx`
stay: both have other consumers (`notes/Note.tsx`, `notes/NoteShowPage.tsx`, `contacts/`,
`companies/`).

**S2 `/import`.** A JSON restore for `["sales", "companies", "contacts", "notes", "tasks"]`
(`useImportFromJson.ts:689`) — four of those five entities are fossils Story 1.1 deletes, and no
SPEC capability covers JSON import (CAP-1 capture is share/email/manual-upload into the inbox;
AD-15 is *export*, not import). Files: `misc/ImportPage.tsx` (309 L),
`misc/useImportFromJson.ts` (815 L), `misc/import-sample.json` (113 L), `TopBar.tsx`
`ImportFromJsonMenuItem`, `CRM.tsx:268`, i18n `crm.import` + `crm.header.import_data` in both
catalogs. `misc/usePapaParse.tsx` is **not** part of this — it serves the contacts CSV import
(`contacts/ContactImportButton.tsx:18`), which Story 1.1 owns.

**S3 `/profile`.** A desktop-only second copy of a capability that already lives inside
`/settings` on both surfaces: `SettingsPage.tsx:57` and `SettingsPageMobile.tsx:38` both render
`<ProfileSection />`, which edits the same avatar / first name / last name / email through the
same `dataProvider.salesUpdate`. Two ways to edit one record is the "parallel surface" AD-24
forbids. Files: `settings/ProfilePage.tsx` (90 L), `settings/ProfileForm.tsx` (194 L, sole
consumer is `ProfilePage`), `TopBar.tsx` `ProfileMenuItem`, `CRM.tsx:265`.

> **Scope call, flagged.** The epic AC names only the `/tasks` redirect explicitly; "and other
> legacy routes exist" is what puts S1-S3 here, under the story titled "…and superseded
> surfaces". If the product owner wants any of the three kept, that is a correct-course on this
> story — each is its own bullet in AC #4 so it can be dropped independently without unpicking
> the rest. **Do not "keep it just in case"**: NFR-14 makes keeping it the more expensive choice.

### 4. Overlap with the other Epic 1 stories — do not double-specify

| Story | Owns these routes / surfaces | This story must **not** touch them |
|---|---|---|
| **1.1 Delete the fossil resources** | `/contacts`, `/companies`, `/deals`, `/tags` and their folders, fixtures, generators, `dataGenerator/`, `activity/ActivityLog*Contact/Company/Deal*`, `notes/`, `e2e/bulkContactTags.spec.ts`, `e2e/userAddingATask.spec.ts`, `e2e/fixtures.ts`, and the six **orphaned** dashboard widgets that reference them (`dashboard/TasksList.tsx`, `DealsChart.tsx`, `HotContacts.tsx`, `Welcome.tsx`, `DashboardActivityLog.tsx`, `DashboardStepper.tsx` — all have **0** importers today; verified). Note: none of those four resources is registered in `CRM.tsx` today, so 1.1 deletes folders, not routes. | Leave every `contacts/`, `companies/`, `deals/`, `tags/`, `notes/`, `activity/` file alone. If the typecheck complains about one of them, that is 1.1's failure, not yours — report it, do not fix it here. |
| **1.2 `sales` → `members`** | the `/sales` route, `sales/` folder, `useGetSalesName`, `canAccess.ts:21`, `TopBar` `UsersMenuItem` link `to="/sales"`, `resources.sales.*` i18n | Register `sales` in the manifest under its **current** name with `surface: "desktop"`. 1.2 renames the manifest entry. |
| **1.3 `children` → `singles`** | the `/children` route, `children/` folder, `resources.children.*`, `ChildSwitcherPill` in `TopBar.tsx:68-119`, `FamilySection` link `to="/children"` | Register `children` under its current name. 1.3 renames the manifest entry and the route. |
| **1.4 Retire the token portal** | `src/App.tsx:2,37-39`, `portal/` (10 files), `children/ChildPortalShare.tsx`, `providers/fakerest/internal/childPortal.ts`, `child_portal_tokens`, `get_child_portal()` | Do not touch `App.tsx`. The portal is not an `<Admin>` route, so it is outside this story's inventory by construction. |
| **1.6 Tidy-code baseline** | CI going green with zero suppressions | Your AC #8 is a subset — do not add suppressions to reach it. |
| **Epic 2 (2.6 passwordless)** | `/set-password`, `/forgot-password`, `/oauth/consent`, `login/GoogleSignInButton*`, `ChangePasswordButton` | Keep them registered. They render real screens; AD-11 deletes them later, not now. |
| **Epic 3/4/5** | `Entity360`, `EntityList`, AD-24 route shape, the Tasks tab (3.8) and the navigation set (4.4, which names **Tasks** a primary destination) | Do not restructure routes. Do not add `/tasks` to `PRIMARY_NAV` — 4.4 owns the nav set. |

**Files this story shares with another story — expect a merge conflict and rebase, do not
"pre-fix" the other story's part:**
`src/components/atomic-crm/root/CRM.tsx` (1.1, 1.2, 1.3),
`src/components/atomic-crm/layout/TopBar.tsx` (1.2 `UsersMenuItem`, 1.3 `ChildSwitcherPill`),
`src/components/atomic-crm/providers/commons/englishCrmMessages.ts` and
`frenchCrmMessages.ts` (1.1, 1.2, 1.3 all prune keys),
`src/components/atomic-crm/settings/SettingsPage.tsx` / `SettingsPageMobile.tsx` (1.3 via
`FamilySection`), `registry.json` (regenerated by every story).

### 5. Facts you can rely on (already verified — do not re-derive)

- `reference_links`, `interactions`, `redts`, `shidduch_schools` are **never** used as a
  `reference=` target anywhere in `src/` (checked every `reference="…"` in `atomic-crm/`), have
  **no** `resources.*` i18n keys, and nothing in the app iterates `useResourceDefinitions()` (the
  Sidebar and mobile nav both read `PRIMARY_NAV`, not the resource registry). Their only consumers
  are `useGetList` / `dataProvider.*` calls, which do not require registration:
  `references/useReferenceLinks.ts:21`, `references/ShidduchReferencesSection.tsx:26`,
  `references/ReferenceTimeline.tsx:82,166`, `shidduchim/ShidduchTimeline.tsx:47,97`,
  `shidduchim/ShidduchShow.tsx:70,79`, plus the fakerest internals.
- `TasksListContent` (`tasks/TasksListContent.tsx`) already renders on desktop today (it is what
  the orphaned `dashboard/TasksList.tsx` wraps), so reusing it for a desktop `/tasks` needs no new
  data plumbing.
- `resources.tasks.name` = `"Task |||| Tasks"` exists in both catalogs (english line 364).
- `ra.page.access_denied`, `ra.message.access_denied`, `ra.page.authentication_error`,
  `ra.message.authentication_error` all ship in `ra-language-english` (`src/index.ts:64-96`).
- The app uses a **hash router** (ra-core's default, `AdminRouter.tsx:11`) — paths in tests and
  manual walks are `#/tasks`, `#/settings`, etc. `vercel.json` rewrites everything to
  `index.html`, so there is no server-side route list to update.

### 6. Repo mechanics

- **Migrations.** This story is frontend-only. `supabase/schemas/*.sql` is the source of truth;
  the workflow when a change *does* need SQL is: edit the schema file, then
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f <name>`, then
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`, never
  `db push`. The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory — without it every
  `npx supabase` call hangs on the keyring and looks like a Docker fault. `db diff` historically
  **drops `security_invoker` on views and drops `REVOKE` statements**, so a generated migration
  always needs hand-checking before it is applied. **None of that applies here:** dropping a
  `<Resource>` registration changes no table, view, policy, grant or trigger — the four relations
  stay exactly as they are and stay reachable through PostgREST. **If you find yourself writing
  SQL for this story, stop — you are out of scope.**
- **RLS.** No RLS policy is touched, so the "every RLS-touching change needs a negative test" rule
  does not fire here. It *will* fire for 1.1-1.4. If your change somehow reaches a policy, add the
  negative test (a second account must not read the row) before you continue.
- **Registry.** `make registry-gen` runs on pre-commit and regenerates `registry.json`; run it
  after deleting files or the commit hook will produce an unrelated diff.
- **Validation commands.** `npm run typecheck` · `npm run lint` · `npm run prettier` ·
  `npm run test:unit:app` (vitest `app` project, real Chromium via Playwright).
- **LSP over grep for TypeScript symbols.** Use `findReferences` before removing
  `ProfileForm`, `AboutSection`, `useImportFromJson`, `MobileTasksList` — the counts in §3 were
  taken that way and should reproduce.

### Project Structure Notes

- New files sit where the convention puts them: the manifest and its test in
  `src/components/atomic-crm/root/` beside `CRM.tsx`; the two error screens in
  `src/components/admin/` beside `not-found.tsx` (a *mutable dependency* directory — editing it
  directly is the documented pattern, per AGENTS.md "Mutable Dependencies").
- `CRM.tsx` is 361 lines today. Extracting the registration into `routeManifest.ts` moves it
  toward the 200-400 line target rather than past the 800-line ceiling
  (`.claude/rules/coding-style.md#File organization`), so this is the "grow the file count, not
  the file" move the rule asks for.
- `TasksListPage.tsx` replaces `MobileTasksList.tsx` by rename — do not leave both. Note the
  unrelated `dashboard/TasksList.tsx` (orphaned, Story 1.1's) — the different name avoids a
  collision while both briefly exist.
- Naming: `PascalCase` components, `UPPER_SNAKE_CASE` for `CUSTOM_ROUTES` / `RESOURCES`
  (matching `PRIMARY_NAV`), `camelCase` for `routesFor` / `resourcesFor`. English only in
  committed files.
- Tests: AAA, behaviour-describing names, no shared mutable state
  (`.claude/rules/testing.md`). `routeManifest.test.ts` follows `navItems.test.ts` as its model.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth — Story 1.5]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints — greenfield engineering standard (NFR-14)]
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Words we deliberately do not use]
- [Source: src/components/atomic-crm/root/CRM.tsx:250-291 (desktop registrations), :327-358 (mobile)]
- [Source: src/components/atomic-crm/root/CRM.tsx:272-278 (the `/tasks` redirect and its comment)]
- [Source: src/components/atomic-crm/layout/navItems.ts:31-81 (`PRIMARY_NAV`, 7 destinations)]
- [Source: src/components/atomic-crm/layout/navItems.test.ts (model for the new manifest test)]
- [Source: src/components/atomic-crm/layout/Sidebar.tsx:38-55, layout/MobileNavigation.tsx:29-107 (the two nav surfaces that consume `PRIMARY_NAV`)]
- [Source: node_modules/ra-core/src/core/CoreAdminRoutes.tsx:94-125 and :149 (resource routes, `/authentication-error`, `/access-denied`, catch-all, `Noop`)]
- [Source: node_modules/ra-core/src/core/Resource.tsx:9-37 (why a component-less Resource renders nothing)]
- [Source: node_modules/ra-core/src/core/CoreAdminUI.tsx:370-403 (`/login`, `/auth-callback`)]
- [Source: node_modules/ra-core/src/auth/CanAccess.tsx:55, auth/useRequireAccess.tsx:59-65 (how the two error routes are reached)]
- [Source: src/components/admin/not-found.tsx (model for the two new error screens)]
- [Source: src/components/admin/admin.tsx:104-137 (`accessDenied` / `authenticationError` props, already plumbed through to `CoreAdminUI`)]
- [Source: src/components/atomic-crm/misc/ChangelogPage.tsx:7 + CHANGELOG.md:1-13 (the changelog is the fork's)]
- [Source: src/components/atomic-crm/misc/useImportFromJson.ts:689 (`TYPES = ["sales","companies","contacts","notes","tasks"]`)]
- [Source: src/components/atomic-crm/settings/SettingsPage.tsx:57 and SettingsPageMobile.tsx:38 (`ProfileSection` already supersedes `/profile`)]
- [Source: .claude/rules/coding-style.md#File organization, .claude/rules/testing.md, .claude/rules/english-only.md, .claude/rules/lsp-usage.md]
- [Source: AGENTS.md#Database Management, #Mutable Dependencies, #Registry (Shadcn Components)]
- [Source: memory/supabase-cli-dbus-hang.md (`DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
