--
-- Note authorship and moderation (Story 3.6) — database test suite.
--
-- Story 3.6 splits the single `for all` interactions policy into three
-- per-command policies (05_policies.sql) and adds `can_moderate_note()`
-- (02_functions.sql), ANDed into the UPDATE policy's `using`/`with check`
-- as `kind <> 'note' or public.can_moderate_note(actor_member_id)`. This
-- suite is AC 4's eight-check negative matrix plus AC 5's four
-- `interactions_summary` view checks, in one file, because both the policy
-- and the view call the SAME function and must never disagree.
--
-- Story 5.7's review-fix pass (finding F2) widened that escape to `kind not
-- in ('note', 'single_input') or public.can_moderate_note(...)`, extended
-- here as checks (g2) and AC 5-single rather than a separate suite — same
-- function, same policy, same reason the original four AC 5 checks live
-- alongside AC 4's matrix.
--
-- "Zero rows affected" (checks a/b/f) is asserted through
-- `GET DIAGNOSTICS ... ROW_COUNT` inside a DO block, never through
-- PostgREST: a 0-row UPDATE there returns 404/PGRST116, indistinguishable
-- from a policy error (contract §13 rule 4).
--
-- Falsifiability record (contract §13 rule 2 — every check must be provably
-- red before it is shown green):
--   (a)/(c)/(g) — fail if the UPDATE policy's account-scope conjunct or the
--     `kind not in ('note', 'single_input')` escape is dropped (every
--     update would then either 0-row or raise).
--   (g2)/AC 5-single — the mirror-image proof for Story 5.7's widened
--     escape: fails (wrongly passes with rows=1, or reports can_moderate =
--     true) if `single_input` were left out of the escape's `kind not in
--     (...)` list on either side (the UPDATE policy or
--     interactions_summary), or if the two ever disagreed with each other.
--   (b) — fails (wrongly passes with rows=1) if `can_moderate_note()` omits
--     the author check, or if a second permissive UPDATE policy were added
--     instead of replacing the `for all` policy (the OR-widening hazard
--     05_policies.sql documents in writing next to `account_members`).
--   (d) — fails if the owning-role branch hardcodes `am.role = 'parent_admin'`
--     instead of calling `is_owning_membership_role(am.role)`: a
--     self-managing household's only owning membership is `self_manager`.
--   (e) — fails if authorship were resolved as
--     `actor_member_id = current_member_id()` instead of joining
--     `account_members` on `id = p_actor_member_id` and comparing
--     `user_id = auth.uid()`: `account_members_account_user_active_uq`
--     (01_tables.sql) is partial (`where status = 'active'`), so the
--     archived and the freshly re-added row for the same person coexist
--     with different ids.
--   (f) — the one-login/two-contexts shape the contract requires (§13 rule
--     3); two disjoint users would pass without ever exercising
--     `current_context_id()`. CORRECTED CLAIM (post-review — the previous
--     revision of this comment asserted (f) also isolates the UPDATE
--     policy's own account-scope `using` conjunct; that is false and was
--     disproved live): Postgres applies the SELECT policy to the row-read
--     half of an `UPDATE … WHERE`, so a row hidden from SELECT never reaches
--     the UPDATE policy's own `using` at all — replacing the UPDATE policy's
--     entire `using` visibility predicate with a bare `true` leaves all
--     checks in this file green, (f) included, because SELECT alone already
--     hides U's A2 note while active in B. (f) is therefore a same-conclusion
--     regression guard against 3.5's SELECT policy (which (f)'s fixture also
--     happens to exercise via an OWNING-role login, a shape 3.5's own suite
--     does not build), not an isolated proof that UPDATE's account-scope
--     conjunct does independent work — by construction it cannot: 05_policies.sql
--     preserves that conjunct byte-identical to SELECT's, so there is no
--     fixture where SELECT would allow a row and UPDATE's identical conjunct
--     would deny it. The check that DOES isolate the author-or-owning-role
--     clause living in `using` (as opposed to `with check` only) is (b): its
--     note is visible to helper1 via SELECT (same household), so a `using`
--     omission is the only way (b) can still see the row as an UPDATE
--     candidate at all.
--   (h) — see the dedicated comment at that section: implemented against
--     `target_type = 'reference'`, not `'shadchan'` as AC 4's table literally
--     reads, because `shadchanim` remains one of the 11 household-only
--     tables 3-14 left untouched — a `target_type = 'shadchan'` row's
--     account-scope branch requires a `shadchanim` row whose `account_id`
--     equals the active (shadchanus) context, which can never exist. See
--     the comment there for the full reasoning; flagged back to the story
--     owner as a likely contract defect rather than silently "fixed".
--
-- psql does not interpolate :variables inside dollar-quoted DO blocks, so
-- every id a DO block needs is threaded through the `ids` temp table
-- instead (context_resolution.sql / household_scope_lift.sql precedent).
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
-- AC 5(i): the catalog fact — position-independent, checked before any
-- fixture exists.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC 5(i): interactions_summary is created with security_invoker = on',
       exists (
         select 1 from pg_class
         where relname = 'interactions_summary'
           and relnamespace = 'public'::regnamespace
           and 'security_invoker=on' = any (reloptions)
       ),
       (select array_to_string(reloptions, ',') from pg_class where relname = 'interactions_summary');

-- ---------------------------------------------------------------------------
-- AC 2: the catalog fact this AC actually mandates — also position-
-- independent. `pg_policies.cmd` is `INSERT`/`SELECT`/`UPDATE`/`DELETE`/`ALL`
-- per policy row.
--
-- Story 6.4 amendment — why this is two checks now, not one:
-- this used to assert `array_agg(cmd order by cmd) = array['INSERT',
-- 'SELECT', 'UPDATE']`, i.e. the exact MULTISET of commands, which pinned
-- "exactly three policies, one per command". Its own comment listed four
-- distinct things it meant to catch: a `for all` remnant, a fourth policy,
-- a `for delete` policy, and a rename away from this shape.
--
-- Three of those four are permanent invariants. The fourth — "a fourth
-- policy is added" — was over-broad as written: Story 6.4 adds exactly two
-- by design (`"Single reads own input"` SELECT, `"Single adds input on a
-- visible suggestion"` INSERT), the narrow carve-out the dignity floor
-- (FR93 / AD-3, "the single always sees their live prospects and can give
-- input") requires. A cmd-multiset assertion cannot express "these two, and
-- no others" — and it also could never tell a POLICY RENAME apart from the
-- expected shape, since renaming a policy leaves `cmd` untouched.
--
-- Split into (a) the invariant that is genuinely permanent and is what the
-- append-only audit-trail rule rests on, and (b) an exact name→cmd set,
-- which is strictly STRONGER than the old assertion: it still fails on a
-- `for all` remnant, on a `for delete` policy, on an unexpected sixth
-- policy, AND on a rename the old check would have slept through.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC 2(a): interactions carries no ALL policy and no DELETE policy (append-only audit trail; unaffected by Story 6.4)',
       not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'interactions'
           and cmd in ('ALL', 'DELETE')
       ),
       coalesce((
         select string_agg(policyname || ':' || cmd, ', ' order by policyname)
         from pg_policies
         where schemaname = 'public' and tablename = 'interactions'
           and cmd in ('ALL', 'DELETE')
       ), 'none');

