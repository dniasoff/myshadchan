# References as a First-Class Main Entity — Build Spec

Status: authoritative build spec for the next epic (post `39dbcb4`, "Shidduchim pipeline").
Consolidates: PRD (`prd-myshadchan-2026-07-21/prd.md`), Architecture Spine + Solution Design
(`architecture-myshadchan-2026-07-21`), current repo state (schema + frontend), and the design-canvas
gap analysis (`MyShadchan.dc.html`, `reference-board-after.html`, `mockup-generation-prompt.md`).

Do not edit `src/` or `supabase/` from this document — it is input to the implementing agent(s).
Schema files are being concurrently migrated by another agent in this session; treat them as read-only.

Entity naming (repo convention, see MEMORY): **shidduchim** = the matches/board cards (architecture
docs call these "suggestions"), **children** = the parent's kids, **shadchanim**, **references**.

---

## 0. Executive framing

The DB shape for `references`/`reference_links` shipped in the pipeline epic **on purpose thin** —
the table comment at `01_tables.sql:276-280` says outright: *"schema shape only in this epic; the
References UI and reference matching/merge logic are Epic-3/Epic-4."* That epic is this one.

Everything downstream of the schema is currently missing:
- No `references` `<Resource>` registered in `CRM.tsx` at all (confirmed: `grep -n "Resource name="`
  on `CRM.tsx` lists `shidduchim`, `children`, `shadchanim`, `deals`, `contacts`, … — no `references`).
- No `references/` component folder.
- No timeline/notes/tasks table scoped to a reference.
- No match-on-entry mechanism anywhere (front or back end) — the design canvas has copy promising it
  ("Reused across boys — if you've spoken to them before, we'll link the history",
  `MyShadchan.dc.html:749-757`) but no matching UI, no candidate list, no confidence indicator.
- No merge UI/RPC for references.
- References is not in primary nav in the shipped canvas (`navDef`, `MyShadchan.dc.html:1478`) —
  only reachable as a launcher tile or a `data-nav="reference"` deep-link from inside one shidduch.
- No reference exists independent of a shidduch context (`referencesFull()`,
  `MyShadchan.dc.html:1453-1471`, is hardcoded to 3 mock references for one candidate; `r.track`,
  a "you've spoken to him about 2 other boys" cross-shidduch string, is literally hardcoded per mock,
  not computed from `reference_links`).

What the design **did** get right and should be lifted, not redesigned: the call-status chip model,
the full-screen call-capture flow, the cross-reference summary card (consensus/contradiction/gap),
the AI chat assistant tab with its non-judging disclaimer, and the tailored-questions-by-relationship
panel. These need to be **re-parented onto a real first-class Reference entity** instead of a
per-shidduch mock array.

---

## 1. Data model delta

### 1.1 What already exists (read-only reference — do not re-migrate these tables' base shape)

`public."references"` (`01_tables.sql:284-294`) — reserved keyword, always double-quoted in SQL,
PostgREST resource name `references`:

```
id bigint identity PK
account_id bigint not null
created_at timestamptz not null default now()
name_en text
name_he text
relationship text
phone text
school text
grad_year integer
```

`public.reference_links` (`01_tables.sql:359-369`) — the join across shidduchim/resumes:

```
id bigint identity PK
account_id bigint not null
created_at timestamptz not null default now()
reference_id bigint not null   → references."id" on delete cascade
shidduchim_id bigint            → shidduchim.id on delete cascade
resume_id bigint                → resumes.id on delete cascade
call_status text
what_they_said text
conversation_log jsonb
```

Table comment (`01_tables.sql:355-358`) is a **hard architectural directive**: `reference_links` has
**no own visibility column** — any RLS on it (or on child tables of it) must derive visibility by
**joining back to the parent shidduch**, never independently. This is F3/AD-3.

Both tables already have: `set_account_id_default()` BEFORE INSERT trigger (`04_triggers.sql:107-117`,
AD-1 — server sets `account_id`, client never supplies it), flat account-scope RLS
(`05_policies.sql:118-136`, `account_id = current_account_id()` for `all to authenticated`), and
standard `anon` revoke / `authenticated,service_role` grants on table + `_id_seq`
(`06_grants.sql:206-220,260-274`). TypeScript types `Reference` / `ReferenceLink`
(`src/components/atomic-crm/types.ts:286-295`, `:420-429`) already mirror the columns 1:1 — reuse
them, do not redefine.

`shidduchim_summary` (`03_views.sql:174,179`) already exposes `nb_references` via
`left join reference_links rl on rl.shidduchim_id = s.id` — the only existing cross-entity signal.

**Repo-state correction to the architecture extract:** the AD-3-mandated single SQL
`SECURITY DEFINER` visibility function (referred to in the architecture docs as
`child_visible_suggestions()`) **does not exist yet** in this repo. Only a narrower pure function,
`is_child_visible_state(pipeline_state)` (`02_functions.sql:510`), exists — it tests a `pipeline_state`
enum value, it does not join tables or gate row visibility. There is also **no `child` role** at the
DB level: `account_members.role` check constraint (`01_tables.sql:242-243`) allows only
`parent_admin | helper | self_manager | shadchan` — no `child`/`candidate` role exists, and no
candidate-portal RLS is wired anywhere (`05_policies.sql` has no child-portal policies at all today).
**Conclusion: FR68 child-visibility is architecturally prospective, not yet reachable.** This epic
must build the data model so it is *ready* for join-to-parent child visibility (no independent
visibility column on any new table, mirroring `reference_links`) but does **not** need to build actual
child-login/candidate-portal UI or wire a live `child` role — that is a separate, not-yet-started
epic. Flag this explicitly to planner/reviewer so nobody invents a child role or a
`child_visible_suggestions()` call site that has no caller today.

