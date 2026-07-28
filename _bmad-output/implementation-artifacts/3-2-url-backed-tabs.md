# Story 3.2: URL-backed tabs

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to link someone straight to a tab,
so that sharing and browser navigation work.

## Position in Epic 3

**Step 4** in the Epic 3 build order
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md §12].

**Hard dependencies — all must be merged before this story starts:**

| Dependency | What this story consumes from it |
|---|---|
| **3-13** (tab vocabulary) — contract numbering; **filed as `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`**, *not* `3-13-records-at-urls-not-modals.md` | `entity360/tabKeys.ts` — the closed `TabKey` union, `TAB_LABELS` and `isTabKey` (contract §3), plus `entity360/useTabLabel.ts`. `buildTabPath` and `Entity360Tabs` are typed on `TabKey`, not on `string`; the `:tab` URL segment is narrowed through `isTabKey`. |
| **3.1** (`Entity360` shell) | The `tabBar` region. `Entity360Tabs` is mounted there (contract §1). |
| **3.3a** (descriptor types + registry) | `requireEntityDescriptor` / `getEntityDescriptor` (contract §4). Every path builder in this story routes through them. |
| **3.9** (`RecordLink` + the four stub descriptors) | The four registered descriptors (`shidduchim`, `singles`, `shadchanim`, `references`). Without them `buildNewPath("singles")` throws at render in `Dashboard.tsx`, and AC 8 cannot land. |

**Downstream:** **3.12** (route convention) adopts this story's `entityPaths.ts` builders
across the app and must land immediately after it; **3.3b** (`EntityShow`) consumes
`Entity360Tabs`; **3.4** filters the `tabs` array before it reaches `Entity360Tabs`; every
Epic 5 entity migration calls `buildEntityRoutes` once and deletes 3.12's `buildCreateRoutes`
call for its entity.

## Scope boundary — read before starting

This story builds the routing and tab mechanism **generically** and proves it with in-file
fixtures. It does **not** migrate any entity onto `Entity360`: `RESOURCES` in
`src/components/atomic-crm/root/routeManifest.ts:92-100` is not re-pointed at
`buildEntityRoutes` by this story. That is each entity's Epic 5 story (5.1 `shidduchim`, 5.8
`singles`, 5.9 `shadchanim`, 5.10 `references`).

**This story touches no live application file.** Contract §10 and §12 step 4 originally gave
3.2 the `/{entity}/create` → `/{entity}/new` rename, the `CreateButton`/`EditButton`/row-link
overrides and the explicit `hasShow`/`hasEdit` rule. **The project owner has split all four out
into Story 3.12** (`_bmad-output/implementation-artifacts/3-12-route-convention-new.md`), which
amends contract §10/§12 accordingly. The seam:

- **3.2 (here)** owns the route *table* (`buildEntityRoutes`, which declares the `new` segment)
  and the *path builders* (`entityPaths.ts`, including `buildNewPath` and `buildEditPath`).
- **3.12** owns everything that must point at them: the 14 live `/create` links, the
  `/create` → `/new` compatibility redirect, the three admin-kit buttons, the post-save
  redirects, the `<Resource>` registration rules, `RECORD_FLAG_EXEMPTIONS` and the CI guard.

**Do not implement any of 3.12's scope here**, and in particular do not add a descriptor-first
override to `admin/data-table.tsx`: 3.12 AC 7 pins the opposite behaviour (a `{ list }`-only
registration must *not* navigate on row click, which is what makes the `hasShow`/`hasEdit` rule
observable), and a descriptor-first override in `data-table.tsx` would make that test
unfalsifiable. 3.12 builds immediately after this story and before 3.3b.

## The routing conflicts this story exists to resolve

AD-24's route convention is `/{entity}`, `/{entity}/{id}`, `/{entity}/{id}/{tab}`,
`/{entity}/new`, `/{entity}/{id}/edit` — the bare `/{entity}/{id}` is the record's **show**
page, and records live at URLs, not modals
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:161-165 — UX-DR2, UX-DR3].
Epic 5 Story 5.1 is explicit for the pilot entity: *"it opens at `/shidduchim/{id}` as a page
on the shell, not a modal / And the routed dialog is deleted"*
[Source: _bmad-output/planning-artifacts/epics.md:668-669].

`ra-core`'s `<Resource>` hard-wires a different shape. Condensed, exact (elements elided):

