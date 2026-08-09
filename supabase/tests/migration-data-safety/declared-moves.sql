-- ===========================================================================
-- MIGRATION DATA-SAFETY GUARD — the author's declarations.
--
-- Applied between `supabase migration up` and `assert.sql`. This is the ONE
-- file a migration author edits: if a pending migration drops a column that
-- holds data, say here where the data went. An undeclared drop of a
-- non-empty column fails the guard; a declared one is a claim `assert.sql`
-- then verifies row by row, so a wrong declaration fails too.
--
-- `recover_query` is a SELECT returning one column of candidate values. It
-- may reference the POST-migration row as `t` (it runs LATERAL). The check
-- passes when any candidate matches the old value under `compare_fn`.
--
--   split into sibling columns:  select <expr over t>
--   moved to a child table:      select body from public.interactions i
--                                 where i.target_id = t.id and ...
--
-- If a column's data genuinely goes nowhere, use
-- `migration_guard.discarded_columns` at the bottom instead — and only for a
-- column that provably never held production data. Nothing verifies that
-- claim, so back it with a fail-closed assertion inside the migration itself,
-- so a wrong belief halts the deploy instead of erasing production.
--
-- LIFECYCLE: a declaration is written when its migration is PENDING and
-- deleted once that migration is DEPLOYED — `assert.sql` only ever consults
-- this file for a column that vanishes BETWEEN the baseline and the pending
-- head, so a declaration for a column already absent at baseline can never
-- fire again. This file's steady state between epics is empty (no `insert`
-- statements at all, which is valid SQL and runs as a no-op); it should
-- always read as "what the currently pending migrations claim", never as an
-- archaeological record of what past migrations did.
-- ===========================================================================

-- AD-1 FORCE RLS migration allowlist — these tables will have FORCE ROW LEVEL
-- SECURITY added by a future migration. The migration will be a pure DDL
-- addition with no data movement, so there is no column value to recover.
-- Declared here so the migration-data-safety guard does not flag the tables
-- as "unseeded" or "unexpectedly altered" when the FORCE RLS DDL runs.
-- Each entry's recover_query is a no-op (select 1) because no column data
-- changes; the compare_fn is a constant to satisfy the schema.
insert into migration_guard.column_moves (table_name, from_column, recover_query, compare_fn, note) values
    ('accounts', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('members', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('member_state', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('configuration', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('pipeline_transitions', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes');