Also **not built yet**, confirmed by `grep` on `02_functions.sql`/`01_tables.sql`: no
`identity_signals` table, no `matchIdentity()` function, no normalize trigger. `date_records`
(`01_tables.sql:373-384`) carries the same forward-looking comment ("present for a future
account-scoped `matchIdentity()`; no logic is built now") — i.e. **this epic is the first to actually
build `matchIdentity()`/the normalize trigger**, and per AD-5 it must be built as the *one*
account-scoped service other future callers (date-record dedupe, parse-time dedupe) will also use —
do not build a reference-only bespoke matcher.

### 1.2 What must be ADDED this epic

**(a) Columns on existing tables**

- `public."references"`: no new columns needed for the FR39 field list (name_en/he, relationship,
  phone, school, grad_year all present). Add **normalized match-key columns** feeding
  `matchIdentity()` (AD-5/AD-12 pattern — computed by the *one* `IMMUTABLE` normalize function via
  trigger, never client-supplied, never computed twice):
  - `name_norm_en text`, `name_norm_he text` (diacritic-stripped/transliteration/nickname-variant
    normalized, mirroring whatever `identity_signals` shape the normalize function already defines
    for `shidduchim`/`date_records` name matching — do not invent a second normalization scheme).
  - `phone_norm text` (digits-only, country-code-normalized).
  - These are **generated/trigger-set**, not user-editable, consistent with AD-1's "server sets
    `account_id`" precedent and AD-5's "the SPA never normalizes."
- `public.reference_links`: add a `relationship` override is **not** needed as a new column —
  `FR39`'s `relationship` already lives on `references` itself; per-link relationship variance (a
  reference is "the shul rabbi" for one girl and "the seminary teacher" for another because they wear
  different hats per family) is a real product nuance called out by the design canvas's *"header
  (name, phone, relationship-per-link since relationship can vary by shidduch)"* pattern (design-gap
  extract §4). Add: `reference_links.relationship_override text nullable` — if null, UI falls back to
  `references.relationship`.

**(b) New table: `public.interactions`** (timeline, polymorphic — extends the AD-13 `target_type`
pattern rather than inventing a second polymorphic scheme)

```
id bigint identity PK
account_id bigint not null
created_at timestamptz not null default now()
target_type text not null   -- 'shidduch' | 'reference'  (extend, do not fork, AD-13's enum idea)
target_id bigint not null
actor_member_id bigint      -- account_members.id, who logged it
kind text not null          -- 'note' | 'call_logged' | 'status_change' | 'merge' | 'link_created' | ...
body text
metadata jsonb
```
- `(account_id, target_id)` composite integrity per AD-1's polymorphic-table rule — same treatment
  as `tasks.target_type`/`target_id` (AD-13, Spine:113-116).
- `set_account_id_default()` trigger, RLS `account_id = current_account_id()` **as the floor**, plus
  — because `target_type = 'reference'` rows carry candid diligence content — a policy that ALSO
  derives visibility by walking `reference → reference_links → shidduchim.visibility` wherever the
  interaction concerns a specific shidduch-linked conversation (mirrors the `reference_links`
  no-own-visibility-column rule, §1.1). Interactions with no shidduch context (e.g. "updated phone
  number") only need the account-scope check.
- This single table replaces "notes" and "timeline" as one surface: a note is `kind = 'note'`; the
  timeline is `interactions` ordered by `created_at`. This matches FR41's ask ("conversation log
  across calls") and FR36's established notes+interaction-log pattern (mirror, don't fork).

**(c) `tasks` — extend, do not fork**

`tasks` today (`01_tables.sql:111-119`) is FK'd to `contact_id` only (`tasks_contact_id_fkey`,
`01_tables.sql:167`) and is a legacy contacts-scoped table. AD-13 (architecture) specifies a
**polymorphic** `tasks(account_id, due_at, target_type ∈ {shadchan, suggestion, reference}, target_id,
delivery_channels, done_at)` design — this does not exist yet either (only the legacy contact-scoped
`tasks` table is in the schema). This epic must build (or this epic is the first caller that forces
building) the polymorphic `tasks` shape with `target_type` including `'reference'` literally, per
FR44 ("shadchan, suggestion, OR reference"). Do not add a `reference_id` column to the legacy
contact-scoped table — extend/replace with the AD-13 polymorphic shape, consistent with how
`interactions` above is built. If the pipeline epic (shidduchim/shadchan reminders) has already
started this migration concurrently, this epic's reference-target reminders must land on that same
table/enum, not a parallel one — check with the concurrent migration agent before creating a second
`tasks`-like table.

**(d) `public.identity_signals` + `matchIdentity()` (AD-5)** — net new, this epic is the first to
build it (§1.1). Minimum shape to satisfy FR20/FR42:

