---
title: Security & Tenancy Review — MyShadchan v1 Architecture Spine
type: adversarial-security-review
reviewer: security/privacy reviewer (tenant-isolation focus)
target: ARCHITECTURE-SPINE.md + SOLUTION-DESIGN.md
status: complete
created: 2026-07-21
counter_metric_under_test: "cross-account data leaks = 0"
sources:
  - _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md
  - _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md (§4 PRV-1..12)
  - supabase/schemas/01_tables..07_storage.sql (fork baseline — verifies "replaces this")
  - supabase/functions/{postmark,users,_shared}/ (ported/reused code)
---

# Security & Tenancy Review — MyShadchan v1

## Verdict

The three-layer defense-in-database paradigm is the right spine and the ADs are directionally sound, but **for a product whose #1 counter-metric is "cross-account leaks = 0" the design still leans on discipline where it needs mechanism**: the service-role seam (AD-7) has no structural safeguard, the identity-matching index (AD-5) is never explicitly account-scoped, and the intra-account dignity model (AD-3) is specified at the wrong grain — leaving the highest-sensitivity content (reference candid words, parent notes) outside its reach. These are fixable in the spine before build; none require re-architecture.

## Method

Read the spine and solution-design in full; cross-checked every "replaces this / ratified" claim against the fork's `supabase/schemas/*.sql`, and grounded the AD-6/7/11 seams against the actual ported code (`postmark`, `users`, `_shared`). Findings cite AD ids and `file:line`.

## Fork baseline — "replaces this" claims confirmed

All verified true; the spine's characterization of the starting point is accurate:

- **Zero tenant isolation today.** Every table policy is `to authenticated using (true)` — `05_policies.sql:19-69`. AD-1's "the fork's `using(true)` policies are replaced, not extended" is correct and necessary.
- **Single-tenant role model.** `is_admin()` = `sales.administrator` for `auth.uid()` (`02_functions.sql:265-274`); `handle_new_user()` makes the *first* signup admin (`02_functions.sql:227-247`) — the `isInitialized` gate AD-2/AD-11 retire.
- **Storage is a shared bucket.** `07_storage.sql:6-8` = any-authenticated read/insert/delete on `bucket_id = 'attachments'`, no owner/account scope. AD-9's move to R2-behind-a-Worker is warranted.
- **Views mostly `security_invoker = on`** (`03_views.sql:6,74,102`) — but see Finding 10 for the counter-example.

---

## Findings

### F1 — [critical] Identity matching index is not stated to be account-scoped (AD-5 + AD-7)

AD-5 (`ARCHITECTURE-SPINE.md:77-80`) and SOLUTION-DESIGN §7 (`SOLUTION-DESIGN.md:194-199`) define `matchIdentity()` over a "Postgres-materialized signal index" (`identity_signals`) run from the `match/` Worker — i.e. under the **service role, RLS bypassed** (AD-7). Nowhere in AD-5's rule does it state that every match query is filtered to the caller's `account_id`. The data model's blanket "every table also has `account_id`" (`SOLUTION-DESIGN.md:120`) puts the column on the table, but a column is not a predicate: a Worker that queries the materialized index for **recall** ("find every similar person") without an `account_id` filter will match a family-A capture against family-B's people.

Impact: the duplicate / already-dated banner (UJ-1, FR10-13) is the product's signature moment — sourcing it from another family's data is simultaneously a cross-account leak (counter-metric = 0) **and** a direct breach of the wedge, PRV-2 "no pooling across families." This is the worst-case failure the whole product is sold against.

Fix: AD-5 must make "matching is account-scoped — every `identity_signals` query carries `account_id = <caller account>`" a hard invariant, tested with a cross-account match attempt from the `match/` Worker.

### F2 — [critical] The service-role seam relies on a rule, not a mechanism (AD-7)

AD-7 (`ARCHITECTURE-SPINE.md:87-90`) and its restatement (`SOLUTION-DESIGN.md:149`) make the isolation guarantee on this path a **coding discipline**: "a Worker using the service role MUST re-assert the account scope in every query." The mitigation offered is "a lint rule + code-review gate + tests" (`SOLUTION-DESIGN.md:149`). Grounding this against the reused code shows why a rule is not enough:

