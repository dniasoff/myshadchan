# Story 15.4: NFR-13, on the four surfaces that have nothing *(blocks launch)*

Status: ready-for-dev

## Story

As the platform owner,
I want every abuse-prone surface bounded, not just the expensive one,
So that the cheap surfaces are not the way in.

## Acceptance Criteria

1. **Given** auth / magic-link / invite, signup, channel ingestion, and share-link access
   **When** any is hit repeatedly
   **Then** each is rate-limited per account **and** per IP, reusing `workers/shared/rateLimit.ts` rather than growing a second limiter

2. **And** a limiter that is unavailable or throws refuses the request on the paid AI paths and on share-link access, and degrades openly elsewhere — the same fail-closed/fail-open split Story 11.4 already reasoned through, restated per surface rather than assumed

3. **And** share-link access additionally bounds *per token*, because PRV-8 sells "revocable, expiring, access-logged" and an unbounded bearer token is a scrapeable surface however well logged

4. **And** each limit is observable in Story 15.1's alerting when it starts firing, since a limiter firing constantly is either an attack or a limit set wrong, and both need a human.

## Tasks / Subtasks

- [ ] Task 1: Add rate limiting to auth/magic-link/invite surfaces (AC: 1, 2)
  - [ ] 1.1 Identify the Supabase Auth Edge Function endpoints that handle magic-link, invite, and signup
  - [ ] 1.2 Add Cloudflare `[[ratelimits]]` bindings to the relevant wrangler.toml (or create new Edge Function wrapper Workers)
  - [ ] 1.3 Apply `createRateLimitMiddleware` with IP-scoped and caller-scoped (where authenticated) limiters
  - [ ] 1.4 Configure fail-open for auth surfaces (not paid paths)

- [ ] Task 2: Add rate limiting to channel ingestion Worker (AC: 1, 2)
  - [ ] 2.1 Add `[[ratelimits]]` bindings to `workers/ingest/wrangler.toml` (IP-scoped and per-account)
  - [ ] 2.2 Apply `createRateLimitMiddleware` to the ingest Worker's email handler entry point
  - [ ] 2.3 Configure fail-open for ingestion (not a paid path)

- [ ] Task 3: Add rate limiting to share-link access Worker (AC: 1, 2, 3)
  - [ ] 3.1 Add `[[ratelimits]]` bindings to `workers/share/wrangler.toml` (IP-scoped, per-account, and per-token)
  - [ ] 3.2 Apply `createRateLimitMiddleware` to both `/r/:token` and `/r/:token/file/:fileKey` routes
  - [ ] 3.3 Implement per-token bucket key derivation using the share token from the path
  - [ ] 3.4 Configure fail-closed for share-link access (PRV-8 paid path)

- [ ] Task 4: Integrate rate limit firing with Story 15.1 alerting (AC: 4)
  - [ ] 4.1 Extend `workers/shared/alerting.ts` with a `alertOnRateLimit` function
  - [ ] 4.2 Hook rate limit refusals in `createRateLimitMiddleware` to emit alerts when a limiter fires
  - [ ] 4.3 Ensure alert includes limiter name, key prefix, and surface context

- [ ] Task 5: Add tests for all four surfaces
  - [ ] 5.1 Unit tests for new limiter configurations in `workers/shared/rateLimit.test.ts`
  - [ ] 5.2 Integration tests for each Worker's rate limit middleware order
  - [ ] 5.3 Negative tests proving fail-closed on share-link and fail-open on auth/ingestion
  - [ ] 5.4 Alert emission tests for rate limit firing

## Dev Notes

### Relevant Architecture Patterns and Constraints

**AD-17 (Abuse Prevention & Rate Limiting)** - This is the governing architecture decision:
- Per-account AND per-IP limits on: AI/parse pipeline, auth/magic-link/invite, channel ingestion, share-link access, signup
- Mechanism: Cloudflare WAF rate-rules + Turnstile at edge + Upstash Redis token-bucket for app-level per-account limits
- **Fail-closed on paid AI paths** (this story extends this to share-link access per PRV-8)

