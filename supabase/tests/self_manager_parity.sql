--
-- Self-manager / parent_admin parity guard (Story 6.5) — database test suite.
--
-- This is a REGRESSION FENCE, not new functionality (Dev Notes, "Why this
-- story is 'prove it,' not 'build it'"). Every policy Stories 6.2-6.4 wrote
-- is phrased as `current_member_role() = 'single'` or `<> 'single'` — never
-- `= 'parent_admin'` or `<> 'parent_admin'` — so a `self_manager` caller was
-- never restricted by any of it. Nothing here is exercised for the first
-- time; the point is to fail loudly the day a future "tidy up the role
-- checks" edit rewrites one of those predicates around the wrong role.
--
-- Covers AC 1-5:
--   AC-2: household S's provisioning, exactly as add_persona('single')
--     landed it for a caller with NO prior membership at all.
--   AC-1/AC-3/AC-5: full, unfiltered, EQUAL counts for household S (a
--     self-manager) and household P (a parent_admin) on an identical
--     fixture — every table Story 6.2's row-narrowing and Story 6.3's
--     candid-content denies name, plus the four security_invoker summary
--     views, plus the four storage.objects keys, plus
--     shidduchim_summary.close_reason reading its real value.
--   Write parity: an accounts UPDATE, an interactions note INSERT +
--     self-authored moderation, and a single_input row's UPDATE denial
--     (Story 6.4 AC-3: append-only, denies EVERY role, self-manager and
--     parent_admin included) all behave identically for both roles.
--   Invite authority (the ONE deliberate, non-parity difference,
--     role_authority(), 02_functions.sql:1093): a self-manager may invite a
--     `helper` (role_authority 1 <= 2) but never a `parent_admin`
--     (role_authority 3 > 2) — asserted explicitly so a future "parity" edit
--     cannot flatten that ladder.
--
-- Arrange: household S and household P are provisioned (via the REAL
-- add_persona('single')/add_persona('parent') RPCs, each as a fresh user
-- with NO prior membership) and seeded with an identical data shape by
-- self_manager_parity.test.ts BEFORE this file is `\i`'d
-- (dbSuiteHelpers.ts's ownerHouseholdFixtureSql() + householdFixtureDataSql()
-- — the "same code, seeded twice" Task 2 requires) — the same splice-before-
-- `\i` shape single_row_scoping.test.ts/single_field_scoping.test.ts use for
-- their own shared sibling fixture. That leaves `\gset` variables
-- `s_member_id`/`s_account_id`/`s_single_id`/`s_visible_id`/`s_single_input_id`
-- (and the `p_` equivalents) set for this file to use directly.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (self_manager_parity.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted DO blocks, so
-- every id a DO block needs is threaded through the `ids` temp table instead
-- (established by single_row_scoping.sql / single_field_scoping.sql /
-- single_input.sql).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--
-- Scope note: this suite proves parity (self_manager reads exactly what
-- parent_admin reads) — it is structurally blind to a WIDENING that grants
-- both roles more than they should have (e.g. a policy that reads `using
-- (true)`), since both sides of an equality check would simply read the
-- same, larger number. Catching an over-broad grant is the job of each
-- table's own isolation suite (single_row_scoping.sql,
-- single_field_scoping.sql, medical_notes.sql, etc.), which asserts what a
-- DENIED role sees, not what an ALLOWED one does — this file is not a
-- substitute for those.
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Thread the psql \gset ids the fixture splice left set through the `ids`
-- table, so the DO blocks further down can reach them too.
-- ---------------------------------------------------------------------------
insert into ids (name, value) values
  ('s_account_id', :'s_account_id'),
  ('s_member_id', :'s_member_id'),
  ('s_single_id', :'s_single_id'),
  ('s_visible_id', :'s_visible_id'),
  ('s_single_input_id', :'s_single_input_id'),
  ('p_account_id', :'p_account_id'),
  ('p_member_id', :'p_member_id'),
  ('p_single_id', :'p_single_id'),
  ('p_visible_id', :'p_visible_id'),
  ('p_single_input_id', :'p_single_input_id');

-- ---------------------------------------------------------------------------
-- AC-2: household S's provisioning, read back as postgres (ground truth) —
-- add_persona('single') created exactly one account_members row for the
-- fresh caller (self_manager, active) and exactly one singles row linked to
-- it by member_id, no second singles row FROM THAT CALL. Arranged with a
-- user who held NO membership at all before add_persona('single') ran (Task
-- 1's note on why this assertion needs the fresh-user path specifically).
--
-- Review fix: scoped to the fresh caller's own user_id/member_id, not to
-- "the whole account_id" — householdFixtureDataSql() now deliberately seeds
-- a SECOND account_members row and a SECOND singles row per household (see
-- its own doc comment) so the AC1/AC3/AC5 parity loop below can tell "every
-- row" from "only my own row". Counting by account_id here would make THAT
-- fixture row look like a violation of add_persona()'s atomicity, which it
-- is not — the two are different claims: this checks what one RPC call
-- produced, the parity loop checks what a role can SEE.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select
  'AC-2: add_persona(''single'') created exactly one account_members row for the fresh caller (role = self_manager, status = active)',
  (select count(*) from public.account_members
     where user_id = (select user_id from public.account_members where id = :s_member_id)) = 1
    and exists (
      select 1 from public.account_members
      where id = :s_member_id and role = 'self_manager' and status = 'active'
    ),
  format('account_members rows for this caller=%s',
    (select count(*) from public.account_members
       where user_id = (select user_id from public.account_members where id = :s_member_id)));

insert into results (name, passed, detail)
select
  'AC-2: add_persona(''single'') linked exactly one singles row to the self-manager''s own membership by member_id — no second singles row from that call',
  (select count(*) from public.singles where member_id = :s_member_id) = 1
    and exists (select 1 from public.singles where id = :s_single_id and member_id = :s_member_id),
  format('singles rows linked to this caller''s member_id=%s',
    (select count(*) from public.singles where member_id = :s_member_id));

-- ---------------------------------------------------------------------------
-- AC-1 / AC-3 / AC-5: full, unfiltered read counts — every table AC-3 names
-- (Story 6.2's row-narrowing: shidduchim/resumes/shidduch_schools/singles;
-- Story 6.2's wholesale denies: tasks/invites/date_records/redts/
-- identity_signals/inbox_items/subscription/ai_usage/account_members;
-- Story 6.3's candid-content denies: reference_links/references/
-- interactions/entity_files/shidduchim_external_links/medical_notes), plus
-- Task 2's own additions (accounts, resume_photos), read as the self-manager
-- and the parent_admin on the identical fixture side by side.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into ids (name, value) values
  ('s_count_shidduchim', (select count(*) from public.shidduchim)::text),
  ('s_count_resumes', (select count(*) from public.resumes)::text),
  ('s_count_shidduch_schools', (select count(*) from public.shidduch_schools)::text),
  ('s_count_singles', (select count(*) from public.singles)::text),
  ('s_count_accounts', (select count(*) from public.accounts)::text),
  ('s_count_resume_photos', (select count(*) from public.resume_photos)::text),
  ('s_count_tasks', (select count(*) from public.tasks)::text),
  ('s_count_invites', (select count(*) from public.invites)::text),
  ('s_count_date_records', (select count(*) from public.date_records)::text),
  ('s_count_redts', (select count(*) from public.redts)::text),
  ('s_count_identity_signals', (select count(*) from public.identity_signals)::text),
  ('s_count_inbox_items', (select count(*) from public.inbox_items)::text),
  ('s_count_subscription', (select count(*) from public.subscription)::text),
  ('s_count_ai_usage', (select count(*) from public.ai_usage)::text),
  ('s_count_account_members', (select count(*) from public.account_members)::text),
  ('s_count_reference_links', (select count(*) from public.reference_links)::text),
  ('s_count_references', (select count(*) from public."references")::text),
  ('s_count_interactions', (select count(*) from public.interactions)::text),
  ('s_count_entity_files', (select count(*) from public.entity_files)::text),
  ('s_count_shidduchim_external_links', (select count(*) from public.shidduchim_external_links)::text),
  ('s_count_medical_notes', (select count(*) from public.medical_notes)::text),
  ('s_count_references_summary', (select count(*) from public.references_summary)::text),
  ('s_count_reference_links_summary', (select count(*) from public.reference_links_summary)::text),
  ('s_count_interactions_summary', (select count(*) from public.interactions_summary)::text),
  ('s_count_entity_files_summary', (select count(*) from public.entity_files_summary)::text),
  ('s_count_storage_entity_files',
    (select count(*) from storage.objects where bucket_id = 'entity-files')::text),
  ('s_count_storage_resumes',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'resumes')::text),
  ('s_count_storage_photos_shared',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos'
       and (storage.foldername(name))[3] = 'shared')::text),
  ('s_count_storage_photos_private_parent',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos'
       and (storage.foldername(name))[3] = 'private_parent')::text),
  ('s_close_reason',
    (select close_reason from public.shidduchim_summary where id = :s_visible_id));

