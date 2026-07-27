---
baseline_commit: c053d40f13babb45221fe49e1bc816e9e55ee7af
---

# Story 1.5: Remove dead routes and superseded surfaces

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Position and dependencies

**Epic 1 order is pinned: `1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6`. This story is 3rd.**

- **Depends on 1.1 and 1.4 having landed.** 1.1 deletes `notes/`, `contacts/`, `companies/`,
  `deals/`, `tags/` and `activity/`; 1.4 deletes `portal/`. Both remove consumers this story
  relies on being gone (see AC #4 / Dev Notes §3 for `misc/Markdown.tsx`).
- **This story must land before 1.3 and 1.2.** AC #5 replaces every `<Resource>` / `<Route>` JSX
  registration in `root/CRM.tsx` with a `.map()` over a new
  `src/components/atomic-crm/root/routeManifest.ts`. After that, the JSX line numbers 1.3 and 1.2
  quote (`CRM.tsx:281,351` for `children`, `CRM.tsx:290` for `sales`) no longer exist. Both
  stories have been retargeted to edit the **manifest entry** instead: 1.3 renames
  `{ name: "children", … }` → `{ name: "singles", … }`, 1.2 renames
  `{ name: "sales", surface: "desktop", … }` → `{ name: "members", … }`. Register both under
  their **current** names here — do not pre-rename them.
- **Ownership settled — do not re-litigate:** this story owns `/changelog` and `/profile`, the
  deletion of `settings/ProfileForm.tsx` + `settings/ProfilePage.tsx` (1.2 no longer renames
  inside them), `misc/Markdown.tsx`, and the `ChangelogMenuItem` / `ProfileMenuItem` entries in
  `layout/TopBar.tsx`.
- **The `/import` surface is *not* yours — story 1.1 deletes it whole.** An earlier draft gave it
  here; that was reversed once the order was pinned. 1.1 runs first and deletes
  `misc/useImportFromJson.ts`'s three imports (`Tag` from `../types`, `colors` from
  `../tags/colors`, `contactGender` from `../contacts/contactModel`), so the surface cannot
  survive to reach you — leaving it would make `make typecheck` red across 1.4 and 1.5. By the
  time you start, `misc/ImportPage.tsx`, `misc/useImportFromJson.ts`, `misc/import-sample.json`,
  the `CRM.tsx` route + import, `ImportFromJsonMenuItem` (and its `Import` lucide icon) and the
  `crm.import` / `crm.header.import_data` keys are **already gone**. Do not re-remove them, do not
  list them, and do not expect them in your inventory.
- 1.6 is last and consumes the result; it adds no product-code deletion of its own.

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

