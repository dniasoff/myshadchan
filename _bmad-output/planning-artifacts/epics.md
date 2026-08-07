---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories"]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md
  - _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md
  - mockup/MyShadchan.dc.html
  - mockup/screenshots/
  - design-artifacts/design-language.md
  - design-artifacts/gap-analysis-v3.md
---

# MyShadchan - Epic Breakdown

## Overview

Complete epic and story breakdown for MyShadchan Phase 1, decomposing the PRD, PRD
Amendment A2, the Architecture Spine and the design comp into implementable stories.

**Phase 1 is one plan shipped in dependency order** (D17). Nothing is descoped; each
epic is independently shippable.

**Governing standard (NFR-14, D19):** greenfield. All technical debt cleared before
feature work. No backwards compatibility, no deprecation shims, no fallbacks, no aliased
views or columns. One code path per behaviour — when something is replaced, the replaced
thing is deleted in the same change.

**The blocker inherited by everything:** `public.current_account_id()` resolves a user to
one arbitrary account (`order by am.id limit 1`) and every RLS policy depends on it.
Personas and contexts are unbuildable until it is rewritten (Epic 2).

## Requirements Inventory

### Functional Requirements

**From PRD v1 (FR1–FR78)** — the core loop (capture → inbox → dedupe → triage), shadchan
management, suggestion/resume detail, references, reminders, resume sharing, multi-child,
search/dashboard, auto-parse, AI research, the single's experience, billing. Substantially
delivered; see `gap-analysis-v3.md` for what is genuinely built. Re-storied here only
where A2 changes them.

**From Amendment A2 (new):**

- FR79: A login may hold any combination of single, parent, shadchan personas.
- FR80: Onboarding asks which personas apply, as a multi-select.
- FR81: Personas can be added or removed at any time, without re-registration.
- FR82: Removing a persona archives, never deletes; history remains auditable.
- FR83: Two context types — Household and Shadchanus; shadchan work never sits in a household.
- FR84: The active context is explicit, user-selected, surfaced by a switcher, never inferred.
- FR85: Contexts are provisioned on demand when a persona is added.
- FR86: The entity is a **single**, not a "child".
- FR87: A self-managing person is a single record in their own household, linked by member_id.
- FR88: Fork fossils deleted; `sales` renamed `members`.
- FR89: No table, column, route or component may retain a misdescriptive name.
- FR90: A single logs in and sees the same views as the parent — no separate portal UI.
- FR91: Difference is permission, not interface — enforced in the database.
- FR92: A single has a profile and a resume, same person-shape as a candidate.
- FR93: The dignity floor holds and cannot be switched off.
- FR94: Any persona pair may communicate.
- FR95: Threads are subject-scoped structured records, not free-form chat.
- FR96: Default thread visibility is open to all parties in context.
- FR97: Privacy is opted into per discussion; visibility is a property of the thread.
- FR98: Private threads are available to any two parties.
- FR99: Families may set the default posture; shipped default is open.
- FR100: Delivery in-app + email + push; no outbound SMS, ever.
- FR101: A shadchan may publish a professional listing.
- FR102: A single may publish a listing profile, field by field.
- FR103: Only the manager of a single may publish that single's listing.
- FR104: A single with a login may always withdraw their own listing.
- FR105: Withdrawal removes the listing from search immediately.
- FR106: Public search returns only published listings and published fields.
- FR107: Revocable, expiring share links for a single's profile/resume.
- FR108: Shadchan login into a Shadchanus context.
- FR109: Consent-based connection; no directory-driven or automatic linkage.
- FR110: In-platform redting, recorded with `origin='shadchan'`.
- FR111: Shadchan-originated suggestions arrive for review, never auto-filed.
- FR112: A shadchan tracks their own conversations in their own context.
- FR113: A shadchan sees only threads they are party to — never private notes, candid
  reference words, dating history, other shadchanim's suggestions, or the single's data.
- FR114: Passwordless sign-in — magic-link / email-OTP load-bearing.
- FR115: Passkeys as a later progressive enhancement, never sole factor.
- FR116: Invite-token signup only; `role ≤ inviter authority`; role never from request body.
- FR117: 18+ affirmation at signup.
- FR118: Password and Google sign-in deleted.
- FR119: Invites are the one mechanism for household membership, single logins and
  parent↔shadchan connections.

### NonFunctional Requirements

- NFR-1–13: carried from PRD v1 (performance, security, availability, accessibility).
- **NFR-14 (new):** Greenfield standard — debt cleared first; no backwards compatibility,
  shims, fallbacks or aliases; one code path per behaviour; tidy code is an acceptance
  criterion.

### Additional Requirements

- **AD-1 / AD-2 amendment required** — account scoping and the membership/role model must
  become context-aware and persona-capable.
- **AD-4** — `origin='shadchan'` activated (was reserved).
- **AD-7** — all inbound, including shadchan-originated, enters via the confirm step.
- Supabase RLS is the enforcement layer; the app never enforces visibility alone.
- Schema-first workflow: edit `supabase/schemas/*`, generate a migration, apply.
- Every RLS change requires a negative test proving the wrong role sees nothing.

### UX Design Requirements

- UX-DR1: One `Entity360` shell, fixed regions in fixed order.
- UX-DR2: One route convention for every entity.
- UX-DR3: Records live at URLs, not modals.
- UX-DR4: Shared tab vocabulary written once and reused.
- UX-DR5: Entity tab matrix (single / shidduch / shadchan / reference).
- UX-DR6: `RecordLink` primitive for every record mention.
- UX-DR7: One `EntityList` framework with URL-held state.
- UX-DR8: References have no browse surface — reached only from a shidduch (RULING 7).
- UX-DR9: Reuse awareness is mandatory wherever a reference is used.
- UX-DR10: Navigation set; `References` is not a destination at all (RULING 7).
- UX-DR11: Every screen renders empty/loading/error, light+dark, at 375px.

### Standing owner rulings

Rulings are decisions of the project owner. They outrank a story, an epic and a contract
paragraph, they have no retiring story, and they are amended only by the owner.

**RULING 7 — a reference exists only within a shidduch's context.**

> *"references only exist as part of an individual shidduch and cannot be browsed separately
> although the same reference can appear for multiple shidduchim … it would be useful to see
> this. but no browsing to references outside a shidduch's context."*

1. **No browse surface.** No `References` entry in the primary navigation, no mobile overflow
   item, no dashboard tile, no tour step, no `EntityList` for `references`, and no query that
   returns an unfiltered or free-text-filtered page of reference records to a user who has not
   named a shidduch. References also leave global search: a global search that returns reference
   records is a browse surface under another name.
2. **`/references/{id}` stays.** The flat AD-24 record path is retained. A deep link to a record
   the viewer already has access to is addressability, not browsing.
3. **A reference stays a full entity.** Its 360, timeline, notes, tasks, call log, diligence,
   merge and match-on-entry are unchanged. Only reachability changes.
4. **Cross-shidduch visibility is required, from inside the reference.** The `shidduchim` tab
   renders every shidduch the reference serves. This is a feature, not a leak (UX-DR9).
5. **Entry is always from a shidduch.** Creating a reference without a resolvable shidduch is
   refused, not silently allowed.
6. **This is a product decision, not a security boundary.** It is not enforced with RLS and must
   never be: within an account the reference book is deliberately account-wide (FR51), and
   narrowing the policy to enforce this ruling would break clause 4, merge and match-on-entry
   for no privacy gain.

Enforcement is mechanical, in Story 3.11 AC 10 (`NO_BROWSE_SURFACE_ENTITIES` in
`entity360/ad24Conformance.ts`) — a **positive** assertion, because the existing
`unreachable-nav-target` rule keys off `!!definition.list` and `references` keeps a truthy
`list` as its route mount, so it would wave a re-added nav entry straight through.

**RULING 8 — the shadchan Overview tab shows last redt + active singles.**

`shadchan_stats` (`03_views.sql:202-211`) ships only three tiles — `nb_suggestions`,
`nb_progressed`, `nb_reached_yes` — none of which is the header fact a matchmaker actually wants
first: when did I last redt, and how many singles do I currently have live. `Shadchan` itself
carries no redt column and no derivable "active singles" count, so without a view change the
Overview tab (the default landing tab) would render an empty state for every shadchan record.

1. **Two new columns, derived with zero new joins.** `last_redt_date` = `max(s.redt_date)` and
   `nb_open_singles` = `count(distinct s.single_id) filter (where s.pipeline_state in ('new',
   'look_into', 'not_sure'))`, both from the existing `shidduchim` join `shadchan_stats` already
   performs. The "open" predicate is a verbatim reuse of `singles_summary`'s filter
   (`03_views.sql:185-187`).
2. **Attribution is `shidduchim`-sourced, not `redts`-sourced, by design.** `max(s.redt_date)` over
   `shidduchim` is "last time this shadchan is the **current** redter of something" — consistent
   with every other tile on the view, which is already scoped by current attribution
   (`03_views.sql:194-201`). A `redts`-sourced "last time this shadchan redt anything, ever" would
   disagree with `nb_suggestions` and the suggestions list directly beneath it, and `redts` has no
   `shadchan_id` index. The semantic caveat (a superseded redt is not counted) is recorded in the
   view comment, not treated as a defect.
3. **New columns are appended, never inserted mid-list**, so `CREATE OR REPLACE VIEW` stays an
   append and the migration never becomes a `drop view`/`create view` pair — which would silently
   drop the view's grants.
4. **`security_invoker = on` must be hand-added to the migration.** `supabase db diff` does not
   preserve or re-emit reloptions on `CREATE OR REPLACE VIEW`; the generated migration needs a
   trailing `alter view "public"."shadchan_stats" set (security_invoker = on);` or the view runs as
   owner and RLS never applies to it.

Owned by Story 5.9 (Shadchan 360), Task 2b.

### FR Coverage Map

| Epic | Requirements covered |
|---|---|
| 1 — Debt clearance & entity truth | FR86–89, NFR-14 |
| 2 — Identity: personas, contexts, invites | FR79–85, FR114–119, AD-1/AD-2 |
| 3 — The 360° framework | UX-DR1, UX-DR3, UX-DR4, UX-DR6, UX-DR11 |
| 4 — Navigation & lists | UX-DR2, UX-DR7, UX-DR10 |
| 5 — Entity 360s | UX-DR5, UX-DR8, UX-DR9, FR92 |
| 6 — The single's access | FR90–93 |
| 7 — Communication | FR94–100 |
| 8 — Shadchan context | FR108–113, AD-4, AD-7 |
| 9 — Listings & sharing | FR101–107, PRV-13 |
| 10 — Capture funnel completion | FR27–28, FR78, PRD §13 |
| 11 — AI layer | PRD §13–14, billing gate |
| 12 — Phase-1 completion & operational readiness | FR44–46, FR54, PRD §14 billing; AD-13 |

Note on Epic 5: FR60 (the guided call script) is covered by **Story 5.12**, added 2026-07-30.

## Epic List

1. **Debt Clearance & Entity Truth** — delete the fork, make names honest
2. **Identity: Personas, Contexts & Invites** — the foundation everything sits on
3. **The 360° Framework** — one shell, one tab vocabulary
4. **Navigation & Lists** — consistent, predictable movement
5. **Entity 360s** — single, shidduch, shadchan, reference
6. **The Single's Access** — same views, permission-scoped
7. **Communication** — threads across every persona pair
8. **Shadchan Context** — connections, redting, their own book
9. **Listings & Sharing** — opt-in publication, revocable links
10. **Capture Funnel Completion** — share, inbox, attribution
11. **AI Layer** — dossier and auto-parse, server-gated
12. **Phase-1 Completion & Operational Readiness** — the FR1–FR78 surfaces that shipped
    incomplete, and the deployment that makes them real
13. **When a Family Changes** — a child looked after by two households, and a person no longer
    part of one

---

## Epic 1: Debt Clearance & Entity Truth

Remove every trace of the Atomic CRM fork and make the schema describe shidduchim
honestly, so that every later epic is smaller and no developer or agent has to guess
which "contact" is real. Greenfield: delete outright, no deprecation.

**Delivery order (binding): 1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6.** The stories are not
interchangeable; each step below is the reason the one before it has to land first.

1. **1.1 first** — it deletes the fossil resources, so every later story renames and
   re-registers a smaller surface instead of touching files that are about to disappear.
   Being first is also why **1.1 owns the whole `/import` surface** (see scope decisions).
2. **1.4 before 1.3** — 1.4's migration drops a composite FK that targets
   `children(account_id, id)`; once 1.3 renames the table that reference no longer
   resolves.
3. **1.5 before 1.3 and 1.2** — 1.5 replaces the `<Resource>` / `<Route>` JSX in
   `root/CRM.tsx` with a `routeManifest.ts`, so 1.3 and 1.2 must edit manifest entries,
   not JSX that no longer exists. 1.5 also deletes `settings/ProfileForm.tsx` and
   `settings/ProfilePage.tsx`, which 1.2 would otherwise rename symbols inside. 1.5 owns
   `/changelog` and `/profile`; it does **not** own `/import` (see scope decisions).
4. **1.3 before 1.2** — no dependency between the two renames; they are sequenced rather
   than run concurrently so each one's retired-name grep has a single correct answer.
