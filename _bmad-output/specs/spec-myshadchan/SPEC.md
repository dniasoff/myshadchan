---
id: SPEC-myshadchan
companions:
  - glossary.md
  - personas-and-contexts.md
  - ../../planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md
  - ../../planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md
  - ../../planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md
  - ../../planning-artifacts/epics.md
sources:
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# MyShadchan — Phase 1

## Why

A **vision to realize**, on top of a real and specific pain. A parent redting for their children holds the whole process in their head and across scattered WhatsApp threads, a binder and a spreadsheet: who suggested whom, what each reference actually said, which boy was already suggested two years ago, what was decided and why. The recall failure is not an inconvenience — it costs suggestions, repeats painful ground, and burns the goodwill of shadchanim and references. Existing tools serve shadchanim managing a pool; nobody serves the family. MyShadchan is the organised memory of the shidduch process, held **per family and never pooled** — that privacy stance is the wedge, not a feature. Phase 1 extends that memory from a single parent's private ledger to every party who legitimately takes part: the single themselves, a spouse or helper, and — by explicit consent — the shadchan.

## Capabilities

- **CAP-1** — Capture from any channel
  - **intent:** A user can get a redt out of WhatsApp, SMS, email, a photo or their own typing and into the system while they still remember it.
  - **success:** A shared or forwarded message becomes an unfiled inbox item in the sharer's own account, with attachments intact, and is never silently attributed across an account boundary.

- **CAP-2** — One confirm step before anything is filed
  - **intent:** A user confirms which single and which shadchan an inbound item belongs to before it becomes a suggestion.
  - **success:** No inbound path — channel, manual or shadchan-originated — creates a suggestion without passing the confirm step; skipping the step leaves the item in the inbox rather than losing it.

- **CAP-3** — One canonical pipeline
  - **intent:** A user can move a suggestion through the seven states and see the whole board for a single.
  - **success:** Every state change goes through one guard; a decision state is reachable only from *look-into*; a gut set-aside and a post-investigation refusal remain distinguishable.

- **CAP-4** — Recognise someone already seen
  - **intent:** The system tells a user when a person now being suggested has been suggested — or dated — before, with the evidence for the claim.
  - **success:** Re-entering a previously seen person raises a catch showing the prior suggestion and its outcome; nothing merges automatically; age is never used as a matching signal.

- **CAP-5** — Reference diligence per suggestion
  - **intent:** A user can work through the people to speak to about a suggestion, log what each said, and see what has not yet been asked.
  - **success:** A suggestion shows progress ("N of M spoken to"); every reference states whether this is a first conversation or one of several; call outcomes and candid words are recorded against that suggestion.

- **CAP-6** — Follow-through that does not depend on memory
  - **intent:** A user can be reminded of what is due and can assign work to another member of the family.
  - **success:** A reminder reaches the user in-app and by email; a task carries an assignee and the record it concerns; nothing is delivered by SMS.

- **CAP-7** — One consistent 360° view of every entity
  - **intent:** A user sees every record — single, suggestion, shadchan, reference — through the same shell, tabs and links.
  - **success:** Every entity renders from a declared descriptor with no bespoke layout code; every record lives at a deep-linkable URL; every mention of a record anywhere routes to that record.

- **CAP-8** — Several personas on one login
  - **intent:** A person can be a single, a parent and a shadchan at once, and can change which of those they are over their lifetime.
  - **success:** Onboarding provisions from a multi-select; a persona can be added or removed later without re-registration; removing one archives rather than deletes; exactly one context is active at a time and it is chosen explicitly.

- **CAP-9** — The single takes part in their own process
  - **intent:** A single can log in, see what is being explored for them, and give their view on it.
  - **success:** The single opens the same screens as the parent with no parallel interface; gut set-asides, candid reference words, private notes and medical notes are unreachable at the database, not merely hidden; their input reaches the parent against the suggestion; the dignity floor cannot be switched off.

- **CAP-10** — Consent-based shadchan participation
  - **intent:** A shadchan can work in their own context, connect to a family by mutual consent, and send a suggestion straight into that family's pipeline.
  - **success:** A connection exists only after explicit acceptance and either side can end it; a redt arrives with shadchan provenance and enters the confirm step; a shadchan can reach nothing of the family beyond the threads they are party to.

