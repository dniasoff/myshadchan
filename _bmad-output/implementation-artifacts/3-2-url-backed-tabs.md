# Story 3.2: URL-backed tabs

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to link someone straight to a tab,
so that sharing and browser navigation work.

## Position in Epic 3

**2nd of 9. Depends on 3.1** (renders inside `Entity360`'s `tabBar` + `children`
regions). **3.3 depends on this story** (the descriptor-driven `EntityShow` wires a
descriptor's `tabs` array through the router this story builds).

**Scope boundary — read before starting.** Same posture as 3.1: this story builds and
tests the URL-tab mechanism generically. It does **not** register a real resource's
route in `src/components/atomic-crm/root/routeManifest.ts` — that is each entity's own
Epic 5 story (5.1 for `shidduchim`, 5.8 `singles`, 5.9 `shadchanim`, 5.10 `references`).
What it *does* deliver is the router-building helper Epic 5 will call once per entity.

## The routing conflict this story exists to resolve

AD-24's route convention is `/{entity}`, `/{entity}/{id}`, `/{entity}/{id}/{tab}`,
`/{entity}/new`, `/{entity}/{id}/edit` — the bare `/{entity}/{id}` is the record's
**show** page [Source: ARCHITECTURE-SPINE.md#AD-24]. Epic 5 Story 5.1 is explicit about
this for the pilot entity: *"it opens at `/shidduchim/{id}` as a page on the shell …
the routed dialog is deleted."* [Source: epics.md#Story-5.1]

But `ra-core`'s `<Resource>` — the framework component every current resource uses
(AD-10, "ratified from the fork") — hard-wires a **different** shape:
`show && <Route path=":id/show/*" .../>`, `edit && <Route path=":id/*" .../>`
[Source: node_modules/ra-core/src/core/Resource.tsx — the `<Routes>` block]. Under `<Resource>`'s own
routing, `/{entity}/{id}` (no suffix) is the **edit** route, not show. Passing `show`/
`edit`/`create` props to `<Resource>` therefore cannot produce AD-24's shape — every
entity that adopts it needs its **own** nested `<Routes>` instead.

**Resolution (binding for this epic and for every Epic 5 entity migration):** an entity
that has adopted `Entity360` registers **only** a `list` component with
`<Resource>` (via `routeManifest.ts`'s `ResourceEntry.definition = { list: EntityRoutes
}`, nothing else) — `<Resource>`'s `list` route is `path="/*"`, a catch-all
[Source: node_modules/ra-core/src/core/Resource.tsx], so `EntityRoutes` receives
every sub-path and owns routing for `""` (list), `new`, `:id/edit`, `:id`, and
`:id/:tab` itself, matching AD-24 exactly. This story builds that `EntityRoutes`
factory; Epic 5 calls it once per migrated entity and drops the result into
`routeManifest.ts`.

## Acceptance Criteria

1. **A route-building helper produces the AD-24 shape.**
   `src/components/atomic-crm/entity360/entityRoutes.tsx` exports
   `buildEntityRoutes(config: EntityRouteConfig): ComponentType`, where
   `EntityRouteConfig = { List: ComponentType; New?: ComponentType; Edit?: ComponentType;
   Show: ComponentType }`. The returned component renders nested `<Routes>`:
   `index` → `List`; `"new"` → `New` (when present); `":id/edit"` → `Edit` (when
   present); `":id"` → `Show`; `":id/:tab"` → `Show` (same component — the tab is read
   from the URL, not routed to a different element). This is the component a
   `ResourceEntry.definition.list` will be set to once an entity migrates (Epic 5), never
   registered as a real resource by this story.

2. **`Entity360Tabs` reads and writes the `:tab` URL segment.**
   `entity360/Entity360Tabs.tsx` exports a component taking
   `{ tabs: { key: string; label: string; content: ReactNode }[] }`. It reads the current
   tab from `useParams<{ tab?: string }>()` (via `react-router`, matching the rest of the
   app's router — `.claude/rules/web-patterns.md#URL-as-state`), renders the tab bar and
   the active tab's content, and on tab-change calls `navigate` with a path that changes
   only the `:tab` segment (never `:id`). Each tab switch is an ordinary history **push**
   — do not pass `{ replace: true }` — because AC 3 requires browser back/forward to move
   between previously-visited tabs, which needs each switch to be a distinct history
   entry.

3. **The URL is the source of truth, and unknown tabs fall back.** Given a 360 route with
   tabs, switching tabs updates the URL to `/{entity}/{id}/{tab}`; navigating the browser
   back/forward moves between previously-visited tabs; and loading a URL whose `:tab`
   segment does not match any tab in `tabs` renders the **first** tab in the array
   (never a blank screen, never a thrown error) — this is asserted with a fixture tab
   list and a router memory history seeded at an invalid tab path.

4. **Deep-linking works without visiting the list first.** A test mounts
   `Entity360Tabs` directly at a `/{entity}/{id}/{tab}`-shaped memory route (not via a
   click sequence) and asserts the correct tab's content is shown — proving the tab state
   is derived from the URL on mount, not from client-side state that only updates on
   interaction.

5. **Verified with a fixture entity, not a real one.** Tests use a local, in-file fixture
   (`{ key: "overview", ... }`, `{ key: "notes", ... }`) — the same "fixture manifest
   declared inside the test file" pattern Epic 1 Story 1.5 used for
   `routeManifest.test.ts`. No `routeManifest.ts` edit, no real resource route change, is
   part of this story.

## Tasks / Subtasks

- [ ] **Task 1 — `entityRoutes.tsx`** (AC: 1)
  - [ ] Define `EntityRouteConfig` and `buildEntityRoutes` as specified in AC 1, using
        `react-router`'s `Routes`/`Route` directly (not `ra-core`'s `useRouterProvider`
        indirection, since this component is **not** itself a `<Resource>` child — it is
        what a `<Resource>`'s `list` prop points at, so it sits one level below
        `ra-core`'s own routing and needs no `ResourceContextProvider` of its own; that
        context is already established by the enclosing `<Resource name="...">`).
  - [ ] `entityRoutes.test.tsx`: render `buildEntityRoutes({...})()` inside a
        `MemoryRouter` at each of `/`, `/new`, `/1/edit`, `/1`, `/1/overview` and assert
        the right fixture component rendered. One `it` per path (AAA, descriptive names).

- [ ] **Task 2 — `Entity360Tabs`** (AC: 2, 3, 4)
  - [ ] Build the component per AC 2, using `useParams`/`useNavigate` from
        `react-router` (already the app's router — see `simple-list/SimpleListItem.tsx`
        for the existing `useNavigate` import pattern) and shadcn's `Tabs`/`TabsList`/
        `TabsTrigger`/`TabsContent` (`@/components/ui/tabs`) as the visual primitive —
        already used this way in `references/ReferenceShow.tsx:131-167`; do not
        introduce a second tabs UI library or hand-roll tab markup.
  - [ ] Implement the "unknown tab falls back to first" rule and the deep-link-on-mount
        behaviour.
  - [ ] `Entity360Tabs.test.tsx`: one `it` for tab-click updates the URL, one for
        browser back/forward across two tab visits, one for the unknown-tab fallback, one
        for the direct deep-link mount (AC 3, 4).

- [ ] **Task 3 — Wire into `Entity360`** (AC: none new — integration only)
  - [ ] `Entity360`'s `tabBar` region (3.1) is where `Entity360Tabs`'s tab strip renders
        and its `children` region is where the active tab's content renders — confirm
        with a small integration test that mounting `Entity360Tabs`'s two halves inside
        `Entity360`'s two regions preserves the AC-1 region order from 3.1. This does not
        change `Entity360.tsx` itself; it is a consumption test only.

## Dev Notes

### The `<Resource>` routing fact this story is built on

`Resource.tsx`'s routes, condensed (elements elided, order and paths exact):
```js
create && <Route path="create/*" .../>
show && <Route path=":id/show/*" .../>
edit && <Route path=":id/*" .../>
list && <Route path="/*" .../>
```
[Source: node_modules/ra-core/src/core/Resource.tsx]. Passing only `list` makes
every sub-path fall through to it, because `path="/*"` is the last-declared, most
permissive match and nothing else is registered to compete with it. This is not a hack —
it is the documented, supported way to fully own a resource's routing in this framework;
`ra-core` offers no per-`<Resource>` way to override the `show`/`edit` path templates
themselves.

### `useCreatePath` does not produce the AD-24 shape either — flag for 3.9/Epic 5

`useCreatePath({ resource, id, type: "show" })` is hardcoded to
`` `${basename}/${resource}/${id}/show` `` [Source:
node_modules/ra-core/src/routing/useCreatePath.ts:68-77] — it cannot be reconfigured to
emit the bare `/{resource}/{id}` shape. Story 3.9 (`RecordLink`) therefore does **not**
build its href from `useCreatePath`; it resolves the path from the entity descriptor
registry (3.3), and each entity's descriptor updates its own path template exactly once,
when Epic 5 migrates that entity onto `buildEntityRoutes`. This story does not need to
do anything about it beyond this note — it is recorded here because this is where the
underlying framework fact was discovered, and 3.9 cites this section rather than
re-deriving it.

### Why tabs are a route param, not local state

`.claude/rules/web-patterns.md#URL-as-state`: *"Persist shareable state in the URL:
… active tab … If refreshing the page should restore the state, it belongs in the
URL."* The existing `references/ReferenceShow.tsx` tab implementation
(`Tabs defaultValue="conversations"`) is exactly the anti-pattern this story replaces:
local `useState`-backed tabs that reset on refresh and cannot be deep-linked. This story
does not edit `ReferenceShow.tsx` — per the epic's scope boundary, that migration is
Epic 5 Story 5.10's.

### Testing standard

AAA, descriptive names, isolated fixtures per `.claude/rules/testing.md`. Runs in the
`app` vitest project. Use React Testing Library + `MemoryRouter` (already the pattern
implied by the app's `react-router` usage throughout `atomic-crm/`) — no new test
tooling. No backend, RLS or migration surface in this story.

### Project Structure Notes

- `entity360/entityRoutes.tsx` and `entity360/Entity360Tabs.tsx` sit beside
  `Entity360.tsx` from 3.1. Keep each under the typical 200-400 line ceiling
  [Source: .claude/rules/coding-style.md] — the two concerns (route building vs. tab-bar
  UI/URL-sync) are separate files on purpose, not one "tabs" mega-file.
- English-only in all new files and comments.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.2]
- [Source: ARCHITECTURE-SPINE.md#AD-24] — the route shape this story implements
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.1] — "it opens at
  `/shidduchim/{id}` as a page on the shell … the routed dialog is deleted" — the
  concrete downstream requirement that makes the bare `/{entity}/{id}` shape non-optional
- [Source: node_modules/ra-core/src/core/Resource.tsx] — `<Resource>`'s hard-wired
  routing, the conflict this story resolves
- [Source: node_modules/ra-core/src/routing/useCreatePath.ts:39-84] — the hardcoded
  `.../show` path builder, flagged for 3.9
- [Source: src/components/atomic-crm/references/ReferenceShow.tsx:131-167] — the
  existing (non-URL-backed) tabs implementation this pattern supersedes, migrated by
  Epic 5 not this story
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md#Dev-Notes §4,
  Task 6] — the scope boundary ("do not restructure routes" is Epic 3/4/5's, not 1.5's)
  and the in-test-fixture pattern this story's tests follow
- [Source: .claude/rules/web-patterns.md#URL-as-state]
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
