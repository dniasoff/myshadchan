# Story 3.4: Permission-aware rendering

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want tabs to respect the viewer's role in the **active context**,
so that one 360 can safely serve a parent, a single, a helper and a shadchan.

## Position in Epic 3

**Step 6** in the Epic 3 canonical API contract §12 build order. (That table lists 13 steps; the file set is 14 stories — 3.12 and 3.13 were split out after §12 was written, so cite step numbers, not totals.)

**Blocking dependencies — this story cannot start until all five are merged:**

| Dependency | What this story consumes from it |
|---|---|
| **3.10** (shared tab vocabulary) — file `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`; the Epic 3 contract's build order calls this same story **3-13**, and sibling stories 3.2/3.3 cite it under that label | the closed `TabKey` union and `TAB_LABELS`, so fixture tabs use real keys (`overview`, `medical`) rather than free strings |
| **3.1** (`Entity360` shell) | the `tabBar` / `children` regions the filtered tabs render into |
| **3.3a** (descriptor types + registry) | `EntityTabDescriptor.visibleTo?: MemberRole[]` and `registerEntityDescriptor(d, { replace: true })` |
| **3.2** (`buildEntityRoutes`, `Entity360Tabs`) | the `:id/:tab` route, `ShowBase`, and the unknown-tab fallback AC 6 reuses |
| **3.3b** (`EntityShow`) | the one place the tab array is assembled — this story filters it there |

**Not a dependency:** 3.9, 3-14, 3.5–3.8 (all land after this story or beside it).

**Downstream consumers:** 5.5 (Medical tab, the one tab in Epics 4–11 that declares a
`visibleTo`), 6.1, 6.3, 6.4 and 8.5 import `useViewerRole()` / `hasVisibility()` rather than
building a second role check.

**Epic 2 has landed.** `my_contexts()` is live
[Source: supabase/schemas/02_functions.sql:341-354], `current_context_id()` is live
[Source: supabase/schemas/02_functions.sql:201], `MemberRole` is a shipped five-value union
[Source: src/components/atomic-crm/types.ts:109-110], and the client already has a cached
reader for it [Source: src/components/atomic-crm/root/useMyContexts.ts:12-18]. There is no
cross-epic gap here and nothing to escalate: this story builds `useViewerRole()` against the
real data source, now.

## Acceptance Criteria

