# Suggestions Pipeline — Authoritative Build Brief

Consolidates PRD (core loop + constraints), ARCHITECTURE-SPINE, SOLUTION-DESIGN (+ Phase-2
addendum), and the architecture-review findings into one brief for building the flagship
Suggestions Pipeline (Deals Kanban → 7-state Suggestions board) on real Atomic CRM components.

**Precedence when sources conflict:** architecture-review corrections (D1–D9, F1–F11) > spine
(AD-*) > solution-design > PRD prose > addendum. Addendum's column lists are superseded by
spine wherever they differ (explicitly true for `pipeline_state` wording).

---

## 1. Data Model

Every table below carries `id bigint identity`, `account_id bigint not null` (AD-1), `created_at
timestamptz`. Names are `snake_case`; bilingual fields are `_en`/`_he` pairs (AD-12, NFR-6).

### `accounts`
`id, name, transparency_level, data_region, created_at` + billing co-located: `stripe_customer_id,
subscription_status(trialing|active|past_due|canceled), plan, current_period_end, trial_end`
(spine supersedes addendum's separate `subscription` entity).

### `account_members`
`id, account_id, user_id(uuid), role, status, invited_by, created_at`.
`role` ∈ `parent_admin | child_candidate | helper | self_manager | shadchan` — **`shadchan` is
in the enum from day one but deny-only (granted nothing) in v1 RLS** (AD-2, §16, F8).
Replaces the fork's `sales` table.

### `candidates` (the "child"/single being suggested for)
`id, account_id, created_at, first_name_en, first_name_he, last_name_en, last_name_he, gender,
dob, community, status, member_id?` (optional link to a `child_candidate` login identity).

### `shadchanim`
`id, account_id, created_at, name, location, contacts jsonb, notes, responsiveness`.

### `suggestions` — the central object (AD-4)
```
id, account_id, created_at,
candidate_id            -- FK candidates, exactly one (FR14)
shadchan_id             -- FK shadchanim ("via {shadchan}", FR18)
name_en, name_he        -- single's identity (bilingual, AD-12)
parents, seminary, shul, location   -- also bilingual where name-bearing
age, height             -- informational only, NEVER matching signals (FR11)
pipeline_state          -- single enum, 7 values (below) — NO decision_substate column (D4)
first_suggested_by      -- provenance: shadchan_id + date of first suggestion (FR13)
resume_id               -- FK resumes, 1:1
close_reason            -- set when entering a terminal state
origin                  -- 'channel' | 'manual' | 'shadchan' (shadchan reserved Phase-2, §16)
owner_member_id         -- visibility owner (AD-3)
visibility              -- 'shared' | 'private_parent' | 'private_child' (AD-3)
```
Sole INSERT path: `createSuggestion()`. Sole state-change path: `transitionSuggestion()`. No
other writer of `pipeline_state`/`visibility`/`owner_member_id` (AD-4).

**`pipeline_state` enum — exactly 7 values:**
`new · look_into · not_sure · for_sure_not · yes · unsure · no`

Grouped for the board (matches the reference mockup's `group` field):
- **Triage:** `new`, `look_into`, `not_sure`, `for_sure_not`
- **Decision** (reachable only from `look_into`): `yes`, `unsure`, `no`

**Transition graph** (build guidance — PRD only pins the "decision only from look_into"
constraint; the rest is `[ASSUMPTION]`, confirm with product before hardening):
- `new → {look_into, not_sure, for_sure_not}`
- `not_sure → {look_into, for_sure_not}`
- `look_into → {yes, unsure, no}` — the only door into Decision phase
- `for_sure_not, yes, unsure, no` — terminal for v1 (no reopen flow specified; `close_reason`
  set on entry)
- Filing may jump straight from capture into `for_sure_not` (a gut pass with zero investigation
  is legal per UJ-1 step 5 and D4) — do not force every suggestion through `new`.

### `resumes` (1:1 with a suggestion)
`id, account_id, created_at, files jsonb, photos jsonb, extracted jsonb, sections jsonb`.

### `references` / `reference_links`
`references`: `id, account_id, created_at, name_en, name_he, relationship, phone (normalized),
school, grad_year` — reusable within an account only (PRV-2).
`reference_links`: join `references` ↔ `suggestions`, carries `call_status, what_they_said,
conversation_log jsonb` — **candid content, child-invisible** (AD-3, F3).

### `date_records` (dating history, powers dedupe)
`id, account_id, created_at, candidate_id, person identity fields, date(s), outcome, notes`.

### `inbox_items` (channel intake — DEFERRED, see §5, but the shape is documented for schema
readiness / D2)
`id, account_id, created_at, source_channel, raw payload + attachments, email_mode?,
detected_shadchan (+confidence), parse_status, filed_status('unfiled'|'filed'|'archived'),
resulting_suggestion_id`.

### `identity_signals` (dedupe substrate — DEFERRED logic, schema slot only, see §5)
Account-scoped, materialized by **one** trigger from `suggestions`/`date_records`/`references`
writes. Signal fields: `name_en, name_he, parents, seminary, shul, location` — **never
age/height, never name-only** (FR11, AD-5, AD-12).

### Not in this build's core scope (noted, not built now)
`share_links`/`share_access_log`, `candidate_input`/`candidate_preferences`
(`visibility='private_child'`), `account_phone`, `ai_usage_meter`, polymorphic
`interactions`/`tasks` (need `(account_id,id)` composite integrity per AD-1/F9).

### ER shape
```
candidates ||--o{ suggestions        shadchanim ||--o{ suggestions
suggestions ||--|| resumes           suggestions ||--o{ reference_links
suggestions ||--o{ interactions      inbox_items ||--o| suggestions ("filed into", zero-or-one)
```

---

## 2. Invariants (must hold)

1. **Single INSERT path (AD-4, corrected by D2).** In this build's scope (manual add only,
   channels deferred — §5), `createSuggestion()` is the sole function that inserts into
   `suggestions`; the board/UI never issues a raw `dataProvider.create('suggestions', …)`. Write
   it as the **low-level shared primitive** — when inbox-filing ships later, `fileInboxItem()`
   must call this same function internally, never duplicate the INSERT (this is what prevents
   D2's "two doors into suggestions" failure mode). `createSuggestion()` sets `origin`,
   `visibility`, `owner_member_id`, initial `pipeline_state`, and (once dedupe logic lands)
   invokes `matchIdentity()`.
2. **Single transition guard (AD-4, D4).** `transitionSuggestion(id, from, to)` is the sole
   writer of `pipeline_state`. It enforces the transition graph (§1) as data, not scattered
   `if`s. `decision_substate` does not exist as a separate column — collapse everything into
   `pipeline_state`.
3. **`for_sure_not` ≠ `no` (FR16).** Gut, pre-investigation reject (`for_sure_not`) and
   post-investigation reject (`no`, only reachable via `look_into`) are separate enum values,
   never inferred from a boolean, never merged into one "rejected" bucket. This must be visible
   in both the schema and the board (§3).
4. **Dedupe hook contract, never auto-merge (FR10-13, AD-5, D1, F1) — logic itself is DEFERRED
   (§5), but any hook wiring built now must respect this contract:** one account-scoped
   `matchIdentity()`, one `IMMUTABLE` Postgres `normalize_identity()` function invoked by trigger
   on every write path — never a client-side/TS normalizer. Signals = name(en+he) + parents +
   seminary/yeshiva + Shul + location; **never age/height, never name-only**. Output = candidates
   + confidence + deciding facts; user confirms or dismisses; system never auto-merges. Every
   `identity_signals` query must carry `account_id` — a match must never cross accounts (F1).
5. **Tenancy at the DB (AD-1).** Every suggestions-pipeline table: non-null `account_id`,
   `FORCE ROW LEVEL SECURITY`, `USING`/`WITH CHECK` scoped to the caller's account, no `anon`
   grants. Full RLS *enforcement* is scoped per §5 (deferred to Epic-1), but every table this
   build creates must still carry the `account_id` column and be built so RLS can be turned on
   without a schema change.
6. **One visibility function, dignity floor, closed enumeration (AD-3, corrected by D5).**
   A single SQL `SECURITY DEFINER` function `child_visible_suggestions()` must be the one
   authority for which states a child sees — called by both RLS and the portal's curated view,
   never re-implemented in the frontend. It must classify **all 7 states explicitly, closed
   enumeration** (not an include-list and an exclude-list that leave gaps):
   - **Visible to child:** `look_into`, `yes`, `unsure`
   - **Hidden from child:** `new`, `not_sure`, `for_sure_not`, `no`
   (D5 flags `new`/`not_sure`/`no` as the ambiguous cases the closed table must pin — treat all
   four "hidden" states as OUT unless product overrides.) Visibility extends to every child table
   of a suggestion (`reference_links`, `interactions`, `resumes`) via join-to-parent — never an
   independently-derived policy on the child table (F3). Dignity floor is un-lowerable: the child
   always sees their live prospects and can give input, regardless of the account's
   `transparency_level` setting.
7. **Bilingual normalize (AD-12).** Names and identity fields store both `_en`/`_he` scripts.
   Normalization is the single `IMMUTABLE` Postgres function from invariant 4 — no second
   normalizer anywhere, no resource assumes a single script.
8. **dataProvider seam + FakeRest mirror + `*_summary` views (AD-10).** The frontend reaches
   `suggestions` only through the `dataProvider`. Board list/detail reads go through a
   `suggestions_summary` view (analogous to `contacts_summary`). Every new resource/method is
   mirrored in the FakeRest provider — build-time selection (`main.tsx` = supabase, `demo/main.tsx`
   = fakerest), added to both `DesktopAdmin` and `MobileAdmin`.

---

## 3. Design Accuracy

Grounded in the existing mockup (`design-artifacts/reference-board-after.html` +
`calm-ledger-theme.css`) — treat these as the reference implementation to port into real
components.

**Board:** single board, 7 columns, two visual groups — **Triage** (`New, Look-into, Not-sure,
For-sure-not`) and **Decision** (`Yes, Unsure, No`). Each column header carries the state's EN
label + HE label (e.g. "New" / "חדש") and its `--st-*` color.

**Card anatomy** (per suggestion):
- Candidate name, **EN + HE** side by side (or stacked, RTL-aware)
- **Monogram** avatar (initials, e.g. "AR")
- **`via {shadchan}`** chip — always visible, never click-to-reveal (FR18) — `.via` class
- **Redt date** — "Redt {date}" with a clock/calendar glyph, tabular-numeral styled
- **Catch-chip placeholder** — a slot for the dedupe/history-match indicator (e.g. "Mrs. Feldman
  suggested him 3 months ago", "Rivky may have dated him — Feb 2026"); render the chip
  *slot/UI* now, wire it to real `matchIdentity()` output later (logic is deferred, §5) — do not
  ship a fake/random chip, leave it empty until real data exists.

**Gut-vs-decided visual distinction (FR16):** `For-sure-not` renders in the quiet, muted
`--st-fsn` warm-grey token with a "gut set-aside — no full look yet" tone; `No` renders in the
distinct `--st-no` clay/terracotta token with a "looked into — decided against" tone. These must
never share a color or a label — the visual system is how the schema-level for_sure_not≠no
invariant (§2.3) becomes legible to the user.

**Tokens:** `--st-new, --st-look, --st-notsure, --st-fsn, --st-yes, --st-unsure, --st-no` (defined
in `calm-ledger-theme.css`, light + dark variants) drive column accent, card left-border/chip, and
any state badge. Reuse these tokens verbatim — do not introduce a parallel color system.

---

## 4. Atomic CRM Lineage

| New resource | Forked/transformed from | Notes |
|---|---|---|
| `suggestions` (board) | `deals/` (Kanban) | Column-per-state instead of column-per-stage; drag-drop + mobile quick-move (FR17); card = deal-card pattern, fields replaced per §3 |
| `candidates` | `contacts/` | Bilingual name fields added; per-candidate isolated pipeline (FR50) |
| `shadchanim` | `companies/` | CRUD, contacts jsonb, notes, responsiveness (FR31-32); reverse-lookup of suggestions (FR33) |
| `account_members` | `sales` | Adds `role` enum incl. reserved `shadchan` (deny-only) |
| `suggestions_summary` view | `contacts_summary` / `companies_summary` pattern | Feeds board list + per-state dashboard counts (FR54) |

Fork the Deals Kanban's **structure** (react-admin `Resource` + drag-drop board + `*_summary`
view seam) but **not its schema/RLS as-is** — the fork's `using(true)` policies and
over-granted `anon` are exactly the anti-pattern AD-1/F6 correct.

---

## 5. Scope

### DELIVER (this build)
- Working, design-accurate 7-state board (Triage/Decision groups, correct tokens, card anatomy
  per §3) wired to real data via the `dataProvider` seam.
- Schema for `candidates`, `shadchanim`, `suggestions`, `resumes`, `reference_links`,
  `references`, `date_records` — all `account_id`-bearing, tenancy-ready (invariant 5).
- `createSuggestion()` and `transitionSuggestion()` as the single-owner functions (invariants
  1-2), enforcing the 7-state enum and transition graph.
- Manual "Add suggestion" flow (candidate + shadchan + identity fields → board), calling
  `createSuggestion()` directly per invariant 1's scoped interpretation.
- Migration (`supabase/schemas/` + generated migration under `supabase/migrations/`),
  `suggestions_summary` view, FakeRest mirror.
- Schema-level visibility columns (`owner_member_id`, `visibility`) present and populated by
  `createSuggestion()`, even though full RLS enforcement of them is deferred.

### DEFER-AND-FLAG (explicitly out of this build, flag for later epics)
- **Full Epic-1 RLS enforcement + member onboarding** — `FORCE RLS` policies, `anon` grant
  revocation, invite-flow account-binding (F7), CI RLS assertions (F6). Columns/shape must be
  ready for this (invariant 5); the policies themselves are not this build's job.
- **Dedupe *logic*/Epic-4** — `matchIdentity()`, `identity_signals` trigger, `normalize_identity()`
  Postgres function, confidence scoring, confirm/dismiss banner behavior. Only the **hook shape**
  (schema columns, card catch-chip slot) is delivered now (§1, §3); do not fabricate matching
  results.
- **Auto-parse / AI extraction** (FR55-58, §13 paid feature) — resume/photo → structured fields.
  Manual entry only in this build.
- **Channels / inbox** (`inbox_items`, email/SMS/WhatsApp capture, `fileInboxItem()`) — D2's
  correction (one true INSERT path via `fileInboxItem()`) is a **future-epic requirement**, not
  a same-sprint blocker: build `createSuggestion()` now as the internal primitive so that when
  inbox ships, `fileInboxItem()` wraps it rather than duplicating it. Flag this explicitly to
  whoever builds Epic-6 — do not let a second direct-INSERT path get built there.
- **Child portal** (`child_visible_suggestions()` as a live, callable SQL function; curated
  portal views) — the closed-enumeration *design decision* (invariant 6) must be locked now so
  schema doesn't need a breaking change later, but the function/portal UI itself is Epic-9.
- **Phase-2 shadchan role** — `origin='shadchan'` and `role='shadchan'` values must exist in the
  enums now (schema-ready), but stay deny-only / unused by any UI.

---

## 6. Gotchas

Corrections from the architecture review that a naive read of the spine/solution-design would
miss — do not re-introduce these:

1. **D2 — two doors into `suggestions`.** Don't let manual-add's `createSuggestion()` call and a
   future inbox-filing path both directly INSERT. Resolution adopted for this build: build
   `createSuggestion()` as the one true low-level INSERT primitive now; future `fileInboxItem()`
   must call it, never duplicate it (see §5).
2. **D1 — `identity_signals` needs one writer, not just one reader.** When dedupe logic is
   eventually built, it's a single trigger (`materialize_identity_signals()`) + single
   `normalize_identity()` function called by both the trigger and the `match/` Worker — never a
   private TS-side copy of the normalization rules. Deferred in this build, but don't scaffold a
   second normalizer as a placeholder.
3. **F1 — account-scoping on the matcher is a tested invariant, not a convention.** When
   `matchIdentity()` is built, every query against `identity_signals` must be proven to carry
   `account_id` (test cross-account non-match explicitly).
4. **D4 — no `decision_substate` column, ever.** One `pipeline_state` enum, one
   `transitionSuggestion()` writer, explicit transition graph as data (§1/§2.2).
5. **F3/D5 — visibility lives at the wrong grain if only on `suggestions`.** `reference_links`
   (`what_they_said`, `conversation_log`) and other child tables carry the most sensitive
   content and have no visibility column of their own — any future RLS on them must derive
   visibility by joining back to the parent suggestion via `child_visible_suggestions()`, never
   independently. Not enforced in this build (§5), but don't design the child tables in a way
   that makes this join impossible later.
6. **D5 — child-visibility must be a closed 7-state enumeration**, not an include-list plus an
   exclude-list with gaps (§2.6 pins the table now to avoid ambiguity later).
7. **F6 — `anon` default-privilege grant-all** is the fork's existing anti-pattern
   (`06_grants.sql`); every new table this build adds must not inherit it silently — confirm
   with SECURITY-REVIEWER (§7) even though full revocation is DEFERRED to Epic-1.
8. **Age/height are captured but never wired into matching** (FR11) — if any placeholder dedupe
   scoring is stubbed for the catch-chip UI, do not accidentally include these fields.
9. **FR14** — a suggestion belongs to exactly one `candidate_id`; never design a
   multi-candidate/shared suggestion row, even for "family" convenience.
10. **Fork lineage trap** — the Deals Kanban's own schema (`using(true)` RLS, `anon` over-grant)
    is a pattern to avoid replicating, not a template to copy wholesale (§4).

---

## 7. Validation + Security

- **App-scoped checks only** (per repo convention): `tsconfig.app.json`-scoped typecheck, `vite
  build`, and app-level tests (`make test` / vitest) covering the new `suggestions`,
  `candidates`, `shadchanim` components and the `createSuggestion()`/`transitionSuggestion()`
  logic — AAA structure, ≥80% coverage on new code paths (per `.claude/rules/testing.md`).
- **`npx supabase migration up --local`** must apply cleanly against the generated migration
  before this is considered done; verify `suggestions_summary` and the base tables via `npx
  supabase db diff --local` shows no drift after apply.
- **Dispatch SECURITY-REVIEWER** — this diff touches database queries/migrations and (columns
  for) RLS/tenancy by definition (`.claude/rules/security-triggers.md` triggers on "Database
  queries or migrations" and "Supabase RLS policies"). Even though full RLS *enforcement* is
  deferred (§5), the reviewer should confirm: every new table has `account_id` non-null, no
  `anon` grant is silently inherited (F6), and the schema shape does not foreclose the
  invariants in §2 (visibility columns present, enum values match exactly, no
  `decision_substate`).