- **CAP-11** — Communication across every party
  - **intent:** Any two parties — parents, singles, helpers, shadchanim — can hold a conversation about a subject.
  - **success:** A thread is attached to a suggestion or a relationship, is visible to all parties in its context by default, and can be made private per discussion, with private readership limited to its participants.

- **CAP-12** — Opt-in discoverability and revocable sharing
  - **intent:** A shadchan or a single can choose to be findable, and a family can send a profile to a shadchan by link.
  - **success:** Nothing is discoverable until published field by field; withdrawal removes it from search immediately and a single may always withdraw their own; a share link is revocable and expiring, and its use is logged.

- **CAP-13** — AI that organises rather than judges
  - **intent:** A user on the paid tier can have a resume read for them and their reference calls summarised.
  - **success:** Extraction produces an editable draft with the original kept as received and unknown fields left blank; the dossier reports agreement, contradiction and unasked questions drawn only from that account's own records; entitlement is re-checked server-side before any inference; it never scores compatibility or suggests a match.

## Constraints

- **Isolation is enforced in Postgres, never in the application.** Every domain row is scoped by exactly one axis — an account (a household or a shadchanus) **or** a connection — with forced row-level security. A leak is a defect of the highest order; the counter-metric is zero.
- **The active context is a server-side row, chosen explicitly.** A login holding several contexts can read exactly one at a time; a client-supplied context is never trusted.
- **A shadchan holds no household membership.** They reach only connection-scoped rows they are party to, which makes the privacy promise structural rather than policy-dependent.
- **Published listings are a snapshot and the only anonymously readable relation in the product.** It physically contains no private column.
- **Nothing is discoverable by default.** Publication is an explicit, granular, revocable act; families as such are never listed; a listing never exposes the working record.
- **The dignity floor cannot be switched off.** A single always sees their live prospects and can give input, and may always withdraw a listing about themselves.
- **Authentication is passwordless and invite-only, with an 18+ affirmation.** Invites are the single mechanism for household membership, a single's login, and a shadchan connection.
- **One creation path and one transition guard** own every suggestion; no second write path may exist.
- **Never fabricate.** Where data does not exist the field is omitted, not invented — including by the AI.
- **No outbound SMS, ever.**
- **Greenfield engineering standard.** Technical debt is cleared before feature work; no backwards compatibility, deprecation shims, fallbacks or aliased names; when something is replaced the replaced thing is deleted in the same change.
- **Entities are named for what they hold.** The person being redt for is a *single*; no name may misdescribe its contents.

## Non-goals

- **Not a pooled or networked database.** No cross-family pooling, no matching engine, and no directory that lists families.
- **Not a matchmaking product.** The system never scores compatibility, ranks people, or suggests a match — it remembers and organises.
- **Not a messaging app.** Conversations are structured, subject-scoped records, not free-form chat.
- **No SMS channel**, inbound or outbound.
- **No automatic merging or filing.** Dedupe surfaces evidence; a human always decides.
- **No password authentication** and no open self-signup.
- **Not a shadchan's pool-management tool.** A shadchan's context serves their conversations with connected families, not a book of other people's singles to browse.
- **Out of scope this phase:** extended family as first-class participants, and a single belonging to more than one household.

## Success signal

A parent who previously kept the process in their head and across scattered chats can, months later, answer "have we seen this boy before, who suggested him, what did his rebbi actually say, and what did we decide?" in seconds — and can hand part of that process to their spouse, their child and a trusted shadchan without any of them seeing what they should not.

## Assumptions

- The shipped `current_account_id()` — which resolved a user to one arbitrary account — is implementation drift from AD-1's `current_account_ids()`, not a deliberate design; Phase 1 replaces it outright.
- Snapshot semantics for listings are acceptable: an edit to the underlying record does not propagate to a live listing until it is republished.
- One active context per user (not per browser tab) is acceptable for launch.
- Existing production data is demo and test only, so no migration path is owed to current users.