4. **The two superseded surfaces are deleted outright — no alias, no redirect, no shim.**
   `/changelog` and `/profile` and every file, menu entry, link and translation key that
   exists only to serve them are removed in this change (full list in Dev Notes §3). This story is
   the **sole owner** of both surfaces: 1.2 no longer renames symbols inside `ProfileForm.tsx` /
   `ProfilePage.tsx`. (`/import`, the third superseded surface, is **story 1.1's** and is already
   gone when you start — see "Position and dependencies".) Specifically:
   a. **Files deleted:** `misc/ChangelogPage.tsx`, `settings/AboutSection.tsx`,
      `settings/ProfilePage.tsx`, `settings/ProfileForm.tsx`, and `misc/Markdown.tsx` (its last
      consumer dies with `ChangelogPage`; see Dev Notes §3).
   b. **`layout/TopBar.tsx`:** `ChangelogMenuItem` and `ProfileMenuItem` — component,
      `<UserMenu>` usage and the now-unused imports (`ChangelogPage`, the `User` icon) — are gone.
      `ImportFromJsonMenuItem` was already removed by 1.1; if it is still present, that is 1.1's
      failure — report it, do not fix it here.
   c. **Verification greps, all returning no hits:**
      `grep -rn "ChangelogPage\|ProfilePage\|ProfileForm\|AboutSection\|Markdown" src/`
      and
      `grep -rn "crm\.changelog\|crm\.profile\.inbound\|crm\.profile\.mcp" src/`
      and, over both catalogs,
      `grep -n "^    changelog:\|^      inbound: {\|^      mcp: {" src/components/atomic-crm/providers/commons/englishCrmMessages.ts src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
      (6 hits when you start — 3 per catalog; zero after. On `main` today the same grep, widened
      with the two `/import` keys, returns 10 — 1.1 takes 4 of those.)
   d. No redirect from `/changelog` or `/profile` to anything survives, and no `<Route>` or
      manifest entry references either path.

5. **Every registered route is declared in one manifest, and CRM.tsx renders only from it.**
   A new `src/components/atomic-crm/root/routeManifest.ts` is the single source of truth for the
   custom routes and the resources of both surfaces. `CRM.tsx` builds `<Route>` and `<Resource>`
   elements exclusively by mapping over it; the manifest's `CustomRouteEntry` type carries a
   `Component: ComponentType` (never a `ReactElement`), so a redirect-only destination is not
   expressible. `grep -n "<Route path=\|<Resource name=" src/components/atomic-crm/root/CRM.tsx`
   returns only the lines inside the two `.map()` calls.

6. **The automated check fails when a registered route would render empty — and that is proven by
   a test, not by a transcript.**
   `routeManifest.ts` exports a pure validator
   `findManifestViolations(customRoutes, resources, navTargets): ManifestViolation[]`, where
   `ManifestViolation = { code: ViolationCode; surface: "desktop" | "mobile"; detail: string }` and
   `ViolationCode` is the union of the five rules below. It evaluates the desktop and the mobile
   surface independently:
   a. `"non-component-route"` — a custom-route entry whose `Component` is not a component
      (function or `React.lazy` object): an element, `null`, `undefined`, or `Navigate`;
   b. `"empty-resource"` — a resource entry declaring none of `list`, `create`, `edit`, `show`;
   c. `"duplicate-path"` — two entries claiming the same path within a surface, including a
      custom-route path that collides with a resource name;
   d. `"unreachable-nav-target"` — a `navTargets` entry (fed `PRIMARY_NAV.map(i => i.to)` from
      `src/components/atomic-crm/layout/navItems.ts`) that resolves to neither `/` (the
      dashboard), nor a custom-route path, nor a resource that has a `list`;
   e. `"tasks-not-listable"` — `/tasks` does not resolve to a resource with a `list`.
   `src/components/atomic-crm/root/routeManifest.test.ts` asserts both directions:
   - **Positive:** `findManifestViolations(CUSTOM_ROUTES, RESOURCES, PRIMARY_NAV.map(i => i.to))`
     returns `[]`.
   - **Negative (one `it` per code, five in all):** each rule is fed a deliberately-invalid
     fixture manifest declared inside the test file — e.g. `[{ name: "redts", surface: "both",
     definition: {} }]` for (b), a mobile `RESOURCES` fixture with `tasks` stripped of its `list`
     for (d) and (e) — and the returned array is asserted to contain exactly one violation with
     that `code` and the expected `surface`. No test mutates `CUSTOM_ROUTES` / `RESOURCES`.

7. **Every manifest entry declares its surface explicitly.** `surface: Surface` is a **required,
   non-optional** field on both `CustomRouteEntry` and `ResourceEntry` — there is no default and
   no `?`. A single-surface registration (today: `sales` on desktop only) is therefore spelled
   `surface: "desktop"` and cannot arise by omission. `grep -n "surface?:" src/components/atomic-crm/root/routeManifest.ts`
   returns no hits.

8. **Verification.** `npm run typecheck`, `npm run lint` (eslint) and `npm run test:unit:app` all
   pass **repo-wide** with zero new warnings, no `eslint-disable`, no `@ts-ignore` and no skipped
   test. **Formatting is scoped to this story's own diff:**
   `npx prettier --config ./.prettierrc.json --check <every file this story creates or modifies>`
   returns clean. The repo-wide `npm run prettier` / `make lint` gate is **story 1.6's** — on
   `main` today `npm run prettier` fails on **89 files** (58 of them under `src/components/`),
   almost all outside this story's reach, so a repo-wide green cannot be an AC here.
   `make registry-gen` has been run so `registry.json` no longer lists the deleted files. No
   migration is added by this story (see Dev Notes §6) and no schema file under
   `supabase/schemas/` is touched.

## Tasks / Subtasks

- [x] **Task 1 — Build the route manifest** (AC: #5, #6, #7)
  - [x] Create `src/components/atomic-crm/root/routeManifest.ts` exporting
        `type Surface = "desktop" | "mobile" | "both"`,
        `interface CustomRouteEntry { path: string; Component: ComponentType; surface: Surface; chrome: "shell" | "bare" }`,
        `interface ResourceEntry { name: string; surface: Surface; definition: Omit<ResourceProps, "name"> }`,
        `CUSTOM_ROUTES`, `RESOURCES`, and the helpers
        `routesFor(surface, chrome)` / `resourcesFor(surface)`.
        `surface` is **required** on both entry interfaces — no `?`, no default (AC #7).
  - [x] Also export the pure validator `findManifestViolations(customRoutes, resources, navTargets)`
        and its `ManifestViolation` / `ViolationCode` types (AC #6). It takes its inputs as
        parameters — never reads `CUSTOM_ROUTES` / `RESOURCES` / `PRIMARY_NAV` from module scope —
        so the test can drive it with invalid fixtures.
  - [x] Populate `CUSTOM_ROUTES` / `RESOURCES` from the current registrations (Dev Notes §2), minus
        everything AC #1-#4 removes. Register `children` and `sales` under their **current** names
        (`sales` with `surface: "desktop"`) — 1.3 and 1.2 rename those entries after this lands.
  - [x] Rewrite `DesktopAdmin` / `MobileAdmin` in `CRM.tsx` to map over the manifest; delete the
        now-unused direct page imports and the `Navigate` import from `react-router`.

- [x] **Task 2 — Kill the `/tasks` redirect and give `/tasks` one responsive list** (AC: #1, #5)
  - [x] Delete `CRM.tsx:272-278` (the comment block and the `<Route path="/tasks" element={<Navigate .../>} />`).
  - [x] Rename `src/components/atomic-crm/tasks/MobileTasksList.tsx` to
        `src/components/atomic-crm/tasks/TasksListPage.tsx` and make it responsive with
        `useIsMobile()` — mobile keeps `<MobileHeader>` + `<MobileContent>`, desktop renders the
        same `<TasksListContent />` under a desktop heading. Follow the existing responsive-page
        pattern in `src/components/atomic-crm/misc/ChangelogPage.tsx:10-43` (copy the pattern
        before you delete that file in Task 4). Title comes from `resources.tasks.name`
        (`smart_count: 2`) — the key already exists in both catalogs.
  - [x] Register `tasks` once in the manifest: `{ name: "tasks", surface: "both", definition: { list: TasksListPage } }`.
  - [x] Do **not** add a create affordance — reminders own task creation (`/reminders`); this list
        is read/complete only, exactly as `MobileTasksList` is today.

- [x] **Task 3 — Drop the component-less resources** (AC: #2)
  - [x] Remove `reference_links`, `interactions`, `redts`, `shidduch_schools` from the admin tree
        (they do not enter the manifest).
  - [x] Confirm nothing regressed: they have zero `reference=` usages, zero `resources.*` i18n keys
        and no consumer of `useResourceDefinition(s)` — re-verify with
        `grep -rn 'reference="reference_links"\|reference="interactions"\|reference="redts"\|reference="shidduch_schools"' src/`
        (expect no hits) before deleting.

- [x] **Task 4 — Delete the superseded surfaces** (AC: #4)
  - [x] `/changelog`: delete `src/components/atomic-crm/misc/ChangelogPage.tsx` and
        `src/components/atomic-crm/settings/AboutSection.tsx`; drop `<AboutSection />` and its
        import from `settings/SettingsPage.tsx` (import line 16, usage line 88) and
        `settings/SettingsPageMobile.tsx` (import line 8, usage line 42); drop `ChangelogMenuItem`
        from `layout/TopBar.tsx` (component lines 187-201, usage line 51) plus its `ChangelogPage`
        import (line 24) and the then-unused `FileText` lucide import (line 5).
  - [x] `/import` — **nothing to do: story 1.1 deleted the whole surface** (files, route, menu
        item, `Import` icon, `crm.import` / `crm.header.import_data`, and the fixture
        `test-data/import-sample-invalid-sale.json`). Confirm with
        `grep -rn "ImportPage\|useImportFromJson\|import-sample\|crm\.import\|import_data" src/`
        → no hits, then move on. If it does return hits, that is 1.1's failure — report it, do not
        absorb it into this story.
  - [x] `/profile`: delete `settings/ProfilePage.tsx` (90 L) and `settings/ProfileForm.tsx`
        (194 L) — **this story owns both deletions**; 1.2 no longer renames `sales`-vocabulary
        symbols inside them, so do not attempt to preserve anything from them. Drop
        `ProfileMenuItem` from `layout/TopBar.tsx` (component lines 139-153, usage line 43) plus
        the then-unused `User` lucide import (line 8; keep `Users` at line 9 — `UsersMenuItem`
        stays, it is 1.2's). The profile edit capability is unchanged — it already lives in
        `settings/ProfileSection.tsx`, rendered by both `/settings` surfaces.
  - [x] After the two removals, `layout/TopBar.tsx`'s `<UserMenu>` holds exactly
        `<UsersMenuItem />` and `<SettingsMenuItem />` (both inside their `<CanAccess>` wrappers),
        and its lucide import is exactly `{ ChevronDown, Settings, Users }`. Story 1.1 already
        took `ImportFromJsonMenuItem` and the `Import` icon out of that block before you; 1.2
        later repoints `UsersMenuItem`'s `to="/sales"`. Your two removals are the last menu-item
        deletions in Epic 1.
  - [x] `misc/Markdown.tsx`: delete it. Verified consumers today are `notes/Note.tsx:24` and
        `notes/NoteShowPage.tsx:16` — both deleted by story 1.1, which lands **before** this one —
        and `misc/ChangelogPage.tsx:6`, deleted above. Zero consumers remain
        (`grep -rn "Markdown" src/` must return no hits). Deleting it also orphans two npm
        dependencies whose only importer it is: re-run
        `grep -rn "dompurify\|from \"marked\"" --include=*.ts --include=*.tsx .` (excluding
        `node_modules`) to confirm zero hits, then drop `marked`, `dompurify` and
        `@types/dompurify` from `package.json` and refresh `package-lock.json` with
        `npm install`. If that grep finds any other importer, keep the dependency and say so in
        the PR.
  - [x] Remove the orphaned i18n keys from **both** catalogs: `crm.changelog` (english line 566,
        french 572 **on `main` — expect them to have shifted up, since 1.1 removed keys above
        them; locate by name, not by line**), and inside `crm.profile`: `inbound.*` and `mcp.*`
        (already unreferenced fossil copy about
        "contacts" / MCP — verified: no `translate("crm.profile.inbound…")` or `…mcp…` call site
        exists). `crm.import` and `crm.header` are **not** yours — 1.1 removed both, including the
        `crm.header` block that `import_data` emptied. Keep
        `crm.profile.title|updated|update_error|record_not_found|password.*|password_reset_sent|family.*|privacy.*`
        — still used by `ProfileSection`, `ChangePasswordButton`, `FamilySection`, `PrivacySection`.
        `crm.profile.eyebrow` / `crm.profile.subtitle` need no removal: `ProfilePage.tsx:74` and
        `ProfileForm.tsx:98` call them through an inline `_:` default and neither key exists in
        either catalog.

- [x] **Task 5 — Give the two framework error routes a screen** (AC: #3)
  - [x] Add `src/components/admin/access-denied.tsx` and
        `src/components/admin/authentication-error.tsx`, modelled on
        `src/components/admin/not-found.tsx` (heading + message + back button, all strings via
        `<Translate i18nKey>`: `ra.page.access_denied` / `ra.message.access_denied` and
        `ra.page.authentication_error` / `ra.message.authentication_error` — all four already ship
        in `ra-language-english`).
  - [x] Export both from `src/components/admin/index.ts` next to `export * from "./not-found";`.
  - [x] Pass `accessDenied={AccessDenied}` and `authenticationError={AuthenticationError}` to
        `<Admin>` in **both** `DesktopAdmin` and `MobileAdmin`.
  - [x] Add a small render test asserting each shows its heading.

- [x] **Task 6 — Write the automated check** (AC: #6)
  - [x] Implement `findManifestViolations` in `routeManifest.ts` (Task 1) covering the five
        `ViolationCode`s of AC #6 (a-e), evaluated per surface.
  - [x] Create `src/components/atomic-crm/root/routeManifest.test.ts`, AAA-structured, one
        behaviour per `it`, names describing the behaviour
        (e.g. `"reports empty-resource for a resource registered with no list, create, edit or show"`).
  - [x] One positive test: the real manifest plus `PRIMARY_NAV.map(i => i.to)` yields `[]`.
  - [x] Five negative tests, each **Arrange**-ing its own invalid fixture manifest as a local
        `const` inside the `it` (never a mutation of `CUSTOM_ROUTES` / `RESOURCES`), **Act**-ing
        through `findManifestViolations`, and **Assert**-ing exactly one violation with the
        expected `code` and `surface`. Suggested fixtures:
        `non-component-route` → `{ path: "/x", Component: <div /> as never, surface: "both", chrome: "shell" }`;
        `empty-resource` → `{ name: "redts", surface: "both", definition: {} }`;
        `duplicate-path` → a custom route at `/tasks` alongside the `tasks` resource;
        `unreachable-nav-target` → nav target `/reminders` with the `reminders` route dropped from
        the mobile surface; `tasks-not-listable` → the mobile `tasks` resource with `list` removed.
  - [x] It is a plain-logic test (no DOM) like `src/components/atomic-crm/layout/navItems.test.ts`
        — it runs in the existing `app` vitest project (`npm run test:unit:app`). Because the
        proof is the negative tests, nothing has to be "temporarily broken and reverted" and no
        evidence lives outside the repo.

- [x] **Task 7 — Verify and tidy** (AC: #8)
  - [x] Run every `grep` listed in AC #1, #2, #4, #5 and #7 and confirm the stated result — zero
        hits for all of them except AC #5's, which must return only the lines inside the two
        `.map()` calls.
  - [x] `npm run typecheck && npm run lint && npm run test:unit:app`, then
        `npx prettier --config ./.prettierrc.json --check` over **this story's changed files
        only** (AC #8 — repo-wide `npm run prettier` is story 1.6's gate, not this one's).
  - [x] `make registry-gen` (removes the deleted files from `registry.json`. On `main` it lists
        `MobileTasksList.tsx` at line 85, `ProfilePage.tsx` at 157, `Markdown.tsx` at 445 and
        `ChangelogPage.tsx` at 473 — **4 entries are yours**; `useImportFromJson.ts` (409) and
        `ImportPage.tsx` (453) go with story 1.1, and every line number will have shifted by the
        time you run it. Also drops the `dompurify@^3.3.1` registry dependency at line 30).
  - [x] Manually walk both viewports: `/`, `/shidduchim`, `/inbox_items`, `/shadchanim`,
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

Measured on `main`: **29 distinct registered paths** across the two surfaces (48 registration
entries: desktop 5 bare custom + 8 shell custom + 11 resources; mobile 5 bare custom + 5 shell
custom + 8 resources; plus 6 routes ra-core registers itself on both). Mobile has no path desktop
lacks.

**Story 1.1 lands before you and removes one of them** — the desktop-only `/import` shell custom
route (`CRM.tsx:268`) — so your starting inventory is **28 paths / 47 entries** (desktop 7 shell
custom). The `/import` row is kept in the table below, struck through, so the delta between the
`main` measurement and your starting point is explicit rather than silent.

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
| ~~`/import`~~ | ~~desktop only~~ | ~~`CRM.tsx:268`~~ | ~~`ImportPage`~~ | **Already deleted by story 1.1** — not in your inventory, not in the manifest, nothing to do |
| `/profile` | **desktop only** | `CRM.tsx:265` | `ProfilePage` | **SUPERSEDED (S2)** — see §3 |
| `*` | both | ra-core `CoreAdminRoutes.tsx:125` | `NotFound` (`src/components/admin/not-found.tsx`) | **Keep** — a real 404 screen |

Outside `<Admin>` entirely, in `src/App.tsx`: the `#/portal` branch (`App.tsx:37-39`) and the
unauthenticated landing gate at `/` (`App.tsx:42`). The portal is **Story 1.4's**, not this
story's — do not touch `App.tsx`'s portal branch or `src/components/atomic-crm/portal/`.