5. **1.1 before 1.2** — 1.1 deletes files that still carry `sales_id`, so 1.2's call-site
   inventory is only correct once 1.1 (and 1.5) have landed.
6. **1.6 last** — it is the closing gate: it asserts lint, typecheck, tests, CI and the
   retired-name guard over the finished state, so running it earlier only measures work
   in progress.

### Story 1.1: Delete the fossil resources

As a developer,
I want the Atomic CRM entities removed entirely,
So that the codebase contains only concepts that exist in shidduchim.

**Acceptance Criteria:**

**Given** the schema contains `contacts`, `companies`, `deals`, `deal_notes`, `contact_notes`, `tags` and `favicons_excluded_domains`
**When** the cleanup migration is applied
**Then** those tables, their views, policies, grants, triggers and sequences no longer exist
**And** their React resources, routes, components, fixtures and generators are deleted
**And** no import, type or string in `src/` references them.

### Story 1.2: Rename `sales` to `members`

As a developer,
I want the user/profile table named for what it holds,
So that the identity model is legible.

**Acceptance Criteria:**

**Given** the user/profile table is named `sales`
**When** the rename migration is applied
**Then** the table, its FKs, policies, grants and all code references are `members`
**And** no alias, view or compatibility shim to `sales` remains.

### Story 1.3: Rename `children` to `singles`

As a product owner,
I want the entity called a single,
So that the model is not false for a widow, divorcee or independent adult.

**Acceptance Criteria:**

**Given** the entity is named `children` across schema, routes, components and copy
**When** the rename lands
**Then** schema, routes (`/singles`), components, types and user-facing copy all say "single"
**And** no alias or redirect from the old name remains
**And** the seeded demo data reflects the new naming.

### Story 1.4: Retire the token portal

As a developer,
I want the child-portal token surface deleted,
So that there is one way a single sees their data (Epic 6), not two.

**Acceptance Criteria:**

**Given** `portal/`, `child_portal_tokens` and `get_child_portal()` exist
**When** this story completes
**Then** all three are deleted along with their tests, routes and provider methods
**And** the outbound share-link requirement (FR107) is carried by Epic 9, not by this surface.

### Story 1.5: Remove dead routes and superseded surfaces

As a user,
I want no route that renders nothing,
So that the app never dead-ends.

**Acceptance Criteria:**

**Given** `/tasks` currently redirects to `/reminders` and other legacy routes exist
**When** this story completes
**Then** every registered route renders a real screen
**And** the `/tasks` redirect is removed in favour of the real Tasks surface
**And** an automated check fails if a registered route renders empty.

### Story 1.6: Establish the tidy-code baseline

As a developer,
I want lint, typecheck and tests green with no suppressions,
So that "tidy code" is enforced rather than aspirational.

**Acceptance Criteria:**

**Given** the cleanup is complete
**When** CI runs
**Then** typecheck, lint, prettier and the full test suite pass with zero warnings
**And** no `eslint-disable`, `@ts-ignore` or skipped test was added to achieve it.

### Epic 1 scope decisions

These were reviewed and decided; they are deferrals, not oversights. Anything listed here
is out of scope for all six stories and must not be re-opened inside them.

**Fork residue deliberately left in place**

- `.claude/skills/delete-initial-resource/` — agent tooling, not shipped code. It is
  retired when the skill set is next revised, not by an Epic 1 story.
- `CHANGELOG.md` — the repo file stays. 1.5 removes the in-app `/changelog` route and
  page; it does not remove the file.
- `src/components/atomic-crm/` — the directory name is frozen for Epic 1. Renaming it
  rewrites every import path in the repo and would collide with all five other stories.
  1.6 freezes it explicitly; revisit after Epic 1, as its own change.

**The `anon` grant surface survives Epic 1 by design**

1.1 leaves the `alter default privileges … to anon` block, 1.2 keeps `init_state` as
`security_invoker = off`, and 1.4 leaves the remaining fork `to anon` grants alone. This
is intentional: the `anon` surface is closed by Epic 2 under AD-1. **1.4's acceptance
criteria must not be read as "anon is closed"** — 1.4 only retires the token portal.

**E2E suite: kept, not deleted — with a known interim red**

`e2e/` and the CI `e2e-test` job both survive Epic 1. 1.1 deletes the three fossil specs
(`bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts`) and keeps the
directory, `e2e/fixtures.ts`, `playwright.config.ts` and the `test-e2e*` make targets; **1.6
— and only 1.6 — adds the one real smoke spec** (`e2e/pipeline.spec.ts`). No other story
writes, renames or deletes a spec.

Between the two, `make test-e2e-ci` runs Playwright against an empty `testDir` and exits **1**
with `Error: No tests found`. That red spans 1.4, 1.5, 1.3 and 1.2 and is an **accepted
consequence of the pinned order**, stated in each of those stories so it is not mistaken for a
regression. It is not a licence to delete the job, the directory or the make targets, and not a
reason to keep a fossil spec alive. If the product owner wants CI green throughout, the fix is
to move 1.6's smoke spec forward into 1.1 — a correct-course on the epic, not an improvisation
inside a story.

**The `/import` surface belongs to 1.1, not 1.5**

Successive drafts moved it between the two. It is settled on **1.1** and must not be moved
again: 1.1 runs first and deletes the three modules `misc/useImportFromJson.ts:12-15` imports
(`Tag` from `types.ts`, `colors` from `tags/`, `contactGender` from `contacts/`), so the surface
cannot typecheck for the two stories between 1.1 and 1.5 under any other split — and NFR-14
forbids bridging the gap with a stub, an `any` or a `@ts-ignore`. 1.1 therefore takes the whole
surface in one pass: `misc/ImportPage.tsx`, `misc/useImportFromJson.ts`, `misc/import-sample.json`,
the `root/CRM.tsx` route and import, `ImportFromJsonMenuItem` (and the `Import` icon) in
`layout/TopBar.tsx`, the `crm.import` / `crm.header.import_data` i18n keys, the fixture
`test-data/import-sample-invalid-sale.json`, and `doc/users/import-data.mdx`.

