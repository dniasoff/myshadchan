# Story 8.5: The shadchan's own CRM

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want to see my connections and my conversations on the same shell everyone else uses,
so that I can do my work here instead of falling back to a notebook.

## Position in Epic 8

**5th (last) of 5.** Depends on **8.1** (the shadchanus nav/dashboard shell, the
`RequireContextKind` guard and the manifest `contextKind` field), **8.2** (the connection
workflow), and **8.3** (the redt-compose dialog and the connection-scoped thread it mirrors).
This story wires all three into a real descriptor-based CRM and **replaces both of Story
8.1's placeholders** — the dashboard body and the `/connections` placeholder route.

## Acceptance Criteria

1. **A Connections list, built from the standard framework, not a bespoke screen.** A new
   `connections` resource declares a descriptor (label, icon, route, avatar, title, meta,
   relationships — AD-24) and renders through the same `EntityList` every other entity uses:
   search, the List/Cards toggle, URL-held state, empty/loading/error. No hand-rolled list
   component.
2. **A Connection 360, on the same shell as everything else.** Opening a connection renders
   `Entity360` with the fixed region order (breadcrumb → identity header → stat band → alert
   slot → tab bar → content → optional right rail). The identity header shows the connected
   household's account name and connection status (accepted / ended, with the end date if
   ended); the stat band shows at minimum the count of redts sent through this connection —
   **derived from the connection-scoped threads Story 8.3 mirrors, never from the household's
   `redts` or `inbox_items`** (structurally unreachable to the shadchan, AD-20/Story 8.4).
3. **Threads are a tab, not a destination.** The Connection 360's tab set is
   `overview, discussions` — the canonical Connection tab set and order (contract §3 rule 5).
   The tab **key** is `discussions`, label "Discussions", taken from the closed `TabKey` union
   in `entity360/tabKeys.ts`; `conversations` is a **different, non-interchangeable** key
   reserved for the reference **call log** (5.10), and using it here does not express what this
   tab is (contract §3, drift-closing ruling table: one key `discussions` for every Epic 7
   `threads/ThreadPanel.tsx` surface). The `discussions` tab lists the connection's threads,
   reusing Epic 7's `threads/ThreadPanel.tsx`
   (7.1, extended by 7.3) — no second chat UI; this is the only place a shadchan reaches a
   thread from, consistent with UX-DR8's "reached from its parent, not primary navigation."