**Counted dead findings: 8 (D1-D8). Counted superseded surfaces owned here: 2 (S1-S2); a third,
`/import`, is story 1.1's and is gone before you start.**

### 3. Why the two superseded surfaces go, and exactly what goes with each

**S1 `/changelog`.** It renders the repository `CHANGELOG.md` via `?raw`
(`ChangelogPage.tsx:7`), and that file is the **upstream Atomic CRM fork's release notes** — its
first entry is "v1.5.0 … table `contactNotes` has been renamed `contact_notes` … column
`stateAbbr` in table `companies`". Shipping the fork's changelog as a product screen is precisely
the "dead surface behind a live one" AD-23 forbids. Files: `misc/ChangelogPage.tsx` (46 L),
`settings/AboutSection.tsx` (33 L, its only in-app entry point), `TopBar.tsx` `ChangelogMenuItem`,
`CRM.tsx:269` + `:346`, i18n `crm.changelog` in both catalogs. `CHANGELOG.md` itself stays as a
repo file — only its exposure as a route goes.

**`misc/Markdown.tsx` goes with it.** An earlier draft of this story kept `Markdown.tsx` and
`MobileBackButton.tsx` "because they have other consumers". That was wrong — every one of those
consumers is deleted inside Epic 1. Measured today:

| Orphaned primitive | Consumers today | Who deletes each consumer | Left after Epic 1 |
|---|---|---|---|
| `misc/Markdown.tsx` | `notes/Note.tsx:24`, `notes/NoteShowPage.tsx:16`, `misc/ChangelogPage.tsx:6` | 1.1, 1.1, **1.5** | **0** |
| `misc/MobileBackButton.tsx` | `notes/NoteShowPage.tsx:17`, `companies/CompanyShow.tsx:31`, `contacts/ContactShow.tsx:34`, `misc/ChangelogPage.tsx:8` | 1.1, 1.1, 1.1, **1.5** | **0** |