```js
create && <Route path="create/*"  .../>
show   && <Route path=":id/show/*" .../>
edit   && <Route path=":id/*"      .../>
list   && <Route path="/*"         .../>   // wrapped in <RestoreScrollPosition>
props.children                              // rendered last, inside the same <Routes>
```
[Source: node_modules/ra-core/dist/core/Resource.js:6-16]. Under `<Resource>`'s own routing,
`/{entity}/{id}` is the **edit** route, not show. Passing `show`/`edit`/`create` props
therefore cannot produce AD-24's shape.

**Resolution (binding for this epic and every Epic 5 migration):** a migrated entity registers
**only** `list` on `<Resource>` — set to the element `buildEntityRoutes` returns — **plus
explicit `hasShow` / `hasEdit` props**. `list`'s route is `path="/*"`, so `EntityRoutes`
receives every sub-path and owns `""`, `new`, `:id/edit`, `:id` and `:id/:tab` itself.
`Resource.registerResource` computes `hasEdit: !!edit || !!hasEdit` and
`hasShow: !!show || !!hasShow` [Source: node_modules/ra-core/dist/core/Resource.js:28-37],
so the two explicit props are what keep `useGetPathForRecord`'s inferred-link branch alive
[Source: node_modules/ra-core/dist/routing/useGetPathForRecord.js:47-99].

Three further framework facts this story owns, all verified on `main`:

1. **Nothing under `buildEntityRoutes` fetches a record.** `EntityShow` (3.3b) reads
   `useRecordContext()`. Today that context comes from `ShowBase`
   [Source: src/components/admin/show.tsx:66-73], whose `ShowContextProvider` is what wraps
   children in a `RecordContextProvider`
   [Source: node_modules/ra-core/dist/controller/show/ShowContextProvider.js:25-26]. Without
   AC 1's `ShowBase` wrapping the first migrated 360 renders an empty shell and every Epic 5
   story improvises its own fetch (contract §5 rule 1, §10).
2. **`useCreatePath` is wrong for `create` and `edit`, not only `show`.**
   `case 'create'` → `/{resource}/create`, but AD-24 routes creation at `new`;
   `case 'edit'` → `/{resource}/{id}`, **byte-identical to AD-24's show URL**;
   `case 'show'` → `/{resource}/{id}/show`
   [Source: node_modules/ra-core/dist/routing/useCreatePath.js:43-63]. Both
   `admin/create-button.tsx:41-46` and `admin/edit-button.tsx:46-58` build their `to` from it,
   and `EditButton` is live on migrated-entity screens. Day one of the first migration, Edit
   navigates to the 360 and Create renders the list.
3. **`<Resource>` wraps the `list` element — i.e. all of `EntityRoutes` — in
   `<RestoreScrollPosition storeKey={`${name}.list.scrollPosition`}>`**
   [Source: node_modules/ra-core/dist/core/Resource.js:14], which restores the stored offset
   once, on mount [Source: node_modules/ra-core/dist/routing/useRestoreScrollPosition.js:24-35].
   A deep link straight to `/singles/1/notes` therefore opens scrolled to wherever the user
   last left the *list*.

## Acceptance Criteria

1. **`buildEntityRoutes` produces the AD-24 route table, with `ShowBase` on both record
   routes.** `src/components/atomic-crm/entity360/buildEntityRoutes.tsx` exports

   ```ts
   export function buildEntityRoutes(config: {
     List: ComponentType;
     New?: ComponentType;
     Edit?: ComponentType;
     Show: ComponentType;   // normally EntityShow (3.3b)
   }): ReactElement;
   ```

   returning a nested `<Routes>` with exactly these routes: `index` → `<List/>`; `new` →
   `<New/>` when supplied; `:id/edit` → `<Edit/>` when supplied; `:id` → `<ShowBase …><Show/></ShowBase>`;
   `:id/:tab` → `<ShowBase …><Show/></ShowBase>`. **Test (one `it` per path, browser mode,
   `TestMemoryRouter` seeded at each of `/`, `/new`, `/1/edit`, `/1`, `/1/overview`): the
   expected fixture component is on screen and the others are not** — the negative half uses
   `await expect.element(screen.getByText(...)).not.toBeInTheDocument()`. Failing looks like:
   `/1/edit` rendering the fixture `Show`, or `/1` rendering nothing.