```
identity_signals(
  account_id bigint not null,
  target_type text not null,   -- 'reference' | 'shidduch' | 'date_record' (extensible)
  target_id bigint not null,
  name_en_norm text, name_he_norm text,
  phone_norm text,
  parents_norm text, seminary_norm text, shul_norm text, location_norm text
)
```
computed by ONE `IMMUTABLE` Postgres normalize function, invoked by trigger on every write path that
produces a name/phone-bearing entity (`references` insert/update is one of the enumerated write
paths per the architecture doc — "parse, manual, `date_records`, **reference dedup**"). A
`matchIdentity(account_id, target_type, candidate_signals) returns table(target_id, confidence,
deciding_facts jsonb)` function serves shidduchim-suggestion dedupe, dating-history dedupe, AND
reference dedup (FR20) — **one function, three callers**, per AD-5's "ONE account-scoped service."
Signals = name(_en/_he) + parents + seminary/yeshiva + shul + location — explicitly **not**
age/height (AD-5). Account-scoped: every query carries `account_id`; never crosses accounts (this is
also the PRV-2 no-pooling enforcement point, not just a correctness nicety).

**(e) `references_summary` view** (AD-10 convention, mirrors `contacts_summary`/`companies_summary`
per AGENTS.md, and `shidduchim_summary`'s existing `nb_references` join pattern at
`03_views.sql:174,179`): aggregates, per reference, `linked_shidduchim_count`,
`last_conversation_at`, `open_task_count` — feeds the reference-book list (§5a) without N+1 fetches.
`security_invoker = on` (AD-1 — no definer views; the one named exception is AD-3's SECURITY DEFINER
*function*, not a view).

**Every new table**: `account_id not null`, `FORCE ROW LEVEL SECURITY` in the **same migration** that
creates the table (CI asserts this), `anon` revoked, `authenticated`/`service_role` granted, no
independent visibility column on any table hanging off a reference-on-a-shidduch context (candid
fields join-to-parent per AD-3/F3), files 200–400 lines typical/800 max.

---

## 2. Cross-shidduch linking

- One `references` row can have **many** `reference_links` rows, each pointing at a different
  `shidduchim_id` (and optionally `resume_id`) — this is already the shape of `reference_links`
  (§1.1); nothing schema-wise needs to change here, only the **frontend needs to actually query it**.
- **Repeat-recognition (FR42):** when a reference is opened (or matched at entry, §3), fetch every
  `reference_links` row for that `reference_id` across the account, join to `shidduchim` for each
  linked single's name/photo/state, and surface: "You've spoken to [Name] about N other singles" plus
  a list of those conversations with their `call_status`/`what_they_said`/`conversation_log` excerpt
  — this is a **real query**, not the hardcoded `r.track` string the design canvas shipped
  (`MyShadchan.dc.html:727`, flagged in the design-gap extract as the clearest evidence the feature
  "never got this working").
- Runs on **both** the reference's own detail page (§5b) and inline as a compact card wherever a
  reference is shown inside a shidduch's 360° view (FR38) — same underlying query, two renderings.
- Per-link `relationship_override` (§1.2a) means the label shown in each cross-shidduch row can differ
  ("Rabbi Cohen — shul rabbi" on one card, "Rabbi Cohen — family friend" on another) even though it's
  the same underlying reference identity.
- **Multi-child scope note (flag from design-gap extract):** PRD §11 (FR51-52) says the shared
  reference book spans **all children in the account**, not just shidduchim for one child — i.e.
  cross-shidduch here means literally every shidduch in the account regardless of which child it's
  for. Do not scope the repeat-recognition query to "this child's shidduchim only."
- **PRV-2 hard boundary:** this query is **strictly `account_id`-scoped**. Never surface a reference's
  history across accounts, even for a name/phone match that looks identical — that would be the
  no-pooling violation the whole architecture is built to prevent.

---

## 3. Match-on-entry (FR20, FR42 — core, free, never AI-gated)

Applies identically whether the reference arrives via manual entry (this epic) or the future
auto-parse extraction (Epic-5/FR19, out of scope here but the entity must accept both paths
uniformly — do not build a manual-only shape).

**Exact flow:**

1. **User types into the reference create form** (name + phone, minimum — relationship/school/
   grad_year optional at this stage).
2. **On blur / debounce**, the client calls a `matchOnEntry`-style dataProvider method (new,
   mirrors the `addRedt`/`addSchool`/`createShidduch` idiom at `dataProvider.ts:308-339` — typed
   input, calls a server RPC, throws on failure) which invokes `matchIdentity()` (§1.2d) — **the SPA
   never normalizes**, it just passes the raw typed strings, the server-side `IMMUTABLE` normalize
   function does the work.