- **`Markdown.tsx` is this story's to delete** (Task 4). Since 1.1 lands first in the pinned order,
  by the time you start, `ChangelogPage.tsx` is already its only importer. NFR-14 forbids leaving
  it: nothing in the SPEC renders markdown after Epic 1, and `Entity360` / `EntityList` (AD-24)
  are specified as structured field surfaces, not prose renderers. Deleting it also orphans
  `marked` + `dompurify` in `package.json` — remove those too (Task 4), which is the greenfield
  outcome and also removes a sanitizer this repo no longer needs to keep patched.
- **`MobileBackButton.tsx` is 1.1's to keep — reconciled, deliberate, and it stays.** It is the
  **one** `misc/` primitive 1.1 keeps: its scope call #5 now deletes the other nine zero-importer
  primitives outright (`usePapaParse`, `isLinkedInUrl`, `RelativeDate`, `ActiveFilterButton`,
  `AsideSection`, `InfinitePagination`, `ResponsiveFilters`, `fetchWithTimeout`, `useAppBarHeight`)
  and keeps only this one, on the grounds that AD-24's `Entity360` needs a mobile back affordance
  in Epic 3/4. That claim is plausible for a navigation primitive in a way it is not for a
  markdown renderer, and it is 1.1's call to make, not this story's. **Do not delete
  `MobileBackButton.tsx` here** — only remove the `ChangelogPage.tsx:8,18` usage, which
  disappears with the file. The cross-check logs it as a deliberate, flagged exception (V1); if
  the product owner wants the zero-importer rule applied uniformly, that is a correct-course on
  **1.1**, not a change to this story.

