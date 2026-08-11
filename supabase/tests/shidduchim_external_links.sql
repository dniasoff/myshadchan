--
-- External links tab (Story 5.6) — database test suite.
--
-- AC 6's own falsifiable: `shidduchim_external_links` is scoped to
-- `account_id = current_context_id()` exactly like `shidduch_education` — no
-- sensitivity tier, and no role check among the household's working roles.
-- Two logins inside the SAME household account (a parent_admin and a helper)
-- both read and write the same row — proving the absence of a role
-- restriction, not merely its presence for one role, which is the
-- medical_notes.sql failure mode this suite deliberately does NOT repeat. A
-- third login, a parent_admin of a SECOND, unrelated household account, sees
-- zero rows (the account-scoping half). A fourth login holds no
-- account_members row at all (the fail-closed case).
--
-- AMENDED BY STORY 6.3 (field-level scoping for a single). This suite
-- originally used a `single` as the second same-account role in case (c) and
-- asserted that it could read and update the row. Story 6.3's AC 1 names
-- `shidduchim_external_links` as one of four tables that "deny the `single`
-- role outright — zero rows on every command", and the policy now carries
-- `and public.current_member_role() <> 'single'` (05_policies.sql). The two
-- old assertions were therefore reversed rather than deleted, and case (c)
-- was re-based onto a `helper` so AC 6's real claim — the absence of a role
-- restriction where one was never intended — keeps a live, two-role proof.
--
-- Why the reversal is right on the merits, not merely because a later story
-- said so: this table scopes by `account_id` ALONE, with no join to the
-- parent suggestion's `visibility` or `pipeline_state`. Story 6.2 narrowed a
-- single's view of `shidduchim` to their OWN singles row, `visibility =
-- 'shared'`, and a visible pipeline state. Before 6.3, a single could
-- `select * from shidduchim_external_links` through PostgREST and enumerate
-- links hanging off a SIBLING's suggestions and off their own
-- `private_parent` / `for_sure_not` / `new` ones — learning that suggestions
-- they are not permitted to see exist at all. AD-3 requires visibility to
-- extend to "every child table … via join-to-parent RLS"; with no per-row
-- visibility column on this table, denial is the only expressible posture.
-- 5.6's "a URL bookmark is not sensitive data" was true of the URL and
-- missed the existence leak. The dignity floor (AD-3, FR93) is untouched: a
-- single still sees their live prospects, and a `self_manager` — the role a
-- self-managing adult holds — is not affected by the guard at all.
--
-- AC 7's own falsifiable: the composite FK rejects attaching a link to a
-- shidduch that belongs to a different account (mirroring
-- `references_entity.sql`'s "cannot attach a school to another account's
-- shidduch" coverage of `shidduch_education`), and the trigger catalog facts
-- (`set_..._account_id`, `validate_..._household_scope`) are asserted
-- directly.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (shidduchim_external_links.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql).
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
-- Arrange: five logins. u1 (parent_admin) and u5 (helper) share household
-- account A — the pair that proves no role restriction among the household's
-- working roles. u2 (single) is also in account A and is this suite's
-- denied-role case (Story 6.3, AC 1). u3 is a parent_admin of a SEPARATE
-- household account B. u4 gets no account_members row anywhere (the
-- fail-closed case).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values
  ('e7111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sel-admin@test.local'),
  ('e7222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sel-single@test.local'),
  ('e7333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sel-foreign@test.local'),
  ('e7444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sel-nobody@test.local'),
  ('e7555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sel-helper@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('SEL Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('SEL Household B (foreign)', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e7111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e7222222-2222-2222-2222-222222222222', 'single', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e7555555-5555-5555-5555-555555555555', 'helper', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'e7333333-3333-3333-3333-333333333333', 'parent_admin', 'active');

-- One single + shidduch in account A, created by u1 (parent_admin) while A
-- is active, so the external link has somewhere real to point at. Also one
-- shidduch in account B, for the cross-account FK guard below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.singles (first_name_en) values ('SEL Single Person')
returning id as single_id \gset

insert into public.shidduchim (single_id, name_en) values (:single_id, 'SEL Shidduch')
returning id as shidduch_id \gset

insert into ids values ('single_id', :'single_id'), ('shidduch_id', :'shidduch_id');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e7333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into public.singles (first_name_en) values ('SEL Foreign Single')
returning id as foreign_single_id \gset

insert into public.shidduchim (single_id, name_en) values (:foreign_single_id, 'SEL Foreign Shidduch')
returning id as foreign_shidduch_id \gset

insert into ids values ('foreign_shidduch_id', :'foreign_shidduch_id');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e7111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (a) INSERT: the parent_admin can write an external link.
-- ---------------------------------------------------------------------------
insert into public.shidduchim_external_links (shidduchim_id, url, label)
values (:shidduch_id, 'https://shidduch-site.example/profile/1', 'Their profile')
returning id as link_id \gset

insert into ids values ('link_id', :'link_id');

insert into results (name, passed)
select '(a) insert: parent_admin can insert an external link for a shidduch in the active account',
       (select count(*) from public.shidduchim_external_links where id = (select value::bigint from ids where name = 'link_id')) = 1;

insert into results (name, passed)
select '(a) insert: account_id was server-set to the active account, not left null or client-supplied',
       (select account_id from public.shidduchim_external_links where id = (select value::bigint from ids where name = 'link_id')) = (select value::bigint from ids where name = 'acct_a');

-- ---------------------------------------------------------------------------
-- (b) SELECT: parent_admin (u1) sees the row.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(b) select: parent_admin (u1) sees the external link',
       (select count(*) from public.shidduchim_external_links) = 1;

-- ---------------------------------------------------------------------------
-- (c) SELECT + UPDATE: helper (u5), a DIFFERENT role in the SAME account,
-- also sees and can write the row — AC 6's "no role check", proven with a
-- real second role rather than only asserted in prose. `helper` replaced the
-- `single` this case originally used; see the AMENDED BY STORY 6.3 note in
-- the file header, and case (c2) below for what the `single` may now do.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7555555-5555-5555-5555-555555555555","role":"authenticated"}';

insert into results (name, passed)
select '(c) select: helper (u5), a different role in the same account, also sees the external link (AC 6: no role check)',
       (select count(*) from public.shidduchim_external_links) = 1;

do $$
declare
  v_link_id bigint;
  v_rows_affected int;
begin
  select value::bigint into v_link_id from ids where name = 'link_id';
  update public.shidduchim_external_links set label = 'Updated by helper' where id = v_link_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    '(c) update: helper (u5) can update the label (AC 6: no role check)',
    v_rows_affected = 1,
    'rows affected: ' || v_rows_affected
  );
end $$;

-- ---------------------------------------------------------------------------
-- (c2) STORY 6.3, AC 1: the `single` role is denied outright — "zero rows on
-- every command". u2 is a single in account A, the SAME account whose row u1
-- and u5 just read and wrote above, so the two-sided proof this file needs is
-- already standing: cases (a)/(b)/(c) show the row is visible and writable to
-- the account's other roles in this very run.
--
-- The first two assertions are the ones that make the rest falsifiable. A
-- "sees zero rows" check passes just as happily when the caller resolved to
-- NO context at all (a broken current_context_id(), a fixture that forgot the
-- membership row, a trigger that failed to activate) — which would prove
-- nothing about the ROLE guard and would keep this suite green through a
-- total collapse of context resolution. Pinning both the resolved context and
-- the resolved role first means every denial below can only be explained by
-- `current_member_role() <> 'single'`.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select '(c2) precondition: the single (u2) IS resolved into account A — the denials below are the role guard, not a missing context',
       public.current_context_id() = (select value::bigint from ids where name = 'acct_a'),
       'resolved context: ' || coalesce(public.current_context_id()::text, 'NULL');

insert into results (name, passed, detail)
select '(c2) precondition: the single (u2) resolves to role ''single''',
       public.current_member_role() = 'single',
       'resolved role: ' || coalesce(public.current_member_role(), 'NULL');

insert into results (name, passed)
select '(c2) select: the single (u2) sees zero external links, though a parent_admin and a helper in the same account both saw the row in this run (Story 6.3 AC 1)',
       (select count(*) from public.shidduchim_external_links) = 0;

do $$
declare
  v_link_id bigint;
  v_rows_affected int;
begin
  select value::bigint into v_link_id from ids where name = 'link_id';
  update public.shidduchim_external_links set label = 'Updated by single' where id = v_link_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    '(c2) update: the single (u2) updates zero rows (Story 6.3 AC 1)',
    v_rows_affected = 0,
    'rows affected: ' || v_rows_affected
  );
end $$;

do $$
declare
  v_link_id bigint;
  v_rows_affected int;
begin
  select value::bigint into v_link_id from ids where name = 'link_id';
  delete from public.shidduchim_external_links where id = v_link_id;
  get diagnostics v_rows_affected = row_count;
  insert into results values (
    '(c2) delete: the single (u2) deletes zero rows (Story 6.3 AC 1 — "every command", and DELETE is granted to authenticated, so RLS is the only thing stopping it)',
    v_rows_affected = 0,
    'rows affected: ' || v_rows_affected
  );
exception when others then
  insert into results values (
    '(c2) delete: the single (u2) deletes zero rows (Story 6.3 AC 1 — "every command", and DELETE is granted to authenticated, so RLS is the only thing stopping it)',
    true, sqlerrm
  );
end $$;

-- INSERT is the half a `using`-only guard would leave open: `using` filters
-- what a caller can see, `with check` is what stops them writing a new row.
-- Story 6.3 put the clause on both, and this asserts the second one directly
-- rather than trusting that it was not forgotten.
do $$
declare
  v_shidduch_id bigint;
begin
  select value::bigint into v_shidduch_id from ids where name = 'shidduch_id';
  insert into public.shidduchim_external_links (shidduchim_id, url, label)
  values (v_shidduch_id, 'https://example.com/added-by-single', 'Added by single');
  insert into results values (
    '(c2) insert: the single (u2) cannot create an external link (the `with check` half, not just `using`)',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    '(c2) insert: the single (u2) cannot create an external link (the `with check` half, not just `using`)',
    sqlerrm like '%row-level security%', sqlerrm
  );
end $$;

-- The single's three write attempts above must have been refusals, not
-- partial writes. Read back as the parent_admin who owns the row: the label
-- is still the helper's, and the row count is unchanged at one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed, detail)
select '(c2) control: after the single''s update/delete/insert attempts, the row still exists, still holds the helper''s label, and no row was added',
       (select count(*) from public.shidduchim_external_links) = 1
         and (select label from public.shidduchim_external_links
              where id = (select value::bigint from ids where name = 'link_id')) = 'Updated by helper',
       'label now: ' || coalesce((select label from public.shidduchim_external_links
              where id = (select value::bigint from ids where name = 'link_id')), 'ROW GONE');

-- ---------------------------------------------------------------------------
-- (d) SELECT: a parent_admin of a SECOND, unrelated account (u3) sees zero
-- rows — the account-scoping half.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select '(d) select: a parent_admin of a different account sees zero rows (account-scoping, not role, is the reason)',
       (select count(*) from public.shidduchim_external_links) = 0;

-- ---------------------------------------------------------------------------
-- (e) AC 7: the composite FK rejects attaching a link to a shidduch owned by
-- a DIFFERENT account, mirroring references_entity.sql's shidduch_education
-- coverage. u3 is active in account B; foreign_shidduch_id belongs to B, so
-- this specific insert must succeed (same-account attach)...
-- ---------------------------------------------------------------------------
insert into public.shidduchim_external_links (shidduchim_id, url)
values ((select value::bigint from ids where name = 'foreign_shidduch_id'), 'https://example.com/own-account')
returning id as own_account_link_id \gset

insert into results (name, passed)
select '(e) insert: u3 can attach a link to a shidduch inside their OWN active account',
       (select count(*) from public.shidduchim_external_links where id = :own_account_link_id) = 1;

-- ...while attaching to A's shidduch (shidduch_id, owned by account A) while
-- B is active must fail — the composite FK, not merely RLS, is what closes
-- this: shidduchim_id alone is a valid row, but (account_id, shidduchim_id)
-- together is not.
do $$
declare
  v_shidduch_id bigint;
begin
  select value::bigint into v_shidduch_id from ids where name = 'shidduch_id';
  insert into public.shidduchim_external_links (shidduchim_id, url)
  values (v_shidduch_id, 'https://example.com/cross-account');
  insert into results values ('(e) insert: cannot attach a link to another account''s shidduch', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(e) insert: cannot attach a link to another account''s shidduch',
    true, sqlerrm
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e7111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (f) The url column is required — the app validates before insert (AC 4),
-- but the database is the authoritative boundary.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.shidduchim_external_links (shidduchim_id) values ((select value::bigint from ids where name = 'shidduch_id'));
  insert into results values ('(f) insert: url is required (not null)', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values (
    '(f) insert: url is required (not null)',
    sqlerrm like '%null value in column "url"%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- (g) Trigger catalog facts: this story's schema decisions, asserted
-- directly rather than only through their read-time effects above.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(g) set_shidduchim_external_links_account_id fires BEFORE INSERT on shidduchim_external_links',
       exists (
         select 1 from pg_trigger
         where tgname = 'set_shidduchim_external_links_account_id'
           and tgrelid = 'public.shidduchim_external_links'::regclass
           and not tgisinternal
       );

insert into results (name, passed)
select '(g) validate_shidduchim_external_links_household_scope (enforce_household_scope) is attached to shidduchim_external_links',
       exists (
         select 1 from pg_trigger
         where tgname = 'validate_shidduchim_external_links_household_scope'
           and tgrelid = 'public.shidduchim_external_links'::regclass
           and tgfoid = 'public.enforce_household_scope'::regproc
           and not tgisinternal
       );

-- ---------------------------------------------------------------------------
-- (h) anon: zero rows, zero privileges — same posture as entity_files /
-- resume_photos / medical_notes.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

do $$
begin
  perform count(*) from public.shidduchim_external_links;
  insert into results values ('(h) anon: reads zero shidduchim_external_links rows (SELECT itself is denied)', false, 'SELECT unexpectedly succeeded');
exception when others then
  insert into results values ('(h) anon: reads zero shidduchim_external_links rows (SELECT itself is denied)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select '(h) anon: holds no privilege on public.shidduchim_external_links',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shidduchim_external_links' and grantee = 'anon'
       );

-- ---------------------------------------------------------------------------
-- (i) An AUTHENTICATED caller with ZERO active memberships anywhere sees
-- zero rows — the policy's fail-closed posture, asserted directly (same
-- proof shape as medical_notes.sql's case (k)).
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7444444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed)
select '(i) an authenticated caller with zero active memberships resolves to no active context',
       public.current_context_id() is null;

insert into results (name, passed)
select '(i) an authenticated caller with zero active memberships sees zero shidduchim_external_links rows (fails closed)',
       (select count(*) from public.shidduchim_external_links) = 0;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