insert into results (name, passed, detail)
select 'AC 2(b): interactions carries exactly the five expected named policies — the three account-scoped ones plus Story 6.4''s two single-role carve-outs, and nothing else',
       (
         select array_agg(policyname || ':' || cmd order by policyname)
         from pg_policies
         where schemaname = 'public' and tablename = 'interactions'
       ) = array[
         'Interactions insertable within account and parent visibility:INSERT',
         'Interactions readable within account and parent visibility:SELECT',
         'Interactions updatable by author or owning role:UPDATE',
         'Single adds input on a visible suggestion:INSERT',
         'Single reads own input:SELECT'
       ],
       (
         select string_agg(policyname || ':' || cmd, ', ' order by policyname)
         from pg_policies
         where schemaname = 'public' and tablename = 'interactions'
       );

-- ---------------------------------------------------------------------------
-- Arrange: household A — helper1 (author of most notes), parent_admin1
-- (the owning-role moderator), helper2 (archived out entirely, AC 5(iv)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'a3060001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ina-helper1@test.local',
  '{"first_name":"Chaya","last_name":"Katz"}'::jsonb
);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'a3060001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ina-parentadmin1@test.local',
  '{"first_name":"Miriam","last_name":"Stern"}'::jsonb
);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'a3060001-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ina-helper2@test.local',
  '{"first_name":"Devora","last_name":"Fisch"}'::jsonb
);

delete from public.account_members;

