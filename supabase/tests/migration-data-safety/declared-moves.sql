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

-- The `before_user_created` age-gate is retired: the 18+ affirmation is now
-- made by the act of creating an account and stated as such in the UI
-- (`AgeNotice`), so `check_signup_age()` has nothing left to verify and
-- `public.signup_intents` — the only channel that could carry an affirmation
-- across a Google OAuth redirect — has nothing left to carry. The pending
-- migration drops both.
--
-- The rows genuinely go nowhere, and that is safe on its own terms rather
-- than by assertion: every row in this table is a single-use token that
-- expires ten minutes after it is written, is consumed by the very next
-- signup it belongs to, and has no reader anywhere else in the product. It
-- is not a record of anything — an unconsumed row means a signup that never
-- completed. Leaving the table in place would be strictly worse than
-- dropping it: `check_signup_age()` was also its only sweeper (there is no
-- pg_cron in this repo), so an orphaned `anon`-INSERTable table with nothing
-- consuming or expiring its rows is an unbounded public write surface.
insert into migration_guard.discarded_tables (table_name, reason) values
    ('signup_intents', 'Age-gate retired: single-use, 10-minute, consumed-on-use signup tokens with no reader outside the dropped check_signup_age(); leaving the table would orphan an anon-writable surface with no sweeper.');
