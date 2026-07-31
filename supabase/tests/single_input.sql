--
-- The single's input (Story 6.4) — database test suite.
--
-- Covers AC 1, AC 2, AC 3, AC 4, AC 7: the narrow INSERT carve-out (own
-- visible suggestion only — not a sibling's, not a not-yet-visible
-- pipeline_state, not any other `kind`), server-set unforgeable attribution,
-- append-only for EVERY role including the single's own author and a
-- `parent_admin` (a deliberate narrowing of Story 5.7's review-fix — Dev
-- Notes "Append-only — decided, against a shipped nuance"), the single's
-- own narrow SELECT carve-out (their own `single_input` rows only, nothing
-- else), and the untouched moderation path for `note`.
--
-- Arrange uses the shared "two siblings, one household" fixture
-- (dbSuiteHelpers.ts, siblingHouseholdFixtureSql()) — spliced in by
-- single_input.test.ts BEFORE this file, exactly like 6.2/6.3's own suites.
-- This file only adds what is specific to THIS story's assertions: one
-- look_into+shared suggestion for Leah (writable), one new+shared
-- suggestion for Leah (unwritable — outside is_single_visible_state), one
-- look_into+shared suggestion for Rivka with her own single_input row
-- already on it (the sibling-exclusion fixture), and one parent-authored
-- `note` plus one parent-authored `status_change` row on Leah's own visible
-- suggestion (the "not the parent-seeded note/status_change rows" fixture,
-- and the note doubles as the untouched-moderation-path regression).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (single_input.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted DO blocks, so
-- every id a DO block needs is threaded through the `ids` temp table
-- instead (established by single_row_scoping.sql / single_field_scoping.sql).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Denial assertions name the error they expect (same helper, same reasoning,
-- as single_row_scoping.sql — see its comment for the demonstration).
--
-- `exception when others then insert into results values (…, true, sqlerrm)`
-- records a PASS for ANY failure, so it cannot tell "the WITH CHECK refused
-- me" from "the table was renamed" or "the trigger threw". Every INSERT
-- denial below is a row-security violation on public.interactions and says
-- so, so a different failure fails the assertion.
-- ---------------------------------------------------------------------------
create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_expected_message_like text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate
      and p_actual_message like p_expected_message_like,
    format('sqlstate %s %L (expected %s matching %L)',
           p_actual_sqlstate, p_actual_message,
           p_expected_sqlstate, p_expected_message_like)
  );
end;
$$;

-- The one denial in this file that RLS may satisfy either way (see AC 2/AC 7
-- below): the insert is allowed to succeed with the caller's own id
-- substituted, OR to be refused outright — but only by the row-security
-- policy on public.interactions. Any other exception is a failure.
create function pg_temp.denied_row_security(
  p_name text, p_actual_sqlstate text, p_actual_message text
) returns void language plpgsql as $$
begin
  perform pg_temp.denied(
    p_name, '42501',
    'new row violates row-level security policy for table "interactions"',
    p_actual_sqlstate, p_actual_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (continued from the shared fixture, run as postgres/superuser):
-- three shidduchim (Leah's writable + unwritable, Rivka's writable).
-- ---------------------------------------------------------------------------
insert into ids values
  ('account_id', :'sibling_fixture_account_id'),
  ('parent_member_id', :'sibling_fixture_parent_member_id'),
  ('leah_member_id', :'sibling_fixture_leah_member_id'),
  ('rivka_member_id', :'sibling_fixture_rivka_member_id'),
  ('leah_single_id', :'sibling_fixture_leah_single_id'),
  ('rivka_single_id', :'sibling_fixture_rivka_single_id');

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Visible Suggestion', 'shared', 'look_into')
returning id as leah_visible_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah New Suggestion', 'shared', 'new')
returning id as leah_new_id \gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Rivka Visible Suggestion', 'shared', 'look_into')
returning id as rivka_visible_id \gset

insert into ids values
  ('leah_visible_id', :'leah_visible_id'),
  ('leah_new_id', :'leah_new_id'),
  ('rivka_visible_id', :'rivka_visible_id');

-- ---------------------------------------------------------------------------
-- Rivka (single) seeds her own single_input row on her own visible
-- suggestion — the sibling-exclusion fixture for Leah's own SELECT checks
-- below. Inserted AS Rivka (not as postgres) so the attribution trigger
-- stamps her own real membership id, not NULL.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('shidduch', (select value::bigint from ids where name = 'rivka_visible_id'), 'shidduch', 'single_input', 'Rivka''s own input on her own suggestion')
returning id as rivka_single_input_id \gset

reset role;

insert into ids values ('rivka_single_input_id', :'rivka_single_input_id');

-- ---------------------------------------------------------------------------
-- parent_admin seeds a `note` and a `status_change` row on Leah's own
-- visible suggestion — both denied to Leah under 6.3's default deny, and
-- the note doubles as AC 3's "moderation for `note` is untouched" positive
-- control later in this file.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'note', 'Parent note on Leah''s own visible suggestion')
returning id as parent_note_id \gset

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'status_change', 'Status changed on Leah''s own visible suggestion')
returning id as parent_status_change_id \gset

