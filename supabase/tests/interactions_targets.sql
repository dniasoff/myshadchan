--
-- interactions target-type widening — RLS, actor attribution, and the purge
-- cascade (Story 3.5) — database test suite.
--
-- Story 3.5 widens `interactions` to all four ENTITY_TARGET_TYPES
-- (`interactions_target_type_check` + the fourth `interactions_scope_link_check`
-- branch, AC 1), refines the `scope = 'account'` disjunct of "Interactions
-- scoped to account and parent visibility" to be target-aware in both `using`
-- and `with check` (AC 3), adds `current_member_id()` +
-- `set_interaction_actor_member_id` so `actor_member_id` is server-set and
-- never client-supplied (AC 4), and adds `purge_single_dependents` /
-- `purge_shadchan_dependents` (AC 5). This suite is a new pair — not an
-- extension of references_entity.sql — because its fixture is one login
-- holding active memberships in TWO household contexts (A and B) plus a
-- third, shadchanus-kind membership, which no earlier suite's fixture gives.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (interactions_targets.test.ts) turns each row into a named assertion.
--
-- Falsifiability record (contract §13 rule 2 — every check shown red once
-- against a deliberately reverted schema before it is shown green). Proven
-- by hand by temporarily moving this story's migration file out of
-- supabase/migrations/, running `supabase db reset --local`, running this
-- suite (every insert that depends on the migration is wrapped in its own
-- `exception when others` precisely so the reverted run still completes and
-- emits a full report rather than aborting under `ON_ERROR_STOP`), then
-- restoring the migration file and resetting again to confirm green.
-- Actual reverted-run results:
--   * (a) — both inserts fail: "violates check constraint
--     interactions_scope_link_check" (Postgres evaluated that constraint
--     before interactions_target_type_check for this row shape; either
--     constraint failing is a valid red signal — AC 1's own Dev Notes
--     explains why both must be widened together).
--   * (b) — the two "the caller sees its own row" assertions fail (the
--     fixture rows (a) would have created never exist); the "zero of B's
--     row is visible" arms pass vacuously, for the same reason.
--   * (c) — AC 1 (type widening) and AC 3 (target-integrity) shipped in the
--     same migration, so this suite does not rely on the full revert to
--     isolate AC 3's own contribution: an in-suite transient policy swap
--     (below) does that instead, the same technique context_rls_hardening.sql
--     uses to isolate its DELETE policy. In the full-revert run the swap's
--     own "sanity" row is collateral-red too (the insert never reaches the
--     policy at all, blocked by the type/scope-link checks first) — expected,
--     and exactly why the swap technique, not the full revert, is this
--     check's real falsifiability proof, live in every run of this file. The
--     real policies' USING / WITH CHECK expressions are captured verbatim
--     from `pg_policy` BEFORE the swap and used, unmodified, to restore them
--     afterward — this file never re-types the shipped policy text. The row
--     the old policy wrongly lets through is kept (not deleted) across the
--     restore so the real SELECT policy's `using` clause can be asserted
--     against it directly: that row's account_id equals the active context
--     (A), so only the target-aware `exists` clause — not the top-level
--     account_id floor AC 10(b) already exercises — can be what hides it.
--
--     Story 3.6 (05_policies.sql) later split the single `for all`
--     "Interactions scoped to account and parent visibility" policy this
--     suite originally swapped into three per-command policies — SELECT,
--     INSERT, UPDATE — with byte-identical predicates. The swap below now
--     targets the SELECT policy ("Interactions readable within account and
--     parent visibility") and the INSERT policy ("Interactions insertable
--     within account and parent visibility") together, both to the same bad
--     shape, and restores both afterward — narrower than before (the UPDATE
--     policy is never touched, since nothing here exercises it) but not
--     narrower than that: the sanity insert uses `returning id`, and
--     Postgres requires a `RETURNING` row to also satisfy the table's SELECT
--     policy, raising the SAME `row-level security policy` error the
--     `with check` itself would if that policy alone were left at its real,
--     narrow shape — swapping only the INSERT policy was tried and breaks
--     here for exactly that reason. Swapping both together is the accurate
--     per-command translation of what one combined `for all` policy did
--     before the split.
--   * (d) — fails: "function public.current_member_id() does not exist".
--     The archived-lower-id-wins bug-fix check added alongside it is
--     unaffected by reverting this story's migration (account_members is
--     untouched by it); proven separately, live, by dropping
--     `and am.status = 'active'` from current_member_id()'s body.
--   * (e) — the shadchan/tasks arm fails (task row survives — no purge
--     trigger); the interactions arms pass vacuously (the fixture insert
--     itself is already blocked by interactions_target_type_check, the
--     same shape as (c)); the tasks/single and every identity_signals arm
--     are vacuous by construction regardless of this story (see the comment
--     at that section).
--   * (f) — asserts a fact 3-14 established (household_scope_lift.sql
--     already proved it red/green there) and is unaffected by a revert of
--     THIS story's migration; this suite treats it as a non-regression
--     guard and additionally proves it live: re-attaching
--     `validate_interactions_household_scope` (dropped, in-suite DDL) turns
--     the check red, recorded as its own "sanity" row below.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so ids
-- a DO block below needs are shared through the `ids` temp table rather
-- than \gset (context_resolution.sql / household_scope_lift.sql precedent).
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
-- Arrange: ONE login U — parent_admin of household A, parent_admin of
-- household B, and shadchan of shadchanus account C. activate_first_context
-- fires on U's first membership (A); adding B and C afterward leaves A
-- active (AC-5, context_resolution.sql).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a3050001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'it-u@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('IT Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('IT Household B', 'household') returning id as acct_b \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_c \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b'), ('acct_c', :'acct_c');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a3050001-0000-0000-0000-000000000001', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'a3050001-0000-0000-0000-000000000001', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_c, 'a3050001-0000-0000-0000-000000000001', 'shadchan', 'active');

