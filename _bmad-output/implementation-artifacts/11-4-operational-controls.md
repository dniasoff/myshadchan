# Story 11.4: Operational controls for the AI Workers

Status: in-progress — design approved (this wave); code changes are tracked separately and are

> **Status correction — 2026-08-09.** This says `in-progress` for code that **shipped** in
> `895d435` ("Close Epic 11 AI-layer findings from two review rounds") — the atomic quota RPCs,
> the rate limiting and the cache removal described below are all present in
> `supabase/schemas/` and `workers/` today. Epic 11 is complete; this header is not. The
> residue that *is* open was never this story's: **S6**'s non-AI half — observability and rate
> limiting on the four surfaces outside `/parse` and `/dossier` — which is now owned by
> **Stories 15.1 and 15.4**.
**not** verified by this document's author (see "Verification status" at the end).

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Resolution note: C1 — the `/dossier` response cache leaked across roles within one account

The implementation of Q5 below (an account-namespaced response cache, key
`{accountId}/{shidduchim_id}`) shipped, then failed a subsequent three-lens adversarial review as a
P1, ship-blocking finding (labeled C1 in that review). The cache key's only dimension was account
id, but `reference_links` — the table `/dossier`'s query reads from — does not grant uniform access
to every member of an account: its RLS policy ("Reference links scoped to account",
`supabase/schemas/05_policies.sql`) is a blanket deny for the `single` role, so a `parent_admin` and
the `single` being evaluated, both active members of the same household account, resolve to the
same `current_context_id()` and therefore the same cache key — while seeing structurally different
row sets when the query actually runs. Whichever of them called `/dossier` first had their payload
(privileged diligence content, or an RLS-empty response) served verbatim to the other for up to 120
seconds. The inverse was also true: a `single`'s empty response, cached first, could mask a
`parent_admin`'s real diligence data from the people authorized to see it.

**Fix:** the cache was removed outright rather than re-keyed. See the rewritten Q5 below for why a
same-account membership dimension (not just role) makes any Worker-side cache key fragile against
this exact table's own RLS shape, and why removing the cache is cheaper than keeping one correct.
`workers/shared/responseCache.ts` (the generic cache primitive Q5 introduced) and its test file were
deleted along with it — `/dossier` was their only consumer.

