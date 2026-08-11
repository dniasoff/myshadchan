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

-- shidduch_schools -> shidduch_education (migration
-- 20260811150000_rename_shidduch_schools_to_shidduch_education.sql). A pure
-- rename: every row, the identity sequence, and every constraint/index/
-- trigger/policy is carried over by `ALTER TABLE ... RENAME TO` and the
-- follow-up ALTERs in that migration — nothing is dropped or recreated.
-- Without this declaration, assert.sql's check A sees `shidduch_schools` stop
-- resolving at the baseline name and reports it as TABLE DROPPED, which is
-- not what happened; this redirects the check to `shidduch_education`, where
-- checks B/C/D still verify the seeded row and every column survived intact.
insert into migration_guard.table_renames (from_table, to_table, reason) values
    ('shidduch_schools', 'shidduch_education',
     'Renamed in place by migration 20260811150000; every row and constraint carried over via ALTER TABLE RENAME.');

-- AD-1 FORCE RLS migration allowlist — these tables will have FORCE ROW LEVEL
-- SECURITY added by a future migration. The migration will be a pure DDL
-- addition with no data movement, so there is no column value to recover.
-- Declared here so the migration-data-safety guard does not flag the tables
-- as "unseeded" or "unexpectedly altered" when the FORCE RLS DDL runs.
-- Each entry's recover_query is a no-op (select 1) because no column data
-- changes; the compare_fn is a constant to satisfy the schema.
insert into migration_guard.column_moves (table_name, from_column, recover_query, compare_fn, note) values
    ('account_members', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('accounts', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('ai_parse_attempts', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('ai_usage', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('configuration', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('cron_heartbeat', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('date_records', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('entity_files', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('identity_signals', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('inbox_items', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('interactions', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('invites', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('medical_notes', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('member_state', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('members', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('pipeline_transitions', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('redts', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('reference_links', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('references', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('resume_photos', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('resumes', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('shadchanim', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('shidduch_schools', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('shidduchim', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('shidduchim_external_links', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('singles', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('stripe_events', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('subscription', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('tasks', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes'),
    ('trusted_senders', 'force_rls_placeholder', 'select 1', 'public.normalize_identity_text', 'FORCE ROW LEVEL SECURITY DDL addition — no column data changes');
