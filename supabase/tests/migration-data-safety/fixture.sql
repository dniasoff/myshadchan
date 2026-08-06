-- ===========================================================================
-- MIGRATION DATA-SAFETY GUARD — part 1 of 2: the fixture.
--
-- Run against a database reset to the LAST DEPLOYED migration (the production
-- schema), BEFORE the pending migrations are applied. It seeds a small
-- production-shaped dataset and records a snapshot of it in its own
-- `migration_guard` schema, which no migration in `supabase/migrations/`
-- touches. `assert.sql` then re-reads that snapshot after
-- `supabase migration up` and reports anything the pending migrations
-- destroyed.
--
-- WHY THIS EXISTS. `supabase db reset` applies migrations to an EMPTY
-- database and seeds afterwards, so every local gate — six clean
-- `db diff` runs included — sees a `shidduchim` with zero rows when a
-- `drop column` runs. A migration can therefore be perfectly shaped and
-- still erase production. Two of those reached or nearly reached production
-- here: `20260729095558_backfill_member_state.sql` and
-- `20260730011428_shidduch_overview_fields.sql`. Neither was visible to any
-- other check in this repo, because no other check ever runs a migration
-- against a non-empty table.
--
-- See scripts/check-migration-data-safety.mjs (the driver) and
-- doc/src/content/docs/developers/migrations.mdx ("The empty-table trap").
--
-- WHICH TABLES GET PROTECTED is now derived from the catalog (every base
-- table in `public`), not hand-listed — see the `do $$ ... capture(v_table)`
-- loop near the foot of this file. WHICH ROWS are production-shaped is still
-- necessarily hand-authored per table (nothing can derive realistic business
-- data from a schema), and the completeness check right after that loop fails
-- loudly if any table has zero captured rows and no
-- `migration_guard.empty_by_design` declaration explaining why. Both exist
-- because the previous, fully-hand-maintained version of this file went stale
-- twice — silently — and one of those two times is the reason
-- `.claude/rules/` has a file about this guard specifically, not just about
-- migrations in general.
-- ===========================================================================

begin;

drop schema if exists migration_guard cascade;
create schema migration_guard;

-- One row per seeded row, holding the whole row as jsonb. Deliberately
-- generic: it records what existed without naming the columns, so it keeps
-- working as the schema evolves and so `assert.sql` can detect a column
-- disappearing rather than only checking columns someone remembered to list.
--
-- `key_json` is how a snapshot row is found again AFTER the migrations run.
-- It used to be a bare `row_id bigint` reading `t.id`, which made the guard
-- structurally blind to any table without an `id` column: `capture()` simply
-- errored, so `member_state` and `pipeline_transitions` were never captured
-- at all — and `member_state` is the table one of the two near-miss
-- migrations this guard exists for was NAMED after. It is now the table's
-- PRIMARY KEY, read out of the catalog by `capture()`, rendered as a jsonb
-- object (`{"user_id": "…"}`, `{"from_state": "new", "to_state": "look_into"}`,
-- `{"id": 9000001}`) and matched with `to_jsonb(t) @> key_json`.
--
-- WHY THE PRIMARY KEY RATHER THAN A WHOLE-ROW DIGEST. A digest is the obvious
-- key-free alternative and it is the wrong default here: the guard's whole job
-- is to compare a row ACROSS a schema change, and adding a column — the single
-- most common migration there is — changes every digest. Every row would then
-- read as deleted and the guard would be a false-alarm generator, which is how
-- guards get switched off. A primary key is stable under exactly the changes
-- the guard is supposed to see through, and every table this fixture seeds has
-- one. The digest remains the FALLBACK below, for a genuinely keyless table,
-- so `capture()` can never silently do nothing.
create table migration_guard.snapshot (
    table_name text not null,
    -- The key rendered as text, for failure messages and for the identity
    -- index. Indexed through md5() because a keyless table's key is its whole
    -- row, which can exceed btree's per-row size limit.
    row_key text not null,
    key_json jsonb not null,
    row_json jsonb not null,
    -- How many live rows this snapshot row stands for. Always 1 for a
    -- primary-keyed table; >1 only for a keyless table with duplicate rows,
    -- where it is what stops "3 identical rows became 1" reading as intact.
    multiplicity integer not null default 1
);

create unique index snapshot_identity
    on migration_guard.snapshot (table_name, md5(row_key));

-- The author's declaration of intent for a column the pending migrations
-- DROP. `assert.sql` treats an undeclared drop of a column that held data as
-- a failure, and a declared one as a claim it then verifies: for every row
-- whose old value was non-empty, `recover_query` must still be able to
-- produce it under `compare_fn`.
--
-- `recover_query` is a SELECT returning ONE column of candidate values, and
-- it may reference the post-migration row as `t` (it is executed LATERAL).
-- The set form rather than a scalar expression, because the two real shapes
-- of a column move are equally common: split into sibling columns on the same
-- row (`select <expr>`), and moved out into a child table
-- (`select body from public.interactions i where i.target_id = t.id ...`).
-- The check passes when ANY candidate matches, which is the honest property:
-- the value is still reachable.
--
-- `compare_fn` exists because a split or a move rarely reproduces the old
-- string byte-for-byte. `public.normalize_identity_text` is the domain's own
-- canonicaliser (lower-case, punctuation to spaces, whitespace collapsed), so
-- it compares the INFORMATION rather than the formatting — which is exactly
-- the property that matters for a matching signal.
create table migration_guard.column_moves (
    table_name text not null,
    from_column text not null,
    recover_query text not null,
    compare_fn text not null default 'public.normalize_identity_text',
    note text not null,
    primary key (table_name, from_column)
);

