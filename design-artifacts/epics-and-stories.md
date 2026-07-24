# MyShadchan — Epic & Story Plan

**Goal:** bring the product to a professional, internally consistent CRM — using the
design comp as *direction*, not as gospel.

## Governing principles (these outrank the mock)

1. **It is a CRM.** Standard CRM behaviour wins over bespoke per-screen invention.
   Where the comp is inconsistent between screens, we normalise.
2. **One 360° view, used by every entity.** Same shell, same regions, same order.
   An entity differs only by which tabs and fields it declares.
3. **Consistent, predictable navigation.** Every entity has the same URL shape, the
   same list behaviour, the same breadcrumb and back behaviour. Every mention of a
   record anywhere in the app is a link to that record's 360.
4. **One view, permission-scoped — not parallel UIs.** The child sees *the same
   screens* as the parent, with rows and fields filtered by the existing visibility
   model. No separate "portal" experience.
5. **Records live at URLs, not in modals.** Primary records are deep-linkable,
   shareable, and correct under browser back/forward.
6. **No gimmicks.** Anything decorative that doesn't serve recall, diligence or
   follow-through is cut or deferred.

---

## A. The architectural spine

### A.1 Route convention (identical for every entity)

| Purpose | Route | Notes |
|---|---|---|
| List | `/{entity}` | search, filter, sort, view toggle, saved state in URL |
| 360 view | `/{entity}/{id}` | defaults to the first tab |
| 360 tab | `/{entity}/{id}/{tab}` | deep-linkable; back/forward correct |
| Create | `/{entity}/new` | full page or sheet, consistent per entity |
| Edit | `/{entity}/{id}/edit` | — |

Entities: `shidduchim`, `shadchanim`, `references`, `children`, `tasks`.
**No entity is allowed a bespoke route shape.**

### A.2 The `Entity360` shell — fixed regions, in this order

```
┌─ Breadcrumb ────────────── ← Back to {list}  /  {Parent} · {context}
├─ Identity header ───────── avatar | title (+secondary script) | meta line | status chip
│                            quick actions (call · email · WhatsApp)   primary actions (Edit · +Task)
├─ Stat band ─────────────── entity-declared metrics (tabular-nums)
├─ Alert slot ────────────── catch / duplicate / attention banners
├─ Tab bar ───────────────── entity-declared tabs (URL-backed)
├─ Tab content ──────────────
└─ Right rail (optional) ─── context panels + record-scoped actions
```

Every region is optional per entity **but never re-ordered or re-styled**.

### A.3 Shared tab vocabulary

Universal modules, written once, reused by every entity:

| Tab | Universal? | Behaviour |
|---|---|---|
| **Overview** | ✅ all | entity-declared field groups |
| **Activity / Timeline** | ✅ all | append-only event log |
| **Notes** | ✅ all | free notes, authored + timestamped |
| **Tasks & Reminders** | ✅ all | record-scoped, assignable |
| **Files / Attachments** | ✅ all | any file, kept distinct from the resume |
| **Related** | ✅ all | entity-declared relationships |
| Resume · Photo · Medical · External links | shidduch only | sensitive/entity-specific |

### A.4 Entity tab matrix

| Entity | Tabs |
|---|---|
| **Shidduch** | Overview · Resume · Photo · Medical · Files · Diligence · External links · Notes · Tasks · Activity |
| **Shadchan** | Overview · Suggestions · Notes · Tasks · Activity |
| **Reference** | Overview · Conversations · Linked shidduchim · Notes · Tasks · Activity |
| **Child** | Overview · Shidduchim · Notes · Tasks · Activity |

### A.5 Permission model — one view, scoped

The schema already carries everything needed:
`account_members.role` (`parent_admin` · `helper` · `self_manager` · `shadchan`),
`children.member_id`, `shidduchim.owner_member_id`, `shidduchim.visibility`
(`shared` · `private_parent` · `private_child`), and `is_child_visible_state()`.

- A child is a **real authenticated member** (`self_manager`) linked via `children.member_id`.
- They open **the same routes and the same 360 views**.
- Filtering happens in **RLS + field-level visibility declarations**, never by building a
  second UI.