2. **Record pending and record-unavailable are explicit, and neither silently navigates.**
   `ShowBase` renders its children even while the record is undefined unless a `loading`
   element is passed, and on a fetch error `useShowController` notifies and **redirects to the
   list** by default (`redirectOnError = 'list'`)
   [Source: node_modules/ra-core/dist/controller/show/useShowController.js:39-74,110]. AC 1's
   `ShowBase` therefore passes **both** `loading={<RecordPending/>}` and
   `error={<RecordUnavailable/>}`; passing a defined `error` element is itself what sets
   `redirectOnError` to `false`
   [Source: node_modules/ra-core/dist/controller/show/ShowBase.js:35-40]. Both components are
   new, live in `entity360/`, and take their strings from the `i18nProvider` with an English
   `_:` fallback. `RecordUnavailable` renders a link to `buildListPath(resource)`.
   **Test:** with a `getOne` that rejects, (a) `RecordUnavailable` is on screen, (b)
   `location.pathname` is unchanged from the deep link (captured via `TestMemoryRouter`'s
   `locationCallback`, as in `ContextSwitcher.test.tsx:69-73`). Failing looks like: the test
   ending at `/fixtures`. This is the AD-19 case — a record from a non-active context returns
   an empty result set, and `ContextSwitcher` already sends the user to `/` on a deliberate
   switch [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:98-101]; a pasted link
   must not do the same thing silently.

3. **One module builds every entity path; nothing else builds one by template literal.**
   `src/components/atomic-crm/entity360/entityPaths.ts` exports

   ```ts
   export function buildListPath(name: string): string;                              // `/${name}`
   export function buildNewPath(name: string): string;                               // `/${name}/new`
   export function buildRecordPath(name: string, id: Identifier): string;            // descriptor.buildRecordPath(id)
   export function buildEditPath(name: string, id: Identifier): string;              // `/${name}/${id}/edit`
   export function buildTabPath(name: string, id: Identifier, tab: TabKey): string;  // `${buildRecordPath()}/${tab}`
   ```

   All five call `requireEntityDescriptor(name)` first, so an unregistered resource throws
   rather than producing a plausible-but-dead URL (contract §4 rule 3). `buildRecordPath` and
   `buildTabPath` delegate to the descriptor, which is what makes Epic 5's one-line
   `buildRecordPath` flip propagate to tab links and deep links at once. **`buildEditPath` is
   deliberately *not* derived from `buildRecordPath`** — see Dev Notes, "Why `buildEditPath` is
   a literal". **Test:** each builder returns the expected string for a fixture descriptor, and
   each throws `Error('No entity descriptor registered for resource "nope"')` for an
   unregistered name. Failing looks like: `buildEditPath` returning `/fixtures/1/show/edit`.

4. **`Entity360Tabs` is driven by the URL and its triggers are real links.**
   `entity360/Entity360Tabs.tsx` exports

   ```ts
   export function Entity360Tabs(props: {
     // `label` is OPTIONAL and is the caller's *override*, not a resolved string:
     // `Entity360Tabs` renders `useTabLabel(key, label)`. `EntityShow` forwards
     // `tab.label` verbatim, including `undefined`, and must not fill it in from TAB_LABELS.
     tabs: { key: TabKey; label?: string; render: () => ReactNode }[];
   }): ReactElement;
   ```

   It reads the resource from `useResourceContext()` and the record from `useRecordContext()`
   (never from props — contract §4/§6 rule 4), reads the active key from
   `useParams<{ tab?: string }>()`, and renders the tab strip **and** the active tab's panel.
   Each trigger is an `<a>` whose `href` is `buildTabPath(resource, record.id, key)` — a
   `react-router` `<Link>` passed through Radix's `asChild`, so middle-click, "open in new tab"
   and "copy link address" all work and a tab click is an ordinary history **push**. Only the
   active tab's `render()` is called; the others' `render` is not invoked and their subtrees do
   not exist. Labels are rendered **only** through `useTabLabel` from
   `entity360/useTabLabel.ts` (3-13 / `3-10-tab-vocabulary.md` AC 3) — do not re-implement the
   translate call here. The catalog key is `crm.entity360.tab.<key>`, **not** the contract §3
   sketch's bare `entity360.tab.<key>`: `englishCrmMessages.ts:104` nests everything under a
   single `crm` root, so a bare `entity360.*` key can never resolve (contract §3 rule 2,
   §13 rule 6). **Precedence is settled — implement it, do not re-open it.**
   `useTabLabel(key, override)` returns `override ?? translate("crm.entity360.tab." + key,
   { _: TAB_LABELS[key] })`, and `EntityTabDescriptor.label` is **optional and normally
   absent** (contract §2 rule 8). `Entity360Tabs` passes `tab.label` straight into
   `useTabLabel` as `override`, `undefined` included — it must not apply a
   `?? TAB_LABELS[key]` default of its own, and neither may `EntityShow` upstream. Filling the
   label in anywhere before `useTabLabel` makes every tab an override, so the catalog is never
   consulted and i18n is dead while its round-trip test still passes. Do not invent a third
   label path. **Test:** with a
   two-tab fixture at `/fixtures/1/overview`, (a) each trigger's `href` equals the
   corresponding `buildTabPath` value, (b) clicking the second trigger leaves
   `location.pathname` at `/fixtures/1/notes`, (c) browser back returns to
   `/fixtures/1/overview` with the first tab's panel on screen, (d) a `render` spy for the
   inactive tab has zero calls. Failing looks like: triggers rendering as `<button>`, or the
   inactive tab's spy being called.

