# Wave 5 Close — 2026-08-09

**Commit:** 0287f4e
**Story:** 15.4 — Rate limits on auth/magic-link/invite, signup, ingestion, share-link access

## Excursions (post-wave)
- **UNOWNED:** `workers/ai/index.ts`, `workers/analytics/index.ts`, `workers/parse/registerParseMiddleware.ts`, `workers/shared/alerting.ts`, `workers/shared/rateLimit.test.ts` — existing workers updated to provide new required `workerName` and `surface` parameters to `createRateLimitMiddleware`
- **UNCLAIMED:** Database/schema paths declared by SCOUT were overly broad — rate limiting uses Cloudflare native `[[ratelimits]]` bindings (no new tables/migrations needed), no schema changes required

## Cross-reconciliation
Single-story wave. Rate limiting implemented across 4 surfaces using Cloudflare's native `[[ratelimits]]`:
- Auth/magic-link/invite: IP-scoped, fail-open (10 req/min)
- Signup: IP-scoped, fail-closed (5 req/hour)
- Channel ingestion: IP-scoped + per-account, fail-open (50/100 req/min)
- Share-link access: IP + account + per-token, fail-closed (30/60/30 req/min)

Integrated with 15.1 alerting for limit exceeded events. Migration safety PASSED on stack 7. Rate limit config check PASSED.

## Gates
- ✅ typecheck, lint, build, all 5 guard scripts, migration-safety
- ⚠️ `make test` — pre-existing failures: 4 cron tests (missing `ctx.waitUntil` mock), 14 billing tests (missing `ExecutionContext` mock), browser tests (vitest dev server connection) — belong to Stories 12.2/12.4

## Stacks released
- STACK_ID=7 released via `make stop-supabase-e2e STACK_ID=7`