3. Server returns **candidates + confidence + deciding facts** (e.g. "phone matches exactly" /
   "name matches, Hebrew variant") — never a bare boolean, never name-only (AD-5 hard rule: "never
   name-only, never auto-merge").
4. **UI presents candidates** using the design's own best-executed analog for this exact interaction
   shape — the Duplicate/Already-Dated Catch pattern (`mockup-generation-prompt.md` screen 14,
   honey/amber, "relief not error" tone): show the deciding facts, show confidence, offer exactly two
   calm choices:
   - **"Yes, this is [Name]"** → confirm → **link** the new mention to the existing `references` row
     (create a `reference_links` row against the existing `reference_id`, do **not** insert a new
     `references` row) → immediately show the repeat-recognition panel (§2) so the user sees why this
     mention matters.
   - **"No, different person"** → dismiss → proceed to create a brand-new `references` row as normal.
5. **User must act** — no silent/automatic merge under any circumstance, no auto-link above some
   confidence threshold without a click. This is AD-5's explicit invariant, restated for references
   specifically at FR20 ("a match links... rather than duplicating") and FR42.
6. If the create form is submitted with **no match found**, insert a fresh `references` row as
   normal — the normalize trigger still fires and populates `identity_signals`/`*_norm` columns so
   *future* entries can match against it.

**Never paywalled:** this entire flow — normalize, match, candidate surfacing, link/dismiss — runs
identically regardless of the account's AI-tier subscription state (FR20 §3.5 header note, FR42
"this recognition is free, not gated behind the paid AI tier"). Do not put this behind any
entitlement check. Contrast with §7's AI diligence assistant, which **is** gated.

**Bilingual matching (NFR-6):** the normalize function must be Hebrew/English variant-aware
(diacritic-strip + transliteration/nickname variants), not literal string match — this is the same
requirement AD-12 already states for the shared normalize function, so references get it "for free"
by using that one function rather than building a bespoke matcher.

---

## 4. Merge (duplicate references)

**No FR id exists for this** — confirmed absent from the PRD by both the PRD-constraints and
design-gap extracts. FR20 covers match-*at-creation* only, not post-hoc merge of two already-diverged
`references` rows (e.g. two different shidduchim both manually typed "Rina Gold, 054-xxx" as
references before match-on-entry existed, or before a phone number was known). Treat this as an
epic-scope necessity implied by "reusable, cross-shidduch" (FR39/FR42), not as covering an existing
FR — **flag it for the planner as a spec gap to mint an FR id for**, do not silently invent one here.

**Pattern to fork:** `src/components/atomic-crm/contacts/ContactMergeButton.tsx` (314 lines) +
edge function `supabase/functions/merge_contacts/index.ts` (194 lines). Read both directly before
building — they are the concrete, working template.

- **Client:** `ContactMergeButton.tsx:78-90` shows the "possible duplicate" suggestion query
  (`useGetList` filtered on matching fields) and `:92-121` shows counting related-record impact via
  `useGetManyReference` per related resource. For references, the equivalent counts to show before
  confirming a merge: linked `reference_links` count (→ N shidduchim), `interactions` count, open
  `tasks` count.
- **dataProvider:** add `mergeReferences(loserId, winnerId)` to `CrmDataProvider`
  (`dataProvider.ts:261-276` shows the exact `mergeContacts` idiom — `functions.invoke("merge_contacts",
  {method:"POST", body:{loserId, winnerId}})` — mirror this call shape exactly for
  `merge_references`).
- **Edge function `merge_references`:** mirror `merge_contacts/index.ts`'s reassign-then-delete
  pattern. What transfers (reassign FK from loser to winner, then delete loser row):
  - `reference_links.reference_id` (all of them — this is the core of "reusable across shidduchim,"
    a merge must never drop a shidduch's link to its reference)
  - `interactions` where `target_type='reference' and target_id = loserId`
  - `tasks` where `target_type='reference' and target_id = loserId`
  - `identity_signals` row for the loser (recompute/drop — winner's signals stand; do not leave an
    orphaned signals row pointing at a deleted target_id)
  - `conversation_log` jsonb on any surviving `reference_links` rows is preserved as-is (it lives on
    the link, not the reference, so reassigning `reference_id` carries it forward untouched — no
    merge/dedup of log entries needed at the field level).
- **What's destructive:** the loser `references` row itself is deleted (irreversible); if the loser
  and winner had **both** logged a `reference_links` row against the *same* `shidduchim_id` (i.e. two
  duplicate references both linked to the same single), that's a collision — the merge must not
  silently drop one side's `call_status`/`what_they_said`. Surface this as a conflict the user
  resolves explicitly (pick which link's call data wins, or keep both as separate interaction-log
  entries) rather than an edge function silently picking one. This is a real edge case
  `merge_contacts` likely doesn't have to handle (contacts aren't linked M:N to a shared parent the
  way references are to shidduchim) — do not blindly copy `merge_contacts`' collision handling
  without checking it against this case.
- **Confirmations:** name+phone/relationship diff shown side by side before commit (same pattern as
  `ContactMergeButton`'s field-comparison UI), explicit "this cannot be undone" language, requires an
  explicit confirm click — never auto-merge (consistent with AD-5's "never auto-merges" applying here
  too, even though this is post-hoc merge rather than match-on-entry).

---

## 5. UI

Ground truth for tokens: **the live app's committed `src/index.css`** (Calm Ledger, already shipped
per git log "Calm Ledger vibrant theme + Heebo"). `reference-board-after.html` and
`mockup-generation-prompt.md` §4.1 disagree with each other on radius/OKLCH values — use them only
for **layout/component idiom**, never for literal colors; confirm every color against `src/index.css`
before hand-coding anything. Cross-cutting rules apply throughout: body ≥15px, tap targets ≥44px
(≥48px primary), Inter+Heebo, full bilingual name fields, RTL-correct if this becomes a hero screen
(NFR-6, NFR-12).