-- The other honest answer to "where did that column's data go?": nowhere, on
-- purpose. Separate from `column_moves` so it can never be mistaken for a
-- verified claim — nothing is checked here, the reason IS the artifact, and
-- `assert.sql` prints it on every run so a reviewer sees what is being thrown
-- away. Use it only for a column that provably never held production data;
-- for anything else, back the belief with a fail-closed assertion inside the
-- migration itself so a wrong belief halts the deploy instead of erasing.
create table migration_guard.discarded_columns (
    table_name text not null,
    column_name text not null,
    reason text not null,
    primary key (table_name, column_name)
);

-- Escape hatch for a pending migration that legitimately REWRITES a value in
-- a surviving column (a genuine normalisation backfill, a move of prose out
-- to another table). Empty by default: a rewrite of pre-existing data has to
-- be argued for in writing, not defaulted to.
create table migration_guard.expected_rewrites (
    table_name text not null,
    column_name text not null,
    reason text not null,
    primary key (table_name, column_name)
);

-- The declared exception to the completeness check at the foot of this file:
-- a `public` base table this fixture deliberately captures zero rows for,
-- because it genuinely holds nothing in production today (a schema-ready
-- table with no writer yet), and why. Anything NOT listed here has to have at
-- least one captured row, or the fixture fails loudly before this guard ever
-- reaches "asserting the seeded data survived" — see that check's own
-- comment, and .claude/rules/ for the incident (two tables went unprotected
-- silently, `invites` in Epic 6 and `connections`' own new columns in Epic 8,
-- because nothing forced this list to stay honest).
create table migration_guard.empty_by_design (
    table_name text primary key,
    reason text not null
);

-- The table's primary-key column names, in key order, straight out of the
-- catalog. NULL when the table has no primary key.
create function migration_guard.primary_key_columns(p_table text)
returns text[]
language sql
stable
as $$
    select array_agg(a.attname order by k.ord)
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.conrelid = ('public.' || quote_ident(p_table))::regclass
       and c.contype = 'p';
$$;

-- Snapshot a table. Keyed by its primary key where it has one, and by the
-- whole row where it does not — never by a hard-coded `id`, which is what
-- previously made this function throw on `member_state` and
-- `pipeline_transitions` and so left both tables uncaptured.
--
-- The keyless fallback is honest about being weaker: containment on the whole
-- row means a row whose value a migration REWRITES reads as one row deleted
-- rather than as a value changed, and two byte-identical rows are
-- indistinguishable — which is why `multiplicity` is recorded and asserted
-- rather than assumed to be 1.
--
-- Story 7.1: a no-op, NOT an error, when `p_table` does not exist yet.
-- `primary_key_columns()` casts the name to `::regclass`, which raises
-- immediately on a table this fixture's OWN pending migration has not
-- created yet (see the `to_regclass` guard around the four Communication-
-- domain inserts above for the full reasoning) — this is that same
-- accommodation, one level down, so `capture('connections')` etc. can be
-- called unconditionally in the list at the foot of this file rather than
-- each needing its own `if` guard.
create function migration_guard.capture(p_table text) returns void
language plpgsql
as $$
declare
    v_key_columns text[];
    v_key_expr text;
begin
    if to_regclass('public.' || p_table) is null then
        raise notice 'migration data-safety guard: public.% does not exist yet '
                     '(created by a not-yet-deployed migration) — skipping.', p_table;
        return;
    end if;

    v_key_columns := migration_guard.primary_key_columns(p_table);

    if v_key_columns is null then
        raise notice 'migration data-safety guard: public.% has no primary key; '
                     'snapshotting it by whole-row digest (weaker: a value rewrite '
                     'will report as a deleted row).', p_table;
        v_key_expr := 'to_jsonb(t)';
    else
        select 'jsonb_build_object(' ||
               string_agg(format('%L, to_jsonb(t) -> %L', col, col), ', ') ||
               ')'
          into v_key_expr
          from unnest(v_key_columns) as col;
    end if;

    execute format(
        'insert into migration_guard.snapshot
             (table_name, row_key, key_json, row_json, multiplicity)
         select %L, r.key_json::text, r.key_json, r.row_json, count(*)
           from (select %s as key_json, to_jsonb(t) as row_json from public.%I t) r
          group by r.key_json, r.row_json
         on conflict (table_name, md5(row_key)) do update
            set key_json = excluded.key_json,
                row_json = excluded.row_json,
                multiplicity = excluded.multiplicity',
        p_table, v_key_expr, p_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- The dataset. Ids are fixed and far above anything a real sequence reaches,
-- so the rows are recognisable in a failure message and cannot collide with
-- data another suite left behind.
-- ---------------------------------------------------------------------------

-- A real auth user, because `public.members` FKs to `auth.users` and the
-- `on_auth_user_created` trigger is part of what a migration can break.
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
)
values (
    '00000000-0000-4000-8000-000000009001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'guard.parent@example.test',
    '$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123',
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"first_name": "Guard", "last_name": "Parent"}'::jsonb,
    now(), now()
);

insert into public.accounts (id, name, kind, transparency_level, demo)
values (9000001, 'Migration Guard Household', 'household', 'full', false);

insert into public.account_members (id, account_id, user_id, role, status)
values (
    9000001, 9000001,
    '00000000-0000-4000-8000-000000009001',
    'parent_admin', 'active'
);

-- Epic 6 shape (AC-5): a single with her OWN login. A second `auth.users`
-- row, a second `account_members` row scoped `role = 'single'` on the SAME
-- household account, and — below — the `singles` row's `member_id` pointing
-- at this membership. This is exactly what 6.1's `accept_invite()` and 6.5's
-- `add_persona('single')` produce, and what a future migration that
-- recreates `account_members` or narrows `singles` would otherwise never
-- meet.
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
)
values (
    '00000000-0000-4000-8000-000000009002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'guard.single@example.test',
    '$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123',
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"first_name": "Leah", "last_name": "Guardstein"}'::jsonb,
    now(), now()
);