-- Domain rows the target-integrity `exists` checks (AC 3) join against — one
-- shadchan and one single per household.
insert into public.shadchanim (account_id, name) values (:acct_a, 'IT Shadchan A') returning id as shadchan_a \gset
insert into public.shadchanim (account_id, name) values (:acct_b, 'IT Shadchan B') returning id as shadchan_b \gset
insert into public.singles (account_id, first_name_en, gender) values (:acct_a, 'IT Single A', 'female') returning id as single_a \gset
insert into public.singles (account_id, first_name_en, gender) values (:acct_b, 'IT Single B', 'female') returning id as single_b \gset
insert into ids values
  ('shadchan_a', :'shadchan_a'), ('shadchan_b', :'shadchan_b'),
  ('single_a', :'single_a'), ('single_b', :'single_b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3050001-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: U''s active context is household A right after all three memberships exist',
       public.current_context_id() = :acct_a;

-- ---------------------------------------------------------------------------
-- AC 10(a): inserting a shadchan-targeted and a single-targeted interaction
-- in A succeeds. With the fourth scope_link_check branch reverted (type
-- widened alone), both raise "violates check constraint
-- interactions_scope_link_check"; with the type check unwidened too, both
-- raise "violates check constraint interactions_target_type_check".
-- ---------------------------------------------------------------------------
do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope)
    values ('shadchan', (select value::bigint from ids where name = 'shadchan_a'), 'account')
    returning id into v_id;
  insert into ids values ('interaction_shadchan_a', v_id::text);
  insert into results values (
    'AC 10(a): inserting a shadchan-targeted interaction succeeds while active in A', true, null
  );
exception when others then
  insert into results values (
    'AC 10(a): inserting a shadchan-targeted interaction succeeds while active in A', false, sqlerrm
  );
end $$;

do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope)
    values ('single', (select value::bigint from ids where name = 'single_a'), 'account')
    returning id into v_id;
  insert into ids values ('interaction_single_a', v_id::text);
  insert into results values (
    'AC 10(a): inserting a single-targeted interaction succeeds while active in A', true, null
  );