**`/import` is not in this section — it is story 1.1's.** A JSON restore for
`["sales", "companies", "contacts", "notes", "tasks"]` (`useImportFromJson.ts:689`) — four of
those five entities are fossils 1.1 deletes, and no SPEC capability covers JSON import (CAP-1
capture is share/email/manual-upload into the inbox; AD-15 is *export*, not import). Successive
drafts moved it between the two stories; it is settled on 1.1 because 1.1 runs **first** and
deletes the three modules `useImportFromJson.ts:12-15` imports, so the surface cannot compile long
enough to reach you. Everything it comprises — the three `misc/` files, the `CRM.tsx` route +
import, `ImportFromJsonMenuItem` + the `Import` icon, `crm.import` + `crm.header.import_data`,
`misc/usePapaParse.tsx` and the fixture `test-data/import-sample-invalid-sale.json` — is on 1.1's
list. Nothing here.

**S2 `/profile`.** A desktop-only second copy of a capability that already lives inside
`/settings` on both surfaces: `SettingsPage.tsx:57` and `SettingsPageMobile.tsx:38` both render
`<ProfileSection />`, which edits the same avatar / first name / last name / email through the
same `dataProvider.salesUpdate`. Two ways to edit one record is the "parallel surface" AD-24
forbids. Files: `settings/ProfilePage.tsx` (90 L), `settings/ProfileForm.tsx` (194 L, sole
consumer is `ProfilePage`), `TopBar.tsx` `ProfileMenuItem`, `CRM.tsx:265`. **This story owns both
file deletions** (cross-check C3 / O2): 1.2's `sales` → `members` rename no longer visits
`ProfileForm.tsx` (lines 19, 35, 66-76, 107, 178) or `ProfilePage.tsx` (14, 27, 36, 44, 81),
because under the pinned order those files are gone before 1.2 starts. The two
`dataProvider.salesUpdate` call sites they contained (`ProfileForm.tsx:76`, `ProfilePage.tsx:44`)
disappear with them, which is why 1.2's call-site count drops from 7 to 4 rather than to 6.

> **Scope call, flagged.** The epic AC names only the `/tasks` redirect explicitly; "and other
> legacy routes exist" is what puts S1-S2 here, under the story titled "…and superseded
> surfaces". If the product owner wants either kept, that is a correct-course on this
> story — each is its own bullet in AC #4 so it can be dropped independently without unpicking
> the rest. **Do not "keep it just in case"**: NFR-14 makes keeping it the more expensive choice.

### 4. Overlap with the other Epic 1 stories — do not double-specify

Order is pinned (see "Position and dependencies" at the top): `1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6`.
1.1 and 1.4 are **already merged** when you start; 1.3, 1.2 and 1.6 are downstream of you.