**Nav fix (the #1 gap):** References must become a **persistent top-level sidebar item**
(`.nav-item` with icon + label + `.nav-count` badge), not a launcher tile or a deep-link buried
inside a shidduch tab. This is the single clearest, cheapest fix versus the shipped canvas — even
`reference-board-after.html`'s own nav (line 444-447) already puts References at the top level;
`MyShadchan.dc.html`'s live `navDef` (line 1478) just needs to be brought into line with its own
design system.

### (a) Reference book — LIST

Fork `contacts/ContactList.tsx` + `ContactListContent.tsx` + `ContactListFilter.tsx`
(`InfiniteListBase`/list-with-filter shell). Row: name (EN/HE), relationship, phone, school/grad-year,
and a "linked to N singles" count sourced from `references_summary.linked_shidduchim_count` (§1.2e)
— **not** a client-side aggregation. Filter by relationship type, by "has open task," by
account-wide search (name/phone, bilingual-aware).

### (b) Reference detail — true main entity

Fork the desktop/mobile split of `contacts/ContactShow.tsx` (`:238-302` desktop, `:57-236` mobile,
Tabs pattern) + `contacts/ContactAside.tsx`. Sections:

- **Header** — name (EN/HE), phone, school/grad-year. Relationship shown here is a fallback default;
  each linked-shidduch card below shows its own `relationship_override` if set (§1.2a).
- **Timeline** — `interactions` for `target_type='reference', target_id=this` ordered newest-first;
  same visual component family as the shidduch 360° view's interaction log (FR36 pattern, DRY).
- **Notes** — same `interactions` table, `kind='note'` entries, using whatever `NoteCreate`/
  `NotesIterator` shape is widened (see below) rather than a parallel component set.
- **Tasks/Reminders** — `ReferenceManyField`-style wiring against the new polymorphic `tasks`
  (§1.2c), `target_type='reference'`, reusing `TasksIterator`/`AddTask` (`ContactAside.tsx:56-68` is
  the exact wiring idiom to copy, swapping `target="contact_id"` for the polymorphic
  `target_type`/`target_id` pair).
- **Per-shidduch call log** — one card per linked `reference_links` row: `call_status` chip
  (Answered / No answer / Call back / They will call back — FR40), `what_they_said`, and the
  `conversation_log` entries for that link, plus the shidduch name/state it's linked to. This is
  where the design's already-good call-status chip model gets re-hosted (currently only exists inside
  the per-shidduch mock in `MyShadchan.dc.html`).
- **Repeat-recognition panel** — the §2 cross-shidduch query, rendered as "Also spoken to about: [N
  singles]" with per-single mini-cards (state, last contact date, call-status) — this is the page
  that plugs the design canvas's biggest hole (no reference `id` routable outside a shidduch context,
  per design-gap extract §3).
- **Merge action** — button in the same footer position as `ContactAside.tsx:70-83`'s
  merge+delete buttons, opens the forked `ReferenceMergeButton` (§4).
- **AI diligence assistant entry point** — a tab/panel, entitlement-gated (§7), see (d) below.

### (c) Per-call capture screen (mobile hero, used mid-phone-call)

Reuse the already-well-modeled `refFullOpen`/`callOpen` flow from `MyShadchan.dc.html:1216-1364`
almost as-is, just re-parented off a real `reference_links` id (via the reference's linked-shidduch
list, §5b) instead of a per-shidduch mock array. Design constraints (NFR-1): large tap targets,
minimal typing, 1–2-tap capture, **one-handed use** — call-status setter as big chip buttons, a
single "what they said" text field, "append to log" action. This is the mobile-hero screen; validate
against a real one-handed thumb-reach layout, not just desktop-shrunk.

### (d) AI diligence assistant panel (entitlement-gated, §7)

Also already well-modeled in the canvas and worth lifting near-verbatim, re-hosted on the real
entity:
- **Tailored questions by relationship** (`rfQuestions`, FR59) — driven by `references.relationship`
  (teacher vs neighbour vs friend template).
- **Guided call script with inline capture** (`callScript()`/`refCoaching()`,
  `MyShadchan.dc.html:1421-1451`, FR60) — inline capture must write into the same
  `call_status`/`what_they_said`/`conversation_log` fields the manual capture screen (§5c) uses; this
  is not a separate disconnected data path.
- **Cross-reference summary** (consensus / contradictions / **gaps** — FR61) — already modeled at
  both the shidduch-detail level (`MyShadchan.dc.html:354-358`) and the reference-workspace level
  (`:711-718`); keep both renderings, they aggregate the same per-shidduch reference set from two
  different entry points (shidduch 360° view vs. reference detail).
- **Research dossier** (FR62) — read/aggregate view only, resume + references + dates + links +
  notes; not a new source of truth.
- **FR63 guardrail, surfaced in tone, not just enforced server-side:** keep the "never judges
  compatibility, only organizes" disclaimer text near-verbatim (canvas line ~1296/1320) — the
  assistant must never appear to rank/score/recommend a match, and must never trigger any outward
  web-lookup of the reference as a person (PRV-6). Keep the "Paid" pill treatment on this panel only
  — never on the timeline/notes/tasks/call-log surfaces in (b)/(c), which are free.

