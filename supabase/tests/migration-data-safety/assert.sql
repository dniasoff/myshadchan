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
--   A. the table still exists — or, if not, was declared RENAMED in
--      `migration_guard.table_renames`, in which case every check below runs
--      against the new name instead;
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
-- Nothing here is specific to one migration. D (and, for a renamed table, A)
-- are the only parts that need per-migration input, and both demand it: an
-- undeclared drop fails, and an undeclared disappearance is read as a drop.
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
    -- The table to actually QUERY (`public.%I`) in checks B/C/D. Equal to
    -- v_table except for a declared rename, where it becomes `to_table` —
    -- v_table itself stays the snapshot/declaration KEY throughout (every
    -- row in migration_guard.snapshot, column_moves, discarded_columns and
    -- expected_rewrites is keyed by the BASELINE name, never the renamed
    -- one).
    v_live_table text;
    v_rename_target text;
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
        v_live_table := v_table;

        -- A. Does the table still exist at all? A declared rename means
        -- "look for these rows under the new name", never "skip this table"
        -- — checks B/C/D below still run in full, just against
        -- v_live_table instead of v_table.
        if to_regclass('public.' || quote_ident(v_table)) is null then
            select r.to_table into v_rename_target
              from migration_guard.table_renames r
             where r.from_table = v_table;

            if v_rename_target is null then
                select d.reason into v_discard_reason
                  from migration_guard.discarded_tables d
                 where d.table_name = v_table;

                if v_discard_reason is not null then
                    raise notice 'migration data-safety guard: public.% dropped WITH its % seeded row(s), declared intentional — %',
                        v_table,
                        (select count(*) from migration_guard.snapshot s where s.table_name = v_table),
                        v_discard_reason;
                    continue;
                end if;

                v_failures := v_failures || format(
                    'TABLE DROPPED: public.%I held %s seeded row(s) and no longer exists. If that '
                    'loss is intentional, declare it in migration_guard.discarded_tables '
                    '(supabase/tests/migration-data-safety/declared-moves.sql) with the reason; if '
                    'the table was renamed, declare it in migration_guard.table_renames instead.',
                    v_table,
                    (select count(*) from migration_guard.snapshot s where s.table_name = v_table));
                continue;
            end if;

            if to_regclass('public.' || quote_ident(v_rename_target)) is null then
                v_failures := v_failures || format(
                    'TABLE DROPPED: public.%I held %s seeded row(s); declared renamed to public.%I '
                    'in migration_guard.table_renames, but that table does not exist either.',
                    v_table,
                    (select count(*) from migration_guard.snapshot s where s.table_name = v_table),
                    v_rename_target);
                continue;
            end if;

            v_live_table := v_rename_target;
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
            v_table, v_live_table)
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
            v_live_table, v_table)
        into v_now;

        select array_agg(a.attname order by a.attname)
          into v_live_cols
          from pg_attribute a
         where a.attrelid = ('public.' || quote_ident(v_live_table))::regclass
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
                v_live_table, v_table, v_col, v_recover, v_cmp, v_cmp, v_col)
            into v_bad_rows;

            if array_length(v_bad_rows, 1) > 0 then
                v_failures := v_failures || format(
                    'BACKFILL LOST DATA: public.%I.%I was dropped and its declared destination (%s) '
                    'cannot reproduce the old value on row(s) %s.',
                    v_table, v_col, v_recover, array_to_string(v_bad_rows, ', '));
            end if;
        end loop;
    end loop;

    -- A declaration that authorises no actual drop. Checked OUTSIDE the loop
    -- above on purpose: that loop only ever visits tables the fixture
    -- captured, so a declaration naming a table that was never dropped would
    -- otherwise sit unnoticed and pre-authorise a future accidental drop of
    -- it. Either the migration does not do what the declaration says, or the
    -- declaration is stale and belongs deleted (see its LIFECYCLE note).
    for v_table in
        select d.table_name from migration_guard.discarded_tables d order by 1
    loop
        if to_regclass('public.' || quote_ident(v_table)) is not null then
            v_failures := v_failures || format(
                'DISCARD DECLARED BUT NOT PERFORMED: public.%I is declared in '
                'migration_guard.discarded_tables but still exists after the pending '
                'migrations ran. Drop it, or delete the declaration.',
                v_table);
        end if;
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

-- Scale proof for the real migration backfill. The fixture adds 10,000
-- resumes across 200 accounts and 5,000 resumes on one account after the
-- generic snapshot is captured, so this section exercises the migration's
-- account-lock/batched-DML path without making the row-preservation diff
-- quadratic. It then reruns the same bounded reconcile loop and requires no
-- reference or link count changes.
do $$
declare
    v_started_at timestamptz := clock_timestamp();
    v_account record;
    v_resume record;
    v_account_lock bigint;
    v_account_count bigint;
    v_resume_count bigint;
    v_candidate_count bigint;
    v_before_references bigint;
    v_before_links bigint;
    v_after_references bigint;
    v_after_links bigint;