- Every field/tab declares a minimum visibility; the shell hides what the viewer may not see.

> **Consequence:** the token-link portal (`src/components/atomic-crm/portal/`, shipped in
> this project) is superseded and should be retired once role-based access lands.
> Sharing a read-only link may return later as a *capability on top of the same view*.

---

## EPIC 1 — The 360° framework  *(foundation; everything depends on it)*

**Outcome:** one shell + one tab vocabulary + one permission-aware renderer.

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 1.1 | **`Entity360` shell component** | Renders the six regions in fixed order; regions optional; consistent spacing/tokens; responsive to 375px; light + dark. | M |
| 1.2 | **URL-backed tab bar** | Tab state lives in the route (`/{entity}/{id}/{tab}`); deep links work; back/forward correct; unknown tab → first tab. | S |
| 1.3 | **Entity descriptor registry** | Each entity declares: label, icon, route, avatar rule, title/meta, stat band, tabs, quick + primary actions, relationships. One file per entity, no bespoke layout code. | M |
| 1.4 | **Visibility-aware field/tab rendering** | Fields and tabs declare a minimum role/visibility; the shell omits what the viewer can't see; never leaks a hidden field into the DOM. | M |
| 1.5 | **Universal `Activity` tab** | Append-only event log for any entity; consistent event rendering; paginated. | M |
| 1.6 | **Universal `Notes` tab** | Add/edit/delete, author + timestamp, consistent empty/loading states. | S |
| 1.7 | **Universal `Tasks & Reminders` tab** | Record-scoped list, add, complete, snooze, assign. Depends on Epic 6. | M |
| 1.8 | **Universal `Files` tab** | Upload/replace/delete, type + size, per-file visibility. | M |
| 1.9 | **Universal `Related` tab** | Renders declared relationships as linked record rows. | S |
| 1.10 | **`RecordLink` primitive** | *Every* mention of a record anywhere (board card, list row, timeline entry, rail panel, search result) uses one component and routes to that record's 360. No ad-hoc links. | S |

---

## EPIC 2 — Consistent list views  *(the other half of a CRM)*

