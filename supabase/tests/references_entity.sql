--
-- References entity — database test suite.
--
-- Covers what the References epic added: the shared identity matcher, the
-- reference write paths, the merge (including the collision case where both
-- duplicate references share a link to the same shidduch), and RLS on every
-- new table with explicit cross-account attempts.
--
-- Every check appends one row to `results`; the script emits them as JSON at the
-- end and rolls back, so it leaves nothing behind. The runner
-- (references_entity.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so ids are
-- shared with the DO blocks through the `ids` temp table rather than \gset.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: two tenants that must never see each other.
-- ---------------------------------------------------------------------------
-- Three users, none carrying an invite token. Story 2.7 (AC-7) deleted
-- handle_new_user()'s first-user bootstrap branch (the fork's "first user
-- becomes parent_admin" fallback) in favor of invite-only binding, so every
-- signup below — including this first one — gets NO membership at all; the
-- suite re-points memberships at its own tenants explicitly further down.
insert into auth.users (id, instance_id, aud, role, email)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tenant-a@test.local');

insert into results (name, passed)
select 'a signup with no invite gets NO membership (AC-7 replaces the old first-user bootstrap)', count(*) = 0
from public.account_members am
where am.user_id = '11111111-1111-1111-1111-111111111111';

insert into auth.users (id, instance_id, aud, role, email)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tenant-b@test.local'),
       ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nobody@test.local');

insert into results (name, passed)
select 'a later signup with no invite gets NO membership', count(*) = 0
from public.account_members am
where am.user_id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

-- Re-point memberships at this suite's own two tenants. The third user keeps
-- none, which is what the fail-closed checks below exercise.
delete from public.account_members;

insert into public.accounts (name) values ('Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('Tenant B') returning id as acct_b \gset
insert into ids values ('acct_a', :acct_a), ('acct_b', :acct_b);

insert into public.account_members (account_id, user_id, role)
values (:acct_a, '11111111-1111-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, '22222222-2222-2222-2222-222222222222', 'parent_admin');

-- A fourth user, arranged here (still under the superuser role, before the
-- `set local role authenticated` switch below — `auth.users`/`account_members`
-- writes are not reachable once that switch happens) but not acted on until
-- Story 5.9 AC-6's shadchan_stats check further down: ONE login with active
-- membership in BOTH tenants, the shape a cross-tenant negative needs to tell
-- "filtered by the active context" apart from "filtered by any membership".
insert into auth.users (id, instance_id, aud, role, email)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dual-tenant@test.local');

insert into public.account_members (account_id, user_id, role)
values (:acct_a, '44444444-4444-4444-4444-444444444444', 'parent_admin');
insert into public.account_members (account_id, user_id, role)
values (:acct_b, '44444444-4444-4444-4444-444444444444', 'parent_admin');

insert into public.singles (account_id, first_name_en, gender)
values (:acct_a, 'Leah', 'female') returning id as single_a \gset
insert into ids values ('single_a', :single_a);
insert into public.shidduchim (account_id, single_id, name_en)
values (:acct_a, :single_a, 'Yosef Klein') returning id as shid1 \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:acct_a, :single_a, 'Dovid Weiss') returning id as shid2 \gset
insert into ids values ('shid1', :shid1), ('shid2', :shid2);

-- ---------------------------------------------------------------------------
-- Normalization + variant folding (AD-12, NFR-6)
-- ---------------------------------------------------------------------------
insert into results (name, passed) values
  ('normalize: strips case and collapses whitespace',
   public.normalize_identity_text('  Chaim   COHEN ') = 'chaim cohen'),
  ('normalize: strips punctuation',
   public.normalize_identity_text('Cohen, Chaim!') = 'cohen chaim'),
  ('normalize: blank input yields null',
   public.normalize_identity_text('   ') is null),
  ('phone: Israeli local and international forms are equal',
   public.normalize_phone('054-123-4567') = public.normalize_phone('+972 54 123 4567')),
  ('phone: 00-prefixed international form is equal',
   public.normalize_phone('00972541234567') = public.normalize_phone('0541234567')),
  ('phone: North American +1 is stripped',
   public.normalize_phone('+1 (718) 555-0123') = '7185550123'),
  ('phone: a too-short fragment is not a match signal',
   public.normalize_phone('054-12') is null),
  ('name key: Yitzchak/Itzhak fold together',
   public.identity_name_key('Yitzchak') = public.identity_name_key('Itzhak')),
  ('name key: Chaim/Haim fold together',
   public.identity_name_key('Chaim') = public.identity_name_key('Haim')),
  ('name key: nicknames fold to the given name',
   public.identity_name_key('Rivky Gold') = public.identity_name_key('Rivka Gold')),
  ('name key: honorifics are ignored',
   public.identity_name_key('Rabbi Chaim Cohen') = public.identity_name_key('Chaim Cohen')),
  ('name key: genuinely different names stay different',
   public.identity_name_key('Moshe Levi') <> public.identity_name_key('Sarah Klein'));

-- ---------------------------------------------------------------------------
-- Act as tenant A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select id as ref1 from public.create_reference_for_shidduch(:shid1, 'Rabbi Chaim Cohen', null, 'shul rabbi', '054-123-4567', 'Yeshivas Ohr') \gset
insert into ids values ('ref1', :ref1);

insert into results (name, passed)
select 'account_id is server-set, never client-supplied',
       r.account_id = public.current_context_id()
from public."references" r where r.id = :ref1;

insert into results (name, passed)
select 'match keys are trigger-set on the reference row',
       r.name_norm_en = 'rabbi chaim cohen' and r.phone_norm = '541234567'
from public."references" r where r.id = :ref1;

insert into results (name, passed)
select 'identity_signals row is created by the sync trigger', count(*) = 1
from public.identity_signals s
where s.target_type = 'reference' and s.target_id = :ref1;

-- ---------------------------------------------------------------------------
-- Match-on-entry (FR20/FR42, AD-5)
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'match: a phone variant finds the existing reference',
       count(*) = 1 and max(m.confidence) >= 0.90
from public.match_reference_on_entry('Chaim Cohen', null, '+972541234567', null, null) m;

insert into results (name, passed)
select 'match: NAME ALONE returns no candidate (AD-5 hard rule)', count(*) = 0
from public.match_reference_on_entry('Rabbi Chaim Cohen', null, null, null, null) m;

insert into results (name, passed)
select 'match: a name variant plus a corroborating school does match', count(*) = 1
from public.match_reference_on_entry('Haim Cohen', null, null, 'Yeshivas Ohr', null) m;

insert into results (name, passed)
select 'match: deciding facts are returned, not a bare boolean',
       bool_and(jsonb_array_length(m.deciding_facts) >= 1)
from public.match_reference_on_entry('Chaim Cohen', null, '0541234567', null, null) m;

insert into results (name, passed)
select 'match: excluding a reference removes it from its own candidates', count(*) = 0
from public.match_reference_on_entry('Chaim Cohen', null, '0541234567', null, :ref1) m;

insert into results (name, passed)
select 'match: an unrelated person is not a candidate', count(*) = 0
from public.match_reference_on_entry('Sarah Friedman', null, '03-999-8888', 'Bais Yaakov', null) m;

-- ---------------------------------------------------------------------------
-- Linking + call capture (FR40, FR41)
-- ---------------------------------------------------------------------------
select id as link1 from public.link_reference_to_shidduch(:ref1, :shid1, 'shul rabbi') \gset
select id as link2 from public.link_reference_to_shidduch(:ref1, :shid2, 'family friend') \gset
insert into ids values ('link1', :link1), ('link2', :link2);

select count(*) as reconfirmed from public.link_reference_to_shidduch(:ref1, :shid1, null) \gset

insert into results (name, passed) values
  ('link_reference_to_shidduch is idempotent', :reconfirmed = 1);

insert into results (name, passed)
select 'confirming the same link twice does not duplicate it', count(*) = 1
from public.reference_links rl
where rl.reference_id = :ref1 and rl.shidduchim_id = :shid1;

select public.log_reference_call(:link1, 'answered', 'Spoke warmly, very positive.', 'manual');
select public.log_reference_call(:link1, 'answered', 'Also mentioned the family.', 'assistant');

insert into results (name, passed)
select 'call capture writes status, text and an appended log entry',
       rl.call_status = 'answered'
       and rl.what_they_said = 'Also mentioned the family.'
       and jsonb_array_length(rl.conversation_log) = 2
from public.reference_links rl where rl.id = :link1;

insert into results (name, passed)
select 'the AI assistant writes into the same fields as manual capture', count(*) = 1
from public.reference_links rl,
     lateral jsonb_array_elements(rl.conversation_log) e
where rl.id = :link1 and e ->> 'source' = 'assistant';

insert into results (name, passed)
select 'every logged call also lands on the timeline', count(*) = 2
from public.interactions i
where i.target_type = 'reference' and i.target_id = :ref1 and i.kind = 'call_logged';

-- A note about the person rather than about one single: no shidduch parent, so
-- it declares account scope and can never inherit a shidduch's visibility.
insert into public.interactions (target_type, target_id, scope, kind, body)
values ('reference', :ref1, 'account', 'note', 'Changed his phone number.');

-- ---------------------------------------------------------------------------
-- Cross-shidduch repeat recognition (FR42) — a real query, not a stored string
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'repeat recognition spans every shidduch the reference is linked to', count(*) = 2
from public.reference_links_summary v where v.reference_id = :ref1;

insert into results (name, passed)
select 'a per-link relationship override wins over the reference default', count(*) = 1
from public.reference_links_summary v
where v.reference_id = :ref1 and v.effective_relationship = 'family friend';

insert into results (name, passed)
select 'summary view aggregates links, calls and conversations',
       v.linked_shidduchim_count = 2 and v.contacted_count = 1 and v.last_conversation_at is not null
from public.references_summary v where v.id = :ref1;

-- ---------------------------------------------------------------------------
-- Polymorphic tasks (AD-13, FR44-46)
-- ---------------------------------------------------------------------------
insert into public.tasks (target_type, target_id, text, due_date)
values ('reference', :ref1, 'Call back Sunday', now() + interval '2 days');

insert into results (name, passed)
select 'a task can target a reference directly',
       t.target_type = 'reference' and t.target_id = :ref1 and t.account_id = public.current_context_id()
from public.tasks t where t.target_type = 'reference' and t.target_id = :ref1;

insert into results (name, passed)
select 'reference reminders default to in-app + email, never SMS',
       t.delivery_channels = array['in_app', 'email']::text[]
from public.tasks t where t.target_type = 'reference' and t.target_id = :ref1;

insert into results (name, passed)
select 'open reference tasks surface on the summary view', v.open_task_count = 1
from public.references_summary v where v.id = :ref1;

do $$
begin
  insert into public.tasks (target_type, target_id, text) values ('contact', 1, 'A retired target type');
  insert into results values ('the retired ''contact'' target type is rejected', false, 'no exception raised');
exception when others then
  insert into results values ('the retired ''contact'' target type is rejected', true, sqlerrm);
end $$;

do $$
begin
  insert into public.tasks (text) values ('Task with no target at all');
  insert into results values ('a task with no target is rejected', false, 'no exception raised');
exception when others then
  insert into results values ('a task with no target is rejected', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Merge, including the collision case (§4)
-- ---------------------------------------------------------------------------
-- Fixture, not the write path under test: created privileged because INSERT on "references" is revoked from authenticated.
reset role;
insert into public."references" (account_id, name_en, relationship, phone, school)
values (:acct_a, 'Chaim Cohen', 'rabbi', '0541234567', 'Yeshivas Ohr')
returning id as ref2 \gset
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into ids values ('ref2', :ref2);

select id as dup_link from public.link_reference_to_shidduch(:ref2, :shid1, null) \gset
select public.log_reference_call(:dup_link, 'no_answer', 'Left a message.', 'manual');
insert into public.tasks (target_type, target_id, text) values ('reference', :ref2, 'Duplicate task');

insert into results (name, passed)
select 'merge preview surfaces the same-shidduch collision',
       jsonb_array_length(p -> 'collisions') = 1
       and (p -> 'collisions' -> 0 -> 'loser_link' ->> 'what_they_said') = 'Left a message.'
       and (p -> 'collisions' -> 0 -> 'winner_link' ->> 'what_they_said') = 'Also mentioned the family.'
from (select public.preview_reference_merge(:ref2, :ref1) as p) x;

insert into results (name, passed)
select 'merge preview counts the related records that would move',
       (p ->> 'reference_links_count')::int = 1
       and (p ->> 'open_tasks_count')::int = 1
       and (p ->> 'interactions_count')::int >= 1
from (select public.preview_reference_merge(:ref2, :ref1) as p) x;

do $$
declare v_loser bigint; v_winner bigint;
begin
  select value into v_loser from ids where name = 'ref2';
  select value into v_winner from ids where name = 'ref1';
  perform public.merge_references(v_loser, v_winner, '{}'::jsonb);
  insert into results values ('merge REFUSES an unresolved collision rather than dropping a call log', false, 'no exception raised');
exception when others then
  insert into results values (
    'merge REFUSES an unresolved collision rather than dropping a call log',
    sqlerrm like '%unresolved merge conflict%', sqlerrm);
end $$;

do $$
declare v_loser bigint; v_winner bigint; v_shid bigint;
begin
  select value into v_loser from ids where name = 'ref2';
  select value into v_winner from ids where name = 'ref1';
  select value into v_shid from ids where name = 'shid1';
  perform public.merge_references(v_loser, v_winner, jsonb_build_object(v_shid::text, 'nonsense'));
  insert into results values ('merge rejects an unknown resolution value', false, 'no exception raised');
exception when others then
  insert into results values ('merge rejects an unknown resolution value',
    sqlerrm like '%invalid merge resolution%', sqlerrm);
end $$;

do $$
declare v_ref bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  perform public.merge_references(v_ref, v_ref, '{}'::jsonb);
  insert into results values ('merge refuses to merge a reference into itself', false, 'no exception raised');
exception when others then
  insert into results values ('merge refuses to merge a reference into itself', true, sqlerrm);
end $$;

select public.merge_references(:ref2, :ref1, jsonb_build_object(:'shid1', 'both')) as winner \gset

insert into results (name, passed) values
  ('merge returns the surviving reference', :winner = :ref1);

insert into results (name, passed)
select 'the duplicate reference row is gone', count(*) = 0
from public."references" r where r.id = :ref2;

insert into results (name, passed)
select 'the duplicate leaves no orphaned identity signal', count(*) = 0
from public.identity_signals s where s.target_type = 'reference' and s.target_id = :ref2;

insert into results (name, passed)
select 'exactly one link survives for the collided shidduch', count(*) = 1
from public.reference_links rl where rl.reference_id = :ref1 and rl.shidduchim_id = :shid1;

insert into results (name, passed)
select 'neither side of the collision loses its call log',
       rl.what_they_said like '%Also mentioned the family.%'
       and rl.what_they_said like '%Left a message.%'
       and jsonb_array_length(rl.conversation_log) = 3
from public.reference_links rl where rl.id = :link1;

insert into results (name, passed)
select 'the merge is recorded on the timeline', count(*) >= 1
from public.interactions i where i.target_id = :ref1 and i.kind = 'merge';

insert into results (name, passed)
select 'reminders follow the reference across the merge', count(*) = 2
from public.tasks t where t.target_type = 'reference' and t.target_id = :ref1;

-- Deleting a reference must take its polymorphic children with it.
-- Fixture, not the write path under test: created privileged because INSERT on "references" is revoked from authenticated.
reset role;
insert into public."references" (account_id, name_en, phone) values (:acct_a, 'Temp Person', '03-111-2222')
returning id as ref3 \gset
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.tasks (target_type, target_id, text) values ('reference', :ref3, 'Temp task');
insert into public.interactions (target_type, target_id, kind, body) values ('reference', :ref3, 'note', 'Temp note');
delete from public."references" where id = :ref3;

insert into results (name, passed) values (
  'deleting a reference purges its tasks, timeline and signals',
  (select count(*) from public.tasks where target_type = 'reference' and target_id = :ref3) = 0
  and (select count(*) from public.interactions where target_type = 'reference' and target_id = :ref3) = 0
  and (select count(*) from public.identity_signals where target_type = 'reference' and target_id = :ref3) = 0
);

-- ---------------------------------------------------------------------------
-- RLS: tenant B must see and touch nothing of tenant A (AD-1, PRV-2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'RLS: tenant B resolves to its own account', public.current_context_id() = :acct_b;

insert into results (name, passed) select 'RLS: references are invisible cross-account', count(*) = 0 from public."references";
insert into results (name, passed) select 'RLS: reference_links are invisible cross-account', count(*) = 0 from public.reference_links;
insert into results (name, passed) select 'RLS: interactions are invisible cross-account', count(*) = 0 from public.interactions;
insert into results (name, passed) select 'RLS: tasks are invisible cross-account', count(*) = 0 from public.tasks;
insert into results (name, passed) select 'RLS: identity_signals are invisible cross-account', count(*) = 0 from public.identity_signals;
insert into results (name, passed) select 'RLS: references_summary is invisible cross-account', count(*) = 0 from public.references_summary;
insert into results (name, passed) select 'RLS: reference_links_summary is invisible cross-account', count(*) = 0 from public.reference_links_summary;

insert into results (name, passed)
select 'PRV-2: identity matching never crosses an account boundary', count(*) = 0
from public.match_reference_on_entry('Rabbi Chaim Cohen', null, '054-123-4567', 'Yeshivas Ohr', null);

do $$
declare v_ref bigint; v_shid bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  select value into v_shid from ids where name = 'shid1';
  perform public.link_reference_to_shidduch(v_ref, v_shid, null);
  insert into results values ('RLS: cannot link another account''s reference', false, 'no exception raised');
exception when others then
  insert into results values ('RLS: cannot link another account''s reference', true, sqlerrm);
end $$;

do $$
declare v_link bigint;
begin
  select value into v_link from ids where name = 'link1';
  perform public.log_reference_call(v_link, 'answered', 'hijack attempt', 'manual');
  insert into results values ('RLS: cannot log a call on another account''s link', false, 'no exception raised');
exception when others then
  insert into results values ('RLS: cannot log a call on another account''s link', true, sqlerrm);
end $$;

do $$
declare v_ref bigint; v_ref2 bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  select value into v_ref2 from ids where name = 'ref2';
  perform public.preview_reference_merge(v_ref2, v_ref);
  insert into results values ('RLS: cannot preview a merge of another account''s references', false, 'no exception raised');
exception when others then
  insert into results values ('RLS: cannot preview a merge of another account''s references', true, sqlerrm);
end $$;

do $$
declare v_link bigint; v_tampered boolean;
begin
  select value into v_link from ids where name = 'link1';
  update public.reference_links set what_they_said = 'tampered' where id = v_link;
  select exists (select 1 from public.reference_links where id = v_link and what_they_said = 'tampered')
    into v_tampered;
  insert into results values ('RLS: cannot overwrite another account''s candid call notes', not v_tampered);
exception when others then
  insert into results values ('RLS: cannot overwrite another account''s candid call notes', true, sqlerrm);
end $$;

do $$
declare v_acct bigint;
begin
  select value into v_acct from ids where name = 'acct_b';
  insert into public.identity_signals (account_id, target_type, target_id, phone_norm)
  values (v_acct, 'reference', 999, '541234567');
  insert into results values ('identity_signals is not client-writable', false, 'insert succeeded');
exception when others then
  insert into results values ('identity_signals is not client-writable', true, sqlerrm);
end $$;

-- The bare-insert door, closed. This is the test that did not exist while an
-- authenticated, provisioned, non-single member could POST straight to
-- /rest/v1/references and create a reference attached to no shidduch. It FAILS
-- until `revoke insert on public."references" from authenticated` lands, and
-- that is the point: it is falsifiable by construction rather than green by
-- default.
do $$
begin
  insert into public."references" (name_en) values ('Bare insert by a provisioned member');
  insert into results values ('a provisioned member cannot bare-insert a reference', false, 'insert succeeded - the grant is still open');
exception when others then
  insert into results values ('a provisioned member cannot bare-insert a reference', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Fail-closed membership: a user with no account_members row is nobody.
-- Previously the fork's first-row resolver (the `order by am.id limit 1`
-- function Story 2.1 deleted in favor of current_context_id()) fell back to
-- the first account, so an unprovisioned user silently became a member of
-- account #1 and could read its candid call logs.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select 'a user with no membership resolves to NO account, not account #1',
       public.current_context_id() is null;

insert into results (name, passed) select 'unprovisioned user sees no references', count(*) = 0 from public."references";
insert into results (name, passed) select 'unprovisioned user sees no reference_links', count(*) = 0 from public.reference_links;
insert into results (name, passed) select 'unprovisioned user sees no interactions', count(*) = 0 from public.interactions;
insert into results (name, passed) select 'unprovisioned user sees no tasks', count(*) = 0 from public.tasks;
insert into results (name, passed) select 'unprovisioned user sees no shidduchim', count(*) = 0 from public.shidduchim;

do $$
begin
  -- Retargeted at the RPC: after INSERT was revoked from authenticated, a bare insert would fail with "permission denied" regardless of provisioning, which is not what this test is about.
  perform public.create_reference_for_shidduch(1, 'Planted by a stranger');
  insert into results values ('an unprovisioned user cannot create anything', false, 'insert succeeded');
exception when others then
  insert into results values ('an unprovisioned user cannot create anything', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Cross-account foreign keys: a link can only ever join records in its own
-- account. Without the composite FK, tenant B could point a reference_link at
-- tenant A's shidduch — a cross-tenant id oracle, and a dangling parent for the
-- branch that will later carry single visibility.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Fixture, not the write path under test: created privileged because INSERT on "references" is revoked from authenticated.
reset role;
insert into public."references" (account_id, name_en, phone) values (:acct_b, 'Tenant B Person', '02-555-1111')
returning id as ref_b \gset
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into ids values ('ref_b', :ref_b);

do $$
declare v_ref_b bigint; v_shid_a bigint;
begin
  select value into v_ref_b from ids where name = 'ref_b';
  select value into v_shid_a from ids where name = 'shid1';
  insert into public.reference_links (reference_id, shidduchim_id, call_status, what_they_said)
  values (v_ref_b, v_shid_a, 'answered', 'candid text about another tenant''s match');
  insert into results values ('cannot link a reference to another account''s shidduch', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot link a reference to another account''s shidduch', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AD-3: every interaction must declare which parent its visibility derives
-- from. A row that answers neither is what would have leaked free-text notes to
-- a candidate once the single role exists.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare v_ref bigint; v_link bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  select value into v_link from ids where name = 'link1';
  insert into public.interactions (target_type, target_id, scope, reference_link_id, kind, body)
  values ('reference', v_ref, 'shidduch', null, 'note', 'candid note with no parent');
  insert into results values ('a shidduch-scoped interaction cannot omit its link', false, 'insert succeeded');
exception when others then
  insert into results values ('a shidduch-scoped interaction cannot omit its link', true, sqlerrm);
end $$;

do $$
declare v_ref bigint; v_link bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  select value into v_link from ids where name = 'link1';
  insert into public.interactions (target_type, target_id, scope, reference_link_id, kind, body)
  values ('reference', v_ref, 'account', v_link, 'note', 'account-scoped but linked');
  insert into results values ('an account-scoped interaction cannot carry a link', false, 'insert succeeded');
exception when others then
  insert into results values ('an account-scoped interaction cannot carry a link', true, sqlerrm);
end $$;

do $$
declare v_ref bigint;
begin
  select value into v_ref from ids where name = 'ref1';
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('reference', v_ref, 'nowhere', 'note', 'unclassified');
  insert into results values ('an interaction cannot invent a third visibility scope', false, 'insert succeeded');
exception when others then
  insert into results values ('an interaction cannot invent a third visibility scope', true, sqlerrm);
end $$;

insert into results (name, passed)
select 'every call the app logged is shidduch-scoped, so it derives from a parent',
       bool_and(i.scope = 'shidduch' and i.reference_link_id is not null)
from public.interactions i
where i.kind = 'call_logged';

insert into results (name, passed)
select 'a general note is account-scoped and has no shidduch parent to leak from',
       count(*) = 1
from public.interactions i
where i.kind = 'note' and i.scope = 'account' and i.reference_link_id is null;

-- The call note cap keeps one link's append-only jsonb log bounded.
do $$
declare v_link bigint;
begin
  select value into v_link from ids where name = 'link1';
  perform public.log_reference_call(v_link, 'answered', repeat('x', 20001), 'manual');
  insert into results values ('an oversized call note is rejected', false, 'insert succeeded');
exception when others then
  insert into results values ('an oversized call note is rejected', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- An interaction ABOUT a shidduch has that shidduch as its parent, so it can
-- never be account-scoped. Without this the discriminator keyed only off
-- reference_link_id and a row unambiguously about one single escaped the
-- join-to-parent branch entirely.
-- ---------------------------------------------------------------------------
do $$
declare v_shid bigint;
begin
  select value into v_shid from ids where name = 'shid1';
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', v_shid, 'account', 'note', 'candid about this single');
  insert into results values ('an interaction about a shidduch cannot be account-scoped', false, 'insert succeeded');
exception when others then
  insert into results values ('an interaction about a shidduch cannot be account-scoped', true, sqlerrm);
end $$;

do $$
declare v_shid bigint; v_link bigint;
begin
  select value into v_shid from ids where name = 'shid1';
  select value into v_link from ids where name = 'link1';
  insert into public.interactions (target_type, target_id, scope, reference_link_id, kind, body)
  values ('shidduch', v_shid, 'shidduch', v_link, 'note', 'both parents at once');
  insert into results values ('an interaction cannot claim two different parents', false, 'insert succeeded');
exception when others then
  insert into results values ('an interaction cannot claim two different parents', true, sqlerrm);
end $$;

do $$
declare v_shid bigint;
begin
  select value into v_shid from ids where name = 'shid1';
  insert into public.interactions (target_type, target_id, scope, kind, body)
  values ('shidduch', v_shid, 'shidduch', 'note', 'a properly parented shidduch note');
  insert into results values ('a shidduch-targeted interaction is allowed when properly scoped', true);
exception when others then
  insert into results values ('a shidduch-targeted interaction is allowed when properly scoped', false, sqlerrm);
end $$;

-- Moving a note onto a different parent would change whose visibility it
-- inherits, so the structural columns are not client-writable.
do $$
declare v_id bigint;
begin
  select i.id into v_id from public.interactions i where i.kind = 'call_logged' limit 1;
  update public.interactions set scope = 'account', reference_link_id = null where id = v_id;
  insert into results values ('an interaction cannot be re-parented by the client', false, 'update succeeded');
exception when others then
  insert into results values ('an interaction cannot be re-parented by the client', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Cross-tenant cascade destruction: every FK that joins two tenant-owned tables
-- carries account_id, so one account deleting its own single can never cascade
-- into another account's rows.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare v_single_a bigint;
begin
  select value into v_single_a from ids where name = 'single_a';
  insert into public.shidduchim (single_id, name_en) values (v_single_a, 'stolen single');
  insert into results values ('cannot create a shidduch on another account''s single', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot create a shidduch on another account''s single', true, sqlerrm);
end $$;

do $$
declare v_shid_a bigint;
begin
  select value into v_shid_a from ids where name = 'shid1';
  insert into public.redts (shidduchim_id, redt_date) values (v_shid_a, current_date);
  insert into results values ('cannot attach a redt to another account''s shidduch', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot attach a redt to another account''s shidduch', true, sqlerrm);
end $$;

do $$
declare v_shid_a bigint;
begin
  select value into v_shid_a from ids where name = 'shid1';
  insert into public.shidduch_education (shidduchim_id, kind, name_en) values (v_shid_a, 'seminary', 'X');
  insert into results values ('cannot attach a school to another account''s shidduch', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot attach a school to another account''s shidduch', true, sqlerrm);
end $$;

do $$
declare v_shid_a bigint;
begin
  select value into v_shid_a from ids where name = 'shid1';
  insert into public.resumes (shidduchim_id) values (v_shid_a);
  insert into results values ('cannot attach a resume to another account''s shidduch', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot attach a resume to another account''s shidduch', true, sqlerrm);
end $$;

do $$
declare v_single_a bigint;
begin
  select value into v_single_a from ids where name = 'single_a';
  insert into public.date_records (single_id) values (v_single_a);
  insert into results values ('cannot attach a date record to another account''s single', false, 'insert succeeded');
exception when others then
  insert into results values ('cannot attach a date record to another account''s single', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AD-1 / AC-14(e): a member of one account must never read another account's
-- singles, from either the base table or the singles_summary view. Still
-- tenant B's role/claims here (set above), so this single lands in tenant B's
-- own account via set_account_id_default().
-- ---------------------------------------------------------------------------
insert into public.singles (first_name_en, gender) values ('Devora', 'female')
returning id as single_b_isolation \gset

-- Story 5.9 AC-6 (RULING 8): tenant B's isolation-check shadchan is created
-- here too, still under tenant B's claims (set above) — before the switch
-- back to tenant A below — so it lands in B's account via
-- set_account_id_default(), exactly like the single just above.
insert into public.shadchanim (name) values ('Tenant B Shadchan (isolation)')
returning id as shadchan_b_isolation \gset

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'tenant A reads only its own single from public.singles, never tenant B''s',
       (select count(*) from public.singles where id = :single_a) = 1
   and (select count(*) from public.singles where id = :single_b_isolation) = 0;

insert into results (name, passed)
select 'tenant A reads only its own single from public.singles_summary, never tenant B''s',
       (select count(*) from public.singles_summary where id = :single_a) = 1
   and (select count(*) from public.singles_summary where id = :single_b_isolation) = 0;

-- ---------------------------------------------------------------------------
-- Story 5.9 AC-6 (RULING 8), continued: the widened shadchan_stats view
-- (last_redt_date, nb_open_singles) must not leak another account's rows.
-- Contract §13 rule 3 is explicit: a cross-tenant negative is ONE login with
-- memberships in two accounts, active in one — never two disjoint users.
-- Two disjoint users (each with a single membership) can only prove
-- account_id filtering; they cannot catch a policy that resolves visibility
-- by "any membership the caller holds" instead of the caller's ACTIVE
-- context, because neither user has a second membership to leak from. This
-- extends the same set_active_context() shape AC-5 already uses in
-- interactions_targets.sql. Tenant A's own shadchan and its one open
-- shidduch are created now that we are back under tenant A's claims.
-- ---------------------------------------------------------------------------
insert into public.shadchanim (name) values ('Tenant A Shadchan (isolation)')
returning id as shadchan_a_isolation \gset

insert into public.shidduchim (single_id, name_en, shadchan_id, pipeline_state)
values (:single_a, 'Isolation check shidduch', :shadchan_a_isolation, 'look_into');

-- A SECOND open shidduch attributed to this shadchan, on the SAME single
-- (`single_a`, already used above) — the fixture "how many singles" ≠ "how
-- many shidduchim" needs. `count(distinct s.single_id)` must still read 1;
-- a regression to plain `count(s.single_id)` (no DISTINCT) would read 2.
insert into public.shidduchim (single_id, name_en, shadchan_id, pipeline_state)
values (:single_a, 'Second isolation check shidduch, same single', :shadchan_a_isolation, 'new');

-- ONE login, active membership in BOTH tenants (arranged near the top of
-- this file, before the role switch to `authenticated` — see the comment
-- there) — the shape that can actually distinguish "filtered by active
-- context" from "filtered by any membership".
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select public.set_active_context(:acct_a);

insert into results (name, passed)
select 'one login active in A: reads only its own shadchan from public.shadchan_stats, never tenant B''s',
       (select count(*) from public.shadchan_stats where id = :shadchan_a_isolation) = 1
   and (select count(*) from public.shadchan_stats where id = :shadchan_b_isolation) = 0;

insert into results (name, passed)
select 'one login active in A: shadchan_stats row reflects only its own attributed shidduchim (nb_open_singles = 1, last_redt_date not null) — never fabricated, never tenant B''s',
       (select nb_open_singles from public.shadchan_stats where id = :shadchan_a_isolation) = 1
   and (select last_redt_date from public.shadchan_stats where id = :shadchan_a_isolation) is not null;

insert into results (name, passed)
select 'nb_open_singles counts DISTINCT singles, not shidduchim: 2 open shidduchim sharing one single still reads 1, not 2 — a regression to plain count(s.single_id) (no DISTINCT) would fail this',
       (select nb_open_singles from public.shadchan_stats where id = :shadchan_a_isolation) = 1
   and (select nb_suggestions from public.shadchan_stats where id = :shadchan_a_isolation) = 2;

select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'same login, after switching active context to B: visibility swaps to B''s shadchan and away from A''s — proves shadchan_stats is filtered by the ACTIVE context, not by "is this user a member of the row''s account"',
       (select count(*) from public.shadchan_stats where id = :shadchan_b_isolation) = 1
   and (select count(*) from public.shadchan_stats where id = :shadchan_a_isolation) = 0;

-- Restore tenant A's claims for the rest of the suite.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The merge's definer helper is the one way an interaction can be re-parented.
-- It must not become a way to move a note onto a DIFFERENT shidduch, which is
-- exactly the capability the column-level UPDATE revoke removed.
do $$
declare v_link1 bigint; v_link2 bigint;
begin
  select value into v_link1 from ids where name = 'link1';
  select value into v_link2 from ids where name = 'link2';
  perform public.rehome_reference_link_interactions(v_link1, v_link2);
  insert into results values ('the merge helper cannot move a note to another shidduch', false, 'call succeeded');
exception when others then
  insert into results values ('the merge helper cannot move a note to another shidduch', true, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Structural guarantees the epic must not regress.
-- ---------------------------------------------------------------------------
reset role;

insert into results (name, passed)
select 'RLS is enabled on every new table', bool_and(c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('interactions', 'identity_signals', 'tasks');

-- information_schema.role_table_grants cannot see MAINTAIN and cannot see
-- function privileges AT ALL, so the earlier version of this check passed green
-- while every new function was executable by anon. Ask the catalog directly.
insert into results (name, passed)
select 'anon holds no privilege of any kind on the new tables or views',
       not exists (
         select 1
         from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where n.nspname = 'public'
           and c.relname in ('interactions', 'identity_signals', 'tasks',
                             'references_summary', 'reference_links_summary')
           and a.grantee = 'anon'::regrole::oid
       );

insert into results (name, passed)
select 'anon cannot execute any function this epic added',
       bool_and(not has_function_privilege('anon', p.oid, 'execute'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'normalize_identity_text', 'normalize_phone', 'identity_name_key',
    'match_identity', 'match_reference_on_entry', 'set_reference_norms',
    'sync_reference_identity_signals', 'sync_shidduch_identity_signals',
    'purge_polymorphic_dependents', 'sync_task_target',
    'link_reference_to_shidduch', 'log_reference_call',
    'preview_reference_merge', 'merge_references'
  );

insert into results (name, passed)
select 'no function this epic added was left executable by PUBLIC', count(*) = 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proacl is null
  and p.proname in (
    'normalize_identity_text', 'normalize_phone', 'identity_name_key',
    'match_identity', 'match_reference_on_entry', 'set_reference_norms',
    'sync_reference_identity_signals', 'sync_shidduch_identity_signals',
    'purge_polymorphic_dependents', 'sync_task_target',
    'link_reference_to_shidduch', 'log_reference_call',
    'preview_reference_merge', 'merge_references'
  );

-- TRUNCATE bypasses RLS entirely, so holding it is equivalent to holding the
-- power to wipe every tenant's data at once.
insert into results (name, passed)
select 'authenticated cannot TRUNCATE any table carrying candid data',
       not has_table_privilege('authenticated', 'public.interactions', 'TRUNCATE')
   and not has_table_privilege('authenticated', 'public.identity_signals', 'TRUNCATE')
   and not has_table_privilege('authenticated', 'public.tasks', 'TRUNCATE')
   and not has_table_privilege('authenticated', 'public.reference_links', 'TRUNCATE')
   and not has_table_privilege('authenticated', 'public.shidduchim', 'TRUNCATE')
   and not has_table_privilege('authenticated', 'public.singles', 'TRUNCATE')
   -- Emptying the legal state graph makes enforce_pipeline_transition() reject
   -- every state change, for every tenant.
   and not has_table_privilege('authenticated', 'public.pipeline_transitions', 'TRUNCATE');

insert into results (name, passed)
select 'the diligence timeline cannot be erased row by row',
       not has_table_privilege('authenticated', 'public.interactions', 'DELETE');

insert into results (name, passed)
select 'an interaction''s parent columns are not client-writable',
       not has_column_privilege('authenticated', 'public.interactions', 'scope', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.interactions', 'reference_link_id', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.interactions', 'target_type', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.interactions', 'target_id', 'UPDATE')
   -- but what a note SAYS is still editable
   and has_column_privilege('authenticated', 'public.interactions', 'body', 'UPDATE');

insert into results (name, passed)
-- Story 5.8 adds `resumes_single_id_fkey` — a SECOND composite
-- (account_id, single_id) FK on `resumes`, alongside its existing
-- (account_id, shidduchim_id) one, now that a resume may belong to either
-- a shidduch or a single — bumping the count from 9 to 10.
select 'every account-scoped FK carries account_id, so no cascade crosses tenants',
       count(*) = 10
from pg_constraint c
where c.contype = 'f'
  and c.conrelid in (
    'public.shidduchim'::regclass, 'public.resumes'::regclass,
    'public.redts'::regclass, 'public.shidduch_education'::regclass,
    'public.date_records'::regclass, 'public.reference_links'::regclass,
    'public.interactions'::regclass
  )
  and array_length(c.conkey, 1) = 2;

insert into results (name, passed)
select 'authenticated cannot advance the identity match store sequence',
       not has_sequence_privilege('authenticated', 'public.identity_signals_id_seq', 'USAGE');

insert into results (name, passed)
select 'the new views are security_invoker, so RLS still applies',
       bool_and(c.reloptions @> array['security_invoker=on'])
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('references_summary', 'reference_links_summary');

insert into results (name, passed)
select 'authenticated cannot write the identity match store',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'identity_signals'
           and grantee = 'authenticated'
           and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       );

insert into results (name, passed)
select 'AD-3: nothing hanging off a reference has its own visibility column',
       not exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name in ('reference_links', 'interactions', 'tasks', 'identity_signals')
           and column_name in ('visibility', 'single_visible', 'is_visible')
       );

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