reset role;

insert into ids values
  ('parent_note_id', :'parent_note_id'),
  ('parent_status_change_id', :'parent_status_change_id');

-- ---------------------------------------------------------------------------
-- As Leah (single) from here on.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

-- AC 1 / AC 2: inserting on her own visible suggestion, WITHOUT naming
-- actor_member_id, succeeds and stores her OWN membership id.
do $$
declare
  v_id bigint;
  v_actor_member_id bigint;
  v_leah_member_id bigint := (select value::bigint from ids where name = 'leah_member_id');
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'single_input', 'I really like this suggestion')
  returning id, actor_member_id into v_id, v_actor_member_id;
  insert into ids values ('leah_single_input_id', v_id::text);
  insert into results values (
    'AC 1/AC 2: single inserts single_input on her own visible suggestion, stores her own actor_member_id',
    v_actor_member_id = v_leah_member_id,
    format('actor_member_id=%s (expected %s)', v_actor_member_id, v_leah_member_id)
  );
end $$;

-- AC 2/AC 7: a payload naming someone else's actor_member_id either raises
-- or stores the caller's OWN id — the attribution trigger overwrites
-- unconditionally before WITH CHECK evaluates, so this succeeds today, but
-- either outcome satisfies the AC; a stored FORGED id is the only failure.
do $$
declare
  v_id bigint;
  v_actor_member_id bigint;
  v_leah_member_id bigint := (select value::bigint from ids where name = 'leah_member_id');
  v_rivka_member_id bigint := (select value::bigint from ids where name = 'rivka_member_id');
begin
  insert into public.interactions (target_type, target_id, scope, kind, body, actor_member_id)
  values (
    'shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'single_input',
    'attempted forged attribution', v_rivka_member_id
  )
  returning id, actor_member_id into v_id, v_actor_member_id;
  insert into ids values ('leah_forged_single_input_id', v_id::text);
  insert into results values (
    'AC 2/AC 7: a forged actor_member_id in the insert payload never lands (trigger overwrites before WITH CHECK evaluates)',
    v_actor_member_id = v_leah_member_id,
    format('stored actor_member_id=%s (leah=%s, rivka=%s)', v_actor_member_id, v_leah_member_id, v_rivka_member_id)
  );
exception when others then
  -- Either outcome satisfies the AC — but only these two. A raise from
  -- anywhere OTHER than the row-security policy (a broken trigger, a renamed
  -- column) is a failure, not a denial.
  perform pg_temp.denied_row_security(
    'AC 2/AC 7: a forged actor_member_id in the insert payload never lands (trigger overwrites before WITH CHECK evaluates)',
    sqlstate, sqlerrm
  );
end $$;

