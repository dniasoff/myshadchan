# Story 12.1: Dashboard reminders card

Status: ready-for-dev *(schedule after Story 12.3 — see F6 below)*

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Placement — SETTLED 2026-07-30 (reconciliation pass)

Number confirmed: **Story 12.1**, in **Epic 12 — Phase-1 Completion & Operational Readiness**.
The section *"Why this identifier"* below is kept as history; its predictions about sibling
numbering (12.5, 12.12) are superseded — the four adopted orphans landed as 12.1 (this),
12.3 (family-shared tasks), 12.4 (Stripe billing) and **5.12** (Guided Call mode, placed inside
Epic 5), joined by 12.2 (reminder delivery, from the silent-defects track).

**Epic 4 was considered as a home and rejected.** Epic 4 covers UX-DR2 / UX-DR7 / UX-DR10 — route
convention, list framework, navigation set — and the dashboard is none of those. FR54 sits in the
FR1–FR78 *"substantially delivered"* bucket that no epic re-stories, which is exactly what Epic 12
now exists to close. Epic 4 is also built and deployed; reopening a shipped epic would make it
incomplete again for a story it never scoped.

**Binding delivery order inside Epic 12: 12.3 → 12.1 → 12.2 → 12.4.**

### Cross-story reconciliation findings (from the same pass)

- **F6 — BLOCKING. As written, this card reproduces on a third surface the exact defect Story 12.3
  fixes.** AC-1 makes the card account-wide with no assignee attribution — which is precisely
  12.3's diagnosis of `/reminders`: *"already shows the whole household, unlabelled"*. 12.3's AC-10
  enumerates every surface that must carry the assignee (`/tasks`, `/reminders`,
  `entity360/tabs/TasksTab.tsx`, `TasksRailSummary.tsx`) and could not see the dashboard.
  **Rulings:** (a) **12.3 lands first**; (b) a row whose task is assigned to someone other than the
  viewer renders 12.3's `tasks/TaskAssigneeChip.tsx` — **import it, never re-implement it**
  (contract §11 Ruling 2 point 5 forbids a parallel implementation); (c) the card stays
  **account-wide and does not read 12.3's `useTaskAssigneeScope` store key** — it is a read-only
  summary, like the Tasks rail, and a summary that silently hides half the household is the defect
  again. AC-1's "account-wide" is therefore reaffirmed, not weakened.
- **F7 — the "reminders/** is not touched" claim holds for this diff and not for the world.**
  Story 12.3 rewrites four files in that folder: `useReminders.ts` (adds a scope filter),
  `ReminderCard.tsx`, `ReminderCreateSheet.tsx`, `RemindersPage.tsx`. This story deliberately
  *copies* the hub's pure helpers rather than importing `useReminders` (AC-3 forbids the import,
  because `useReminders` calls `useUpdate`). That copy will silently diverge from a post-12.3
  `useReminders`. **Re-read `useReminders.ts` and `ReminderCard.tsx` at implementation time** and
  record the divergence as a decision in the Dev Agent Record, not as an oversight.
- **F12 — Story 12.2 (reminder delivery) is complementary, not duplicative.** Both address "the
  user never learns there is something to do": this card is the in-app glance, 12.2 is AD-13's
  out-of-app email floor. Neither supersedes the other; do not drop either as redundant. No surface
  overlap — 12.2's delivery-status row lands in Settings.
- **F14 — `registry.json` and both i18n catalogues are contended** with 12.2, 12.3, 5.12 and Epic
  5's in-flight stories. A lease matter, not a design conflict.

## Story

As a parent,
I want the dashboard to show me what is due,
so that I learn there is something to do without navigating to the Reminders hub.

## Why this identifier (a later agent may renumber)

This is not Epic 1-11 work. It came out of the **mobile gap analysis**, Category D — the six gaps
that were in the mockups, absent from the app, and owned by no story. The owner adopted four of
them; this is **D1**.

Proposed placement: a new **Epic 12 — Adopted gaps (mobile gap analysis, Category D)**, with the
story number taken from the gap's own D-number. So D1 → **12.1**, and the three siblings written
in the same round land on 12.3 (D3, family-shared tasks), 12.5 (D5, clipped tab strip) and 12.12
(D12, singles roster reachability). The mapping is deterministic, which is the point: four agents
authoring four stories concurrently cannot collide on `12-1-…` if the number is a function of the
gap, not of the writing order. A later agent that places these in `epics.md` is free to renumber —
nothing in this file depends on the number except its own filename.

## Position and dependencies

**Depends on work that is already built and deployed** — this story adds no primitive:

- **Epic 3** — `entity360/RecordLink.tsx` (contract §7: every record mention routes through it),
  and `entity360/ad24Conformance.ts`'s RULING 7 machinery, which is the constraint this story is
  mostly about.
- **Epic 4 / RULING 7** — `reminders/OutstandingCallsSection.tsx`, the *precedent* for putting a
  reference-shaped worklist somewhere that is not the dashboard, and for how a reference row is
  allowed to read (`OutstandingCallsSection.tsx:20-33`).
- The **Reminders hub** as shipped: `reminders/useReminders.ts`, `ReminderList.tsx`,
  `ReminderCard.tsx`, `reminderEntity.ts`.

**Independent of Epic 5.** It touches no `entity360/**` source, no `shidduchim/**`,
`singles/**`, `shadchanim/**`, `references/**`, no `supabase/**` and not `types.ts`. Two contended
files remain and the wave planner must see them: **both i18n catalogues** (5-9 deletes
`resources.shadchanim.fields.notes` from the same two files) and **`registry.json`** (regenerated
by `.husky/pre-commit` for every story that adds or deletes a non-test file under
`src/components/atomic-crm/**`). One further file is *newly* contended if a reviewer accepts
Task 4's last subtask: `entity360/ad24Conformance.guard.test.ts`. Epic 5's stories declare
`entity360/{ad24Conformance.ts, registry.stubs.test.ts}` — **not** the guard test — so the overlap
is adjacent, not identical. Serialize against Epic 5 anyway if the wave is tight.