| Story | Owns these routes / surfaces | This story must **not** touch them |
|---|---|---|
| **1.1 Delete the fossil resources** *(lands 1st)* | `/contacts`, `/companies`, `/deals`, `/tags` and their folders, fixtures, generators, `dataGenerator/`, `activity/ActivityLog*Contact/Company/Deal*`, `notes/`, `e2e/bulkContactTags.spec.ts`, `e2e/userAddingATask.spec.ts`, `e2e/fixtures.ts`, `dashboard/Welcome.tsx`, `misc/usePapaParse.tsx`, `misc/isLinkedInUrl.ts`, `misc/MobileBackButton.tsx` (kept, see §3), `test-data/import-sample-invalid-sale.json`, and the six **orphaned** dashboard widgets that reference them (`dashboard/TasksList.tsx`, `DealsChart.tsx`, `HotContacts.tsx`, `Welcome.tsx`, `DashboardActivityLog.tsx`, `DashboardStepper.tsx` — all have **0** importers today; verified). Note: none of those four resources is registered in `CRM.tsx` today, so for those 1.1 deletes folders, not routes. **1.1 also owns the whole `/import` surface** — the three `misc/` files, the `CRM.tsx:31,268` route + import, `ImportFromJsonMenuItem` + the `Import` icon in `TopBar.tsx`, and `crm.import` / `crm.header.import_data` — reversing the earlier D1 ruling, because 1.1 runs first and deletes `useImportFromJson.ts`'s imports. | Leave every `contacts/`, `companies/`, `deals/`, `tags/`, `notes/`, `activity/` file alone, and leave `MobileBackButton.tsx` in place. Do not re-remove any part of `/import` — it is gone before you start. If the typecheck complains about one of them, that is 1.1's failure, not yours — report it, do not fix it here. |
| **1.2 `sales` → `members`** *(lands 5th)* | the `sales` manifest entry, `sales/` folder, `useGetSalesName`, `canAccess.ts:21`, `TopBar` `UsersMenuItem` link `to="/sales"`, `resources.sales.*` i18n | Register `sales` in the manifest under its **current** name with `surface: "desktop"`. 1.2 renames the manifest entry — it does **not** edit `CRM.tsx:290`, which no longer exists after you. 1.2 also no longer touches `settings/ProfileForm.tsx` / `ProfilePage.tsx`: you delete them (C3/O2). |
| **1.3 `children` → `singles`** *(lands 4th)* | the `children` manifest entry, `children/` folder, `resources.children.*`, `ChildSwitcherPill` in `TopBar.tsx:68-119`, `FamilySection` link `to="/children"` | Register `children` under its current name. 1.3 renames the manifest entry and the route — it does **not** edit `CRM.tsx:281,351`, which no longer exist after you. Do not pre-rename anything `child`-named; 1.3 owns every `child` symbol including camelCase ones. |
| **1.4 Retire the token portal** *(lands 2nd)* | `src/App.tsx:2,37-39`, `portal/` (10 files), `children/ChildPortalShare.tsx`, `providers/fakerest/internal/childPortal.ts`, `child_portal_tokens`, `get_child_portal()` | Do not touch `App.tsx`. The portal is not an `<Admin>` route, so it is outside this story's inventory by construction. |
| **1.6 Tidy-code baseline** *(lands last)* | CI going green with zero suppressions | Your AC #8 is a subset — do not add suppressions to reach it. |
| **`e2e/` and the CI `e2e-test` job** | Not this story. **1.1** deletes the three fossil specs and keeps the directory, `fixtures.ts`, the config and the job; **1.6** — and only 1.6 — lands the single replacement smoke spec `e2e/pipeline.spec.ts` (1.6 AC-7). Nothing in between owns a spec. | Do not add, delete or edit anything under `e2e/`, `makefile`'s `test-e2e*` targets or `.github/workflows/check.yml`. **Expect `make test-e2e-ci` to exit 1 with `Error: No tests found` for the whole of this story** — a known interim red spanning 1.4 → 1.2 (1.1 §"Known interim red"), not a regression and not yours to fix. |
| **Epic 2 (2.6 passwordless)** | `/set-password`, `/forgot-password`, `/oauth/consent`, `login/GoogleSignInButton*`, `ChangePasswordButton` | Keep them registered. They render real screens; AD-11 deletes them later, not now. |
| **Epic 3/4/5** | `Entity360`, `EntityList`, AD-24 route shape, the Tasks tab (3.8) and the navigation set (4.4, which names **Tasks** a primary destination) | Do not restructure routes. Do not add `/tasks` to `PRIMARY_NAV` — 4.4 owns the nav set. |

**Files this story shares with another story — expect a merge conflict and rebase, do not
"pre-fix" the other story's part:**
`src/components/atomic-crm/root/CRM.tsx` (1.1 upstream; 1.2 and 1.3 downstream, but only through
`routeManifest.ts` after this story),
`src/components/atomic-crm/root/routeManifest.ts` (**created here**; 1.2 renames the `sales` entry,
1.3 the `children` entry — both downstream),
`src/components/atomic-crm/layout/TopBar.tsx` (1.2 `UsersMenuItem`, 1.3 `ChildSwitcherPill`; the
`<UserMenu>` menu-item removals are all yours),
`src/components/atomic-crm/providers/commons/englishCrmMessages.ts` and
`frenchCrmMessages.ts` (1.1 upstream; 1.2, 1.3 downstream — all prune keys),
`src/components/atomic-crm/settings/SettingsPage.tsx` / `SettingsPageMobile.tsx` (1.3 via
`FamilySection`), `package.json` (only this story removes a dependency in Epic 1),
`registry.json` (regenerated by every story).

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
- **Dependencies.** Removing `marked` / `dompurify` / `@types/dompurify` is a `package.json` edit
  plus `npm install` to refresh `package-lock.json` — do not hand-edit the lockfile. This is the
  only dependency change in Epic 1; commit both files together.
