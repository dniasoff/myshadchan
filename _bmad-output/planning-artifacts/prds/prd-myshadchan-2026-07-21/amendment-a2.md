# MyShadchan — PRD Amendment A2

**Date:** 2026-07-24 · **Author:** Mary (BA) with Daniel · **Status:** approved
**Amends:** `prd.md` (v1, 78 FRs) and `addendum.md` (Phase-2 spec)
**Source of record:** `decisions-log.md` (D1–D19)

A2 does three things: it **promotes** the Phase-2 shadchan interface into Phase 1, it
**adds** an identity model the PRD never had (multiple personas per login), and it
**corrects** requirements that no longer match the product's direction.

New numbering continues the PRD: **FR79+**, **PRV-13+**, **NFR-14+**.

---

## A2.0 — Governing engineering standard *(D19)*

**NFR-14 — Greenfield standard.** There are no users to protect. All technical debt is
cleared **before** feature work. **No backwards compatibility, no deprecation shims, no
fallbacks, no aliased views or columns.** One code path per behaviour: when something is
replaced, the replaced thing is deleted in the same change. Tidy code is an acceptance
criterion. Schema may be rebuilt rather than patched where that is cleaner; demo and seed
data may be regenerated freely.

---

## A2.1 — Identity: personas and contexts *(D6, D7, D12, D14)*

The PRD assumed one user → one account → one role. That is replaced.

- **FR79 — Three personas.** A login may hold any combination of **single**, **parent**,
  **shadchan**. All three simultaneously is valid.