exception when others then
  insert into results values (
    'AC 10(a): inserting a single-targeted interaction succeeds while active in A', false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- Arrange (continued): the same two shapes in household B, created while B
-- is the active context so AC 3's own target-integrity check lets them
-- through. Feeds AC 10(b)/(c) below. Wrapped for the same reason as above:
-- these inserts also depend on this story's migration.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope)
    values ('shadchan', (select value::bigint from ids where name = 'shadchan_b'), 'account')
    returning id into v_id;
  insert into ids values ('interaction_shadchan_b', v_id::text);
  insert into results values (
    'Arrange: a shadchan-targeted interaction insert succeeds while active in B', true, null
  );
exception when others then
  insert into results values (
    'Arrange: a shadchan-targeted interaction insert succeeds while active in B', false, sqlerrm
  );
end $$;

do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope)
    values ('single', (select value::bigint from ids where name = 'single_b'), 'account')
    returning id into v_id;
  insert into ids values ('interaction_single_b', v_id::text);
  insert into results values (
    'Arrange: a single-targeted interaction insert succeeds while active in B', true, null
  );
exception when others then
  insert into results values (
    'Arrange: a single-targeted interaction insert succeeds while active in B', false, sqlerrm
  );
end $$;

select public.set_active_context(:acct_a);

-- ---------------------------------------------------------------------------
-- AC 10(b): while active in A, the caller reads its own shadchan/single rows
-- and zero of B's; after set_active_context(B) the visibility swaps.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 10(b): active in A — the caller sees its own shadchan-targeted interaction',
       count(*) = 1
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_shadchan_a');

insert into results (name, passed)
select 'AC 10(b): active in A — zero of B''s shadchan-targeted interaction is visible',
       count(*) = 0
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_shadchan_b');

insert into results (name, passed)
select 'AC 10(b): active in A — the caller sees its own single-targeted interaction',
       count(*) = 1
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_single_a');

insert into results (name, passed)
select 'AC 10(b): active in A — zero of B''s single-targeted interaction is visible',
       count(*) = 0
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_single_b');

select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'AC 10(b): after switching to B, visibility swaps — B''s shadchan-targeted interaction is now visible',
       count(*) = 1
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_shadchan_b');

insert into results (name, passed)
select 'AC 10(b): after switching to B, A''s shadchan-targeted interaction is now invisible',
       count(*) = 0
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_shadchan_a');

select public.set_active_context(:acct_a);

-- ---------------------------------------------------------------------------
-- AC 10(c): while active in A, an insert whose target_id is B's shadchan (or
-- single) is rejected by the refined `with check` — and the same shape,
-- once inserted under the old policy, is hidden by the refined `using`. See
-- the header comment for why this needs an in-suite policy swap rather than
-- a full reversion, and for why the real policies are captured from
-- `pg_policy` rather than re-typed. The swap covers the SELECT and INSERT
-- policies together — see the header comment's Story 3.6 note for why the
-- SELECT half is required even though only the INSERT `with check` is
-- nominally under test here.
-- ---------------------------------------------------------------------------
reset role;

-- Capture the shipped SELECT policy's USING and the INSERT policy's WITH
-- CHECK expressions verbatim, BEFORE any swap, so restoring them below can
-- never drift from whatever 05_policies.sql actually installed — no
-- hand-retyped copy of the real policy appears anywhere in this file. A
-- mutation to a real policy is therefore captured (and later restored) as
-- the SAME mutated text, which is exactly what lets the assertions below
-- catch such a mutation instead of silently passing against a stand-in that
-- always matches the story's intent rather than the shipped schema.
do $$
declare
  v_select_using text;
  v_insert_check text;
begin
  select pg_get_expr(polqual, polrelid)
  into v_select_using
  from pg_policy
  where polrelid = 'public.interactions'::regclass
    and polname = 'Interactions readable within account and parent visibility';

  select pg_get_expr(polwithcheck, polrelid)
  into v_insert_check
  from pg_policy
  where polrelid = 'public.interactions'::regclass
    and polname = 'Interactions insertable within account and parent visibility';

  insert into ids values ('real_select_using', v_select_using);
  insert into ids values ('real_insert_check', v_insert_check);
end $$;