4. **"Send a redt" is reachable without leaving the page.** The Connection 360 (right rail or an
   action in the tab bar, per AD-24's optional-right-rail region) launches Story 8.3's
   `RedtComposeDialog`, pre-bound to this connection's id.
5. **Ending a connection is available from its own 360**, calling Story 8.2's `endConnection()`;
   after ending, the 360 still renders (history is not hidden — see Story 8.2 Dev Notes on what
   ending does and does not do) but "Send a redt" is disabled with a reason.
6. **Every mention of a connection anywhere is a `RecordLink`.** Dashboard summaries, if any,
   and any future cross-reference to a connection use the shared `RecordLink` primitive (Epic 3
   Story 3.9) — no ad-hoc `<Link>`.
7. **The shadchanus dashboard is now real.** Story 8.1's placeholder is replaced with a stat
   band (accepted-connection count, unread-conversation count per Task 6's definition) and a
   short list of the most recently active connections, each a `RecordLink`. It still renders
   correctly with **zero** connections (empty state, not an error) — this must not regress
   Story 8.1's empty-state behaviour.
8. **No household record is ever rendered here, and the surfaces are sealed both ways.** The
   Connections list and every Connection 360 tab query only connection-scoped rows and the
   caller's own account-scoped rows — never a household table directly (Story 8.4's suite is
   the DB proof; this story does not re-write it). The reverse holds too: a route test proves
   a household-active session is redirected off `/connections` (the epic's "my records never
   leak into a household context", at the UI layer — the DB layer is Epic 2's isolation suite).

## Tasks / Subtasks

- [ ] **Task 1 — Locate and reuse, don't rebuild** (informs all ACs)
  - [ ] Read Epic 3's `Entity360` shell and descriptor contract (Story 3.1/3.3) and Epic 4's
        `EntityList` (Story 4.1) before writing a single component — this story must produce
        **zero** bespoke layout code per AD-24. Use `LSP workspaceSymbol` / `documentSymbol` on
        an existing descriptor-based resource (e.g. whatever Epic 5 shipped for `shadchanim` or
        `references`) as the template to copy the *shape* of, not the content.
  - [ ] Read `threads/ThreadPanel.tsx` (Epic 7 Story 7.1, privacy toggle from 7.3) before
        building Task 3 — reuse its rendering, only scope its query by this connection's id.

- [ ] **Task 2 — `connections` resource and descriptor** (AC: 1, 2, 6)
  - [ ] In the existing `src/components/atomic-crm/connections/` folder (Story 8.1 created it):
        `index.ts` (descriptor + resource registration, following the shape of an existing
        Epic-5 entity folder), `ConnectionList` (thin — descriptor-driven, per AD-24 "no entity
        contains bespoke layout code"), `ConnectionShow` (renders `Entity360` with this story's
        tabs).
  - [ ] Register in `root/routeManifest.ts` with `contextKind: "shadchanus"` — the field
        Story 8.1 Task 3 added and `CRM.tsx` already wraps in `RequireContextKind`. Do **not**
        touch the manifest's `surface` field for this: `surface` means desktop/mobile/both
        (1.5), never context kind. Remove 8.1's `/connections` placeholder custom-route entry
        and `ConnectionsPlaceholder.tsx` in the same change (NFR-14: the replaced thing is
        deleted, not left beside its replacement). This closes the mirror direction 8.1 left
        open: a household-active session cannot reach `/connections`.
  - [ ] `RecordLink` (Epic 3 Story 3.9) target for a connection → `/connections/{id}`.

- [ ] **Task 3 — `discussions` tab** (AC: 3)
  - [ ] Add the `connections` row — `overview, discussions` — to `CANONICAL_TAB_SETS` in
        `entity360/ad24Conformance.ts` **in this same diff**. Registering a `connections`
        descriptor against a table that has no row for it is itself a `tab-set-incomplete`
        violation [Source: _bmad-output/implementation-artifacts/3-11-ad24-conformance-validator.md
        — AC 6, "a descriptor whose `name` has no row … is not silently skipped"]. Both tabs
        ship here, so the descriptor needs no `pendingTabs`.
  - [ ] Add the `discussions` tab (key `discussions`, no `label` override — the label resolves
        through `useTabLabel` to "Discussions") to the `connections` descriptor's tab list, rendering
        `threads/ThreadPanel.tsx` scoped to `threads.connection_id = this connection's id`. If
        Epic 7 exposes threads as a `*_summary` view (AD-10 convention for list resources),
        query that; do not write a bespoke thread query.

- [ ] **Task 4 — Send-a-redt action** (AC: 4)
  - [ ] Wire Story 8.3's `connections/RedtComposeDialog.tsx` as an action in the Connection
        360's right rail — launch it, do not duplicate it.
  - [ ] Disable the action with an explanatory tooltip/message when `connection.status ===
        'ended'` (AC-5).

- [ ] **Task 5 — End-connection action** (AC: 5)
  - [ ] A confirm-and-call action wired to `dataProvider.endConnection()` (Story 8.2), refreshing
        the 360 on success so the identity header immediately shows `ended`.

- [ ] **Task 6 — Shadchanus dashboard, for real** (AC: 7)
  - [ ] Replace Story 8.1's `dashboard/ShadchanDashboard.tsx` placeholder body (keep the file and
        its route wiring — do not create a second dashboard component) with: a stat band —
        count of `status = 'accepted'` connections, and count of **unread** conversations using
        Story 7.5's unread definition (a thread with a message newer than the caller's
        `thread_participants.last_read_at`; 7.5 lands before this story, so the signal exists —
        do not invent a second recency heuristic) — and a short list of the most recently
        active connections (latest message first) as `RecordLink`s.
  - [ ] Zero-connections state renders the same empty-state copy Story 8.1 shipped, not a new one
        — reuse the i18n key.