**Related but deliberately NOT owned here: reminder delivery.** `epics.md:1366-1368` (unowned gap
S5) records that Story 7.5 builds the first real Resend / Web-Push delivery and *no story connects
the reminders sweep to it*, so a reminder today fires through no channel at all. A card that shows
reminders which never fire is half a feature — but the missing half is a delivery pipeline, not a
dashboard card, and folding it in here would turn a one-file frontend story into an Epic 7 build.
**Recorded, not absorbed.** The pairing note belongs on 7.5.

## Most of this already exists — reuse, do not rebuild

Everything the card renders has a shipped implementation somewhere. The new code is a hook, a
card, and two mount points.

- **The overdue/upcoming split.** `reminders/useReminders.ts:134-168` already queries open tasks
  (`filter: { "done_date@is": null }`, `sort: due_date ASC`, `perPage: 200`) and splits them with
  `isOverdue` (`tasks/tasksPredicate.ts:21-23`). Because the sort is ascending by due date,
  **overdue rows already sort first** — the card needs no second ordering pass.
- **The polymorphic label.** `reminders/reminderEntity.ts:57-87`'s `targetEntityLabel(type,
  record)` is already extracted, already AD-23-clean, and already handles the four target types.
  Import it; do not write a fifth label switch.
- **The due-moment string.** `misc/formatDueMoment.ts:21-22` — `"24 Jul, 2:00 PM"`, the one
  rendering of a due date in the app. `ReminderCard.tsx:75-77` shows the two prefixes to reuse
  verbatim: `Since {…}` when overdue, `Due {…}` otherwise.
- **The card chrome.** `dashboard/AttentionSection.tsx:32-58` is the shape to copy — a `Card` with
  a round icon badge, an `h2`, a one-line subtitle, then a `divide-y` `<ul>` with an
  `and N more` overflow row. Match it; the dashboard should read as one surface.
- **The reference-row shape.** `reminders/OutstandingCallsSection.tsx:92-123` already renders the
  exact row this story needs — reference name, then `about {shidduch}` and `· for {single}` — off
  `reference_links_summary`. Copy the row's *information design*, but invert which half is the
  link (AC-6).

**Do not import `useReminders` into `dashboard/`.** It is the right data shape but the wrong
contract: it returns `complete`/`snooze` and calls `useUpdate` at line 132, which would put a task
mutation inside a read-only card's module graph and make AC-3's guard test vacuous. Write the
dashboard's own read-only hook and share the *pure* helpers (`targetEntityLabel`, `isOverdue`,
`formatDueMoment`) instead.

## The three constraints this story is really about

The card itself is an afternoon. These three are why it needs a story.

### 1. `dashboard/**` is a declared browse-surface module

`entity360/ad24Conformance.ts:667-674` lists `/^dashboard\//` in `BROWSE_SURFACE_MODULE_PATTERNS`,
and `findBrowseSurfaceEnumeration` fails the build for any file matching it that issues
`useGetList("references")` or `useGetList("references_summary")`. This is not incidental: the
outstanding-calls worklist was put in the Reminders hub *specifically because* the dashboard is
this module class (`OutstandingCallsSection.tsx:20-26`).

The card must therefore never enumerate references. It does not need to: `reference_links_summary`
(`supabase/schemas/03_views.sql:133-160`) already carries `reference_name_en` **and**
`shidduchim_id` / `shidduch_name_en` / `single_first_name_en`, so one filtered read of
`reference_links` answers both "what is this reference called" and "which shidduch is it about".
Nothing under `dashboard/**` ever names the `references` resource.

Two guard mechanics worth knowing before writing the code, because both are silent:

- `useGetOne` / `useGetMany` are **deliberately not matched** by the rule
  (`ad24Conformance.ts:692-694`: "fetching a record by id is addressability, which RULING 7
  clause 2 protects"). So `useGetMany("references", { ids })` would compile, ship, and pass the
  guard — and still be the wrong thing here. Discipline, not the guard, is what keeps it out.
- The rule matches `references` and `references_summary` only. `reference_links` /
  `reference_links_summary` do **not** match the regex and are the sanctioned read, exactly as in
  `OutstandingCallsSection.tsx:42-48`.

### 2. A reminder on a reference must arrive at a shidduch

`tasks` has **no shidduch scope column** — `supabase/schemas/01_tables.sql:31-51` is
`target_type` + `target_id` and nothing else. So a `target_type = 'reference'` reminder carries no
shidduch, and the hub's `ReminderCard.tsx:54-63` links it straight to `/references/{id}`. That is
legal in the hub (RULING 7 clause 2, `epics.md:137-138`) and it is not legal on the dashboard,
where a bare reference row is a reference book with one row in it.

This is live in the demo data on day one, not hypothetical.
`providers/fakerest/dataGenerator/references.ts:231-250`
seeds **three** open reference-targeted tasks and no other tasks at all
(`dataGenerator/index.ts:17` starts `db.tasks = []`), so on a demo account **every row of this
card is a reference row**. And one of the three targets reference index 0, which has three
`referenceLinkSeeds` entries (`:112`, `:119`, `:126`) — the ambiguous multi-shidduch case is in
the fixture too.

### 3. The dashboard has a measured layout-shift history

`layout/DemoBanner.tsx:37-61` documents it: rendering `null` until a query resolved, then mounting
full height, pushed `<main id="main-content">` from y=0 to y=103 one paint later — 0.122 CLS on a
cold 390px load, with `e2e/demo-banner-cls.spec.ts` written to measure exactly that. That spec's
own doc comment (`:6-24`) notes the dashboard is the route where an impact-weighted CLS score
*cannot see* the movement, which is why it also asserts the set of distinct y-positions.

`useDashboardData` gates the whole dashboard with `if (isPending) return null`
(`Dashboard.tsx:28`), so every section mounts in one paint — and then this card's own query
resolves one paint later. If the card grows at that moment, everything below it moves. It must be
the same height empty, pending and full.

## Acceptance Criteria

1. **Given** an account with at least one open reminder, **when** I load `/` on the desktop
   dashboard and on the mobile dashboard, **then** a single "Due now" card renders in both — on
   mobile as the first section under `DashboardHeader` and above `PipelineSnapshot`
   (`MobileDashboard.tsx:90-107`), on desktop as the first child of the right-hand column
   (`Dashboard.tsx:65-79`, above the `DashboardStat` grid and `AttentionSection`). One component,
   mounted twice; there is no desktop-only and no mobile-only variant.
   The card is **account-wide, not scoped to the selected single** — the same choice
   `AttentionSection.tsx:23-26` already makes, and forced here because a reminder on a shadchan or
   a reference has no single to scope by. **Failing looks like:** switching singles in
   `DashboardHeader` changes the card's contents; or two different components named in
   `Dashboard.tsx` and `MobileDashboard.tsx`.
2. **Given** the card, **when** it is in its loading state, its empty state, and its full state
   (three rows), **then** its rendered height is **identical in all three**. Assert it as a number,
   not as a class name: the component tests run in real Chromium via `vitest-browser-react`, so
   `element.getBoundingClientRect().height` is a real measurement — render the three states and
   assert the values are equal. The list region is a fixed-height container sized for `MAX_ROWS`
   rows, and the skeleton, the rows and the empty message all live inside it.
   **Failing looks like:** the empty card is visibly shorter than the full one; or the assertion
   is written against `toHaveClass("min-h-…")`, which is a claim about a string and passes while
   the box still grows.
3. **Given** the card, **when** it renders, **then** it is **read-only** — the shape Ruling 2 sets
   for the Tasks rail (`epic3-api-contract.md:738-760`: "the tab is canonical, the rail is a
   summary … no add, no toggle, no edit, no delete"), applied to the dashboard for the same
   reason: `/reminders` is the canonical place a reminder is acted on. Concretely: no checkbox, no
   Snooze control, no "Add a reminder" button, and exactly one navigation affordance — a
   **"See all reminders"** link to `/reminders` (`layout/navItems.ts:72-78`), which renders in
   every state including empty and loading.
   Two independent proofs, because they fail differently: (a) a behaviour test asserting
   `getByRole("checkbox")` and `getByRole("button", { name: /snooze/i })` are not in the document
   while three rows are on screen; and (b) a `?raw` source-scan guard on the card and its hook,
   modelled on `entity360/tabs/TasksRailSummary.guard.test.ts:20-37`, finding none of
   `useCreate`, `useUpdate`, `useDelete`, `useMutation`.
   **Failing looks like:** the guard is green because the card imports `reminders/useReminders`
   (whose `useUpdate` lives in another file) — that import is forbidden by AC-3 and the guard must
   also assert the card's source does not contain `useReminders`.
4. **Given** more open reminders than fit, **when** the card renders, **then** it shows at most
   `MAX_ROWS = 3`, overdue first, each row carrying the reminder's `text`, its linked entity, and
   a due line reading `Since {formatDueMoment(due_date)}` when overdue and
   `Due {formatDueMoment(due_date)}` otherwise (`ReminderCard.tsx:75-77`), plus an
   `and N more` overflow line when there are more. Ordering comes free from the hub's query shape
   (`due_date ASC`); do not re-sort.
   `Task.due_date` is typed `string` (`types.ts:99-109`) but the column is **nullable**
   (`01_tables.sql:35`), so a null date reaches `new Date(null)`. A row with no due date renders
   its text with **no** due line — never the string `Invalid Date`.
   **Failing looks like:** a seeded task with `due_date: null` renders "Invalid Date"; or four
   rows render; or an upcoming row sorts above an overdue one.
5. **Given** the AD-24 validator, **when** this story lands, **then** no file under
   `dashboard/**` names the `references` or `references_summary` resource in **any** query shape —
   not `useGetList`, and not the `useGetMany`/`useGetOne` forms the guard deliberately does not
   match (`ad24Conformance.ts:692-694`). Reference-targeted reminders are resolved through
   `useGetList("reference_links", { filter: { "reference_id@in": "(…)" } })` only.
   `entity360/ad24Conformance.guard.test.ts:406-421` pins `expect.arrayContaining([...])` over the
   scanned browse-surface modules; add the two new dashboard modules to that list so the scan is
   proven to cover them rather than silently skipping them.
   **Failing looks like:** `npx vitest run src/components/atomic-crm/entity360` reports the new
   card under "no-browse enumeration on a browse surface"; or the arrayContaining list is
   unchanged, in which case the guard would still pass if the new files were never scanned at all.
6. **Given** a reminder whose `target_type` is `reference`, **when** its row renders on the
   dashboard, **then** the row's `RecordLink` targets the **shidduch**
   (`resource="shidduchim"`), never `resource="references"`, and the row reads
   `{reference name} · about {shidduch name}` so it is visible which context the link leads to.
   Resolution and its two edge cases, all three deterministic:
   - **one link** → that shidduch;
   - **more than one link** (demo reference 0 has three) → the link with the most recent
     `created_at`, tie-broken by the highest `reference_links.id`. Recorded as an accepted
     approximation, not a correct answer: nothing on `tasks` records which shidduch the reminder
     was created in, and the real fix is a scope column, which is a migration this story does not
     ship (AC-8). Naming the shidduch in the row is what keeps the approximation honest.
   - **no link at all** (an unattached reference) → the row renders the reference name as
     **inert text**, with no link of any kind. It does *not* fall back to `/references/{id}`.
   **Failing looks like:** `grep -n 'resource="references"' src/components/atomic-crm/dashboard/`
   returns a hit; or, on a demo account, the row for "Ask Chaim Feldman about Tzvi Adler's
   learning habits" navigates to a reference record; or an unattached reference's row is a link.
7. **Given** the two i18n catalogues, **when** this story lands, **then** every user-facing string
   on the card is translated through `useTranslate` with an inline `_` default, keyed under the
   existing `crm.reminders` namespace (`providers/commons/englishCrmMessages.ts:709-716` — add a
   `dueCard` sibling of `outstandingCalls`), and the same keys exist in
   `frenchCrmMessages.ts:645-652`. The French file is `satisfies CrmMessages`
   (`frenchCrmMessages.ts:658`) against `MessageSchema<typeof englishCrmMessages>`
   (`englishCrmMessages.ts:732`), so a missing French key is a **typecheck error**, not a runtime
   fallback. `OutstandingCallsSection.tsx:78-88` is the call shape to copy.
   **Failing looks like:** `make typecheck` fails naming the French catalogue (the honest failure
   — fix it, do not widen the type); or the card ships hardcoded English, which typechecks and
   silently un-translates the dashboard.
8. **Given** the whole change, **when** the diff is reviewed, **then** it contains **no** file
   under `supabase/` — no migration, no schema edit, no policy, no grant, no view. Everything the
   card reads (`tasks`, `reference_links`, `shidduchim`, `shadchanim`, `singles`) already exists
   with the RLS it needs, and `reference_links_summary` is already `security_invoker = on`
   (`03_views.sql:133`). **Failing looks like:** a new file in `supabase/migrations/`. If one
   appears, a schema file was edited from a stale assumption — revert it. This story's read
   surface is account-scoped by policies it does not touch, so
   `.claude/rules/security-triggers.md` is satisfied by review, not by a migration round.

## Tasks / Subtasks

- [ ] **Task 1 — `dashboard/useDueReminders.ts`, the read-only hook** (AC: 1, 4, 5, 6)
  - [ ] Query one: open tasks, the hub's shape verbatim —
        `useGetList<Task>("tasks", { filter: { "done_date@is": null },
        sort: { field: "due_date", order: "ASC" }, pagination: { page: 1, perPage: 200 } })`
        (`reminders/useReminders.ts:134-138`). No `member_id` filter: tasks are account-wide
        today, and making them per-member is gap **D3**'s story, not this one.
  - [ ] Split with `isOverdue(task.due_date)` (`tasks/tasksPredicate.ts:21-23`), guarding
        `due_date == null` first (AC-4). Because the query sorts ascending, the overdue rows are
        already the head of the list — take the first `MAX_ROWS` of the whole list and keep
        `overdueCount` for the subtitle.
  - [ ] Query two — labels for the three browsable target types. Three `useGetMany` calls, one per
        type (`shidduchim`, `shadchanim`, `singles`), declared unconditionally and gated with
        `{ enabled: ids.length > 0 }`, exactly as `useReminders.ts:81-100` does. **Three, not
        four** — `references` is deliberately absent (AC-5). Resolve each to a label with the
        shared `targetEntityLabel` (`reminders/reminderEntity.ts:57-87`); do not write a second
        label switch.
  - [ ] Query three — reference rows.
        `useGetList<ReferenceLinkSummary>("reference_links", { filter: { "reference_id@in": ids },
        sort: { field: "created_at", order: "DESC" }, pagination: { page: 1, perPage: 100 } },
        { enabled: referenceIds.length > 0 })`. The supabase provider maps `reference_links` onto
        `reference_links_summary` (`providers/supabase/dataProvider.ts:111-115`) and FakeRest
        emulates the same join (`providers/fakerest/internal/referenceSummary.ts:92-150`), so both
        providers return `reference_name_en`, `shidduchim_id`, `shidduch_name_en` and
        `single_first_name_en` with **no AD-10 lockstep work**. Verify, do not re-derive.
  - [ ] **`@in` takes a PostgREST string, not an array.** `providers/fakerest/internal/
        transformInFilter.ts:5-17` throws `Invalid '@in' filter value…` for anything that is not a
        string matching `^\(…\)$`, and `transformFilter.ts:36-40` routes the key there. Build
        `` `(${ids.join(",")})` ``. This is the app's **first production use** of `@in` (today it
        appears only in `internal/supabaseAdapter.test.ts`), so cover the constructed value in the
        hook's own test — the failure mode is a thrown error inside the demo provider, which
        blanks the card.
  - [ ] Build the reference → shidduch map: group links by `reference_id`, and pick per AC-6
        (most recent `created_at`, tie-break highest `id`). Because the query already sorts
        `created_at DESC`, "first seen wins" implements it — but write the tie-break explicitly;
        two links created in the same seeded second is the demo fixture, not a corner case.
  - [ ] Return a plain, already-resolved view model — `{ isPending, rows, overdueCount,
        totalCount }`, where a row is `{ id, text, dueDate, isOverdue, primaryLabel,
        contextLabel, link: { resource, id } | null }`. Resolution belongs in the hook; the card
        renders and does not branch on `target_type`.
  - [ ] No mutation hook of any kind in this file (AC-3's guard scans it too).
- [ ] **Task 2 — `dashboard/DueRemindersCard.tsx`** (AC: 1, 2, 3, 4, 6, 7)
  - [ ] Chrome copied from `AttentionSection.tsx:32-58`: `Card`, round icon badge (`Clock9` or
        `BellRing` from lucide — `ReminderList.tsx:1` already uses both), `h2`, subtitle,
        `divide-y` `<ul>`, `and N more` overflow row.
  - [ ] **Fixed-height list region** (AC-2). One container with an explicit height for `MAX_ROWS`
        rows; the skeleton (`ReminderList.tsx:45-51`'s three pulse blocks are the pattern), the
        rows, and the empty message all render *inside* it. The card never returns `null` — and
        note that this is the opposite of `OutstandingCallsSection.tsx:61`, which self-hides. That
        component sits on a hub where nothing is below it; this one has the whole dashboard below
        it.
  - [ ] Empty copy: reuse the hub's exact phrase, `"Nothing due — you're on top of it"`
        (`ReminderList.tsx:71`), so the two surfaces do not develop two voices.
  - [ ] Overdue emphasis: `text-attention-foreground` on the due line, per `ReminderCard.tsx:71`.
        **Do not** copy `ReminderCard.tsx:42`'s `bg-[color-mix(…)]` arbitrary values into this
        card — they are not needed for a summary row, and every arbitrary bracket is a chance to
        write the `-[--foo]` form that `scripts/check-tailwind-arbitrary-var.mjs:28` fails the
        build on (silently dropped declaration, everything else green).
  - [ ] Every record mention is a `RecordLink` (contract §7 rule 5 names "reminder card"
        explicitly). The "See all reminders" link is navigation, not a record mention — a plain
        `<Link to="/reminders">`, as `TasksRailSummary.tsx:135-140` does for its tab link.
  - [ ] All strings through `useTranslate` with `_` defaults (AC-7).
- [ ] **Task 3 — Mount it** (AC: 1, 2)
  - [ ] `MobileDashboard.tsx`: inside the `hasSuggestions` branch (`:90-107`), first child, above
        `<PipelineSnapshot>`.
  - [ ] `Dashboard.tsx`: inside the `hasSuggestions` branch, first child of the
        `lg:col-span-4` column (`:65-79`), above the `DashboardStat` grid.
  - [ ] **Recorded scope decision:** the card mounts in the populated branch only. An account whose
        *selected* single has no shidduchim sees the "Capture your first suggestion" empty state
        (`Dashboard.tsx:51-57`) and no reminders card, even in the rare case where a reminder
        exists on a shadchan or on another single's shidduch. That onboarding moment is
        deliberately uncluttered, and a brand-new account has no reminders either. Do not "fix"
        this into a third branch without an owner ruling.
  - [ ] Confirm the tour still resolves `[data-tour="pipeline-snapshot"]`
        (`tour/tourSteps.ts:119`) — the anchor moves down the page but does not move files. This
        story adds **no** tour step.
- [ ] **Task 4 — Tests** (AC: 1, 2, 3, 4, 6, 7)
  - [ ] Component tests run in **Chromium via `vitest-browser-react`** with `TestMemoryRouter` —
        `dashboard/StatStrip.test.tsx:1-3` is the local template. **React Testing Library is not
        a dependency of this repo**; do not `import { render } from "@testing-library/react"`.
  - [ ] `DueRemindersCard.test.tsx`, AAA per `.claude/rules/testing.md`:
        - the three-state height equality (AC-2), measured with `getBoundingClientRect()`;
        - no checkbox and no Snooze button with three rows on screen (AC-3);
        - "See all reminders" renders in the loading, empty and full states and points at
          `/reminders`;
        - overdue-first order, the `Since …` / `Due …` prefixes, the `and N more` overflow;
        - a `due_date: null` row renders its text and no due line, and the document contains no
          `Invalid Date` (AC-4);
        - a reference row links to `/shidduchim/{id}` and reads `about {shidduch}`; the
          zero-link reference row renders no anchor at all (AC-6).
  - [ ] `useDueReminders.test.tsx`: the `@in` filter value is the string `"(1,5)"` shape, not an
        array (AC-5/Task 1); multi-link resolution picks the most recent link and the tie-break is
        exercised with two links sharing a `created_at`.
  - [ ] `DueRemindersCard.guard.test.ts`: `?raw` source scan of **both** new modules for
        `useCreate` / `useUpdate` / `useDelete` / `useMutation`, plus `useReminders` (AC-3), plus
        `"references"` / `"references_summary"` (AC-5's discipline half, which the shipped
        validator cannot see because it ignores `useGetMany`). Include the
        `TasksRailSummary.guard.test.ts:39-45` sanity case — a glob that resolves nothing makes
        every other assertion pass vacuously. **Show it red once** before green (contract §13
        rule 2) and paste the output into Dev Agent Record → Debug Log References.
  - [ ] `entity360/ad24Conformance.guard.test.ts`: extend the `expect.arrayContaining` at
        `:414-419` with `"dashboard/DueRemindersCard.tsx"` and `"dashboard/useDueReminders.ts"`.
  - [ ] `e2e/dashboard-reminders-cls.spec.ts` — one spec, modelled on
        `e2e/demo-banner-cls.spec.ts`'s second measurement (its `__mainTops` idiom): on a cold
        390x844 load of `/`, the set of distinct y-positions of `[data-tour="pipeline-snapshot"]`
        has exactly one member. The component height test proves the card's own geometry; this
        proves it *in situ*, which is where the 103px shift actually happened. Reuse
        `e2e/fixtures.ts`'s sign-in; do not fork an admin client unless the fixture is contended
        in this wave.
  - [ ] `npm run typecheck && npm run lint && npx vitest run`, plus the one new e2e spec. No
        `npm run test:unit:db` round is needed — this story ships no SQL (AC-8).

## Dev Notes

### Why a dashboard card at all, when RULING 7 pushed the last worklist off the dashboard

`OutstandingCallsSection.tsx:20-33` reads, in part: "Why the Reminders hub and not the dashboard:
`entity360/ad24Conformance.ts` declares `dashboard/**` a browse-surface module, where a list query
for a no-browse entity is never legitimate." A reader could conclude the dashboard is closed to
reminders generally. It is not. The rule is scoped to `NO_BROWSE_SURFACE_ENTITIES`
(`ad24Conformance.ts:202-205`), whose only member is `references`. `tasks` is not in it, has no
ruling against it, and is already enumerated app-wide on `/tasks` and `/reminders`.

What "Still to call" could not do on the dashboard was enumerate **references**. This card
enumerates **tasks** and resolves the reference ones through their links. That is the same
distinction that module already draws about itself at `:28-33` ("it queries `reference_links`, not
`references`. Every row IS a conversation inside a named shidduch"). This story applies that
existing reasoning one surface over; it does not weaken the ruling.

### FR54 is only partly satisfied, and that is deliberate

FR54 asks the dashboard for counts, **upcoming reminders**, recent resumes and flagged duplicates.
Shipped today: counts (`DashboardStat`), recent shidduchim (`RecentSuggestions`) and flagged
duplicates (`AttentionSection`). This story adds the reminders clause and **only** that clause —
"recent resumes" needs the resume artifact Story 5.3 introduces, which does not exist yet
(`epics.md`, Epic 5). Do not scope-creep a resume tile into this card.

### The three edge cases that will actually show up

1. **Every demo row is a reference row.** `dataGenerator/index.ts:17` sets `db.tasks = []` and
   `dataGenerator/references.ts:336-352` is the only generator that appends to it — three
   reference-targeted tasks, no shidduch, shadchan or single tasks anywhere. So on a demo account
   AC-6's path is the *only* path exercised. If the reference→shidduch resolution is wrong, the
   demo dashboard is wrong, not "an edge case is wrong".
2. **Their due dates are in the past.** The seeds are dated 25 / 24 / 28 July 2026
   (`references.ts:231-250`), so on any run after that the card is three overdue rows and the
   "Upcoming" half is untested by the fixture. Cover upcoming rows in the component test with an
   explicit future date; do not rely on the demo to exercise it.
3. **One of them is ambiguous.** `referenceTaskSeeds[2]` targets reference index 0, which carries
   three `referenceLinkSeeds` (`:112`, `:119`, `:126`). The tie-break in Task 1 is not
   theoretical — write the test against this exact fixture.

### Reserving the space: what "reserve" means concretely

`AttentionSection` already does the right thing and says so at `:9-13` ("When there is nothing to
review it keeps the original calm empty state, so the layout never jumps") — it always renders its
`Card`. That is necessary and not sufficient here, because this card also has a *list* whose row
count is unknown until the query lands.

So: reserve the **list region**, not just the card. A fixed-height region sized for `MAX_ROWS = 3`
rows means the card is the same box in all three states, at the cost of some empty space on an
account with zero or one reminder. That cost is accepted deliberately — it buys a phone home
screen that never moves under the user's thumb, on the one surface in the app with a measured
0.122 CLS regression in its history (`DemoBanner.tsx:46-51`).

Do **not** implement the `DemoBanner` trick (persisting the last known answer in the CRM store to
drive the first paint). It is right for a boolean that changes twice in an account's life; a
reminder count changes daily, and a stale hint would reserve the wrong height and shift anyway.

### AD-10 lockstep: nothing to do, but verify it

Both providers already return everything the card reads:

- `reference_links` → `reference_links_summary` on Supabase
  (`providers/supabase/dataProvider.ts:111-115`), and FakeRest joins the same fields in
  `providers/fakerest/internal/referenceSummary.ts:92-150` (reference name, shidduch name, single
  first name) with `dataProvider.ts:596-608` routing both resource spellings there.
- `tasks`, `shidduchim`, `shadchanim`, `singles` are all plain registered resources on both.

This is a **verification** subtask, not a build one — but verify it by running the demo provider,
not by reading. A card that renders on the real backend and blanks in the demo is exactly the
class of bug AD-10 exists to catch.

### Project Structure Notes — the exact file set this story touches

Declared deliberately wide; every set in this project has so far been too small.

**New source**

- `src/components/atomic-crm/dashboard/useDueReminders.ts`
- `src/components/atomic-crm/dashboard/DueRemindersCard.tsx`

**New tests**

- `src/components/atomic-crm/dashboard/useDueReminders.test.tsx`
- `src/components/atomic-crm/dashboard/DueRemindersCard.test.tsx`
- `src/components/atomic-crm/dashboard/DueRemindersCard.guard.test.ts`
- `e2e/dashboard-reminders-cls.spec.ts`

**Modified**

- `src/components/atomic-crm/dashboard/Dashboard.tsx`
- `src/components/atomic-crm/dashboard/MobileDashboard.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — new
  `crm.reminders.dueCard` block
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — the same keys; a miss is a
  typecheck error, not a fallback
- `src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts` — the
  `expect.arrayContaining` scan list (AC-5)
- `registry.json` — **generated**. `scripts/generate-registry.mjs` globs
  `src/components/atomic-crm/**/*.ts*` minus tests, and `.husky/pre-commit` regenerates it, so
  adding two non-test modules mutates it whether or not the developer thinks about it. Declare it
  in the ownership manifest; `scripts/check-wave-ownership.mjs`'s shared-artifact check exists for
  precisely this file.

**Explicitly NOT touched** — state it so the wave planner does not reserve them:

- `supabase/**` — no migration, no schema, no policy, no grant (AC-8)
- `src/components/atomic-crm/types.ts` — `Task` and `ReferenceLinkSummary` already carry every
  field the card reads (`types.ts:99-109`, `:475-488`)
- `src/components/atomic-crm/reminders/**` — the hub is reused through pure helpers only; no file
  in it changes
- `src/components/atomic-crm/entity360/ad24Conformance.ts` — the *rule* is unchanged; only the
  guard test's scan list grows
- `entityDescriptor.ts` / `<entity>/index.ts` / `entity360/tabKeys.ts` — no new entity, no new
  tab, no new route
- `src/components/atomic-crm/tour/tourSteps.ts` — no new tour step
- `providers/fakerest/dataGenerator/**` — the existing three reference tasks are sufficient and,
  per "The three edge cases", are the *hardest* fixture available. Adding shidduch-targeted seeds
  would be nicer demo copy and would collide with Epic 5's generator edits; skipped on purpose.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:126-153] — RULING 7 in full. Clause 1 (no
  dashboard tile, no query returning an unfiltered page of references), clause 2
  (`/references/{id}` is addressability), clause 6 (product decision, never RLS).
- [Source: _bmad-output/planning-artifacts/epics.md:1366-1368] — unowned gap S5, reminder delivery.
  The half of this feature that is not in this story.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md:534-573] — §7 `RecordLink`: five
  props, rule 5 ("every record mention … reminder card"), rule 2 (unregistered resource degrades
  to a `<span>`, never throws).
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md:738-760] — Ruling 2, the
  read-only-summary + canonical-surface shape this card copies, including its source-scan guard
  (item 4).
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts:667-674] —
  `BROWSE_SURFACE_MODULE_PATTERNS` / `isBrowseSurfaceModule`: `dashboard/**` is a browse surface.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.ts:690-710] —
  `findBrowseSurfaceEnumeration`, and the recorded decision that `useGetOne`/`useGetMany` are not
  matched.
- [Source: src/components/atomic-crm/reminders/OutstandingCallsSection.tsx:11-33] — the precedent:
  why the hub and not the dashboard, and why querying `reference_links` is not the reference book
  by another name.
- [Source: src/components/atomic-crm/reminders/useReminders.ts:134-168] — the open-task query,
  the `useGetMany`-per-type pattern, and the overdue/upcoming split this hook mirrors read-only.
- [Source: src/components/atomic-crm/layout/DemoBanner.tsx:37-61] — the measured 103px / 0.122 CLS
  regression and why reserving height in normal flow is only half the fix.
- [Source: e2e/demo-banner-cls.spec.ts:6-24] — the two-measurement idiom, and the note that the
  dashboard needs the geometric one because its CLS score cannot see the movement.
- [Source: supabase/schemas/01_tables.sql:31-51] — `tasks`: `target_type` + `target_id`, nullable
  `due_date`, and no shidduch scope column. The reason AC-6 needs a resolver at all.
- [Source: supabase/schemas/03_views.sql:133-160] — `reference_links_summary`, `security_invoker`,
  and the joined `reference_name_en` / `shidduch_name_en` / `single_first_name_en` columns.
- [Source: src/components/atomic-crm/providers/fakerest/internal/transformInFilter.ts:5-17] — the
  `@in` filter takes the string `"(1,2)"` and throws on anything else.
- [Source: src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts:231-250] — the
  three seeded reference reminders; [`:112`, `:119`, `:126`] — reference 0's three shidduch links.
- [Source: src/components/atomic-crm/entity360/tabs/TasksRailSummary.guard.test.ts:20-45] — the
  `?raw` source-scan guard shape, including the "has a source to scan" sanity case.
- [Source: src/components/atomic-crm/dashboard/StatStrip.test.tsx:1-3] — the real test stack:
  `vitest-browser-react` + `TestMemoryRouter`, no React Testing Library.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (implementation), claude-sonnet-4-5 (this pass).

### Debug Log References

**Guard test shown red once, then green** (`DueRemindersCard.guard.test.ts`, contract §13
rule 2), per Task 4's requirement — this is a genuine red, not a staged one: the hook's
own module doc comment named `reminders/useReminders` and `useUpdate` in prose while
explaining why they are deliberately not imported, and the guard's `?raw` source scan
cannot distinguish a comment from code:

```
 FAIL  |app (chromium)| src/components/atomic-crm/dashboard/DueRemindersCard.guard.test.ts
 > DueRemindersCard + useDueReminders stay read-only and reference-free (AC-3, AC-5)
 > ./useDueReminders.ts references none of the forbidden mutation hooks / useReminders

AssertionError: ./useDueReminders.ts references: useUpdate, useReminders: expected
[ 'useUpdate', 'useReminders' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "useUpdate",
+   "useReminders",
+ ]
```

Fixed by rewording the two doc-comment sentences to describe the hub's data hook
without spelling out its literal import name (e.g. "the reminders hub's own data hook
… performs task mutations (mark-done, snooze)" instead of naming `useReminders`/
`useUpdate` directly). Re-run after the fix: `DueRemindersCard.guard.test.ts` — 5/5
green (including the "has a non-empty set of sources to scan" sanity case, run first
and confirmed it fails loudly if the glob resolves nothing).

**A second, unplanned red/green cycle in `DueRemindersCard.test.tsx`** (component
tests), worth recording because it is a reusable lesson about this test stack, not a
story-specific bug:

1. `getBoundingClientRect().height` initially read `0` for every state (AC-2's
   height-equality assertion) — `vitest-browser-react` only applies Tailwind's compiled
   CSS to a test's DOM if that test file's module graph actually imports the
   stylesheet (`Entity360.responsive.test.tsx`'s own `import "@/index.css"` is the
   precedent). Fixed by adding the same import.
2. After that fix, mounting three states (loading/empty/full) in one test and calling
   the library's `cleanup()` between them caused every later test in the file to fail
   with a permanently empty `<body>`, preceded by `You seem to have overlapping act()
   calls`. Root cause, isolated by re-running subsets of the file
   (`npx vitest run --project app -t "…"`): `cleanup()` synchronously unmounts a React
   root, and the "loading" state's data provider deliberately never resolves any
   promise (that is how its `isPending: true` is held deterministically) — unmounting
   a root with a permanently in-flight query destabilizes the shared browser
   environment for the rest of the file, not just that test. Fixed two ways together:
   (a) never call `cleanup()` on the never-resolving-provider render (leave it mounted;
   harmless), and (b) query every render through its own `screen.locator` (`page
   .elementLocator(container)`, scoped to that render's container) rather than the
   top-level `screen.getByRole`/`getByText` shortcuts, which resolve against
   `document.body` as a whole and therefore collide once more than one render is
   mounted at once. Full file re-run after the fix: 7/7 green.

**AD-24 conformance guard**, run against the whole `entity360` + `dashboard` trees
after adding `dashboard/DueRemindersCard.tsx` / `dashboard/useDueReminders.ts` to the
`expect.arrayContaining` scan list: green — the "no-browse enumeration on a browse
surface" describe block confirms both new files are scanned and neither enumerates
`references`/`references_summary`.

**`e2e/dashboard-reminders-cls.spec.ts` was written but NOT executed in this session** —
no Vite dev server was confirmed running against the leased `STACK_ID=1` Supabase
stack, and starting one was outside this session's authorized commands (dispatch
instructions listed only `npm run typecheck`, `npx eslint`, and
`npx vitest run --project app <path>` as the gates to run and report). The spec
follows `e2e/demo-banner-cls.spec.ts`'s exact idiom (own admin client, `addInitScript`
sampling, deterministic `expect.poll` settle, no `waitForTimeout`) and was reviewed by
hand against that template rather than run. Flagging this honestly rather than
claiming a run that did not happen — running it (`STACK_ID=1 npx playwright test
e2e/dashboard-reminders-cls.spec.ts`) is the one verification step still open.

**Final full run** (as requested): `npm run typecheck` — clean. `npx eslint` on every
file this story touches, `--max-warnings=0` — clean. `STACK_ID=1 npx vitest run
--project app src/components/atomic-crm/dashboard src/components/atomic-crm/entity360`
— 50 files / 485 tests, all green. `node scripts/check-tailwind-arbitrary-var.mjs` —
clean (the icon-badge `bg-[color-mix(…)]` this card uses mirrors the identical,
already-accepted pattern in `AttentionSection.tsx`/`OutstandingCallsSection.tsx` — the
guard's bare-`--var` pattern does not match a `color-mix()` call). `node scripts/check
-retired-names.mjs .` — reports only the two findings already declared pre-existing in
this story's dispatch (`assets_base64.ts`, `manifest_base64.ts`); nothing new.

### Completion Notes List

- **AC-1**: `DueRemindersCard` is one component, mounted once each in `Dashboard.tsx`
  (first child of the `lg:col-span-4` column, above the `DashboardStat` grid) and
  `MobileDashboard.tsx` (first child of the populated branch, above
  `PipelineSnapshot`), both inside the existing `hasSuggestions` branch only (Task 3's
  own recorded scope decision — no third branch added). The component takes no props
  at all, so it cannot be scoped to the selected single even by accident; its hook
  (`useDueReminders`) issues one account-wide `tasks` query with no `member_id`/
  `single_id` filter.
- **AC-2**: the list region (`data-role="due-reminders-list"`) is a fixed
  `h-72` (18rem) Tailwind-scale height with `overflow-hidden`, never a `min-h-…`.
  Skeleton, rows, and the empty message all render inside it; the card never returns
  `null`. Verified as a number via `getBoundingClientRect().height` across
  loading/empty/full renders in the component test, not via `toHaveClass`.
- **AC-3**: no checkbox, no Snooze, no "Add a reminder" — the only navigation
  affordance is a plain `<Link to="/reminders">` ("See all reminders"), rendered in
  every state. Proven two ways: a behaviour test (`getByRole("checkbox")`/
  `getByRole("button", { name: /snooze/i })` absent with three rows on screen) and the
  `?raw` source-scan guard (`DueRemindersCard.guard.test.ts`) — which additionally
  scans for the literal string `useReminders`, not just the four mutation-hook names,
  per the story's own "Failing looks like" clause.
- **AC-4**: `MAX_ROWS = 3`, overdue rows first (free from the query's own
  `due_date ASC` sort — no client-side re-sort), `Since {…}`/`Due {…}` prefixes via
  `formatDueMoment`, an `and N more` overflow line. A `null` `due_date` (the DB column
  is nullable; `Task.due_date`'s app-wide `string` type is known to lie about that,
  per the story) renders the row's text with no due line at all — guarded first in the
  hook, never reaching `new Date(null)`/`isOverdue`.
- **AC-5**: `dashboard/useDueReminders.ts` never issues a `useGetList`/`getList` call
  naming `references`/`references_summary` — reference-targeted reminders resolve
  through `useGetList("reference_links", { filter: { "reference_id@in": "(…)" } }
  )` only. `ad24Conformance.guard.test.ts`'s `expect.arrayContaining` now names both
  new dashboard files so the scan is proven to cover them.
- **AC-6**: reference resolution lives entirely in the hook (`pickBestLinkPerReference`
  / `pickReferenceName`) — one link resolves trivially; more than one resolves to the
  most recent `created_at`, tie-broken by the highest `reference_links.id` (covered
  against the exact fixture shape — three links on one reference, two links sharing a
  `created_at`); zero links (an unattached reference) resolves to `link: null` and a
  generic fallback label, never a guessed `/references/{id}` link. The card wraps
  `{reference name} · about {shidduch name}` in ONE `RecordLink` pointing at
  `resource="shidduchim"` — the reference's own name is never itself the link target,
  and an unattached reference's row has no anchor of any kind.
- **AC-7**: every user-facing string routes through `useTranslate` with an inline `_`
  default, under a new `crm.reminders.dueCard` block (sibling of `outstandingCalls`) in
  both `englishCrmMessages.ts` and `frenchCrmMessages.ts`. `make typecheck` is the
  proof the French catalogue stayed in lockstep (`satisfies CrmMessages` — a missing
  key is a type error, not a runtime fallback).
- **AC-8**: no file under `supabase/` in this diff — confirmed by `git status`
  throughout; every resource this card reads (`tasks`, `reference_links`,
  `shidduchim`, `shadchanim`, `singles`) already exists with the RLS/grants it needs.
- **F6 (12.3 reconciliation)**: `TaskAssigneeChip` (`tasks/TaskAssigneeChip.tsx`) and
  its data hook `useTaskAssignees` (`tasks/useTaskAssignees.ts`, itself a plain
  `useGetList("context_members")` — no mutation) are imported directly into the card,
  exactly as `entity360/tabs/TasksRailSummary.tsx` already does for the same reason —
  no second chip was written. The card does **not** read 12.3's
  `useTaskAssigneeScope` store key: it stays account-wide, reaffirming AC-1 rather than
  weakening it, per the ruling.
- **F7 divergence (recorded, not an oversight)**: `reminders/useReminders.ts` and
  `ReminderCard.tsx` were re-read as they are now (post-12.3). Two real divergences
  from this story's original text, both decided and documented inline in
  `useDueReminders.ts`:
  1. `types.ts`'s `TaskTargetType` now has a fifth member, `connection` (Story 8.5),
     which did not exist when Task 1 was written as "three, not four". This card
     resolves only `shidduch`/`shadchan`/`single` (a fourth `useGetMany` call) plus
     `reference` (its own path); a `connection`-targeted task (and any other
     unrecognized target type) degrades to the same "no linked entity" rendering
     already used for a task with no `target_type` at all — never a guessed link,
     and no additional query the story's ACs never asked for. Documented at the
     relevant branch in `useDueReminders.ts`, cheap to widen later if a story needs it.
  2. `ReminderCard.tsx` post-12.3 also renders `TaskAssigneeChip` on every row (AC-10)
     — this card mirrors that (see F6 above) rather than the pre-12.3 hub shape the
     story text was written against.
- **Neither `reminders/**` nor `entity360/ad24Conformance.ts` (the rule itself) was
  touched** — only the guard test's scan list grew, exactly as declared.
- **AD-10 lockstep verified, not re-derived**: the component tests exercise the real
  FakeRest `reference_links` → `reference_links_summary`-equivalent join
  (`providers/fakerest/internal/referenceSummary.ts`'s `enrichReferenceLinks`) end to
  end, including the `@in` filter path — nothing needed changing on either provider.
- **`registry.json`** was regenerated (`make registry-gen`) after adding the two new
  non-test modules, since no pre-commit hook will run in this session (no commit is
  being made). Diff is exactly the two new entries under `dashboard/`.
- Pre-existing dirty state in this shared checkout, **not touched and not caused by
  this story**: `.gitignore` (adds `.env.stripe`) and
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md` were already modified
  on disk before this session started (concurrent Story 12.4 work, per Epic 12's
  binding delivery order). Left exactly as found.

### File List

**New**
- `src/components/atomic-crm/dashboard/useDueReminders.ts`
- `src/components/atomic-crm/dashboard/DueRemindersCard.tsx`
- `src/components/atomic-crm/dashboard/useDueReminders.test.tsx`
- `src/components/atomic-crm/dashboard/DueRemindersCard.test.tsx`
- `src/components/atomic-crm/dashboard/DueRemindersCard.guard.test.ts`
- `e2e/dashboard-reminders-cls.spec.ts`

**Modified**
- `src/components/atomic-crm/dashboard/Dashboard.tsx`
- `src/components/atomic-crm/dashboard/MobileDashboard.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts`
- `registry.json` (generated — `make registry-gen`, no hand edits)

**Not touched** (as the story declares): `supabase/**`, `types.ts`,
`reminders/**`, `entity360/ad24Conformance.ts`, `tourSteps.ts`,
`providers/fakerest/dataGenerator/**`.