insert into public.accounts (name, kind) values ('INA Household A', 'household') returning id as acct_a \gset
insert into ids values ('acct_a', :'acct_a');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a3060001-0000-0000-0000-000000000001', 'helper', 'active')
returning id as helper1_membership_v1 \gset
insert into ids values ('helper1_membership_v1', :'helper1_membership_v1');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a3060001-0000-0000-0000-000000000002', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a3060001-0000-0000-0000-000000000007', 'helper', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: helper1''s active context is household A', public.current_context_id() = :acct_a;

-- helper1 authors two notes up front: note_a (check a), note_e (checks e / 5(ii)).
insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 1, 'account', 'note', 'helper1''s original note (a)')
returning id as note_a \gset
insert into ids values ('note_a', :'note_a');

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 2, 'account', 'note', 'helper1''s note, pre-archive (e)')
returning id as note_e \gset
insert into ids values ('note_e', :'note_e');

-- ---------------------------------------------------------------------------
-- (a) helper1 updates the note they authored -> 1 row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_a bigint;
  v_rows int;
begin
  select value::bigint into v_note_a from ids where name = 'note_a';
  update public.interactions set body = 'helper1''s edited note (a)' where id = v_note_a;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(a) helper updates the note they authored -> 1 row', v_rows = 1, format('rows=%s', v_rows)
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 1: the column grant is (body, metadata, deleted_at) ONLY — still as
-- helper1, still authoring note_a, so RLS itself is satisfied and any denial
-- below is a column/table-privilege denial, not a policy denial. Note that
-- live Postgres raises `permission denied for table interactions` for the
-- `target_id` attempt (a table-level ACL check short-circuits before a
-- column-specific message is produced), not AC 1's literal "permission
-- denied for column" — both checks assert on `sqlstate = 42501` rather than
-- message text for exactly this reason; the divergence is intentional and
-- documented, not a bug in this suite.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_a bigint;
begin
  select value::bigint into v_note_a from ids where name = 'note_a';
  update public.interactions set target_id = 999 where id = v_note_a;
  insert into results values (
    'AC 1: setting target_id (outside the (body, metadata, deleted_at) grant) raises permission denied',
    false, 'update unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 1: setting target_id (outside the (body, metadata, deleted_at) grant) raises permission denied',
    sqlstate = '42501', sqlerrm
  );
end $$;

do $$
declare
  v_note_a bigint;
begin
  select value::bigint into v_note_a from ids where name = 'note_a';
  delete from public.interactions where id = v_note_a;
  insert into results values (
    'AC 1: deleting an interaction raises permission denied (authenticated holds no DELETE grant)',
    false, 'delete unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 1: deleting an interaction raises permission denied (authenticated holds no DELETE grant)',
    sqlstate = '42501', sqlerrm
  );
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: parent_admin1''s active context is household A', public.current_context_id() = :acct_a;

-- parent_admin1 authors note_b (checks b / 5(iii)) and call_g (check g).
insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 3, 'account', 'note', 'parent_admin1''s note (b)')
returning id as note_b \gset
insert into ids values ('note_b', :'note_b');

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 4, 'account', 'call_logged', 'parent_admin1 logged a call (g)')
returning id as call_g \gset
insert into ids values ('call_g', :'call_g');