5. **The bare `/{entity}/{id}` URL is valid and renders the first tab without navigating.**
   AD-24 lists `/{entity}/{id}` as a route in its own right, so `tab === undefined` is **not**
   an unknown tab: `Entity360Tabs` renders `tabs[0]`'s panel in place and performs **no**
   navigation. **Test:** mounting at `/fixtures/1` shows the first tab's panel, and
   `location.pathname` is still `/fixtures/1` after the effects flush, with no additional
   history entry (assert by calling back once and landing outside the fixture route). Failing
   looks like: the URL becoming `/fixtures/1/overview`.

6. **An unknown `:tab` segment `replace`s to the first tab, re-evaluated on every location
   change.** `/fixtures/1/nonsense` renders the first tab and rewrites the URL to
   `buildTabPath(resource, id, tabs[0].key)` with `{ replace: true }` — never a blank screen,
   never a thrown error, never a new history entry. The check runs on every location change,
   not only on mount, because a back-navigation after a context switch can land on a tab the
   viewer no longer has (3.4). **Test:** (a) mounting at `/fixtures/1/nonsense` ends at
   `/fixtures/1/overview` with the first panel on screen; (b) after a legitimate push to
   `/fixtures/1/notes`, programmatically navigating to `/fixtures/1/nonsense` again ends at
   `/fixtures/1/overview` — proving re-evaluation, which a mount-only `useEffect` fails; (c)
   browser back from the fallback does not return to `/fixtures/1/nonsense`. Failing looks
   like: case (b) staying at `/fixtures/1/nonsense`.

7. **An empty `tabs` array renders nothing and never navigates.** This is the state 3.4
   produces while `useViewerRole()` is still pending, and the state a fully-restricted record
   produces. `Entity360Tabs` renders no tab strip, no panel and no error, and issues **no**
   `navigate` call. Without this, AC 6's fallback fires on first paint and `replace`s a
   viewer's deep link before their role resolves (contract §5 rule 6). **Test:** rendered with
   `tabs={[]}` at `/fixtures/1/medical`, `location.pathname` is unchanged and no
   `role="tablist"` element exists. Failing looks like: the pathname becoming `/fixtures/1`
   or `/fixtures/1/undefined`.

8. **`buildEntityRoutes` serves `new` — and `buildNewPath` is proven against it — but this
   story renames no live link.** The `new` segment is part of AC 1's route table and
   `buildNewPath` is part of AC 3's builders; both are tested here against in-file fixtures.
   **The app-wide adoption is Story 3.12's** (`3-12-route-convention-new.md` AC 1 and AC 5):
   the 14 live `/{entity}/create` literals, the `/create` → `/new` compatibility redirect
   (`buildCreateRoutes` / `LegacyCreatePathRedirect` in `entity360/routeConvention.tsx`), the
   `hasCreate: true` swaps in `singles`/`shadchanim`/`references` `index.ts`, and
   `ShidduchimList.tsx:78`'s `matchPath`. **Do not write a `newSegmentAlias` helper here** —
   3.12 supplies `buildCreateRoutes`, and two helpers for one job is exactly the drift this
   epic exists to stop. **Test (this story):** mounting `buildEntityRoutes` at `/new` renders
   the fixture `New` component, and `buildNewPath("fixtures")` returns `/fixtures/new`.
   Failing looks like: `/new` rendering the fixture `List`.

