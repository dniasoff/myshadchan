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
architecture must genuinely support it **with no rework** — Phase 2 is a definite direction, so the
shadchan role is provisioned in v1's schema/RBAC from day one (only the shadchan-facing UI waits):

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

_The authoritative stack/tech source is `ARCHITECTURE-SPINE.md` (18 ADs). In summary (official-source
verified, 2026-07-21):_

- **Scaffold:** fork **Atomic CRM** (`marmelab/atomic-crm`, MIT) — this repo. Rename Contacts →
  Shadchanim, Deals → Suggestions; rewrite for multi-tenancy (`account_id` + FORCE RLS).
- **Host / compute / media (Cloudflare-first):** SPA on **Cloudflare Pages**; all server work
  (webhooks, REST, AI orchestration, share-render, cron, billing, email-in) on **Cloudflare Workers**;
  user media in **Cloudflare R2** (zero-egress), served via a Worker-proxied stream (AD-9).
- **Data plane:** **Supabase** (Postgres + RLS + Auth + Storage), **US region**. **Async + rate-limit:**
  **Upstash** (Redis + QStash).
- **AI / OCR:** all AI via **Cloudflare AI Gateway**; OCR+extraction = **Gemini** (Flash→Pro; strong
  typed Hebrew), **Google Document AI/Vision** deterministic fallback; traced via **Langfuse**.
- **Email:** inbound = **Cloudflare Email Routing → Email Worker** (`postal-mime`, free/unlimited);
  outbound (magic-link, reminders) = **Resend**.
- **Capture:** PWA **share-target** (Android) + **Share → Mail → inbox** (iPhone) + email-forward/CC +
  upload; SMS is captured via Share (FR28). **No outbound SMS.**
- **Auth:** passwordless — **magic-link / email-OTP** load-bearing; **passkeys** a progressive
  enhancement (Supabase passkeys Beta, never sole factor); new members join by **verified invite**
  bound to inviter's account + role (PRV-9, AD-11).
- **Analytics:** **PostHog** (product events + errors + replay + surveys — powers §18 metrics incl. the
  child "felt-surveilled" check); backend errors = Cloudflare Workers native; **Sentry → Phase 2**.
- **Abuse / rate-limit:** Cloudflare WAF + Turnstile + Upstash Redis token-bucket (NFR-13).
- **i18n:** ra-core `i18nProvider` (English + Hebrew, extensible) + **RTL bidirectional** layout (NFR-12).
- **Version posture:** **stable-default** (majors held at CI-green lines; verified-latest = tracked
  fast-follow). **Domain:** myshadchan.space.
- **Billing & AI entitlements:** **Stripe** for the per-account **AI subscription** (~$2/mo,
  free-trial → paid); a **webhook** endpoint (edge function) syncs subscription status; **entitlement**
  (trialing / active / expired + rate-limit budget) enforced **server-side** (RLS / edge, not just UI);
  **usage metering** per account/period drives the rate limits (FR74). Limits + price kept
  **operationally tunable** so cost can track usage (NFR-11).
- **Cost note:** free core; only the AI features are paid, at **cost-recovery** — prefer cheap models,
  caching, and batching for OCR/LLM so per-family AI cost stays within the tier price (NFR-9).

---

## Data model (starting point for the architecture phase)

_The architecture spine's ER model is authoritative. Key entities below; the spine also carries
**`account_members`**, **`share_links` + `share_access_log`**, and per-row **visibility** (AD-2/3/9),
with billing columns on `accounts`._

- **account / membership / role** — multi-tenant; roles parent / child / helper / self-manager
  (Phase 2: **shadchan**), enforced with row-level security (PRV-3, PRV-4).
- **subscription** — account_id, stripe_customer_id, stripe_subscription_id, status
  (trialing / active / past_due / canceled), trial_ends_at, current_period_end. Per **account**,
  managed by parent/admin only (FR73); drives the AI **entitlement**.
- **ai_usage_meter** — account_id, period, feature (auto_parse / assistant), count — powers the
  per-account **rate limits** (FR74) and the cost-recovery metrics.
- **candidate** (child): names (Eng/Heb), gender, dob, community, status; may also be a **login
  identity** (child role). 1—* suggestions, 1—* dates.
- **shadchan**: name, location, contacts, notes, responsiveness; 1—* suggestions. (Phase 2: may
  become a user/role.)
- **suggestion** (redt): candidate_id, shadchan_id, single's details, date_suggested,
  pipeline_state, first_suggested_by, resume_id, close_reason. Central object.
  (Phase 2: may be shadchan-originated in-platform.)
- **resume**: files (doc + photo), extracted fields (JSON), linked single identity.
- **reference**: name, relationship, phone, **school, grad-year** (reusable, within-account); join
  **reference↔resume** with per-link call_status + notes + what_they_said.
- **date_record**: candidate_id, person identity, date(s), outcome, notes → powers history dedupe.
- **interaction / note**: timestamped, polymorphic (shadchan / suggestion / reference).
- **task / reminder**: due_at, linked entity, delivery channel.
- **inbox_item**: source_channel (share/email/upload), raw payload + attachments, email_mode
  (cc/forward, nullable), detected_shadchan (+confidence), parse_status, filed_status
  (unfiled/filed/archived), resulting_suggestion_id.
- **account_phone**: account_id, phone (E.164), verified — a linked contact number.
- **identity-match index**: normalized **name + parents + seminary/yeshiva + Shul + location** for
  dedupe/history matching (**not** age/height).

---

## Licensing & governance

- **License: FSL-1.1-ALv2** (Functional Source License v1.1, Apache-2.0 future license).
  **Source-available**, *not* OSI "open source": anyone may use, copy, modify, and redistribute the
  code for any **Permitted Purpose** — **except a Competing Use** (a commercial product/service that
  substitutes for, or offers substantially similar functionality to, MyShadchan). **Two years** after
  each release it **auto-converts to Apache-2.0** (true OSS). `LICENSE` lives at the repo root;
  copyright holder + year set by the owner (currently "Daniel Niasoff, 2026" — change to the project's
  legal entity if one is formed).
- **Why FSL:** it protects the **cost-recovery** model — no one can
  clone the repo and run an undercutting hosted competitor — while still giving the community full
  read / audit rights and **self-hosting for their own use** (not as a service for others, which would
  be a Competing Use), which *reinforces* the privacy wedge (anyone can verify there is no pooling).
  The 2-year flip to Apache-2.0 preserves the long-term open ethos of a non-profit.
- **Fork relicensing (important):** this repo forks **Atomic CRM** (© Marmelab), which is **MIT**. MIT
  permits sublicensing, so the combined work can ship under FSL, **but the upstream MIT notice must be
  retained** — kept in `LICENSE.md`. FSL governs MyShadchan's own contributions and the work as a
  whole; the Marmelab MIT notice stays. *(Two root files result — project `LICENSE` (FSL) + retained
  `LICENSE.md` (MIT); tidy to a `NOTICE` file if preferred.)*
- **Terminology honesty:** public/landing messaging should say **"source-available"** (or "open
  eventually"), not "open source," to stay accurate under the OSI Open Source Definition.
- **Not entity/tax formation:** "non-profit" here is the operating stance (cost-recovery, no profit);
  any formal non-profit entity / 501(c)(3) is out of PRD scope and an owner decision. **Public/landing
  copy should say "operated at cost / not-for-profit stance," not claim to *be* "a non-profit"** until
  an entity exists. Legal specifics — license enforceability, fork relicensing, non-profit status —
  **confirm with counsel** (per §4).