-- single_g (checks g2 / AC 5-single, Story 5.7 review finding F2):
-- a kind = 'single_input' row ATTRIBUTED to parent_admin1. Reused the same
-- account-scope shape as call_g/note_b (target_type = 'reference', scope =
-- 'account') rather than the real single_input shape (target_type =
-- 'shidduch') — this suite tests the UPDATE policy's author-or-owning-role
-- ESCAPE, which is identical for both target types; the shidduch-join
-- branch of the visibility predicate is already covered elsewhere
-- (interactions_targets.sql).
--
-- Story 6.4 amendment — why this ONE arrange step runs as `postgres`:
-- Story 6.4 added `and kind <> 'single_input'` to the INSERT policy
-- `"Interactions insertable within account and parent visibility"`, so
-- `single_input` is now creatable through exactly one path — a `single`
-- writing on their own visible suggestion — and through no other role's.
-- parent_admin1 is not that role, so this INSERT, run as `authenticated`,
-- now raises and aborts the whole script under `\set ON_ERROR_STOP on`,
-- degrading the entire suite to an error rather than surfacing anything.
--
-- That is a FIXTURE-AUTHORING accident, not a finding: nothing in this
-- suite is about who may create a single_input row. Every check downstream
-- of this line is about the UPDATE policy's moderation escape, which needs
-- the row to merely EXIST and to carry parent_admin1's actor_member_id.
-- `reset role` runs the insert as `postgres` (BYPASSRLS — verified:
-- rolbypassrls = true, and public.interactions is not FORCE RLS), which
-- skips only the RLS check. Both BEFORE INSERT triggers still fire and are
-- driven by `request.jwt.claims` (a session GUC), not by the Postgres role,
-- so `set_interactions_account_id` and `set_interaction_actor_member_id`
-- still resolve through auth.uid() to parent_admin1 exactly as before —
-- the arranged row is byte-identical to the one this suite used to build.
-- CHECK constraints are NOT bypassed by BYPASSRLS (proven separately in
-- interactions_targets.sql, which is what that suite's AC 5 check is for).
--
-- The anti-vacuity control below is not optional. With the INSERT moved off
-- the RLS path, a future regression that silently produced no row, or a row
-- with a null/foreign actor_member_id, would make BOTH (g2) ("-> 0 rows")
-- and AC 5-single ("can_moderate is false") pass for the wrong reason —
-- a denial test is green whenever its subject does not exist. The control
-- pins existence AND attribution so those two checks cannot go vacuous.
reset role;

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 10, 'account', 'single_input', 'parent_admin1''s single_input row (g2)')
returning id as single_g \gset
insert into ids values ('single_g', :'single_g');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000002","role":"authenticated"}';

-- Control (anti-vacuity, see above): the single_g row exists and is
-- attributed to parent_admin1 — the exact preconditions (g2) and
-- AC 5-single silently depend on.
--
-- Written as `select ... into` + `found` inside a DO block, NOT as
-- `insert into results (...) select ... from public.interactions where id
-- = ...`: that latter shape inserts NO results row at all when the fixture
-- row is missing, which reads as the check having VANISHED rather than
-- failed and leaves the suite green. Same defect, same fix, as the
-- shadchan_stats assertions in single_field_scoping.sql.
do $$
declare
  v_actor bigint;
  v_kind text;
  v_id bigint;
  v_expected bigint;
  v_found boolean;
begin
  v_expected := public.current_member_id();
  select i.id, i.actor_member_id, i.kind into v_id, v_actor, v_kind
  from public.interactions i
  where i.id = (select value::bigint from ids where name = 'single_g');
  v_found := found;

  insert into results values (
    'Arrange control (g2/AC 5-single are vacuous without it): the single_input fixture row exists and carries parent_admin1''s actor_member_id',
    v_found and v_actor is not null and v_actor = v_expected and v_kind = 'single_input',
    format('found=%s id=%s actor_member_id=%s expected=%s kind=%s',
           v_found, v_id, v_actor, v_expected, v_kind)
  );
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (b) helper1 updates a note authored by parent_admin1 -> 0 rows. The
-- `exception when others` handler matters as much as the happy path here:
-- the specific wrong implementation this check exists to catch (the author
-- clause bolted onto `with check` only, never `using`) makes Postgres RAISE
-- a row-security-violation error instead of silently filtering the row out
-- — a raised exception here, with no handler, would abort the whole script
-- under `ON_ERROR_STOP` and degrade the entire suite to a SKIP rather than
-- surfacing this check as RED. `false` on that path — a raised error is
-- itself a fail for a check whose expectation is "0 rows", not "an error".
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_b bigint;
  v_rows int;
begin
  select value::bigint into v_note_b from ids where name = 'note_b';
  update public.interactions set body = 'helper1 tried to edit (b)' where id = v_note_b;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(b) helper updates a note authored by the parent_admin -> 0 rows', v_rows = 0, format('rows=%s', v_rows)
  );
exception when others then
  insert into results values (
    '(b) helper updates a note authored by the parent_admin -> 0 rows', false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (g) helper1 updates a kind = call_logged row authored by parent_admin1 ->
-- 1 row. The `kind not in ('note', 'single_input')` escape means the
-- author-or-owning-role clause never applies here; only the (unchanged)
-- account-scope predicate gates it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_call_g bigint;
  v_rows int;
begin
  select value::bigint into v_call_g from ids where name = 'call_g';
  update public.interactions set body = 'helper1 amended the call log (g)' where id = v_call_g;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(g) helper updates a kind = ''call_logged'' row authored by the parent_admin -> 1 row',
    v_rows = 1, format('rows=%s', v_rows)
  );