- `postmark/index.ts:55` — `supabaseAdmin.from("sales").select("email")` fetches **all** rows globally, no scope, service role.
- `users/index.ts:191-204` — `patchUser` fetches a `sale` by `sales_id` under the service role and only *then* hand-checks authorization; `inviteUser` hand-checks `administrator` at `:73`. Every check is per-endpoint and omissible.
- `06_grants.sql:10,70-107` — `service_role` holds `grant all` on every table; RLS is bypassed by design.

With RLS off on this role, a single forgotten `.eq('account_id', …)` in any of the six planned Workers (`ingest/parse/match/ai/share/cron`) is a silent cross-account read or write. A lint rule that pattern-matches for a literal `account_id` string is trivially defeated (joins, views, RPC, dynamic filters) and does not exist yet.

Fix (structural, not procedural): make the **only** way a Worker touches a tenant table a mandatory scoped-client helper — e.g. `forAccount(accountId)` returning a wrapper that injects/asserts the `account_id` predicate and refuses raw table access — so "un-scoped query" is unrepresentable rather than merely linted against. Keep the lint + tests as backstops. This is the single highest-leverage change in the review.

### F3 — [high] The dignity model is enforced at the suggestion grain; the sensitive content lives one level down (AD-3)

AD-3 (`ARCHITECTURE-SPINE.md:67-70`) and SOLUTION-DESIGN §5 (`SOLUTION-DESIGN.md:150`) put `owner_member_id` + `visibility` on rows and derive "what a child sees" from the **suggestion's** state and visibility. But the highest-sensitivity data (PRV-1: references' *candid words*, health notes, the parent's working notes) does not live on `suggestions` — it lives on child tables that the data model (`SOLUTION-DESIGN.md:130-132`) gives **no** `visibility`/`owner_member_id`:

- `reference_links` — `what_they_said`, `conversation_log jsonb` (candid reference content).
- `interactions` — the polymorphic timeline / notes body.
- `resumes` — files/photos/extracted.

If these tables' RLS is only `account_id`-scoped (tenant), the `child_candidate` role reading `reference_links`/`interactions` **directly via PostgREST** sees candid reference words and the parent's notes on any suggestion it can reach — flatly violating FR68 ("reference diligence at a dignified distance … not the candid content", `prd.md:386`), FR69, and PRV-4. The child-portal curated view (`SOLUTION-DESIGN.md:227`) hides it in the UI, but RLS — not the view — is the boundary (the whole point of AD-1), and PostgREST exposes the base tables.

Fix: AD-3's single visibility module must derive child-visibility for **every child table of a suggestion** via a join-to-parent predicate in RLS (a child sees a `reference_link` only when it may see the parent suggestion **and** the row is not diligence-candid content), and the curated views must be the child's only read path with matching RLS as defense-in-depth. Add a "notes/references never reach the child" RLS test to the suite.

### F4 — [high] "Revoke = immediate" is incompatible with handing out signed R2 URLs (AD-9, PRV-8, FR49)

AD-9 promises "Revoke = immediate cut-off" (`ARCHITECTURE-SPINE.md:100`) and PRV-8/FR49 require revoking to cut access **immediately** (`prd.md:234,334`). SOLUTION-DESIGN §9 implements this as the Worker minting "signed URLs (or streams via the Worker)" (`SOLUTION-DESIGN.md:216`). The **signed-URL** option breaks the invariant: an R2/S3 pre-signed URL is valid until its TTL and cannot be recalled — once minted and shared, `revoked_at` cannot stop it. Per-view access logging (FR49 "sees who accessed and when") is also impossible if the recipient talks straight to R2.

Fix: AD-9 must forbid handing raw pre-signed R2 URLs to recipients. The only compliant design is a **Worker-proxied stream** that checks `revoked_at`/`expires_at` and writes `share_access_log` on **every** request (or, at most, a per-request-checked redirect with a seconds-scale TTL). Make "recipients never receive a direct R2 URL" an explicit AD-9 rule.

### F5 — [high] Forwarded-email attribution defaults to silent "first email in the body" (AD-6, PRV-7)

AD-6/PRV-7 require an unrecognised/low-confidence forwarded sender to be **flagged, never silently attributed** (`ARCHITECTURE-SPINE.md:85`, `prd.md:232-233`). The spine treats the existing `postmark` code as a "head start" to port into `ingest/` (`ARCHITECTURE-SPINE.md:90`), but that code's actual behavior is the opposite of the invariant: `postmark/index.ts:69-84` regex-scans the body and silently attributes to `candidateEmails[0]` — the first email that isn't the inbox or a known sender — with no confidence gate and no unattributed path. In multi-tenant, "first email in the body" can resolve to **another account's** shadchan/contact.

