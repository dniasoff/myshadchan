# Resume re-read ledger

Migration `20261113150000_ai_reread_attempts.sql` adds the empty,
service-role-only `ai_reread_attempts` idempotency/quota ledger and its three
claim, complete and release RPCs. It does not rewrite existing resume content,
parse attempts or usage rows; the worker changes only a resume's additional
sections and schema marker after a compare-and-set.

Rollback is a forward, approved database operation: drop the three new RPCs,
the partial index and `ai_reread_attempts`. No existing data is changed by the
migration, so rollback has no data backfill. Do not manually edit an applied
migration or run this rollback against production without the deploy owner.