end $$;

-- ---------------------------------------------------------------------------
-- (g2) Story 5.7 review finding F2 — helper1 updates a kind = 'single_input'
-- row authored by parent_admin1 -> 0 rows. Proves the OPPOSITE outcome from
-- (g): `single_input` joined the author-or-owning-role bucket alongside
-- `note` (05_policies.sql), because a single_input row is "the single's own
-- words" — the same authorship shape a note has — not a machine-written
-- record like call_logged that any account member may legitimately amend.
-- Before this fix, single_input fell into (g)'s bucket instead and this
-- check would have failed with rows=1.
-- ---------------------------------------------------------------------------
do $$
declare
  v_single_g bigint;
  v_rows int;
begin
  select value::bigint into v_single_g from ids where name = 'single_g';
  update public.interactions set body = 'helper1 tried to rewrite the single''s words (g2)' where id = v_single_g;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(g2) helper updates a kind = ''single_input'' row authored by the parent_admin -> 0 rows',
    v_rows = 0, format('rows=%s', v_rows)
  );
exception when others then
  insert into results values (
    '(g2) helper updates a kind = ''single_input'' row authored by the parent_admin -> 0 rows', false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 5 / view correctness: interactions_summary.can_moderate mirrors the
-- `kind not in ('note', 'single_input')` escape, not just can_moderate_note()
-- -- fails if the view calls can_moderate_note() unconditionally, which
-- would report `false` here (helper1 is neither call_g's author nor an
-- owning role in A) even though (g) just proved the UPDATE policy lets
-- helper1 update this exact row.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 5: interactions_summary.can_moderate is true for a non-note/non-single_input row the caller may still update per the escape',
       coalesce(
         (select can_moderate from public.interactions_summary
          where id = (select value::bigint from ids where name = 'call_g')),
         false
       );

-- ---------------------------------------------------------------------------
-- AC 5-single / Story 5.7 review finding F2: interactions_summary.can_moderate
-- is false for a single_input row the caller may NOT update -- (g2) just
-- proved the UPDATE policy denies helper1 this exact row; a view that still
-- called can_moderate_note() unconditionally, or that omitted single_input
-- from its own escape, would report `true` here.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 5-single: interactions_summary.can_moderate is false for a single_input row the caller may not update',
       coalesce(
         (select can_moderate from public.interactions_summary
          where id = (select value::bigint from ids where name = 'single_g')),
         true
       ) = false;

-- note_c: a fresh note helper1 authors specifically for parent_admin1 to
-- soft-delete in check (c) — kept separate from note_a so (a)'s body edit
-- and (c)'s deleted_at write never observe each other's side effect.
insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 5, 'account', 'note', 'helper1''s note, to be soft-deleted (c)')
returning id as note_c \gset
insert into ids values ('note_c', :'note_c');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (c) parent_admin1 soft-deletes helper1's note -> 1 row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_c bigint;
  v_rows int;
begin
  select value::bigint into v_note_c from ids where name = 'note_c';
  update public.interactions set deleted_at = now() where id = v_note_c;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(c) parent_admin soft-deletes the helper''s note -> 1 row', v_rows = 1, format('rows=%s', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (e) archive-and-re-add: helper1's ORIGINAL membership row (the one that
-- authored note_a / note_e) is archived, and a fresh active row is inserted
-- for the SAME (account_id, user_id) pair — legal because
-- account_members_account_user_active_uq (01_tables.sql) is a PARTIAL
-- unique index (`where status = 'active'`), so the archived and the new
-- active row coexist with different ids. helper1 (same login, same active
-- context A throughout — member_state is untouched by this) then updates
-- note_e, which is still stamped with the OLD (now archived) membership id.
-- ---------------------------------------------------------------------------
update public.account_members
set status = 'archived'
where id = (select value::bigint from ids where name = 'helper1_membership_v1');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a3060001-0000-0000-0000-000000000001', 'helper', 'active')
returning id as helper1_membership_v2 \gset
insert into ids values ('helper1_membership_v2', :'helper1_membership_v2');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: helper1''s active context is still household A after the archive-and-re-add',
       public.current_context_id() = :acct_a;

do $$
declare
  v_note_e bigint;
  v_rows int;