begin
    select count(*) into v_account_count
      from public.accounts
     where id between 9100001 and 9100200 or id = 9101000;
    select count(*) into v_resume_count
      from public.resumes
     where id between 94000001 and 94010000 or id between 95000001 and 95005000;
    select coalesce(sum(jsonb_array_length(r.sections -> 'references')), 0)
      into v_candidate_count
      from public.resumes r
     where r.id between 94000001 and 94010000
        or r.id between 95000001 and 95005000;

    if v_account_count <> 201 or v_resume_count <> 15000 or v_candidate_count <> 40000 then
        raise exception 'resume reference scale proof: expected 201 accounts/15000 resumes/40000 candidates, got %/%/%',
            v_account_count, v_resume_count, v_candidate_count;
    end if;

    if (select count(*) from public."references"
        where account_id between 9100001 and 9100200 or account_id = 9101000) <> 201
       or (select count(*) from public.reference_links
           where account_id between 9100001 and 9100200 or account_id = 9101000) <> 10500
       or (select count(*) from public.reference_links where account_id = 9101000) <> 500
       or (select count(*)
           from public.resumes r
          where r.id between 95000501 and 95005000
            and exists (
                select 1 from public.reference_links rl
                 where rl.resume_id = r.id
            )) <> 0 then
        raise exception 'resume reference scale proof: expected bounded backfill (201 identities, 10500 links, 500 links on the 5000-resume account)';
    end if;

    for v_account in
        select id as account_id
          from public.accounts
         where id between 9100001 and 9100200 or id = 9101000
         order by id
    loop
        select count(*) into v_before_references
          from public."references" where account_id = v_account.account_id;
        select count(*) into v_before_links
          from public.reference_links where account_id = v_account.account_id;

        v_account_lock := hashtextextended(
            format('resume-reference-account:%s', v_account.account_id), 0
        );
        perform pg_advisory_lock(v_account_lock);
        begin
            -- Rerun exactly the migration's deterministic per-account bound;
            -- the 4,500 deferred rows remain pending for a future sections
            -- change/targeted operational reconciliation.
            for v_resume in
                select r.id
                  from public.resumes r
                 where r.account_id = v_account.account_id
                 order by r.id
                 limit 500
            loop
                perform public.reconcile_resume_references_for_account(
                    v_resume.id, v_account.account_id
                );
            end loop;
        exception when others then
            perform pg_advisory_unlock(v_account_lock);
            raise;
        end;
        perform pg_advisory_unlock(v_account_lock);

        select count(*) into v_after_references
          from public."references" where account_id = v_account.account_id;
        select count(*) into v_after_links
          from public.reference_links where account_id = v_account.account_id;
        if v_before_references <> v_after_references
           or v_before_links <> v_after_links then
            raise exception 'resume reference scale proof: rerun changed account % counts',
                v_account.account_id;
        end if;
    end loop;

    raise notice 'resume reference scale proof passed: accounts %, resumes %, candidates %, accounts_partially_skipped 1, resumes_partially_skipped 4500, rerun elapsed_ms %',
        v_account_count, v_resume_count, v_candidate_count,
        floor(extract(epoch from clock_timestamp() - v_started_at) * 1000)::bigint;
end;
$$;

-- Resume-reference backfill proof. The fixture deliberately contains a valid
-- candidate, a duplicate, a name-only candidate, an ambiguous identity, a
-- non-empty malformed phone, the same person on two suggestions, and an
-- existing Diligence link whose status/note/log must remain byte-for-byte
-- unchanged. This is kept outside the generic row-preservation loop because
-- all newly-created rows are intentionally absent from the baseline snapshot.
do $$
declare
    v_before_references bigint;
    v_before_links bigint;
    v_after_references bigint;
    v_after_links bigint;
    v_result jsonb;
    v_existing public.reference_links;
    v_eli_id bigint;
begin
    select * into v_existing
      from public.reference_links
     where id = 9000001;

    if v_existing.call_status is distinct from 'answered'
       or v_existing.what_they_said is distinct from 'Very warm about the family.'
       or v_existing.conversation_log is distinct from
          '[{"q": "How long have you known him?", "a": "Six years."}]'::jsonb then
        raise exception 'resume reference safety proof: existing Diligence link was overwritten';
    end if;

    select id into v_eli_id
      from public."references"
     where account_id = 9000001 and name_norm_en = public.normalize_identity_text('Rabbi Eli Cohen');

    if v_eli_id is null then
        raise exception 'resume reference safety proof: valid candidate did not create a reference';
    end if;

    if (select count(*) from public."references" where account_id = 9000001) <> 5
       or (select count(*) from public.reference_links where account_id = 9000001) <> 4 then
        raise exception 'resume reference safety proof: unexpected reference/link counts';
    end if;

    if (select count(*) from public.reference_links where reference_id = v_eli_id) <> 2
       or (select count(*) from public.reference_links where reference_id = v_eli_id and shidduchim_id = 9000001) <> 1
       or (select count(*) from public.reference_links where reference_id = v_eli_id and shidduchim_id = 9000002) <> 1 then
        raise exception 'resume reference safety proof: same person did not get independent links';
    end if;

    if exists (
        select 1
          from public.reference_links
         where reference_id in (9000002, 9000003)
    ) or exists (
        select 1
          from public."references"
         where account_id = 9000001
           and name_norm_en = public.normalize_identity_text('Junk Person')
    ) then
        raise exception 'resume reference safety proof: ambiguous or malformed candidate was linked';
    end if;

    select count(*) into v_before_references
      from public."references" where account_id = 9000001;
    select count(*) into v_before_links
      from public.reference_links where account_id = 9000001;
    v_result := public.sync_resume_references_for_account(9000001, 9000001);
    select count(*) into v_after_references
      from public."references" where account_id = 9000001;
    select count(*) into v_after_links
      from public.reference_links where account_id = 9000001;

    if v_before_references <> v_after_references
       or v_before_links <> v_after_links
       or coalesce((v_result ->> 'created_references')::integer, -1) <> 0
       or coalesce((v_result ->> 'created_links')::integer, -1) <> 0
       or coalesce((v_result ->> 'skipped_invalid')::integer, -1) <> 1
       or coalesce((v_result ->> 'skipped_ambiguous')::integer, -1) <> 1 then
        raise exception 'resume reference safety proof: idempotent rerun changed data or returned wrong counts: %', v_result;
    end if;

    raise notice 'resume reference safety proof passed: before/after references %, links %, rerun %',
        v_before_references, v_before_links, v_result;
end;
$$;
