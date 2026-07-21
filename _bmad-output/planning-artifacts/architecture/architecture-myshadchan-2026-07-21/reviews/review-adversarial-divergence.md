---
title: Adversarial Divergence Review — MyShadchan v1 Architecture Spine
type: architecture-review
lens: adversarial-divergence
target: ARCHITECTURE-SPINE.md
companions:
  - SOLUTION-DESIGN.md
  - ../../prds/prd-myshadchan-2026-07-21/prd.md
reviewer: adversarial-architecture-reviewer
status: draft
created: '2026-07-21'
---

# Adversarial Divergence Review — MyShadchan v1

## Method (the configured lens, verbatim)

> Attack the spine as an adversary: construct two units one level down that each obey
> every AD to the letter yet still build incompatibly — clashing shared-data shapes,
> two owners of one entity, conflicting state-mutation paths. Every pair you find is a
> hole to close with a new or tightened AD.

For each finding below I name **two units** (an epic, resource, or Worker), show a build for
each that **satisfies every AD as written**, then show the **exact incompatibility** that
survives that compliance. Each finding ends with the **new or tightened AD** that removes the
degree of freedom the two builders exploited.

The test I applied to keep this honest: *if I can point to the AD sentence each builder is
obeying, and the collision still happens, the spine has a hole.* Findings where the collision
requires a builder to violate an AD are **excluded** (the spine already closes those).

## Verdict