Impact: mis-attributed channel items = a second counter-metric ("mis-routed channel items = 0", `prd.md:424`) and a cross-account write.

Fix: flag this as a **behavior change, not a lift-and-shift**. The port must (a) resolve sender→account deterministically, (b) route any ambiguous/unknown sender to the unattributed queue **and** flag low-confidence recoveries, (c) never auto-pick a body email across the account boundary. The spine should say so explicitly so the developer does not port the silent-attribution default.

### F6 — [high] `anon` holds `grant all` on every table, and every *future* table, by default privilege (AD-1 defense-in-depth)

`06_grants.sql:69-107` grants `all` on every table/view to `anon` (the **unauthenticated** role); `:165,175` set `alter default privileges … grant all on sequences/tables to anon`, so **every future table** created by `postgres` in `public` is auto-granted to `anon`. Today this is masked only because RLS policies are `to authenticated`, so anon matches no policy and is denied. But AD-1's convention "every domain table ships with `account_id` + RLS in the same migration" (`ARCHITECTURE-SPINE.md:142`) is a single point of failure: forget `enable row level security` on **one** of the ~18 new tables and `anon` reads it wholesale, unauthenticated — the worst possible leak, and precisely under the #1 counter-metric.

Fix: AD-1 / the Consistency Conventions must add: **REVOKE** table/sequence grants from `anon`, remove the `anon` default-privilege line, and add a CI assertion that every table in `public` has `rowsecurity = true` (ideally `FORCE ROW LEVEL SECURITY`). This is cheap and closes a latent unauthenticated-read hole the spine currently does not mention.

### F7 — [high] Invite path: no account-binding, role is caller-supplied (AD-11, AD-2)

The invite flow the spine ports (`ARCHITECTURE-SPINE.md:110` "join by invitation into an account membership") is grounded in `users/index.ts`, which today: takes `administrator` straight from the request body (`users/index.ts:70`), and in the `email_exists` branch creates the membership row directly (`:117`) — with **no** scoping to the inviter's own account and privilege supplied by the caller (mass-assignment). Ported naively to multi-tenant, an account-A admin could attach a member to account B, or escalate a role.

