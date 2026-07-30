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
-- ===========================================================================

begin;

drop schema if exists migration_guard cascade;
create schema migration_guard;

-- One row per seeded row, holding the whole row as jsonb. Deliberately
-- generic: it records what existed without naming the columns, so it keeps
-- working as the schema evolves and so `assert.sql` can detect a column
-- disappearing rather than only checking columns someone remembered to list.
create table migration_guard.snapshot (
    table_name text not null,
    row_id bigint not null,
    row_json jsonb not null,
    primary key (table_name, row_id)
);

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

create function migration_guard.capture(p_table text) returns void
language plpgsql
as $$
begin
    execute format(
        'insert into migration_guard.snapshot (table_name, row_id, row_json)
         select %L, t.id, to_jsonb(t) from public.%I t
         on conflict (table_name, row_id) do update set row_json = excluded.row_json',
        p_table, p_table);
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

insert into public.singles (
    id, account_id, first_name_en, first_name_he, last_name_en, last_name_he,
    gender, dob, community, status
)
values (
    9000001, 9000001, 'Leah', 'לאה', 'Guardstein', 'גוארדשטיין',
    'female', date '2003-04-11', 'Yeshivish', 'active'
);

insert into public.shadchanim (id, account_id, name, name_he, location, notes)
values (
    9000001, 9000001, 'Mrs. Bracha Katz', 'מרת ברכה כץ', 'Lakewood',
    'Prefers WhatsApp. Knows the Rosenberg family well.'
);

-- The five shapes that matter for `parents_en`/`parents_he`. All 24 rows in
-- production are the first shape (`R' <father> & <mother>`, 19-27 chars,
-- `' & '` splitting into two non-empty halves); the rest are the cases a
-- backfill has to not lose.
insert into public.shidduchim (
    id, account_id, single_id, shadchan_id,
    name_en, name_he, parents_en, parents_he,
    seminary_en, shul_en, location_en, age, height,
    pipeline_state, origin, visibility, owner_member_id
)
values
    -- 1. The production shape.
    (9000001, 9000001, 9000001, 9000001,
     'Yosef Rosenberg', 'יוסף רוזנברג',
     'R'' Yaakov Rosenberg & Chaya Rosenberg', null,
     'Mir', 'Bais Medrash Govoha', 'Lakewood', 24, '5''10"',
     'new', 'manual', 'shared', 9000001),
    -- 2. The production shape again, different family.
    (9000002, 9000001, 9000001, 9000001,
     'Shmuel Weiss', 'שמואל וייס',
     'R'' Dovid Weiss & Rivka Weiss', null,
     'Ner Yisroel', null, 'Baltimore', 25, '6''0"',
     'look_into', 'manual', 'shared', 9000001),
    -- 3. No `' & '` separator. The ruling: the whole trimmed value goes to
    --    the father half and the mother half stays NULL — never dropped.
    (9000003, 9000001, 9000001, null,
     'Mendel Friedman', null,
     'Mendel Friedman Sr', null,
     null, null, 'Monsey', 23, null,
     'new', 'manual', 'shared', null),
    -- 4. Hebrew only. Zero rows in production today, but the migration must
    --    not be selectively correct.
    (9000004, 9000001, 9000001, 9000001,
     null, 'אברהם לוי',
     null, 'ר׳ יעקב לוי & חיה לוי',
     null, null, null, 26, null,
     'new', 'manual', 'shared', 9000001),
    -- 5. Control: no parents at all. Must stay empty, not acquire a value.
    (9000005, 9000001, 9000001, null,
     'Anonymous Prospect', null,
     null, null,
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

insert into public.resumes (id, account_id, shidduchim_id, files, photos, extracted)
values (
    9000001, 9000001, 9000001,
    '[{"path": "9000001/resume.pdf", "title": "resume.pdf"}]'::jsonb,
    '[]'::jsonb,
    '{"age": 24}'::jsonb
);

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

-- ---------------------------------------------------------------------------
-- Snapshot. `identity_signals` is captured last and on purpose: nothing
-- inserts it directly — the `sync_shidduch_signals` trigger derives it from
-- the rows above. It is the SECOND-ORDER loss surface, the one that a
-- migration can blank while every table it names still looks intact.
-- ---------------------------------------------------------------------------
select migration_guard.capture('accounts');
select migration_guard.capture('account_members');
select migration_guard.capture('members');
select migration_guard.capture('singles');
select migration_guard.capture('shadchanim');
select migration_guard.capture('shidduchim');
select migration_guard.capture('redts');
select migration_guard.capture('references');
select migration_guard.capture('reference_links');
select migration_guard.capture('resumes');
select migration_guard.capture('interactions');
select migration_guard.capture('tasks');
select migration_guard.capture('identity_signals');

commit;