The spine's **13-of-14 ADs are individually sound**, but the spine is under-specified at exactly
the seams the ADs were written to protect: it names *single* services (`matchIdentity()`, "one
policy module," "one filing gate") without naming their **sole owner, sole writer, or sole
runtime**, and it defines several invariants as **prose properties** rather than **write-time
constraints**. Independent builders can therefore each cite the governing AD and still ship two
incompatible units. Nine such collisions are constructed below; five are `critical`/`high` and
threaten the product's headline value (UJ-1 dedup), its central object (`suggestion`), and its
tenant-isolation boundary.

## Findings summary

| # | Seam | Two units | Class |
|---|------|-----------|-------|
| D1 | identity_signals writers + normalizer | parse/ (E5) vs manual-add (E2) vs date_records (E4) | **critical** |
| D2 | suggestion creation | manual-add (E2) vs inbox-filing (E6) | **critical** |
| D3 | service-role account scope | JWT-Worker (E4/E10) vs ingest/ (E6) vs share/ (E8) | **high** |
| D4 | suggestion state machine | triage board (E2) vs inbox-filing (E6) vs stats/portal readers | **high** |
| D5 | child-visibility predicate | triage-board RLS (E2) vs candidate-portal view (E9) | **high** |
| D6 | reference identity match | reference book (E3) vs parse auto-link (E5) | **high** |
| D7 | R2 object access + key schema | resume owner-view (E3) vs share/ (E8) | **high** |
| D8 | reminder delivery floor | reminder-create UI (E7) vs cron/ dispatcher (E7) | **medium** |
| D9 | polymorphic target + interaction visibility | interactions (E6/FR9) vs tasks (E7) vs portal (E9) | **medium** |

---

## D1 — `identity_signals` has one *reader* but three *writers*, and the normalizer straddles two runtimes `[critical]`

**Two units.** `parse/` Worker (E5) and the manual-add path (E2); `date_records` write (E4) is a
third instance of the same defect.

**Each obeys every AD.**
- AD-5 pins the singular things it names: *"one `matchIdentity()` entry point called by capture,
  filing, and history"* and *"Hebrew↔English normalization lives in exactly one module."* Both
  builders call the same `matchIdentity()` and import the same normalizer — **fully compliant**.
- AD-12 says *"Normalization for search/matching is applied consistently **at write**."* The E2
  builder normalizes in the manual-add submit path (which, per **AD-10**, is a `dataProvider` →
  Supabase **PostgREST** write — SPA/DB runtime, no Worker). The E5 builder normalizes in the
  `parse/`/`match/` **Worker** (per AD-5's `[ASSUMPTION]` "match runs in the match/ Worker").
  Both can cite "normalize at write" — **compliant**.

**The incompatibility (two owners of one derived entity + a split-runtime normalizer).**
AD-5 governs the **read/compare** path and the **module**, but never names the **sole writer of
the materialized `identity_signals` rows** (SOLUTION-DESIGN §4: *"materialized per
suggestion/date_record"*). So three code paths materialize it:
1. **Which signals are populated diverges.** A manual quick-add (E2) can capture name+location and
   leave parents/seminary/Shul blank; `parse/` (E5) fills all five. The **same person** added
   manually vs. parsed then carries **different signal vectors**, so `matchIdentity()` scores them
   as a weak match and the dedup **silently fails** — the exact UJ-1 "have I seen him before?"
   value, defeated. AD-5 forbids *name-only matching* but places **no completeness/uniformity
   constraint on the stored signal set** across writers.
2. **The normalizer cannot be one module in two runtimes.** AD-5 puts it in the Worker; AD-12 puts
   it "at write," which for E2 is the PostgREST path — **not** a Worker. Either (a) the SPA
   re-implements normalization client-side (two modules → the Hebrew "שרה" typed by hand and the
   "שרה" parsed from a PDF normalize under **different rules**, and a single transliteration-rule
   difference breaks the match — **risk R3 realized**), or (b) normalization is pushed to a DB
   trigger/function, which then **contradicts AD-5's "in the match/ Worker."** The spine does not
   say which, so two builders pick differently.
3. **Timing skew.** If manual-add writes `suggestions` via PostgREST (AD-10) but `identity_signals`
   is materialized by a Worker/queue (AD-7), the suggestion exists with **no signal row** until an
   async step runs — yet FR10/UJ-1 require the dedup check to feel **instant on add**. The
   synchronous filing check misses the just-written row.

**New/tightened AD (close it).**
> **AD-5 (tightened) + new invariant.** `identity_signals` has **exactly one writer**: a Postgres
> trigger `materialize_identity_signals()` fired on INSERT/UPDATE of `suggestions` and
> `date_records`. The signal row is a **pure function of the source row** — it cannot depend on
> which epic/runtime created the source. **The normalizer is a single Postgres `IMMUTABLE`
> function** (`normalize_identity(text, script)`), called by that trigger and by any search query;
> the `match/` Worker calls **the same DB function** (not a private TS copy) so SPA-origin and
> Worker-origin writes normalize **byte-identically**. Direct INSERTs to `identity_signals` are
> forbidden. This simultaneously fixes the split-runtime clash (one function, one runtime = the DB)
> and the completeness clash (signals are always derived, never hand-partial).

---

## D2 — Two doors into the central object: manual-add (E2) and inbox-filing (E6) are two suggestion-creation paths on one state machine `[critical]`

**Two units.** Manual-add (E2, `suggestions` resource) and inbox-filing (E6, `inbox/` + `ingest/`).

**Each obeys every AD.**
- AD-6 says *"every inbound (email/SMS/WhatsApp-share/**manual**) creates an `inbox_item`
  (unfiled) — the sole staging entry … a human review/confirm is always required before a
  suggestion exists."* The E6 builder routes manual through `inbox_item` — **compliant**.
- But **AD-4** ("`suggestion` is the central object … `origin ∈ channel|manual|shadchan`") and
  **AD-10** ("frontend reaches data only through the `dataProvider`; new CRUD extends the two
  seams") describe manual-add as a **direct `suggestions` create with `origin='manual'`**. Crucially,
  **E2 builds in epic 2 — five epics before the Inbox (E6) exists** (§18, SOLUTION-DESIGN §12). At
  E2 build time there is **no `inbox_item` table and no `ingest/` Worker**, so the only AD-compliant
  build is a `dataProvider` create straight into `suggestions`. The E2 builder is **fully compliant
  with AD-4/AD-10** and *cannot* comply with AD-6 (its staging row doesn't exist yet).

**The incompatibility (two code paths, one state machine).**
The system ends with **two ways to mint a `suggestion`**: E2's direct-to-`suggestions` form and
E6's `inbox_item → file` gate. They diverge on invariants that other epics silently depend on:
- **Dedup is skipped on the manual path.** AD-6's pipeline runs parse→`matchIdentity()`→confirm
  **before** the suggestion exists. E2's direct create runs **after** (or never) — FR10 says dedup
  happens *"on capture/filing,"* but nothing forces the E2 form through `match/`. A **manually
  entered duplicate is never caught**, while the identical person filed from the Inbox is. Same
  product, two dedup guarantees.
- **Provenance breaks.** E6 suggestions carry `inbox_items.resulting_suggestion_id` linkage and a
  `source_channel`; E2 suggestions have `origin='manual'` but **no staging row**. Any view that
  assumes "every suggestion traces to an `inbox_item`" (audit, FR5/FR18 source display,
  reconciliation, the Inbox→board funnel metric in §17) is wrong for every E2 row.
- **Invariant-column defaults diverge.** AD-4 says a suggestion carries `visibility` +
  `owner_member_id` (AD-3). The two creators set these **independently**: if E2 defaults
  `visibility='shared'` and E6 defaults `'private_parent'`, then whether the **child sees a
  suggestion depends purely on which door created it** — feeding directly into D5's dignity-floor
  divergence.

**New/tightened AD (close it).**
> **AD-6 (tightened) — one filing gate, promoted to a foundation primitive.** There is **exactly
> one function that INSERTs a `suggestion`**: `fileInboxItem(inbox_item_id)`. Manual Add creates a
> pre-filled `inbox_item` (`source_channel='manual'`) and flows through the **same**
> match→confirm→file gate; **no other code path may INSERT into `suggestions`** (enforce with a DB
> rule/`SECURITY DEFINER` function + revoked direct INSERT). The filing gate is the **sole setter**
> of `pipeline_state`, `visibility`, `owner_member_id`, and `origin`. **Epic-sequencing correction:**
> the `inbox_item` + `fileInboxItem()` primitive is **E1/E2 foundation**, not an E6 feature — the
> rich Inbox *UI* lands in E6, but the staging row and the single creation path must exist before
> E2's manual add is built, or E2 will hard-wire a second door that E6 can never close.

---

## D3 — "Re-assert account scope" (AD-7) is satisfied by three trust roots of unequal strength, with no shared helper `[high]`

**Two units.** A JWT-invoked Worker (`match/` E4 or `ai/` E10) and the `ingest/` Worker (E6);
`share/` (E8) is a third instance.

**Each obeys every AD.**
AD-7: *"A Worker using the Supabase service role **MUST re-assert the account scope in every
query**."* Every builder adds `WHERE account_id = <x>` to every query — **all compliant**. AD-7 does
**not** say **how the Worker obtains the trusted `<x>`**, nor mandate a shared helper.

**The incompatibility (equal AD-compliance, unequal trust).**
Three Workers derive `<x>` from **three different trust roots**:
- `match/`/`ai/` — from a **verified Supabase JWT** → `account_members` (cryptographically bound to
  an authenticated member). **Strong.**
- `share/` (E8) — from a **`share_links.token`** presented by an external recipient with **no JWT**
  (AD-9's recipients are outsiders). **Bearer-secret strength.**
- `ingest/` (E6) — from a **channel-address lookup**: the inbound email address or an
  `account_phones` match on the **SMS sender** — an identifier the sender **controls and can spoof**
  (PRV-7 exists *because* senders lie). **Weakest.**

AD-7 blesses all three equally: each has an `account_id` predicate. But the predicate's **value**
is only as trustworthy as its root. A builder who copies the `ingest/` "re-assert" pattern into a
future state-changing endpoint (e.g. an "SMS-reply-to-file" shortcut) would let anyone **spoofing a
verified phone number** write into that account — a cross-account write that **AD-1's RLS would have
blocked, but AD-7 deliberately turned RLS off here** and offered only "re-assert" as the
replacement. Note SOLUTION-DESIGN §5's mitigation ("lint rule + tests for a *missing* predicate")
**does not catch this**: the predicate is *present*; the **value is untrusted**. And AD-6's
"unrecognised sender → unattributed queue" safety only covers *unrecognised* senders — a **spoofed
*recognised* sender** is attributed and mis-files the `inbox_item` into a real account (the AD-6
mis-routing harm), because AD-6 and AD-7 never cross-reference each other's threat model.

**New/tightened AD (close it).**
> **AD-7 (tightened).** Define and **rank the account-scope trust roots**, and gate write surface by
> level via a single mandatory helper `assertAccountScope(request): { accountId, trustLevel }`:
> **(a) verified Supabase JWT** — default for SPA-invoked Workers; may write any account row it is a
> member of. **(b) signed share token** — **read-only**, single-`resume_id` scope, never writes.
> **(c) channel-address lookup** — `ingest/` **only**, and may write **at most an unfiled
> `inbox_item`** (never a `suggestion`, never a decision-state row, never another account's row);
> because the root is spoofable, a *recognised* channel sender is still treated as
> **needs-confirm**, not high-confidence auto-attribution. Cross-reference AD-6: the "never
> mis-routed" invariant covers spoofed-*recognised* senders too.

---

## D4 — The suggestion state machine has no single owner, and `pipeline_state` vs `decision_substate` are two representations of one decision `[high]`

**Two units.** Triage board (E2, drag-drop FR17) and inbox-filing (E6); the readers
(per-shadchan stats FR34, dashboard FR54 in E11, and the child portal E9) are downstream victims.

**Each obeys every AD.**
AD-4 enumerates 7 states, says *"Exactly one state at a time,"* and preserves gut `for_sure_not` ≠
post-investigation `no`. FR15 says Decision states are reached *"from Look-into."* Both builders
respect "one state at a time" — **compliant**.

**The incompatibility (conflicting state-mutation paths + double representation).**
1. **The legal transition graph is nowhere pinned as an enforced invariant.** E2's drag-drop can
   move `new → yes` directly (drag from the New column to a Yes column); E6's filing can drop a
   suggestion **straight into `for_sure_not`** (UJ-1 step 5: *"or straight to For-sure-not"*),
   bypassing `new`. FR15's *"from Look-into"* is a **prose hint**, not a guard. Two builders draw
   **two different legal graphs**, and no single component owns the transition, so an "impossible"
   state path in one epic's mental model is reachable via the other's UI.
2. **`pipeline_state` and `decision_substate` overlap.** AD-4 lists **both** as columns yet defines
   `yes/unsure/no` as **`pipeline_state`** values — leaving `decision_substate` **undefined**. One
   builder stores the decision as `pipeline_state='yes'` (substate null); another stores
   `pipeline_state='look_into', decision_substate='yes'`. Now **"which suggestions are a Yes?"
   returns different rows** depending on which column you filter — and the **child-visibility
   predicate (D5)**, the **dashboard counts (FR54)**, and the **per-shadchan "# progressed / # led
   to dates" (FR34)** each read a **different column**. One ambiguous column pair seeds a
   cross-cutting divergence across four features.

**New/tightened AD (close it).**
> **New AD-15 — Suggestion lifecycle authority.** The suggestion lifecycle is **one enforced
> transition function** `transitionSuggestion(id, from, to)` (a `SECURITY DEFINER` DB function or a
> trigger) that is the **sole writer of `pipeline_state`**; every mutator (E2 board, E6 filing, any
> Worker) calls it. Define the **legal transition graph explicitly** as data — including whether
> filing may jump straight to `for_sure_not` (yes) and whether Decision states require passing
> through `look_into` (yes, per FR15). **Collapse the double representation:** make the decision a
> value of `pipeline_state` and **delete `decision_substate`** (or invert it and delete the Decision
> values from `pipeline_state`) — pick one canonical column and forbid the other, so every reader
> filters the same field.

---

## D5 — Child-visibility: the inclusion set (an `[ASSUMPTION]`) is not the complement of the exclusion set, and the "single module" spans two runtimes with no named owner `[high]`

**Two units.** Triage-board RLS predicate (E2) and the candidate-portal curated view (E9).

**Each obeys every AD.**
AD-3 mandates *"a **single** policy module derives 'what a child may see' … and enforces it in RLS +
curated views."* SOLUTION-DESIGN §5: *"enforced twice — in RLS predicates **and** in curated
views."* Each builder writes a predicate that (they believe) implements AD-3 — **compliant**.

**The incompatibility (two non-equivalent specs of one predicate + a cross-runtime split).**
1. **Inclusion ≠ complement of exclusion.** AD-3 gives an **inclusion** definition —
   `[ASSUMPTION]` pursued = `{look_into, yes, unsure}` — **and** an **exclusion** definition — "never
   `for_sure_not`/gut-rejects, never `private_parent`." Over AD-4's 7 states
   `{new, look_into, not_sure, for_sure_not, yes, unsure, no}`, these are **not complements**:
   `new`, `not_sure`, and `no` are in **neither** list. The E2 builder who implements the RLS
   predicate as *"exclude `for_sure_not` + `private_parent`"* (the normative sentence) **exposes**
   `new`, `not_sure`, `no` to the child; the E9 builder who implements the view as *"include only
   `{look_into, yes, unsure}`"* (the assumption) **hides** them. Same AD, opposite results — and the
   exposed cases are precisely the dignity harm AD-3 exists to prevent: a child seeing a suggestion
   the parent **hasn't triaged yet** (`new`), is **leaning against** (`not_sure`), or **rejected
   after investigation** (`no`) — the "felt surveilled" counter-metric (§17), realized through the
   states the exclusion list forgot.
2. **"Single module" cannot literally span RLS (SQL) + curated views (SQL objects) + any TS gate.**
   AD-3 requires enforcement in **both** RLS `USING` clauses and curated views — necessarily
   **duplicated logic across SQL objects** (and possibly a TS portal guard). AD-3 names **no sole
   authority** and **no conformance test** proving the two agree, so E2's RLS predicate and E9's
   view definition drift the moment either is edited.

**New/tightened AD (close it).**
> **AD-3 (tightened).** Replace the assumption + exclusion prose with a **single closed enumeration
> over all 7 AD-4 states**, each explicitly IN or OUT for the child (decide `new`/`not_sure`/`no` —
> recommend all three OUT). Remove the `[ASSUMPTION]` tag. Name **one SQL authority**:
> `child_visible_suggestions(account_id)` (`SECURITY DEFINER`), and require that **both** the RLS
> `USING` clause **and** the portal's curated view are defined **in terms of that one function** —
> so "enforced twice" means *two call-sites of one function*, not two re-implementations. Mandate an
> **RLS conformance test** asserting the board-path and portal-path return **identical child-visible
> row sets** for every state × visibility combination.

---

## D6 — Reference identity is a *second*, ungoverned matching problem; bilingual normalization is unspecified for references `[high]`

**Two units.** The reference book (E3, `references` CRUD, FR39) and parse auto-link (E5, FR20/FR42).

**Each obeys every AD.**
AD-5's one-matcher discipline is scoped to the **single/candidate**: its signals are *name +
parents + seminary/yeshiva + Shul + location* — attributes a **reference person does not have**.
AD-12's bilingual rule is written around *"person names"* in the identity-matching context (feeds
AD-5). References are matched by **name/phone** (FR42) — a **different signal set no AD governs**.
So both builders are compliant precisely **because AD-5/AD-12 don't reach references**.

**The incompatibility (a whole second matcher + a bilingual gap).**
- If the E5 builder **reuses `matchIdentity()`** for references (FR20), it applies the **wrong
  signals** (parents/seminary/Shul are null for a reference) → garbage matches. If the E5 builder
  writes a **new reference-matcher**, there are now **two identity matchers** in the system with
  **no governing AD**, and nothing forces them to share the normalizer.
- **Reference names are also bilingual** ("Rabbi Cohen" / "הרב כהן"), but AD-12 was written for the
  single. If E3 stores `references.name` as a single English free-text field and E5's auto-linker
  normalizes bilingually, then a **manually added "R' Cohen" and a parsed "הרב כהן" never link** →
  **duplicate reference contacts**, and FR42's "prior conversations across singles" — a core
  diligence value — is **silently lost**. Both units comply; the feature fails.

**New/tightened AD (close it).**
> **New AD — one matcher per entity-class, one shared normalizer.** Reference identity has its own
> sole entry point `matchReference()` keyed on **name + normalized phone**, and `references` stores
> `name_en` / `name_he` + a normalized `phone`. `matchReference()` and `matchIdentity()` **both call
> the same `normalize_identity()` function** (per D1). Extend AD-5's "never name-only, never
> auto-merge, user confirms" discipline to references. This closes the gap where the spine governs
> *single* matching but leaves the *reference* matching the product equally depends on ungoverned.

---

## D7 — R2 objects have two readers (owner-view E3 vs share E8), duplicated decryption, and an unpinned key schema `[high]`

**Two units.** Resume owner-view (E3, FR38 360°) and `share/` Worker (E8, FR47-49).

**Each obeys every AD.**
AD-9: files *"are served **only** via a `share/` Worker that mints per-recipient, expiring,
revocable, access-logged signed URLs,"* and sensitive fields (**photos**) are **field-encrypted**.
Read literally, **every** access — including the **parent opening their own resume** in the 360°
view — must go through `share/` and be logged as recipient access.

**The incompatibility (two owners of the read model + duplicated crypto + key drift).**
- **Owner-view has no home.** Routing the parent's own routine viewing through `share/` **pollutes
  `share_access_log`** with owner self-views (FR49's "who accessed and when" now includes the
  sharer), and "per-recipient/revocable/expiring" is **meaningless** for the owner. So the E3
  builder instead adds a **second R2-read path** — and now AD-9's "served **only** via `share/`" is
  either **violated**, or `share/` grows an "owner mode" whose rules differ from its share mode.
  **Two owners of the R2 read model.**
- **Decryption duplicated → divergence.** AD-9 field-encrypts photos. If E3 decrypts for the in-app
  viewer and E8 decrypts in the share renderer, the **DEK/KEK handling is implemented twice**; a
  split (E3 client-side vs E8 in-Worker) yields either a **leaked-key path** or a "renders in-app,
  broken in share" bug.
- **R2 key schema is unpinned (PRV-2 purge risk).** `ingest/` writes landing attachments to R2, E3
  writes manual uploads, `parse/` reads them, `share/` renders them — four Workers, one object.
  SOLUTION-DESIGN §9 says "namespaced by `account_id`," but if `ingest/` writes
  `<account_id>/<uuid>.pdf` and E3 writes `resumes/<resume_id>/<file>`, the namespace **diverges**.
  Then **PRV-2 deletion** ("purge the live system immediately") — which must enumerate an account's
  R2 objects by prefix — **misses** the objects written under the other convention: a
  **privacy-critical residue on delete**.

**New/tightened AD (close it).**
> **AD-9 (tightened).** One media-access service, **two modes**: **(1) owner/member access** —
> authenticated by JWT + account scope, **not** written to `share_access_log`, no expiry;
> **(2) external share access** — via `share_links` token, per-recipient/expiring/revocable/logged.
> Both modes are the **same Worker** and the **same decryption code path**; `share_access_log`
> records **only** mode (2). Define **one R2 key schema** (`account_id/resume_id/…`) and **one
> media-write helper** used by `ingest/` and E3 alike; **PRV-2 deletion enumerates by the
> `account_id/` prefix** and is tested to find every writer's objects.

---

## D8 — Reminder delivery: per-task `delivery_channels` (data) vs the global no-smartphone floor (property) `[medium]`

**Two units.** Reminder-creation UI (E7, FR46) and the `cron/` dispatcher (E7).

**Each obeys every AD.**
AD-13 stores `delivery_channels` on each task and offers *in-app + email + push + optional SMS*,
with the floor *"at least one non-smartphone channel is always available."* The creation UI offers
all four (compliant); the `cron/` Worker dispatches exactly what's stored (compliant).

**The incompatibility (a floor stated as a property, not a write constraint + unclassified
channels).**
- **The floor isn't enforced on the write.** A user can deselect email and in-app, leaving
  **`push` only** (smartphone-only) — nothing in the schema-level `delivery_channels` prevents an
  all-smartphone set. The `cron/` builder then either **honors push-only** (floor violated for a
  phone-less user — NFR-2 breach) or **silently injects email** (overriding the user's explicit
  choice). No AD says which wins.
- **Channel reachability is unclassified.** The persona spans **basic/kosher-phone** users **and**
  **desktop-only phone-less** users. `push` = smartphone-only; **SMS reaches basic phones but not
  the desktop-only phone-less**; `in-app` reaches the phone-less **only on desktop**; **email
  reaches both**. So "at least one non-smartphone channel" is **ambiguous** — *offered in the UI* vs
  *actually enabled on this reminder* vs *proven to reach this member's known devices* — and two
  builders resolve it three ways.

**New/tightened AD (close it).**
> **AD-13 (tightened).** (i) **Classify** each channel's reachability as data (push =
> smartphone-only; SMS = any phone, not desktop-only; email + desktop-in-app = phone-independent).
> (ii) Make the floor a **write-time invariant** on `delivery_channels`: the set must always include
> **email** (or another channel *proven* to reach that member) — enforced in the creation validator
> **and** re-checked by `cron/` before dispatch via one `resolveDeliveryChannels(member, requested)`.
> (iii) **Precedence:** the floor **wins** over deselection; the UI states email can't be removed
> unless another phone-independent channel is present.

---

## D9 — Polymorphic `target_type` drift and undefined interaction-visibility inheritance `[medium]`

**Two units.** `interactions` (E6/FR9, polymorphic) and `tasks` (E7, polymorphic); the child portal
(E9) is the reader.

**Each obeys every AD.**
Both tables carry a polymorphic `target_type ∈ {shadchan, suggestion, reference}` (AD-13 for tasks;
SOLUTION-DESIGN §4 for interactions), each with `account_id` (AD-1). Both compliant.

**The incompatibility.**
- **Two enums defined in two places with no sync rule.** If E6 adds an `inbox_item` or `candidate`
  target to `interactions` (FR9 files "against a shadchan or suggestion" — but a filer might want it
  against a candidate) while `tasks` doesn't, the two polymorphic enums **drift**, and any shared
  polymorphic helper (RLS, timeline render) forks.
- **Interaction visibility is undefined.** AD-3 puts `owner_member_id` + `visibility` on rows, but a
  polymorphic `interaction` **against a suggestion** — does it **inherit** the suggestion's
  visibility, or **carry its own**? If E6 says "inherit" and another builder says "carry own," the
  **child portal (D5) sees different interaction sets**. A candid reference note filed as an
  interaction could surface to the child under one reading.

**New/tightened AD (close it).**
> **Tighten the Consistency Conventions / AD-3.** Define the polymorphic `target_type` enum **once**
> (a shared DB enum both tables reference) and state the sync rule. Specify interaction/note
> visibility explicitly: an interaction **carries its own `visibility` + `owner_member_id`** and, if
> attached to a suggestion, its child-visibility is the **intersection** of its own visibility and
> the suggestion's `child_visible_suggestions()` result (D5) — never broader than the parent object.

---

## Cross-cutting root cause

Seven of nine findings share **one defect shape**: the spine says *"one X"* (one matcher, one
policy module, one filing gate, one access service) but does **not** bind **(a) the sole owner/
writer**, **(b) the single runtime**, or **(c) a conformance test** that proves the "two
enforcement points" agree. The repeated fix is the same discipline the spine already applies well in
AD-1 (isolation is a **DB** invariant, not app prose): **push each "one X" down to a single owner in
a single runtime — preferably a DB function/trigger — and add a conformance test where an invariant
must hold across two surfaces (RLS+view, board+portal, create+dispatch).** Adopting D1's
"one normalizer as a DB function" and D2's "one filing gate" resolves the majority of the blast
radius.

## What the spine already closes (checked, not holes)

- **Cross-account leaks via a forgotten predicate** — AD-1 (RLS default-deny) + SOLUTION-DESIGN §5
  lint/test gate. (D3 is a *different* threat: a present predicate over an untrusted value.)
- **A channel writing straight to a decision state** — AD-6 (human confirm before a suggestion).
  (D2 is a *different* threat: two *creators*, one of which predates the gate.)
- **Auto-merge on match** — AD-5 (user confirms/dismisses; never auto-merge).
- **Direct-to-provider AI calls / AI drifting into matchmaking** — AD-8 (gateway-only; `ai/` Worker
  has no person-lookup fetch capability).
- **Public file URLs** — AD-9 (no public URL). (D7 is a *different* threat: two *authenticated*
  readers of the non-public object.)