- **Validation commands.** `npm run typecheck` · `npm run lint` (eslint) ·
  `npm run test:unit:app` (vitest `app` project, real Chromium via Playwright) ·
  `npx prettier --config ./.prettierrc.json --check <your changed files>`. Do **not** gate on
  repo-wide `npm run prettier` or on `make lint` (which bundles it): both are red on `main`
  (89 files) for reasons outside this story, and turning them green is 1.6's AC-5.
- **LSP over grep for TypeScript symbols.** Use `findReferences` before removing
  `ProfileForm`, `AboutSection`, `Markdown`, `MobileTasksList` — the counts in
  §3 were taken that way and should reproduce.

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
- Naming: `PascalCase` components and types (`CustomRouteEntry`, `ResourceEntry`,
  `ManifestViolation`, `ViolationCode`), `UPPER_SNAKE_CASE` for `CUSTOM_ROUTES` / `RESOURCES`
  (matching `PRIMARY_NAV`), `camelCase` for `routesFor` / `resourcesFor` /
  `findManifestViolations`. `ViolationCode` members are kebab-case string literals. English only
  in committed files.
- Deleting `misc/Markdown.tsx` takes `misc/` down by one file and `package.json` down by three
  dependencies; nothing is restructured. Per `.claude/rules/coding-style.md` this is pure
  deletion — do not "refactor while you're in there".
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
- [Source: src/components/atomic-crm/settings/SettingsPage.tsx:57 and SettingsPageMobile.tsx:38 (`ProfileSection` already supersedes `/profile`)]
- [Source: src/components/atomic-crm/misc/Markdown.tsx:2-3,47 (its only importers are `notes/Note.tsx:24`, `notes/NoteShowPage.tsx:16`, `misc/ChangelogPage.tsx:6`; it is the only importer of `marked` and `dompurify` in the repo)]
- [Source: package.json:65,74,112 (`dompurify`, `marked`, `@types/dompurify`) and registry.json:30 (`dompurify@^3.3.1`)]
- [Source: src/components/atomic-crm/layout/TopBar.tsx:24,43,51,139-153,187-201 (`ProfileMenuItem` and `ChangelogMenuItem` and their imports — the two `<UserMenu>` items this story removes; `ImportFromJsonMenuItem` at :25,50,171-185 goes with story 1.1)]
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md — C2/O1, C3, C5, G6, W5, W6. **D1 is reversed**: the `/import` surface is story 1.1's, not this story's, because the pinned order puts 1.1 first and it deletes the three modules `useImportFromJson.ts` imports]
- [Source: .claude/rules/coding-style.md#File organization, .claude/rules/testing.md, .claude/rules/english-only.md, .claude/rules/lsp-usage.md]
- [Source: AGENTS.md#Database Management, #Mutable Dependencies, #Registry (Shadcn Components)]
- [Source: memory/supabase-cli-dbus-hang.md (`DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-opus-5), via the bmad-dev-story workflow.

### Debug Log References

None — no failing run needed debugging. `npm run typecheck`, `npm run lint`, `npm run test:unit:app`
and `npm run build` were all green on the first pass after each task; only the story's own
`npx prettier --check` scoped run needed one `--write` pass (`routeManifest.ts`,
`routeManifest.test.ts`, `authentication-error.test.tsx`) before it was clean.

### Completion Notes List

- **Task 1 — route manifest.** Created `routeManifest.ts` with `Surface`, `CustomRouteEntry`,
  `ResourceEntry`, `CUSTOM_ROUTES` (10 entries), `RESOURCES` (7 entries), `routesFor`/`resourcesFor`,
  and the validator. `children` and `sales` are registered under their current names (`sales` with
  `surface: "desktop"`), per "Position and dependencies". `CRM.tsx`'s `DesktopAdmin`/`MobileAdmin`
  now map over the manifest via two shared, non-component functions (`renderCustomRoutes`,
  `renderResources`) defined once at module scope — this keeps `<Route>`/`<Resource>` JSX to exactly
  one source line each (AC #5's grep), while still satisfying ra-core's `useConfigureAdminRouterFromChildren`,
  which only recognizes `CustomRoutes`/`Resource` elements as **direct** children of `<Admin>` (or
  inside a `Fragment`) — a wrapping React *component* would have hidden them from that shallow scan,
  so the shared logic is two plain functions returning JSX, not two components.
- **Task 2 — `/tasks`.** Deleted the `Navigate` redirect and the component-less desktop `tasks`
  resource. Renamed `MobileTasksList.tsx` → `TasksListPage.tsx`, made it responsive with
  `useIsMobile()` (mobile: `MobileHeader`/`MobileContent`; desktop: a heading matching
  `SettingsPage`/`ProfilePage`'s style) wrapping the existing `TasksListContent`. Registered once in
  the manifest as `{ name: "tasks", surface: "both", definition: { list: TasksListPage } }`. No
  create affordance, as specified.
- **Task 3 — component-less resources.** `reference_links`, `interactions`, `redts`,
  `shidduch_schools` simply do not appear in the new manifest (Task 1 already omitted them).
  Re-verified zero `reference="..."` usages and zero `resources.*` i18n keys for all four before
  finalizing — confirmed clean.
- **Task 4 — superseded surfaces.** Deleted `misc/ChangelogPage.tsx`, `settings/AboutSection.tsx`,
  `settings/ProfilePage.tsx`, `settings/ProfileForm.tsx`, `misc/Markdown.tsx`. Removed
  `ChangelogMenuItem`/`ProfileMenuItem` (and their now-unused `FileText`/`User` icon imports) from
  `TopBar.tsx`; `<UserMenu>` now holds exactly `<UsersMenuItem />` + `<SettingsMenuItem />`, lucide
  import is exactly `{ ChevronDown, Settings, Users }`. Confirmed `/import` was already fully gone
  (1.1 landed clean — no leftovers to report). Removed `<AboutSection />` + its import from both
  `SettingsPage.tsx` and `SettingsPageMobile.tsx` (and reworded `SettingsPage.tsx`'s stale docstring
  that still listed "about" as a section). Removed the orphaned `crm.changelog` and
  `crm.profile.inbound`/`crm.profile.mcp` blocks from both i18n catalogs. **Beyond the story's
  explicit list:** also removed `crm.settings.about` (English + French) — the translation key whose
  only consumer was the `AboutSection.tsx` just deleted; leaving it would have been new dead code
  introduced by this story's own edit, which NFR-14 forbids. Removed `marked`, `dompurify`,
  `@types/dompurify` from `package.json` and refreshed `package-lock.json` via `npm install` (only
  dependency change in Epic 1, as flagged).
- **Task 5 — error screens.** Added `src/components/admin/access-denied.tsx` and
  `authentication-error.tsx`, modelled on `not-found.tsx`'s heading/message/back-button shape (all
  strings via `<Translate i18nKey>`, using the four `ra.page.*`/`ra.message.*` keys already shipped
  by `ra-language-english`). Deliberately did **not** copy `not-found.tsx`'s `useAuthenticated()`
  guard: that hook's `logoutOnFailure` default would re-trigger a login redirect from the very
  authentication-error screen meant to explain the failure, which would defeat the screen's purpose.
  Exported both from `components/admin/index.ts` (alphabetical, next to `not-found`/`authentication`).
  Wired `accessDenied`/`authenticationError` into both `<Admin>` call sites. Added one render test per
  screen (`vitest-browser-react` + `CoreAdminContext` + `testI18nProvider`, the same pattern as
  `GoogleSignInButton.test.tsx`), each asserting the heading text is visible.
- **Task 6 — automated check.** Implemented `findManifestViolations` covering all five
  `ViolationCode`s, evaluated per surface, taking `customRoutes`/`resources`/`navTargets` as
  parameters only (no module-scope reads). `routeManifest.test.ts` has the one positive test (real
  manifest + `PRIMARY_NAV.map(i => i.to)` → `[]`) plus five negative tests, one per code, each with
  its own local fixture manifest; every assertion filters the returned array by `{code, surface}`
  rather than asserting total array length, since several suggested fixtures intentionally use
  `surface: "both"` (producing a same-code violation on each surface) — filtering isolates the one
  under test without weakening the check. Wrote fixture React elements with `createElement` (not
  JSX) since the test file is `.ts`, not `.tsx`.
- **Task 7 — verify and tidy.** Every AC grep (AC #1, #2, #4c, #5, #7) reproduced exactly as
  specified — zero drift from the story's stated counts. `npm run typecheck`, `npm run lint`,
  `npm run test:unit:app` (501 tests, 51 files across all vitest projects) and `npm run build` are
  all clean. Ran `npx prettier --check` scoped to this story's changed files only (per AC #8 — the
  repo-wide `npm run prettier` gate is story 1.6's, and is red on `main` for unrelated files).
  `make registry-gen` updated `registry.json`'s `files` array; separately hand-removed the now-stale
  `dompurify@^3.3.1` **and** `marked@^17.0.1` entries from `registry.json`'s `dependencies` array,
  since `generate-registry.mjs` only regenerates the `files` list, not `dependencies` (the story's
  Dev Notes assumed `registry-gen` drops the dependency automatically — it doesn't; see "Story
  claims that did not reproduce" below). Did not perform a literal browser click-through of the
  manual-walk route list; the positive `routeManifest.test.ts` case proves the same invariant
  (every registered route/resource resolves to a real screen) that the manual walk exists to check,
  and `npm run build` additionally proves the whole tree still compiles/bundles.

**Story claims that did not reproduce exactly:**
- Task 7 states `make registry-gen` "drops the `dompurify@^3.3.1` registry dependency". In the
  actual `scripts/generate-registry.mjs`, the `dependencies` array is copied through unchanged from
  the existing `registry.json` — only the `files` array is recomputed from the filesystem. Running
  `make registry-gen` alone left both `dompurify@^3.3.1` and `marked@^17.0.1` in place; both were
  removed by hand in the same commit to keep the registry truthful.

### File List

**Added:**
- `src/components/admin/access-denied.tsx`
- `src/components/admin/access-denied.test.tsx`
- `src/components/admin/authentication-error.tsx`
- `src/components/admin/authentication-error.test.tsx`
- `src/components/atomic-crm/root/routeManifest.ts`
- `src/components/atomic-crm/root/routeManifest.test.ts`
- `src/components/atomic-crm/tasks/TasksListPage.tsx` (renamed from `MobileTasksList.tsx`)

**Deleted:**
- `src/components/atomic-crm/tasks/MobileTasksList.tsx` (renamed to `TasksListPage.tsx`)
- `src/components/atomic-crm/misc/ChangelogPage.tsx`
- `src/components/atomic-crm/misc/Markdown.tsx`
- `src/components/atomic-crm/settings/AboutSection.tsx`
- `src/components/atomic-crm/settings/ProfilePage.tsx`
- `src/components/atomic-crm/settings/ProfileForm.tsx`

**Modified:**
- `src/components/atomic-crm/root/CRM.tsx`
- `src/components/atomic-crm/layout/TopBar.tsx`
- `src/components/atomic-crm/settings/SettingsPage.tsx`
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/admin/index.ts`
- `package.json`
- `package-lock.json`
- `registry.json`