insert into public.account_members (id, account_id, user_id, role, status)
values (
    9000002, 9000001,
    '00000000-0000-4000-8000-000000009002',
    'single', 'active'
);

insert into public.singles (
    id, account_id, first_name_en, first_name_he, last_name_en, last_name_he,
    gender, dob, community, status, member_id
)
values (
    9000001, 9000001, 'Leah', 'לאה', 'Guardstein', 'גוארדשטיין',
    'female', date '2003-04-11', 'Yeshivish', 'active', 9000002
);

insert into public.shadchanim (id, account_id, name, name_he, location)
values (
    9000001, 9000001, 'Mrs. Bracha Katz', 'מרת ברכה כץ', 'Lakewood'
);

-- `invites`, in EVERY shape the baseline schema admits. This table was the
-- one Epic 6 alters structurally (`target_single_id`, plus two constraints)
-- and the one this fixture did not seed, so `make check-migration-safety`
-- passed the whole epic while being unable to see its only DDL. The grid is
-- deliberate rather than illustrative: `invites_role_check` admits four
-- roles, three of which (`parent_admin`, `helper`, `single`) Epic 2 shipped
-- as invitable into a household two epics before Epic 6 gave `single` a
-- meaning, and `invites_status_check` admits `pending`/`accepted`/`revoked`
-- (`expired` is only ever reached by expiry, never written). Every
-- combination therefore already exists in production and every combination
-- has to survive a migration.
--
-- The `role = 'single'`, `status = 'pending'`, `target_single_id IS NULL` row
-- (9000003) is the specific one Story 6.1's review found: it violates the new
-- `invites_role_target_check`, so a migration that VALIDATES that constraint
-- — as `db diff` naturally emits, because the shadow database it diffs is
-- always empty — aborts on it and takes the whole deploy with it. Without
-- this row nothing in the repo can tell the two versions of that migration
-- apart.
--
-- `token` and `expires_at` keep their defaults: the snapshot is taken in the
-- same transaction that writes them, so whatever they resolve to is what
-- assert.sql compares against. `invited_by` points at the parent_admin
-- membership above, exactly as create_invite() writes it.
--
-- Story 7.1 fix: `invites_role_target_check` is `NOT VALID` but, per its own
-- comment in 01_tables.sql, still enforced for every NEW row from the moment
-- it was added — only rows that ALREADY EXISTED at that instant are
-- grandfathered. The three `role = 'single'` rows below (9000003/9000006/
-- 9000009, all with `target_single_id` omitted) are exactly that grandfathered
-- shape, which now that Story 6.1's migration is permanently part of the
-- baseline this fixture resets to, can no longer be produced by a plain
-- INSERT — Postgres has no "insert as if this constraint didn't exist yet"
-- mode, so the constraint is dropped and immediately re-added `NOT VALID`
-- around just this one statement, genuinely reproducing "a row older than
-- the constraint" rather than merely working around it. Confirmed broken
-- without this: a plain INSERT here now raises `23514` on 9000003 before
-- Story 7.1 ever touches this file.
alter table public.invites drop constraint invites_role_target_check;

insert into public.invites (
    id, account_id, email, role, status, invited_by, accepted_at
)
values
    (9000001, 9000001, 'guard.invite.parent.pending@example.test',  'parent_admin', 'pending',  9000001, null),
    (9000002, 9000001, 'guard.invite.helper.pending@example.test',  'helper',       'pending',  9000001, null),
    (9000003, 9000001, 'guard.invite.single.pending@example.test',  'single',       'pending',  9000001, null),
    (9000004, 9000001, 'guard.invite.parent.accepted@example.test', 'parent_admin', 'accepted', 9000001, now()),
    (9000005, 9000001, 'guard.invite.helper.accepted@example.test', 'helper',       'accepted', 9000001, now()),
    (9000006, 9000001, 'guard.invite.single.accepted@example.test', 'single',       'accepted', 9000001, now()),
    (9000007, 9000001, 'guard.invite.parent.revoked@example.test',  'parent_admin', 'revoked',  9000001, null),
    (9000008, 9000001, 'guard.invite.helper.revoked@example.test',  'helper',       'revoked',  9000001, null),
    (9000009, 9000001, 'guard.invite.single.revoked@example.test',  'single',       'revoked',  9000001, null);

-- Re-add exactly as 01_tables.sql declares it — NOT VALID, never validated —
-- so the fixture's schema matches the real one for the rest of this run
-- (`assert.sql` re-reads the same schema after the pending migrations apply).
alter table public.invites
    add constraint invites_role_target_check check (
        (role = 'single') = (target_single_id is not null)
    ) not valid;

