# Wave 1 Close — 2026-08-09

**Commit:** 5e44715
**Story:** 15.3(a) — AD-1 CI assertion (FORCE RLS check)

## Excursions (post-wave)
- **UNOWNED:** `src/components/atomic-crm/threads/usePushSubscription.test.tsx` — test timeout fix required after FORCE RLS check added; not in original manifest
- **UNCLAIMED:** `supabase/tests/migration-data-safety/fixture.sql` — declared in manifest but no modification needed (check reads schema directly)

## Cross-reconciliation
Single-story wave — items 1-3 vacuous. No missing work detected. Declared-but-unbuilt: fixture.sql (unneeded).

## Stacks released
- STACK_ID=2 released via `make stop-supabase-e2e STACK_ID=2`