9. **`CreateButton` / `EditButton` / `ShowButton` are Story 3.12's, not this story's.**
   `useCreatePath` is wrong for `create`, `edit` *and* `show` (see "The routing conflicts this
   story exists to resolve", fact 2), and `entityPaths.ts` is the fix — but the fix is applied
   in `3-12-route-convention-new.md` AC 2 and AC 3, which additionally supply the
   `hasAd24RecordShape(name, id)` predicate this story would otherwise get wrong: a *stub*
   descriptor's `buildRecordPath` still returns `/{r}/{id}/show`, so a naive
   "descriptor present → `buildEditPath`" rule would point Edit at `/{entity}/{id}/edit`
   **before** the entity has a route serving it. **No file under `src/components/admin/` is
   edited by this story.**

10. **The `hasShow`/`hasEdit` registration rule is documented here and enforced in 3.12.**
    `Resource.registerResource` computes `hasEdit: !!edit || !!hasEdit` /
    `hasShow: !!show || !!hasShow` [Source: node_modules/ra-core/dist/core/Resource.js:28-37],
    and `admin/data-table.tsx:232-235` resolves row links through
    `useGetPathForRecordCallback`, gated on those flags
    [Source: node_modules/ra-core/dist/routing/useGetPathForRecord.js:78-99] — so a migrated
    entity registered as `list`-only without them has **unclickable rows**.
    `buildEntityRoutes`' TSDoc states the rule, and this story adds two `it`s pinning the
    ra-core mechanism: `useGetPathForRecord()` under a `ResourceDefinitionContextProvider`
    [Source: node_modules/ra-core/dist/core/ResourceDefinitionContext.js:29-48] resolves a path
    with `{ hasList: true, hasShow: true, hasEdit: true }` and resolves `false` with
    `{ hasList: true }` alone. **`admin/data-table.tsx` is not edited** — 3.12 AC 7 turns the
    rule into a manifest violation code (`record-flags-missing`) plus
    `RECORD_FLAG_EXEMPTIONS`, and a descriptor-first override inside `data-table.tsx` would
    make 3.12's row-click test unfalsifiable. (`shidduchim` is unaffected today: it is a Kanban
    board and never goes through `<DataTable>` — brief §7. The regression is real and new for
    `singles`, `shadchanim`, `references`, which register full CRUD today.)

11. **Record routes do not inherit the list's saved scroll offset.** The `:id` and `:id/:tab`
    route elements reset the window scroll to `0` on mount and whenever `:id` changes (not on
    `:tab` changes). **Test:** `vi.spyOn(window, "scrollTo")`; mounting at `/fixtures/1`
    calls it with `(0, 0)`, switching tab does not call it again, and navigating to
    `/fixtures/2` calls it once more. Failing looks like: zero calls on mount.

## Tasks / Subtasks

- [ ] **Task 1 — `entityPaths.ts`** (AC: 3)
  - [ ] Implement the five builders exactly as AC 3 types them, each opening with
        `requireEntityDescriptor(name)`. `buildEditPath` returns the literal
        `` `/${name}/${id}/edit` ``; do not compose it from `buildRecordPath`.
  - [ ] `entityPaths.test.ts`: one `it` per builder for the happy path, one shared `it` for the
        unregistered-resource throw. Register/unregister the fixture descriptor in
        `beforeEach` so tests stay order-independent (`.claude/rules/testing.md#Test-isolation`).

- [ ] **Task 2 — `buildEntityRoutes.tsx`** (AC: 1, 2, 8, 11)
  - [ ] Build the nested `<Routes>` per AC 1 using `react-router`'s `Routes`/`Route` directly.
        `buildEntityRoutes` is what a `<Resource>`'s `list` prop points at, so it sits one
        level below `ra-core`'s own routing and needs no `ResourceContextProvider` of its own —
        the enclosing `<Resource name="…">` already provides it
        [Source: node_modules/ra-core/dist/core/Resource.js:9].
  - [ ] Wrap the two record routes in `ShowBase` with the `loading` and `error` elements from
        AC 2, and in the scroll reset from AC 11.
  - [ ] Add `RecordPending.tsx` and `RecordUnavailable.tsx` in `entity360/`. Strings via
        `useTranslate()` with `_:` English fallbacks; `RecordUnavailable`'s link uses
        `buildListPath(useResourceContext())`.
  - [ ] TSDoc on `buildEntityRoutes` records the AC 10 registration rule: a migrated entity
        registers `list` only **plus explicit `hasShow`/`hasEdit`**, and Story 3.12's
        `record-flags-missing` manifest rule is what enforces it. Do **not** export a
        `newSegmentAlias` helper — 3.12 owns `buildCreateRoutes`.
  - [ ] `buildEntityRoutes.test.tsx`: AC 1's five path `it`s, AC 2's two, AC 11's three. Use
        `CoreAdminContext` with a hand-rolled `dataProvider` (the
        `ContextSwitcher.test.tsx:55-86` shape) so `ShowBase`'s `useGetOne` resolves.