-- The five shapes that matter for `father_en`/`father_he`/`mother_en`/
-- `mother_he` (Story 5.2 split `parents_en`/`parents_he` into these four and
-- dropped the originals — declared-moves.sql's now-retired entry). All 24
-- rows in production are the first shape (both halves populated, honorific
-- on the father half); the rest are the cases 5.2's backfill produced or had
-- to not lose, translated into the post-split columns so this guard keeps
-- covering them even though the migration that created them is deployed.
insert into public.shidduchim (
    id, account_id, single_id, shadchan_id,
    name_en, name_he, father_en, father_he, mother_en, mother_he,
    seminary_en, shul_en, location_en, age, height,
    pipeline_state, origin, visibility, owner_member_id
)
values
    -- 1. The production shape: both halves populated.
    (9000001, 9000001, 9000001, 9000001,
     'Yosef Rosenberg', 'יוסף רוזנברג',
     'R'' Yaakov Rosenberg', null, 'Chaya Rosenberg', null,
     'Mir', 'Bais Medrash Govoha', 'Lakewood', 24, '5''10"',
     'new', 'manual', 'shared', 9000001),
    -- 2. The production shape again, different family.
    (9000002, 9000001, 9000001, 9000001,
     'Shmuel Weiss', 'שמואל וייס',
     'R'' Dovid Weiss', null, 'Rivka Weiss', null,
     'Ner Yisroel', null, 'Baltimore', 25, '6''0"',
     'look_into', 'manual', 'shared', 9000001),
    -- 3. Father-only, mother NULL — what 5.2's backfill produced for a
    --    pre-split value with no `' & '` separator. Never dropped.
    (9000003, 9000001, 9000001, null,
     'Mendel Friedman', null,
     'Mendel Friedman Sr', null, null, null,
     null, null, 'Monsey', 23, null,
     'new', 'manual', 'shared', null),
    -- 4. Hebrew only. Zero rows in production today, but the migration must
    --    not be selectively correct.
    (9000004, 9000001, 9000001, 9000001,
     null, 'אברהם לוי',
     null, 'ר׳ יעקב לוי', null, 'חיה לוי',
     null, null, null, 26, null,
     'new', 'manual', 'shared', 9000001),
    -- 5. Control: no parents at all. Must stay empty, not acquire a value.
    (9000005, 9000001, 9000001, null,
     'Anonymous Prospect', null,
     null, null, null, null,
     null, null, null, null, null,
     'new', 'channel', 'private_parent', null);

insert into public.redts (id, account_id, shidduchim_id, shadchan_id, redt_date, note)
values (9000001, 9000001, 9000001, 9000001, current_date - 30, 'First redt.');

insert into public."references" (
    id, account_id, name_en, name_he, relationship, phone, school, grad_year
)
values (
    9000001, 9000001, 'Rabbi Shloime Green', 'הרב שלמה גרין',
    'rebbe', '054-123-4567', 'Mir', 2019
);

insert into public.reference_links (
    id, account_id, reference_id, shidduchim_id, call_status,
    what_they_said, conversation_log
)
values (
    9000001, 9000001, 9000001, 9000001, 'answered',
    'Very warm about the family.',
    '[{"q": "How long have you known him?", "a": "Six years."}]'::jsonb
);

insert into public.resumes (id, account_id, shidduchim_id, files, extracted)
values (
    9000001, 9000001, 9000001,
    '[{"path": "9000001/resume.pdf", "title": "resume.pdf"}]'::jsonb,
    '{"age": 24}'::jsonb
);

-- Story 5.4: one photo row per resume, path-scoped to its account
-- (resume_photos_storage_path_scope_check).
insert into public.resume_photos (id, account_id, resume_id, path, visibility)
values (
    9000001, 9000001, 9000001,
    '9000001/photos/shared/9000001/guard-photo.jpg', 'shared'
);

-- Story 5.5: a medical note hangs off a shidduch, never off the account
-- directly (medical_notes.shidduchim_id not null).
insert into public.medical_notes (id, account_id, shidduchim_id, author_member_id, body)
values (
    9000001, 9000001, 9000001, 9000001,
    'No known allergies. Sees Dr. Fein annually.'
);

-- Story 5.6: an external link (vosizneias-style writeup, shul directory,
-- etc.) attached to a shidduch.
insert into public.shidduchim_external_links (id, account_id, shidduchim_id, url, label)
values (
    9000001, 9000001, 9000001,
    'https://example.test/guard-writeup', 'Community writeup'
);

-- shidduch_schools (Story 3.x era, ShidduchOverviewTab.tsx): a seminary /
-- yeshiva / school entry attached to a shidduch. Never seeded before this —
-- one of the 7 tables the completeness check below found with real
-- production traffic (see .claude/rules/ for the incident) but zero rows in
-- this fixture.
insert into public.shidduch_schools (id, account_id, shidduchim_id, kind, name_en, name_he, start_year, end_year)
values (
    9000001, 9000001, 9000001, 'seminary', 'Bais Yaakov Seminary', 'בית יעקב', 2019, 2021
);

-- Story 3.7: a Files-tab row, path-scoped to its account
-- (entity_files_storage_path_scope_check).
insert into public.entity_files (
    id, account_id, target_type, target_id, storage_path, file_name,
    mime_type, size_bytes, visibility, uploaded_by_member_id
)
values (
    9000001, 9000001, 'shidduch', 9000001,
    '9000001/shidduch/9000001/guard-file.pdf', 'guard-file.pdf',
    'application/pdf', 12345, 'shared', 9000001
);

-- E4: the free/paid entitlement row and its usage meter, one per account.
insert into public.subscription (id, account_id, plan, status)
values (9000001, 9000001, 'free', 'none');

insert into public.ai_usage (id, account_id, period, resumes_parsed)
values (9000001, 9000001, '2026-07', 3);

insert into public.interactions (
    id, account_id, target_type, target_id, scope, kind, body, actor_member_id
)
values
    (9000001, 9000001, 'shidduch', 9000001, 'shidduch', 'note',
     'Spoke to the shadchan; parents sound like a good fit.', 9000001),
    (9000002, 9000001, 'shadchan', 9000001, 'account', 'note',
     'Called about two other families.', 9000001);

insert into public.tasks (
    id, account_id, type, text, due_date, member_id,
    delivery_channels, target_type, target_id
)
select
    9000001, 9000001, 'Call', 'Call the seminary reference back',
    now() + interval '3 days', m.id,
    array['in_app']::text[], 'shidduch', 9000001
from public.members m
where m.user_id = '00000000-0000-4000-8000-000000009001';

-- inbox_items (the front-door capture inbox, InboxList.tsx /
-- InboxResolveDialog.tsx): never seeded before this — one of the 7 tables the
-- completeness check below found with real production traffic but zero rows
-- in this fixture (see .claude/rules/ for the incident this closes).
-- `source = 'email'` keeps `inbox_items_shadchan_source_requires_connection`
-- out of scope (that check only constrains `source = 'shadchan'`).
-- `attachments` carries one resume-shaped entry (`extractAndUploadAttachments.ts`'s
-- shape, InboxAttachmentSchema in workers/parse/inboxAttachment.ts) whose
-- `path` matches the ai_parse_attempts row seeded below verbatim — that row
-- is production-shaped precisely because it references a real attachment on
-- a real inbox item, the same pair POST /parse's findResumeAttachment() would
-- actually resolve, not an arbitrary path with nothing behind it.
insert into public.inbox_items (id, account_id, source, raw_text, subject, sender, status, attachments)
values (
    9000001, 9000001, 'email',
    'Forwarded resume for a potential match — see attached.',
    'Possible shidduch for Leah', 'seminary.office@example.test', 'unresolved',
    '[{"type": "application/pdf", "path": "9000001/inbox/9000001/resume.pdf", "title": "resume.pdf"}]'::jsonb
);

-- Epic 11 Findings 6/7/8 closure: ai_parse_attempts is the per-attachment
-- parse claim/idempotency ledger. Same `to_regclass` guard as the
-- connections/threads/message_notifications blocks below and for the exact
-- same reason: THIS story's own migration is what creates this table, so it
-- genuinely holds nothing before that migration applies — the guard is
-- trivially safe for its own migration, and from the next baseline onward
-- this seeds and captures it like every other table here, closing the blind
-- spot in the same diff that adds it (see those blocks' own comments for the
-- Epic 8 incident this pattern exists to avoid repeating). Seeded AFTER the
-- inbox_items row (9000001, account 9000001) directly above it, on purpose —
-- `inbox_item_id` carries no FK (01_tables.sql), so nothing would fail if
-- this ran first, but a completed row that references an item which does
-- not yet exist is not production-shaped. `attachment_path` matches that
-- row's `attachments[0].path` exactly, so this is shaped like what
-- POST /parse's claim_ai_parse_attempt() would actually create for it —
-- `generation` is left at its default (1: a fresh claim, never reclaimed),
-- the production-shape default for a completed row.
do $$
begin
  if to_regclass('public.ai_parse_attempts') is not null then
    execute $seed$
      insert into public.ai_parse_attempts
        (id, account_id, inbox_item_id, attachment_path, period, status, started_at, result)
      values (
        9000001, 9000001, 9000001,
        '9000001/inbox/9000001/resume.pdf', '2026-07', 'completed', now(),
        '{"fields": {}, "lowConfidenceFields": [], "sections": {}, "rawDraft": {}}'::jsonb
      );
    $seed$;
  end if;
end $$;

-- Story 7.1 (Epic 7: threads). A shadchanus account, an accepted connection
-- to the household above, and one thread/participant/message PER SCOPE AXIS
-- on the SAME subject shidduch (9000001) — the shape Story 7.5's
-- thread_participants ALTER and Epic 8's connections ALTER both need this
-- fixture to already carry, so neither repeats the "guard was structurally
-- blind to a table it does not seed" mistake invites was for two epics.
--
-- Guarded by `to_regclass`, unlike every other insert in this file: THIS
-- story's own migration is what creates `connections`/`threads`/
-- `thread_participants`/`messages`, and this fixture runs against the
-- database reset to the LAST DEPLOYED migration — i.e. BEFORE this story's
-- migration has ever applied. A plain (unguarded) insert here would raise
-- "relation does not exist" the very first time this guard runs against
-- Story 7.1's own pending migration, which is the opposite of the intent.
-- The four tables genuinely cannot hold pre-existing production data before
-- the migration that creates them, so there is nothing for THIS story's own
-- migration to destroy in them — the guard is trivially safe for it. From
-- the moment this migration is deployed (part of every FUTURE baseline),
-- `to_regclass` resolves and the block below seeds and captures exactly like
-- every other table in this file, closing the blind spot immediately rather
-- than waiting for a later story to remember it (`subscription`/`ai_usage`
-- were retro-fitted into this fixture two stories after their own table
-- existed — this closes the same gap in the SAME diff instead).
do $$
begin
  if to_regclass('public.connections') is not null then
    execute $seed$
      insert into public.accounts (id, name, kind, transparency_level, demo)
      values (9000002, 'Migration Guard Shadchanus', 'shadchanus', 'full', false);

      -- Story 8.2 columns (proposed_by_account_id, accepted_at,
      -- household_account_name): this insert predates 8.2 and was never
      -- updated when that story made the first two NOT NULL and the third
      -- both NOT NULL and newly-added (Story 8.5) — see 01_tables.sql's own
      -- comments on each column. That gap is what this guard's own setup
      -- silently failed on for every migration from Story 8.2 through all of
      -- Epic 9: fixture.sql itself never got past this INSERT, so nothing
      -- below it (including 9.1's and 9.3's own to_regclass-guarded blocks)
      -- ever ran. Values mirror accept_connection_invite()'s own shape
      -- (02_functions.sql): proposed_by_account_id is the inviter (here, the
      -- shadchanus side), accepted_at is set together with status =
      -- 'accepted', and household_account_name is the household account's
      -- own name at accept time.
      insert into public.connections (
          id, household_account_id, shadchanus_account_id, status,
          proposed_by_account_id, accepted_at, household_account_name
      )
      values (
          9000001, 9000001, 9000002, 'accepted',
          9000002, now(), 'Migration Guard Household'
      );

      insert into public.threads (id, account_id, connection_id, subject_type, subject_id, visibility, created_by_member_id)
      values (9000001, 9000001, null, 'shidduch', 9000001, 'open', 9000001);

      insert into public.thread_participants (id, account_id, connection_id, thread_id, member_id)
      values (9000001, 9000001, null, 9000001, 9000001);

      insert into public.messages (id, account_id, connection_id, thread_id, sender_member_id, body)
      values (9000001, 9000001, null, 9000001, 9000001, 'Any updates on the seminary reference?');

      insert into public.threads (id, account_id, connection_id, subject_type, subject_id, visibility, created_by_member_id)
      values (9000002, null, 9000001, 'shidduch', 9000001, 'open', null);

      insert into public.thread_participants (id, account_id, connection_id, thread_id, member_id)
      values (9000002, null, 9000001, 9000002, 9000001);

      insert into public.messages (id, account_id, connection_id, thread_id, sender_member_id, body)
      values (9000002, null, 9000001, 9000002, null, 'The shadchan checking in on this family.');
    $seed$;
  end if;
end $$;

-- Story 8.2 (Task 2): a connection_invites row. The table is created by 8.2's
-- own migration (20260802130221_connection_consent.sql), already part of
-- every baseline this guard resets to today — same as `connections`'
-- proposed_by_account_id/household_account_name above — so no `to_regclass`
-- guard is needed, unlike the Epic-7/7.5/9.x blocks around it whose tables
-- are still ahead of some baseline this guard might run against. Never
-- seeded before this — the fixture's own INSERT into `connections` above
-- failed on every run since 8.2, so nothing after it, including this table,
-- was ever reachable (see .claude/rules/ for the incident).
insert into public.connection_invites (
    id, inviter_account_id, inviter_kind, token_hash, status, expires_at
)
values (
    9000001, 9000002, 'shadchanus',
    encode(extensions.digest('migration-guard-connection-invite', 'sha256'), 'hex'),
    'pending', now() + interval '7 days'
);

-- Story 7.5 (message_notifications, push_subscriptions). Same `to_regclass`
-- guard, same reasoning as the block above: THIS story's own migration is
-- what creates both tables, so they hold nothing before it applies, and the
-- guard is trivially safe for its own migration. From the next story's
-- baseline onward this seeds and captures them like every other table here —
-- closing the blind spot in the same diff that adds them, not two stories
-- later (thread_participants.last_read_at needs no seed of its own: it is a
-- nullable column added to an ALREADY-seeded table above, so the existing
-- thread_participants rows already exercise the "no backfill needed"
-- ADD COLUMN safely).
--
-- Review fix (Story 7.5 F1): once `message_notifications` exists, this
-- block runs in the SAME session as the connections/threads/messages block
-- above, and by then `fan_out_message_notifications_trigger` also exists
-- (created by the same migration). Both messages seeded above have their
-- `sender_member_id` overridden to NULL by `set_message_defaults()` (it
-- reads `current_member_id()` unconditionally, and this script runs as
-- `postgres` with no JWT), so each message's sole participant (member
-- 9000001) is "distinct from" a NULL sender and the trigger itself queues
-- an `('email', ...)` row keyed `(message_id, 9000001, 'email')` for BOTH
-- message 9000001 and message 9000002 — before this block ever runs. An
-- explicit `channel = 'email'` insert here for either message therefore
-- collides on `message_notifications_dedupe_key` (reproduced: `duplicate
-- key value violates unique constraint "message_notifications_dedupe_key"`,
-- `(9000001, 9000001, email)`), and does so every time this fixture runs
-- from a baseline where the fan-out trigger already exists — not merely a
-- one-off collision, self-inflicted on every future rehearsal. `channel =
-- 'push'` cannot collide with the trigger's own fan-out here: the trigger
-- only queues a `push` row when a `push_subscriptions` row already exists
-- for that recipient at message-insert time, and `push_subscriptions` is
-- still empty until the seed just below runs (strictly after the messages
-- above, in this same script). The trigger's own auto-queued `email` rows
-- are not lost coverage — they are genuine production-shaped rows in this
-- table by the time `capture()` runs below, and get captured and protected
-- like any other row here.
do $$
begin
  if to_regclass('public.message_notifications') is not null then
    execute $seed$
      insert into public.message_notifications (id, account_id, connection_id, message_id, recipient_member_id, channel, status)
      values (9000001, 9000001, null, 9000001, 9000001, 'push', 'pending');

      insert into public.push_subscriptions (id, member_id, endpoint, p256dh, auth)
      values (9000001, 9000001, 'https://push.example.test/migration-guard', 'p256dh-key', 'auth-key');
    $seed$;
  end if;
