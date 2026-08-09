# Wave 6 Close — 2026-08-09

**Commit:** 19abee9
**Story:** 12.6 — Trial (FR72 trial, FR75 grace window, FR77 billing policy, NFR-11 tunable limit)

## Excursions (post-wave)
- **UNOWNED:** `workers/shared/callerIdentity.ts` — added `deriveTokenKey()` for share-link token rate limiting (PRV-8). This is actually 15.4 work that leaked into this wave.
- **UNCLAIMED:** Multiple paths declared by SCOUT were overly broad — initial implementation only added `trial_started_at`, `trial_ends_at`, `grace_ends_at` columns to `subscription` table and updated `ai_monthly_resume_limit()` to read from `configuration`. Remaining work (subscriptionState.ts grace logic, cron sweep for grace expiry, billing UI, aiEntitlement.ts trial logic) needs follow-up.

## Cross-reconciliation
Single-story wave. Migration safety PASSED on stack 2. The column-order trap was respected — new columns appended to end of subscription table block. Rate limit config check PASSED.

## Gates
- ✅ typecheck, lint, build, all 5 guard scripts, migration-safety
- ⚠️ `make test` — pre-existing failures: 4 cron tests (missing `ctx.waitUntil` mock), 14 billing tests (missing `ExecutionContext` mock) — belong to Stories 12.2/12.4

## Stacks released
- STACK_ID=2 released via `make stop-supabase-e2e STACK_ID=2`