-- Swap in the deliberately pre-Story-3.5 shape (no target-integrity `exists`
-- clause for shadchan/single) so the sanity insert below can construct a
-- cross-context row the OLD policy would have wrongly allowed. This text is
-- never claimed to mirror the shipped policy — it is the known-bad baseline
-- Story 3.5 replaced — so it carries no drift risk of its own. Both the
-- SELECT and INSERT policies are swapped together: the sanity insert below
-- uses `returning id`, and Postgres additionally requires a RETURNING row to
-- satisfy the table's SELECT policy, so leaving the real (narrow) SELECT
-- policy in place while only the INSERT policy is relaxed makes the sanity
-- insert raise the very same `row-level security policy` error it is meant
-- to prove would NOT happen under the old, unrefined policy.
drop policy "Interactions readable within account and parent visibility" on public.interactions;
create policy "Interactions readable within account and parent visibility" on public.interactions
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_context_id()
                      and s.account_id = public.current_context_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_context_id()
                )
            )
        )
    );

drop policy "Interactions insertable within account and parent visibility" on public.interactions;
create policy "Interactions insertable within account and parent visibility" on public.interactions
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_context_id()
                      and s.account_id = public.current_context_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_context_id()
                )
            )
        )
    );

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3050001-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_shadchan_b bigint;
  v_id bigint;
begin
  select value::bigint into v_shadchan_b from ids where name = 'shadchan_b';
  insert into public.interactions (target_type, target_id, scope)
    values ('shadchan', v_shadchan_b, 'account')
    returning id into v_id;
  insert into ids values ('interaction_leaked_shadchan_b', v_id::text);
  insert into results values (
    'AC 10(c) sanity — the pre-Story-3.5 policy (bare scope=''account'' disjunct, no target-integrity exists clause) WRONGLY allows a cross-context shadchan insert (kept, not deleted — the real SELECT policy''s using clause is asserted against this exact row below)',
    true, 'insert unexpectedly succeeded under the old, unrefined policy'
  );
exception when others then
  insert into results values (
    'AC 10(c) sanity — the pre-Story-3.5 policy (bare scope=''account'' disjunct, no target-integrity exists clause) WRONGLY allows a cross-context shadchan insert (kept, not deleted — the real SELECT policy''s using clause is asserted against this exact row below)',
    false, sqlerrm
  );
end $$;

-- Restore the real SELECT and INSERT policies from the pg_policy capture
-- above — verbatim, never re-typed. `reset role` first — `authenticated`
-- cannot alter policies.
reset role;

drop policy "Interactions readable within account and parent visibility" on public.interactions;
drop policy "Interactions insertable within account and parent visibility" on public.interactions;

do $$
declare
  v_select_using text;
  v_insert_check text;