end $$;

-- Story 9.1 (listings, review finding F5). Same `to_regclass` guard, same
-- reasoning as the two blocks above: THIS story's own migration is what
-- creates `listings`, so it holds nothing before it applies, and the guard
-- is trivially safe for its own migration. From the next story's baseline
-- onward this seeds and captures a live `shadchan`-branch row like every
-- other table here — closing the blind spot in the same diff that adds the
-- table, before 9.2 (single-branch policies) and 9.3 (the dignity-floor
-- withdrawal lock) both alter this table's RLS against what would otherwise
-- still be an empty one. Anchored on account 9000002 (the `shadchanus`
-- account the connections block above already seeds) — `published_by_member_id`
-- is left null (nullable, `on delete set null`) since no member row exists
-- for that account yet and none of this story's constraints require one.
-- 9.2 owns seeding its own `single`-branch row when it adds that branch's
-- write policies, mirroring this same story-adds-its-own-seed convention
-- rather than this block pre-empting it.
do $$
begin
  if to_regclass('public.listings') is not null then
    execute $seed$
      insert into public.listings (id, account_id, listing_type, shadchan_name, shadchan_area, shadchan_contact_info)
      values (9000001, 9000002, 'shadchan', 'Migration Guard Shadchan', 'Lakewood', '555-0100');
    $seed$;
  end if;
