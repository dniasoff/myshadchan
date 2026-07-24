# Requirements Decisions Log — MyShadchan

Running record of directions given by Daniel, 2026-07-24, during the requirements
session with Mary (BA). Feeds **PRD Amendment A2**. Newest last.
Status: `DECIDED` · `RECOMMENDED (awaiting confirmation)` · `OPEN`.

---

## D1 — Consistent 360° view for every entity · **DECIDED**
This is a CRM, not a bespoke-screen website. Every entity uses the same 360° shell
(breadcrumb → identity header → stat band → alert slot → tabs → content → optional
right rail) and the same route convention. Entities differ only in what they declare.
Where the design comp is inconsistent between screens, CRM convention wins.

## D2 — The single gets a profile and a resume · **DECIDED**
A single (your own child, or yourself) has a profile *and* a resume — the resume you
send out. So a single and a suggested candidate are the same person-shape.

## D3 — The single logs into the same view as the parent · **DECIDED**
No separate portal UI. Same routes, same 360° views, filtered by permission at the
data layer (RLS + field-level visibility). Supersedes the token-link portal shipped
earlier in this project.

## D4 — Public, revocable resume/profile link for shadchanim · **DECIDED**
A single's profile/resume can be shared outward to shadchanim as a revocable public
link. (PRD §10 "Resume Sharing (revocable links)" already specifies this.)

## D5 — Shadchan interface promoted from Phase 2 to Phase 1 · **DECIDED**
Shadchan login, consent-scoped parent↔shadchan interaction, and in-platform redting
(`origin='shadchan'`, already reserved in the enum). Architecture provisioned the
`shadchan` role deny-only precisely so this needs no rework.

## D6 — Up to three personas per login · **DECIDED**
A single person may be any combination of **single**, **parent**, **shadchan**.

## D7 — Onboarding asks which personas apply, multi-select · **DECIDED**
Onboarding asks: *are you a single, a parent, a shadchan?* — **tick more than one**.
Provisioning follows from the ticks.

## D8 — Opt-in discoverability replaces "no public database" · **DECIDED**
PRV-2 amended (done, commit `2372c36`). Default is invitation-only; a shadchan or a
single MAY publish a narrow listing; publication is explicit, granular, revocable and
never exposes the working record. Families as such are never listed. Live site copy
corrected in the same commit.

## D9 — Communication across persona pairs · **DECIDED**
The system handles parent↔parent, parent↔single, parent↔shadchan, shadchan↔single, and
any other pairing.

## D15 — Thread visibility: open by default, private by deliberate act · **DECIDED**
- **Shadchan↔single communication is enabled by default** — not gated off.
- **Default visibility of any thread is "visible to all parties"** in that context
  (e.g. within a household: both parents, the single, and any helper entitled to see it).
- **Privacy is opted into per discussion**, not set globally — a given thread can be
  made private at its start or by agreement.
- **Any two parties may hold a private thread**: parent↔shadchan, single↔shadchan,
  parent↔parent, parent↔single. No pairing is structurally forbidden.
- **The family may also set a policy** (the default posture for new threads), but the
  shipped default is open/visible.

This is the same philosophy as PRV-4's transparency-with-a-floor: openness is the
default, privacy is a deliberate, visible choice rather than a hidden one.

*Design note:* thread visibility is therefore a **property of the thread**, not of the
persona pair — which keeps the permission model simple and auditable.

## D10 — Entity naming: "children" → "singles" · **RECOMMENDED**
"Children" breaks for a widow/divorcee managing her own shidduchim. The PRD already
says "the single". Rename in the UI now, table later.

## D12 — Personas change over a lifetime · **DECIDED**
Personas are **not fixed at onboarding**. A single marries and becomes a parent; a
parent is widowed or divorced and becomes a single again; a parent whose children are
settled becomes a shadchan. Therefore:
- personas can be **added and removed at any time** from settings, not just at signup;
- adding a persona provisions its context on demand (no re-registration);
- removing a persona **never destroys history** — a single who marries has their record
  closed/archived, not deleted, and past suggestions, references and threads remain
  intact and auditable;
- entitlement, listings and connections must all tolerate a persona being switched off
  (e.g. a withdrawn listing when someone stops being a shadchan).

## D11 — A self-manager is a single record inside their own household account · **RECOMMENDED**
One account = one household. A widow is both a member (login) and a `singles` row
pointing at herself (`children.member_id`, FK already exists), alongside rows for her
children. "Self-seeker" is therefore not a separate account type.

## D13 — Database entities must match domain reality · **DECIDED (scope OPEN)**
The schema is a fork of Atomic CRM and still carries entities with no meaning in
shidduchim, plus two names that are now untrue.

**Fossils to retire** (frontend references in brackets): `contacts` (47), `companies`
(22), `deals` (16), `sales` (15 — *this is the user/profile table, still named for a
salesperson*), `contact_notes` (12), `tags` (9), `deal_notes` (5),
`favicons_excluded_domains` (0).