- [ ] **Task 3 — `Entity360Tabs.tsx`** (AC: 4, 5, 6, 7)
  - [ ] Build the component per AC 4 on shadcn's `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`
        (`@/components/ui/tabs`) — the app's existing tab primitive, used this way at
        `references/ReferenceShow.tsx:129-165`. Drive it **controlled**: `value` is the
        resolved active key; each `TabsTrigger` uses `asChild` around a `<Link>` so the trigger
        is an anchor. Do not add a second tabs library and do not hand-roll tab markup.
  - [ ] Resolve the active key in one pure helper (`resolveActiveTab(tabs, tabParam)`) so AC 5
        (`undefined` → first tab, no navigation), AC 6 (unknown → first tab, `replace`) and
        AC 7 (empty → nothing, no navigation) are three branches of one function and cannot
        drift apart. The `replace` navigation lives in an effect keyed on the location and the
        tab array — never a mount-only `[]` dependency list (AC 6 case b is the test that
        catches that).
  - [ ] `Entity360Tabs.test.tsx`: AC 4's four assertions, AC 5's one, AC 6's three, AC 7's one.
        Wrap fixtures in `ResourceContextProvider` + `RecordContextProvider` from `ra-core`
        inside a `TestMemoryRouter` with a `locationCallback`.

- [ ] **Task 4 — the `new` route and `buildNewPath`, fixtures only** (AC: 8)
  - [ ] `buildEntityRoutes` serves `new` → `<New/>` when supplied; `buildNewPath(name)` returns
        `/${name}/new` through `requireEntityDescriptor`. Both proven against the in-file
        fixture entity.
  - [ ] **Hand-off note in the story's Dev Agent Record:** the 14 live `/{entity}/create`
        literals, the `/create` → `/new` redirect, the three `index.ts` `hasCreate` swaps and
        `ShidduchimList.tsx:78`'s `matchPath` are **Story 3.12's Tasks 2 and 5**. Do not do
        them here; do not leave a half-rename behind.

- [ ] **Task 5 — pin the `hasShow`/`hasEdit` mechanism** (AC: 10)
  - [ ] The two `useGetPathForRecord()` `it`s from AC 10 under a
        `ResourceDefinitionContextProvider`. **No file under `src/components/admin/` is edited
        by this story** — the button and manifest changes are 3.12 Tasks 3 and 7.
  - [ ] TSDoc the registration rule on `buildEntityRoutes` (Task 2).

- [ ] **Task 6 — shell integration** (AC: none new — consumption only)
  - [ ] Confirm with one integration test that `<Entity360 tabBar={<Entity360Tabs …/>} />`
        keeps 3.1's region order. `Entity360Tabs` renders both the strip and the active panel,
        so a 360 that uses it leaves `Entity360`'s `children` region undefined; an absent
        region renders nothing, so the AD-24 order is preserved (contract §1 rules 1-2). This
        changes no file from 3.1.

## Dev Notes

### Why `buildEntityRoutes` returns an element, and why `Show` is a fixture here

`ResourceProps.list` accepts `ComponentType | ReactElement`
[Source: node_modules/ra-core/dist/types.d.ts:255-269] and `Resource`'s `getElement` handles
both [Source: node_modules/ra-core/dist/core/Resource.js:17-26], so returning a `ReactElement`
matches contract §5 and needs no wrapper component. `Show` is typed `ComponentType` and is
`EntityShow` in production, but 3.3b has not landed at this point in the build order — every
test in this story passes an in-file fixture component. That is a real fixture, not the
vacuous "verified with a fixture entity" check the previous revision of this story carried
(it was a diff-review instruction, not a test, and has been deleted).