end $$;

-- Story 9.3 (listing_withdrawal_locks, review finding F5). Same
-- `to_regclass` guard, same reasoning as `listings` immediately above: THIS
-- story's own migration is what creates `listing_withdrawal_locks`, so it
-- holds nothing before it applies, and the guard is trivially safe for its
-- own migration. From the next story's baseline onward this seeds and
-- captures a live lock row like every other table here — closing the blind
-- spot in the SAME diff that adds the table, per the convention
-- `listings`' own comment above states and this table's schema comment
-- (01_tables.sql, Dev Notes "Why a lock table") repeats. Anchored on the
-- single (9000001, account 9000001) the `singles` seed above already
-- creates — the lock's own composite FK (`account_id, single_id`
-- references `singles(account_id, id)`) is satisfied by that existing row.
do $$
begin
  if to_regclass('public.listing_withdrawal_locks') is not null then
    execute $seed$
      insert into public.listing_withdrawal_locks (account_id, single_id)
      values (9000001, 9000001);
    $seed$;
  end if;
end $$;

-- Story 9.5 (share_links, share_access_log). Same `to_regclass` guard, same
-- reasoning as `listings`/`listing_withdrawal_locks` above: THIS story's own
-- migration is what creates both tables, so they hold nothing before it
-- applies, and the guard is trivially safe for its own migration. From the
-- next story's baseline onward this seeds and captures a live share link
-- (and one access-log row against it) like every other table here — closing
-- the blind spot in the SAME diff that adds the tables, per the convention
-- `listings` states, rather than leaving it for the completeness check below
-- to catch once this migration is deployed and `share_links` starts
-- resolving. Anchored on the single (9000001, account 9000001) the `singles`
-- seed above already creates. `token` mirrors `connection_invites.token_hash`
-- above: a fixed digest, not a guessable literal, even though (unlike a
-- connection invite) this one is never treated as a secret by this fixture.
do $$
begin
  if to_regclass('public.share_links') is not null then
    execute $seed$
      insert into public.share_links (id, account_id, single_id, created_by_member_id, token, include_photo, expires_at)
      values (
          9000001, 9000001, 9000001, 9000001,
          encode(extensions.digest('migration-guard-share-link', 'sha256'), 'hex'),
          true, now() + interval '7 days'
      );

      insert into public.share_access_log (id, share_link_id, resource, ip_hash, user_agent, duration_ms)
      values (
          9000001, 9000001, 'profile',
          encode(extensions.digest('127.0.0.1', 'sha256'), 'hex'),
          'Mozilla/5.0 (Migration Guard)', 42
      );
    $seed$;
  end if;