### Component-reuse debt to resolve before (b)/(c) can be built

- `notes/NotesIterator.tsx:13` hardcodes `reference: "contacts" | "deals"` — widen this union (and
  `notes/foreignKeyMapping.ts`, and `notes/NoteCreateSheet.tsx:20,26,47,69,83` which is hardcoded to
  `contact_id`/`redirect("show", "contacts", ...)`) to accept references — or, if the polymorphic
  `interactions` table (§1.2b) supersedes the old per-entity notes shape, prefer building the
  reference notes UI directly against `interactions` and only widen `NotesIterator` if shidduchim
  notes are also being migrated onto `interactions` in this epic (check with the concurrent
  migration/other in-flight work before choosing).
- Resource registration: add `references/index.ts` exporting `{list, show, create, edit}` and mount
  `<Resource name="references" {...references} />` at **both** call sites in `CRM.tsx`
  (`:271-273` and `:340-342` — each layout/role branch registers resources separately; both must be
  updated, same pattern as `shidduchim`/`children`/`shadchanim`).
- **AD-10 FakeRest parity is mandatory, not optional:** every new resource/method (references list/
  show/create, `matchOnEntry`, `mergeReferences`, the polymorphic `interactions`/`tasks` reads/writes)
  must be mirrored in the FakeRest data provider (`providers/fakerest/`) for the demo build-time
  target to keep working. Do not ship a Supabase-only implementation.

---

## 6. Child visibility

Per §1.1's repo-state correction: **no child role, no candidate portal, no `child_visible_suggestions()`
function exist yet** — so there is currently no live surface where "what the child sees" is even
reachable. This epic should not attempt to build the candidate-portal UI. What it must do:

- **Design the data model so it is already correct when that portal is built**, per AD-3/F3: no
  independent visibility column on `reference_links`, `interactions` (reference-targeted rows), or
  `tasks` (reference-targeted rows) — visibility must always be derivable by joining back to the
  parent `shidduchim.visibility`, never stored redundantly. This is already how `reference_links`
  was built (§1.1) — the new `interactions`/`tasks` rows must follow the identical pattern.
- **Never build** a policy or view that lets a `reference_links`/`interactions`/`tasks` row be read
  independent of its parent shidduch's visibility state — even though there's no child role to test
  it against yet, get the shape right now so the future SECURITY DEFINER function (when built) only
  has to be *extended* to these tables via join-to-parent RLS, not retrofitted.
- **What the eventual child view MAY show** (FR68, for the future portal epic, documented here so
  this epic's schema doesn't foreclose it): a coarse progress signal only — e.g. "N of M references
  contacted" — never call-status detail per reference, never `what_they_said`, never the conversation
  log, never reference identity/contact details, never AI-generated dossier/summary content (FR61/
  FR62 outputs). This is why `interactions`/`tasks` targeting a reference must carry enough
  structure (a `kind`/count) to compute a coarse aggregate without exposing row content — do not
  design a shape where the only way to compute "N of M contacted" is to read the candid rows
  themselves through some future relaxed policy.
