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
- UX-DR8: References reached from a shidduch, not primary navigation.
- UX-DR9: Reuse awareness is mandatory wherever a reference is used.
- UX-DR10: Navigation set; `References` is not a primary destination.
- UX-DR11: Every screen renders empty/loading/error, light+dark, at 375px.

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

---

## Epic 1: Debt Clearance & Entity Truth

Remove every trace of the Atomic CRM fork and make the schema describe shidduchim
honestly, so that every later epic is smaller and no developer or agent has to guess
which "contact" is real. Greenfield: delete outright, no deprecation.

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
**And** References is not a primary destination
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
**And** a reference person still has their own 360, reached from diligence or search, not from primary navigation.

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
**And** unknown fields are blank, never invented
**And** "enter myself" is always available.

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