### Why `buildEditPath` is a literal and `buildTabPath` is not

Contract §4 sketches `buildEditPath` as `` `${buildRecordPath(name,id)}/edit` ``. That is
correct only after an entity migrates. Before migration a descriptor's `buildRecordPath`
returns `/{name}/{id}/show` (contract §2 — Epic 5 flips it), so the composed edit path would be
`/singles/1/show/edit`, which `react-router` ranks onto `<Resource>`'s `:id/show/*` route and
renders the **show** surface. `/{name}/{id}/edit` as a literal resolves correctly in both
worlds: today it matches `<Resource>`'s `:id/*` splat and renders `SingleEdit`; after migration
it matches `buildEntityRoutes`'s explicit `:id/edit`.

`buildTabPath` has no such problem — tabs exist only on entities that have already migrated —
so it stays derived from `buildRecordPath`, which is what makes Epic 5's one-line flip
propagate to every tab link.

### Why tabs are a route param, not local state

`.claude/rules/web-patterns.md:21-26` (*"URL as state"*): *"Persist shareable state in the URL:
filters, sort order, pagination, active tab, search query. If refreshing the page should
restore the state, it belongs in the URL."* `references/ReferenceShow.tsx:129`
(`<Tabs defaultValue="conversations">`) is exactly the anti-pattern this story replaces:
uncontrolled tabs that reset on refresh and cannot be deep-linked. This story does **not** edit
`ReferenceShow.tsx` — that migration is Epic 5 Story 5.10's.

### Composition order with Epic 8's context guard

Epic 8 Story 8.1 adds an optional `contextKind` field to `routeManifest.ts`'s entries and wraps
any entry carrying it in `<RequireContextKind>` inside `root/CRM.tsx`'s two `.map()` calls
[Source: _bmad-output/implementation-artifacts/8-1-shadchanus-context.md:47-57]. The guard is
applied at the **resource** level, wrapping `EntityRoutes` as a whole. Do **not** nest it
per-route inside `buildEntityRoutes`.

### Things this story deliberately does not do

- **It does not implement `useViewerRole` or any permission filtering.** That is 3.4. This
  story only guarantees AC 7: an empty `tabs` array is inert. 3.4 filters the array before it
  reaches `Entity360Tabs` (contract §6 rule 2).
- **It does not touch `reminders/`, `RecordLink` or `interactions`.** 3.9 and 3.5 own those.
- **It does not fix `layout/MobileNavigation.tsx:172`'s user-facing label
  *"Add a suggestion"***, an AD-23 violation on a line this story edits for its `to` prop only.
  Flagged for Story 4.4 (navigation set), which owns that surface.
- **It registers no entity on `Entity360`.** See the scope boundary.

### Testing standard

Browser-mode vitest: `vitest-browser-react`'s `render()` in real Chromium
[Source: vitest.config.ts:23-49], with `TestMemoryRouter` from `ra-core`. **React Testing
Library is not a dependency of this repo** — there is no `screen.queryByText` and no
`MemoryRouter`. The negative idiom is
`await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`, and location assertions
use `TestMemoryRouter`'s `locationCallback`; the worked pattern for both is
`src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-10,60-86,95`. AAA, descriptive
names, fixtures reset in `beforeEach`, no `waitForTimeout`, ≥80% coverage on new code
[Source: .claude/rules/testing.md]. All tests run in the `app` vitest project.

Validation commands (**there is no `Makefile` in this repo**):
`npm run typecheck` · `npx vitest run` (or `npm run test:unit:app`) · `npm run lint` ·
`npm run build` [Source: package.json:6-20]. No backend, RLS or migration surface in this
story, so `npm run test:unit:db` is unaffected.

### Project Structure Notes

- New files: `entity360/buildEntityRoutes.tsx`, `entity360/entityPaths.ts`,
  `entity360/Entity360Tabs.tsx`, `entity360/RecordPending.tsx`,
  `entity360/RecordUnavailable.tsx`, plus a `.test.ts(x)` beside each. They sit beside 3.1's
  `Entity360.tsx` and 3-13's `tabKeys.ts`.
- Keep each file under the 200-400 line typical ceiling
  [Source: .claude/rules/coding-style.md]. Route building, path building and tab-bar UI are
  three files on purpose, not one "tabs" mega-file.
