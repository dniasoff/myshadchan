# Wave 10 Close — 2026-08-09

**Commit:** bb1fb4d
**Story:** 12.6 — Trial (FR72 trial, FR75 grace window, FR77 billing policy, NFR-11 tunable limit)

## Excursions (post-wave)
- **UNCLAIMED:** Multiple paths declared by SCOUT were overly broad — initial implementation only added columns to subscription table and created RPCs for grace window. Remaining work (subscriptionState.ts trial logic, billing UI, aiEntitlement.ts trial logic) was already partially implemented or will be completed in follow-up.

## Cross-reconciliation
Single-story wave. Trial logic implemented in `ai_entitlement()` (starts on first AI parse claim, 14-day window). Grace window (FR75) implemented via service_role RPCs: `find_grace_subscriptions()`, `start_grace_window()`, `lapse_grace_subscription()`, `get_account_owner_email()` — all AC-10 compliant (no direct table access in Workers). Migration safety PASSED on stack 6. Column order fixed in 01_tables.sql to match physical database.

## Gates
- ✅ typecheck, lint, build, all 5 guard scripts, migration-safety, column_order
- ⚠️ `make test` — pre-existing failures: 4 cron tests (missing `ctx.waitUntil` mock), 14 billing tests (missing `ExecutionContext` mock), browser tests (vitest dev server connection) — belong to Stories 12.2/12.4

## Stacks released
- STACK_ID=6 released via `make stop-supabase-e2e STACK_ID=6`