begin
  select value::bigint into v_note_e from ids where name = 'note_e';
  update public.interactions set body = 'helper1''s note, edited post-re-add (e)' where id = v_note_e;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(e) after archive-and-re-add, that login updates the note it authored under the OLD membership id -> 1 row',
    v_rows = 1, format('rows=%s', v_rows)
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 5(ii): the SAME archive-and-re-add login reads can_moderate = true on
-- its own pre-archive note, through interactions_summary.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 5(ii): archive-and-re-add login reads can_moderate = true on its own pre-archive note',
       coalesce(
         (select can_moderate from public.interactions_summary
          where id = (select value::bigint from ids where name = 'note_e')),
         false
       );

-- ---------------------------------------------------------------------------
-- AC 5(iii): a helper reads can_moderate = false on the parent_admin's note.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 5(iii): a helper reads can_moderate = false on the parent_admin''s note',
       coalesce(
         (select can_moderate from public.interactions_summary
          where id = (select value::bigint from ids where name = 'note_b')),
         true
       ) = false;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- AC 5(iv), active-author half: parent_admin1 reads note_c (authored by
-- helper1, who still holds an active membership of A) and sees the real
-- name. note_c's own soft-delete (check c) does not affect author_name.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC 5(iv): author_name equals the author''s first_name last_name for an active author',
       (select author_name from public.interactions_summary
        where id = (select value::bigint from ids where name = 'note_c')) = 'Chaya Katz',
       (select author_name from public.interactions_summary
        where id = (select value::bigint from ids where name = 'note_c'));

reset role;

-- helper2 (the login being fully archived out, never re-added) authors
-- note_g while still active, THEN loses its only membership of A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000007","role":"authenticated"}';

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 6, 'account', 'note', 'helper2''s note, author later archived out (5(iv))')
returning id as note_g \gset
insert into ids values ('note_g', :'note_g');

reset role;

update public.account_members
set status = 'archived'
where account_id = (select value::bigint from ids where name = 'acct_a')
  and user_id = 'a3060001-0000-0000-0000-000000000007';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- AC 5(iv), archived-author half: parent_admin1 reads note_g. helper2's ONLY
-- membership of A is now archived (never re-added), so `members`' own
-- read policy (05_policies.sql :18-29-equivalent — "an ACTIVE membership
-- shared with the caller's active context") denies the LEFT JOIN, and
-- author_name resolves to null rather than an error or a stale/leaked name.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'AC 5(iv): author_name is null when the parent_admin reads a note whose author''s membership has since been archived',
       (select author_name from public.interactions_summary
        where id = (select value::bigint from ids where name = 'note_g')) is null,
       (select author_name from public.interactions_summary
        where id = (select value::bigint from ids where name = 'note_g'));

reset role;

-- ---------------------------------------------------------------------------
-- Arrange (d): household D whose only OWNING membership is self_manager —
-- the shape that fails if can_moderate_note() ever hardcodes
-- `role = 'parent_admin'` instead of calling is_owning_membership_role().
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'a3060001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ina-selfmanager@test.local',
  '{"first_name":"Shira","last_name":"Adler"}'::jsonb
);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (
  'a3060001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ina-helperD@test.local',
  '{"first_name":"Tzvi","last_name":"Roth"}'::jsonb
);

insert into public.accounts (name, kind) values ('INA Household D', 'household') returning id as acct_d \gset
insert into ids values ('acct_d', :'acct_d');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_d, 'a3060001-0000-0000-0000-000000000003', 'self_manager', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_d, 'a3060001-0000-0000-0000-000000000004', 'helper', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000004","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: helperD''s active context is household D', public.current_context_id() = :acct_d;

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 7, 'account', 'note', 'helperD''s note (d)')
returning id as note_d \gset
insert into ids values ('note_d', :'note_d');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: self_manager''s active context is household D', public.current_context_id() = :acct_d;

-- ---------------------------------------------------------------------------
-- (d) in a household whose only owning membership is self_manager, that
-- member soft-deletes a helper's note -> 1 row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_d bigint;
  v_rows int;