- [ ] **Task 7 — FakeRest parity** (AC: all)
  - [ ] Extend the FakeRest data generator with a handful of demo connections + threads so the
        shadchanus context has something to look at in demo mode (`make start-demo`), per AD-10's
        "keep FakeRest in sync" and the general expectation that every persona's context is
        demoable.

- [ ] **Task 8 — Tests** (AC: 1, 2, 3, 7, 8)
  - [ ] Descriptor/list/show tests following whatever pattern Epic 3/5's descriptor-based
        entities established (component tests: empty/loading/error, light+dark, 375px per
        UX-DR11 — reuse the existing visual-regression harness, do not add a new one).
  - [ ] `dashboard/ShadchanDashboard.test.tsx` (extending Story 8.1's file): zero-connections
        empty state still passes; a populated-state render shows the stat band and `RecordLink`s.
  - [ ] Route-guard negative test (AC-8): with a mocked `household` active context,
        `/connections` redirects and `ConnectionList` never renders — the mirror of Story 8.1's
        guard test, now against the real resource.
  - [ ] `make typecheck && npm run lint && make test`, plus scoped `prettier --check`.

## Dev Notes

### What this story does not re-litigate

The privacy boundary (which data a shadchan may query) is **Story 8.4's** and is proven at the
database. This story only has to avoid **querying** anything outside that boundary from the
frontend — it must not add a second, UI-side privacy check that duplicates RLS (the app never
enforces visibility alone, per the architecture's constraint list) or, worse, papers over an RLS
gap with a client-side filter. If a query here ever needs to hide something the database already
returns, that is a Story 8.4 defect to report, not a filter to add in `ConnectionShow`.

### Architecture citations

- **AD-24**: the full shell contract this story must produce zero exceptions to — fixed region
  order, descriptor-only, `EntityList`/`RecordLink` reuse, tabs declaring who may see them.
  The mechanism is `EntityTabDescriptor.visibleTo?: MemberRole[]` — an explicit allow-list,
  absent meaning visible to every role (contract §2 rule 7; the spine's "minimum visibility"
  phrasing predates that ruling and there is no `minVisibility` field). Not applicable here
  beyond "shadchanus context only", already handled by the route guard, not
  a per-tab visibility rule: **both `connections` tabs omit `visibleTo`.**
- **UX-DR8/UX-DR10**: threads are a tab, not a nav destination — same reasoning Story 8.1 applied
  to the nav set, now applied to the record level.
- **AD-20**: "Suggestions redted through a connection still belong to the household" — reinforces
  why the Connection 360 shows thread activity and a redt count, never the suggestion's pipeline
  state (which the shadchan structurally cannot read, per Story 8.4).

### Dependencies

- **Epic 3** (`Entity360` shell, descriptor registry — Stories 3.1, 3.3) and **Epic 4**
  (`EntityList` — Story 4.1) are hard prerequisites for Task 2. Epic 8's own FR coverage row in
  epics.md ("FR108–113, AD-4, AD-7") does not mention UX-DR1/UX-DR7/AD-24 at all, yet this story
  cannot be built without them — flagged to the epic owner in the story-writing report.
- **Epic 7** (thread list/detail component) for Task 3.
- **Story 8.1** (nav/dashboard shell, `RequireContextKind`), **Story 8.2** (`connections`
  resource + `endConnection`), **Story 8.3** (`RedtComposeDialog`, redt count data).

### Testing standard

Frontend component tests per `.claude/rules/testing.md` (AAA); reuse Epic 3/5's established
descriptor-entity test pattern rather than inventing a new one for this resource.

### Project Structure Notes

The `connections/` folder exists since Story 8.1 (placeholder) and holds Story 8.3's
`RedtComposeDialog.tsx`. New in it: `index.ts` (descriptor), `ConnectionList.tsx`,
`ConnectionShow.tsx`, plus co-located tests. Deleted: `ConnectionsPlaceholder.tsx` (+ test).
Modified: `dashboard/ShadchanDashboard.tsx` (from Story 8.1), `root/routeManifest.ts`,
FakeRest data generator.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