- **FR80 — Onboarding asks which personas apply**, as a **multi-select** ("are you a
  single, a parent, a shadchan?"). Provisioning follows from the selection.
- **FR81 — Personas are mutable for life.** Personas can be added or removed at any time
  from settings without re-registration. A single who marries becomes a parent; a parent
  who is widowed or divorced becomes a single again; a parent whose children are settled
  becomes a shadchan.
- **FR82 — Removing a persona never destroys history.** The associated records are
  closed/archived, never deleted. Past suggestions, references, threads and decisions
  remain intact and auditable.
- **FR83 — Two context types.** **Household** (a family unit: its singles, pipeline,
  references, tasks) and **Shadchanus** (a shadchan's own book, connections and redts).
  A shadchan's work is **never** stored in a household context — that would place other
  families' data inside a family's account, violating PRV-2.
- **FR84 — Explicit active context.** The user's active context is **explicit and
  user-selected**, surfaced by a **context switcher** in the app shell, and never
  inferred. Every authorisation decision derives from the active context.
- **FR85 — On-demand provisioning.** Adding a persona provisions its context at that
  moment; no context exists before it is needed.

> **Architecture impact (blocking).** `public.current_account_id()` resolves a user to one
> arbitrary account (`order by am.id limit 1`) and **every RLS policy depends on it**.
> It must be **rewritten** as a context-aware resolver with no single-account fallback
> (NFR-14). This is the first engineering story after cleanup, and requires an amendment
> to ARCHITECTURE-SPINE (AD-1/AD-2).

---

## A2.2 — Entities must match reality *(D10, D13, D16)*

- **FR86 — "Singles", not "children".** The entity for a person being redt for is a
  **single**. "Children" is false for a widow, divorcee or independent adult managing
  their own shidduchim, and the PRD's own prose already says *"the single"*.
- **FR87 — A self-managing person is a single in their own household.** One account = one
  household. A self-managing adult is both a **member** (a login) and a **single** record
  pointing at themselves (`member_id`). "Self-seeker" is therefore not a separate account
  type.
- **FR88 — Fork fossils are removed.** The following carry no meaning in shidduchim and
  are **deleted** (schema + UI): `contacts`, `companies`, `deals`, `deal_notes`,
  `contact_notes`, `tags`, `favicons_excluded_domains`. `sales` — currently the user
  /profile table — is renamed **`members`**.
- **FR89 — Truthful naming throughout.** No table, column, route or component may retain
  a name that misdescribes what it holds.

---

## A2.3 — The single's own access *(D2, D3)*

- **FR90 — A single logs in and sees the same views as the parent.** Same routes, same
  360° screens, same components. There is **no separate portal UI**.
- **FR91 — Difference is permission, not interface.** What a single sees is filtered by
  row- and field-level rules in the database (visibility + state authority), never by
  building a parallel surface.
- **FR92 — A single has a profile and a resume.** A single carries the same person-shaped
  record as a suggested candidate: profile, resume, photo, files, notes, tasks, activity.
- **FR93 — The dignity floor holds** (PRV-4): a single always sees their live prospects
  and can give input, and this cannot be switched off.

---

## A2.4 — Communication *(D9, D15)*

- **FR94 — Any persona pair may communicate**: parent↔parent, parent↔single,
  parent↔shadchan, shadchan↔single, and any other pairing. No pairing is structurally
  forbidden.
- **FR95 — Threads are subject-scoped**, attached to a suggestion or to a relationship —
  structured records, not free-form chat.
- **FR96 — Default visibility is open.** A new thread is visible to all parties in its
  context (e.g. within a household: both parents, the single, entitled helpers).
- **FR97 — Privacy is per discussion.** A thread may be made private at creation or by
  agreement. **Visibility is a property of the thread**, not of the persona pair.
- **FR98 — Private threads are available to any two parties**, including single↔shadchan.
- **FR99 — Families may set the default posture** for new threads; the shipped default is
  open.
- **FR100 — Delivery is in-app + email + push. No outbound SMS, ever** (carried from v1).

---

## A2.5 — Discoverability and listings *(D4, D8)*

PRV-2 is **already amended** in `prd.md` (commit `2372c36`).

- **PRV-13 — Publication is an act, never a state.** Nothing is discoverable by default.
  Publication is explicit, granular (field by field), revocable, and narrow — a listing
  never exposes the working record (pipeline, private notes, references' candid words,
  diligence, dating history, medical). **Families as such are never listed**, and a
  listing never reveals who is researching whom.
- **FR101 — A shadchan may publish a professional listing** (name, area, how to reach).
- **FR102 — A single may publish a listing profile**, each field opted in individually.
- **FR103 — Only the manager of a single may publish that single's listing** — the parent,
  or the single themselves if self-managing.
- **FR104 — A single with a login may always withdraw their own listing**, even one a
  parent published (dignity floor, PRV-4).
- **FR105 — Withdrawal removes the listing from search immediately.**
- **FR106 — Public search** returns only published listings and only published fields.
- **FR107 — Revocable share links.** A single's profile/resume can be shared outward to a
  shadchan by a revocable, expiring link (extends PRV-8 and PRD §10). This is the sole
  surviving use of tokenised access; the child-portal token surface is **deleted** (D19).

---

## A2.6 — Shadchan interface — promoted to Phase 1 *(D5)*

Previously `addendum.md` §Phase 2 and ARCHITECTURE "Deferred". The `shadchan` role and
`origin='shadchan'` were provisioned in v1 precisely so this needs no rework.

- **FR108 — Shadchan login** into a Shadchanus context (FR83).
- **FR109 — Consent-based connection.** A parent explicitly connects with a specific
  shadchan; there is no directory-driven or automatic linkage.
- **FR110 — In-platform redting.** A connected shadchan can send a suggestion directly
  into a parent's pipeline, recorded with `origin='shadchan'`.
- **FR111 — Suggestions arrive for review, never auto-filed** — a shadchan-originated
  suggestion enters the same confirm step as any other inbound (AD-7).
- **FR112 — A shadchan tracks their own conversations** in their own context.
- **FR113 — Hard privacy invariant.** A shadchan sees **only** the interaction/suggestion
  thread they are party to — **never** the family's private notes, references' candid
  words, dating history, other shadchanim's suggestions, or the single's data. Consent-based
  messaging, **not** database exposure. PRV-2's "no networked pool" is preserved.

---

## A2.7 — Consistent 360° architecture *(D1)* — UX design requirements

The design comp is **directional, not binding**: this is a CRM, and where the comp is
inconsistent between screens, CRM convention wins.

- **UX-DR1 — One `Entity360` shell** used by every entity, with fixed regions in fixed
  order: breadcrumb → identity header (avatar, title, meta, quick actions, primary
  actions) → stat band → alert slot → tab bar → content → optional right rail. Regions are
  optional per entity but never reordered or restyled.
- **UX-DR2 — One route convention** for every entity: `/{entity}` (list),
  `/{entity}/{id}` (360), `/{entity}/{id}/{tab}` (deep-linkable tab), `/{entity}/new`,
  `/{entity}/{id}/edit`. No entity gets a bespoke route shape.
- **UX-DR3 — Records live at URLs, not in modals.** Primary records are deep-linkable,
  shareable, and correct under browser back/forward.
- **UX-DR4 — Shared tab vocabulary**, written once and reused: Overview, Activity,
  Notes, Tasks, Files, Related. Entity-specific tabs are the exception, not the rule.
- **UX-DR5 — Entity tab matrix.**
  · **Single**: Overview · Resume · Photo · Files · Shidduchim · Notes · Tasks · Activity
  · **Shidduch**: Overview · Resume · Photo · Medical · Files · Diligence · External links · Notes · Tasks · Activity
  · **Shadchan**: Overview · Suggestions · Notes · Tasks · Activity
  · **Reference**: Overview · Conversations · Linked shidduchim · Notes · Tasks · Activity
- **UX-DR6 — `RecordLink` primitive.** *Every* mention of a record anywhere — board card,
  list row, timeline entry, rail panel, search result — uses one component and routes to
  that record's 360.
- **UX-DR7 — One `EntityList` framework.** Search, filter, sort, pagination and a
  List/Cards toggle behave identically for every entity, with state held in the URL.
- **UX-DR8 — References are reached from a shidduch**, not from primary navigation. A
  reference *person* still has a consistent 360, reachable from diligence and from search.
- **UX-DR9 — Reuse awareness is mandatory.** Wherever a reference is used, the system
  states plainly whether this is a first conversation or one of several
  ("you've spoken to them about N other shidduchim").
- **UX-DR10 — Navigation** is: Dashboard · Inbox · Pipeline · Shidduchim · Shadchanim ·
  Tasks · Reminders · Settings, plus the context switcher. `References` is **not** a
  primary destination.
- **UX-DR11 — Every screen** renders empty, loading and error states; light and dark; and
  works at 375px.

---

## A2.8 — Authentication *(D18)* — amends PRV-9

- **FR114 — Passwordless sign-in.** Magic-link / email-OTP is the load-bearing path.
- **FR115 — Passkeys** as a later progressive enhancement, never the sole factor.
- **FR116 — Invite-token signup only.** The invite binds the new member to the inviter's
  context and authorises `role ≤ inviter authority`; `role` is never accepted from the
  request body.
- **FR117 — 18+ affirmation** at signup.
- **FR118 — Password and Google sign-in are deleted** (NFR-14 — no migration path, no
  fallback).
- **FR119 — Invites are the one mechanism** for adding a member to a household, giving a
  single their login, and establishing a parent↔shadchan connection.

---

## A2.9 — Requirements amended or superseded

| Requirement | Change |
|---|---|
| **PRV-2** | Amended in place — "no pooling; nothing public unless published" (D8) |
| **PRV-4** | Roles extended: personas replace single-role membership; dignity floor retained |
| **PRV-9** | Superseded by FR114–FR118 |
| **PRD §10** | Retained and strengthened by FR107 |
| **PRD §15** | Superseded by FR90–FR93 — the single logs into the *same* views |
| **addendum §Phase 2** | Promoted to Phase 1 — FR108–FR113 |
| **ARCHITECTURE "Deferred: Phase-2 shadchan interface"** | No longer deferred |
| **AD-1 / AD-2** | Require amendment for contexts and personas (see A2.1) |

---

## A2.10 — Delivery order *(D17)*

One plan; nothing descoped; sliced by dependency, each slice independently shippable.

1. **Cleanup & renames** — fossils deleted, `children`→`singles`, `sales`→`members` (FR86–89)
2. **Identity** — personas, contexts, context-aware authorisation, invites (FR79–85, FR114–119)
3. **360° consistency** — shell, routes, tabs, lists, links (UX-DR1–11)
4. **The single's access** — login, profile, resume, dignity floor (FR90–93)
5. **Shadchan context** — connections, redting, communication (FR94–100, FR108–113)
6. **Listings & sharing** — publication, search, revocable links (FR101–107, PRV-13)
7. **AI layer** — dossier and auto-parse, server-gated

---

## A2.11 — Open

- **O5 — Family shapes.** Proceeding with: 1 self-managing single · 1 parent · 2 parents ·
  any of those + helpers · + logged-in singles · any + shadchan. To be confirmed.
