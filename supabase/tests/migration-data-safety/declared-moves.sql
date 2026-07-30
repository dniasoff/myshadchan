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
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 20260730011428_shidduch_overview_fields.sql (Story 5.2)
--
-- Replaces the single combined `parents_en`/`parents_he` pair with
-- `father_*`/`mother_*`. The migration splits every value on `' & '` before
-- it drops the old columns; the `R'` honorific is a male honorific and stays
-- with the father half, and a value with no separator goes wholly to the
-- father half.
--
-- The recovery query mirrors what the rewritten
-- `sync_shidduch_identity_signals()` trigger itself computes, so declaring it
-- here is also the statement that the identity-matching signal is unchanged
-- — the part that made the original defect worse than a dropped column.
-- `normalize_identity_text` maps `&` to a space and collapses whitespace, so
-- `R' Yaakov Rosenberg & Chaya Rosenberg` and
-- `R' Yaakov Rosenberg` + `Chaya Rosenberg` normalise to the same string.
-- ---------------------------------------------------------------------------
insert into migration_guard.column_moves (table_name, from_column, recover_query, note)
values
    (
        'shidduchim',
        'parents_en',
        $$select btrim(coalesce(t.father_en, t.father_he, '') || ' ' || coalesce(t.mother_en, t.mother_he, ''))$$,
        'Story 5.2: split on '' & '' into father_en/mother_en; honorific stays with the father half.'
    ),
    (
        'shidduchim',
        'parents_he',
        $$select btrim(coalesce(t.father_he, t.father_en, '') || ' ' || coalesce(t.mother_he, t.mother_en, ''))$$,
        'Story 5.2: split on '' & '' into father_he/mother_he; honorific stays with the father half.'
    );

-- ---------------------------------------------------------------------------
-- 20260730093837_shadchan_notes_migration.sql (Story 5.9)
--
-- Retires the free-text `shadchanim.notes` column in favour of the
-- polymorphic interactions timeline. This migration already does the right
-- thing — it copies every non-empty value into `public.interactions` BEFORE
-- the drop — so the declaration below is a verified claim, not a promise.
-- ---------------------------------------------------------------------------
insert into migration_guard.column_moves (table_name, from_column, recover_query, note)
values
    (
        'shadchanim',
        'notes',
        $$select i.body from public.interactions i
           where i.target_type = 'shadchan' and i.target_id = t.id and i.kind = 'note'$$,
        'Story 5.9 (AC 2): copied into public.interactions as an account-scoped shadchan note before the drop.'
    );

-- ---------------------------------------------------------------------------
-- 20260730041150_resume_photos.sql (Story 5.4)
--
-- `resumes.photos` was a shaped-but-unused placeholder: declared in
-- `01_tables.sql` from the start ("resume detail is Epic-3; the table is
-- shaped now"), typed `photos?: unknown` in `src/.../types.ts`, and written
-- by nothing — no component, no data-provider path, no edge function, no
-- RPC, no migration. `git grep photos origin/main -- src supabase workers`
-- returns the declaration, the type and two comments, and no writer.
--
-- So there is nothing to move, and no honest recovery query to write: the
-- jsonb shape was never fixed, so any backfill into `resume_photos` would be
-- invented rather than recovered. Declared discarded — and, because "no
-- writer in the code" is an argument and not a measurement of the production
-- table, 20260730041150 now asserts the column is empty before dropping it.
-- If that belief is wrong, the deploy halts instead of erasing.
-- ---------------------------------------------------------------------------
insert into migration_guard.discarded_columns (table_name, column_name, reason)
values
    (
        'resumes',
        'photos',
        'Story 5.4: unused placeholder column, no writer anywhere in the repo; '
        'the migration asserts it is empty before dropping it, so a wrong belief halts the deploy.'
    );