**Renames for truthfulness:** `children` → `singles` (D10); `sales` → `members`/`users`;
`child_portal_tokens` → a share-link table under D4, or dropped under D3.

**Domain entities that stay:** accounts, account_members, singles, shadchanim,
shidduchim, references, reference_links, redts, resumes, date_records, interactions,
identity_signals, pipeline_transitions, shidduch_schools, tasks, inbox_items,
subscription, ai_usage, configuration.

## D16 — Fossil removal is a dedicated epic, done first · **DECIDED**
A single cleanup epic runs **before** the 360 rebuild: delete the 8 fork fossils and
their UI, and perform the truthful renames (`children` → `singles`,
`sales` → `members`). Rationale: every subsequent epic then works against an honest
schema and shrinks; and the cost only grows once personas, contexts, messaging and
listings are layered on top.

Confirms **D10** (singles rename) and, by consequence, **D11** (a self-managing person
is a `singles` row in their own household account, linked by `member_id`).

## D14 — Shadchanus is a separate workspace under one login · **DECIDED**
Ticking "shadchan" provisions a **second context**, not a role inside the household
account. One login, two switchable contexts: **My family** (household: my singles, my
pipeline, my references) and **My shadchanus** (my book, my connections, my redts).
The two never share a container, so a shadchan's book of other families can never be
read through a household account's RLS (PRV-2 preserved).

Implications:
- a **context switcher** is required in the app shell;
- `current_account_id()` must become **context-aware** (see Blocker) — the active
  context is explicit and user-selected, never inferred;
- contexts are provisioned **on demand** when a persona is added later (D12);
- entitlement/billing must be attributed to the right context.

## D17 — Phase 1 is one plan, shipped in dependency order · **DECIDED**
Nothing is descoped: the whole programme is specced now as Phase 1. Delivery is sliced
so each slice stands alone and ships:

1. **Cleanup & renames** (D16)
2. **Identity: personas + switchable contexts** (D6/D7/D12/D14 + the `current_account_id` blocker)
3. **360° consistency** across every entity (D1/D2)
4. **Singles logging in** to the same view (D3)
5. **Shadchan context + connections + messaging** (D5/D9/D15)
6. **Opt-in listings + revocable share links** (D4/D8)
7. **AI layer**

Each slice is independently useful; the order is dictated by dependency, not priority.

## D18 — Passwordless, invite-only authentication · **DECIDED**
The architecture wins over the shipped app. Target state:
- **magic-link / email-OTP** is the load-bearing sign-in path (PRV-9);
- **passkeys** as a later progressive enhancement, never the sole factor;
- **signup only by verified invite token** — the invite binds the new row to the
  inviter's context and authorises `role ≤ inviter authority` (never `shadchan` or
  `parent_admin` from the request body);
- **18+ affirmation** at signup;
- password + open signup are **retired**; existing logins need a migration path.

This is now load-bearing rather than cosmetic: invite tokens are the same mechanism
that adds a single or a helper to a household, and that establishes consent-based
parent↔shadchan connections.

## D19 — Greenfield engineering standard · **DECIDED** *(governs every epic)*
There are no real users to protect. Therefore:
- **All technical debt is addressed before feature work starts** — not deferred, not
  ticketed for later.
- **No backwards compatibility.** No compat layers, no deprecation shims, no aliased
  views or columns kept "just in case".
- **No fallbacks.** One code path per behaviour. If a thing is replaced, the old thing
  is deleted in the same change.
- **No lazy workarounds.** Fix causes, not symptoms.
- **Tidy code** is an acceptance criterion, not a nice-to-have.

Direct consequences that simplify earlier decisions:
- **D18** — no auth migration path is required; password + Google sign-in are **deleted**,
  not wound down.
- **D16** — fossils are **dropped outright**, not phased out; renames are straight renames
  with no aliases.
- **D3/E7** — the token-link portal is **deleted**, not retained as a capability.
- **The blocker** — `current_account_id()` is **rewritten** to be context-aware; no
  single-account fallback is preserved.
- Demo/seed data may be regenerated freely; schema may be rebuilt rather than patched
  where that yields a cleaner result.

---

## Open questions
- **O2 — May a shadchan message a single directly, without the parent?** Recommendation:
  parent visible on the thread by default; fully-direct requires explicit parent consent;
  n/a for an independent single. *Safety + PRV-4 dignity floor.*
*(O3 resolved — see D17.)*
*(O4 resolved — see D18.)*
- **O5 — Family shapes: confirm the full set** (1 self-managing single · 1 parent ·
  2 parents · + helpers · + logged-in singles · any + shadchan).

---

## Blocker carried into every epic

`public.current_account_id()` resolves a user to **one arbitrary account**
(`order by am.id limit 1`) and **every RLS policy depends on it**. Multi-persona and
multi-context are not buildable until this becomes an explicit, user-selected active
context. This is the foundation story of the programme, and an architecture amendment
rather than a ticket.