Fix: AD-11/AD-2 must pin **where** the invariants live: the invite server-path must (a) bind the new `account_members` row to the **inviter's** `account_id`, (b) authorize the granted `role` ≤ the inviter's authority, (c) refuse `role = 'shadchan' | 'parent_admin'` via mass assignment. Also ensure the passwordless magic-link acceptance grants membership only against a **verified invite token**, not an email match (the fork's `handle_new_user` email-matching pattern, `02_functions.sql:227`, must not silently auto-provision membership on any signup).

### F8 — [medium] The reserved `shadchan` role must be deny-by-default in v1 RLS (AD-2)

AD-2 provisions `shadchan` in the enum + "RLS from day one (UI dormant)" (`ARCHITECTURE-SPINE.md:65`), with per-relationship consent scoping deferred to Phase 2 (`SOLUTION-DESIGN.md:280`). "RLS from day one" is ambiguous about whether v1 policies **grant** the role anything. If any v1 policy gives `shadchan` account-wide read as a placeholder, a `shadchan` membership created in v1 (e.g. via the F7 mass-assignment gap) leaks the whole account — with none of the Phase-2 consent scoping that is supposed to contain it.

Fix: state explicitly that in v1 the `shadchan` role is granted **nothing** — no `USING`/`WITH CHECK` clause admits it — until Phase-2 consent scoping ships. Provision the enum value and a deny posture, not access.

### F9 — [medium] Polymorphic `interactions`/`tasks` have no account-integrity binding to their target (AD-1)

`interactions` and `tasks` are polymorphic (`target_type`/`target_id`, `SOLUTION-DESIGN.md:132-133`). A polymorphic `target_id` cannot carry a foreign key, so nothing guarantees a row's `account_id` equals its target's `account_id`. A service-role bug (F2 territory) could write `interaction.account_id = A` pointing at a suggestion in account B; any read that resolves the timeline by `target_id` without independently re-asserting account could surface B's row to A.

Fix: add a composite unique key `(account_id, id)` on the targetable tables and reference it, or a validation trigger asserting the target's account matches; and require reads to filter these tables by their own `account_id`, never trusting `target_id` alone. Worth an explicit line in AD-1 since the spine calls out these two tables as the polymorphic ones.

### F10 — [medium] Curated/definer-view discipline is asserted but has an in-repo counter-example (AD-1, AD-3)

AD-1 states "Views use `security_invoker = on` (ratified)" (`ARCHITECTURE-SPINE.md:60`) as if uniform, but the fork ships `init_state` with `security_invoker = off` (`03_views.sql:130`) granted to `anon` (`06_grants.sql:122-124`) — a definer view that bypasses RLS. It is harmless today (a bootstrap count) and should be **dropped** with the retired `isInitialized` gate. The risk is the pattern: the new candidate-portal curated views (AD-3) are the child's read path; if a developer copies the definer pattern to "aggregate across the visibility boundary," the view bypasses the child's RLS and leaks parent-private content.

Fix: make "curated views are `security_invoker = on`; child RLS is the boundary" an explicit convention, drop `init_state`, and add a test asserting no `public` view is `security_invoker = off`.

### F11 — [low] AI Gateway cache is content-hash-keyed and global; field-encryption scope leaves the PDF in clear (AD-8, PRV-6/10)

The AI Gateway response cache is keyed on document hash (`SOLUTION-DESIGN.md:188`), i.e. shared across accounts. This is not a byte-leak (identical input → identical output) but is a cross-account **existence/timing oracle** and a cache-poisoning surface; consider namespacing the cache by account or accepting the risk in writing. Separately, PRV-10 field-encrypts the **health/photo columns** (`SOLUTION-DESIGN.md:152`) — but a resume PDF typically embeds the photo and health text inline, and that PDF sits in R2 protected only by SSE (a vendor-managed key the Worker can read). Document this scope boundary so "field-encrypted" is not read as "the sensitive bytes are encrypted end-to-end."

### F12 — [low] Account-scope the reference/identity merge if it runs under service role (AD-5, AD-7)

The reference-dedup pattern derives from `merge_contacts` (`02_functions.sql:276-426`), which reassigns tasks/notes/deals by id with **no** account predicate — safe today only because it runs as invoker under RLS. If reference or identity merge moves into a service-role Worker (AD-7), the same shape silently crosses tenants. Covered structurally by F2, but call it out where the merge logic is specified.

---

## What is solid (keep)

- **Defense-in-database paradigm** (AD-1) with the app treated as untrusted is the correct spine for this counter-metric.
- **Single `matchIdentity()` entry point, never name-only, never auto-merge, human confirm/dismiss** (AD-5) — sound; just needs the account-scope invariant (F1).
- **Unattributed-queue invariant for SMS** (AD-6) is well specified and directly answers PRV-7 for that channel — the email path (F5) is the one that needs the same rigor.
- **Passwordless auth on Supabase Auth with JWKS verification** — the fork's `_shared/authentication.ts:26-51` (issuer-checked `jwtVerify` against remote JWKS) is a ratifiable, correct foundation for AD-11; `get_user_id_by_email` is already locked to `service_role` only (`06_grants.sql:29-30`).
- **18+ affirmation → COPPA N/A** (AD-11, PRV-12) is a sound, simple scope reducer.
- **No-public-URL for media + revocable/expiring/access-logged sharing intent** (AD-9) is the right shape — F4 is about the implementation option, not the goal.
- **AI scoped to have no web-fetch for person lookups** (AD-8, `SOLUTION-DESIGN.md:208`) enforces FR63 by capability, not just prompt — good.
- **Gut `for_sure_not` vs post-investigation `no` kept distinct** (AD-4) correctly preserves the dignity-relevant distinction the child must never see.

## Priority order for the spine edit

1. F2 (structural scoped-client for the service-role seam) — enables F1, F9, F12.
2. F1 (account-scope the match index) — signature-feature leak.
3. F3 (extend child-visibility to reference/interaction/resume grain) — dignity floor.
4. F6 (revoke anon grants + default privilege; CI RLS-enabled check) — cheap, closes unauthenticated read.
5. F4, F5, F7 — sharing revocation, forwarded-email attribution, invite binding.
6. F8, F9, F10 — reserved-role deny, polymorphic integrity, view discipline.
7. F11, F12 — document/scope.