Consequence to accept, not to re-litigate: `layout/TopBar.tsx`'s `<UserMenu>` block is edited by
1.1 (one menu item), then 1.5 (two more), then 1.2 (`UsersMenuItem`'s link). Under the pinned
order these are sequential rebases, not concurrent edits.

**Repo-wide prettier is 1.6's gate alone**

`npm run prettier` fails on **89 files** on `main` (plus `mockup/MyShadchan.dc.html`, which
prettier cannot parse), almost all of them in files stories 1.1–1.5 never open, and part of the
remedy is `.prettierignore` policy. Stories **1.1, 1.2, 1.3, 1.4 and 1.5** therefore require
prettier clean **only on the files each story creates, renames or modifies**; `npm run
typecheck` and `npm run lint` (eslint) stay repo-wide gates in every story, as both pass on
`main` today. Making repo-wide prettier green is story **1.6**'s acceptance criterion. Note that
`make lint` bundles eslint *and* prettier, so it is not a usable gate before 1.6.

---

## Epic 2: Identity — Personas, Contexts & Invites

Replace one-user-one-account-one-role with a model where a person may be a single, a
parent and a shadchan at once, across household and shadchanus contexts, for life.
This is the foundation; nothing after it works without it.

### Story 2.1: Context-aware authorisation *(the blocker)*

As a platform owner,
I want authorisation to derive from an explicit active context,
So that a user with several contexts sees exactly the one they chose.

**Acceptance Criteria:**

**Given** `current_account_id()` returns one arbitrary account via `order by am.id limit 1`
**When** the context-aware resolver replaces it
**Then** the active context is explicit and user-selected, never inferred
**And** every RLS policy is migrated to the new resolver with no single-account fallback
**And** a negative test proves a user in two contexts sees nothing from the inactive one
**And** the old function is deleted, not deprecated.

### Story 2.2: Persona and context data model

As a developer,
I want personas and contexts modelled explicitly,
So that provisioning and authorisation have one source of truth.

**Acceptance Criteria:**

**Given** a login may hold single, parent and shadchan personas
**When** the model is applied
**Then** personas are recorded per member, and contexts are typed Household or Shadchanus
**And** a shadchanus context can never hold household records, enforced at the database
**And** RLS prevents any cross-context read.

### Story 2.3: Onboarding persona multi-select

As a new user,
I want to say whether I am a single, a parent, a shadchan — or more than one,
So that the app is provisioned for how I actually use it.

**Acceptance Criteria:**

**Given** I am completing onboarding
**When** I am asked which apply
**Then** I can tick any combination of single, parent and shadchan
**And** ticking "single" creates a household with a single record pointing at me
**And** ticking "parent" creates a household and prompts me to add my singles
**And** ticking "shadchan" provisions a separate shadchanus context
**And** ticking both single and parent yields one household containing me and my children.

### Story 2.4: Context switcher

As a user with more than one context,
I want to switch between my family and my shadchanus,
So that I always know which hat I am wearing.

**Acceptance Criteria:**

**Given** I hold both a household and a shadchanus context
**When** I use the switcher in the app shell
**Then** the active context changes and all data reflects it immediately
**And** the current context is visible at all times
**And** a user with one context sees no switcher clutter.

### Story 2.5: Personas change over a lifetime

As a user whose circumstances change,
I want to add or remove a persona at any time,
So that the app follows my life rather than my signup day.

**Acceptance Criteria:**

**Given** I registered as a parent only
**When** I add the single persona later from settings
**Then** a single record pointing at me is created in my household, with no re-registration
**And** when I remove a persona, its records are archived and remain auditable
**And** no history, suggestion, reference or thread is deleted by removing a persona.

### Story 2.6: Passwordless sign-in

As a non-technical user,
I want to sign in with an emailed link,
So that I never manage a password.

**Acceptance Criteria:**

**Given** I enter my email
**When** I request sign-in
**Then** I receive a magic link / OTP that signs me in
**And** password and Google sign-in are removed from the codebase entirely
**And** no fallback authentication path remains.

### Story 2.7: Invite-only signup with 18+ affirmation

As a platform owner,
I want new members to join only by verified invite,
So that consent-based connections are safe by construction.

**Acceptance Criteria:**

**Given** an invite token issued by an existing member
**When** the invitee accepts
**Then** they are bound to the inviter's context with `role ≤ inviter authority`
**And** `role` is never read from the request body
**And** signup requires an 18+ affirmation
**And** signup without a valid invite is refused.

### Story 2.8: Invites as the one membership mechanism

As a parent,
I want one way to bring in my spouse, a helper, or my single,
So that membership is predictable.

**Acceptance Criteria:**

**Given** I want to add someone to my household
**When** I invite them
**Then** the same invite mechanism serves spouse, helper and single
**And** the same mechanism establishes a parent↔shadchan connection (Epic 8)
**And** an invite can be revoked before acceptance.

---

## Epic 3: The 360° Framework

One shell and one tab vocabulary used by every entity, so the app is predictable and new
entities are cheap. This is a CRM: consistency outranks per-screen invention.

### Story 3.1: `Entity360` shell

As a user,
I want every record to look and behave the same,
So that I learn the app once.

**Acceptance Criteria:**

**Given** any entity's 360 view
**When** it renders
**Then** regions appear in fixed order: breadcrumb, identity header, stat band, alert slot, tab bar, content, optional right rail
**And** regions are optional per entity but never reordered or restyled
**And** it renders correctly light and dark, and at 375px.

### Story 3.2: URL-backed tabs

As a user,
I want to link someone straight to a tab,
So that sharing and browser navigation work.

**Acceptance Criteria:**

**Given** a 360 view with tabs
**When** I switch tab
**Then** the URL becomes `/{entity}/{id}/{tab}` and is deep-linkable
**And** browser back and forward move between tabs correctly
**And** an unknown tab falls back to the first tab.

### Story 3.3: Entity descriptor registry

As a developer,
I want each entity to declare its 360 rather than hand-roll it,
So that no entity drifts.

**Acceptance Criteria:**

**Given** a new or existing entity
**When** its descriptor declares label, icon, route, avatar, title, meta, stats, tabs, actions and relationships
**Then** its 360 and list render entirely from that declaration
**And** no entity contains bespoke layout code.

### Story 3.4: Permission-aware rendering

As a platform owner,
I want fields and tabs to respect the viewer,
So that one view can safely serve parent, single, helper and shadchan.

**Acceptance Criteria:**

**Given** a field or tab declares a minimum visibility
**When** a viewer without that visibility opens the record
**Then** the field or tab is absent from the rendered output and from the DOM
**And** the underlying data was never sent to the client
**And** a negative test proves it for each role.

### Story 3.5: Universal Activity tab

As a user,
I want a consistent history on every record,
So that I can see what happened without hunting.

**Acceptance Criteria:**

**Given** any entity
**When** I open Activity
**Then** I see an append-only, paginated event log in a consistent format
**And** entries link to related records via `RecordLink`.

### Story 3.6: Universal Notes tab

As a user,
I want notes on any record,
So that context lives with the thing it describes.

**Acceptance Criteria:**

**Given** any entity
**When** I add, edit or delete a note
**Then** it is stored against that record with author and timestamp
**And** empty, loading and error states render.

### Story 3.7: Universal Files tab

As a user,
I want to attach files to any record,
So that documents live where they belong.

**Acceptance Criteria:**

**Given** any entity
**When** I upload, replace or delete a file
**Then** it is stored with type, size and per-file visibility
**And** files are access-controlled with no public URLs.

### Story 3.8: Universal Tasks tab

As a user,
I want record-scoped tasks,
So that follow-up attaches to the thing it is about.

**Acceptance Criteria:**

**Given** any entity
**When** I add a task from its Tasks tab
**Then** the task is linked to that record and appears in the global Tasks list
**And** completing it there reflects everywhere.

### Story 3.9: `RecordLink` primitive

As a user,
I want every mention of a record to be clickable and go to the same place,
So that navigation is predictable.

**Acceptance Criteria:**

**Given** a record is mentioned on a board card, list row, timeline entry, rail panel or search result
**When** it renders
**Then** it uses the single `RecordLink` component and routes to that record's 360
**And** no ad-hoc record links remain in the codebase.

### Story 3.10: Shared tab vocabulary (UX-DR4)

A closed `TabKey` union, canonical tab labels, and the shared `Overview` / `Related` tab
components that ~30 downstream Epic 4–11 stories converge on instead of each inventing its own
tab name.

### Story 3.11: AD-24 conformance validator

A test-enforced guard — modelled on `root/routeManifest.ts`'s `findManifestViolations` — that
fails CI if a future entity bypasses the 360 framework: an unregistered descriptor, a `<Show>`
outside `entity360/`, a `<Dialog>` wrapping a primary record, or a `buildRecordPath` that
doesn't match the AD-24 shape.

### Story 3.12: One route convention — `/{entity}/new`

Renames the 14 live `/create` links to `/new`, overrides `useCreatePath` / `CreateButton` /
`EditButton` so Create and Edit stop colliding with the AD-24 show URL, and gives list-only
`<Resource>` registrations explicit `hasShow` / `hasEdit` so `<DataTable>` row clicks keep
resolving.

### Story 3.13: Records at URLs, not modals (UX-DR3)

Converts the last primary-record modals (`shidduchim/ShidduchCreate.tsx`, `tasks/TaskEdit.tsx`)
to routed pages, closing the UX-DR3 gap that no story from Epic 3 through Epic 9 otherwise owned.

### Story 3.14: Context scope lift — `tasks` and `interactions`

Lifts `enforce_household_scope()` off `public.tasks` and `public.interactions` (project-owner
Ruling 1) via a carefully staged migration rehearsed against a seeded local database, so a
shadchan can record a task or log an interaction inside their own shadchanus context. Blocking
dependency of 3.5, 3.6 and 3.8.

**Build order (binding — [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §12]):**
the epic is not built 3.1→3.14 in file order. Canonical sequence: **3.10** (step 0 — tab
vocabulary and the `EntityDescriptor` rewrite) → **3.1** → **3.3a** (descriptor types + registry,
split out of 3.3) → **3.9** (`RecordLink` + the four stub descriptors — must precede 3.8) →
**3.2** (routes) → **3.12** (route-convention adoption, immediately after 3.2) → **3.3b**
(`EntityShow`) → **3.4** (permission-aware rendering) → **3.14** (household-scope lift — blocks
3.5/3.6/3.8; may be rehearsed in parallel with the steps above) → **3.5** → **3.6** → **3.8** →
**3.7** → **3.11** (conformance validator, last). **3.13** has no fixed numeric slot: it depends
on 3.2 and 3.12 and must land before Epic 5's first migration. Epic 5 does not start until every
step above is done.

---

## Epic 4: Navigation & Lists

Predictable movement: one route convention, one list framework, one navigation set.

### Story 4.1: `EntityList` framework

As a user,
I want every list to behave the same,
So that search and filtering are never a surprise.

**Acceptance Criteria:**

**Given** any entity list
**When** I search, filter, sort or page
**Then** behaviour and controls are identical across entities
**And** all state is held in the URL and survives refresh and sharing
**And** empty, loading and error states render.

### Story 4.2: List / Cards toggle

As a user,
I want to choose how a list is displayed,
So that I can scan or browse as suits me.

**Acceptance Criteria:**

**Given** any entity list
**When** I toggle between List and Cards
**Then** the control sits in the same place with the same behaviour everywhere
**And** my choice persists per entity.

### Story 4.3: Shidduchim list view

As a parent,
I want a searchable list of suggestions as well as the board,
So that I can find one without scanning columns.

**Acceptance Criteria:**

**Given** a single with suggestions
**When** I open Shidduchim
**Then** I see a searchable list with List/Cards toggle and a switch to the board
**And** board and list share filters and context when switching
**And** Shidduchim appears in the primary navigation.

### Story 4.4: Navigation set and context switcher

As a user,
I want a stable navigation set,
So that destinations do not move.

**Acceptance Criteria:**

**Given** I am signed in
**When** I view the navigation
**Then** it shows Dashboard, Inbox, Pipeline, Shidduchim, Shadchanim, Tasks, Reminders, Settings, plus the context switcher
**And** References is not a destination at all — no nav entry, no overflow item, no dashboard
tile and no tour step (RULING 7)
**And** mobile exposes the same destinations, with overflow where needed.

### Story 4.5: Global search

As a user,
I want one search across everything,
So that I can find a person without knowing their type.

**Acceptance Criteria:**

**Given** any record in my active context
**When** I search from anywhere
**Then** results span entities and render as `RecordLink`s
**And** results never cross a context or account boundary.

---

## Epic 5: Entity 360s

Each entity onto the shell, with the tab matrix from UX-DR5. The suggestion 360 is the
product's most important screen and is currently ~15% of its design.

### Story 5.1: Shidduch 360 as a page

As a parent,
I want the suggestion opened as a full page,
So that I can work in it and link to it.

**Acceptance Criteria:**

**Given** a suggestion
**When** I open it from the board or a list
**Then** it opens at `/shidduchim/{id}` as a page on the shell, not a modal
**And** the routed dialog is deleted
**And** back returns me to where I came from.

### Story 5.2: Shidduch Overview tab

As a parent,
I want the candidate's details in one place,
So that I can assess without hunting.

**Acceptance Criteria:**

**Given** a suggestion
**When** I open Overview
**Then** I see name (both scripts), age/DOB, height, background, location, shul, current and earlier yeshiva, father, mother, marital status and children
**And** absent fields are omitted rather than shown blank or invented.

### Story 5.3: Resume tab with version history

As a parent,
I want the resume stored with its versions,
So that I always have the newest and can see what changed.

**Acceptance Criteria:**

**Given** a suggestion with a resume
**When** I open Resume
**Then** I can view, download and replace it
**And** previous versions remain listed with dates, newest shown by default
**And** the original file is never mutated.

### Story 5.4: Photo tab with explicit visibility

As a parent,
I want the photo handled carefully,
So that it is never exposed by accident.

**Acceptance Criteria:**

**Given** a suggestion with a photo
**When** I open Photo
**Then** it is hidden behind an explicit reveal
**And** I can upload, replace or hide it and choose who may see it
**And** it is never included in a share unless I choose it.

### Story 5.5: Medical tab (sensitive tier)

As a parent,
I want medical notes kept to the tightest circle,
So that disclosure is deliberate.

**Acceptance Criteria:**

**Given** a medical note
**When** any non-entitled viewer opens the record
**Then** the tab and its data are absent, enforced by RLS not UI
**And** a negative test proves a single and a helper cannot read it.

### Story 5.6: Files and External links tabs

As a parent,
I want other documents and profile links kept separately,
So that the resume stays canonical.

**Acceptance Criteria:**

**Given** a suggestion
**When** I add a voice note, screenshot or site link
**Then** files appear under Files, distinct from the resume, and links under External links
**And** links open in a new tab and share nothing back.

### Story 5.7: Shidduch right rail

As a parent,
I want context and actions beside the record,
So that the next step is obvious.

**Acceptance Criteria:**

**Given** a suggestion
**When** I view it
**Then** the rail shows the single's input, reminders on this suggestion, forward resume and share
**And** each action is available without leaving the page.

### Story 5.8: Single 360

As a parent,
I want my own single to have the same 360,
So that the app is consistent.

**Acceptance Criteria:**

**Given** one of my singles
**When** I open their record
**Then** I see Overview, Resume, Photo, Files, Shidduchim, Notes, Tasks, Activity on the same shell
**And** their resume is the one I send out to shadchanim.

### Story 5.9: Shadchan 360

As a parent,
I want a shadchan's record to match,
So that I can see our history at a glance.

**Acceptance Criteria:**

**Given** a shadchan
**When** I open their record
**Then** I see Overview, Suggestions, Notes, Tasks, Activity, with contact quick actions and a stat band
**And** the suggestions list uses `RecordLink`.

### Story 5.10: Reference 360 and per-shidduch diligence

As a parent,
I want diligence to live under the suggestion it is about,
So that a reference is never orphaned from its context.

**Acceptance Criteria:**

**Given** a suggestion
**When** I open its Diligence tab
**Then** I see people to speak to with progress ("N of M spoken to")
**And** each person states whether this is a first conversation or one of several
**And** a reference person still has their own 360 at `/references/{id}`, reached from a
shidduch's diligence — never from navigation, a list or search (RULING 7)
**And** from inside that 360 I can see every shidduch the same reference serves.

### Story 5.11: Call logging and tailored questions

As a parent,
I want to record a reference call as it happens,
So that nothing is lost.

**Acceptance Criteria:**

**Given** I am speaking to a reference
**When** I log the call
**Then** I can record answered / no answer / call back / they'll call back, with notes
**And** questions are tailored to that person's relationship
**And** the call appears in the suggestion's Activity.

### Story 5.12: Guided Call mode *(added 2026-07-30 — gap D4, FR60)*

As a parent on the phone to a reference,
I want the questions for this person one at a time, written straight onto the conversation this
call belongs to,
So that I get through the call without losing my place and without writing it up afterwards from
memory.

**Acceptance Criteria:**

**Given** a reference link on a shidduch
**When** I start Call mode
**Then** the questions for that relationship are presented one at a time, cursor held in the URL
**And** each answer is written to the call log as I go, with `source: "assistant"`
**And** an empty answer is skipped and writes nothing
**And** the flow is free — it makes no inference call and never consults the entitlement gate
**And** it reads at arm's length on a 390px phone, one-handed.

**Placement and delivery order.** This is one of the four orphaned mobile-gap items the owner
adopted (see *Mobile gap analysis outcomes*, below). It was drafted as `12.4` and placed **inside
Epic 5** because it hard-depends on 5.10 and 5.11, edits `references/ReferenceCallLog.tsx` (which
5.10 declares "unchanged" — true of 5.10's diff, not of the world after it), and lives entirely in
`references/`. It adds no `TabKey` and no descriptor change, so 5.11's AC-6 stays green behind it.
**Binding: 5.10 → 5.11 → 5.12.** Story file:
`_bmad-output/implementation-artifacts/5-12-guided-call-mode.md`.

**Not paywalled.** FR60's *coaching* half (generated per-question rationale) stays in Epic 11;
the script itself is free and Story 5.12 AC-9 machine-enforces that. Epic 5 placement was chosen
partly because filing it in Epic 11 would paywall it by filing.

**Contention to schedule around:** `references/entitlementGate.guard.test.ts` is also edited by
Story 12.4 (Stripe billing) — adjacent arrays in one file, never the same wave. `registry.json`
and both i18n catalogues are contended with 5.1, 5.2, 5.9, 5.10 and Epic 12.

**Delivery note (gap D6, not a story).** Once 5.12 ships, the dead
`Log a call (coming soon)` stub at `layout/MobileNavigation.tsx:184-186` reads as its entry point,
and 5.11 AC-5 forbids a second call-log entry point. **Delete the stub** before closing 5.12; it is
a one-line change that needs no story of its own. The companion
`Scan a resume (coming soon)` stub belongs to Story 11.2 or to the same deletion.

---

## Epic 6: The Single's Access

A single logs in and sees the same app, filtered. No parallel interface.

### Story 6.1: A single joins the household

As a parent,
I want to invite my single to their own login,
So that they can take part.

**Acceptance Criteria:**

**Given** a single in my household
**When** I invite them
**Then** they receive an invite, affirm 18+, and sign in passwordlessly
**And** their member record is linked to their single record.

### Story 6.2: Row-level scoping for a single

As a platform owner,
I want a single to see only what they should,
So that privacy is structural.

**Acceptance Criteria:**

**Given** a signed-in single
**When** they view suggestions
**Then** they see only shared suggestions in child-visible states
**And** gut set-asides and rejected suggestions are absent
**And** a negative test proves it at the database, not the client.

### Story 6.3: Field-level scoping for a single

As a platform owner,
I want sensitive fields withheld from a single,
So that candid diligence stays candid.

**Acceptance Criteria:**

**Given** a signed-in single
**When** they open a suggestion
**Then** medical notes, candid reference words and private parent notes are absent
**And** the data never reaches the client
**And** the dignity floor still guarantees their live prospects and their input.

### Story 6.4: The single's input

As a single,
I want to give my view on a suggestion,
So that my opinion is part of the process.

**Acceptance Criteria:**

**Given** a suggestion visible to me
**When** I leave my input
**Then** it appears in the parent's right rail on that suggestion
**And** it is attributed to me with a timestamp.

### Story 6.5: A self-managing single

As an independent, widowed or divorced single,
I want to run my own shidduchim,
So that I do not need a parent account.

**Acceptance Criteria:**

**Given** I ticked "single" at onboarding
**When** my household is provisioned
**Then** I am both a member and a single record in it
**And** I have full access to my own pipeline, references and shadchanim
**And** nothing in the UI calls me a child.

---

## Epic 7: Communication

Structured threads across every persona pair, open by default, private by deliberate act.

### Story 7.1: Thread model

As a developer,
I want threads modelled as subject-scoped records,
So that permissions and history are tractable.

**Acceptance Criteria:**

**Given** a thread
**When** it is created
**Then** it is attached to a subject (a suggestion or a relationship) with explicit participants
**And** visibility is a property of the thread
**And** it is a structured record, not free-form chat.

### Story 7.2: Open-by-default visibility

As a family,
I want conversations visible by default,
So that transparency is the norm.

**Acceptance Criteria:**

**Given** a new thread in a household
**When** it is created
**Then** it is visible to all parties in that context
**And** the family may set a different default posture
**And** the shipped default is open.

### Story 7.3: Per-discussion privacy

As any participant,
I want to make a specific conversation private,
So that sensitive matters stay between us.

**Acceptance Criteria:**

**Given** a thread
**When** it is made private at creation or by agreement
**Then** only its participants can read it
**And** non-participants cannot see its existence or content
**And** privacy is enforced at the database.

### Story 7.4: Any pairing may hold a private thread

As any user,
I want private conversations with any other party,
So that no legitimate conversation is structurally blocked.

**Acceptance Criteria:**

**Given** any two parties — parent↔parent, parent↔single, parent↔shadchan, single↔shadchan
**When** they open a private thread
**Then** it is permitted and scoped to them
**And** shadchan↔single is enabled by default, not gated off.

### Story 7.5: Notifications

As a user,
I want to know when someone writes to me,
So that conversations move.

**Acceptance Criteria:**

**Given** a new message on a thread I am party to
**When** it is posted
**Then** I am notified in-app, by email, and by push where installed
**And** no outbound SMS is ever sent.

---

## Epic 8: Shadchan Context

A shadchan works in their own context, connects by consent, and redts into a family's
pipeline — without ever seeing the family's private world.

### Story 8.1: Shadchanus context

As a shadchan,
I want my own workspace,
So that my book is mine and separate from any family.

**Acceptance Criteria:**

**Given** I ticked shadchan
**When** my shadchanus context is provisioned
**Then** it holds my book, connections and redts
**And** no household record is ever stored in it
**And** switching contexts changes everything I see.

### Story 8.2: Consent-based connection

As a parent,
I want to choose which shadchanim I connect with,
So that nobody reaches me without consent.

**Acceptance Criteria:**

**Given** a shadchan and a parent
**When** a connection is proposed and accepted
**Then** the connection exists only after explicit acceptance
**And** either side may end it
**And** there is no directory-driven or automatic linkage.

### Story 8.3: In-platform redting

As a shadchan,
I want to send a suggestion into a connected parent's pipeline,
So that redting happens in the platform.

**Acceptance Criteria:**

**Given** an accepted connection
**When** I send a suggestion
**Then** it arrives with `origin='shadchan'`
**And** it enters the family's confirm step and is never auto-filed
**And** the parent sees who sent it.

### Story 8.4: The shadchan's privacy boundary

As a family,
I want a shadchan to see only our shared thread,
So that our private work stays private.

**Acceptance Criteria:**

**Given** a connected shadchan
**When** they view anything
**Then** they see only the interaction and suggestion threads they are party to
**And** private notes, candid reference words, dating history, other shadchanim's suggestions and the single's data are unreachable
**And** negative tests prove each exclusion at the database.

### Story 8.5: The shadchan's own CRM

As a shadchan,
I want to track my conversations and suggestions,
So that I can do my work here.

**Acceptance Criteria:**

**Given** my shadchanus context
**When** I work in it
**Then** I have my own lists and 360s on the same shell
**And** my records never leak into a household context.

---

## Epic 9: Listings & Sharing

Nothing is discoverable unless published; publication is explicit, granular, revocable
and narrow.

### Story 9.1: Publish a shadchan listing

As a shadchan,
I want a professional listing,
So that families can find me.

**Acceptance Criteria:**

**Given** my shadchanus context
**When** I publish a listing
**Then** I choose each field (name, area, how to reach)
**And** the listing is discoverable in search
**And** I can withdraw it at any time.

### Story 9.2: Publish a single's listing

As the manager of a single,
I want to publish a narrow profile,
So that shadchanim can consider them.

**Acceptance Criteria:**

**Given** a single I manage
**When** I publish a listing
**Then** I opt in field by field, and nothing is published by default
**And** the working record — pipeline, notes, references, diligence, dating history, medical — is never exposed
**And** the family as such is never listed.

### Story 9.3: A single controls their own listing

As a single with a login,
I want to withdraw my listing,
So that my dignity floor is real.

**Acceptance Criteria:**

**Given** a listing about me, published by a parent
**When** I withdraw it
**Then** it is removed from search immediately
**And** the withdrawal cannot be overridden by the parent.

### Story 9.4: Public search

As a visitor,
I want to search published listings,
So that I can find a shadchan or consider a single.

**Acceptance Criteria:**

**Given** published listings
**When** I search publicly
**Then** I see only published listings and only published fields
**And** nothing reveals who is researching whom
**And** unpublished and withdrawn records never appear.

### Story 9.5: Revocable share links

As a parent,
I want to send a single's profile to a shadchan by link,
So that sharing is easy but controlled.

**Acceptance Criteria:**

**Given** a single's profile and resume
**When** I create a share link
**Then** it is revocable and expiring, and access is logged
**And** revoking it stops access immediately
**And** the photo is included only if I choose it.

### Epic 9 scope decisions (2026-08-02 story refresh)

Recorded here, mirroring the Epic 1 pattern above, so the reasoning behind five story-file
amendments lives in one place instead of being re-derived per reader.

**Storage: Story 9.5 does not use Cloudflare R2.** Its earlier draft built the `share/` Worker
against an R2 binding, matching AD-9's original text. Decided against, for two independent
reasons: R2 is not enabled on the Cloudflare account (confirmed live,
`.github/workflows/deploy.yml:233-251`), and no code in the product uploads a resume or photo
byte to R2 at all — every upload already writes to Supabase Storage's `documents` bucket. 9.5
now streams from `documents` using the service-role key it already holds; the `[[r2_buckets]]`
binding is dropped, and `share` rejoins the `deploy-workers` matrix in the same story. The
trade-off — a Worker bug on this path can in principle reach any object in any account, since
the service-role key bypasses storage RLS the same way for every bucket — is accepted and named
in 9.5's own Dev Notes, with the opaque server-derived `fileKey` (never a client-supplied
storage path) as the specific mitigation, backed by its own negative test. `ARCHITECTURE-SPINE.md`
AD-9/AD-15 are amended in the same diff so the written spine matches the shipped code.

**Epic 5's resume-shape dependency: confirmed satisfied, not a residual risk.** 9.5 depends on
a single having their own addressable resume (Epic 5 Stories 5.3/5.4/5.8), which an earlier
draft flagged as unstated and gave a schema fallback for. Verified directly against the shipped
schema for this refresh: `resumes.single_id`, `resumes_owner_check` and `resumes_single_id_key`
are all live, and `resume_photos` covers the photo half. 9.5's fallback branch is removed. Adding
the explicit "9.5 depends on 5.3/5.4/5.8" line here is the one remaining piece of that finding —
Epic 9 does not start before Epic 5 in the pinned build order in any case.

**Two pre-existing defects, given an owner rather than left in prose:**
1. **Resume/photo byte cleanup.** Deleting a `singles` or `shidduchim` row cascades the row
   delete to `resumes`/`resume_photos` at the database, but nothing removes the Storage bytes
   those rows pointed at (`purge_polymorphic_dependents()` is SQL and cannot reach the Storage
   API; the only existing byte-cleanup hook, `entityFilesCleanupCallbacks`, covers `entity_files`
   alone). **Owned by Story 9.5** (new AC-11/AC-12, Task 7) — folded in because Epic 9 is the
   storage epic and 9.5's own rework makes `documents` the sole byte-serving path either way.
2. **`anon`'s stray sequence grant** — **owned by Story 9.1** (Task 3): a one-line `revoke all
   on sequence public.members_id_seq from anon;`, the only survivor after `tasks_id_seq`'s
   grant (which looked like a second instance) turned out to already be revoked later in
   `06_grants.sql`. The much larger **repo-wide `FORCE ROW LEVEL SECURITY` retrofit stays
   recorded as item **S2** above**, updated with this epic's numbers — it is explicitly **not**
   owned by any Epic 9 story; it is a different order of magnitude and a different kind of
   decision (design bypasses for `SECURITY DEFINER` functions) than a listings/sharing epic
   should carry.

**Opt-in confirmed, not re-decided.** Every publish path in 9.1–9.3 defaults every listing
column to `null`/off and requires an explicit per-field toggle before anything is written; 9.5's
`include_photo` defaults `false`. No story encodes default-on. This was re-verified against the
story text during this refresh, not merely re-asserted, because the owner had previously changed
this mid-programme and earlier drafts elsewhere in the project have encoded default-on by
mistake.

---

## Epic 10: Capture Funnel Completion

Finish the front door so nothing arrives and gets lost.

### Story 10.1: Share-target completion

As a parent,
I want to share a message straight into the app,
So that I file it while I remember.

**Acceptance Criteria:**

**Given** a message in WhatsApp, SMS or a photo
**When** I share it to MyShadchan
**Then** I can set the source, resolve the shadchan and the single, or attach it to an existing suggestion
**And** skipping drops it into the Inbox without losing it.

### Story 10.2: Ambiguous sender attribution

As a parent,
I want to confirm who a forwarded message came from,
So that the system never guesses.

**Acceptance Criteria:**

**Given** an inbound email with an ambiguous original sender
**When** it arrives
**Then** it is flagged for confirmation and never auto-attributed
**And** it never crosses an account boundary.

### Story 10.3: Email ingress verified end to end

As a parent,
I want forwarding to my private address to work,
So that the phone-less path is real.

**Acceptance Criteria:**

**Given** the inbound address
**When** I forward a message with an attachment
**Then** it appears in my Inbox with the attachment intact
**And** an automated end-to-end test covers the path.

---

## Epic 11: AI Layer

Gated, server-enforced, never fabricating.

### Story 11.1: Server-side entitlement on inference

As a platform owner,
I want every AI call gated server-side,
So that budget cannot be spent by a modified client.

**Acceptance Criteria:**

**Given** an AI endpoint
**When** it is called
**Then** entitlement is re-checked server-side before any inference
**And** an unentitled caller is refused regardless of client state.

### Story 11.2: Resume auto-parse review

As a parent,
I want the resume read for me,
So that I confirm rather than retype.

**Acceptance Criteria:**

**Given** a resume in the Inbox and an entitled account
**When** it is parsed
**Then** I review an editable draft with the original kept as received
**And** a field the model did not return, or returned in a shape the schema rejects, is left blank — never filled with a guessed or fabricated value
**And** every returned field carries the model's own confidence, and a low-confidence field is visibly flagged for review rather than presented as reliable
**And** the draft is never treated as verified against the source document — the human review step, not the extraction step, is what confirms a value is correct
**And** "enter myself" is always available.

**Amendment (recorded 2026-08-06, closing finding 10's documentation half of
`_bmad-output/epic-11-adversarial-review-report-2026-08-04.md`).** The criteria above replace the
original wording, "unknown fields are blank, never invented." That review found the code faithful
to the first half — an absent or malformed field really does come back `null`, never a
passed-through guess — but the second half overclaimed: nothing in the implementation
distinguishes a genuinely extracted value from a well-shaped hallucination, since there are no
source spans or quotations tying a returned value back to the document it came from. The review's
own resolution judged building that machinery YAGNI (the human review gate in the resolve dialog
already covers the real risk) and recorded that "the epic's wording, not the code, was the
overclaim." The wording above is that correction: it states the structural guarantee that is
actually true (blank rather than guessed), names the confidence signal for what it is
(model-supplied and advisory, driving the low-confidence flag), and is explicit that the human
review step — not the extraction step — is what confirms a value is correct. It does not weaken
the feature or the review gate; it makes the written claim match what was always shipped.

### Story 11.3: Diligence dossier

As a parent,
I want the references summarised,
So that I can see agreement, contradiction and gaps.

**Acceptance Criteria:**

**Given** several logged reference calls
**When** I open the dossier
**Then** I see consensus, contradictions and what nobody was asked
**And** it draws only on this account's own records
**And** it never judges compatibility or suggests a match.

### Story 11.4: Operational controls for the AI Workers

As a platform owner,
I want the AI Workers' rate limiting, tracing and response cache to fail safely,
So that a limiter fault can never silently become an unmetered paid endpoint and no household can ever see another's cached data.

**Acceptance Criteria:**

**Given** an AI Worker whose rate-limit binding is unavailable
**When** a request reaches `/parse` or `/dossier`
**Then** the request is refused when this environment declares enforcement, and allowed through only when it does not
**And** a limiter that throws at runtime always refuses the request, regardless of that declaration
**And** every request is traced with a request id, route and outcome, never the resume contents, dossier narrative, or JWT
**And** `/dossier` evaluates row-level security fresh on every request and holds no cross-request state that could serve one caller's data to another.

**Amendment (recorded 2026-08-06, closing finding 18 raised against the prior wording).** The last
criterion above replaces "a cached `/dossier` response is scoped to its account and never returned
to another account's request." An account-namespaced response cache for `/dossier` was built to
satisfy that wording, then failed a follow-up adversarial review as a P1: its key had only one
dimension, `account_id`, but `reference_links` RLS additionally denies the `single` role outright —
a second, independent dimension the key never captured — so two members of the *same* account could
collide on one cache key while RLS gave them genuinely different rows underneath it. The fix removed
the cache rather than re-keying it; the full incident and reasoning are in
`_bmad-output/implementation-artifacts/11-4-operational-controls.md` ("Resolution note: C1"). `/dossier`
never called a model (see Story 11.3) and its query is a single indexed `SELECT`, so the cache was
saving one query, not inference — removing it is a legitimate design choice, not a shortfall against
this story. The wording above asserts what the shipped code actually guarantees and what is
mechanically testable now: no cached state exists to leak, because none exists at all, and RLS is
evaluated on every request rather than once per cache key.

---

## Epic 12: Phase-1 Completion & Operational Readiness

*Added 2026-07-30 by the mobile-gap reconciliation pass.*

Epics 1–11 re-story the A2 amendment. This epic closes the other half of the truth: the
**FR1–FR78 surfaces the Requirements Inventory calls "substantially delivered" that are not** —
a dashboard with no reminders, two parents keeping disjoint task lists, reminders that reach no
channel, and a Subscribe button that has never charged anyone. Three of the four are surfaces
the user already sees and believes are working, which is why none of them ever raised a bug.

**Why a twelfth epic rather than a home in 1–11.** Each was tested against an existing epic first.
Epic 4 does not cover the dashboard (it covers UX-DR2/7/10) and is shipped — reopening it would
make a closed epic incomplete. Epic 5 would drag 12.3 into a wave contending on `types.ts`,
`registry.json`, both catalogues, `supabase/schemas/**` and the universal Tasks tab for no reason
(12.3 has zero Epic 5 dependency). Epic 7 **explicitly disowns** reminder delivery in `7-5`'s own
scope note. Epic 11 is the AI *Layer*, and 12.4 makes no inference call. The one adopted item that
did find an existing home went there: **Guided Call mode is Story 5.12**, not a story here.

**Binding delivery order: 12.3 → 12.1 → 12.2 → 12.4.** 12.3 first because 12.1 imports its
assignee chip and 12.2's recipient join is defined by its outcome.

**Scheduling constraint (whole epic).** Every story here writes `registry.json`, and 12.1–12.3
write both i18n catalogues; 12.2 and 12.3 additionally write `types.ts`, `supabase/schemas/**` and
a migration each. **No Epic 12 story may share a wave with an Epic 5 story**, and 12.2 must not
share a wave with 12.3 (`ReminderCreateSheet.tsx`, `types.ts`, migrations) or with 12.4
(`.github/workflows/deploy.yml`).

### Gate G1 — DISCHARGED 2026-08-07. The text below is kept as history.

All four stories are built and committed: 12.3 `f1a6b4c`, 12.1 `47cc239`, 12.2 `4446540`,
12.4 `a623503`. Every credential G1 named now exists as a repository secret —
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `RESEND_API_KEY`, `RESEND_FROM`
(`support@myshadchan.space`, verified sending domain), and for 12.4 `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID_QUARTERLY`,
`STRIPE_PRICE_ID_YEARLY`, `APP_ORIGIN`. `deploy-workers` stopped skipping (first green run
30743735202), the `billing` Worker has joined the matrix, and both `cron` and `billing` pin
`workers_dev = true` rather than inheriting wrangler's default.

**Two things G1 asked for were answered differently than written, deliberately.** Pricing is
**$6 every three months and $24 a year** — there is no monthly cadence, so the secret is
`STRIPE_PRICE_ID_QUARTERLY`; see the "Pricing — AMENDED" block in `12-4-stripe-billing.md`.
And the Worker URLs stay on `workers.dev` rather than moving to pinned custom domains, because no
custom domain is configured on the Cloudflare account; the Stripe webhook is registered against
`https://myshadchan-billing.myshadchan.workers.dev/webhook`. Pinning `workers_dev = true`
explicitly is what turns that from a default into a decision.

**Deployed 2026-08-07** (`d49aee5`): all nine jobs green — Supabase migrations, all seven Workers
including `billing` for the first time, and the Vercel frontend. Verified against the running
deployment rather than the workflow's own green: both Worker health routes answer, and an unsigned
forged `customer.subscription.deleted` POSTed at the production webhook is refused with a 400.

**The epic is NOT done, and calling G1 discharged does not make it so.** An adversarial review on
the same day (`_bmad-output/epic-12-adversarial-review-report-2026-08-07.md`) opened with exactly
that objection and it is upheld here: credentials existing is not the same event as delivery
working. Two acceptance criteria remain unmet by observation, not by argument:

- **12.2 AC-10** — no reminder email has been confirmed arriving at a real inbox. The sweep was
  disarmed for part of the day (`5da019e`) because two of the review's findings were irreversible
  once a tick fired, and re-armed only after both were fixed and independently reproduced
  (`6a50a25`).
- **12.4 AC-14** — no real signed Stripe event has been observed reaching the running webhook and
  producing the matching `subscription` and `stripe_events` rows. The endpoint is registered and
  the Worker is live, but registration is not delivery.

**Live billing is also not configured.** The Stripe product and both prices are **test mode**
(`prod_V1bIMx10dzcDFB`, `price_1U1Y5mEimvfTzCZTHSYufq9V` at $6/3mo, `price_1U1Y5nEimvfTzCZT9O3Yqv7h`
at $24/yr). Live mode needs its own product, prices, webhook endpoint and secrets. Until then the
paid tier cannot take real money — which the review correctly noted is part of "operational
readiness", not a footnote to it. The Worker now enforces the mode rather than trusting the event
body, so a test event can no longer write production entitlement (`f45afb4`).

Epic status stays **incomplete** until those three are observed.

### Gate G1 — the Cloudflare Workers have never deployed *(blocking, ops, not code — historical)*

Stories 12.2 and 12.4 independently discovered the same thing: `deploy.yml`'s `deploy-workers`
matrix has printed *"Cloudflare Workers deployment skipped"* on every push to date, so there is no
running Worker for a cron tick to fire in or a Stripe webhook to arrive at. **Discharge this once,
at the epic level, not twice inside two stories.** It needs: `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as repository secrets (these un-gate the whole job), a **pinned** Worker
URL per Worker rather than a `workers.dev` default, plus `RESEND_API_KEY` + `RESEND_FROM` with a
**verified sending domain** (12.2) and the four Stripe secrets + a registered webhook endpoint
(12.4). No Worker currently has CORS or a declared route; both are new work neither story's
estimate anticipated. Until G1 is discharged, 12.2 and 12.4 can be built and unit-tested but
cannot be *delivered* — for both, deployment is inside the definition of done.

### Story 12.1: Dashboard reminders card *(gap D1, FR54)*

As a parent,
I want the dashboard to show me what is due,
So that I learn there is something to do without navigating to the Reminders hub.

**Acceptance Criteria:**

**Given** open reminders in my account
**When** I load the dashboard on a phone or a desktop
**Then** one read-only card shows at most three, overdue first, each linking to its entity
**And** the card reserves its space so it cannot shift the page as it loads
**And** a reminder on a reference links through its **shidduch**, never to `/references/{id}`
**And** the card adds nothing under `supabase/`.

**Depends on:** Epics 3 and 4 as deployed (`RecordLink`, RULING 7 machinery, the Reminders hub),
and on **Story 12.3** — see below. Story file: `12-1-dashboard-reminders-card.md`.

**Reconciliation:** as drafted, the card lists household tasks with no attribution — the same
"shows everyone, unlabelled" shape 12.3 exists to fix. It must land **after** 12.3 and import
12.3's `tasks/TaskAssigneeChip.tsx`. It stays account-wide and does **not** read 12.3's scope
toggle: it is a read-only summary, and a summary that hides half the household is the defect again.
It is **complementary to 12.2, not duplicative** — the in-app glance versus AD-13's out-of-app
floor; neither may be dropped as redundant.

### Story 12.2: Reminder delivery *(S5, AD-13)*

As a parent,
I want the reminders I set to actually reach me by email,
So that a follow-up does not depend on me remembering to open the app.

**Acceptance Criteria:**

**Given** an open reminder that is due
**When** the cron sweep runs
**Then** one email is sent — at-least-once, deduplicated by Resend's own idempotency key
  (Epic 12 adversarial review, R4: the earlier "exactly once, idempotent by construction"
  wording was disproved — a crash between claim and settle, or a stranded 'sending' lease
  reclaimed on a later tick, can cause the same occurrence to be claimed and sent more than
  once; what prevents a second email is Resend's `Idempotency-Key`, not database-level
  exactly-once semantics)
**And** snoozing re-arms delivery
**And** the pre-existing overdue backlog is suppressed by the same migration that creates the queue
**And** the create sheet stops promising a channel the product cannot deliver
**And** Settings shows whether the sweep is running at all.

**Depends on:** gate **G1** (blocking), and **Story 12.3** (ordering). Shares
`workers/shared/resend.ts`, `workers/cron/**`, `wrangler.toml` and `types.ts` with **Story 7.5** —
either order, never the same wave. Story file: `12-2-reminder-delivery.md`.

**Reconciliation — two amendments to the drafted story, both load-bearing:**
1. Its AC-5 settles a null `member_id` as `failed`. After 12.3, **Unassigned is a deliberate
   choice**, so a null `member_id` settles **`skipped`**; `failed` is reserved for a non-null
   `member_id` naming no live or no enabled member. Without this, every unassigned reminder is a
   permanent delivery failure and the new Settings heartbeat sits red forever.
2. With 12.3 landed, **assigning a reminder to your spouse silently redirects the only
   notification away from you**, and 12.3 rules that the creator is not tracked. The cost is
   accepted; the mitigation is that 12.2's reworded delivery line must **name the recipient**.

This story closes **S5** and partially closes **S11** (it removes push from the task side and
constrains `task_notifications.channel` to `('email')`; the `MessageNotificationChannel` half
remains Epic 7's).

### Story 12.3: Family-shared tasks with assignees *(gap D3)*

As a parent sharing a household with my spouse,
I want to assign a task to either of us and see what the other is handling,
So that we stop keeping two private to-do lists for one family's shidduchim.

**Acceptance Criteria:**

**Given** a household with two active members
**When** I open `/tasks`
**Then** I see the whole household's open tasks by default, each row naming its assignee
**And** I can narrow to "Assigned to me", and the choice persists
**And** I can assign a task to any active member of my current context, or leave it Unassigned
**And** assigning across a context boundary is refused by the database, not only by the client
**And** archiving a member leaves their tasks listed, completable and reassignable.

**Depends on:** Epic 2 (contexts, personas, the archive-not-delete lifecycle), Story 3.14
(Ruling 1 — `tasks` scope lift), Story 3.8 (Ruling 2 — Tasks tab canonical, rail read-only). All
built and deployed at `a8c5e3d`. **Not** Epic 5 — but not schedulable in an Epic 5 wave either.
Story file: `12-3-family-shared-tasks.md`.

**Why it is not a feature.** The disjointness is one line —
`tasks/TasksListByDueDate.tsx:32` passes `filter: { member_id: identity?.id }` — while RLS
(`05_policies.sql:35-38`) has no `member_id` term and `/reminders` already shows the whole
household **unlabelled**. The product holds two contradictory behaviours on one table; this fixes
both halves. It is still a migration: there is no FK between `public.members` and
`account_members`, so a member picker needs a new `security_invoker` view, and `member_id` is
client-writable to any value today.

**Amendment to Story 3.8 (recorded here because a story may not edit another).** 12.3 supersedes
`3-8` AC 3(c) **in part**: `member_id` becomes client-sendable; `account_id` and
`delivery_channels` do not. `3-8`'s test that pins the create payload is retargeted, not loosened.

### Story 12.4: Stripe billing — checkout, webhook, subscription lifecycle *(gap D7)*

As the platform owner,
I want an account to pay for the AI tier through Stripe, with Stripe's own state synced into the
`subscription` row `ai_entitlement()` already reads,
So that the paid tier stops being a "contact us" stub — without adding a second thing that can
decide whether an account is entitled.

**Acceptance Criteria:**

**Given** an account on the free plan
**When** it completes Stripe Checkout
**Then** entitlement changes only because the **webhook** wrote `subscription` — never the
checkout return, and never the `accounts` billing columns
**And** `ai_entitlement()` is unchanged and remains the single authority
**And** replayed and out-of-order webhook events change nothing
**And** a lapse pauses the subscription row, never deletes it
**And** the SPA never asserts entitlement for itself.

**Depends on:** gate **G1** (blocking). **No in-repo dependency** — the E4 substrate
(`subscription`, `ai_usage`, `ai_entitlement()`) is shipped, and it does not depend on Epic 5 or
Epic 11. Shares `workers/shared/env.ts` with Story 11.1. Story file: `12-4-stripe-billing.md`.

**Cross-epic ordering ruling (the story left this to the owner; it is now set).** Build order is
free — 12.4 may be implemented at any time. **Enablement order is not:** the paid tier must not be
switched on before 11.2 and 11.3 give it something to sell.

**Deliberate deviation from AD-16, flagged not silent.** AD-16 says the webhook syncs to
`accounts.{stripe_customer_id, subscription_status, plan, current_period_end, trial_end}`. E4
superseded that: those five columns are a documented decoy, revoked from client UPDATE, and read
by nothing in `src/`, `supabase/schemas/`, `workers/` or `scripts/`. A builder following AD-16
literally would write entitlement state into columns nothing reads. The webhook writes
`subscription` and `stripe_events` only.

**Contention:** `references/entitlementGate.guard.test.ts` is also edited by **Story 5.12** —
`ALLOWED` here, `FREE_FEATURES_THAT_MUST_NOT_GATE` there. One file, adjacent arrays, never the same
wave, and neither edit may be satisfied by weakening the guard.

---

## Epic 13: When a Family Changes

*Added 2026-08-05.*

Every epic before this one assumes a family that stays the same shape. Epic 13 is about the two
occasions when it does not: **a child who is looked after by two households**, and **a person who
is no longer part of one**. A marriage ending. A child leaving. Somebody who has died.

These are the hardest weeks a family will have while using this product, and the app's job in
them is small and specific: keep working, keep remembering, and stay out of the way. It does not
ask what happened. It does not offer a list of reasons to choose from. It does not make anybody
classify a bereavement to complete a form. And it does not quietly erase a person, because a
brother's shidduch history still mentions his sister, the references already spoken to still
refer to her, and a family may want to look back.

**Why a thirteenth epic rather than a home in 1–12.** Epic 2 owns persona lifecycle and would be
the obvious home for 13.2 — but Epic 2 is shipped, and its Story 2.5 built the *self-service*
half deliberately (`remove_persona()` is filtered to `user_id = auth.uid()` by design, with its
own comment explaining why). 13.2 is the other half: one person acting on behalf of another,
which is a different authorization question, not a completion of 2.5. Epic 8 owns cross-account
links, but `connections` is household↔shadchanus by column name, by trigger and by AD-20's core
promise; household↔household is not a widening of it (see 13.1 §2.3). Epic 9 owns sharing, but
`share_links` grants a bearer token to an anonymous reader — it shows a child to a shadchan, it
cannot make a second parent a participant. Epic 12 is Phase-1 completion of FR1–FR78 surfaces
that shipped incomplete; neither of these shipped at all.

**Both stories are specification, not build-ready.** Between them they carry **fifteen open
product decisions** and **one architecture amendment**. That is the deliverable: the questions
are surfaced rather than silently answered, because most of them are product calls with no
technical answer, and answering them wrong would be worse than answering them late. Neither story
should enter a wave until §3 of its own file is settled.

The fifteen are collected, with what is established, the options and a recommended answering
order, in **`epic-13-open-decisions.md`** (E13-D1 … E13-D15). That file is an index — each entry
links back to the story section that owns it, and an answer recorded there is applied to the story
file in the same edit.

**Delivery order: 13.2 → 13.1, with one coupling.** 13.2 is the smaller build and the mechanism
mostly exists. 13.1 requires a tenancy amendment and should not be started before it is accepted.
The coupling runs the other way: **13.2's AC-8** ("removing a person, and whether they keep
access to a child, are one act with two questions") only has a meaningful answer once 13.1
exists. If 13.1 is deferred, 13.2 ships **without** the access question rather than with a
silently weakened version of it — because "keeps access" without 13.1 means "keeps the whole
household", which is the exact thing 13.1 exists to prevent.

**Scheduling constraint (whole epic).** Both stories touch `supabase/schemas/**` and a migration
each; 13.1 additionally widens RLS across most of the household tables. They must not share a
wave with each other or with any Epic 12 story. **Security review is mandatory for both**
(`.claude/rules/security-triggers.md`: authorization, database queries, migrations, RLS — these
stories are all four). 13.1 is the single largest widening of the tenant boundary since Epic 2;
13.2 creates the product's first function that acts on a person other than the caller.

### Requirements this epic adds

Neither story is covered by FR1–FR119. Proposed new requirements, for the owner to ratify with
the §3 decisions:

- FR120: A household may grant another household continuing access to **one named child**, and to
  nothing else of that household.
- FR121: A grant requires consent on both sides and is live, not a snapshot — records added later
  are included without any republication step.
- FR122: Either household may sever a grant; severing ends access immediately and leaves the
  severing side a copy of what it could see.
- FR123: A household's founding admin may remove a person from the household, and separately
  decide whether that person keeps access to a child. The two are never one collapsed decision.
- FR124: A person may be removed from a household by someone other than themselves. Removal
  archives, never erases, and is undoable.
- FR125: The interface never names or offers a reason for a person leaving a household. One
  neutral action, one wording, whatever the circumstance.

### Story 13.1: Sharing a child across two households

As a parent whose child's other parent belongs to a different family,
I want to give that parent continuing access to our child's record — our child's, and nothing
else of mine —
So that both of us can look after this shidduch together without either household opening its
front door to the other.

**Acceptance Criteria:**

**Given** a child in my household
**When** I share that child with another household
**Then** nothing is shared until the other side accepts
**And** they see that child and everything hanging off them, and no other child, member, shadchan,
reminder or setting of mine
**And** both households see the same live record, including everything added later
**And** either side may sever it, taking a copy of what they could see
**And** everyone in both households can see on the record who else can see this child
**And** every boundary here is enforced in Postgres, with a negative test proving the wrong caller
sees nothing.

**Depends on:** an **architecture amendment** to AD-1 — a shared child's rows keep their single
`account_id` (the composite `(account_id, single_id)` FKs leave no choice), so what changes is the
*reachability* rule, not the scoping column. **Ten open product decisions**, listed in the story
file. Story file: `13-1-sharing-a-child-across-two-households.md`.

**What was established, and is not open:** `public.accounts` has no creator column of any kind —
the founding member is derivable (`account_members.invited_by is null`) but not stored, and
nothing makes it unique. `connections` cannot carry this (household↔shadchanus by trigger, and
AD-20's promise is the opposite of what this needs); `share_links` cannot carry this (bearer
token, anonymous reader, read-only, expiring). Documents are the sharpest constraint: the storage
key grammar is `{account_id}/…` and every policy compares that segment to `current_context_id()`,
so a second household cannot form a readable path to a child's resume **regardless of what RLS
says about the rows**. Shared-by-default does include later records, and that is the deliberate
opposite of AD-21's snapshot semantics — a builder must not copy `listings`' reflexes here.

### Story 13.2: When someone leaves the household

As someone holding a family's records,
I want to be able to say that a person is no longer part of this household — once, plainly,
without being asked to explain —
So that the app stops treating them as present, and still remembers them, because everyone else's
history is full of them.

**Acceptance Criteria:**

**Given** a person in my household
**When** I remove them
**Then** the app never asks why, never offers a reason to choose from, and reads the same whether
they have moved out, left a marriage, or died
**And** nothing is erased — their name stays in a sibling's notes, in past redts, in reference
call history, because that history is about other people too
**And** it can be undone
**And** they stop being treated as present: no reminder reaches them, no notification is addressed
to them, they are not offered in a member picker
**And** their tasks stay listed, completable and reassignable, so somebody can pick the work up
**And** their login is not disabled — a household may end its own relationship with a person, not
that person's account.

**Depends on:** nothing built; the archive mechanism already exists. **Five open product
decisions**, listed in the story file. Story file:
`13-2-when-someone-leaves-the-household.md`.

**What was established, and is not open:** archiving already exists and already fails closed —
`current_context_id()` requires `status = 'active'`, so an archived membership resolves to a NULL
context and every policy denies. `remove_persona()` archives and never deletes (its own comment:
*"zero `delete from`"*). What does **not** exist is any path for one person to do this to another:
every query in `remove_persona()` is filtered to `user_id = auth.uid()`, deliberately. That is the
whole gap — and it is why a person who has died currently cannot be removed at all, since only
they could have done it. There is also **no un-archive path anywhere in the product**, so undo is
new work, not a toggle. One shipped decision this story may reverse: Story 2.5 AC-8 deliberately
keeps archived singles visible in the roster (`SingleCard.tsx:23-25`); whether a family should see
a daughter who has died in the list every time they open the app is the owner's call, and if it
changes, 2.5's story file is amended in the same dispatch.

**The constraint that outranks the rest.** The interface never names a reason and never offers one
to choose from. Not a nullable column, not an optional field, not a free-text box, not branching
copy. An optional field still asks; the question is not asked. The only thing the app may ask is
whether the person keeps access to a child — a permission question, phrased as a permission.

---

## Mobile gap analysis outcomes (2026-07-30)

The mobile gap analysis attributed every mockup-vs-app gap to an owner. **Six were orphaned** —
present in the mockups, absent from the app, owned by no story. The owner adopted four. This table
is the closed ledger; nothing below should be rediscovered as a gap.

| Gap | Disposition | Where |
|---|---|---|
| D1 — dashboard shows no reminders | **Adopted** | Story 12.1 |
| D3 — tasks not shared across the family | **Adopted** | Story 12.3 |
| D4 — Guided Call mode (FR60) | **Adopted** | Story **5.12** (inside Epic 5) |
| D7 — Subscribe is inert | **Adopted** | Story 12.4 |
| D8 — per-account private inbound address (FR22) | **DROPPED** | S9, below |
| D10 — Hebrew / RTL UI | **DROPPED** | S27, below |

Also settled by the same pass, none of which needed a story:

- **D5** (Reference 360's 4th tab clipped at 390px) — an AC on Story 3.1's shell test and a
  blocking prerequisite of 5.10, per the analysis's own recommendation. Story 5.12 AC-11 pins the
  assertion shape that let it ship green twice: measure `scrollWidth <= clientWidth` on the
  scrolling container, **not** on the page root.
- **D6** (two dead "coming soon" stubs on the `(+)` capture control) — a one-line deletion,
  recorded as a delivery note under Story 5.12.
- **D12** (singles roster reachable only via Settings → Family) — a nav AC on Story 5.8.
- **D2 / D9 / D11 / D13** — the polish batch; D11 was already earmarked for 4-1's Dev Notes
  (S23) and never folded in.
- The **reminder delivery** defect (S5) is not a Category-D item — it came from the parallel
  silent-defects track — but it is adopted in the same round as **Story 12.2**.

---

## Unowned work surfaced by the Epic 2–11 story review (2026-07-26)

Ten adversarial reviewers plus two cross-checks surfaced work that **no story owns**.
Recorded here so each is a decision, not an oversight. Nothing below is scheduled.

### S1 — SECURITY: the `attachments` bucket was public and account-unscoped ✅ FIXED 2026-07-26
The bucket holding **resumes and photos** — PRV-1's highest-sensitivity data — is
`public = true`, and its only policy is
`for select to authenticated using (bucket_id = 'attachments')` with **no account scoping**
(`supabase/schemas/07_storage.sql`). Object keys come from `Math.random()`
(`supabase/functions/postmark/extractAndUploadAttachments.ts`), which is not a
cryptographic secret, and the code calls `getPublicUrl`.

Violates **AD-1** (cross-account leaks = 0), **AD-9** (no public/pre-signed URLs; a Worker
proxy-streams), **PRV-5** (no public URLs, access-logged) and **PRV-8** (revocable,
expiring, per-recipient).

**RESOLVED** (commit `31183f2`, deployed 2026-07-26). Confirmed live on hosted, then fixed:
bucket set private, policies scoped to an `{account_id}/` key prefix, both upload sites
switched to account-prefixed `crypto.randomUUID()` keys and signed expiring URLs.
Verified on hosted — the anonymous public endpoint went from `Object not found` (bucket
public and serving) to `Bucket not found`. Locally: anonymous read 400, cross-account
download blocked, cross-account list empty.

**Residual, still unowned:** AD-9's real answer is a Worker proxy-stream with access
logging, not signed URLs; and the policies name `current_account_id()`, which Epic 2
Story 2.1 deletes — 2.1 must migrate these three storage policies to `current_context_id()`
or they break. Add that to 2.1's policy inventory.

### S2 — Repo-wide `FORCE ROW LEVEL SECURITY` retrofit + AD-1's CI assertion
AD-1 requires `FORCE RLS` on every table and a CI check asserting it. Story 2.1 explicitly
declines the retrofit; no other story takes it. **Still not done, and the surface has grown:**
live DB is 22/22 tables RLS-enabled, 0 forced; 20 `SECURITY DEFINER` functions in `public`, all
owned by `postgres` (which bypasses unforced RLS on every table it touches). The only artefact
is the comment at `01_tables.sql:85`. Note `accept_invite` does an unscoped read of `invites`
that only works *because* RLS is unforced — a blanket retrofit breaks invite acceptance unless
designed with bypasses. AD-1's "one scoping axis" clause also needs a justified allowlist
(`accounts`, `members`, `member_state`, `configuration`, `pipeline_transitions` legitimately have
none; zero tables have `connection_id`). **Disposition: own story, before Epic 3 — urgent, but
not Epic 3's to build.** Split it: (a) the CI assertion + allowlist is cheap, ship now; (b) the
retrofit with designed bypasses is the larger piece.

**Update, Epic 9 refresh (2026-08-02): still open, and now higher-stakes, but still not Epic
9's to fix.** By the time Epic 9 was being story-refreshed, the count had moved from "0 forced"
to **7 of ~40 tables forced** — `connections`, `threads`, `thread_participants`, `messages`,
`message_notifications`, `push_subscriptions`, `connection_invites` (`05_policies.sql:1178-1377`,
all Epic 7/8 additions, each correctly forced on arrival) — while roughly 33 pre-existing tables
(`singles`, `shadchanim`, `references`, `shidduchim`, `resumes`, `accounts`, `account_members`,
`tasks`, `interactions`, and more) still are not. Epic 9's four new tables (`listings`,
`listing_withdrawal_locks`, `share_links`, `share_access_log`) each correctly `FORCE` themselves
too (9-1 Task 2, 9-3 Task 1, 9-5 Task 2) — the pattern going forward is sound, only the backlog
of already-shipped tables is not shrinking. The reason this now matters more than it did at
Epic 2/3 time: Epic 9 is the first epic to make `anon` a live, reachable production role, and
table owners bypass **non-forced** RLS regardless of any policy written against `anon` or
`authenticated` — so any future service-role or owner-context code path that touches one of the
33 un-forced tables has no RLS backstop at all, policy correctness notwithstanding. This is
**not** folded into any Epic 9 story: it is a different order of magnitude (a repo-wide retrofit
across every domain table, with the same invite-acceptance-shaped bypass design problem S2
already named) than anything in the epic's own scope, and doing it inside a listings/sharing
story would bury a cross-cutting security decision inside an unrelated diff. It remains this
item's disposition: **own story, and it should ship before or alongside Epic 9's production
rollout, not merely "before Epic 3"** — that deadline has already passed once.

**Related, smaller finding from the same refresh: a narrower, one-line instance of the same
class of gap, fixed in place rather than left here.** `06_grants.sql:46` still runs `grant all
on sequence public.members_id_seq to anon;` with no revoke anywhere in the file — a fork-era
leftover this item's own AD-1 sweep missed. (`06_grants.sql:50` looked like a second instance —
`tasks_id_seq` granted to `anon` the same way — but `:560` revokes it later in the same file, so
only `members_id_seq` is actually still exposed.) Unlike the FORCE RLS retrofit, this one is a
single `revoke` statement with no design decision attached, so it is fixed directly in **Story
9.1** (Task 3) rather than added to this backlog — recorded here only so the two findings are
not confused with each other going forward.

### S3 — Invite-token-at-rest posture is split
2.7 stores membership-invite tokens as raw uuids; 8.2 stores connection-invite tokens as
SHA-256 hashes. Two postures for what AD-11 calls one mechanism. Either align 2.7 to
hashing, or have the architecture owner bless the split.

### S4 — Shadchanus contexts cannot hold tasks or reminders
`tasks.target_type` has no target that can exist in a shadchanus account, so a shadchan
cannot record "call the Kleins Tuesday". Story 8.1 honestly omits the nav items rather than
faking it. Wants a `connection` task target (touches AD-13's target set). **Partially
superseded by S14 / Story 3.14**: the structural trigger block on inserting into `tasks` /
`interactions` from a shadchanus context is lifted there, for the target types that already
exist (`shadchan`, `shidduch`, `reference`). The residual here is narrower — adding the
`connection` target-type value itself remains Epic 8's (8.2/8.5).

### S5 — AD-13 reminder delivery is never wired ✅ OWNED by Story 12.2 (2026-07-30)
Story 7.5 builds the first real Resend / Web-Push delivery; no story connected the reminders
sweep to it, so reminders were delivered by no real channel at all. **Now owned by Story 12.2**,
which does not wait for 7.5: `workers/cron/index.ts`'s `scheduled()` is an 18-line
`console.warn`, nothing anywhere reads `delivery_channels`, no Resend call exists in the tree,
and `deploy-workers` has never run — so this has never worked in any environment, and
`ReminderCreateSheet.tsx:323-328` tells every user today that it does. 12.2 also partially closes
**S11** (push is removed from the task side and `task_notifications.channel` is constrained to
`('email')`; unifying with `MessageNotificationChannel` remains Epic 7's).

### S6 — AD-8 observability and AD-17 rate limiting are unowned
Epic 11 ships the product's first real inference calls, but Langfuse tracing, the
account-namespaced response cache (AD-8) and rate limiting on expensive surfaces (AD-17)
belong to no story.

### S7 — The list half of AD-24 ✅ OWNED by Story 4.1 (2026-07-28 Epic 3 refresh)
Originally recorded as unowned because 4.1 said "a follow-up refactor, not this story's to
anticipate" — **that text was deleted by the same commit that recorded this gap.** Today
`4-1:29` reads "Depends on Epic 3: Story 3.3's `EntityDescriptor` registry", and `4-1:114`
consumes `getEntityDescriptor(resource).label`. **Residual, still unowned:** `icon` / `meta` /
`stats` on the descriptor have no list consumer, and `shidduchim`, `tasks`, `reminders`,
`inbox_items` and `members` never migrate onto `EntityList` at all. That residual is one Epic 4
story, not Epic 3's — Epic 3 Story 3.3 ships the registry `4-1` needs; it does not itself
migrate every list.

### S8 — Postmark → Cloudflare Email Routing migration
The spine's AD-6 and stack table name Cloudflare Email Routing; the shipped code is
Postmark, and `workers/ingest/index.ts` calls the migration "separate future work".

### S9 — FR22, the per-account private inbound address ❌ DELIBERATELY DROPPED (2026-07-30)
The product has one global `VITE_INBOUND_EMAIL`. No story delivers per-account addresses.

**Dropped, not deferred.** This is gap **D8** of the mobile gap analysis — the mockup's copyable
`you@in.myshadchan.space` chip — one of the six orphans, and one of the two the owner did **not**
adopt. Reasons, recorded so this is a decision and not an oversight:

1. **It would be built twice.** Per-account addressing is a mail-provider routing feature, and
   **S8** records that the inbound path is mid-migration: the spine names Cloudflare Email Routing,
   the shipped code is Postmark, and `workers/ingest/index.ts` calls the migration "separate future
   work". An address scheme designed against Postmark's routing is thrown away by S8.
2. **The gap it closes is already narrowing.** Story 10.1 completes the share target (the phone
   path) and 10.2 adds attribution for ambiguous senders (the desktop-forward path), which is most
   of what the private address was for.
3. **Cost of reversal is low and does not grow.** It is one column, one generated local-part and
   one routing rule; nothing shipped between now and then makes it harder.

**Revisit only when S8 lands**, and then as an AC on the Epic 10 story that owns the new ingress —
not as a standalone item. Until then the global address is the intended behaviour, and the mockup's
per-account chip is out of scope by decision.

### S10 — Passwordless e2e sign-in helper ✅ CLOSED (2026-07-28 Epic 3 refresh)
**Done.** `e2e/fixtures.ts` exports a shared `fetchOtpCode` plus a two-step passwordless
sign-in, consumed by multiple specs. (`e2e/` is being rewritten concurrently; the finding is
"the shared helper exists", not particular line numbers.)

### S11 — `TaskDeliveryChannel` vs `MessageNotificationChannel`
Story 7.5 defers unifying the two channel enums and assigns the cleanup to nobody.

### S12 — epics.md coverage rows understate real dependencies
The Epic 8 row omits its Epic 7 (threads/AD-22), Epic 3/4 (AD-24) and Epic 2 (AD-19)
dependencies. Other rows may be similarly thin.

### S13 — The five-value role has a DB half and no client half (added 2026-07-28)
`account_members.role` carries the AD-2 constraint (`01_tables.sql:153-155`) and
`my_contexts()` exposes it (`02_functions.sql:341`), but the client still resolves permissions
from a single boolean: `authProvider.ts:151` → `canAccess.ts:16`. There is no
`current_member_role()` among the `SECURITY DEFINER` functions. Epic 3 Story 3.4 takes the
client half (`useViewerRole()` reads `my_contexts()`, and 3.4 owns `canAccess.ts`). The
*server-side* role helper and the full retirement of the boolean check remain unowned.

### S14 — Household/shadchanus scope of the universal tabs ✅ CLOSED by Story 3.14 (added,
then closed, 2026-07-28)
`enforce_household_scope()` is attached to 13 tables (`04_triggers.sql:146-194`), including
`interactions` and `tasks`, which made the universal Activity, Notes and Tasks tabs
structurally unavailable in a shadchanus context — exactly what Epic 8 Story 8.5 ("the
shadchan's own CRM") is built on. The project owner ruled (Ruling 1) to lift `tasks` and
`interactions` out of the household-only scope rather than rescope or defer 8.5. **Owned by
Epic 3 Story 3.14**, which stages the migration and rehearses it against a seeded local
database before it reaches production (the schema comment at `04_triggers.sql:138-145` warns
this is "a migration-time total insert outage, not a refactor" if the drop/re-add or the check
widening happens in the wrong order). 3.14 is a blocking dependency of 3.5, 3.6 and 3.8.

---

## Unowned work surfaced by the Epic 1–3 loose-ends round (2026-07-29, commit `af2074e`)

The loose-ends round ran three agents in parallel on `main` alongside the live Epic 4 build, and
closed items A, B, C, D, F, G and 11 of I. Everything below is what it could **not** close.

Items whose owner is an Epic 4 story are recorded in that story's Dev Notes, not here (4-2:
`ShadchanCard`; 4-3: `ShidduchColumn` / `ShidduchCard` / `ShidduchimList`; 4-4: mobile Billing
entry, mobile logout divergence, `MobileNavigation`, `Sidebar`, `DashboardStat`; 4-5:
`MobileHeader` and `--banner-h`, `TopBar`). **Story 4-1's file is deliberately not edited** — the
`fix-4-1` agent held stack 1 and was writing to it at the time — so 4-1's two deferrals are in
S23 below instead.

Nothing below is scheduled.

### S15 — SECURITY-ADJACENT: the MCP assistant still enumerates and creates references (item J-B3)
`supabase/functions/mcp/index.ts` is the deployed AI assistant's tool surface. Its `query` tool
description (~`:304`) advertises `references_summary` as a thing to search, and its `mutate` tool
description (~`:348`) lists "Creating new shadchanim, **references**, or tasks" — so the assistant
both browses references as a top-level entity and creates them unattached to any shidduch. That is
the second half of RULING 7, which stories 4-4 and 4-5 close for the *human* UI (no nav entry, no
list, no dashboard tile, no tour step, no global-search results) while the assistant keeps doing
exactly what the ruling forbids.

The round scheduled this into bucket 6 and the bucket declined it, correctly: it is item **J**, and
its own plan marks it "pending owner sign-off on §2 case 7". So it is now in nobody's diff and has
no owner. The recommended change is a **description / prompt edit only** — no behaviour code — and
it is directionally aligned with what 4-4 and 4-5 are shipping. **It needs an owner.** Note the
`references/` directory is off-limits to Epic 4 by its own stories, so this cannot be folded into
one of them without redrawing their scope.

### S16 — Ruling 7 wave B: contract files + story files, one agent, after Epic 4 closes (J-B1 + B2)
B1 (contract files) and B2 (the story files describing the same mechanism) must land **together and
as one agent**. B2's list includes the `4-1`, `4-2`, `4-4` and `4-5` story files, which Epic 4's dev
agents demonstrably write to (commit `2fb6187` did). Splitting B1 from B2 is forbidden outright by
`.claude/rules/parallel-ownership.md` → "A shared decision has exactly one owner"; that split is the
verbatim failure this project has hit three times ("a ruling landed on a contract file but not on
the story files describing the same mechanism, because different agents owned each"). B1 therefore
cannot be salvaged alone either. **Schedule after Epic 4 closes, as a single agent.**

### S17 — Ruling 7 wave C: schema + framework (J-C)
Deferred; its own plan already says WAIT. Two reasons it cannot run beside the current work: it
claims `supabase/migrations/**`, which any deploy-time migration round also claims, and its
`entity360/**` half sits in the same directory and uses the same descriptor mechanism as 4-4's
`entity360/ad24Conformance.guard.test.ts`. Target Epic 5 or a later round.

### S18 — `registry.json` is stale AND `make registry-build` is broken right now
`af2074e` deleted `src/components/supabase/layout.tsx` (the retired split-screen auth shell; its
only importer, `oauth-consent-page.tsx`, was re-hosted on `AuthLayout`). `registry.json:1095` still
lists that path, and it is missing the new `misc/formatDueMoment.ts`.

This is **not merely stale**: `npm run registry:build` now fails outright with
`ENOENT: no such file or directory, open '.../src/components/supabase/layout.tsx'`, which breaks
`make registry-build` and `make registry-deploy`. CI is unaffected — neither `check.yml` nor
`deploy.yml` runs `registry:build`, and there is no freshness check — so this will not turn the
pipeline red; it fails only for whoever runs those targets by hand.

Regenerating was deliberately **not** done. `registry.json` is a tabled shared artifact owned by
Epic 4, and it is produced by globbing the working tree: regenerating it now was measured to pull
Epic 4's untracked work-in-progress (`shadchanim/ShadchanCardGrid.tsx`) into the artifact — exactly
the capture that `.husky/pre-commit` was hardened to prevent, and the hook correctly declined to run
`make registry-gen` during this commit for that reason. **Owner: Epic 4's committer**, who must run
`make registry-gen` on a quiet tree; that single run fixes all three discrepancies at once.

### S19 — The deploy gate is landed but inert, and two credentials need rotating
`af2074e` added a Vercel Deploy Hook step to `deploy.yml`, fired only after `db push` and
`functions deploy` succeed. It is guarded on `env.VERCEL_DEPLOY_HOOK_URL` and therefore **does
nothing** until the project owner completes two manual steps, **in this order**:

1. Vercel → Settings → Git → Deploy Hooks: create a hook on `main`, add the URL as the repo secret
   `VERCEL_DEPLOY_HOOK_URL`. *Adding the secret is the sign-off.*
2. Vercel → Settings → Git: disable the **production** git deployment for `main`. Previews are
   unaffected.

Doing 2 before 1 stops production deploying at all. Until both are done, every deploy writes a
`:warning:` to the job summary saying the pipelines are still unordered.

**Rotate two credentials.** The pre-existing `📡 Enable the invite-signup Auth Hook` step used
`curl -sSf` without `-o`, and a successful PATCH to `/config/auth` returns the whole auth config —
242 keys including an unmasked 64-character `smtp_pass` and `external_google_secret`. Neither is a
declared workflow secret, so GitHub did not mask them, and both have been printed into the Actions
run log on every deploy since that step landed. `af2074e` adds `-o /dev/null`, but the values are
already in retained logs: **rotate the SMTP password and the Google OAuth client secret.**

Two consequences of the new mailer step, both deliberate and both needing a decision later:
`rate_limit_email_sent` is now declarative (20), so an emergency dashboard bump is reverted by the
next deploy — change the number in the workflow instead; and `mailer_otp_length` / `mailer_otp_exp`
are pinned in the workflow because `config.toml` cannot model them, which makes them a second source
of truth. Move them into `config.toml` and read them with `yq` in a round that is allowed to edit
`config.toml` (this one was not — `stack-env.mjs` derives every parallel stack's config from it).

### S20 — `deploy-workers` races `db push` in exactly the way item A was raised to fix
Found by the cross-reconciliation pass, in nobody's diff. Item A was framed as "the frontend and the
database deploy on two independent pipelines", and the fix closes the Vercel half. But `deploy.yml`
has a **third** pipeline: the `deploy-workers` job (7 Cloudflare Workers — `ingest`, `parse`,
`match`, `ai`, `share`, `cron`, `billing`) declares **no `needs:`**, so it runs concurrently with
`deploy-supabase`. New worker code can be live against the old schema, and a failed `db push` still
ships all seven workers — the same failure item A exists to prevent, from a pipeline that is
entirely inside this repo.

Unlike the Vercel half this is a one-line fix (`needs: deploy-supabase`), but it is the same class of
shared decision item A was gated on: it serializes deploys and makes a Supabase failure block the
workers. The round did not take it unilaterally for that reason. **Decide it with S19.** The honest
limit recorded for item A applies here too and is the thing that actually makes deploys safe:
ordering only removes "new code against old schema"; the reverse window (new schema, old code) is
closed only by expand/contract migrations, which are required for rollback anyway.

### S21 — Three date formatters, and one docstring that is now false
`af2074e` extracted `misc/formatDueMoment.ts` (`"d MMM, h:mm a"`) so `tasks/Task.tsx` and
`reminders/ReminderCard.tsx` stop rendering the same `due_date` two different ways. That fixed the
reported defect but did **not** converge the tree, which now has three date shapes:

| helper | shape | used for |
|---|---|---|
| `misc/formatDueMoment.ts` | `24 Jul, 2:00 PM` | task / reminder `due_date` (near-term, no year, 12-hour) |
| `entity360/tabs/interactionLabels.ts#formatTimelineDate` | `24 Jul 2026, 14:00` | `interaction.created_at` (historical, year, 24-hour) |
| `shidduchim/boardUtils.ts#formatRedtDate` | `24 Jul 2026` | redt date (date only) |

The first two are both "timestamp with date and time" and disagree on year and clock. Neither
agent could see this: the one that created `formatDueMoment` checked `formatRedtDate`, found a
different shape, and concluded there was no duplicate — it never looked in `entity360/`.

Two follow-ups. (a) `formatTimelineDate`'s own docstring claims it is *"the only definition in the
repo, so no behaviour change"* and cites the single-owner rule (AC 7,
`ARCHITECTURE-SPINE.md:190`) — that statement is now false and must be corrected;
`interactionLabels.ts` is in no story's claim, so the round reported rather than edited it.
(b) Decide whether three shapes is intentional presentation or drift. `formatDueMoment`'s docstring
was updated in `af2074e` to state its scope precisely and point here, so at least the ambiguity is
no longer silent. Note all three render English month names regardless of locale, which is
pre-existing practice but worth revisiting alongside `frenchCrmMessages.ts`.

### S22 — Pluralization strings in `englishCrmMessages.ts:57, :401`
Two i18n defects from the round's item I. Deferred to **Epic 4's committer**: the i18n catalogues
are a tabled shared artifact (`.claude/rules/parallel-ownership.md`), Epic 4 owns them for the
duration of the epic, and it is actively writing to `englishCrmMessages.ts` (proved by commit
`ad0c7d1`, which added 40 lines to it without declaring the file). Every bucket in the round was
therefore forbidden from adding or editing any i18n key.

### S23 — Story 4-1 / RULING 7 wave A deferrals (recorded here because 4-1 was in flight)
Two item-I defects belong to work already described in story 4-1 and in the RULING 7 references
wave. They are recorded here rather than in `4-1-entity-list-framework.md` because the `fix-4-1`
agent held stack 1 and was writing to that file when this round committed:

- `root/routeManifest.ts` — the R7 members-at-390px issue.
- `login/LoginSkeleton.tsx` — dropped from the round because it is imported by
  `login/InviteAcceptance.tsx`, and `e2e/invite-acceptance.spec.ts` is declared by story 4-4.
  Reshaping the invite-acceptance loading state while 4-4 rewrites that spec is the `10dacf4` race
  in a new costume.

**Fold both into 4-1's Dev Notes once its agent releases the file.**

### S24 — RULING 7: R1 closed, R2 open and reassigned to Story 5.10 (updated 2026-07-29, Epic 5 pre-flight)
Superseded the original entry, which was stale on two counts: `layout/navItems.ts:61` no longer
has `/references` (4-4 removed it), and the residue was never "`ReferenceList`'s `<CreateButton/>`
minting orphan references" — commit `cbc311a` closed that (**R1**: `ReferenceCreate.tsx` refuses
without a resolvable `?shidduchim_id=`). R3 (nav/tour/dashboard, 4-4) and R6 are also done.

**R2 is open and the gap is live:** `references/index.ts` still mounts `list: ReferenceList`, a
fully-featured browse surface — search box, three filters, sort, pagination, every reference in
the account — at `/references`, with a `CreateButton` that now dead-ends into the R1 refusal panel
instead of minting orphans. `ReferencesIndex.tsx` does not exist. The AD-24 guard reads green over
this: clause (c) skips `references` outright as a no-browse entity, and clause (b) only matches the
literal `buildListPath("references")`, missing the two live call sites that actually route there
(`RecordUnavailable.tsx:37`, `routeConvention.tsx:88`). Do not read that green as coverage.

**Ownership: R2 is assigned to Story 5.10** (Reference 360 and per-shidduch diligence), not a new
story. 5.10 cannot satisfy its own route-mount AC without deciding what `/references` renders, so
the decision is already inside its blast radius. Folded in as part of the same diff: write
`ReferencesIndex.tsx` (filtered to `linked_shidduchim_count@eq: 0`, no search/filter/sort/
pagination, self-emptying, explainer + link to `/shidduchim` when empty) and delete
`ReferenceList.tsx`; migrate `references/index.ts` onto `buildEntityRoutes` + explicit
`hasShow`/`hasEdit`; add `ReferenceAttachToShidduch.tsx` as the one way an orphan surfaced by the
panel gets resolved; and widen the AD-24 guard in the same diff so clause (c) asserts a no-browse
entity's list *is* the declared index panel and clause (b) also catches variable-argument
`buildListPath(resource)` call sites. `NO_BROWSE_SURFACE_ENTITIES.references` itself is not removed
— it is a standing owner ruling (RULING 7) with no retiring story.

R4 (`reminders/reminderEntity.ts` + `ReminderCreateSheet.tsx`'s 100-row reference roster) and R5
(`englishCrmMessages.ts:50-51` filter labels) are deliberately **not** folded into 5.10 — they
belong to S16's wave.

### S25 — Accepted, not fixed: NULL `actor_member_id` will never be backfilled (item E)
Recorded as a **decision**, so nobody re-opens it as a bug. `af2074e` adds a 47-line comment above
`can_moderate_note` in `supabase/schemas/02_functions.sql` (comment only — `supabase db diff`
reports no schema change). The six live `kind = 'note'` rows with `actor_member_id IS NULL` stay as
they are, because: there is nothing to backfill *from* (`interactions` has exactly one
authorship-shaped column); NULL is **ongoing**, not a closed legacy set — the FK is
`ON DELETE SET NULL`, and a `SECURITY DEFINER` writer with no active context stamps
`current_member_id() = NULL` — so a backfill would have to be re-run forever; and the column is a
moderation **grant**, not a label, so inventing an author hands edit/delete rights over content to
someone who may not have written it, irreversibly. Verified on a live database in a rolled-back
transaction: with a NULL author, an owning-role member can moderate the row and a non-owning member
cannot. That fail-closed outcome is the policy working, not the defect the audit read it as.

Two small follow-ups nobody owns: `supabase/tests/interaction_note_authorship.sql` is the right
permanent home for that probe and would make the accepted behaviour CI-enforced; and
`providers/fakerest/dataProvider.ts:286-291` documents the same gap while pointing at "Story 3.6's
Review Fix Notes (S5)" — it should point at the new `can_moderate_note` comment as the canonical
record.

### S26 — `scripts/retired-names.json` carries four dead exemptions
`first-child`, `last-child`, `only-child` and `nth-child` are exempt terms for the
`1.3-children-contextual` pattern, but that pattern requires `child_`, `_child`, `child-` or
`public.children` — none of which those four can produce. Measured: 0 hits in the tree, 0
self-matches. They are dead config. Harmless now that `af2074e` scopes exemptions to their own span
rather than the whole line (previously any exempt term blanked its entire line, which was the actual
defect — 71 lines in the tree were blind spots), but they should be removed so the config stops
implying a coverage it does not have. Editing `retired-names.json` was outside every bucket's
declared paths.

### S27 — Hebrew / RTL UI ❌ DELIBERATELY DROPPED (2026-07-30)
Gap **D10** of the mobile gap analysis: the mockups made `EN ⇄ עברית` first-class and flipped
`dir` app-wide. The app ships English and French catalogues, sets `dir` nowhere, and has no
Hebrew catalogue. One of the six orphans; one of the two the owner did **not** adopt.

**What is dropped, precisely** — the distinction matters, because half of this is already built
and must not be "fixed" back:

- **Not dropped, already working:** bilingual *data*. AD-12's `*_he` columns are stored and
  rendered inline throughout (`reference_name_en` / `shidduch_name_en` and their Hebrew siblings).
  Displaying Hebrew **strings** is not an RTL **UI** and never depended on this item.
- **Dropped:** a Hebrew message catalogue, a language toggle beyond EN/FR, `dir="rtl"` on the
  document, and mirrored layout. PRD **PRV-12** defers internationalisation as a legal-scope
  matter; this ruling extends that to the UI direction question PRV-12 does not actually answer,
  so that it stops being answered by omission.

**The one honest cost, recorded because it grows.** Reversal is bounded but not cheap, and unlike
S9 it gets more expensive with every screen shipped: Tailwind physical utilities (`pl-`, `mr-`,
`text-left`, `left-0`) do not mirror, so an RTL retrofit is an app-wide audit whose size is
proportional to the surface area at the time. Epics 5–11 add roughly thirty screens. If Hebrew-first
users are ever in scope, **decide before Epic 6**, not after Epic 11 — that is the whole reason
this entry exists rather than a silent no.

**No hedge is mandated.** Requiring logical properties (`ps-`/`pe-`/`ms-`/`me-`) in new code was
considered and not adopted: a half-observed convention would produce a false sense that the
retrofit is prepaid.
