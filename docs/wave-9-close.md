# Wave 9 Close — 2026-08-09

**Commit:** 8b0116a
**Story:** 15.3(b) — FORCE RLS retrofit (30 tables)

## Excursions (post-wave)
- **UNOWNED:** `supabase/schemas/05_policies.sql` — FORCE RLS statements added inline after each ENABLE RLS policy; implicitly covered by the migration
- **UNCLAIMED:** `supabase/schemas/01_tables.sql` — declared but not needed (column order unchanged, no new tables)
- **UNCLAIMED:** `supabase/tests/migration-data-safety/fixture.sql` — declared but not needed (fixture captures all tables dynamically via catalog)

## Cross-reconciliation
Single-story wave. Added `ALTER TABLE ... FORCE ROW LEVEL SECURITY` for all 30 tables with RLS enabled but not forced. Migration safety PASSED on stack 5 (assert phase). The declared-moves.sql expanded from 5 to 30 entries with no-op recover_query (pure DDL).

## Gates
- ✅ typecheck, lint, build, all 5 guard scripts, migration-safety
- ⚠️ `make test` — pre-existing failures: 4 cron tests (missing `ctx.waitUntil` mock), 14 billing tests (missing `ExecutionContext` mock), browser tests (vitest dev server connection) — belong to Stories 12.2/12.4

## Stacks released
- STACK_ID=5 released via `make stop-supabase-e2e STACK_ID=5`