set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into ids (name, value) values
  ('p_count_shidduchim', (select count(*) from public.shidduchim)::text),
  ('p_count_resumes', (select count(*) from public.resumes)::text),
  ('p_count_shidduch_schools', (select count(*) from public.shidduch_schools)::text),
  ('p_count_singles', (select count(*) from public.singles)::text),
  ('p_count_accounts', (select count(*) from public.accounts)::text),
  ('p_count_resume_photos', (select count(*) from public.resume_photos)::text),
  ('p_count_tasks', (select count(*) from public.tasks)::text),
  ('p_count_invites', (select count(*) from public.invites)::text),
  ('p_count_date_records', (select count(*) from public.date_records)::text),
  ('p_count_redts', (select count(*) from public.redts)::text),
  ('p_count_identity_signals', (select count(*) from public.identity_signals)::text),
  ('p_count_inbox_items', (select count(*) from public.inbox_items)::text),
  ('p_count_subscription', (select count(*) from public.subscription)::text),
  ('p_count_ai_usage', (select count(*) from public.ai_usage)::text),
  ('p_count_account_members', (select count(*) from public.account_members)::text),
  ('p_count_reference_links', (select count(*) from public.reference_links)::text),
  ('p_count_references', (select count(*) from public."references")::text),
  ('p_count_interactions', (select count(*) from public.interactions)::text),
  ('p_count_entity_files', (select count(*) from public.entity_files)::text),
  ('p_count_shidduchim_external_links', (select count(*) from public.shidduchim_external_links)::text),
  ('p_count_medical_notes', (select count(*) from public.medical_notes)::text),
  ('p_count_references_summary', (select count(*) from public.references_summary)::text),
  ('p_count_reference_links_summary', (select count(*) from public.reference_links_summary)::text),
  ('p_count_interactions_summary', (select count(*) from public.interactions_summary)::text),
  ('p_count_entity_files_summary', (select count(*) from public.entity_files_summary)::text),
  ('p_count_storage_entity_files',
    (select count(*) from storage.objects where bucket_id = 'entity-files')::text),
  ('p_count_storage_resumes',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'resumes')::text),
  ('p_count_storage_photos_shared',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos'
       and (storage.foldername(name))[3] = 'shared')::text),
  ('p_count_storage_photos_private_parent',
    (select count(*) from storage.objects
     where bucket_id = 'documents' and (storage.foldername(name))[2] = 'photos'
       and (storage.foldername(name))[3] = 'private_parent')::text),
  ('p_close_reason',
    (select close_reason from public.shidduchim_summary where id = :p_visible_id));