1. **One visibility vocabulary: `visibleTo`, on tabs only, typed by the shipped
   `MemberRole`.** After this story, `EntityTabDescriptor` carries exactly one visibility
   field — `visibleTo?: MemberRole[]` (an **allow-list**; absent means "visible to every
   role") — and `EntityDescriptor` itself carries none. `MemberRole` is imported from
   `src/components/atomic-crm/types.ts:109-110`; no union of role literals is written
   anywhere under `entity360/`. The name `minVisibility` does not exist:
   `grep -rn "minVisibility" src/` returns zero hits.
   **Falsifiable by typecheck**, in `entity360/visibility.types.test.ts`:
   (a) `const _exhaustive: Record<MemberRole, true> = { parent_admin: true, helper: true,
   self_manager: true, shadchan: true, single: true };` — fails if a sixth role is added and
   this story's tables are not updated with it;
   (b) a `// @ts-expect-error` line asserting `{ name, buildRecordPath, label, visibleTo: [] }`
   is **not** assignable to `EntityDescriptor` — the directive itself becomes an error the
   moment someone adds region-level gating to the descriptor, which is out of scope (Dev
   Notes, "The `epics.md` 'field' half").

2. **`hasVisibility` is a pure function and its whole truth table is pinned, including the
   two edge rows.** `entity360/visibility.ts` exports
   `hasVisibility(visibleTo: MemberRole[] | undefined, role: MemberRole | undefined): boolean`
   with **no** hook, no import from `react`, and these results, checked in this order:

   | `visibleTo` | `role` | result | why |
   |---|---|---|---|
   | `undefined` | any of the five | `true` | absent = unrestricted |
   | `undefined` | `undefined` | **`true`** | an *unrestricted* tab is not a restricted one; the fail-closed rule below governs restricted tabs only |
   | `[]` | any of the five, or `undefined` | **`false`** | an allow-list with no entries allows nobody |
   | `["helper"]` | `"helper"` | `true` | |
   | `["helper"]` | any other role | `false` | |
   | `["helper"]` | `undefined` | `false` | fails closed |
   | `["helper","single"]` | `"single"` | `true` | |

   `visibility.test.ts` drives the full cartesian product with `it.each` over a locally
   declared `ALL_MEMBER_ROLES` tuple, guarded by AC 1(a)'s exhaustiveness record so a sixth
   role cannot be silently skipped. Flipping any single return value fails at least one row.

3. **`useViewerRole()` resolves the role of the *active* context from `my_contexts()`, and is
   the only role source inside `entity360/`.** `entity360/useViewerRole.ts` exports
   `useViewerRole(): { role: MemberRole | undefined; isPending: boolean }`, implemented as
   `pickActiveRole(useMyContexts().data)` plus that query's `isPending`
   [Source: src/components/atomic-crm/root/useMyContexts.ts:12-18]. The selector
   `pickActiveContext` / `pickActiveRole` lives in
   `src/components/atomic-crm/providers/commons/roleAuthority.ts` — the established home for
   client-side `MemberRole` predicates [Source: src/components/atomic-crm/providers/commons/roleAuthority.ts:1-59]
   — so this hook and AC 8's two authProviders cannot diverge on what "active" means.
   `useViewerRole.test.tsx` (`app` project; the harness is
   `layout/ContextSwitcher.test.tsx:59-87` — `TestMemoryRouter` + `CoreAdminContext` + a
   `QueryClient` seeded on `MY_CONTEXTS_QUERY_KEY`) asserts:
   - **one login, two contexts** (never two disjoint users): household `parent_admin`
     `is_active: true` + shadchanus `shadchan` `is_active: false` → `role === "parent_admin"`;
   - the **same login**, cache reseeded with the two flags swapped — exactly what
     `switchActiveContext()` + `invalidateQueries()` produce
     [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:94-98] → `role ===
     "shadchan"`. A hook that read a per-login signal instead of the active context returns
     the same value for both and fails here;
   - no row has `is_active: true` (the revoked-membership case: `current_context_id()` returns
     NULL, [Source: supabase/schemas/02_functions.sql:201]) → `{ role: undefined, isPending:
     false }`;
   - query in flight → `{ role: undefined, isPending: true }`;
   - query rejected → `{ role: undefined, isPending: false }` and the hook does not throw.

4. **A source guard proves the seam, and is shown red before it is shown green.**
   `entity360/roleSource.guard.test.ts` scans `entity360/` with
   `import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })` —
   the one in-repo precedent
   [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — and
   asserts that inside `entity360/`: `useMyContexts` appears only in `useViewerRole.ts`, and
   `administrator` and `useGetIdentity` appear **nowhere**. The matcher is an exported pure
   function `findForbiddenRoleSources(files: Record<string, string>): string[]`, and the same
   test file asserts it returns a non-empty result for the synthetic fixture
   `{ "./Bad.tsx": "const { identity } = useGetIdentity();" }`. A guard that cannot fail is
   not coverage.

5. **A tab whose `visibleTo` excludes the viewer is absent from the DOM and its `render` is
   never called.** `EntityShow` (3.3b) filters `descriptor.tabs` through
   `hasVisibility(tab.visibleTo, role)` and passes only the survivors to
   `<Entity360Tabs tabs={visibleTabs} />`. **`Entity360Tabs` does no permission work**;
   because `render` is lazy (`() => ReactNode`, no argument), a filtered-out tab's subtree is
   never constructed. `EntityShow.permissions.test.tsx`, with a **test-only** descriptor
   registered via `registerEntityDescriptor(fixture, { replace: true })` (no test depends on
   an Epic 5 descriptor), two tabs — `overview` (no `visibleTo`) and `medical`
   (`visibleTo: ["parent_admin"]`) — each `render` a distinct `vi.fn()`, viewer `helper`:
   - `await expect.element(screen.getByRole("tab", { name: "Medical" })).not.toBeInTheDocument()`
   - `container.textContent` contains neither the label `"Medical"` nor the body text the
     restricted `render` would have produced
   - the restricted `vi.fn()` has **zero** calls; the open one has at least one
   - the same fixture with viewer `parent_admin`: the Medical tab is in the tab bar and, once
     selected, its `vi.fn()` has at least one call
   - `Entity360Tabs` rendered **directly** with the restricted tab already in its `tabs` prop,
     viewer `helper` → the tab renders. This pins "the filtering lives in `EntityShow`, not in
     `Entity360Tabs`" and fails if someone adds a second check inside the renderer.

6. **A role-restricted URL is indistinguishable from an unknown-tab URL, and a *pending* role
   never navigates.** Three separate, non-overlapping behaviours:
   - **(a) Pending.** While `useViewerRole().isPending` is `true`, `EntityShow` renders the
     identity header and stat band normally but renders a pending region in place of the tab
     bar and tab content — its label goes through the i18n provider,
     `translate("crm.entity360.role_pending", { _: "Loading your access…" })`, following
     [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:69]. Because
     `Entity360Tabs` is not mounted at all, 3.2's unknown-tab fallback cannot run. This is
     belt-and-braces with 3.2's own AC 7 (`tabs={[]}` renders nothing and never navigates),
     which stays the safety net for the *other* empty-array case this story produces: a
     record whose every tab is restricted from a viewer whose role **has** resolved. Test:
     deep-link
     `initialEntries={["/{fixture}/1/medical"]}` with a `getMyContexts` that never settles;
     the `TestMemoryRouter` `locationCallback` records **exactly one** location and
     `pathname` is still `/{fixture}/1/medical`; the identity header text **is** present and
     `screen.getByRole("tablist")` is **not**. Then settle the query to `parent_admin`: the
     Medical tab renders, `pathname` is unchanged, and the callback has recorded no
     additional location.
   - **(b) Denied ≡ unknown.** With the role settled to `helper`, the rendered result for
     `/{fixture}/1/medical` and for `/{fixture}/1/no-such-tab` are equal on all three
     observables: same final `pathname` (`/{fixture}/1/overview`), same set of accessible tab
     names in the tab bar, and — in both — `container.textContent` matches
     `/denied|permission|forbidden|not allowed/i` **zero** times. There is no second
     "access denied" branch, and the URL never confirms that a tab the viewer cannot see
     exists.
   - **(c) The fallback replaces, it does not push.**
     `initialEntries={["/", "/{fixture}/1/medical"]} initialIndex={1}`, viewer `helper`. After
     the fallback settles the pathname is `/{fixture}/1/overview`; a probe component inside
     the router that calls `navigate(-1)` then lands on `/`. With `push` it would land back on
     `/{fixture}/1/medical` and loop.

7. **The five-role negative sweep required by `.claude/rules/security-triggers.md`.** One
   `it.each` over `ALL_MEMBER_ROLES` (AC 2's tuple). Fixture: one open tab (`overview`) plus
   five restricted tabs, one per role (`visibleTo: [thatRole]`), each `render` a distinct
   `vi.fn()`. For every viewer role R:
   - the tab bar contains exactly two tabs: `overview` and R's;
   - the other four labels are absent from `container.textContent`;
   - the other four `vi.fn()`s have zero calls.

   Plus a sixth row that is **not** the pending case: the query settles with **no active
   context** (`isPending === false`, `role === undefined`) → only `overview` renders, all five
   restricted `vi.fn()`s have zero calls, and no navigation occurs beyond 3.2's normal
   `:id` → first-tab resolution. (AC 6(a) covers `isPending === true`; these are two distinct
   states and both are pinned.)

8. **`providers/commons/canAccess.ts` is rewritten onto `MemberRole`; `members.administrator`
   stops being an authorization input on the client.** Today it is a binary `"admin"`/`"user"`
   check [Source: src/components/atomic-crm/providers/commons/canAccess.ts:10-26], fed by
   `member.administrator` in both providers
   [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:145-153]
   [Source: src/components/atomic-crm/providers/fakerest/authProvider.ts:65-74]. AD-2 forbids
   exactly this — *"Authorization derives from membership role in the active context (AD-19),
   never a hardcoded flag"*
   [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:62-66].
   Story 2.7 deliberately left it for "Epic 3/6's `useViewerRole` work"
   [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md:261-264];
   this story is that owner. After this story:
   - `canAccess(role: MemberRole | undefined, params: CanAccessParams): boolean` with exactly
     three rules: `role === undefined` → `false` (fail closed, for every resource);
     `params.resource === "members"` → `canManageMembers(role)`; otherwise → `true`.
   - `canManageMembers` is a **new, separately named** predicate in
     `providers/commons/roleAuthority.ts`, allowing `parent_admin | self_manager | shadchan`.
     It is **not** aliased to `isInviteCapableRole` even though the two sets coincide today —
     that file's own header documents the convention that distinct questions keep distinct
     predicates [Source: src/components/atomic-crm/providers/commons/roleAuthority.ts:30-36] —
     and it is **not** `is_owning_membership_role()`, which is `parent_admin | self_manager`
     only and is a *household-persona* predicate
     [Source: supabase/schemas/02_functions.sql:434-444]; a shadchanus context contains no
     household role at all [Source: supabase/schemas/02_functions.sql:411-432].
   - both providers resolve the role from the active context:
     `pickActiveRole((await getSupabaseClient().rpc("my_contexts")).data)` in the Supabase
     provider, `pickActiveRole(await dataProvider.getMyContexts())` in the FakeRest one (which
     already imports `dataProvider`
     [Source: src/components/atomic-crm/providers/fakerest/authProvider.ts:5]).
   - **the resolved role is never written to `localStorage`.** `CURRENT_MEMBER_CACHE_KEY` is
     cleared only on logout [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:26,65-68]
     and would survive a context switch, silently freezing the role. Concurrent checks are
     deduped by a **module-scoped in-flight promise only**, released when it settles.

   Tests (`app` project; the Supabase provider is mocked with the established
   `vi.hoisted` + `vi.mock("./supabase")` pattern
   [Source: src/components/atomic-crm/providers/supabase/authProvider.test.ts:1-27], extended
   with an `rpc` spy):
   - `canAccess.test.ts`: table-driven, 5 roles × `{resource:"members"}` /
     `{resource:"shidduchim"}`, plus the two `role: undefined` rows. `helper` and `single` are
     denied `members`; `parent_admin`, `self_manager` and `shadchan` are allowed; every role is
     allowed `shidduchim`; `undefined` is denied both.
   - **the flag no longer decides**, asserted behaviourally in both providers: with
     `members.administrator === true` but the active-context role `helper`,
     `authProvider.canAccess({ resource: "members", action: "list" })` is `false`; with
     `administrator === false` but the active-context role `parent_admin`, it is `true`.
   - **one RPC per burst**: five concurrent `canAccess` calls issue exactly one `my_contexts`
     RPC; a sixth call started *after* those settle issues a second one (proving there is no
     cross-time cache).

9. **This story changes no server-side authorization, and says where the server half stands.**
   The diff touches **no file under `supabase/`** — no migration, no policy, no edge function
   (`git diff --name-only` against the story's base contains zero `supabase/` paths). Two
   consequences are stated as fact, not deferred silently:
   - reads of `public.members` are already RLS-scoped to the caller's **active context**
     [Source: supabase/schemas/05_policies.sql:18-29], so widening the client gate from a
     per-login flag to an active-context role cannot expose a foreign account's members;
   - **member *writes* are still authorized on `members.administrator`** by the users edge
     function [Source: supabase/functions/users/index.ts:66-67,98-99,126-129]. After this
     story the client gate and the server gate use different axes: a `parent_admin` who is not
     an `administrator` reaches the Members list and has their update refused server-side. This
     is a **recorded, owner-visible divergence**, not an oversight — see Dev Notes, "Flagged to
     the epic owner", item 1.

## Tasks / Subtasks

- [ ] **Task 1 — `entity360/visibility.ts`** (AC: 1, 2)
  - [ ] Implement `hasVisibility` exactly as the AC 2 table specifies, in that order:
        `visibleTo === undefined` → `true`; then `role === undefined` → `false`; then
        `visibleTo.includes(role)`. (`[]` falls out of the third rule as `false`.)
  - [ ] `visibility.test.ts` — `it.each` over the full cartesian product, driven by
        `ALL_MEMBER_ROLES`.
  - [ ] `visibility.types.test.ts` — the `Record<MemberRole, true>` exhaustiveness record and
        the `@ts-expect-error` assertion that `EntityDescriptor` has no `visibleTo`.
  - [ ] Add **no** descriptor field. 3.3a already ships
        `EntityTabDescriptor.visibleTo?: MemberRole[]`
        [Source: _bmad-output/implementation-artifacts/3-3-entity-descriptor-registry.md:141,147];
        this story ships only the *enforcement*. If that field has drifted by the time this
        ticket is picked up, restore it there — do not add a second one here.

- [ ] **Task 2 — the shared active-context selector** (AC: 3)
  - [ ] Add `pickActiveContext(contexts: MyContext[] | undefined): MyContext | undefined` and
        `pickActiveRole(contexts): MemberRole | undefined` to
        `providers/commons/roleAuthority.ts`, with a header comment naming its three consumers.
  - [ ] Adopt `pickActiveContext` at `settings/InvitesSection.tsx:119`, which hand-rolls the
        same `find(c => c.is_active)` today. **Do not** change
        `layout/ContextSwitcher.tsx:65` — its `?? contexts[0]` display fallback is deliberately
        different (see Dev Notes).

- [ ] **Task 3 — `entity360/useViewerRole.ts`** (AC: 3, 4)
  - [ ] Implement the hook over `useMyContexts()` + `pickActiveRole`. No `useGetIdentity`, no
        `members.administrator`, no `localStorage`.
  - [ ] `useViewerRole.test.tsx` — the five cases in AC 3, on the `ContextSwitcher.test.tsx`
        harness.
  - [ ] `roleSource.guard.test.ts` — the `?raw` scan, with `findForbiddenRoleSources` proven
        red against the synthetic broken fixture in the same file.

- [ ] **Task 4 — Wire filtering and the pending region into `EntityShow`** (AC: 5, 6, 7)
  - [ ] In `entity360/EntityShow.tsx`: call `useViewerRole()`; while `isPending`, render the
        i18n-backed pending region in place of `tabBar`/`children`; otherwise pass
        `descriptor.tabs.filter(t => hasVisibility(t.visibleTo, role))` to `Entity360Tabs`.
  - [ ] Add **no** permission code to `entity360/Entity360Tabs.tsx`. 3.2's unknown-tab
        fallback already resolves "first visible tab" correctly once the array is pre-filtered
        — verify, do not add a second fallback path.
  - [ ] `EntityShow.permissions.test.tsx` — AC 5, AC 6 and AC 7. Register the fixture
        descriptor under a test-only resource name with `{ replace: true }`; stub the
        dataProvider's `getOne` so `ShowBase` resolves a record.

- [ ] **Task 5 — Rewrite `canAccess` onto `MemberRole`** (AC: 8, 9)
  - [ ] `providers/commons/roleAuthority.ts`: add `canManageMembers`.
  - [ ] `providers/commons/canAccess.ts`: new signature and the three rules.
  - [ ] `providers/supabase/authProvider.ts` (`:145-153`): resolve the role via
        `rpc("my_contexts")` + `pickActiveRole`, behind the module-scoped in-flight promise.
        Leave `getMember()` and its cache alone — they still serve `getIdentity`.
  - [ ] `providers/fakerest/authProvider.ts` (`:65-74`): the same, via
        `dataProvider.getMyContexts()`.
  - [ ] `canAccess.test.ts` + the two provider behavioural tests + the one-RPC-per-burst test.
  - [ ] Verify no `supabase/` file is touched.

## Dev Notes

### The `epics.md` "field" half — an explicit, recorded scope reduction

`epics.md`'s Story 3.4 AC is *"the field or tab is absent from the rendered output and from
the DOM **and** the underlying data was never sent to the client"*
[Source: _bmad-output/planning-artifacts/epics.md:506-510]. This story delivers:

- **the tab half, completely** — a filtered-out tab's label never enters the DOM and its
  `render` is never invoked, so no query inside it is ever issued (AC 5). That is the
  client-side meaning of "never sent";
- **the reusable primitive** — `hasVisibility` and `useViewerRole` are exported so the stories
  that own genuinely sensitive data import them instead of building a second check.

It **does not** deliver field-level or region-level gating, and deliberately adds no
`visibleTo` to `EntityDescriptor` (AC 1(b)). Two reasons, both structural:

1. There is no `stats?: (record) => …` array left to gate. The descriptor's stat surface is a
   `statBand?: ComponentType<{record}>` that owns its own query; gating a rendering of a record
   the client already holds proves nothing about what was sent.
2. "The underlying data was never sent" is an **RLS** guarantee (AD-1
   [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:57-60]),
   and it is delivered where the sensitive data actually lives: Story 5.5 (Medical tab) and
   Story 6.3 (field-level scoping for a single), each with its own database-layer negative
   test. Epic 3 is machinery; it owns no sensitive column.

**This reduction is ratified in the AC, not buried in a note** — AC 1(b) makes it a
typecheck-enforced boundary, so a later story cannot quietly add region gating here and call
`epics.md`'s AC satisfied without the RLS half.

**Known gap, recorded:** `EntityRelationshipDescriptor` (the `relationships` field rendered by
`RelatedRecordsTab`) has no `visibleTo`, so relationship-derived tabs are visible to every
role. No consumer in Epics 4–11 needs one. **Trigger to revisit:** the first relationship whose
target rows are not already readable by every role in the active context.

### Why `useViewerRole` reads `my_contexts()` and not `members.administrator`

`members.administrator` is a **global, per-login** boolean — one row per `user_id`
[Source: supabase/schemas/01_tables.sql:14-25] — with no relationship to
`account_members.role`. A login that holds a household membership and a shadchanus membership
would get the same role in both, which is the precise multi-context case Epic 2 exists to
support, and `self_manager` and `single` would be **unreachable**, silently dead-coding
`5-5:86`'s Medical-tab declaration and 6.1/6.4's `single` branches. `getIdentity` does not even
expose it [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:9-22]. The
correct source is the active row of `my_contexts()`
[Source: supabase/schemas/02_functions.sql:341-354], whose `is_active` is
`account_members.account_id = current_context_id()` — a server-side row, never a client claim
(AD-19 [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:148-151]).

**Cache freshness comes for free.** `useMyContexts` is a `["myContexts"]` React Query entry
[Source: src/components/atomic-crm/root/useMyContexts.ts:10-18], and a context switch
invalidates **every** query before navigating
[Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:94-101]. Do not add a second
cache, and above all do not put the role in `localStorage`.

**One deliberate non-change:** `ContextSwitcher.tsx:65` resolves the active context as
`contexts.find(c => c.is_active) ?? contexts[0]`. `useViewerRole` has **no** such fallback — a
login with no active membership has no role, and must fail closed rather than borrow the first
context's. The switcher's fallback is display-only (it names a pill). Leaving them different is
intentional; do not "unify" them.

### Two consumers of one role vocabulary — and why `canAccess` is still a separate question

After this story the role is resolved in exactly two places, both through `pickActiveRole`:
`useViewerRole()` for React trees, and the two authProviders' `canAccess` for `ra-core`'s
`useCanAccess` / `<CanAccess>` seam
[Source: src/components/atomic-crm/layout/TopBar.tsx:41-43]
[Source: src/components/admin/app-sidebar.tsx:133-150].

They answer **different questions** and must stay separate implementations:
`canAccess` answers *"may this role perform this action on this resource"*; `hasVisibility`
answers *"may this role see this tab of this record"*. **Do not route `visibleTo` checks
through `canAccess`, and do not add a resource/action concept to `hasVisibility`.** What this
story unifies is the *input* (one role, from one source), not the two policies.

Both authProvider `canAccess` implementations are already `async` and already fail closed when
no member resolves (`:148` / `:69`), so the flicker while the role resolves — a sidebar item
appearing a beat late — is pre-existing behaviour of that seam, not something this story
introduces. `app-sidebar.tsx:150` renders `null` until `canAccess` is truthy.

### The five roles, and where each one comes from

`parent_admin | helper | self_manager | shadchan | single`
[Source: src/components/atomic-crm/types.ts:109-110], matching the database constraint
[Source: supabase/schemas/01_tables.sql:153-155] and AD-2
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:62-66].
All five are live today; `single` is **already** in the check constraint — there is no
"ahead of the schema" caveat to carry.

`shadchan` is the only role a shadchanus-kind account may contain, and every other role
requires a household-kind account
[Source: supabase/schemas/02_functions.sql:411-432]. That is why `canManageMembers` includes
`shadchan`: excluding it would leave a shadchanus context with no role able to manage its own
people, and Epic 8.5 is built on that context.

### Testing standard

`app` vitest project — **`vitest-browser-react` in real Chromium with `TestMemoryRouter` from
`ra-core`**. React Testing Library is not a dependency; there is no `screen.queryByText` and no
`MemoryRouter`. The negative idiom is
`await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`
[Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,95,210]; `render()`
returns `container`, so `container.textContent` assertions work
[Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:59-87].

AAA, no `waitForTimeout`, `it.each` for the role sweeps, ≥80% coverage on new code
[Source: .claude/rules/testing.md]. Every cross-context assertion is **one login with two
memberships**, never two disjoint users — two disjoint users pass without ever exercising
`current_context_id()`.

Validation commands — **there is no `Makefile`**: `npm run typecheck`, `npm run test:unit:app`,
`npm run lint` [Source: package.json:6-20]. This story touches no SQL, so
`npm run test:unit:db` is not in its gate (AC 9).

### Security review

This diff rewrites an authorization seam (`providers/commons/canAccess.ts` and both
authProviders) and adds a gating primitive. Dispatch SECURITY-REVIEWER
[Source: .claude/rules/security-triggers.md], even though no RLS policy changes here (AC 9).

### Project Structure Notes

`entity360/visibility.ts` and `entity360/useViewerRole.ts` are new, small, single-purpose
files — do not fold either into `entityDescriptor.ts` or `EntityShow.tsx`
[Source: .claude/rules/coding-style.md]. The file is named `visibility.ts`, not
`entityPermissions.ts`.

`useViewerRole.ts` importing `../root/useMyContexts` and `../providers/commons/roleAuthority`
is expected and allowed: 3.3b's `?raw` boundary test is scoped to `EntityShow.tsx` alone and
targets *entity* folders, not framework infrastructure.

`src/components/atomic-crm/entity360/` does not exist on `main` — every file this story names
under it is created by 3.1 / 3.2 / 3.3a / 3.3b before this story starts.

### Flagged to the epic owner

1. **Server-side member-write authorization still reads `members.administrator`**
   [Source: supabase/functions/users/index.ts:66-67,98-99,126-129]. This story owns the client
   half only (AC 8/AC 9). The residual is the server half of the "five-value role has a DB
   half and no client half" gap. **Recommended follow-up:** have `users/index.ts` authorize on
   the caller's active-context role instead. **Trigger:** before Story 6.4, or before any
   story adds a second write path to `members` — whichever is first.
2. **Story 6.4's Task 4 ("rewrite `entity360/useViewerRole.ts` to resolve the role from the
   RPC") is now a duplicate.** `useViewerRole` ships correct here. 6.4's Task 4 should be
   reduced to a **verification** that the hook returns `single` for a `single`-role membership.
3. **Story 5.5's "provisional hook" language is stale.** `5-5:107` and `5-5:157` describe
   `useViewerRole()` as a stand-in mapping the legacy admin flag; after this story it is the
   real thing, and `5-5:86`'s `["parent_admin","self_manager"]` declaration must be renamed
   from `minVisibility` to `visibleTo` (AC 1).
4. **`canManageMembers` widens who sees the Members list** from "the login flagged
   `administrator`" to "any owning role in the active context". This is the AD-2-mandated
   direction and cannot leak across accounts (AC 9, first bullet), but it is a visible
   behaviour change on a live production surface. Confirm.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:498-510] — Story 3.4's epic-level AC
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:57-60] — AD-1, the RLS half this story structurally cannot cover
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:62-66] — AD-2, the five-role vocabulary and "never a hardcoded flag"
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:148-151] — AD-19, `current_context_id()` as a server-side row
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180] — AD-24, "tabs declare a minimum visibility; the shell omits what the viewer may not see"
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172] — UX-DR5, the per-entity tab matrix (the design source of truth for tabs; **not** the mockup)
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187] — UX-DR11, empty/loading/error states, which AC 6(a)'s pending region satisfies
- [Source: src/components/atomic-crm/types.ts:109-110] — `MemberRole`, the one union; never re-declared
- [Source: src/components/atomic-crm/types.ts:165-171] — `MyContext`, the `my_contexts()` row type
- [Source: src/components/atomic-crm/root/useMyContexts.ts:10-18] — `useMyContexts` and `MY_CONTEXTS_QUERY_KEY`
- [Source: supabase/schemas/02_functions.sql:341-354] — `my_contexts()`, `is_active` at `:350`
- [Source: supabase/schemas/02_functions.sql:201] — `current_context_id()`, NULL when there is no live active membership
- [Source: supabase/schemas/02_functions.sql:411-432] — `enforce_membership_role_matches_context()`: `shadchan` ⇔ shadchanus, every other role ⇔ household
- [Source: supabase/schemas/02_functions.sql:434-444] — `is_owning_membership_role()`, the household-persona predicate `canManageMembers` is deliberately not
- [Source: supabase/schemas/01_tables.sql:14-25] — `public.members`, `administrator` at `:19`, one row per `user_id`
- [Source: supabase/schemas/01_tables.sql:153-155] — `account_members_role_check`, all five roles present today
- [Source: supabase/schemas/05_policies.sql:18-29] — members SELECT is already scoped to the active context
- [Source: supabase/functions/users/index.ts:66-67,98-99,126-129] — the server-side `administrator` check this story does not touch
- [Source: src/components/atomic-crm/providers/commons/canAccess.ts:10-26] — the binary check this story replaces
- [Source: src/components/atomic-crm/providers/commons/roleAuthority.ts:1-59] — the established home for client-side `MemberRole` predicates and its "do not merge predicates" convention
- [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:9-22,26,65-68,145-153] — `getIdentity`, the localStorage member cache, and `canAccess`
- [Source: src/components/atomic-crm/providers/supabase/authProvider.test.ts:1-27] — the `vi.hoisted` + `vi.mock("./supabase")` pattern AC 8's tests extend
- [Source: src/components/atomic-crm/providers/fakerest/authProvider.ts:5,65-74] — the FakeRest mirror, which already imports `dataProvider`
- [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:65,94-101] — the display-only `?? contexts[0]` fallback, and switch → invalidate-everything → navigate
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,59-87,95,210] — the browser-mode test harness and the negative idiom
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the only in-repo `?raw` source-scan precedent
- [Source: src/components/atomic-crm/settings/InvitesSection.tsx:119] — the hand-rolled `find(is_active)` Task 2 replaces
- [Source: src/components/atomic-crm/layout/TopBar.tsx:41-43] — `<CanAccess resource="members" action="list">`
- [Source: src/components/admin/app-sidebar.tsx:133-150] — `useCanAccess`, the other consumer of the seam
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md:261-264] — 2.7 deliberately deferring `canAccess.ts` to this work
- [Source: package.json:6-20] — the real validation commands
- [Source: .claude/rules/security-triggers.md], [Source: .claude/rules/testing.md], [Source: .claude/rules/coding-style.md], [Source: .claude/rules/english-only.md]

The Epic 3 canonical API contract (§0 global corrections, §2 descriptor shape, §6 tabs &
visibility, §10 ownership, §12 build order, §13 test shapes) is the binding shape document for
this epic; it is a planning artefact held by the epic owner and is not a repo path at time of
writing, so its rules are restated inline above rather than cited by path.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