begin
  select value::bigint into v_note_d from ids where name = 'note_d';
  update public.interactions set deleted_at = now() where id = v_note_d;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(d) self_manager (the only owning role in this household) soft-deletes a helper''s note -> 1 row',
    v_rows = 1, format('rows=%s', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Arrange (f): ONE login U — parent_admin of household A2, shadchan of
-- shadchanus B. activate_first_context activates A2 (U's first membership);
-- adding B afterward leaves A2 active (household_scope_lift.sql precedent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a3060001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina-u2ctx@test.local');

insert into public.accounts (name, kind) values ('INA Household A2', 'household') returning id as acct_a2 \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_b \gset
insert into ids values ('acct_a2', :'acct_a2'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a2, 'a3060001-0000-0000-0000-000000000005', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'a3060001-0000-0000-0000-000000000005', 'shadchan', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000005","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: U''s active context is household A2 right after both memberships exist',
       public.current_context_id() = :acct_a2;

insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', 8, 'account', 'note', 'U''s own note in A2 (f)')
returning id as note_f \gset
insert into ids values ('note_f', :'note_f');

select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'Arrange: U''s active context is shadchanus B after switching', public.current_context_id() = :acct_b;

-- ---------------------------------------------------------------------------
-- (f) one login holding memberships in household A2 and shadchanus B,
-- active in B, updates a note in A2 -> 0 rows. U holds an OWNING role
-- (parent_admin) in A2 itself — `can_moderate_note()` alone would happily
-- say yes here, since U's OWNING role holds regardless of active context.
-- What actually blocks this update is 3.5's account-scope predicate, but via
-- the SELECT policy denying the row a read in the first place, not via the
-- UPDATE policy's own (byte-identical) `using` conjunct in isolation — see
-- the header comment's corrected falsifiability note on why those two are
-- not distinguishable by any fixture. Kept as a regression guard on the
-- SELECT-side account-scope predicate, exercised here via an OWNING-role
-- login rather than 3.5's own plain fixture.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_f bigint;
  v_rows int;
begin
  select value::bigint into v_note_f from ids where name = 'note_f';
  update public.interactions set body = 'U tried to edit A2''s note while active in B (f)' where id = v_note_f;
  get diagnostics v_rows = row_count;
  insert into results values (
    '(f) one login, active in shadchanus B, updates its own note in household A2 -> 0 rows',
    v_rows = 0, format('rows=%s', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Arrange (h): shadchan of shadchanus C.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a3060001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina-shadchanC@test.local');

insert into public.accounts (kind) values ('shadchanus') returning id as acct_c \gset
insert into ids values ('acct_c', :'acct_c');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_c, 'a3060001-0000-0000-0000-000000000006', 'shadchan', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3060001-0000-0000-0000-000000000006","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: shadchan''s active context is shadchanus C', public.current_context_id() = :acct_c;

-- ---------------------------------------------------------------------------
-- (h) in a shadchanus context, insert kind = 'note', scope = 'account',
-- then read it back -> insert succeeds, 1 row visible.
--
-- Implemented against target_type = 'reference', NOT 'shadchan' as AC 4's
-- table literally reads. `shadchanim` is one of the 11 household-only
-- tables 3-14 left untouched (validate_shadchanim_household_scope,
-- 04_triggers.sql, still fires unconditionally on insert) — no
-- `public.shadchanim` row can EVER exist with `account_id` equal to a
-- shadchanus account. The account-scope branch for `target_type = 'shadchan'`
-- requires `exists (select 1 from shadchanim where account_id =
-- current_context_id())`, which can therefore never be satisfied while
-- genuinely active in a shadchanus context — the literal AC 4(h) shape is
-- unsatisfiable under the current schema, not merely untested. `reference`
-- is the one target_type whose account-scope branch carries no existence
-- check at all, and is the exact shape 3-14's OWN suite
-- (household_scope_lift.sql AC 4(b)) uses for this identical "does an
-- interactions insert succeed while active in a shadchanus context" proof.
-- This still fully exercises (h)'s real intent — that 3-14 landing is what
-- makes a NOTE insert (not just any interaction) succeed here, and that the
-- SELECT policy this story split off still lets the caller read it back.
-- Reported back to the story owner as a likely contract defect.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
    values ('reference', 9, 'account', 'note', 'shadchan''s own note, active in shadchanus C (h)')
    returning id into v_id;
  insert into ids values ('note_h', v_id::text);
  insert into results values (
    '(h) in a shadchanus context, insert kind = ''note'' succeeds', true, null
  );
exception when others then
  insert into results values (
    '(h) in a shadchanus context, insert kind = ''note'' succeeds', false, sqlerrm
  );
end $$;

insert into results (name, passed)
select '(h) the inserted note is readable back, 1 row visible',
       count(*) = 1
from public.interactions
where id = (select value::bigint from ids where name = 'note_h');

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
