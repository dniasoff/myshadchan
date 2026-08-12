--
-- Standing guard: consuming an ACCEPTED comment-or-edit-tier child grant to
-- write and read back `kind = 'grantee_input'` rows on `public.interactions`
-- — database suite.
--
-- WHY IT EXISTS. This is the interactions half of the child_grants access-tier
-- plan (Epic 14 / Story 13.x): a grantee household whose accepted grant carries
-- access_level 'comment' or 'edit' may add their own commentary to the
-- PROPOSER's `interactions` table via "Grantee inserts commentary via accepted
-- grant" and read it back via "Grantee reads own input via accepted grant"
-- (05_policies.sql) — WITHOUT gaining any visibility into the family's own
-- existing candid notes/call logs, which stay governed exclusively by the
-- general "Interactions readable within account and parent visibility" policy
-- (`account_id = current_context_id()`, never true for a grantee whose active
-- context is their OWN account).
--
-- Mirrors the exact `single_input` shape (Story 6.4): additive INSERT +
-- SELECT policies, append-only (no UPDATE path for either the author or an
-- owning-role member — see (m)/(n) below), author-scoped read-back. What
-- differs: the row's `account_id` is the PROPOSER's account, not the
-- inserting caller's own `current_context_id()` — the one genuinely
-- cross-account write shape in this schema — and `target_type = 'single'` /
-- `scope = 'account'` (a grant is per-SINGLE, not per-suggestion), with
-- `target_id` the single's own id directly (no `shidduch_single_id()`
-- derivation needed).
--
-- INSERT has no `using` clause (there is no OLD row to filter) — EVERY RLS
-- denial on INSERT is enforced entirely by `with check` and therefore ALWAYS
-- raises rather than silently returning 0 rows affected, unlike the UPDATE
-- assertions in the shidduch_education/redts mirrors. Every INSERT-attempting
-- assertion below is a DO block with its own exception handler for exactly
-- this reason.
--
--   (a) NEGATIVE: a stranger household (no grant at all) cannot INSERT a
--       grantee_input row.
--   (b) NEGATIVE: a READ-tier accepted grantee cannot INSERT one either —
--       'comment'/'edit' only.
--   (c) NEGATIVE: a single-role member of a comment-tier grantee's OWN
--       household cannot INSERT — the read-only-structural boundary every
--       prior grant-consuming policy in this file carries.
--   (c2)/(c3)/(c4) NEGATIVE: a comment-tier grantee cannot repoint the row's
--       account_id, target a different single, or change the kind to `note`.
--   (d)/(e) NEGATIVE, THE SINGLE MOST IMPORTANT ASSERTION: a comment-tier and
--       an edit-tier accepted grantee, BEFORE either has ever inserted
--       anything, cannot read ANY of the family's own private interactions
--       (a `note` row) — by id, or in a full list scan over the proposer's
--       account. If the grant policy's account_id join were ever widened
--       from "the proposer's account" to something looser, this is what
--       would catch it.
--   (f)/(g) POSITIVE: the comment-tier and the edit-tier accepted grantee
--       CAN each INSERT their own grantee_input row, and read it back.
--   (h) NEGATIVE (re-affirmed): the comment-tier grantee, now that their OWN
--       grantee_input row exists, STILL cannot read the family's private
--       note — proves the new read-back policy did not accidentally widen
--       into the family's own content.
--   (i) NEGATIVE: cross-grantee isolation — the edit-tier grantee cannot read
--       the COMMENT-tier grantee's own grantee_input row. The read-back
--       policy is `actor_member_id = current_member_id()`, not "any accepted
--       grantee for this single."
--   (j) POSITIVE: the family (the proposer's own account members) CAN see
--       the comment-tier grantee's grantee_input row — by id and in a list
--       scan — through their normal, unmodified interactions read policy.
--   (k) NEGATIVE: the comment-tier grantee cannot UPDATE their own
--       grantee_input row — append-only, mirroring single_input's Story 6.4
--       (AC 3) decision exactly.
--   (l) NEGATIVE: the family's own owning-role member (parent_admin) cannot
--       UPDATE the grantee's grantee_input row either — append-only for
--       EVERY role, not merely for the author.
--   (m) `interactions_summary.can_moderate` agrees with (k)'s UPDATE outcome
--       for the grantee_input row (the view/policy sync 03_views.sql's own
--       comment requires — mirrors (g3) in interaction_note_authorship.sql).
--
-- The runner is child_grant_interactions_comment_access.test.ts.
--

create temporary table results (
  name text,
  passed boolean,
  detail text
) on commit drop;
grant all on results to public;

create temporary table ids (k text primary key, v bigint) on commit drop;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: a proposing household (A), three grantee households at each of the
-- three tiers (B = comment, C = edit, D = read), an unrelated stranger
-- household (E), and a single-role member inside B (to pin the
-- read-only-structural boundary in (c)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('3a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-proposer@test.local'),
  ('3bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-grantee-comment@test.local'),
  ('3ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-grantee-edit@test.local'),
  ('3dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-grantee-read@test.local'),
  ('3eeee555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-stranger@test.local'),
  ('3fffff66-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgia-grantee-comment-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGIA Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGIA Grantee Comment') returning id as acct_b \gset
insert into public.accounts (name) values ('CGIA Grantee Edit') returning id as acct_c \gset
insert into public.accounts (name) values ('CGIA Grantee Read') returning id as acct_d \gset
insert into public.accounts (name) values ('CGIA Stranger') returning id as acct_e \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '3a111111-1111-1111-1111-111111111111', 'parent_admin');

insert into public.account_members (account_id, user_id, role) values
  (:acct_b, '3bbbbbbb-2222-2222-2222-222222222222', 'parent_admin')
returning id as member_b \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_c, '3ccccc33-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_d, '3dddd444-4444-4444-4444-444444444444', 'parent_admin'),
  (:acct_e, '3eeee555-5555-5555-5555-555555555555', 'parent_admin'),
  (:acct_b, '3fffff66-6666-6666-6666-666666666666', 'single');

insert into public.member_state (user_id, active_account_id) values
  ('3a111111-1111-1111-1111-111111111111', :acct_a),
  ('3bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('3ccccc33-3333-3333-3333-333333333333', :acct_c),
  ('3dddd444-4444-4444-4444-444444444444', :acct_d),
  ('3eeee555-5555-5555-5555-555555555555', :acct_e),
  ('3fffff66-6666-6666-6666-666666666666', :acct_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Not', 'Granted') returning id as single_other \gset

insert into ids values ('acct_a', :acct_a);
insert into ids values ('member_b', :member_b);
insert into ids values ('single_a', :single_a);
insert into ids values ('single_other', :single_other);

-- The family's own candid content: a private note about the single, authored
-- by the proposer's own parent_admin. This is what MUST stay fully invisible
-- to every grantee at every tier — the single most important negative this
-- suite proves.
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:acct_a, 'single', :single_a, 'account', 'note', 'CGIA family private note')
returning id as family_note \gset

insert into ids values ('family_note', :family_note);

-- Three grants, one per tier, all already 'accepted' from insert.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgia-test-hash-comment', 'accepted', now() + interval '30 days', :acct_b, now(), 'comment')
returning id as grant_comment \gset

insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgia-test-hash-edit', 'accepted', now() + interval '30 days', :acct_c, now(), 'edit')
returning id as grant_edit \gset

insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgia-test-hash-read', 'accepted', now() + interval '30 days', :acct_d, now(), 'read')
returning id as grant_read \gset

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: a stranger household (no grant at all) cannot INSERT a
-- grantee_input row.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3eeee555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA stranger attempted insert');

  insert into results (name, passed, detail)
  values ('(a) a stranger household cannot INSERT a grantee_input row', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(a) a stranger household cannot INSERT a grantee_input row', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a READ-tier accepted grantee cannot INSERT a grantee_input
-- row — 'comment'/'edit' only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA read-tier grantee attempted insert');

  insert into results (name, passed, detail)
  values ('(b) a READ-tier accepted grantee cannot INSERT a grantee_input row', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(b) a READ-tier accepted grantee cannot INSERT a grantee_input row', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (c) NEGATIVE: a single-role member of the comment-tier grantee's OWN
-- household cannot INSERT — the grant opens write for the household's owning
-- members, not for that household's own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3fffff66-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA single-role member attempted insert');

  insert into results (name, passed, detail)
  values ('(c) a single-role member of a comment-tier grantee household cannot INSERT', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(c) a single-role member of a comment-tier grantee household cannot INSERT', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (c2)/(c3)/(c4) NEGATIVE: the comment-tier grant is exact, not a general
-- cross-account write. The same owning-role grantee must be denied when it
-- submits the proposer's row under its OWN account_id, names a different
-- single in the proposer's account, or uses a different interaction kind.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_b'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA wrong-account insert');
  insert into results (name, passed, detail)
  values ('(c2) a comment-tier grantee cannot insert into its own account_id', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(c2) a comment-tier grantee cannot insert into its own account_id', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_other'), 'account', 'grantee_input', 'CGIA wrong-target insert');
  insert into results (name, passed, detail)
  values ('(c3) a comment-tier grantee cannot insert for a different single', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(c3) a comment-tier grantee cannot insert for a different single', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'note', 'CGIA wrong-kind insert');
  insert into results (name, passed, detail)
  values ('(c4) a comment-tier grantee cannot insert a private note kind', false, 'INSERT succeeded — expected RLS denial');
exception when others then
  insert into results (name, passed, detail)
  values ('(c4) a comment-tier grantee cannot insert a private note kind', true, format('INSERT correctly denied: %s', sqlerrm));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (d)/(e) NEGATIVE, THE SINGLE MOST IMPORTANT ASSERTION: BEFORE either
-- grantee has inserted anything, the comment-tier and the edit-tier accepted
-- grantee cannot read the family's own private note — by id, or in a full
-- list scan over the proposer's account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select '(d) a comment-tier accepted grantee cannot read the family''s private note by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where id = (select v from ids where k = 'family_note');

insert into results (name, passed, detail)
select '(d) a comment-tier accepted grantee sees zero rows in a full list scan over the proposer''s account',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where account_id = (select v from ids where k = 'acct_a');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"3ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select '(e) an edit-tier accepted grantee cannot read the family''s private note by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where id = (select v from ids where k = 'family_note');

insert into results (name, passed, detail)
select '(e) an edit-tier accepted grantee sees zero rows in a full list scan over the proposer''s account',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where account_id = (select v from ids where k = 'acct_a');

reset role;

-- ---------------------------------------------------------------------------
-- (f) POSITIVE: the comment-tier accepted grantee CAN INSERT their own
-- grantee_input row, and reads it back.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA comment-tier grantee input');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values ('(f) a comment-tier accepted grantee CAN INSERT a grantee_input row', v_rows = 1, format('rows = %s (expected 1)', v_rows));
exception when others then
  insert into results (name, passed, detail)
  values ('(f) a comment-tier accepted grantee CAN INSERT a grantee_input row', false, sqlerrm);
end $$;

insert into results (name, passed, detail)
select '(f) the comment-tier grantee reads back their own grantee_input row',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.interactions
where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';

insert into results (name, passed, detail)
select '(f) the comment-tier row is authored by the grantee household member, not a client-supplied actor',
       count(*) = 1 and bool_and(actor_member_id = (select v from ids where k = 'member_b')),
       format('rows=%s actor_member_ids=%s expected_member_b=%s', count(*), string_agg(actor_member_id::text, ','), (select v from ids where k = 'member_b'))
from public.interactions
where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';

reset role;

-- ---------------------------------------------------------------------------
-- (g) POSITIVE: the edit-tier accepted grantee CAN ALSO INSERT a
-- grantee_input row (edit is a superset of comment), and reads it back.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select v from ids where k = 'acct_a'), 'single', (select v from ids where k = 'single_a'), 'account', 'grantee_input', 'CGIA edit-tier grantee input');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values ('(g) an edit-tier accepted grantee CAN also INSERT a grantee_input row', v_rows = 1, format('rows = %s (expected 1)', v_rows));
exception when others then
  insert into results (name, passed, detail)
  values ('(g) an edit-tier accepted grantee CAN also INSERT a grantee_input row', false, sqlerrm);
end $$;

insert into results (name, passed, detail)
select '(g) the edit-tier grantee reads back their own grantee_input row',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.interactions
where kind = 'grantee_input' and body = 'CGIA edit-tier grantee input';

reset role;

-- ---------------------------------------------------------------------------
-- (h) NEGATIVE (re-affirmed): the comment-tier grantee, now that their OWN
-- grantee_input row exists, STILL cannot read the family's private note —
-- proves the new read-back policy did not accidentally widen into the
-- family's own content.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select '(h) the comment-tier grantee STILL cannot read the family''s private note by id, even after inserting their own row',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where id = (select v from ids where k = 'family_note');

insert into results (name, passed, detail)
select '(h) the comment-tier grantee''s full list scan over the proposer''s account returns ONLY their own grantee_input row, never the family note',
       count(*) = 1 and bool_and(kind = 'grantee_input'),
       format('rows = %s, kinds = %s (expected exactly 1, all grantee_input)', count(*), string_agg(distinct kind, ','))
from public.interactions
where account_id = (select v from ids where k = 'acct_a');

reset role;

-- ---------------------------------------------------------------------------
-- (i) NEGATIVE: cross-grantee isolation — the edit-tier grantee cannot read
-- the COMMENT-tier grantee's own grantee_input row. The read-back policy is
-- `actor_member_id = current_member_id()`, not "any accepted grantee for
-- this single."
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select '(i) the edit-tier grantee cannot read the comment-tier grantee''s own grantee_input row',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.interactions
where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';

reset role;

-- ---------------------------------------------------------------------------
-- (j) POSITIVE: the family (the proposer's own account members) CAN see the
-- comment-tier grantee's grantee_input row — by id and in a list scan —
-- through their normal, UNMODIFIED interactions read policy. No new policy
-- exists for this direction; the general SELECT policy has no `kind`
-- bucketing at all.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3a111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed, detail)
select '(j) the family reads the comment-tier grantee''s grantee_input row through their normal read policy',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.interactions
where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';

insert into results (name, passed, detail)
select '(j) the family''s full list scan over their own account includes both the private note AND both grantees'' comments',
       count(*) = 3,
       format('rows = %s (expected 3: the family note + comment-tier + edit-tier grantee_input)', count(*))
from public.interactions
where account_id = (select v from ids where k = 'acct_a');

reset role;

-- ---------------------------------------------------------------------------
-- (k) NEGATIVE: the comment-tier grantee cannot UPDATE their own
-- grantee_input row — append-only, mirroring single_input's Story 6.4 (AC 3)
-- decision exactly. A `using`-clause failure on UPDATE silently filters (0
-- rows), no exception expected.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.interactions
  set body = 'the comment-tier grantee tried to revise their own grantee_input row'
  where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values ('(k) the AUTHOR of a grantee_input row cannot UPDATE it (append-only)', v_rows = 0, format('rows = %s (expected 0)', v_rows));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (l) NEGATIVE: the family's own owning-role member (parent_admin) cannot
-- UPDATE the grantee's grantee_input row either — append-only for EVERY
-- role, not merely for the author. Without `grantee_input` in the UPDATE
-- policy's kind exclusion, the general "any account member may update"
-- branch would let the family silently edit the grantee's own words.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"3a111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.interactions
  set body = 'the family tried to revise the grantee''s grantee_input row'
  where kind = 'grantee_input' and body = 'CGIA comment-tier grantee input';
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values ('(l) an owning-role FAMILY member cannot UPDATE the grantee''s grantee_input row (append-only for every role)', v_rows = 0, format('rows = %s (expected 0)', v_rows));
end $$;

-- ---------------------------------------------------------------------------
-- (m) interactions_summary.can_moderate AGREES with (k)'s UPDATE outcome for
-- the grantee_input row — the view/policy sync 03_views.sql's own comment
-- requires (mirrors (g3) in interaction_note_authorship.sql). Read as the
-- family, who can see the row via (j).
--
-- A DO block, deliberately NOT `insert into results ... select ... where` —
-- interaction_note_authorship.sql's own (g3) comment names exactly this
-- defect: a plain filtered select silently inserts ZERO result rows (not a
-- failing one) the moment its subject doesn't exist, deleting the check from
-- the report instead of failing it. `found` makes a missing subject fail
-- loudly instead.
-- ---------------------------------------------------------------------------
do $$
declare
  v_can_moderate boolean;
  v_seen boolean;
begin
  select s.can_moderate into v_can_moderate
  from public.interactions_summary s
  where s.kind = 'grantee_input' and s.body = 'CGIA comment-tier grantee input';
  v_seen := found;

  insert into results (name, passed, detail)
  values (
    '(m) interactions_summary.can_moderate is false for the grantee_input row (append-only, matches (k)/(l))',
    v_seen and v_can_moderate = false,
    format('seen_through_view=%s can_moderate=%s (expected seen=true, can_moderate=false)', v_seen, v_can_moderate)
  );
end $$;

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