end $$;

-- Epic 11 (trusted_senders). Same `to_regclass` guard, same reasoning as
-- `share_links`/`share_access_log` above: THIS migration is what creates the
-- table, so it holds nothing before it applies, and the guard is trivially
-- safe for its own migration. From the next story's baseline onward this
-- seeds and captures a live trust row like every other table here — closing
-- the blind spot in the SAME diff that adds the table, per the convention
-- `share_links` states, rather than leaving it for the completeness check
-- below to catch once this migration is deployed. Anchored on the household
-- account (9000001) the `accounts` seed above already creates.
do $$
begin
  if to_regclass('public.trusted_senders') is not null then
    execute $seed$
      insert into public.trusted_senders (id, account_id, created_by_member_id, email)
      values (9000001, 9000001, 9000001, 'seminary.office@example.test');
    $seed$;
  end if;
end $$;

-- Open signup (signup_intents). Same `to_regclass` guard, same reasoning as
-- every other table above: THIS migration is what creates the table, so it
-- holds nothing before it applies, and the guard is trivially safe for its
-- own migration. From the next story's baseline onward this seeds and
-- captures a live, unconsumed, unexpired intent like every other table
-- here — closing the blind spot in the SAME diff that adds the table. Not
-- account-scoped (the table has no account_id — see its own comment,
-- 01_tables.sql), so this needs no anchor row from the seeds above.
do $$
begin
  if to_regclass('public.signup_intents') is not null then
    execute $seed$
      insert into public.signup_intents (id, email, expires_at)
      values (9000001, 'oauth.guard@example.test', now() + interval '10 minutes');
    $seed$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Snapshot. `identity_signals` is captured last and on purpose: nothing
-- inserts it directly — the `sync_shidduch_signals` trigger derives it from
-- the rows above. It is the SECOND-ORDER loss surface, the one that a
-- migration can blank while every table it names still looks intact.
--
-- `member_state` and `pipeline_transitions` are the two the guard was
-- structurally unable to reach until `capture()` learned to read a primary key
-- (see its comment above), and they are the two it could least afford to miss:
-- `20260729095558_backfill_member_state.sql` — one of the two near-misses this
-- whole guard was built for — is named after the first. Both are captured the
-- same way everything else is; neither needs its own seed:
--
--   * `member_state` is written by exactly one path, `activate_context_for()`,
--     reached here through the `activate_first_context_trigger` on the two
--     `account_members` inserts above. Seeding it by hand would be seeding a
--     shape production cannot produce; letting the trigger write it is the
--     production shape. A run that captured zero rows would mean that trigger
--     stopped firing, which is itself the bug — so it is asserted, below.
--   * `pipeline_transitions` is transitions-as-data (AD-4): its rows ARE the
--     legal pipeline edges and they arrive with the migrations, not with a
--     seed. Capturing them turns "a migration recreated the transition table
--     and lost an edge" — silent, and fatal to transition_shidduch() — into a
--     named failure.
-- ---------------------------------------------------------------------------

-- Anti-vacuity: a snapshot of an empty table asserts nothing, and both of
-- these are populated by machinery (a trigger, a migration seed) rather than
-- by this file, so "it was empty" is a real failure mode rather than a
-- hypothetical one. Fail here, where the cause is obvious, rather than let the
-- guard report a serene PASS over two tables it never saw a row of.
do $$
declare
    v_member_state bigint := (select count(*) from public.member_state);
    v_transitions bigint := (select count(*) from public.pipeline_transitions);
