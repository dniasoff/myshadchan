# Story 8.5: The shadchan's own CRM

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want to see my connections and my conversations on the same shell everyone else uses,
so that I can do my work here instead of falling back to a notebook.

## Position in Epic 8

**5th (last) of 5.** Depends on **8.1** (the shadchanus nav/dashboard shell and the
`RequireContextKind` guard), **8.2** (the `connections` table), and **8.3** (the redt-compose
dialog and the connection-scoped thread it mirrors). This story wires all three into a real
descriptor-based CRM and **replaces** Story 8.1's placeholder dashboard.

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
   ended); the stat band shows at minimum the count of redts sent through this connection.
3. **Conversations are a tab, not a destination.** The Connection 360's tab bar includes a
   Conversations tab listing the connection's threads (reusing Epic 7's thread list/detail
   component — no second chat UI); this is the only place a shadchan reaches a thread from,
   consistent with UX-DR8's "reached from its parent, not primary navigation."
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
   band (connection count, open-thread count) and a short list of the most recently active
   connections, each a `RecordLink`. It still renders correctly with **zero** connections
   (empty state, not an error) — this must not regress Story 8.1 AC-4's empty-state behaviour.
8. **No household record is ever rendered here.** A manual smoke test (and Story 8.4's suite,
   which this story does not re-write) confirms the Connections list and every Connection 360
   surface only connection-scoped and the caller's own account-scoped data — never a household
   table read directly.

## Tasks / Subtasks

- [ ] **Task 1 — Locate and reuse, don't rebuild** (informs all ACs)
  - [ ] Read Epic 3's `Entity360` shell and descriptor contract (Story 3.1/3.3) and Epic 4's
        `EntityList` (Story 4.1) before writing a single component — this story must produce
        **zero** bespoke layout code per AD-24. Use `LSP workspaceSymbol` / `documentSymbol` on
        an existing descriptor-based resource (e.g. whatever Epic 5 shipped for `shadchanim` or
        `references`) as the template to copy the *shape* of, not the content.
  - [ ] Locate Epic 7's thread list/detail component (Story 7.1 territory) before building
        Task 3 — reuse its rendering, only scope its query by this connection's id.

- [ ] **Task 2 — `connections` resource and descriptor** (AC: 1, 2, 6)
  - [ ] New `src/components/atomic-crm/connections/` folder: `index.ts` (descriptor + resource
        registration, following the shape of an existing Epic-5 entity folder), `ConnectionList`
        (thin — descriptor-driven, per AD-24 "no entity contains bespoke layout code"),
        `ConnectionShow` (renders `Entity360` with this story's tabs).
  - [ ] Register in `root/routeManifest.ts` (Epic 1 Story 1.5's manifest) as
        `{ name: "connections", surface: "shadchanus", definition: connections }` or whatever
        field the manifest uses by then to mean "only reachable in this context kind" — if the
        manifest has no such field yet, add one rather than hand-rolling a second registration
        mechanism, and wrap the route with **Story 8.1's `RequireContextKind`**
        (`kind="shadchanus"`) so a household-active session cannot reach `/connections` either
        (the mirror direction Story 8.1 Task 3 explicitly left for this story).
  - [ ] `RecordLink` (Epic 3 Story 3.9) target for a connection → `/connections/{id}`.

- [ ] **Task 3 — Conversations tab** (AC: 3)
  - [ ] Add the Conversations tab to the `connections` descriptor's tab list, rendering Epic 7's
        thread component scoped to `threads.connection_id = this connection's id`. If Epic 7
        exposes threads as a `*_summary` view (AD-10 convention for list resources), query that;
        do not write a bespoke thread query.

- [ ] **Task 4 — Send-a-redt action** (AC: 4)
  - [ ] Wire Story 8.3's `RedtComposeDialog` as an action in the Connection 360's right rail (or
        relocate the dialog into `connections/` now that the folder exists, per Story 8.3 Task 6's
        explicit hand-off note — do not keep two copies).
  - [ ] Disable the action with an explanatory tooltip/message when `connection.status ===
        'ended'` (AC-5).

- [ ] **Task 5 — End-connection action** (AC: 5)
  - [ ] A confirm-and-call action wired to `dataProvider.endConnection()` (Story 8.2), refreshing
        the 360 on success so the identity header immediately shows `ended`.

- [ ] **Task 6 — Shadchanus dashboard, for real** (AC: 7)
  - [ ] Replace Story 8.1's `dashboard/ShadchanDashboard.tsx` placeholder body (keep the file and
        its route wiring — do not create a second dashboard component) with: a stat band (open
        `EntityList`/count query against `connections` scoped to the caller, and against threads
        for "open conversations" — definition of "open" is this story's call: an accepted
        connection with at least one thread updated in the last N days, or simply "any thread on
        an accepted connection" if Epic 7 has no read/updated-at signal yet — pick the simpler
        definition and state it in a code comment, do not leave it ambiguous) and a short list of
        the most recently active connections as `RecordLink`s.
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
  order, descriptor-only, `EntityList`/`RecordLink` reuse, tabs declaring minimum visibility
  (not applicable here beyond "shadchanus context only", already handled by the route guard, not
  a per-tab visibility rule).
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

New: `src/components/atomic-crm/connections/` (`index.ts`, `ConnectionList.tsx`,
`ConnectionShow.tsx`, plus co-located tests). Modified: `dashboard/ShadchanDashboard.tsx` (from
Story 8.1), `root/routeManifest.ts`, FakeRest data generator.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