**Not touched by this fix, and now stale as a result:** the Acceptance Criteria section below
reproduces `epics.md`'s Story 11.4 text verbatim by design (see its own note on why), including the
line "a cached `/dossier` response is scoped to its account and never returned to another account's
request." That line is no longer literally true — there is no cache, cached or otherwise — and
`epics.md` was out of this fix's declared path ownership, so it was not edited here. Whoever owns
`epics.md` next should either drop that AC clause or replace it with the stronger property this fix
actually delivers ("no `/dossier` response is ever served to a caller other than the one whose
request produced it"), per `.claude/rules/parallel-ownership.md`'s "a shared decision has exactly
one owner."

**Update (2026-08-06): done.** An external review of Epic 11 independently re-raised this exact
drift as its own finding 18. `_bmad-output/planning-artifacts/epics.md`'s Story 11.4 acceptance
criteria have now been amended — with an inline note recording what was replaced and why, so the
history stays legible — to the property this fix actually delivers: `/dossier` evaluates row-level
security fresh on every request and holds no cross-request state that could serve one caller's data
to another. The Acceptance Criteria section immediately below has been updated to match, closing the
drift this note originally flagged.

## Story

As a platform owner,
I want the AI Workers' rate limiting, tracing and response cache to fail safely,
so that a limiter fault can never silently become an unmetered paid endpoint and no household
can ever see another's cached data.

## Position in Epic 11

**4th of 4, added post-ship.** Stories 11.1–11.3 built the entitlement gate and the two paid
inference routes (`POST /parse`, `POST /dossier`). The 2026-08-04 adversarial review of Epic 11
(`_bmad-output/epic-11-adversarial-review-report-2026-08-04.md`) found that none of the three
stories, nor the epic itself, owned account/IP rate limiting, request tracing, or
account-namespaced response caching on those two paid, externally reachable, entitlement-gated
endpoints (Finding 16) — "The detailed story notes acknowledge parts of this gap, while the
top-level epic presents the AI layer as complete and server-enforced." This story is that owning
story, added to close the finding's documentation half: "These controls need an owning story and
acceptance criteria before Epic 11 is considered operationally complete."

**Scope boundary with the sibling quota fix.** Finding 16's own text also says paid-path
enforcement should fail closed "during limiter **or metering** failures." The metering half — the
non-atomic `ai_usage` read-modify-write that Findings 6 and 7 describe — is **not** this story's
scope. It is closed by a separate, sibling change (a new `claim_ai_parse_attempt()` /
`confirm_ai_parse_attempt()` / `release_ai_parse_attempt()` trio in `supabase/schemas/**` and the
corresponding rewrite of `workers/parse/index.ts`'s spend sequence), designed and — per this
wave's plan — implemented by a different agent in the same wave. This story's own fail-closed
contract is about the **rate limiter only**; it does not redesign or re-describe the meter, and it
should not be read as claiming the meter's fail-closed behavior is this story's doing. The two
stories' acceptance criteria are deliberately worded not to overlap, precisely so neither silently
assumes the other covers ground it does not.

**Also not this story's scope:** Findings 6/7/8's atomic idempotency/quota table, and any
`supabase/schemas/**` change at all. This story touches only `workers/shared/`, `workers/parse/`,
`workers/ai/`, their `wrangler.toml` files, and `.github/workflows/deploy.yml`'s secret-push
steps.

## Acceptance Criteria

**Given** an AI Worker whose rate-limit binding is unavailable
**When** a request reaches `/parse` or `/dossier`
**Then** the request is refused when this environment declares enforcement, and allowed through
only when it does not
**And** a limiter that throws at runtime always refuses the request, regardless of that
declaration
**And** every request is traced with a request id, route and outcome, never the resume contents,
dossier narrative, or JWT
**And** `/dossier` evaluates row-level security fresh on every request and holds no cross-request
state that could serve one caller's data to another.

These four ACs are the exact text approved for Epic 11's `epics.md` entry (Story 11.4) and are
reproduced here verbatim — do not let this file and `epics.md` drift apart; see
`.claude/rules/parallel-ownership.md`, "A shared decision has exactly one owner." **The fourth
clause was amended 2026-08-06** (see "Resolution note: C1" above and its 2026-08-06 update) to
replace the original cache-scoping wording, which the C1 fix made stale, with the property the
shipped code actually guarantees.

## Design

### Q1 — Rate-limiting mechanism

**Decision:** Cloudflare's native `[[ratelimits]]` binding (wrangler's top-level array form,
`simple = { limit, period }`, `period` ∈ `{10, 60}`) — confirmed present in this repo's installed
wrangler `4.113.0` config schema. Two bindings per worker (one IP-keyed, one caller-keyed),
declared declaratively in each worker's own `wrangler.toml`. No separate provisioning step beyond
the existing `wrangler deploy`.

**Why:** zero new infra to provision or operate — no KV namespace, no Durable Object class/
migration, no new DB table/load on the very endpoints this is meant to protect. Per-colo
approximate enforcement is acceptable here because this is an *abuse* speed bump, not the quota —
the quota is the sibling atomic DB reservation (Findings 6/7). It is testable in plain Node: the
binding's whole runtime surface is `limit(options): Promise<{ success }>`, a type-only import with
no runtime dependency on the Workers runtime, so a test's fake env object needs only
`{ limit: vi.fn() }` — the same injection shape this codebase already uses for `resumeExtractor`
and `parseIdempotency.ts`'s `hasCachesApi()` guard.

**Rejected:**
- *Durable Object* — needs a new class, a migration, persistent state, and a test harness this
  repo has zero precedent for (all 7 `wrangler.toml` files grepped clean for
  `durable_objects`/`kv_namespaces`/`ratelimits` before this design).
- *Postgres-backed counter* — would add a write to the very database the paid endpoints already
  hit, and repeats the exact non-atomic-race shape Findings 6/7 are being fixed for, on a second
  table. Wrong layer for a fast, cheap, request-level speed bump.
- *Workers Cache API* — not a counter primitive; would need a hand-rolled read-increment-write
  with the same per-colo eventual-consistency weakness Finding 8's own idempotency layer already
  discloses as insufficient for its narrower use.

### Q2 — What identifies "per-account" for the caller-scoped limiter

**Decision:** key the caller-scoped limiter on the unverified `sub` claim decoded from the
Authorization bearer token, not on `account_id`.

**Why:** `ai_entitlement()`'s jsonb payload (`supabase/schemas/02_functions.sql:3394-3449`, as
re-verified in this wave's investigation) is exactly `{is_entitled, plan, status, resumes_used,
resumes_limit}` — no account id — and `AiEntitlementInfo`
(`src/components/atomic-crm/types.ts:879-885`) mirrors that. Resolving a real `account_id`
pre-route would cost an extra DB round trip the limiter — whose entire point is to be cheap and
run before expensive work — should not pay. `sub` (the Supabase user id) is already present,
unverified-decode-only, in the same Authorization header the entitlement gate is about to verify
cryptographically one middleware later; decoding it again for a bucket key is safe because a
forged `sub` only earns an attacker their own separate bucket, never someone else's, and the
IP-scoped limiter sits underneath it regardless. It is arguably the more correct dimension for a
short-window abuse control besides: a household account can have multiple members, and a per-user
(not per-account) short-window bucket is what actually distinguishes "one abusive client" from "a
household sharing a NAT" — the true per-account ceiling is the separate monthly quota Findings 6/7
own.

**Rejected:** re-deriving `account_id` via an extra `current_context_id()`-scoped query inside the
new middleware (adds a DB round trip to every request before the entitlement gate has even run);
widening `ai_entitlement()`'s return shape to add `account_id` (out of this story's path
ownership, disproportionate to the ask).

**Divergence this creates from the plain reading of "per-account":** the limiter is, precisely,
per-*caller*, not per-*account*. This is a deliberate, argued substitution — see "What this does
NOT guarantee" below.

### Q3 — Telling "unconfigured here" apart from "misconfigured in production"

**Decision:** an explicit, non-inferred environment marker — a Worker **secret**
`RATE_LIMITING_ENFORCED` (not a `wrangler.toml` `[vars]` entry), pushed only where `deploy.yml`
pushes it.

    checkRateLimit({ binding, key, enforced }):
      binding undefined, enforced truthy  -> refuse (limiter_error)   // misconfigured deploy
      binding undefined, enforced falsy   -> allow                    // genuinely not configured here
      binding present, .limit() resolves  -> honor { success }
      binding present, .limit() throws    -> always refuse (limiter_error), regardless of `enforced`

**Why:** inferring "configured" from binding presence alone cannot tell a dropped
`[[ratelimits]]` block in `wrangler.toml` apart from "this environment was never meant to enforce
limits" — both look like `undefined`. A second, independently-sourced signal is required to break
that tie. Pushing it as a Worker secret (mirroring the existing `SUPABASE_PUBLISHABLE_KEY` push
step in `deploy.yml`) means it is present in the deployed environment unconditionally on every
successful deploy, and structurally cannot exist in `wrangler dev` or the Node vitest project
unless someone deliberately provisions it there.

**Rejected:** a `[vars] RATE_LIMITING_ENFORCED = "true"` entry directly in `wrangler.toml` — simpler,
but `wrangler dev` reads the same file, so local dev would only avoid the fail-closed path if
`wrangler dev` also simulates `[[ratelimits]]` locally, which this design could not verify without
network access (flagged as a risk below, not assumed). Inferring purely from binding presence —
fails the "a production misconfiguration must not silently disable enforcement" requirement
outright.

**Where it is pushed (Q3/Q7):** `.github/workflows/deploy.yml`, a new, unconditional Worker-secret
push step for the `ai` and `parse` legs only (`matrix.worker == 'ai' || matrix.worker == 'parse'`),
gated only on `IS_CLOUDFLARE_CONFIGURED` — mirroring the existing `SUPABASE_PUBLISHABLE_KEY` step's
own conditional. Needs no GitHub repo secret (the pushed value is not sensitive), so it needs no
"secret not set" warning branch the way the AI Gateway trio does.

### Q4 — Tracing: log level, and what identifies the caller without logging PII

**Decision:** `console.warn` for the routine, every-request trace line; `console.error` reserved
for actual failures (limiter threw, unhandled route error) — following the two-tier split already
present in this codebase (`console.error` inside `catch` blocks in `ingest/resolveAccount.ts`,
`ingest/index.ts`, `share/index.ts`, `parseIdempotency.ts`; `console.warn` for routine operational
logging in `cron/index.ts`'s per-tick heartbeat and `ingest/attachments.ts`). A per-request trace
line is the same shape as the cron heartbeat — expected, high-volume, not a failure — so using
`console.error` for it would misrepresent every successful request as an error in Cloudflare's
Logs view.

Caller identification in the trace line: the first 8 characters of the same `deriveCallerKey()`
value used for rate limiting (the JWT `sub`, itself a UUID, never a name/email/JWT), never the
full value — enough to grep-correlate lines from one incident/session without printing a complete
durable identifier in every log line.

**Rejected:** a dedicated logging library (a new dependency and a new pattern this repo's Workers
have never used — the local precedent is plain `console.error`/`console.warn` to stdout, captured
by Cloudflare's Logs/`wrangler tail`); logging the full `sub` (defensible, but unnecessarily
generous given the "never log PII" instruction); hashing the `sub` (adds a crypto step for no gain
over truncation, since the goal is correlation within one incident, not long-term analytics).

### Q5 — Response caching: scope, key, and TTL

**Superseded — see "Resolution note: C1" above.** What follows is the ORIGINAL design as approved
in this wave; it was implemented, then reverted after an adversarial review found the key
insufficient (C1, P1, ship-blocking). It is kept here, marked superseded rather than deleted, so
the reasoning that turned out to be wrong is visible rather than quietly erased — a later change
that considers re-adding a `/dossier` cache should read this section first.

**Original decision:** an account-namespaced response cache for `/dossier` **only**, key
`{accountId}/{shidduchim_id}`, TTL 120 seconds. `/parse` was deliberately not covered — see the
unchanged reasoning below, which still holds regardless of the cache-key finding.

**What was wrong with it:** the key's only dimension was `accountId`. `reference_links_summary`
(`03_views.sql`, `security_invoker = on`) is scoped by more than account — `reference_links`'s own
RLS policy additionally denies the `single` role outright, a second, independent dimension the
cache key never captured. Two members of one account with different roles therefore collided on
one key while RLS gave them genuinely different rows underneath it. Re-keying by role (rather than
dropping the cache) was considered and rejected for the fix: `reference_links`/`references` are the
two tables in this domain that use a blanket role-based deny rather than the finer, per-member
"two-policy" pattern already used on `shidduchim`/`singles`/`resumes`/`shidduch_schools` (migration
`20260730162943_single_role_row_scoping.sql`) — if that pattern ever reaches `reference_links`, a
role-keyed cache would start leaking again, member-to-member, with nothing to notice the assumption
had broken. A cache key would have to duplicate whatever RLS considers "the same viewer" indefinitely,
which is a standing coupling this fix chose not to accept for a query this cheap.

**Why removing the cache is an acceptable trade, not just an emergency patch:** the query it was
guarding is a single indexed `SELECT` on `reference_links_summary`, not an inference call —
`/dossier` never touches the AI Gateway (see Finding 12's fix, `dossierNarrator.ts`). The cost this
cache amortized was materially smaller than the cost `DOSSIER_USER_RATE_LIMIT` (30/60s per caller)
already exists to bound. Removing the cache also removed the `current_context_id()` round trip that
existed solely to build the cache key (`resolveAccountId`, deleted with it) — a net latency
improvement, not merely a risk removal.

**Why 120 seconds, not a content fingerprint (still true, kept for the historical record):**
`public.reference_links` (`supabase/schemas/01_tables.sql:664-679`) has no `updated_at` column, and
its editable fields (`call_status`, `what_they_said`, `conversation_log`, `relationship_override`)
can change after `created_at` without any accompanying timestamp changing — so there was no cheap,
reliable fingerprint to put in the key without a DB read that would have defeated the point of
caching. This reasoning is moot now that there is no cache, but it explains why a fingerprint-based
fix was never on the table as an alternative to dropping the cache.

**Rejected (original design):** covering `/parse` too (no cost/latency motivation — `/parse`
always does real, billable model work on a cache miss and is capped by the monthly quota, not
repeat-open frequency); a 24h TTL matching parse's (would make the dossier visibly stale after "log
a call, immediately go check the dossier" — a real product flow); write-path invalidation on a
logged call (needs a schema addition and frontend wiring, both out of this story's scope).

**Current decision (post-fix):** no response cache for `/dossier`. `workers/ai/index.ts` queries
`reference_links_summary` on every request; RLS is the only mechanism responsible for per-caller
isolation, which removes the "RLS AND a Worker-side cache key must independently agree" coupling
that produced C1. `workers/shared/responseCache.ts` — the generic cache primitive this design
introduced, whose only consumer was `/dossier` — was deleted along with its test file rather than
left as dead code.

### Q6 — File layout

**Decision:** three new shared modules under `workers/shared/`:

| File | Contents |
|---|---|
| `callerIdentity.ts` | Pure key-derivation helpers (`deriveCallerKey`, `deriveIpKey`), no Hono/env dependency |
| `rateLimit.ts` | Named limit constants, `checkRateLimit`, `createRateLimitMiddleware` — imports `callerIdentity.ts` |
| `requestTracing.ts` | Tracing middleware — also imports `deriveCallerKey` for its redacted caller-key field |

`workers/ai/dossierCache.ts` lives **under `workers/ai/`**, not `workers/shared/` — it is
`/dossier`-specific, mirroring how `workers/parse/parseIdempotency.ts` is worker-local rather than
shared. (Moot post-fix: no `/dossier` cache module exists at all any more — see "Resolution note:
C1" above.)

**Why split into three files rather than one `abuseControls.ts`:** keeps each file within the
~200–400-line typical ceiling (`.claude/rules/coding-style.md`) and avoids `rateLimit.ts` and
`requestTracing.ts` importing from each other for one shared helper. Mirrors this repo's own
precedent of splitting `parseIdempotency.ts` out of `workers/parse/index.ts` once a single file
would have crossed that ceiling.

## Constants this design names

Rate limits (each a named constant in `workers/shared/rateLimit.ts`):

| Constant | Limit | Dimension | Registered | Purpose |
|---|---|---|---|---|
| `AI_WORKER_IP_RATE_LIMIT` | 20 / 10s | `CF-Connecting-IP` | Both workers, blanket `app.use("*", ...)` before `requireAiEntitlement` | Stop pre-auth/scripted hammering before any auth work, including hammering that would otherwise burn `ai_entitlement()` RPC calls |
| `PARSE_USER_RATE_LIMIT` | 10 / 60s | Caller `sub` | `workers/parse`, after the entitlement gate | Speed bump on top of the monthly 100-resume cap — not a substitute for it |
| `DOSSIER_USER_RATE_LIMIT` | 30 / 60s | Caller `sub` | `workers/ai`, after the entitlement gate | More generous than parse: `/dossier` is read-only and makes no model call |

Four bindings total (`PARSE_USER_RATE_LIMITER`, `PARSE_IP_RATE_LIMITER` in
`workers/parse/wrangler.toml`; `AI_USER_RATE_LIMITER`, `AI_IP_RATE_LIMITER` in
`workers/ai/wrangler.toml`) — Cloudflare's `simple` config is one limit/period pair per binding, so
the IP and caller dimensions need separate bindings.

Caching: none. `DOSSIER_CACHE_TTL_SECONDS` and `workers/ai/dossierCache.ts` were part of the
original Q5 design; see "Resolution note: C1" above for why no `/dossier` response cache exists in
the current code.

Refusal statuses: `429` (`Retry-After` derived from the binding's `periodSeconds`) for
`over_limit`; `503` for `limiter_error` (the limiter itself is unavailable — not the caller's
fault).

## Recommended middleware order

CORS → tracing → IP-scoped rate limit → `requireAiEntitlement` → user-scoped rate limit → route.
Tracing after CORS so `hono/cors`'s own `OPTIONS` short-circuit never pollutes the trace log with
preflights; tracing before both rate limiters and the entitlement gate so every real request gets
one trace line regardless of which stage refuses it. This ordering is a recommendation to the
implementing agent, not independently confirmed by this document against the merged tree.

## Test injection

Same shape as this codebase's existing fakes: `checkRateLimit` is a bare exported async function,
testable with zero Hono context (`checkRateLimit({ binding: { limit: vi.fn()... }, key, enforced })`).
For full-app tests, the `env` object passed to `app.request(url, init, env)` gains optional keys
per binding and `RATE_LIMITING_ENFORCED`; existing tests that never set either continue to exercise
the "not configured here, fail open" branch unmodified — no existing test file needs to change for
this reason alone.

## What this does NOT guarantee

This section is required reading before treating Finding 16 as fully closed by this story alone.

- **The rate limiter is approximate, not exact.** Cloudflare's `[[ratelimits]]` binding is
  per-colo and best-effort; a distributed attacker hitting multiple edge locations can exceed the
  nominal limit by some multiple of the colo count. This is accepted by design (see Q1) because the
  limiter's job is to be a cheap abuse speed bump, not the authoritative cap — the authoritative
  monthly cap is the sibling atomic DB reservation (Findings 6/7), which this story does not
  redesign.
- **"Per-account" is actually "per-caller."** The caller-scoped limiter keys on the JWT `sub`
  (Q2), not on `account_id`, because `ai_entitlement()` never returns one and re-deriving it would
  cost every request a DB round trip before the limiter even runs. A household with several
  members therefore gets several independent buckets, not one shared account-wide bucket. This is
  a deliberate, argued substitution, not an oversight — but it is a real divergence from a literal
  reading of "per-account rate limiting" and should be read as such.
- **Fail-closed via `RATE_LIMITING_ENFORCED` depends on local/CI dev never provisioning that
  secret.** If a future change accidentally sets it in `wrangler dev` or a test environment, the
  fail-closed branch would fire where it shouldn't. Nothing in this design adds a guard against
  that beyond "don't do that."
- **Whether `wrangler dev` (this repo's installed version) simulates `[[ratelimits]]` bindings
  locally was not verified** — this design's Q3 answer is constructed specifically so it does not
  need to know that answer (the secret, not the binding, is the enforcement signal), but the
  binding's local behavior itself remains unconfirmed.
- **Account-level Cloudflare plan support for the Rate Limiting binding, and the exact
  provisioning semantics of `namespace_id`, were not verified against the live Cloudflare
  dashboard** (no network access during design). The wrangler config schema and the `RateLimit`
  TypeScript interface were confirmed directly from the installed `wrangler`/
  `@cloudflare/workers-types` packages, which is strong evidence the *syntax* is right; it is not
  evidence the account's plan has the feature enabled.
- **Superseded — there is no `/dossier` cache, so no staleness window.** This bullet originally
  read "the `/dossier` cache can serve up to 120 seconds of staleness"; the cache it described was
  removed (see "Resolution note: C1" above), so every `/dossier` response is now computed fresh, at
  the cost of one extra indexed `SELECT` per open that a cache hit would previously have skipped.
- **No numeric constant here (rate-limit thresholds, cache TTL) is derived from measured
  production traffic.** Each is named and justified against the described product usage pattern
  (a household parsing a handful of resumes a day; occasional deliberate dossier review — see the
  design decisions above) and is intentionally conservative-but-generous, not data-derived, because
  no measured data exists yet for these two endpoints.
- **Tracing goes to Cloudflare's own Logs / `wrangler tail` only.** There is no external log sink,
  no persisted or queryable trace store, and no correlation across the two Workers beyond what a
  human reading both logs' truncated caller-key prefixes can do by eye. This is deliberately
  narrower than a full observability stack, which Finding 16 did not ask for ("these controls need
  an owning story and acceptance criteria," not a new observability platform) but is worth naming
  as a residual gap for a later story if request-level tracing across Workers is ever needed for
  more than incident correlation.
- **This story does not touch `ai_usage`, the meter, or Findings 6/7/8.** A reader who takes this
  document as evidence that the *quota* is now atomic and race-free would be wrong — that is a
  separate, sibling change. See "Position in Epic 11" above.

## Files (as specified by the approved design — not independently confirmed against the merged tree)

New (as originally designed):
- `workers/shared/callerIdentity.ts` (+ `.test.ts`)
- `workers/shared/rateLimit.ts` (+ `.test.ts`)
- `workers/shared/requestTracing.ts` (+ `.test.ts`)
- `workers/ai/dossierCache.ts` (+ `.test.ts`) — **never created.** The implementing agent built the
  same mechanism as `workers/shared/responseCache.ts` instead (a deliberate, flagged divergence from
  this file placement — see that module's own header comment), which the C1 fix subsequently
  deleted entirely, along with its test file. Neither `dossierCache.ts` nor `responseCache.ts`
  exists in the current tree.

Touched:
- `workers/parse/wrangler.toml` (two new `[[ratelimits]]` blocks)
- `workers/ai/wrangler.toml` (two new `[[ratelimits]]` blocks)
- `workers/parse/index.ts` (wire IP + user rate limits, tracing middleware, `traceOutcome` calls)
- `workers/ai/index.ts` (wire IP + user rate limits, tracing middleware, `traceOutcome` calls; a
  `/dossier` response cache was wired in against the original Q5 design, then removed by the C1 fix
  — see "Resolution note: C1" above)
- `.github/workflows/deploy.yml` (one new `RATE_LIMITING_ENFORCED` secret-push step for the `ai`/
  `parse` legs)

This list is this story's design intent, not a verified diff. The implementing agent's own file
list, once that work lands, is the authoritative record — this document should be treated as the
design this wave approved, not as proof of what was actually written.

## Testing standard

AAA, descriptive names, no shared mutable state (`.claude/rules/testing.md`). No test should
depend on a live Cloudflare Rate Limiting binding — faked via injected `env` bindings, matching how
`resumeExtractor` is already tested in this codebase. Per this story's own acceptance criteria,
tests should cover at minimum: binding absent + enforced → refused; binding absent + not enforced →
allowed; binding present and throwing → always refused regardless of `enforced`; a trace line never
contains resume/dossier content or the full JWT.

**Superseded by the C1 fix:** the last item in this list as originally written was "a `/dossier`
cache read/write pair is scoped to its account and a second account's request for the same
`shidduchim_id` never observes the first account's cached entry" — a real property of the design
that shipped, but insufficient, because it only ever tested cross-*account* isolation and never
cross-*role-within-one-account* isolation, which is exactly the dimension C1 leaked on. With the
cache removed, the equivalent test is now: two requests for the same `shidduchim_id`, same account,
mocked to receive different `reference_links_summary` row sets (standing in for two different
roles' RLS-scoped views), must each see only their own call's data, in both orderings — see
`workers/ai/index.test.ts`'s "cross-role isolation within one account (C1 — Finding 16 follow-up)"
describe block.

## References

- [Source: _bmad-output/epic-11-adversarial-review-report-2026-08-04.md, Finding 16]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-11.4]
- [Source: 11-1-server-side-entitlement-on-inference.md — the gate, `requireAiEntitlement`,
  `c.get("supabaseCaller")`/`c.get("aiEntitlement")`, and the `BaseEnv`/`wrangler.toml` shape this
  story's bindings and secret join]
- [Source: 11-2-resume-auto-parse-review.md — `workers/parse/parseIdempotency.ts`'s Cache-API
  pattern, the precedent this story's `dossierCache.ts` and cross-cache-key isolation follow]
- [Source: 11-3-diligence-dossier.md — `POST /dossier`'s current shape in `workers/ai/index.ts`,
  the route this story wraps with tracing, rate limiting and caching; also states the same "AD-8
  tracing/caching gap" this story exists to close]
- [Source: supabase/schemas/02_functions.sql:3394-3449 — `ai_entitlement()`'s return shape,
  confirming no `account_id` is available to a Worker without a further query (Q2)]
- [Source: supabase/schemas/01_tables.sql:664-679 — `reference_links`, confirming no `updated_at`
  column exists (Q5)]
- [Source: node_modules/wrangler/config-schema.json (installed wrangler 4.113.0) — the
  `[[ratelimits]]` top-level array schema this design targets]
- [Source: node_modules/@cloudflare/workers-types (installed) — the `RateLimit` interface's
  `limit(options): Promise<{ success }>` surface]

## Verification status

This document was authored by an agent whose declared scope in this wave was documentation only
(`_bmad-output/planning-artifacts/epics.md`, this file, and the review report's Resolution
section) — it did not create or edit any file under `workers/`, `supabase/`, or
`.github/workflows/`. Nothing above should be read as a claim that the described code exists,
compiles, passes its tests, or has been deployed. The design decisions, rejected alternatives, and
constants recorded here are the wave's *approved* design, provided to this agent as input; whether
the implementing agent's actual code matches this design, and whether `make typecheck`, `make
lint`, and the relevant test suites pass against it, must be confirmed by this wave's
cross-reconciliation pass and verification phase, not inferred from this document.
