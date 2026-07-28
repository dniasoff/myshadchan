--
-- Cross-context RLS hardening (Epic 2 verification blockers #2 and #3) —
-- database test suite.
--
-- Stories 2.1-2.8 repointed every RLS policy's account gate from
-- current_account_id() to current_context_id(). Four of those repoints
-- shipped with no automated cross-context negative test:
--   * storage.objects (07_storage.sql) — the three "Attachments ... within
--     account" policies gate the `attachments` bucket, which holds resumes
--     and photos (PRV-1's highest-sensitivity data, and the surface of a live
--     cross-account leak shortly before this suite was written).
--   * public.inbox_items — exercised elsewhere only via the AC-3a
--     household-scope trigger-ordering fixture (context_resolution.sql),
--     never via a genuine cross-context read attempt.
--   * public.ai_usage — exercised elsewhere only as the entitled tenant
--     itself (billing_entitlement.sql); never as an outsider trying to read
--     someone else's usage meter.
--   * public.shadchanim — exercised elsewhere only as the AC-3a
--     trigger-ordering fixture.
--
-- Every check here is written so that reverting the corresponding policy to
-- something permissive turns it red. Proven by hand for all four areas before
-- this file was committed: loosen the predicate on the local stack, run this
-- suite and watch the affected check fail, then restore the exact schema
-- definition and watch it pass again.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (context_rls_hardening.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so the
-- one id a DO block below needs is shared through the `ids` temp table
-- rather than \gset (references_entity.sql established this pattern).
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
-- Arrange: two household tenants that must never see or touch each other's
-- rows. handle_new_user() bootstraps the first insert's membership; cleared
-- and re-pointed at this suite's own accounts, exactly as the other suites do.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('aaaaaaaa-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'crls-a@test.local');

insert into auth.users (id, instance_id, aud, role, email)
values ('bbbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'crls-b@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CRLS Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('CRLS Tenant B') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a');

insert into public.account_members (account_id, user_id, role)
values (:acct_a, 'aaaaaaaa-1111-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, 'bbbbbbbb-2222-2222-2222-222222222222', 'parent_admin');

-- ---------------------------------------------------------------------------
-- storage.objects — the attachments bucket (blocker #2).
-- ---------------------------------------------------------------------------

-- The one row a careless migration would silently flip back to public;
-- nothing else guards it.
insert into results (name, passed)
select 'storage.buckets: the attachments bucket is still private (public = false)',
       (select public from storage.buckets where id = 'attachments') is not distinct from false;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

-- Tenant A uploads under its own context prefix, exactly as the app does.
insert into storage.objects (bucket_id, name, owner)
select 'attachments', :acct_a || '/resume.pdf', 'aaaaaaaa-1111-1111-1111-111111111111'
returning id as obj_a \gset

insert into results (name, passed)
select 'storage: tenant A can read the object it just uploaded under its own prefix',
       count(*) = 1
from storage.objects where id = :'obj_a';

-- ---------------------------------------------------------------------------
-- Epic 2 verification finding F3(a) — the anon vector. The bucket being
-- PRIVATE (public = false, asserted above) only closes the unauthenticated
-- CDN-URL download path. A caller hitting the Storage/PostgREST API with the
-- anon apikey (no user JWT at all) goes through Postgres role `anon`, which
-- is a completely separate path RLS still has to close on its own — this is
-- the exact shape of the leak this file's own header cites as its
-- motivation ("a public bucket readable by an anonymous caller"). Both
-- angles: the catalog check (no policy on either table names `anon` or
-- `public`, so a future migration can't silently reintroduce the vector) and
-- a live SELECT as anon, with a real row already in the bucket to fail
-- against.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'storage: no RLS policy on objects/buckets grants access to anon (or PUBLIC)',
       not exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename in ('objects', 'buckets')
           and ('anon' = any(roles) or 'public' = any(roles))
       );

reset role;
set local role anon;

insert into results (name, passed)
select 'storage: anon cannot SELECT any attachments object, even one that exists (0 rows)',
       count(*) = 0
from storage.objects where bucket_id = 'attachments';

insert into results (name, passed)
select 'storage: anon cannot read the attachments bucket''s row in storage.buckets (0 rows)',
       count(*) = 0
from storage.buckets where id = 'attachments';

reset role;

-- ---------------------------------------------------------------------------
-- Epic 2 verification finding F3(b) — no UPDATE coverage. There is
-- deliberately no UPDATE policy at all on storage.objects (07_storage.sql
-- defines only readable/writable/deletable), so nobody — not even the
-- object's own owner — can rename or otherwise mutate a row through the API
-- today. That is a real, load-bearing invariant (an UPDATE policy scoped
-- only by bucket, without also re-deriving the prefix check, is exactly the
-- shape that would let a tenant move an object's key across the account
-- boundary), so it gets a tripwire: both the catalog fact and a live attempt
-- by the object's own owner, which must still be denied. This check is
-- expected to start failing the day storage gains an UPDATE policy — that's
-- the point: it forces whoever adds one to also write the equivalent of the
-- readable/writable/deletable prefix check and to update this suite
-- deliberately, rather than the gap staying silent.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'storage: no UPDATE-applicable policy exists on storage.objects',
       not exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
       );

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

update storage.objects set name = :acct_a || '/renamed.pdf' where id = :'obj_a';

insert into results (name, passed)
select 'storage: even the owning tenant cannot UPDATE (rename) its own attachments object',
       count(*) = 0
from storage.objects where id = :'obj_a' and name = :acct_a || '/renamed.pdf';

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'storage: tenant B cannot SELECT tenant A''s object (0 rows)',
       count(*) = 0
from storage.objects where id = :'obj_a';

do $$
declare v_acct_a text;
begin
  select value into v_acct_a from ids where name = 'acct_a';
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('attachments', v_acct_a || '/evil.pdf', 'bbbbbbbb-2222-2222-2222-222222222222');
    insert into results values ('storage: tenant B cannot INSERT an object under tenant A''s prefix', false, 'insert succeeded');
  exception when others then
    insert into results values ('storage: tenant B cannot INSERT an object under tenant A''s prefix', true, sqlerrm);
  end;
end $$;

-- A direct SQL DELETE against storage.objects hits a statement-level guard
-- (storage.protect_delete(), a BEFORE-STATEMENT trigger) that unconditionally
-- raises "Direct deletion... not allowed" before RLS is ever consulted —
-- confirmed empirically: the guard fires even when the caller's own USING
-- clause would already deny every row. `storage.allow_delete_query` is the
-- session flag that lifts that guard so the delete actually reaches RLS; it
-- is what the real Storage API sets on a legitimate delete. Without setting
-- it here, this test would pass even against a "deletable" policy reverted
-- to `using (true)`, because the exception caught below would just be the
-- statement guard, never an RLS denial — testing a locked door with no key,
-- not testing the lock.
--
-- Postgres RLS also ANDs an UPDATE/DELETE-applicable policy with whatever
-- SELECT-applicable policy exists on the same table: a row must be visible
-- under SELECT before a DELETE policy is even consulted for it — confirmed
-- empirically by loosening "Attachments deletable within account" to
-- `using (true)` alone and watching tenant B's delete still get silently
-- denied (0 rows), purely because the strict readable policy already hides
-- the row. Left as-is, tenant B's continuing inability to SELECT tenant A's
-- row would mask a regression in the DELETE policy specifically — a test
-- that passes even when the policy it names is broken. So this next check
-- transiently swaps the readable policy for a fully permissive one first
-- (DDL is transactional; the suite's own trailing `rollback` undoes it along
-- with everything else, and it is restored explicitly below besides), which
-- isolates exactly what the deletable policy alone contributes: even if
-- SELECT visibility were ever mistakenly widened, DELETE must still refuse a
-- foreign object on its own.
reset role;
drop policy "Attachments readable within account" on storage.objects;
create policy "Attachments readable within account" on storage.objects
    for select to authenticated
    using (bucket_id = 'attachments');

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'storage: sanity check — tenant B can see tenant A''s object once SELECT is (deliberately, transiently) widened',
       count(*) = 1
from storage.objects where id = :'obj_a';

set local storage.allow_delete_query = 'true';
delete from storage.objects where id = :'obj_a';

reset role;
drop policy "Attachments readable within account" on storage.objects;
create policy "Attachments readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );

insert into results (name, passed)
select 'storage: tenant B''s DELETE attempt left tenant A''s object untouched, even with SELECT widened',
       count(*) = 1
from storage.objects where id = :'obj_a';

-- Positive control: tenant A can still delete its own object, so the check
-- above is a genuine RLS denial and not an artifact of the delete path itself
-- being broken.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
delete from storage.objects where id = :'obj_a';

reset role;

insert into results (name, passed)
select 'storage: tenant A can delete its own object (the delete path itself works)',
       count(*) = 0
from storage.objects where id = :'obj_a';

-- ---------------------------------------------------------------------------
-- inbox_items — cross-context read denial (blocker #3).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.inbox_items (source, raw_text) values ('upload', 'CRLS inbox item')
returning id as inbox_a \gset

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'inbox_items: tenant B cannot read tenant A''s inbox item by id', count(*) = 0
from public.inbox_items where id = :inbox_a;

insert into results (name, passed)
select 'inbox_items: tenant B''s inbox never includes tenant A''s account', count(*) = 0
from public.inbox_items where account_id = :acct_a;

-- ---------------------------------------------------------------------------
-- Epic 2 verification finding F3(c) — the write half of `for all` was
-- untested: only SELECT denial was asserted, never that the `with check`
-- clause itself rejects an explicit foreign account_id on INSERT.
-- inbox_items also carries validate_inbox_items_household_scope (04_triggers.sql),
-- a second, independent layer that already blocks this in practice (it
-- relies on the caller's own RLS-limited view of `accounts`, which cannot
-- see a household it holds no membership in — proved empirically before
-- this check was written). Disabling that trigger for this one statement
-- isolates the `with check` clause's own contribution specifically, the same
-- way the storage DELETE section above transiently swaps the readable policy
-- to isolate the deletable policy alone. Re-enabled immediately after,
-- inside this suite's own rolled-back transaction.
-- ---------------------------------------------------------------------------
reset role;
alter table public.inbox_items disable trigger validate_inbox_items_household_scope;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    insert into public.inbox_items (source, raw_text, account_id)
      values ('upload', 'evil cross-account insert', (select value::bigint from ids where name = 'acct_a'));
    insert into results values (
      'inbox_items: with check alone rejects an explicit foreign account_id on INSERT',
      false, 'insert unexpectedly succeeded'
    );
  exception when others then
    insert into results values (
      'inbox_items: with check alone rejects an explicit foreign account_id on INSERT',
      true, sqlerrm
    );
  end;
end $$;

reset role;
alter table public.inbox_items enable trigger validate_inbox_items_household_scope;

-- ---------------------------------------------------------------------------
-- ai_usage — cross-account denial (blocker #3), the same shape
-- billing_entitlement.sql already uses for `subscription`.
-- ---------------------------------------------------------------------------
reset role;

insert into public.ai_usage (account_id, period, resumes_parsed)
values (:acct_a, to_char(now(), 'YYYY-MM'), 7);
insert into public.ai_usage (account_id, period, resumes_parsed)
values (:acct_b, to_char(now(), 'YYYY-MM'), 3);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'ai_usage: a member sees exactly their own account''s usage row and no other',
       (select count(*) from public.ai_usage) = 1
   and (select count(*) from public.ai_usage where account_id = :acct_a) = 1;

insert into results (name, passed)
select 'ai_usage: a member cannot READ another account''s usage meter (PRV-2)',
       (select count(*) from public.ai_usage where account_id = :acct_b) = 0;

-- ---------------------------------------------------------------------------
-- shadchanim — cross-context read denial (blocker #3). Still tenant A's
-- role/claims from the ai_usage section above.
-- ---------------------------------------------------------------------------
insert into public.shadchanim (name) values ('CRLS Shadchan A')
returning id as shadchan_a \gset

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'shadchanim: tenant B cannot read tenant A''s matchmaker record by id', count(*) = 0
from public.shadchanim where id = :shadchan_a;

insert into results (name, passed)
select 'shadchanim: tenant B''s matchmaker list never includes tenant A''s account', count(*) = 0
from public.shadchanim where account_id = :acct_a;

-- Epic 2 verification finding F3(c), same shape as inbox_items above:
-- isolate the `with check` clause itself by disabling
-- validate_shadchanim_household_scope's independent (account-visibility)
-- backstop for one statement.
reset role;
alter table public.shadchanim disable trigger validate_shadchanim_household_scope;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    insert into public.shadchanim (name, account_id)
      values ('Evil Cross-Account Shadchan', (select value::bigint from ids where name = 'acct_a'));
    insert into results values (
      'shadchanim: with check alone rejects an explicit foreign account_id on INSERT',
      false, 'insert unexpectedly succeeded'
    );
  exception when others then
    insert into results values (
      'shadchanim: with check alone rejects an explicit foreign account_id on INSERT',
      true, sqlerrm
    );
  end;
end $$;

reset role;
alter table public.shadchanim enable trigger validate_shadchanim_household_scope;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
