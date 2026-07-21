# MyShadchan.space — PRD Addendum

_Depth captured during PRD coaching that belongs to downstream documents (architecture,
solution design, UX) rather than the PRD narrative itself._

---

## Phase 2: shadchan interface — provision the architecture in v1

**Direction (user, 2026-07-21):** the shadchan interface is **Phase 2 — the next phase after v1,
not long-term.** It is a **shadchan-facing** surface where shadchanim:

- **interact with parents** (a networked, consent-based connection),
- **redd shidduchim** — send suggestions directly into a connected parent's pipeline (a new,
  **in-platform suggestion source**),
- **track their own conversations** (a lightweight CRM on the shadchan's side).

**v1 remains parent-side** and positioned "not a shadchan tool." Because Phase 2 is near, the v1
architecture must genuinely support it **without rework**:

- **Shadchan as a first-class user / role**, not only a contact record — the multi-tenant account
  + RBAC model (parent / child / helper / self-manager) extends to a **shadchan role**.
- **In-platform suggestion origination** — the suggestion/relationship model must allow a suggestion
  to be **shadchan-originated** (a networked hand-off into a parent's pipeline), alongside channel
  and manual entry.
- **Per-relationship, consent-based data scoping** — a parent explicitly connects with a specific
  shadchan; sharing is scoped to that interaction thread.

**Privacy reconciliation (critical — preserves the wedge).** A shadchan interface must **not**
become a networked pool. Hard invariants: a shadchan sees **only** the interaction/suggestion
thread they are party to — **never** the parent's private notes, references' candid words, dating
history, other shadchanim's suggestions, or the child's data. **PRV-2** ("no pooling across
families / no public DB") holds; shadchan↔parent sharing is **consent-based messaging, not database
exposure**, and must be designed into the RLS/RBAC model from v1.

**Open shape to resolve when scoping Phase 2:** how much shadchan-side "manage my pool" CRM to
include vs. keeping Phase 2 purely the parent-interaction / redding / conversation-tracking surface.

---

## Technical assumptions (starting points for the architecture phase)

_The PRD stays capability-level; these are the owner's technical leanings, to be confirmed/decided
in `bmad-architecture`._

- **Stack:** React front end + **Supabase (Postgres)** — fork **Atomic CRM**
  (`marmelab/atomic-crm`, MIT) as the scaffold (ships Contacts, a Kanban deal pipeline,
  tasks/reminders, notes, activity log, OAuth, file storage). Rename Contacts → Shadchanim,
  Deals → Suggestions; extend the schema. _(This repo is that fork.)_
- **Alternative** for a productised build: React + Go (chi/Gin or gqlgen) + Postgres, hosted auth,
  object storage.
- **OCR:** AWS Textract or Google Document AI; **extraction** via an LLM to a fixed JSON schema.
- **Share-link rendering:** server-side HTML → headless Chrome, or React-PDF.
- **Reminders:** cron/worker → email (Postmark/Resend), SMS (Twilio).
- **Email inbound:** Postmark Inbound / SendGrid Inbound Parse / Mailgun Routes (per-account
  address).
- **Hosting:** **US region** (per the US-product decision). **Auth:** passwordless
  (magic-link / passkeys — PRV-9).
- **Domain:** myshadchan.space.
- **Cost note:** free product → prefer cheap models, caching, and batching for OCR/LLM (NFR-9).

---

## Data model (starting point for the architecture phase)

- **account / membership / role** — multi-tenant; roles parent / child / helper / self-manager
  (Phase 2: **shadchan**), enforced with row-level security (PRV-3, PRV-4).
- **candidate** (child): names (Eng/Heb), gender, dob, community, status; may also be a **login
  identity** (child role). 1—* suggestions, 1—* dates.
- **shadchan**: name, location, contacts, notes, responsiveness; 1—* suggestions. (Phase 2: may
  become a user/role.)
- **suggestion** (redt): candidate_id, shadchan_id, single's details, date_suggested,
  pipeline_state, decision_substate, first_suggested_by, resume_id, close_reason. Central object.
  (Phase 2: may be shadchan-originated in-platform.)
- **resume**: files (doc + photo), extracted fields (JSON), linked single identity.
- **reference**: name, relationship, phone, **school, grad-year** (reusable, within-account); join
  **reference↔resume** with per-link call_status + notes + what_they_said.
- **date_record**: candidate_id, person identity, date(s), outcome, notes → powers history dedupe.
- **interaction / note**: timestamped, polymorphic (shadchan / suggestion / reference).
- **task / reminder**: due_at, linked entity, delivery channel.
- **inbox_item**: source_channel (whatsapp/email/sms), raw payload + attachments, email_mode
  (cc/forward, nullable), detected_shadchan (+confidence), parse_status, filed_status
  (unfiled/filed/archived), resulting_suggestion_id.
- **account_phone**: account_id, phone (E.164), verified — SMS sender-lookup routing.
- **identity-match index**: normalized **name + parents + seminary/yeshiva + Shul + location** for
  dedupe/history matching (**not** age/height).