**AD-7 (Compute Home)** - All server-side work runs as Cloudflare Workers:
- SPA on Vercel, CRUD via dataProvider → Supabase PostgREST (RLS)
- All other server work (webhooks, REST, AI orchestration, share render, cron, billing, email-in) runs as Cloudflare Workers
- Workers touch tenant tables ONLY via `forAccount(accountId)` scoped client

**AD-8 (AI Gateway)** - Every AI call goes through Cloudflare AI Gateway, traced, cost-cached

**NFR-14 (Greenfield Standard)** - No backwards compatibility, no deprecation shims, no fallbacks, no aliased views or columns. One code path per behaviour.

### Source Tree Components to Touch

**Existing rate limiting infrastructure (reuse, don't rewrite):**
- `workers/shared/rateLimit.ts` - Core rate limiting middleware and logic (315 lines)
- `workers/shared/callerIdentity.ts` - Key derivation for IP and caller keys
- `workers/shared/alerting.ts` - Alerting infrastructure (needs extension for rate limit alerts)
- `workers/shared/createApp.ts` - Worker app factory with security headers

**Workers needing rate limiting (four surfaces):**
1. **Auth/Magic-link/Invite/Signup** - Currently handled by Supabase Auth directly; may need Edge Function wrappers or Workers
2. **Channel Ingestion** - `workers/ingest/index.ts` (email handler entry point)
3. **Share-link Access** - `workers/share/index.ts` (two routes: `/r/:token` and `/r/:token/file/:fileKey`)
4. **Signup** - Part of auth flow

**Worker configurations to update:**
- `workers/ingest/wrangler.toml` - Add `[[ratelimits]]` bindings
- `workers/share/wrangler.toml` - Add `[[ratelimits]]` bindings (three: IP, account, token)
- Potentially new Workers or Edge Function wrappers for auth surfaces

### Testing Standards Summary

- ≥80% new-code coverage (per Architecture Conventions)
- AAA pattern (Arrange, Act, Assert)
- Playwright deterministic waits for E2E
- **RLS test suite per table** (incl. cross-account attempts from a Worker)
- FakeRest fixtures updated per resource
- Unit tests in `*.test.ts` alongside source files
- Vitest for unit tests, Playwright for E2E

### Rate Limiting Implementation Details

**Existing `rateLimit.ts` patterns to follow:**
- Uses Cloudflare native `[[ratelimits]]` bindings (not Upstash directly for the speed-bump layer)
- Two-dimensional limiting: IP-scoped (pre-auth) + caller-scoped (post-auth)
- `RATE_LIMITING_ENFORCED` marker in `[vars]` determines fail-closed vs fail-open
- Decision table:
  | binding | enforced | outcome |
  |---------|----------|---------|
  | undefined | false | allowed (not configured) |
  | undefined | true | refused, limiter_error (misconfigured deploy) |
  | present, success=true | any | allowed |
  | present, success=false | any | refused, over_limit |
  | present, throws | any | refused, limiter_error (ALWAYS) |

**Key constants from `rateLimit.ts`:**
- `AI_WORKER_IP_RATE_LIMIT`: 20 req / 10s (pre-auth backstop)
- `PARSE_USER_RATE_LIMIT`: 10 req / 60s (post-auth backstop for parse)
- `DOSSIER_USER_RATE_LIMIT`: 30 req / 60s (post-auth backstop for dossier)

**For the four new surfaces, suggest similar configs:**
- Auth/IP: 10 req / 60s per IP (magic-link/invite enumeration protection)
- Auth/Account: 5 req / 60s per account (signup abuse)
- Ingestion/IP: 50 req / 60s per IP (email flooding)
- Ingestion/Account: 100 req / 60s per account (channel flooding)
- Share/IP: 30 req / 60s per IP (scraping)
- Share/Account: 60 req / 60s per account
- Share/Token: 20 req / 60s per token (PRV-8 requirement)

### Alerting Integration

**Story 15.1 alerting** (`workers/shared/alerting.ts`) provides:
- `alertOnError` - emits alerts for errors with context (release, route, requestId, accountId, worker, surface)
- `alertOnSilence` - alerts on absence of expected activity
- `createErrorAlerter` - factory for route-scoped error alerters

**Need to add:**
- `alertOnRateLimit` - emits alert when a rate limiter fires
- Hook in `createRateLimitMiddleware` to call alerting on `over_limit` and `limiter_error` refusals
- Alert payload should include: limiterName, key prefix (truncated), surface, worker, route

### Fail-Closed / Fail-Open Split (from Story 11.4, restated per surface)

| Surface | Paid Path? | Fail Behavior |
|---------|------------|---------------|
| Auth/Magic-link/Invite | No | Fail-open (degrade openly) |
| Signup | No | Fail-open |
| Channel Ingestion | No | Fail-open |
| Share-link Access | **Yes (PRV-8)** | **Fail-closed** |
| AI Parse/Dossier (existing) | Yes | Fail-closed |

**Rationale:** Share-link access is a paid path because PRV-8 sells "revocable, expiring, access-logged" access — an unbounded bearer token is a scrapeable surface. If the limiter is unavailable, we must refuse rather than allow unlimited scraping.

### Per-Token Rate Limiting for Share Links

The share Worker (`workers/share/index.ts`) has two routes:
1. `GET /r/:token` - profile view
2. `GET /r/:token/file/:fileKey` - proxied file stream

Both resolve the token via `resolveShareLink()` which returns `ShareLinkRow` with `id`, `account_id`, `single_id`, `token`.

**Per-token key derivation:** Use the share token itself as the bucket key (e.g., `token:<share_token>`). This bounds each issued link independently.

**Implementation approach:**
- Create a `deriveTokenKey` helper in `callerIdentity.ts` or inline in share Worker
- Apply a third `createRateLimitMiddleware` instance with the token key
- Configure with its own `[[ratelimits]]` binding in `wrangler.toml`

### Middleware Order (Critical)

Following the existing pattern in `workers/parse/registerParseMiddleware.ts` and `workers/ai/index.ts`:
1. CORS
2. Tracing (`requestTracing.ts`)
3. **IP-scoped rate limiter** (pre-auth backstop)
4. Auth/Entitlement gate (where applicable)
5. **Caller-scoped rate limiter** (post-auth backstop)
6. **Token-scoped rate limiter** (share links only)
7. Route handlers

**Health endpoint** (`/health`) is always bypassed (see `createRateLimitMiddleware` line 287-289).

### References

- [Source: Architecture AD-17] Abuse prevention & rate limiting on every expensive or abuse-prone surface
- [Source: Architecture AD-7] Compute home = Cloudflare Workers; tenant access only via trusted-root scoped client
- [Source: workers/shared/rateLimit.ts] Core rate limiting middleware with fail-closed/fail-open decision table
- [Source: workers/shared/callerIdentity.ts] Key derivation for IP and caller keys
- [Source: workers/shared/alerting.ts] Alerting infrastructure for error and silence alerts
- [Source: workers/parse/wrangler.toml] Example `[[ratelimits]]` bindings and `RATE_LIMITING_ENFORCED` var
- [Source: workers/ai/wrangler.toml] Example dual bindings (IP + caller) for AI Workers
- [Source: workers/ingest/index.ts] Channel ingestion Worker entry point
- [Source: workers/share/index.ts] Share-link access Worker with two routes
- [Source: Epics.md Story 11.4] AI Workers rate limiting implementation (precedent)
- [Source: Epics.md Story 15.1] Alerting requirement that rate limits must integrate with
- [Source: PRV-8] Revocable, expiring, access-logged share links require per-token bounding

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List