reset role;

-- Compare every s_count_*/p_count_* pair: EQUAL and non-zero. A `>` 0 floor
-- (not merely equality) rules out the degenerate case where BOTH sides read
-- zero — e.g. a policy that silently regressed to deny self_manager too,
-- which would still satisfy "equal" without this.
do $$
declare
  v_keys text[] := array[
    'shidduchim', 'resumes', 'shidduch_schools', 'singles', 'accounts', 'resume_photos',
    'tasks', 'invites', 'date_records', 'redts', 'identity_signals', 'inbox_items',
    'subscription', 'ai_usage', 'account_members', 'reference_links', 'references',
    'interactions', 'entity_files', 'shidduchim_external_links', 'medical_notes',
    'references_summary', 'reference_links_summary', 'interactions_summary', 'entity_files_summary',
    'storage_entity_files', 'storage_resumes', 'storage_photos_shared', 'storage_photos_private_parent'
  ];
  v_key text;
  v_s_text text;
  v_p_text text;
  v_s int;
  v_p int;
begin
  foreach v_key in array v_keys loop
    select value into v_s_text from ids where name = 's_count_' || v_key;
    select value into v_p_text from ids where name = 'p_count_' || v_key;
    v_s := v_s_text::int;
    v_p := v_p_text::int;

    insert into results (name, passed, detail) values (
      format('AC1/AC3/AC5 parity: %s — self-manager and parent_admin read the SAME non-zero count (no Epic 6 %s check catches self_manager)', v_key, v_key),
      coalesce(v_s = v_p and v_s > 0, false),
      format('self_manager=%s parent_admin=%s', coalesce(v_s_text, 'MISSING'), coalesce(v_p_text, 'MISSING'))
    );
  end loop;
