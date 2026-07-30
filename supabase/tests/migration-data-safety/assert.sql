-- ===========================================================================
-- MIGRATION DATA-SAFETY GUARD — part 2 of 2: the assertions.
--
-- Run after `supabase migration up` has applied the pending migrations on top
-- of the fixture. Compares the live tables against the snapshot `fixture.sql`
-- took at the production schema and raises ONE exception listing every
-- surviving row, value and column the pending migrations destroyed.
--
-- Four checks, in increasing order of subtlety:
--
--   A. the table still exists;
--   B. every seeded row still exists (the `member_state` shape: correct DDL,
--      no backfill, HTTP 200 with zero rows on every surface);
--   C. every value in a SURVIVING column is unchanged, unless declared in
--      `migration_guard.expected_rewrites`. This is what catches a
--      second-order erasure — a resync that recomputes a derived column from
--      source columns that are NULL at that moment;
--   D. every column that DISAPPEARED and held data has a declaration in
--      `migration_guard.column_moves` saying where the data went, and that
--      declaration reproduces the old value for every affected row.
--
-- Nothing here is specific to one migration. D is the only part that needs
-- per-migration input, and it demands it: an undeclared drop fails.
-- ===========================================================================

do $$
declare
    v_failures text[] := '{}';
    v_table text;
    v_col text;
    v_recover text;
    v_cmp text;
    v_missing bigint[];
    v_now jsonb;
    v_snapshot_cols text[];
    v_live_cols text[];
    v_bad text;
    v_bad_rows bigint[];
    v_nonempty bigint;
    v_discard_reason text;
begin
    for v_table in
        select distinct s.table_name from migration_guard.snapshot s order by 1
    loop
        -- A. Does the table still exist at all?
        if to_regclass('public.' || quote_ident(v_table)) is null then
            v_failures := v_failures || format(
                'TABLE DROPPED: public.%I held %s seeded row(s) and no longer exists.',
                v_table,
                (select count(*) from migration_guard.snapshot s where s.table_name = v_table));
            continue;
        end if;

        -- B. Are all the seeded rows still there?
        execute format(
            'select coalesce(array_agg(s.row_id order by s.row_id), ''{}''::bigint[])
               from migration_guard.snapshot s
              where s.table_name = %L
                and not exists (select 1 from public.%I t where t.id = s.row_id)',
            v_table, v_table)
        into v_missing;

        if array_length(v_missing, 1) > 0 then
            v_failures := v_failures || format(
                'ROWS DELETED: public.%I lost seeded row id(s) %s.',
                v_table, array_to_string(v_missing, ', '));
        end if;

        -- Pull every surviving seeded row back as jsonb, keyed by id, so the
        -- per-column comparison below is plain SQL rather than more dynamic
        -- SQL per column.
        execute format(
            'select coalesce(jsonb_object_agg(t.id::text, to_jsonb(t)), ''{}''::jsonb)
               from public.%I t
              where t.id in (select s.row_id from migration_guard.snapshot s
                              where s.table_name = %L)',
            v_table, v_table)
        into v_now;

        select array_agg(a.attname order by a.attname)
          into v_live_cols
          from pg_attribute a
         where a.attrelid = ('public.' || quote_ident(v_table))::regclass
           and a.attnum > 0
           and not a.attisdropped;

        select array_agg(distinct k order by k)
          into v_snapshot_cols
          from migration_guard.snapshot s,
               lateral jsonb_object_keys(s.row_json) k
         where s.table_name = v_table;

        -- C. Values in surviving columns must be untouched.
        for v_col in
            select unnest(v_snapshot_cols)
            intersect
            select unnest(v_live_cols)
            order by 1
        loop
            if exists (
                select 1 from migration_guard.expected_rewrites e
                 where e.table_name = v_table and e.column_name = v_col
            ) then
                continue;
            end if;

            select string_agg(
                       format('id %s: %L -> %L', s.row_id,
                              s.row_json ->> v_col,
                              v_now -> s.row_id::text ->> v_col),
                       '; ' order by s.row_id)
              into v_bad
              from migration_guard.snapshot s
             where s.table_name = v_table
               and v_now ? s.row_id::text
               and (s.row_json ->> v_col) is distinct from (v_now -> s.row_id::text ->> v_col);

            if v_bad is not null then
                v_failures := v_failures || format(
                    'VALUE REWRITTEN: public.%I.%I changed on pre-existing rows (%s). '
                    'If that is intended, declare it in migration_guard.expected_rewrites with a reason.',
                    v_table, v_col, v_bad);
            end if;
        end loop;

        -- D. Columns that vanished must have a verified destination.
        for v_col in
            select unnest(v_snapshot_cols)
            except
            select unnest(v_live_cols)
            order by 1
        loop
            select count(*)
              into v_nonempty
              from migration_guard.snapshot s
             where s.table_name = v_table
               and coalesce(btrim(s.row_json ->> v_col), '') <> '';

            if v_nonempty = 0 then
                continue;  -- dropped a column that held nothing. Fine.
            end if;

            select d.reason into v_discard_reason
              from migration_guard.discarded_columns d
             where d.table_name = v_table and d.column_name = v_col;

            if v_discard_reason is not null then
                raise notice 'migration data-safety guard: public.%.% dropped WITHOUT recovery, declared intentional — %',
                    v_table, v_col, v_discard_reason;
                continue;
            end if;

            select m.recover_query, m.compare_fn
              into v_recover, v_cmp
              from migration_guard.column_moves m
             where m.table_name = v_table and m.from_column = v_col;

            if v_recover is null then
                v_failures := v_failures || format(
                    'COLUMN DROPPED WITH DATA: public.%I.%I held a non-empty value on %s of %s '
                    'pre-existing row(s) and was dropped with no destination declared. Add a row to '
                    'migration_guard.column_moves (supabase/tests/migration-data-safety/declared-moves.sql) '
                    'saying where that data went, and backfill it in the migration BEFORE the drop.',
                    v_table, v_col, v_nonempty,
                    (select count(*) from migration_guard.snapshot s where s.table_name = v_table));
                continue;
            end if;

            execute format(
                'select coalesce(array_agg(s.row_id order by s.row_id), ''{}''::bigint[])
                   from migration_guard.snapshot s
                   join public.%I t on t.id = s.row_id
                  where s.table_name = %L
                    and coalesce(btrim(s.row_json ->> %L), '''') <> ''''
                    and not exists (
                        select 1
                          from lateral (%s) as recovered(value)
                         where %s(recovered.value) is not distinct from %s(s.row_json ->> %L)
                    )',
                v_table, v_table, v_col, v_recover, v_cmp, v_cmp, v_col)
            into v_bad_rows;

            if array_length(v_bad_rows, 1) > 0 then
                v_failures := v_failures || format(
                    'BACKFILL LOST DATA: public.%I.%I was dropped and its declared destination (%s) '
                    'cannot reproduce the old value on row id(s) %s.',
                    v_table, v_col, v_recover, array_to_string(v_bad_rows, ', '));
            end if;
        end loop;
    end loop;

    if array_length(v_failures, 1) > 0 then
        raise exception E'migration data-safety guard FAILED — % problem(s):\n  - %',
            array_length(v_failures, 1),
            array_to_string(v_failures, E'\n  - ');
    end if;

    raise notice 'migration data-safety guard PASSED — % seeded row(s) across % table(s) survived intact.',
        (select count(*) from migration_guard.snapshot),
        (select count(distinct s.table_name) from migration_guard.snapshot s);
end;
$$;