-- AC 1/AC 7: inserting on her own suggestion that is NOT in a
-- single-visible pipeline_state ('new') raises.
do $$
declare
  v_name constant text := 'AC 1/AC 7: single''s INSERT on her own NOT-yet-visible (new) suggestion is denied by row-level security on public.interactions';
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_new_id'), 'shidduch', 'single_input', 'a single trying to write on a new suggestion');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- AC 1/AC 7: inserting on a SIBLING's visible suggestion raises.
do $$
declare
  v_name constant text := 'AC 1/AC 7: single''s INSERT on a sibling''s visible suggestion is denied by row-level security on public.interactions';
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'rivka_visible_id'), 'shidduch', 'single_input', 'a single trying to write on her sibling''s suggestion');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- AC 7: inserting kind = 'note' — even on her own visible suggestion —
-- raises. The single-only INSERT policy requires kind = 'single_input'; the
-- general INSERT policy denies every single-role caller outright (6.3).
do $$
declare
  v_name constant text := 'AC 7: single''s INSERT of kind = ''note'' on her own visible suggestion is denied by row-level security on public.interactions';
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'note', 'a single trying to write a note');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- AC 3/AC 7: updating the BODY of her own single_input row affects ZERO
-- rows (not a raise) — the `using`-half edit is what makes this a silent
-- filter rather than a row-security-violation exception.
do $$
declare v_rows_affected int;
begin
  update public.interactions set body = 'revised after the fact'
  where id = (select value::bigint from ids where name = 'leah_single_input_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC 3/AC 7: single''s UPDATE (body) on her OWN single_input row affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- AC 3/AC 7: soft-deleting her own single_input row likewise affects ZERO
-- rows — there is no retraction path (Dev Notes' named cost).
do $$
declare v_rows_affected int;
begin
  update public.interactions set deleted_at = now()
  where id = (select value::bigint from ids where name = 'leah_single_input_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC 3/AC 7: single''s UPDATE (deleted_at) on her OWN single_input row affects zero rows (no retraction path)',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- AC 4/AC 7: `select * from interactions` returns ONLY her own single_input
-- rows (the two inserted above) — never the sibling's, never the
-- parent-seeded note/status_change rows.
insert into results (name, passed)
select 'AC 4/AC 7: single reads exactly her own two single_input rows from public.interactions, nothing else',
       (select count(*) from public.interactions) = 2
       and not exists (
         select 1 from public.interactions
         where id not in (
           (select value::bigint from ids where name = 'leah_single_input_id'),
           (select value::bigint from ids where name = 'leah_forged_single_input_id')
         )
       );

insert into results (name, passed)
select 'AC 4/AC 7: single does NOT see her sibling''s single_input row',
       not exists (
         select 1 from public.interactions
         where id = (select value::bigint from ids where name = 'rivka_single_input_id')
       );

insert into results (name, passed)
select 'AC 4/AC 7: single does NOT see the parent-seeded note row on her own suggestion',
       not exists (
         select 1 from public.interactions
         where id = (select value::bigint from ids where name = 'parent_note_id')
       );

insert into results (name, passed)
select 'AC 4/AC 7: single does NOT see the parent-seeded status_change row on her own suggestion',
       not exists (
         select 1 from public.interactions
         where id = (select value::bigint from ids where name = 'parent_status_change_id')
       );

insert into results (name, passed)
select 'AC 4/AC 7: single''s single_input rows never carry a forged (sibling''s) actor_member_id',
       not exists (
         select 1 from public.interactions
         where actor_member_id = (select value::bigint from ids where name = 'rivka_member_id')
           and id in (
             (select value::bigint from ids where name = 'leah_single_input_id'),
             (select value::bigint from ids where name = 'leah_forged_single_input_id')
           )
       );

-- AC 7: public.interactions_summary (security_invoker = on) returns the
-- SAME set through the SAME RLS — never a wider or narrower one.
insert into results (name, passed)
select 'AC 7: public.interactions_summary returns the same set (2 rows) for the single as the base table',
       (select count(*) from public.interactions_summary) = 2;

reset role;

-- ---------------------------------------------------------------------------
-- As parent_admin from here on.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

-- The other half of the four "the single does NOT see X" assertions above:
-- each of them is equally green when X was never inserted. The parent_admin's
-- own read policy is untouched by this story, so it sees all five fixture
-- rows — the single's narrower set is attributable to her role and nothing
-- else.
insert into results (name, passed)
select 'AC 4/AC 7 control: the parent sees all five fixture interactions rows (the single''s two are RLS narrowing, not a thin fixture)',
       (select count(*) from public.interactions) = 5
       and (select count(*) from public.interactions where id in (
             (select value::bigint from ids where name = 'rivka_single_input_id'),
             (select value::bigint from ids where name = 'parent_note_id'),
             (select value::bigint from ids where name = 'parent_status_change_id'),
             (select value::bigint from ids where name = 'leah_single_input_id'),
             (select value::bigint from ids where name = 'leah_forged_single_input_id')
           )) = 5;

-- AC 2: the single's single_input row is readable to the parent, with the
-- correct actor_member_id/created_at — the untouched account-scoped
-- interactions read policy, exactly as before this story.
do $$
declare
  v_actor_member_id bigint;
  v_created_at timestamptz;
  v_leah_member_id bigint := (select value::bigint from ids where name = 'leah_member_id');
  v_found boolean;
begin
  select actor_member_id, created_at into v_actor_member_id, v_created_at
  from public.interactions
  where id = (select value::bigint from ids where name = 'leah_single_input_id');
  v_found := found;
  insert into results values (
    'AC 2/AC 5: parent_admin reads the single''s single_input row with the correct actor_member_id and a real created_at',
    v_found and v_actor_member_id = v_leah_member_id and v_created_at is not null,
    format('found=%s actor_member_id=%s created_at=%s', v_found, v_actor_member_id, v_created_at)
  );
end $$;

-- AC 3/AC 7: a parent_admin can never INSERT a single_input row either —
-- the general INSERT policy's `kind <> 'single_input'` clause denies every
-- non-single path, and the single-only policy denies on role.
do $$
declare
  v_name constant text := 'AC 3/AC 7: parent_admin''s INSERT of a single_input row is denied by row-level security on public.interactions';
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', (select value::bigint from ids where name = 'leah_visible_id'), 'shidduch', 'single_input', 'a parent trying to speak as the single');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied_row_security(v_name, sqlstate, sqlerrm);
end $$;

-- AC 3/AC 7: updating the single's single_input row affects ZERO rows —
-- the narrowed escape denies EVERY role, not merely the single's own.
do $$
declare v_rows_affected int;
begin
  update public.interactions set body = 'parent tries to correct the single''s words'
  where id = (select value::bigint from ids where name = 'leah_single_input_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC 3/AC 7: parent_admin''s UPDATE (body) on the single''s single_input row affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- AC 3/AC 7: soft-deleting the single's single_input row likewise affects
-- ZERO rows for the parent — no owning-role moderation escape survives.
do $$
declare v_rows_affected int;
begin
  update public.interactions set deleted_at = now()
  where id = (select value::bigint from ids where name = 'leah_single_input_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC 3/AC 7: parent_admin''s UPDATE (deleted_at) on the single''s single_input row affects zero rows',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- AC 3: the moderation path for `note` is completely untouched by this
-- story — a parent_admin updating a note they authored still works. This
-- is what stops Task 2's clause edit from over-reaching: a guard that
-- denied every kind, not just single_input, would fail this check.
do $$
declare v_rows_affected int;
begin
  update public.interactions set body = 'note, corrected'
  where id = (select value::bigint from ids where name = 'parent_note_id');
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'AC 3: parent_admin''s UPDATE on a note THEY authored still succeeds (moderation for note is untouched)',
    v_rows_affected = 1, 'rows affected: ' || v_rows_affected
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