- Helper role (`account_members.role = 'helper'`): PRD does not spell out helper's reference-view
  rights explicitly (design-gap extract flags this gap). Default helper to the **same restricted
  view as would apply to a child** for candid reference content unless a family's RBAC config
  explicitly grants more — least-exposure by default (PRV-4's general posture). Since no child role
  exists yet either, this is also prospective — just don't build a policy that implicitly grants
  helper unrestricted candid access by omission.

---

## 7. Scope — deliver now vs defer-and-flag

**DELIVER this epic:**
- Full `references` entity surface: list (book), detail (header, timeline, notes, tasks/reminders,
  per-shidduch call-log, repeat-recognition panel, merge action) — all FREE, no entitlement check.
- Match-on-entry (§3): normalize function + `matchIdentity()` (§1.2d, the AD-5 shared service) +
  confirm/dismiss UI — FREE.
- Merge (§4) — FREE (it's account-management hygiene, not an AI feature).
- Cross-shidduch linking/repeat-recognition (§2) — FREE (FR42 explicit).
- Reference follow-up reminders/tasks (FR43-46) targeting a reference via the polymorphic `tasks`
  shape — FREE, delivered in-app + email(primary) + push, **no SMS**.
- `references_summary` view, `interactions`/polymorphic-`tasks` schema, RLS, FakeRest mirrors.
- The reference-on-a-shidduch mini-card embedded in the shidduch 360° view (FR38) — reads from the
  same `reference_links`/`interactions` data the standalone entity uses.
- AI diligence assistant **UI scaffolding + data plumbing** (tailored questions, guided script with
  inline capture writing into the real call-log fields, cross-reference summary, dossier) —
  **entitlement-gated** behind the billing epic's paid-AI-tier check, consistent with FR59-63's
  framing. Build it now (the design is already well-modeled and shouldn't be redesigned twice), but
  every AI-generated output path must go through the entitlement gate and, per AD-8 (architecture),
  through the Cloudflare AI Gateway only — never a direct-to-provider call.

**DEFER-AND-FLAG (explicitly out of scope, name the epic it belongs to):**
- **Auto-parse reference extraction** (FR19/FR21 — OCR/LLM pulls a reference off a resume PDF and
  creates the `references` row automatically) — **Epic-5**, per PRD §19 sequencing. This epic only
  needs the entity to *accept* that hook uniformly with manual entry (same `matchOnEntry` call path,
  same table) — do not build the parser.
- **Candidate/child-login portal** and any live `child_visible_suggestions()`-equivalent function —
  not started anywhere in the repo yet (§1.1, §6); this epic prepares the schema (join-to-parent, no
  independent visibility columns) but does not build the portal.
- **Merge FR id** — no PRD FR/AD id exists for post-hoc reference merge (§4); implement per this
  spec's forked-from-`ContactMergeButton` design, but flag to product/planning that an FR id should
  be minted retroactively (do not silently invent one in code comments as if it already existed).
- **AI Gateway wiring specifics** (model selection, caching, tracing) beyond "must go through AD-8's
  Gateway-only path" — detailed AI-subsystem plumbing is the general AD-8 concern, not
  reference-specific; coordinate with whatever epic owns the AI Gateway integration itself if it
  hasn't landed yet.
- **Billing/entitlement check implementation itself** (Epic-12) — this epic only needs to call
  whatever entitlement-check seam Epic-12 defines to gate the AI assistant panel; do not build a
  bespoke gate.

---

## 8. Validation + security

- **Migration workflow:** declarative-schema only — edit `supabase/schemas/*.sql`, then
  `npx supabase db diff --local -f <name>` to generate the migration, `npx supabase migration up
  --local` to apply, function definitions via `pg_dump` format if `02_functions.sql` changes (per
  AGENTS.md). **Do not hand-write migration files.** Another agent is concurrently applying
  migrations in this session — coordinate/rebase rather than assume a clean base state when this
  epic's migration is actually generated.
- **SECURITY-REVIEWER is mandatory** on this epic's diff per `.claude/rules/security-triggers.md` —
  it touches: database queries/migrations (new tables, RLS), Supabase RLS policies (new
  `interactions`/`tasks`/`identity_signals` policies, extended `reference_links` usage), user input
  handling (match-on-entry form, call-capture form), and external API calls (AI Gateway calls for
  §5d/§7). Do not skip the dispatch.
- **RLS test suite per new table**, including explicit cross-account attempts (AD-1's stated CI
  posture) — `interactions`, the polymorphic `tasks`, `identity_signals`, and any view built on top.
  Assert `rowsecurity = true` and that RLS was added in the **same migration** that created each
  table.
- **`matchIdentity()`/normalize trigger correctness tests:** account-scoping (never matches across
  accounts — this is also the PRV-2 enforcement point), Hebrew/English variant matching (NFR-6),
  never-auto-merge (confidence returned, no row ever silently linked without a UI confirm click).
- **Merge edge function tests:** the "both duplicates linked to the same shidduch" collision case
  (§4) must have explicit test coverage — this is the one place `merge_contacts`' pattern doesn't
  transfer cleanly and needs new logic, so it needs new tests, not copied ones.
- **≥80% coverage on new code paths** (repo-wide rule), AAA test structure, files 200-400 lines
  typical/800 max — grow file count, not file size, for the reference resource folder (list/show/
  create/edit/merge/aside as separate files, mirroring the `contacts/` folder's own decomposition).
- **App-scoped validation:** all user input (call-capture text, match-on-entry candidate confirm,
  merge confirm) validated client + server side, fail-fast with clear messages, never trust raw
  PostgREST responses as pre-validated.
- **Candid-data visibility check specifically:** SECURITY-REVIEWER must confirm no new view, RPC, or
  RLS policy allows reading `call_status`/`what_they_said`/`conversation_log` (or the new
  `interactions`/`tasks` content targeting a reference) independent of the parent shidduch's
  visibility state — this is the single highest-value check given PRV-1's "top-tier sensitive data"
  classification of reference candid content.

---

## Appendix — file:line citation index (for the implementing agent)

| Fact | Citation |
|---|---|
| `references` table shape + "schema shape only" comment | `supabase/schemas/01_tables.sql:276-294` |
| `reference_links` table shape + no-own-visibility comment | `supabase/schemas/01_tables.sql:355-369` |
| Account-id triggers on both tables | `supabase/schemas/04_triggers.sql:107-117` |
| Flat account-scope RLS on both tables (needs extending) | `supabase/schemas/05_policies.sql:86,89,118-136` |
| Grants (anon revoke / authenticated+service_role) | `supabase/schemas/06_grants.sql:206-220,260-274` |
| `nb_references` count join (only existing cross-entity signal) | `supabase/schemas/03_views.sql:174,179` |
| Legacy `tasks` table, contact-scoped only | `supabase/schemas/01_tables.sql:111-119,167` |
| `is_child_visible_state()` — the only child-visibility function that exists (narrower than AD-3's spec) | `supabase/schemas/02_functions.sql:510` |
| `account_members.role` check — no `child` role exists | `supabase/schemas/01_tables.sql:239-243` |
| `date_records` — same "future matchIdentity()" deferred comment | `supabase/schemas/01_tables.sql:371-384` |
| `Reference`/`ReferenceLink` TS types (reuse, don't redefine) | `src/components/atomic-crm/types.ts:286-295,420-429` |
| No `references` Resource registered | `src/components/atomic-crm/root/CRM.tsx` (grep confirms absent; `shidduchim`/`children`/`shadchanim` registered at `:271-273,340-342`) |
| `ContactList`/`ContactListContent`/`ContactListFilter` — fork for reference book list | `src/components/atomic-crm/contacts/` |
| `ContactShow.tsx` desktop/mobile split — fork for reference detail | `src/components/atomic-crm/contacts/ContactShow.tsx:238-302` (desktop), `:57-236` (mobile) |
| `ContactAside.tsx` — tasks wiring idiom, merge+delete button footer | `src/components/atomic-crm/contacts/ContactAside.tsx:56-68` (tasks), `:70-83` (footer) |
| `NotesIterator` hardcoded `"contacts" \| "deals"` union — must widen | `src/components/atomic-crm/notes/NotesIterator.tsx:10,13` |
| `NoteCreateSheet` hardcoded `contact_id`/`"contacts"` redirect | `src/components/atomic-crm/notes/NoteCreateSheet.tsx:20,26,47,69,83` |
| `ContactMergeButton` — fork for reference merge | `src/components/atomic-crm/contacts/ContactMergeButton.tsx:78-90` (match suggestion), `:92-121` (related-record counts) |
| `merge_contacts` edge function — fork for `merge_references` | `supabase/functions/merge_contacts/index.ts` (194 lines, read in full before building) |
| `mergeContacts`/`addRedt`/`addSchool`/`createShidduch` dataProvider idiom | `src/components/atomic-crm/providers/supabase/dataProvider.ts:261-276,308-339` |
| `ShidduchShow.tsx` — no references/notes/tasks/timeline section wired yet | `src/components/atomic-crm/shidduchim/ShidduchShow.tsx:139-292` |
| Design canvas: nav omits References at top level | `design-artifacts/MyShadchan.dc.html:1478` (`navDef`) |
| Design canvas: `referencesFull()` mock, hardcoded per-shidduch | `design-artifacts/MyShadchan.dc.html:1453-1471` |
| Design canvas: hardcoded `r.track` cross-shidduch string (not real data) | `design-artifacts/MyShadchan.dc.html:727` |
| Design canvas: match-on-entry copy-only promise, no mechanism | `design-artifacts/MyShadchan.dc.html:749-757` |
| Design canvas: call-capture flow to reuse | `design-artifacts/MyShadchan.dc.html:1216-1364` |
| Design canvas: AI assistant tab + questions + coaching + guardrail text | `design-artifacts/MyShadchan.dc.html:1282-1297` (chat tab), `:1421-1451` (script/coaching), `:1296`/`:1320` (disclaimer) |
| Design canvas: cross-reference summary card, two locations | `design-artifacts/MyShadchan.dc.html:354-358` (shidduch-detail), `:711-718` (reference workspace) |
| `reference-board-after.html` top-level nav (disagrees w/ canvas, agrees w/ this spec) | `design-artifacts/reference-board-after.html:444-447` |
| Duplicate/Already-Dated Catch — pattern to reuse for match-on-entry UI | `design-artifacts/mockup-generation-prompt.md` screen 14, line 366-373 |
| PRD: FR39-43 (§8 Reference System) | `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md:343-365` |
| PRD: FR19-21, FR20 dedup (§3.5) | same file, lines 205-219 |
| PRD: FR44-46 reminders (§9) | same file, lines 357-365 |
| PRD: FR59-63 AI research assistant (§14) | same file, lines 401-415 |
| PRD: PRV-1/PRV-2/PRV-3/PRV-4/PRV-6 | same file, lines 229-252 |
| PRD: FR68 candidate sees "diligence is happening," not content | same file, lines 431-432 |
| PRD: FR51-52 shared reference book spans all children (§11) | same file, lines 374-379 |
| PRD: Epic sequencing (Epic-3 core, Epic-5 auto-parse, Epic-10 AI, Epic-12 billing) | same file, lines 537-573 |
| Architecture: AD-5 identity matching (matchIdentity, one normalizer) | `ARCHITECTURE-SPINE.md:73-76,108-111`; `SOLUTION-DESIGN.md:161-163` |
| Architecture: AD-13 polymorphic tasks | `ARCHITECTURE-SPINE.md:113-116`; `SOLUTION-DESIGN.md:114,196` |
| Architecture: AD-3 visibility / child_visible_suggestions() (not yet built — see repo-state correction) | `ARCHITECTURE-SPINE.md:63-66`; `SOLUTION-DESIGN.md:113,123` |
| Architecture: AD-1 tenant isolation baseline | `ARCHITECTURE-SPINE.md:53-56` |
| Architecture: AD-10 dataProvider seam / FakeRest parity | `ARCHITECTURE-SPINE.md:98-101`; `SOLUTION-DESIGN.md:187` |
| Architecture: AD-12 bilingual data invariant | `ARCHITECTURE-SPINE.md:108-111` |
| Architecture: `references`/`reference_links` data model note | `SOLUTION-DESIGN.md:92,98-100,106-114` |