begin
    if v_member_state = 0 then
        raise exception 'migration data-safety fixture: public.member_state is empty — '
                        'activate_first_context_trigger did not write it for the seeded '
                        'memberships, so the guard would snapshot nothing.';
    end if;
    if v_transitions = 0 then
        raise exception 'migration data-safety fixture: public.pipeline_transitions is empty — '
                        'the baseline migrations did not seed the legal pipeline edges, so the '
                        'guard would snapshot nothing.';
    end if;
end;
$$;
-- Capture every base table that exists in `public` at this baseline —
-- derived from the catalog, not hand-listed. `capture()` needs nothing but a
-- table name (see its own comment above), so there is no reason to maintain
-- a parallel list of names that can drift from the schema. This used to be
-- ~30 `select migration_guard.capture('table');` lines, one hand-added per
-- story, and it went stale twice in exactly the way a hand-maintained list
-- does: `invites` was missing through the whole of Epic 6, and by the time
-- this comment was written the list was ALSO silently missing `configuration`,
-- `inbox_items`, `date_records`, `shidduch_schools`, `connection_invites`,
-- `share_links` and `share_access_log` — seven more tables this guard was
-- never protecting, discovered only while fixing the Epic 8 connections
-- outage (see .claude/rules/ for the incident). A table added to
-- `01_tables.sql` from this diff forward is captured automatically, whether
-- or not the story that adds it remembers this file exists.
--
-- `relkind = 'r'`: ordinary base tables only — never a view (`v`), which
-- holds no data of its own to protect, and this schema has no partitioned
-- tables (`p`) today. `migration_guard` itself is a different schema and
-- never enters this loop.
do $$
declare
    v_table text;
begin
    for v_table in
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'r'
         order by c.relname
    loop
        perform migration_guard.capture(v_table);
    end loop;
end;
$$;

-- What derivation cannot give us: MEANINGFUL rows. `capture()` protects
-- whatever a table already holds, but nothing in the catalog can invent a
-- production-shaped seed for a table nobody has inserted into — that step is
-- unavoidably a human arguing "this is what a real row looks like", the same
-- work the rest of this file already does for 30-odd tables. `configuration`
-- turned out NOT to need an entry here despite looking like an obvious
-- candidate (a schema-ready, seemingly-unwired singleton): its default row IS
-- inserted, by `20260211194545_app_configuration.sql`, so the dynamic capture
-- loop above already snapshots it like any other table — checked by running
-- this fixture and reading migration_guard.snapshot back, not assumed from
-- reading the schema. `date_records` is the honest remaining exception, not a
-- loophole: no migration and no UI path writes it (verified by grep across
-- `src/` and every migration), so a fabricated row would seed a shape
-- production cannot actually produce — worse than no row, because a later
-- migration could shape itself around fixture data no real deploy will ever
-- match.
insert into migration_guard.empty_by_design (table_name, reason) values
    ('date_records', 'Schema-ready dating-history table (01_tables.sql: "powers dedupe later, '
                      'Epic-4; no logic is built now"). No UI reads or writes it, and no migration '
                      'or seed inserts a row. Seed once a story wires it up.');

-- The completeness check itself: every `public` base table just captured
-- above must have at least one snapshot row, or be declared empty_by_design
-- with a reason. This is the strongest cheap alternative to seeding every
-- table's data automatically (which the previous comment explains is not
-- possible) — it cannot invent a realistic row, but it CAN refuse to stay
-- quiet about a table nobody has ever seeded, converting the failure mode
-- that hid `invites` for two epics from silent to loud. A table failing this
-- check is a real gap: either add a production-shaped INSERT for it above
-- (preferred — see the many examples in this file), or add it to
-- `empty_by_design` with a reason, argued the same way the two entries above
-- are.
do $$
declare
    v_unseeded text[];
begin
    select array_agg(t.relname order by t.relname)
      into v_unseeded
      from pg_class t
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relkind = 'r'
       and not exists (
           select 1 from migration_guard.snapshot s where s.table_name = t.relname
       )
       and not exists (
           select 1 from migration_guard.empty_by_design e where e.table_name = t.relname
       );

    if array_length(v_unseeded, 1) > 0 then
        raise exception 'migration data-safety fixture: % table(s) exist in the baseline schema with '
            'NO captured row and no migration_guard.empty_by_design declaration: %. An unseeded, '
            'undeclared table is invisible to assert.sql — exactly the blind spot that let '
            '''invites'' (Epic 6) and several other tables go unprotected. Add a production-shaped '
            'INSERT for it above (preferred), or declare it empty_by_design with a reason if it '
            'genuinely holds nothing in production today.',
            array_length(v_unseeded, 1), array_to_string(v_unseeded, ', ');
    end if;
end;
$$;

-- Anti-vacuity floor: a regression that zeroed out most of this file's INSERT
-- statements (but left a HANDFUL, e.g. only the trigger-derived tables above)
-- would still pass the completeness check — every captured table has >= 1
-- row — and still report a technically-true PASSED banner while verifying a
-- small fraction of what it used to. 63 rows across 28 tables is the known-
-- good count this file produces today (see .claude/rules/ for how that was
-- established); the floor here is deliberately far below that — loose enough
-- to never block a legitimate future edit that removes one table's seed, tight
-- enough to catch the file being gutted back to a handful of rows.
do $$
declare
    v_tables bigint := (select count(distinct table_name) from migration_guard.snapshot);
    v_rows bigint := (select coalesce(sum(multiplicity), 0) from migration_guard.snapshot);
begin
    if v_tables < 20 or v_rows < 40 then
        raise exception 'migration data-safety fixture: only % row(s) across % table(s) were '
            'captured (expected at least 40 rows across 20 tables). The seed data likely '
            'regressed — this run would otherwise report a PASS without actually rehearsing much '
            'of anything.', v_rows, v_tables;
    end if;
end;
$$;

commit;