end $$;

-- AC-3: shidduchim_summary.close_reason reads its REAL value for both roles
-- (never redacted to NULL — that CASE only fires for current_member_role() =
-- 'single', 03_views.sql).
insert into results (name, passed, detail)
select
  'AC-3: shidduchim_summary.close_reason reads its REAL value for self-manager (not redacted, unlike a single)',
  (select value from ids where name = 's_close_reason') is not null,
  format('s_close_reason=%s', (select value from ids where name = 's_close_reason'));

insert into results (name, passed, detail)
select
  'AC-3 control: shidduchim_summary.close_reason reads its REAL value for parent_admin too (the parity baseline this story protects)',
  (select value from ids where name = 'p_close_reason') is not null,
  format('p_close_reason=%s', (select value from ids where name = 'p_close_reason'));

-- ---------------------------------------------------------------------------
-- Write parity: an accounts UPDATE, an interactions note INSERT + moderating
-- (UPDATE-ing) a note the caller authored themselves (can_moderate_note()'s
-- AUTHOR branch — a LIVE insert-then-moderate, distinct from the read-count
-- fixture's own pre-seeded `note` row), and the single_input UPDATE denial
-- (Story 6.4 AC-3: append-only, denies EVERY role) — asserted for the
-- self-manager, then identically for the parent_admin.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_rows_affected int;
  v_account_id bigint := (select value::bigint from ids where name = 's_account_id');
begin
  update public.accounts set name = 'Updated by self-manager' where id = v_account_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'Write parity: self-manager can UPDATE their own accounts row (Story 6.2 AC-4''s "Accounts writable by non-single members" guard is <> ''single'', so self_manager passes it exactly like parent_admin)',
    v_rows_affected = 1, 'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_note_id bigint;
  v_rows_affected int;
  v_visible_id bigint := (select value::bigint from ids where name = 's_visible_id');
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', v_visible_id, 'shidduch', 'note', 'Self-manager''s own live note')
  returning id into v_note_id;

  update public.interactions set body = 'Self-manager''s own live note, revised by its author'
  where id = v_note_id;
  get diagnostics v_rows_affected = row_count;

  insert into results values (
    'Write parity: self-manager can INSERT an interactions note, then moderate (UPDATE) a note they authored themselves (can_moderate_note() AUTHOR branch)',
    v_rows_affected = 1, 'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_rows_affected int;
  v_single_input_id bigint := (select value::bigint from ids where name = 's_single_input_id');
begin
  update public.interactions set body = 'Tampered by self-manager'
  where id = v_single_input_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'Write parity (Story 6.4 AC-3, append-only): self-manager''s UPDATE on a single_input row affects zero rows — denied exactly as a parent_admin is (this is the assertion most likely to be written backwards)',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_rows_affected int;
  v_account_id bigint := (select value::bigint from ids where name = 'p_account_id');
begin
  update public.accounts set name = 'Updated by parent_admin' where id = v_account_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'Write parity control: parent_admin can UPDATE their own accounts row (same guard as the self-manager check above)',
    v_rows_affected = 1, 'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_note_id bigint;
  v_rows_affected int;
  v_visible_id bigint := (select value::bigint from ids where name = 'p_visible_id');
begin
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', v_visible_id, 'shidduch', 'note', 'Parent_admin''s own live note')
  returning id into v_note_id;

  update public.interactions set body = 'Parent_admin''s own live note, revised by its author'
  where id = v_note_id;
  get diagnostics v_rows_affected = row_count;

  insert into results values (
    'Write parity control: parent_admin can INSERT an interactions note, then moderate (UPDATE) a note they authored themselves (same as the self-manager check above)',
    v_rows_affected = 1, 'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_rows_affected int;
  v_single_input_id bigint := (select value::bigint from ids where name = 'p_single_input_id');
begin
  update public.interactions set body = 'Tampered by parent_admin'
  where id = v_single_input_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    'Write parity control (Story 6.4 AC-3, append-only): parent_admin''s UPDATE on a single_input row affects zero rows too — the narrowed escape denies EVERY role, not merely the single''s own',
    v_rows_affected = 0, 'rows affected: ' || v_rows_affected
  );
end $$;

-- ---------------------------------------------------------------------------
-- Invite authority (Task 2 — the ONE deliberate, non-parity difference):
-- role_authority() puts self_manager at 2, parent_admin at 3
-- (02_functions.sql:1093). A self-manager may invite a `helper`
-- (role_authority 1 <= 2) but never a `parent_admin` (role_authority 3 > 2).
-- Asserted explicitly so a future "parity" edit cannot flatten the ladder in
-- the name of this story.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_invite('self-manager-invites-helper@test.local', 'helper')).id as s_invite_helper_id \gset

insert into results (name, passed, detail)
select
  'Invite authority: self-manager''s create_invite(helper) succeeds (is_invite_capable_role() includes self_manager, role_authority(helper)=1 <= role_authority(self_manager)=2)',
  :'s_invite_helper_id' is not null,
  'invite id: ' || :'s_invite_helper_id';

do $$
begin
  perform public.create_invite('self-manager-invites-parent@test.local', 'parent_admin');
  insert into results values (
    'Invite authority (the ONE deliberate difference): self-manager''s create_invite(parent_admin) is REFUSED — role_authority(parent_admin)=3 > role_authority(self_manager)=2, so a future "parity" edit cannot flatten role_authority()''s ladder',
    false, 'call unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'Invite authority (the ONE deliberate difference): self-manager''s create_invite(parent_admin) is REFUSED — role_authority(parent_admin)=3 > role_authority(self_manager)=2, so a future "parity" edit cannot flatten role_authority()''s ladder',
    sqlerrm like '%cannot invite role % above your own authority%', sqlerrm
  );
end $$;

set local request.jwt.claims = '{"sub":"51820000-0000-0000-0000-000000000002","role":"authenticated"}';

select (public.create_invite('parent-invites-helper@test.local', 'helper')).id as p_invite_helper_id \gset

insert into results (name, passed, detail)
select
  'Invite authority parity: parent_admin''s create_invite(helper) also succeeds — the helper-invite capability is IDENTICAL for both roles',
  :'p_invite_helper_id' is not null,
  'invite id: ' || :'p_invite_helper_id';

select (public.create_invite('parent-invites-parent@test.local', 'parent_admin')).id as p_invite_parent_id \gset

insert into results (name, passed, detail)
select
  'Invite authority control: parent_admin''s create_invite(parent_admin) SUCCEEDS — proving the self-manager denial above is a real authority difference (role_authority(parent_admin)=3 <= role_authority(parent_admin)=3), not a blanket refusal of everyone',
  :'p_invite_parent_id' is not null,
  'invite id: ' || :'p_invite_parent_id';

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