- Use the `LSP` tool (`goToDefinition`, `findReferences`, `hover`) for every TypeScript symbol
  question in this story [Source: .claude/rules/lsp-usage.md]. Nothing under
  `src/components/admin/` is edited here (AC 9, AC 10) — that blast-radius work belongs to
  Story 3.12.
- English-only in all new files and comments [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md]
  §4 (path builders), §5 (routes), §6 (tabs), §10 (ownership), §12 (build order), §13 (test
  shape) — the binding API contract for this epic; this story does not restate the shapes it
  does not own.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]
  — AD-24, the route and shell convention this story implements.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:161-165]
  — UX-DR2 (one route convention, `/{entity}/new`) and UX-DR3 (records live at URLs).
  [:186-188] — UX-DR11 (every screen renders empty, loading and error states).
- [Source: _bmad-output/planning-artifacts/epics.md:471-483] — Epic 3 Story 3.2's own ACs.
- [Source: _bmad-output/planning-artifacts/epics.md:668-669] — Story 5.1's *"it opens at
  `/shidduchim/{id}` … the routed dialog is deleted"*, the downstream requirement that makes
  the bare `/{entity}/{id}` shape non-optional.
- [Source: node_modules/ra-core/dist/core/Resource.js:6-16,17-26,28-37] — `<Resource>`'s
  hard-wired route table, `getElement`, and `hasShow`/`hasEdit` registration.
- [Source: node_modules/ra-core/dist/routing/useCreatePath.js:43-63] — the `create`, `edit` and
  `show` path templates `entityPaths.ts` replaces (the button overrides that consume it are
  Story 3.12's).
- [Source: node_modules/ra-core/dist/routing/useGetPathForRecord.js:47-99] — the
  `hasShow`/`hasEdit`-gated inferred-link branch behind `<DataTable>` row clicks.
- [Source: node_modules/ra-core/dist/controller/show/ShowBase.js:35-40] and
  [.../useShowController.js:39-74,110] — `loading`/`error` props, and the default
  redirect-on-error this story disables.
- [Source: node_modules/ra-core/dist/controller/show/ShowContextProvider.js:25-26] — where
  `RecordContext` actually comes from.
- [Source: node_modules/ra-core/dist/routing/useRestoreScrollPosition.js:24-35] and
  [.../core/Resource.js:14] — the inherited list scroll offset AC 11 suppresses.
- [Source: node_modules/ra-core/dist/core/ResourceDefinitionContext.js:29-48] — the provider
  AC 10's test drives.
- [Source: src/components/admin/show.tsx:66-73] — the in-repo `ShowBase` usage this story
  copies.
- [Source: src/components/admin/data-table.tsx:23,232-235] — the row-click primitive
  (`useGetPathForRecordCallback`).
- [Source: src/components/admin/create-button.tsx:38-46, src/components/admin/edit-button.tsx:42-58]
  — the two `useCreatePath` call sites **Story 3.12** overrides (read-only context here).
- [Source: _bmad-output/implementation-artifacts/3-12-route-convention-new.md] — the story that
  adopts this one's builders app-wide; it owns the `/create` → `/new` rename, the three
  admin-kit buttons, the post-save redirects, `RECORD_FLAG_EXEMPTIONS` and the CI guard.
- [Source: src/components/atomic-crm/root/routeManifest.ts:39-43,92-100] — `ResourceEntry`
  (which gains `contextKind?` from 8.1) and the 7 registered resources, only 4 of which have
  descriptors.
- [Source: src/components/atomic-crm/references/ReferenceShow.tsx:129-165] — the existing
  uncontrolled tabs implementation this pattern supersedes, migrated by Epic 5 Story 5.10.
- [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:98-101] — the AD-19 behaviour
  AC 2's handled state complements.
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-10,60-86,95] — the
  browser-mode test pattern (`vitest-browser-react`, `TestMemoryRouter`, `locationCallback`,
  `.not.toBeInTheDocument()`).
- [Source: src/components/atomic-crm/root/routeManifest.test.ts:1-40] — the
  fixture-declared-inside-the-test-file pattern (Epic 1 Story 1.5) this story's tests follow.
- [Source: .claude/rules/web-patterns.md:21-26, .claude/rules/coding-style.md,
  .claude/rules/testing.md, .claude/rules/lsp-usage.md, .claude/rules/english-only.md]
- [Source: package.json:6-20, vitest.config.ts:23-49] — the real validation commands and the
  browser-mode test runner.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