**Outcome:** every entity list behaves identically.

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 2.1 | **`EntityList` framework** | Search, filter, sort, pagination, empty/loading/error — all URL-backed and identical across entities. | M |
| 2.2 | **List / Cards view toggle** | Persisted per entity; same control position and behaviour everywhere. | S |
| 2.3 | **Shidduchim list view** | New `/shidduchim` list (the comp's "Shidduchim — {child}"): search, list/cards, per-state grouping, switch to board. | M |
| 2.4 | **Board ⇄ list parity** | Board and list are two views of the same collection and same filters; switching preserves context. | S |
| 2.5 | **Normalise existing lists** | Shadchanim, References, Children adopt `EntityList` (search + toggle + sort they currently lack). | M |
| 2.6 | **Global search** | One search across entities returning `RecordLink` results. | M |

---

## EPIC 3 — Navigation & IA correction

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 3.1 | **Nav to the agreed set** | Dashboard · Inbox · Pipeline · **Shidduchim** · Shadchanim · **Tasks** · Reminders · Settings. | S |
| 3.2 | **Remove top-level References** | References reachable from a shidduch's Diligence tab, from a reference's own 360, and from global search — not from the primary nav. | S |
| 3.3 | **Consistent breadcrumbs** | Every 360 shows a predictable back target; context breadcrumbs (`← Dovid Berkowitz · 360° view`) where a record is reached from a parent. | S |
| 3.4 | **Mobile nav parity** | Bottom nav exposes the same destinations (overflow where needed); no desktop-only destination. | S |

---

## EPIC 4 — Shidduch 360  *(the biggest single gap: currently ~15%)*

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 4.1 | **Modal → page** | `/shidduchim/{id}` is a full page on the shell; the routed dialog is retired; board cards link to it. | M |
| 4.2 | **Overview tab** | Bilingual name, age/DOB, height, background, location, shul, current + earlier yeshiva, father, mother, marital status, children. | M |
| 4.3 | **Marital status + children fields** | Schema + form + display (Never married / Divorced / Widowed). | S |
| 4.4 | **Resume tab** | Stored document, view, download, replace, **version history**; original never mutated. | L |
| 4.5 | **Photo tab** | Upload/replace/hide; hidden by default behind an explicit reveal; per-photo visibility; never included in a share unless chosen. | M |
| 4.6 | **Medical tab** | Sensitive note class; never visible to child or helper roles; enforced in RLS, not just UI. | M |
| 4.7 | **Files tab** | Voice notes/screenshots, distinct from the resume. | S |
| 4.8 | **External links tab** | Add/remove profile links; open in new tab; nothing shared back. | S |
| 4.9 | **Notes + Tasks + Activity tabs** | Adopt the universal modules. | S |
| 4.10 | **Right rail** | Child's input · reminders on this suggestion · forward resume · share. | M |
| 4.11 | **Decision control** | Consistent "set decision" affordance honouring the state machine (decisions only from Look-into). | S |
| 4.12 | **Catch banner in place** | Duplicate/prior-date banner rendered in the alert slot. | S |

---

## EPIC 5 — Other entity 360s  *(consistency)*

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 5.1 | **Shadchan 360** | Shell + tabs (Overview · Suggestions · Notes · Tasks · Activity); contact quick actions (call/email/WhatsApp); stat band (redts / looked into / led to dates). | M |
| 5.2 | **Reference 360** | Shell + tabs (Overview · Conversations · **Linked shidduchim** · Notes · Tasks · Activity). Reachable from diligence + search, not nav. | M |
| 5.3 | **Child 360** | Shell + tabs (Overview · Shidduchim · Notes · Tasks · Activity). Same view the child themselves gets. | M |
| 5.4 | **Retire bespoke detail pages** | Existing `*Show` components fold into descriptors; no entity keeps a hand-rolled layout. | M |

---

## EPIC 6 — Tasks & Reminders  *(restore a deleted capability)*

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 6.1 | **Revert the `/tasks` redirect** | `/tasks` no longer redirects to `/reminders`. | S |
| 6.2 | **Task assignment** | Tasks carry an assignee (a family member); "assigned to me" and "assigned by me" views. | M |
| 6.3 | **Tasks list** | `EntityList`; grouped; filter by assignee/target/status. | M |
| 6.4 | **Record-scoped tasks** | Tasks tied to a shidduch/shadchan/reference/child surface in that record's Tasks tab and rail. | S |
| 6.5 | **Tasks vs Reminders defined** | One model, two views: Reminders = time-based nudges for me; Tasks = assignable work. Documented, no duplicate concepts. | S |

---

## EPIC 7 — Diligence (references done right)

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 7.1 | **Diligence tab on the shidduch** | "People to speak to" with per-person status and **N of M spoken to**. | M |
| 7.2 | **Reuse awareness (mandatory)** | Each person shows "You've spoken to them about N other shidduchim" vs "First time speaking with them", linking to the others. | S |
| 7.3 | **Call logging** | Outcomes: answered / no answer / call back / they'll call back; timestamped; feeds Activity. | M |
| 7.4 | **Relationship-tailored questions** | Question set by relationship; ask/answered state persists per conversation. | M |
| 7.5 | **Cross-reference summary** | What everyone agreed on, where they differ, what nobody was asked. | M |
| 7.6 | **Migrate standalone references** | Existing records keep working; entry points move; no data migration. | S |

---

## EPIC 8 — Unified access for the child  *(replaces the token portal)*

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 8.1 | **Child as a member** | Invite/link a child to `account_members` (`self_manager`) via `children.member_id`. | M |
| 8.2 | **RLS row scoping** | A child sees only `visibility='shared'` + `is_child_visible_state()` rows — enforced server-side. **Security review required.** | M |
| 8.3 | **Field-level scoping** | Medical, candid diligence, private notes never reach a child; enforced in RLS. **Security review required.** | M |
| 8.4 | **Same 360, scoped** | The child opens the same routes and shell; no separate portal UI. | S |
| 8.5 | **Child input back** | The child can leave input on a suggestion; it appears in the parent's right rail. | M |
| 8.6 | **Retire the token portal** | Remove `portal/` + `child_portal_tokens` once 8.1–8.4 ship, or keep the link strictly as a capability over the same view. | S |

---

## EPIC 9 — Capture funnel

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 9.1 | **Share-target completion** | Source (WhatsApp/SMS/photo), attribution when the sender is ambiguous, which child, **link to an existing suggestion**. | M |
| 9.2 | **Inbox triage parity** | Consistent list behaviour; "needs your confirmation — we won't guess". | S |
| 9.3 | **Email ingress verification** | End-to-end test of the inbound webhook path. | S |
| 9.4 | **Resume auto-parse review** | "Confirm the details" over an extracted draft; original kept as received; "enter myself" always available. Depends on Epic 11. | L |

---

## EPIC 10 — Trust, privacy & settings

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 10.1 | **Transparency matrix** | Parent ↔ child, both directions, generated from the *actual* visibility rules — not hand-written copy. | M |
| 10.2 | **Dignity floor** | The child's guaranteed minimum visibility cannot be switched off; enforced server-side. | S |
| 10.3 | **Data ownership** | Export / delete, sub-processor disclosure. | S |
| 10.4 | **Settings consistency** | Desktop layout consistent with the rest of the app. | S |

---

## EPIC 11 — AI layer  *(last; gated)*

| # | Story | Acceptance criteria | Effort |
|---|---|---|---|
| 11.1 | **Server-side entitlement on inference** | Every AI call re-checks entitlement server-side before spending budget. | M |
| 11.2 | **Resume extraction** | OCR/LLM → structured draft; never fabricates; unknown fields stay blank. | L |
| 11.3 | **Diligence dossier** | Consensus / contradiction / **gap**, sourced only from this account's own records. | L |

---

## Sequencing

```
EPIC 1 (360 framework) ──┬── EPIC 4 (Shidduch 360) ── EPIC 7 (Diligence)
                         ├── EPIC 5 (Other 360s)
                         └── EPIC 8 (Child access) ── EPIC 10 (Transparency)
EPIC 2 (Lists) ── EPIC 3 (Nav/IA)
EPIC 6 (Tasks) ─── feeds the Tasks tab in EPIC 1.7
EPIC 9 (Capture) ── 9.4 needs EPIC 11
EPIC 11 (AI) ── last
```

**Recommended first slice:** Epic 1 → Epic 4 (shidduch on the new shell) → Epic 3 →
Epic 5. That produces a consistent, professional core before any new capability.

---

## Definition of done (every story)

- `make typecheck` and lint clean; unit tests for logic, and for any RLS change a
  negative test proving the wrong role sees nothing.
- Light **and** dark; desktop **and** 375px.
- Empty, loading and error states rendered — never a blank region.
- Tokens only; no bespoke colours; logical properties.
- Any record mention uses `RecordLink`; any list uses `EntityList`; any detail uses `Entity360`.
- Nothing fabricated: if the data doesn't exist, the field is omitted, not invented.

---

## Decisions still needed from you

1. **Reference 360 — confirm.** A reference *person* gets a consistent 360 (their details,
   every shidduch discussed, all calls), reachable from diligence and search but **not**
   from the primary nav. This reconciles "same 360 for all entities" with "references
   aren't standalone". Agree?
2. **Child access mechanism.** Invited account member (`self_manager`) — my recommendation,
   and what "same view as the parent" implies — versus keeping a token link. If members,
   the shipped token portal is retired.
3. **Auth model.** The comp shows magic-link + passkey; the app has password + Google.
   Keep as-is, or move?
4. **Photo/medical policy.** These are the most sensitive fields in the product. Confirm
   that helpers as well as children are excluded from medical.
5. **Where the comp and CRM convention conflict**, I default to CRM convention (per your
   direction). Tell me if any specific comp screen is meant to be followed exactly.
