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
--
-- HOW A SNAPSHOT ROW IS FOUND AGAIN. Through `to_jsonb(t) @> s.key_json`,
-- where `key_json` is the table's primary key as `capture()` read it out of
-- the catalog (see fixture.sql). This used to be `t.id = s.row_id`, which was
-- not just a narrower join but a structural blind spot: a table without an
-- `id` column could not be snapshotted at all, and `member_state` — the table
-- one of the two near-miss migrations this guard exists for is named after —
-- was one of them.
--
-- A consequence worth naming: if a pending migration drops or renames a
-- PRIMARY KEY column, no live row contains the old key any more and every
-- seeded row of that table reports as ROWS DELETED. That is loud and it is
-- roughly the right answer — a key change is a data-migration event that has
-- to be looked at — but the message will say "deleted" when it means "rekeyed".
-- ===========================================================================

do $$
declare
    v_failures text[] := '{}';
    v_table text;
    v_col text;
    v_recover text;
    v_cmp text;
    v_missing text[];
    v_now jsonb;
    v_snapshot_cols text[];
    v_live_cols text[];
    v_bad text;
    v_bad_rows text[];
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

        -- B. Are all the seeded rows still there? Counted rather than merely
        -- existence-checked, so a keyless table that lost one of several
        -- identical rows is caught too (`multiplicity`, see fixture.sql).
        execute format(
            'select coalesce(array_agg(s.row_key order by s.row_key), ''{}''::text[])
               from migration_guard.snapshot s
              where s.table_name = %L
                and (select count(*) from public.%I t where to_jsonb(t) @> s.key_json)
                    < s.multiplicity',
            v_table, v_table)
        into v_missing;

        if array_length(v_missing, 1) > 0 then
            v_failures := v_failures || format(
                'ROWS DELETED: public.%I lost seeded row(s) %s.',
                v_table, array_to_string(v_missing, ', '));
        end if;

        -- Pull every surviving seeded row back as jsonb, keyed by row_key, so
        -- the per-column comparison below is plain SQL rather than more
        -- dynamic SQL per column. `limit 1` because a keyless table's key can
        -- match more than one live row; for a primary-keyed table it never
        -- matches more than one anyway.
        execute format(
            'select coalesce(jsonb_object_agg(s.row_key, m.j), ''{}''::jsonb)
               from migration_guard.snapshot s
               join lateral (
                   select to_jsonb(t) as j from public.%I t
                    where to_jsonb(t) @> s.key_json limit 1
               ) m on true
              where s.table_name = %L',
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
                       format('%s: %L -> %L', s.row_key,
                              s.row_json ->> v_col,
                              v_now -> s.row_key ->> v_col),
                       '; ' order by s.row_key)
              into v_bad
              from migration_guard.snapshot s
             where s.table_name = v_table
               and v_now ? s.row_key
               and (s.row_json ->> v_col) is distinct from (v_now -> s.row_key ->> v_col);

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

            -- `t` stays the alias a `recover_query` may reference, exactly as
            -- before; only how it is joined to the snapshot changed.
            execute format(
                'select coalesce(array_agg(s.row_key order by s.row_key), ''{}''::text[])
                   from migration_guard.snapshot s
                   join lateral (
                       select * from public.%I t0 where to_jsonb(t0) @> s.key_json limit 1
                   ) t on true
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
                    'cannot reproduce the old value on row(s) %s.',
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
        (select coalesce(sum(s.multiplicity), 0) from migration_guard.snapshot s),
        (select count(distinct s.table_name) from migration_guard.snapshot s);
end;
$$;