begin
  select value into v_select_using from ids where name = 'real_select_using';
  select value into v_insert_check from ids where name = 'real_insert_check';

  execute format(
    'create policy %I on public.interactions for select to authenticated using (%s)',
    'Interactions readable within account and parent visibility', v_select_using
  );

  execute format(
    'create policy %I on public.interactions for insert to authenticated with check (%s)',
    'Interactions insertable within account and parent visibility', v_insert_check
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3050001-0000-0000-0000-000000000001","role":"authenticated"}';

-- AC 3, `using`: the real, just-restored SELECT policy — "Interactions
-- readable within account and parent visibility" since Story 3.6's split —
-- hides the row the old policy wrongly let through above. That row's
-- account_id = A (it was written while active in A), so the top-level
-- `account_id = current_context_id()` conjunct alone would NOT
-- exclude it while active in A — only the target-aware `exists` clause
-- (target_id names B's shadchan) can. This is the assertion AC 10(b) cannot
-- make: every row AC 10(b) reads carries the account_id of whichever context
-- it was created in, so the top-level conjunct alone already explains that
-- check's "zero of B's row visible" results.
insert into results (name, passed)
select 'AC 10(c): the real SELECT policy''s using clause hides a same-account row whose target_id names another context''s shadchan',
       count(*) = 0
from public.interactions
where id = (select value::bigint from ids where name = 'interaction_leaked_shadchan_b');

-- Clean up the leaked row now that the using assertion above has run against
-- it. `reset role` first — `authenticated` holds no DELETE grant on
-- interactions at all (06_grants.sql, audit trail). Deleting it (rather than
-- leaving it) keeps AC 10(e)'s later purge-by-account_id assertion for
-- shadchan_b (account_id = B) from having to account for an unrelated
-- account_id = A row.
reset role;

delete from public.interactions
where id = (select value::bigint from ids where name = 'interaction_leaked_shadchan_b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3050001-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_shadchan_b bigint;
begin
  select value::bigint into v_shadchan_b from ids where name = 'shadchan_b';
  insert into public.interactions (target_type, target_id, scope)
    values ('shadchan', v_shadchan_b, 'account');
  insert into results values (
    'AC 10(c): while active in A, an insert targeting B''s shadchan is rejected by the with check',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 10(c): while active in A, an insert targeting B''s shadchan is rejected by the with check',
    true, sqlerrm
  );
end $$;

do $$
declare
  v_single_b bigint;
begin
  select value::bigint into v_single_b from ids where name = 'single_b';
  insert into public.interactions (target_type, target_id, scope)
    values ('single', v_single_b, 'account');
  insert into results values (
    'AC 10(c): while active in A, an insert targeting B''s single is rejected by the with check',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 10(c): while active in A, an insert targeting B''s single is rejected by the with check',
    true, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 10(d): a spoofed actor_member_id is overwritten with the caller's real
-- current_member_id(). Still active in A, still authenticated as U.
-- ---------------------------------------------------------------------------
do $$
declare
  v_real_member_id bigint;
  v_other_member_id bigint;
  v_landed_member_id bigint;
begin
  v_real_member_id := public.current_member_id();

  -- A DIFFERENT account_members row entirely — U's own membership of B, not
  -- A. Any id that is not v_real_member_id proves the trigger OVERWRITES
  -- rather than merely defaults (a spoofed NULL would be indistinguishable
  -- from "no value supplied").
  select id into v_other_member_id
  from public.account_members
  where account_id = (select value::bigint from ids where name = 'acct_b')
    and user_id = 'a3050001-0000-0000-0000-000000000001';

  insert into public.interactions (target_type, target_id, scope, actor_member_id)
    values ('shadchan', (select value::bigint from ids where name = 'shadchan_a'), 'account', v_other_member_id)
    returning actor_member_id into v_landed_member_id;

  insert into results values (
    'AC 10(d): a spoofed actor_member_id is overwritten with the caller''s real current_member_id()',
    v_landed_member_id = v_real_member_id and v_landed_member_id is distinct from v_other_member_id,
    format('spoofed=%s landed=%s real=%s', v_other_member_id, v_landed_member_id, v_real_member_id)
  );
exception when others then
  -- Reverted-schema red run: current_member_id() does not exist yet.
  insert into results values (
    'AC 10(d): a spoofed actor_member_id is overwritten with the caller''s real current_member_id()',
    false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 4 (bug-fix half): current_member_id() must resolve the caller's ACTIVE
-- membership, never an archived one with a lower id. Archive U's original
-- account_members row for A — the lowest id account_members holds for this
-- fixture — and insert a fresh active row for the same (account_id,
-- user_id) pair, which lands with a strictly higher id: the partial unique
-- index `account_members_account_user_active_uq` (01_tables.sql) only
-- forbids two ACTIVE rows for the same pair, so archiving the old one first
-- clears the way for the new one. member_state (the active-context pointer)
-- is untouched by any of this, and activate_first_context_trigger does not
-- re-fire it either: by the time the new row is visible to that AFTER INSERT
-- trigger, it already satisfies the trigger's own "does an active row for
-- the pointer exist" check, so `current_context_id()` keeps resolving to A
-- throughout. Falsifiable: dropping `and am.status = 'active'` from
-- current_member_id() makes `order by am.id limit 1` pick the archived,
-- lower-id row instead of the fresh active one.
-- ---------------------------------------------------------------------------
reset role;

update public.account_members
set status = 'archived'
where account_id = (select value::bigint from ids where name = 'acct_a')
  and user_id = 'a3050001-0000-0000-0000-000000000001';

insert into public.account_members (account_id, user_id, role, status)
values (
  (select value::bigint from ids where name = 'acct_a'),
  'a3050001-0000-0000-0000-000000000001',
  'parent_admin',
  'active'
)
returning id as new_member_a \gset

insert into ids values ('new_member_a', :'new_member_a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3050001-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_new_member_a bigint;
  v_resolved bigint;
begin
  select value::bigint into v_new_member_a from ids where name = 'new_member_a';
  v_resolved := public.current_member_id();

  insert into results values (
    'AC 4 (bug fix): current_member_id() resolves the caller''s active membership, not an archived row with a lower id',
    v_resolved = v_new_member_a,
    format('resolved=%s expected_active=%s', v_resolved, v_new_member_a)
  );
exception when others then
  -- Reverted-schema red run: current_member_id() does not exist yet.
  insert into results values (
    'AC 4 (bug fix): current_member_id() resolves the caller''s active membership, not an archived row with a lower id',
    false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- Story 5.7 AC 5: interactions_kind_check widened to accept 'single_input'
-- — the shidduch right rail's read-side panel. Still authenticated as U,
-- active context A. A single_input row is target_type = 'shidduch',
-- scope = 'shidduch', reference_link_id = null, which already satisfies the
-- existing interactions_scope_link_check disjunct for shidduch-targeted
-- rows (01_tables.sql) — this story touches no other constraint.
-- ---------------------------------------------------------------------------
insert into public.shidduchim (single_id, name_en)
values ((select value::bigint from ids where name = 'single_a'), 'IT Shidduch A')
returning id as shidduch_a \gset

insert into ids values ('shidduch_a', :'shidduch_a');

do $$
declare
  v_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope, kind)
    values (
      'shidduch',
      (select value::bigint from ids where name = 'shidduch_a'),
      'shidduch',
      'single_input'
    )
    returning id into v_id;
  insert into ids values ('interaction_single_input', v_id::text);
  insert into results values (
    'AC 5: a single_input-kind interaction on a shidduch-targeted row inserts (interactions_kind_check widened)',
    true, null
  );
exception when others then
  -- Reverted-schema red run: interactions_kind_check does not accept
  -- 'single_input' yet.
  insert into results values (
    'AC 5: a single_input-kind interaction on a shidduch-targeted row inserts (interactions_kind_check widened)',
    false, sqlerrm
  );
end $$;

do $$
begin
  insert into public.interactions (target_type, target_id, scope, kind)
    values (
      'shidduch',
      (select value::bigint from ids where name = 'shidduch_a'),
      'shidduch',
      'not_a_real_kind'
    );
  insert into results values (
    'AC 5 sanity: an unrecognised kind value is still rejected by interactions_kind_check (the widening is exactly one value, not a free-text column)',
    false, 'insert unexpectedly succeeded with an invalid kind'
  );
exception when others then
  insert into results values (
    'AC 5 sanity: an unrecognised kind value is still rejected by interactions_kind_check (the widening is exactly one value, not a free-text column)',
    sqlerrm like '%interactions_kind_check%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 10(e): deleting a single or a shadchan leaves no orphaned polymorphic
-- rows. As postgres, to keep this section independent of which context is
-- active and free to attach fixture rows to either household directly.
--
-- tasks_target_type_check does not accept 'single' yet (Story 3.8's job,
-- contract §8 rule 1) and identity_signals_target_type_check accepts
-- neither 'single' nor 'shadchan' at all (a different, AD-5 vocabulary,
-- pendingDbWidenings.test.ts's own header explains why) — so the
-- single/tasks and both/identity_signals arms below are vacuously true:
-- such a row could never exist in the first place, purge trigger or not.
-- The shadchan/tasks arm is the one genuinely exercised case, since
-- tasks_target_type_check already includes 'shadchan'.
-- ---------------------------------------------------------------------------
reset role;

-- Wrapped, not a plain statement: under a reverted schema
-- interactions_target_type_check does not yet accept 'single', which would
-- otherwise abort the whole script (\set ON_ERROR_STOP on) before the purge
-- checks below get a chance to run and record their own (also red) result.
do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope)
  values (
    (select value::bigint from ids where name = 'acct_a'),
    'single',
    (select value::bigint from ids where name = 'single_a'),
    'account'
  );
exception when others then
  null; -- absence is exactly what the assertion below checks for.
end $$;

delete from public.singles where id = (select value::bigint from ids where name = 'single_a');

insert into results (name, passed)
select 'AC 10(e): deleting a single leaves zero interactions pointing at it',
       count(*) = 0
from public.interactions
where target_type = 'single' and target_id = (select value::bigint from ids where name = 'single_a');

insert into results (name, passed)
select 'AC 10(e): deleting a single leaves zero tasks pointing at it (vacuously true — tasks_target_type_check does not accept ''single'' yet, Story 3.8)',
       count(*) = 0
from public.tasks
where target_type = 'single' and target_id = (select value::bigint from ids where name = 'single_a');

insert into results (name, passed)
select 'AC 10(e): deleting a single leaves zero identity_signals pointing at it (vacuously true — identity_signals_target_type_check does not accept ''single'' at all)',
       count(*) = 0
from public.identity_signals
where target_type = 'single' and target_id = (select value::bigint from ids where name = 'single_a');

-- Wrapped for the same reason as the single-fixture insert above:
-- interactions_target_type_check does not yet accept 'shadchan' under a
-- reverted schema. tasks_target_type_check already includes 'shadchan'
-- today, so the tasks insert below needs no such guard.
do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope)
  values (
    (select value::bigint from ids where name = 'acct_b'),
    'shadchan',
    (select value::bigint from ids where name = 'shadchan_b'),
    'account'
  );
exception when others then
  null; -- absence is exactly what the assertion below checks for.
end $$;

insert into public.tasks (account_id, target_type, target_id, text)
values (
  (select value::bigint from ids where name = 'acct_b'),
  'shadchan',
  (select value::bigint from ids where name = 'shadchan_b'),
  'IT task on shadchan B'
);

delete from public.shadchanim where id = (select value::bigint from ids where name = 'shadchan_b');

insert into results (name, passed)
select 'AC 10(e): deleting a shadchan leaves zero interactions pointing at it',
       count(*) = 0
from public.interactions
where target_type = 'shadchan' and target_id = (select value::bigint from ids where name = 'shadchan_b');

insert into results (name, passed)
select 'AC 10(e): deleting a shadchan leaves zero tasks pointing at it',
       count(*) = 0
from public.tasks
where target_type = 'shadchan' and target_id = (select value::bigint from ids where name = 'shadchan_b');

insert into results (name, passed)
select 'AC 10(e): deleting a shadchan leaves zero identity_signals pointing at it (vacuously true — identity_signals_target_type_check does not accept ''shadchan'' at all)',
       count(*) = 0
from public.identity_signals
where target_type = 'shadchan' and target_id = (select value::bigint from ids where name = 'shadchan_b');

-- ---------------------------------------------------------------------------
-- AC 10(f): 3-14's guarantee, asserted at the trigger layer only. Performed
-- as postgres (reset role, above) — deliberately NOT an authenticated
-- insert (Dev Notes, "What 3-14 does and does not unlock").
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 10(f): pg_trigger holds no validate_interactions_household_scope on public.interactions',
       not exists (
         select 1 from pg_trigger
         where tgrelid = 'public.interactions'::regclass
           and tgname = 'validate_interactions_household_scope'
       );

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope)
    values ((select value::bigint from ids where name = 'acct_c'), 'reference', 1, 'account');
  insert into results values (
    'AC 10(f): an interactions insert whose account_id is a shadchanus account succeeds as postgres (RLS not in the picture)',
    true, null
  );
exception when others then
  insert into results values (
    'AC 10(f): an interactions insert whose account_id is a shadchanus account succeeds as postgres (RLS not in the picture)',
    false, sqlerrm
  );
end $$;

-- Sanity — re-adding the dropped trigger turns AC 10(f) red, live in every
-- run of this file (not just proven once by hand). Undone by the trailing
-- rollback regardless of the explicit drop below.
create trigger validate_interactions_household_scope
    before insert or update of account_id on public.interactions
    for each row execute function public.enforce_household_scope();

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope)
    values ((select value::bigint from ids where name = 'acct_c'), 'reference', 2, 'account');
  insert into results values (
    'AC 10(f) sanity — re-adding validate_interactions_household_scope turns this check red (proves the check above is not vacuous)',
    false, 'insert unexpectedly succeeded with the trigger reinstated'
  );
exception when others then
  insert into results values (
    'AC 10(f) sanity — re-adding validate_interactions_household_scope turns this check red (proves the check above is not vacuous)',
    true, sqlerrm
  );
end $$;

drop trigger validate_interactions_household_scope on public.interactions;

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
