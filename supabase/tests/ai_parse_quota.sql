--
-- Epic 11 Findings 6/7/8/9/10/11/12 closure — database test suite.
--
-- Covers claim_ai_parse_attempt() / confirm_ai_parse_attempt() /
-- release_ai_parse_attempt() / force_reclaim_ai_parse_attempt() /
-- sweep_expired_ai_parse_attempts() and the ai_parse_attempts table they
-- own. The invariants exercised here only exist inside Postgres and cannot
-- be checked through a mock:
--   * a fresh claim reserves a unit atomically (idempotency + quota in one
--     operation),
--   * a second claim for the SAME key while the first is in progress is
--     refused, not double-spent,
--   * a completed attempt replays its cached result without spending again,
--   * release gives the reservation back (and is idempotent),
--   * an abandoned ('in_progress' past 5 minutes) attempt is lazily reclaimed
--     without a second increment,
--   * the monthly cap refuses cleanly at the boundary and leaves no orphan
--     row,
--   * an unentitled account (no subscription row, or a lapsed one) is refused
--     — fail-closed, not merely relying on the Worker's own advisory
--     pre-check (Finding 6: that pre-check no longer exists at all — this
--     RPC is the SOLE cap gate, and a replay or a stale reclaim succeeds at
--     ANY usage level, including exactly at the cap),
--   * NO client-callable path exists at all: `authenticated` can neither call
--     any of the five RPCs nor touch the table directly (RLS enabled, zero
--     policies, and the grants revoke everything from anon/authenticated),
--   * cross-account isolation: confirm/release/force-reclaim raise or refuse
--     rather than silently affecting another tenant's row.
--   * fencing token (review Finding C2): a fresh claim starts at generation
--     1; a stale reclaim OR a reclaim-from-'failed' bumps it; confirm/release
--     presenting a SUPERSEDED (pre-reclaim) generation is a benign no-op —
--     never an exception, never a status/ai_usage mutation — while the
--     CURRENT generation's confirm/release still applies normally.
--   * result_schema_version gating (Finding 12): a replay behind the
--     caller's current contract version is served as a free re-claim, never
--     a stale-shaped replay; a matching (or ahead) version is served as an
--     ordinary replay carrying its version back to the caller.
--   * superseded-with-result (Finding 8): a confirm whose winning generation
--     already completed hands back THAT generation's own result/version
--     instead of a bare 'superseded' marker; a confirm whose winner is still
--     working returns status only, with no 'result' key at all.
--   * force_reclaim_ai_parse_attempt() (Finding 12's corruption escape
--     hatch): reclaims a 'completed' row for its OWN account only, never
--     touches ai_usage, and refuses (never raises) once the row has moved
--     past 'completed' or belongs to a different account.
--   * the opportunistic reaper (Finding 10): every claim call sweeps and
--     refunds ITS OWN account's other rows stuck 'in_progress' past 15
--     minutes (3x the ordinary staleness window) — never a merely
--     6-minute-stale row, never a different account's row, and never the
--     exact key being claimed right now (that one is handled for free by the
--     ordinary stale-reclaim branch) — closing the account-wide lockout a
--     swallowed confirm/release failure could otherwise cause.
--   * the retention sweep (Finding 11): sweep_expired_ai_parse_attempts()
--     deletes any row older than the flat 30-day TTL regardless of status,
--     and leaves a recent row untouched.
--
-- What this file CANNOT prove: two REAL, simultaneously-running sessions
-- racing the same key, or racing the cap boundary — everything below runs on
-- one connection, so Postgres never actually blocks one statement on
-- another's uncommitted row lock. That proof needs two real `psql`
-- connections and lives in ai_parse_quota.test.ts instead (mirroring
-- message_notifications.test.ts's AC-9 concurrency proof for
-- claim_message_notifications()).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (ai_parse_quota.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange. Five accounts: one plainly entitled (used for most of the
-- sequential lifecycle checks), one with no subscription row at all, one
-- lapsed, one dedicated to the cap-boundary checks (so its usage seed does
-- not interfere with the lifecycle checks above), and one for the
-- authenticated-role permission checks. One inbox_items row per account,
-- matching the shape claim_ai_parse_attempt() is actually called with (a
-- real inbox item id), even though the column carries no FK.
-- ---------------------------------------------------------------------------
insert into public.accounts (name, kind) values ('Parse Quota Entitled', 'household')
returning id as acct_entitled \gset

insert into public.accounts (name, kind) values ('Parse Quota Unentitled', 'household')
returning id as acct_unentitled \gset

insert into public.accounts (name, kind) values ('Parse Quota Lapsed', 'household')
returning id as acct_lapsed \gset

insert into public.accounts (name, kind) values ('Parse Quota Cap Boundary', 'household')
returning id as acct_cap \gset

insert into public.accounts (name, kind) values ('Parse Quota Cross Tenant', 'household')
returning id as acct_other \gset

insert into public.subscription (account_id, plan, status) values (:acct_entitled, 'ai', 'active');
insert into public.subscription (account_id, plan, status) values (:acct_lapsed, 'ai', 'lapsed');
insert into public.subscription (account_id, plan, status) values (:acct_cap, 'ai', 'active');
insert into public.subscription (account_id, plan, status) values (:acct_other, 'ai', 'active');
-- acct_unentitled deliberately gets NO subscription row — the free-forever
-- default.

insert into public.inbox_items (account_id, source) values (:acct_entitled, 'email') returning id as item_entitled \gset
insert into public.inbox_items (account_id, source) values (:acct_unentitled, 'email') returning id as item_unentitled \gset
insert into public.inbox_items (account_id, source) values (:acct_lapsed, 'email') returning id as item_lapsed \gset
insert into public.inbox_items (account_id, source) values (:acct_cap, 'email') returning id as item_cap \gset
insert into public.inbox_items (account_id, source) values (:acct_other, 'email') returning id as item_other \gset

-- psql does NOT perform `:variable` interpolation inside a dollar-quoted
-- string (`do $$ ... $$`) — confirmed empirically, not merely assumed: every
-- `do $$` block below that needs one of this script's `\gset` ids reads it
-- back out of this one-row table (via `select ... into` at the top of the
-- block) instead of embedding `:acct_x` directly in the block's own text.
-- Populated incrementally, immediately after each id becomes known, so every
-- later do-block sees the current value without re-deriving it.
create temp table vars (
    acct_entitled bigint,
    item_entitled bigint,
    attempt1 bigint,
    acct_other bigint,
    attempt_other bigint,
    attempt_other_generation bigint
) on commit drop;
grant all on vars to public;
insert into vars default values;
update vars set acct_entitled = :acct_entitled, item_entitled = :item_entitled;

-- ---------------------------------------------------------------------------
-- Lifecycle: fresh claim -> conflict on the same in-progress key -> confirm
-- -> replay -> release -> re-reserve -> stale reclaim.
-- ---------------------------------------------------------------------------

select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/resume.pdf', 1::smallint) as claim1 \gset

insert into results (name, passed, detail)
select 'claim: a fresh claim on an entitled account returns claimed',
       (:'claim1'::jsonb ->> 'outcome') = 'claimed',
       :'claim1';

insert into results (name, passed, detail)
select 'claim: a fresh claim reserves exactly one unit in ai_usage',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after first claim';

select (:'claim1'::jsonb ->> 'attempt_id')::bigint as attempt1 \gset
select (:'claim1'::jsonb ->> 'generation')::bigint as attempt1_generation \gset
update vars set attempt1 = :attempt1;

insert into results (name, passed, detail)
select 'claim: the claimed row is in_progress',
       (select status from public.ai_parse_attempts where id = :attempt1) = 'in_progress',
       'status after claim';

insert into results (name, passed, detail)
select 'generation: a fresh claim starts at generation 1',
       :attempt1_generation = 1,
       :'claim1';

select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/resume.pdf', 1::smallint) as claim2 \gset

insert into results (name, passed, detail)
select 'claim: a second claim for the same in-progress key returns conflict',
       (:'claim2'::jsonb ->> 'outcome') = 'conflict'
       and (:'claim2'::jsonb ->> 'attempt_id')::bigint = :attempt1,
       :'claim2';

insert into results (name, passed, detail)
select 'claim: a conflicting second claim does not double-spend the meter',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after conflicting second claim';

select public.confirm_ai_parse_attempt(:acct_entitled, :attempt1, :attempt1_generation, '{"fields": {"age": 24}}'::jsonb, 1::smallint) as confirm1 \gset

insert into results (name, passed, detail)
select 'confirm: confirming with the current generation applies and completes the attempt',
       (:'confirm1'::jsonb ->> 'outcome') = 'applied',
       :'confirm1';

insert into results (name, passed, detail)
select 'confirm: the attempt is completed with the cached result stored',
       (select status = 'completed' and result = '{"fields": {"age": 24}}'::jsonb
          from public.ai_parse_attempts where id = :attempt1),
       'status/result after confirm';

select public.confirm_ai_parse_attempt(:acct_entitled, :attempt1, :attempt1_generation, '{"fields": {"age": 99}}'::jsonb, 1::smallint) as confirm1_again \gset

insert into results (name, passed, detail)
select 'confirm: confirming an already-completed attempt from the SAME generation is idempotent ("applied", keeps the original result)',
       (:'confirm1_again'::jsonb ->> 'outcome') = 'applied'
       and (select result = '{"fields": {"age": 24}}'::jsonb
              from public.ai_parse_attempts where id = :attempt1),
       :'confirm1_again';

select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/resume.pdf', 1::smallint) as claim3 \gset

insert into results (name, passed, detail)
select 'claim: a repeat claim for a completed key replays the cached result',
       (:'claim3'::jsonb ->> 'outcome') = 'replay'
       and (:'claim3'::jsonb -> 'result') = '{"fields": {"age": 24}}'::jsonb,
       :'claim3';

insert into results (name, passed, detail)
select 'claim: a replay does not spend a second unit',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after replay';

-- A second, independent attachment on the same account/item: claim, then
-- release before it ever completes (the "extractor failed" shape).
select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/second.pdf', 1::smallint) as claim_attempt2 \gset
select (:'claim_attempt2'::jsonb ->> 'attempt_id')::bigint as attempt2 \gset
select (:'claim_attempt2'::jsonb ->> 'generation')::bigint as attempt2_generation \gset

insert into results (name, passed, detail)
select 'claim: a second, independent key reserves a second unit',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 2,
       'resumes_parsed after second independent claim';

select public.release_ai_parse_attempt(:acct_entitled, :attempt2, :attempt2_generation) as release2 \gset

insert into results (name, passed, detail)
select 'release: releasing with the current generation applies',
       (:'release2'::jsonb ->> 'outcome') = 'applied',
       :'release2';

insert into results (name, passed, detail)
select 'release: releasing an in-progress attempt gives back its reservation',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after release';

insert into results (name, passed, detail)
select 'release: the released attempt is marked failed with no cached result',
       (select status = 'failed' and result is null from public.ai_parse_attempts where id = :attempt2),
       'status/result after release';

select public.release_ai_parse_attempt(:acct_entitled, :attempt2, :attempt2_generation) as release2_again \gset

insert into results (name, passed, detail)
select 'release: releasing an already-failed attempt from the SAME generation is idempotent ("applied", no second decrement)',
       (:'release2_again'::jsonb ->> 'outcome') = 'applied'
       and (select resumes_parsed from public.ai_usage
             where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 1,
       :'release2_again';

select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/second.pdf', 1::smallint) as claim4 \gset
select (:'claim4'::jsonb ->> 'attempt_id')::bigint as attempt2_reclaimed \gset
select (:'claim4'::jsonb ->> 'generation')::bigint as attempt2_reclaimed_generation \gset

insert into results (name, passed, detail)
select 'claim: a fresh claim after a release re-reserves a unit (not a replay)',
       (:'claim4'::jsonb ->> 'outcome') = 'claimed'
       and (select resumes_parsed from public.ai_usage
             where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 2,
       :'claim4';

insert into results (name, passed, detail)
select 'generation: reclaiming a released (''failed'') attempt also bumps the generation',
       :attempt2_reclaimed = :attempt2 and :attempt2_reclaimed_generation = :attempt2_generation + 1,
       :'claim4';

-- Fencing (review Finding C2): a release presenting the PRE-reclaim
-- generation, issued AFTER a reclaim-from-'failed' has already bumped the
-- generation, must be a benign no-op — never a second decrement of the
-- meter the reclaim's own fresh reservation now legitimately holds. This is
-- interleaving (b) from the review: sequential here (single connection);
-- ai_parse_quota.test.ts proves the same property under two REAL
-- concurrent sessions.
select public.release_ai_parse_attempt(:acct_entitled, :attempt2_reclaimed, :attempt2_generation) as release_stale_after_reclaim \gset

insert into results (name, passed, detail)
select 'fencing: a release with the pre-reclaim generation, after a reclaim-from-failed, is a benign no-op ("superseded")',
       (:'release_stale_after_reclaim'::jsonb ->> 'outcome') = 'superseded',
       :'release_stale_after_reclaim';

insert into results (name, passed, detail)
select 'fencing: that superseded release never double-decrements ai_usage (still exactly the reclaimed reservation)',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 2,
       'resumes_parsed after the superseded release';

insert into results (name, passed, detail)
select 'fencing: that superseded release never disturbs the reclaimed row''s own (current-generation) status',
       (select status = 'in_progress' from public.ai_parse_attempts where id = :attempt2_reclaimed),
       'status after the superseded release';

-- Stale reclaim: an abandoned in_progress row (started_at backdated past the
-- 5-minute staleness threshold) is silently resumed by the next claim for the
-- same key, WITHOUT a second increment — the original reservation is still
-- validly held.
select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/stale.pdf', 1::smallint) as claim_stale \gset
select (:'claim_stale'::jsonb ->> 'attempt_id')::bigint as attempt_stale \gset
select (:'claim_stale'::jsonb ->> 'generation')::bigint as attempt_stale_generation \gset

update public.ai_parse_attempts set started_at = now() - interval '10 minutes' where id = :attempt_stale;

insert into results (name, passed, detail)
select 'claim: usage before the stale reclaim reflects exactly the abandoned attempt''s own reservation',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 3,
       'resumes_parsed before stale reclaim';

select public.claim_ai_parse_attempt(:acct_entitled, :item_entitled, 'lifecycle/stale.pdf', 1::smallint) as claim_reclaim \gset
select (:'claim_reclaim'::jsonb ->> 'generation')::bigint as attempt_stale_reclaimed_generation \gset

insert into results (name, passed, detail)
select 'claim: a stale in-progress attempt (past 5 minutes) is reclaimed as claimed',
       (:'claim_reclaim'::jsonb ->> 'outcome') = 'claimed'
       and (:'claim_reclaim'::jsonb ->> 'attempt_id')::bigint = :attempt_stale,
       :'claim_reclaim';

insert into results (name, passed, detail)
select 'claim: reclaiming a stale attempt does NOT reserve a second unit',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_entitled and period = to_char(now(), 'YYYY-MM')) = 3,
       'resumes_parsed after stale reclaim';

insert into results (name, passed, detail)
select 'claim: reclaiming a stale attempt refreshes started_at',
       (select started_at > now() - interval '1 minute' from public.ai_parse_attempts where id = :attempt_stale),
       'started_at after stale reclaim';

insert into results (name, passed, detail)
select 'generation: a stale reclaim bumps the generation',
       :attempt_stale_reclaimed_generation = :attempt_stale_generation + 1,
       :'claim_reclaim';

-- Fencing (review Finding C2), interleaving (a): the ORIGINAL (now
-- superseded) generation's own confirm arrives AFTER the stale reclaim
-- already bumped the generation. It must be a benign no-op — never raise,
-- never overwrite the reclaimed row with a forged/stale result. Sequential
-- here (single connection); ai_parse_quota.test.ts proves the same property
-- under two REAL concurrent sessions racing the reclaim itself.
select public.confirm_ai_parse_attempt(:acct_entitled, :attempt_stale, :attempt_stale_generation, '{"forged": "by the superseded generation"}'::jsonb, 1::smallint) as confirm_stale_after_reclaim \gset

insert into results (name, passed, detail)
select 'fencing: a confirm with the pre-reclaim generation, after a stale reclaim, is a benign no-op ("superseded")',
       (:'confirm_stale_after_reclaim'::jsonb ->> 'outcome') = 'superseded',
       :'confirm_stale_after_reclaim';

insert into results (name, passed, detail)
select 'fencing: that superseded confirm never overwrites the reclaimed row (still in_progress, no result)',
       (select status = 'in_progress' and result is null
          from public.ai_parse_attempts where id = :attempt_stale),
       'status/result after the superseded confirm';

-- Now the CURRENT (reclaiming) generation confirms for real — must apply
-- normally, proving the fencing check does not also block the legitimate
-- holder.
select public.confirm_ai_parse_attempt(:acct_entitled, :attempt_stale, :attempt_stale_reclaimed_generation, '{"fields": {"reclaimed": true}}'::jsonb, 1::smallint) as confirm_reclaimed \gset

insert into results (name, passed, detail)
select 'fencing: the reclaiming generation''s own confirm applies normally',
       (:'confirm_reclaimed'::jsonb ->> 'outcome') = 'applied'
       and (select status = 'completed' and result = '{"fields": {"reclaimed": true}}'::jsonb
              from public.ai_parse_attempts where id = :attempt_stale),
       :'confirm_reclaimed';

-- And a LATE confirm from the superseded generation, arriving AFTER the
-- reclaiming generation has already completed the row, is STILL a benign
-- no-op, never an exception, and never overwrites the real result —
-- interleaving (a) exactly as the review describes it ("B confirms first;
-- A's [call] ... must be a no-op").
select public.confirm_ai_parse_attempt(:acct_entitled, :attempt_stale, :attempt_stale_generation, '{"forged": "arrives after completion"}'::jsonb, 1::smallint) as confirm_stale_after_completion \gset

insert into results (name, passed, detail)
select 'fencing: a superseded confirm arriving AFTER the reclaiming generation already completed the row is still a benign no-op',
       (:'confirm_stale_after_completion'::jsonb ->> 'outcome') = 'superseded'
       and (select result = '{"fields": {"reclaimed": true}}'::jsonb
              from public.ai_parse_attempts where id = :attempt_stale),
       :'confirm_stale_after_completion';

-- ---------------------------------------------------------------------------
-- Fail-closed entitlement: an unentitled account (no subscription row, or a
-- lapsed one) is refused at the RPC itself, not merely by the Worker's
-- advisory pre-check upstream.
-- ---------------------------------------------------------------------------

select public.claim_ai_parse_attempt(:acct_unentitled, :item_unentitled, 'unentitled/resume.pdf', 1::smallint) as claim_unentitled \gset

insert into results (name, passed, detail)
select 'claim: an account with no subscription row is refused with cap_reached (fail-closed)',
       (:'claim_unentitled'::jsonb ->> 'outcome') = 'cap_reached',
       :'claim_unentitled';

insert into results (name, passed, detail)
select 'claim: a refused unentitled claim leaves no ai_parse_attempts row behind',
       not exists (select 1 from public.ai_parse_attempts where account_id = :acct_unentitled),
       'orphan-row check for the unentitled account';

insert into results (name, passed, detail)
select 'claim: a refused unentitled claim never touches ai_usage',
       not exists (select 1 from public.ai_usage where account_id = :acct_unentitled),
       'ai_usage row check for the unentitled account';

select public.claim_ai_parse_attempt(:acct_lapsed, :item_lapsed, 'lapsed/resume.pdf', 1::smallint) as claim_lapsed \gset

insert into results (name, passed, detail)
select 'claim: a lapsed (was-paid) subscription is refused with cap_reached (fail-closed)',
       (:'claim_lapsed'::jsonb ->> 'outcome') = 'cap_reached',
       :'claim_lapsed';

-- ---------------------------------------------------------------------------
-- Result-schema-version gating (Epic 11 Finding 12 closure): a 'completed'
-- row whose result_schema_version is BEHIND the caller's own current value
-- is not served as a replay — it is flipped back to a free re-claim instead
-- (no new ai_usage spend), exactly like reclaiming an abandoned in_progress
-- row. A row at or AHEAD of the caller's version is served as an ordinary
-- replay, now also carrying result_schema_version back to the caller. Its
-- own dedicated account, like acct_cap below, so its ai_usage counts do not
-- interleave with the acct_entitled lifecycle sequence above.
-- ---------------------------------------------------------------------------

insert into public.accounts (name, kind) values ('Parse Quota Version Gate', 'household')
returning id as acct_version \gset
insert into public.subscription (account_id, plan, status) values (:acct_version, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_version, 'email') returning id as item_version \gset

select public.claim_ai_parse_attempt(:acct_version, :item_version, 'version/resume.pdf', 1::smallint) as claim_v1 \gset
select (:'claim_v1'::jsonb ->> 'attempt_id')::bigint as attempt_v \gset

select public.confirm_ai_parse_attempt(:acct_version, :attempt_v, 1, '{"fields": {"v": 1}}'::jsonb, 1::smallint) as confirm_v1 \gset

insert into results (name, passed, detail)
select 'version: confirming at result_schema_version 1 applies',
       (:'confirm_v1'::jsonb ->> 'outcome') = 'applied',
       :'confirm_v1';

-- The caller's own CURRENT_PARSE_RESULT_SCHEMA_VERSION has moved to 2 —
-- this cached row is now behind the contract. It must be served as a FREE
-- re-claim ('claimed', new generation), never as a 'replay' of stale-shape
-- data, and must NOT spend a second ai_usage unit.
select public.claim_ai_parse_attempt(:acct_version, :item_version, 'version/resume.pdf', 2::smallint) as claim_v_behind \gset

insert into results (name, passed, detail)
select 'version: a replay behind the caller''s current result_schema_version is served as a free re-claim, never a replay',
       (:'claim_v_behind'::jsonb ->> 'outcome') = 'claimed'
       and (:'claim_v_behind'::jsonb ->> 'attempt_id')::bigint = :attempt_v,
       :'claim_v_behind';

insert into results (name, passed, detail)
select 'version: a version-behind free re-claim does not spend a second ai_usage unit',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_version and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after version-behind re-claim';

select (:'claim_v_behind'::jsonb ->> 'generation')::bigint as attempt_v_generation2 \gset

insert into results (name, passed, detail)
select 'version: a version-behind free re-claim bumps the generation',
       :attempt_v_generation2 = 2,
       :'claim_v_behind';

-- Confirm the re-claimed generation at the NEW version (2) — the row is now
-- current, so a claim presenting version 2 must replay it, carrying the
-- version back to the caller.
select public.confirm_ai_parse_attempt(:acct_version, :attempt_v, :attempt_v_generation2, '{"fields": {"v": 2}}'::jsonb, 2::smallint) as confirm_v2 \gset

insert into results (name, passed, detail)
select 'version: confirming at result_schema_version 2 applies',
       (:'confirm_v2'::jsonb ->> 'outcome') = 'applied',
       :'confirm_v2';

select public.claim_ai_parse_attempt(:acct_version, :item_version, 'version/resume.pdf', 2::smallint) as claim_v_match \gset

insert into results (name, passed, detail)
select 'version: a replay AT the caller''s current result_schema_version is served as an ordinary replay',
       (:'claim_v_match'::jsonb ->> 'outcome') = 'replay'
       and (:'claim_v_match'::jsonb -> 'result') = '{"fields": {"v": 2}}'::jsonb
       and (:'claim_v_match'::jsonb ->> 'result_schema_version')::int = 2,
       :'claim_v_match';

insert into results (name, passed, detail)
select 'version: a matching-version replay still does not spend a second ai_usage unit',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_version and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after matching-version replay';

-- ---------------------------------------------------------------------------
-- Cap boundary: at 99/100, one claim succeeds and reaches exactly 100; the
-- next claim (a different key, same account/period) is refused, and leaves
-- no orphan row.
-- ---------------------------------------------------------------------------

insert into public.ai_usage (account_id, period, resumes_parsed)
values (:acct_cap, to_char(now(), 'YYYY-MM'), 99);

select public.claim_ai_parse_attempt(:acct_cap, :item_cap, 'boundary/first.pdf', 1::smallint) as claim_boundary1 \gset

insert into results (name, passed, detail)
select 'claim: a claim at 99/100 succeeds',
       (:'claim_boundary1'::jsonb ->> 'outcome') = 'claimed',
       :'claim_boundary1';

insert into results (name, passed, detail)
select 'claim: the boundary claim reaches exactly the limit (100)',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_cap and period = to_char(now(), 'YYYY-MM')) = 100,
       'resumes_parsed after the 100th claim';

select public.claim_ai_parse_attempt(:acct_cap, :item_cap, 'boundary/second.pdf', 1::smallint) as claim_boundary2 \gset

insert into results (name, passed, detail)
select 'claim: a further claim once at 100/100 is refused with cap_reached',
       (:'claim_boundary2'::jsonb ->> 'outcome') = 'cap_reached',
       :'claim_boundary2';

insert into results (name, passed, detail)
select 'claim: the refused over-cap claim leaves no orphan ai_parse_attempts row',
       not exists (
         select 1 from public.ai_parse_attempts
         where account_id = :acct_cap and attachment_path = 'boundary/second.pdf'
       ),
       'orphan-row check for the refused boundary claim';

insert into results (name, passed, detail)
select 'claim: usage stays exactly at the limit after the refusal (never exceeds it)',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_cap and period = to_char(now(), 'YYYY-MM')) = 100,
       'resumes_parsed after the refused claim';

-- ---------------------------------------------------------------------------
-- Epic 11 Finding 6 closure: the Worker-side advisory cap pre-check was
-- DELETED — claim_ai_parse_attempt() is now the SOLE cap gate, and its
-- 'replay' and stale-in_progress-reclaim branches both return BEFORE
-- v_limit is ever consulted. Prove both succeed even while :acct_cap sits
-- at exactly 100/100 from the boundary checks above — these are the two
-- free paths a pre-check ahead of this RPC would otherwise have blocked.
-- ---------------------------------------------------------------------------

select (:'claim_boundary1'::jsonb ->> 'attempt_id')::bigint as attempt_boundary1 \gset

select public.confirm_ai_parse_attempt(:acct_cap, :attempt_boundary1, 1, '{"fields": {"boundary": true}}'::jsonb, 1::smallint) as confirm_boundary1 \gset

insert into results (name, passed, detail)
select 'cap-exempt: confirming the boundary claim applies (still at 100/100 usage)',
       (:'confirm_boundary1'::jsonb ->> 'outcome') = 'applied'
       and (select resumes_parsed from public.ai_usage
             where account_id = :acct_cap and period = to_char(now(), 'YYYY-MM')) = 100,
       :'confirm_boundary1';

select public.claim_ai_parse_attempt(:acct_cap, :item_cap, 'boundary/first.pdf', 1::smallint) as claim_boundary1_replay \gset

insert into results (name, passed, detail)
select 'cap-exempt: a replay is served even when the account is already at 100/100 usage',
       (:'claim_boundary1_replay'::jsonb ->> 'outcome') = 'replay'
       and (select resumes_parsed from public.ai_usage
             where account_id = :acct_cap and period = to_char(now(), 'YYYY-MM')) = 100,
       :'claim_boundary1_replay';

-- Simulate a reservation that went stale WHILE the account was already at
-- (or below) the cap: inserted directly (not via claim_ai_parse_attempt(),
-- which would itself refuse a fresh reservation at 100/100) — its unit is
-- already counted inside the 100 above, exactly as a genuine claim made
-- before the cap was reached would be.
insert into public.ai_parse_attempts (account_id, inbox_item_id, attachment_path, period, status, started_at)
values (:acct_cap, :item_cap, 'boundary/stale-at-cap.pdf', to_char(now(), 'YYYY-MM'), 'in_progress', now() - interval '10 minutes');

select public.claim_ai_parse_attempt(:acct_cap, :item_cap, 'boundary/stale-at-cap.pdf', 1::smallint) as claim_stale_at_cap \gset

insert into results (name, passed, detail)
select 'cap-exempt: a stale in_progress reclaim succeeds even when the account is already at 100/100 usage',
       (:'claim_stale_at_cap'::jsonb ->> 'outcome') = 'claimed'
       and (select resumes_parsed from public.ai_usage
             where account_id = :acct_cap and period = to_char(now(), 'YYYY-MM')) = 100,
       :'claim_stale_at_cap';

-- ---------------------------------------------------------------------------
-- Cross-account isolation: confirm/release with a mismatched account_id
-- raise rather than silently affecting another tenant's row.
-- ---------------------------------------------------------------------------

select public.claim_ai_parse_attempt(:acct_other, :item_other, 'isolation/resume.pdf', 1::smallint) as claim_other \gset
select (:'claim_other'::jsonb ->> 'attempt_id')::bigint as attempt_other \gset
select (:'claim_other'::jsonb ->> 'generation')::bigint as attempt_other_generation \gset
update vars set acct_other = :acct_other, attempt_other = :attempt_other, attempt_other_generation = :attempt_other_generation;

do $$
declare
  v_acct_entitled bigint;
  v_attempt_other bigint;
  v_attempt_other_generation bigint;
begin
  select acct_entitled, attempt_other, attempt_other_generation
    into v_acct_entitled, v_attempt_other, v_attempt_other_generation from vars;
  begin
    perform public.confirm_ai_parse_attempt(v_acct_entitled, v_attempt_other, v_attempt_other_generation, '{"forged": true}'::jsonb, 1::smallint);
    insert into results (name, passed, detail) values
      ('isolation: confirm with a mismatched account_id is refused', false, 'confirm unexpectedly succeeded');
  exception when others then
    insert into results (name, passed, detail) values
      ('isolation: confirm with a mismatched account_id is refused', true, sqlerrm);
  end;
end $$;

insert into results (name, passed, detail)
select 'isolation: the cross-account confirm attempt did not alter the real owner''s row',
       (select status = 'in_progress' and result is null from public.ai_parse_attempts where id = :attempt_other),
       'attempt_other status/result after the forged confirm attempt';

do $$
declare
  v_acct_entitled bigint;
  v_attempt_other bigint;
  v_attempt_other_generation bigint;
begin
  select acct_entitled, attempt_other, attempt_other_generation
    into v_acct_entitled, v_attempt_other, v_attempt_other_generation from vars;
  begin
    perform public.release_ai_parse_attempt(v_acct_entitled, v_attempt_other, v_attempt_other_generation);
    insert into results (name, passed, detail) values
      ('isolation: release with a mismatched account_id is refused', false, 'release unexpectedly succeeded');
  exception when others then
    insert into results (name, passed, detail) values
      ('isolation: release with a mismatched account_id is refused', true, sqlerrm);
  end;
end $$;

insert into results (name, passed, detail)
select 'isolation: the cross-account release attempt did not touch the real owner''s usage meter',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_other and period = to_char(now(), 'YYYY-MM')) = 1,
       'acct_other resumes_parsed after the forged release attempt';

-- ---------------------------------------------------------------------------
-- Superseded confirm returns the WINNING generation's own state (Epic 11
-- Finding 8 closure), not a bare 'superseded' marker. The "winner already
-- completed" case is already exercised sequentially by the fencing checks
-- above (confirm_stale_after_completion) — extended here to assert the
-- RETURNED jsonb itself (not just the row) carries the winner's result and
-- result_schema_version. The "winner still in_progress" case gets its own
-- dedicated account/sequence: nothing final exists yet, so only `status`
-- comes back, with no 'result' key at all.
-- ---------------------------------------------------------------------------

insert into results (name, passed, detail)
select 'superseded: a confirm whose winner already completed returns the winner''s own result and result_schema_version',
       (:'confirm_stale_after_completion'::jsonb -> 'result') = '{"fields": {"reclaimed": true}}'::jsonb
       and (:'confirm_stale_after_completion'::jsonb ->> 'result_schema_version')::int = 1,
       :'confirm_stale_after_completion';

insert into public.accounts (name, kind) values ('Parse Quota Superseded In-Progress', 'household')
returning id as acct_superseded \gset
insert into public.subscription (account_id, plan, status) values (:acct_superseded, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_superseded, 'email') returning id as item_superseded \gset

select public.claim_ai_parse_attempt(:acct_superseded, :item_superseded, 'superseded/resume.pdf', 1::smallint) as claim_sup1 \gset
select (:'claim_sup1'::jsonb ->> 'attempt_id')::bigint as attempt_sup \gset

update public.ai_parse_attempts set started_at = now() - interval '10 minutes' where id = :attempt_sup;

-- The reclaim: a fresh claim for the SAME key takes the stale-reclaim
-- branch (generation 1 -> 2) but does NOT complete the row — it is still
-- 'in_progress' under the new generation.
select public.claim_ai_parse_attempt(:acct_superseded, :item_superseded, 'superseded/resume.pdf', 1::smallint) as claim_sup2 \gset

insert into results (name, passed, detail)
select 'superseded (setup): the reclaim leaves the row in_progress under a new generation',
       (:'claim_sup2'::jsonb ->> 'outcome') = 'claimed'
       and (select status = 'in_progress' from public.ai_parse_attempts where id = :attempt_sup),
       :'claim_sup2';

-- The PRE-reclaim generation's own confirm arrives now, carrying the OLD
-- generation (1) — the winner (generation 2) has not completed anything
-- yet, so there is nothing final to hand back.
select public.confirm_ai_parse_attempt(:acct_superseded, :attempt_sup, 1, '{"forged": "by the superseded generation"}'::jsonb, 1::smallint) as confirm_sup_inprogress \gset

insert into results (name, passed, detail)
select 'superseded: a confirm whose winner is still in_progress returns status only, no result key',
       (:'confirm_sup_inprogress'::jsonb ->> 'outcome') = 'superseded'
       and (:'confirm_sup_inprogress'::jsonb ->> 'status') = 'in_progress'
       and not (:'confirm_sup_inprogress'::jsonb ? 'result'),
       :'confirm_sup_inprogress';

-- ---------------------------------------------------------------------------
-- force_reclaim_ai_parse_attempt() (Epic 11 Finding 12 closure): the escape
-- hatch for a replay that matches the CURRENT result_schema_version but
-- still fails the Worker's own Zod validation — genuine corruption, not the
-- version drift claim_ai_parse_attempt() already catches for free. Does NOT
-- touch ai_usage (the platform's own bug, not the account's cost to bear),
-- and only ever reclaims a 'completed' row for its OWN account.
-- ---------------------------------------------------------------------------

insert into public.accounts (name, kind) values ('Parse Quota Force Reclaim', 'household')
returning id as acct_force_reclaim \gset
insert into public.subscription (account_id, plan, status) values (:acct_force_reclaim, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_force_reclaim, 'email') returning id as item_force_reclaim \gset

select public.claim_ai_parse_attempt(:acct_force_reclaim, :item_force_reclaim, 'force-reclaim/resume.pdf', 1::smallint) as claim_fr \gset
select (:'claim_fr'::jsonb ->> 'attempt_id')::bigint as attempt_fr \gset

select public.confirm_ai_parse_attempt(:acct_force_reclaim, :attempt_fr, 1, '{"fields": {"x": 1}}'::jsonb, 1::smallint) as confirm_fr \gset

select public.force_reclaim_ai_parse_attempt(:acct_force_reclaim, :attempt_fr) as force1 \gset

insert into results (name, passed, detail)
select 'force-reclaim: reclaiming a completed row flips it back to in_progress with a bumped generation',
       (:'force1'::jsonb ->> 'outcome') = 'reclaimed'
       and (:'force1'::jsonb ->> 'generation')::bigint = 2
       and (select status = 'in_progress' and result is null and generation = 2
              from public.ai_parse_attempts where id = :attempt_fr),
       :'force1';

insert into results (name, passed, detail)
select 'force-reclaim: reclaiming a completed row does not touch ai_usage',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_force_reclaim and period = to_char(now(), 'YYYY-MM')) = 1,
       'resumes_parsed after force-reclaim';

select public.force_reclaim_ai_parse_attempt(:acct_force_reclaim, :attempt_fr) as force2 \gset

insert into results (name, passed, detail)
select 'force-reclaim: a row that already moved past ''completed'' (raced) returns not_reclaimable',
       (:'force2'::jsonb ->> 'outcome') = 'not_reclaimable',
       :'force2';

select public.force_reclaim_ai_parse_attempt(:acct_entitled, :attempt_fr) as force_wrong_account \gset

insert into results (name, passed, detail)
select 'force-reclaim: a mismatched account_id is refused (not_reclaimable), never reclaims another tenant''s row',
       (:'force_wrong_account'::jsonb ->> 'outcome') = 'not_reclaimable'
       and (select generation = 2 from public.ai_parse_attempts where id = :attempt_fr),
       :'force_wrong_account';

-- ---------------------------------------------------------------------------
-- Opportunistic reaper (Epic 11 Finding 10 closure): every claim call
-- sweeps and refunds THIS SAME ACCOUNT's own other rows that have sat
-- 'in_progress' past c_reap_after (15 minutes) — before doing its own main
-- job. Proves: a genuinely stuck row (>15 min) is refunded and marked
-- failed; a merely-stale row (6 min — inside the ordinary 5-minute
-- self-heal window but short of the 15-minute reap threshold) is left
-- untouched; a DIFFERENT account's stuck row is never touched; and the
-- headline claim — an account phantom-stuck at its cap self-heals on its
-- own very next claim, instead of being locked out for the rest of the
-- billing period.
-- ---------------------------------------------------------------------------

insert into public.accounts (name, kind) values ('Parse Quota Reaper', 'household')
returning id as acct_reaper \gset
insert into public.subscription (account_id, plan, status) values (:acct_reaper, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_reaper, 'email') returning id as item_reaper \gset

insert into public.accounts (name, kind) values ('Parse Quota Reaper Other Account', 'household')
returning id as acct_reaper_other \gset
insert into public.subscription (account_id, plan, status) values (:acct_reaper_other, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_reaper_other, 'email') returning id as item_reaper_other \gset

-- Both claims for acct_reaper happen FIRST, while both rows are still
-- fresh — every claim_ai_parse_attempt() call runs its OWN account's reaper
-- sweep before doing its main job, so backdating stuck-old.pdf before
-- making the stuck-6min.pdf claim would let THAT claim's own sweep reap it
-- early, corrupting this fixture's "two stuck reservations" precondition.
-- Backdating both only after both reservations exist avoids that.
select public.claim_ai_parse_attempt(:acct_reaper, :item_reaper, 'reaper/stuck-old.pdf', 1::smallint) as claim_reaper_old \gset
select public.claim_ai_parse_attempt(:acct_reaper, :item_reaper, 'reaper/stuck-6min.pdf', 1::smallint) as claim_reaper_6min \gset

update public.ai_parse_attempts set started_at = now() - interval '20 minutes'
 where id = (:'claim_reaper_old'::jsonb ->> 'attempt_id')::bigint;
update public.ai_parse_attempts set started_at = now() - interval '6 minutes'
 where id = (:'claim_reaper_6min'::jsonb ->> 'attempt_id')::bigint;

select public.claim_ai_parse_attempt(:acct_reaper_other, :item_reaper_other, 'reaper/other-stuck.pdf', 1::smallint) as claim_reaper_other \gset
update public.ai_parse_attempts set started_at = now() - interval '20 minutes'
 where id = (:'claim_reaper_other'::jsonb ->> 'attempt_id')::bigint;

insert into results (name, passed, detail)
select 'reaper (setup): two stuck reservations for acct_reaper reserve two units',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_reaper and period = to_char(now(), 'YYYY-MM')) = 2,
       'resumes_parsed before the reaper sweep';

-- The sweep-triggering call: a claim for a THIRD, brand-new key on
-- acct_reaper. Its own reaper sweep runs first, before this key's own
-- reservation.
select public.claim_ai_parse_attempt(:acct_reaper, :item_reaper, 'reaper/new-key.pdf', 1::smallint) as claim_reaper_new \gset

insert into results (name, passed, detail)
select 'reaper: the sweep-triggering claim for a new key still succeeds',
       (:'claim_reaper_new'::jsonb ->> 'outcome') = 'claimed',
       :'claim_reaper_new';

insert into results (name, passed, detail)
select 'reaper: a >15-minute-stale row is refunded and marked failed',
       (select status = 'failed' and result is null and generation = 2
          from public.ai_parse_attempts
         where account_id = :acct_reaper and attachment_path = 'reaper/stuck-old.pdf'),
       'reaper/stuck-old.pdf after the sweep';

insert into results (name, passed, detail)
select 'reaper: a 6-minute-stale row (inside the ordinary self-heal window) is left untouched',
       (select status = 'in_progress' and generation = 1
          from public.ai_parse_attempts
         where account_id = :acct_reaper and attachment_path = 'reaper/stuck-6min.pdf'),
       'reaper/stuck-6min.pdf after the sweep';

insert into results (name, passed, detail)
select 'reaper: the key being claimed right now is excluded from the sweep, not refunded twice',
       (select status = 'in_progress' and generation = 1
          from public.ai_parse_attempts
         where account_id = :acct_reaper and attachment_path = 'reaper/new-key.pdf'),
       'reaper/new-key.pdf after its own claim';

insert into results (name, passed, detail)
select 'reaper: a DIFFERENT account''s stuck row is never touched',
       (select status = 'in_progress' and generation = 1
          from public.ai_parse_attempts
         where account_id = :acct_reaper_other and attachment_path = 'reaper/other-stuck.pdf'),
       'reaper/other-stuck.pdf after acct_reaper''s own sweep';

insert into results (name, passed, detail)
select 'reaper: a different account''s ai_usage is never touched by another account''s sweep',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_reaper_other and period = to_char(now(), 'YYYY-MM')) = 1,
       'acct_reaper_other resumes_parsed after acct_reaper''s own sweep';

-- The headline scenario (Finding 10's own worked example): an account
-- phantom-stuck at exactly its cap, due to a reservation that was never
-- released, is unblocked on its own very next claim — for a COMPLETELY
-- DIFFERENT attachment — instead of being locked out for the rest of the
-- billing period.
insert into public.accounts (name, kind) values ('Parse Quota Reaper Lockout', 'household')
returning id as acct_reaper_lockout \gset
insert into public.subscription (account_id, plan, status) values (:acct_reaper_lockout, 'ai', 'active');
insert into public.inbox_items (account_id, source) values (:acct_reaper_lockout, 'email') returning id as item_reaper_lockout \gset

insert into public.ai_usage (account_id, period, resumes_parsed)
values (:acct_reaper_lockout, to_char(now(), 'YYYY-MM'), 99);

select public.claim_ai_parse_attempt(:acct_reaper_lockout, :item_reaper_lockout, 'lockout/stuck.pdf', 1::smallint) as claim_lockout_stuck \gset
update public.ai_parse_attempts set started_at = now() - interval '20 minutes'
 where id = (:'claim_lockout_stuck'::jsonb ->> 'attempt_id')::bigint;

insert into results (name, passed, detail)
select 'reaper (setup): the lockout account is now phantom-stuck at exactly its cap',
       (select resumes_parsed from public.ai_usage
         where account_id = :acct_reaper_lockout and period = to_char(now(), 'YYYY-MM')) = 100,
       'resumes_parsed before the lockout self-heal';

select public.claim_ai_parse_attempt(:acct_reaper_lockout, :item_reaper_lockout, 'lockout/new.pdf', 1::smallint) as claim_lockout_new \gset

insert into results (name, passed, detail)
select 'reaper: an account phantom-stuck at its cap self-heals on its own next claim for a DIFFERENT attachment (Finding 10 closure)',
       (:'claim_lockout_new'::jsonb ->> 'outcome') = 'claimed',
       :'claim_lockout_new';

-- ---------------------------------------------------------------------------
-- Retention sweep (Epic 11 Finding 11 closure): sweep_expired_ai_parse_attempts()
-- deletes any row older than the flat 30-day TTL, regardless of status, and
-- leaves a recent row untouched. Returns only the deleted COUNT.
-- ---------------------------------------------------------------------------

insert into public.accounts (name, kind) values ('Parse Quota Retention Sweep', 'household')
returning id as acct_retention \gset
insert into public.inbox_items (account_id, source) values (:acct_retention, 'email') returning id as item_retention \gset

insert into public.ai_parse_attempts (account_id, inbox_item_id, attachment_path, period, status, started_at, created_at, result)
values (:acct_retention, :item_retention, 'retention/old.pdf', '2026-01', 'completed', now() - interval '40 days', now() - interval '40 days', '{"fields": {}}'::jsonb);

insert into public.ai_parse_attempts (account_id, inbox_item_id, attachment_path, period, status, started_at, created_at, result)
values (:acct_retention, :item_retention, 'retention/recent.pdf', to_char(now(), 'YYYY-MM'), 'completed', now() - interval '2 days', now() - interval '2 days', '{"fields": {}}'::jsonb);

select public.sweep_expired_ai_parse_attempts() as swept_count \gset

insert into results (name, passed, detail)
select 'retention: the sweep deletes exactly the one row older than the 30-day TTL',
       :swept_count = 1,
       'sweep_expired_ai_parse_attempts() return value';

insert into results (name, passed, detail)
select 'retention: the swept row is actually gone',
       not exists (
         select 1 from public.ai_parse_attempts
         where account_id = :acct_retention and attachment_path = 'retention/old.pdf'
       ),
       'retention/old.pdf after the sweep';

insert into results (name, passed, detail)
select 'retention: a row inside the 30-day TTL survives the sweep',
       exists (
         select 1 from public.ai_parse_attempts
         where account_id = :acct_retention and attachment_path = 'retention/recent.pdf'
       ),
       'retention/recent.pdf after the sweep';

-- ---------------------------------------------------------------------------
-- No client-callable path at all: `authenticated` can neither call the three
-- RPCs nor read/write ai_parse_attempts directly. RLS is enabled with ZERO
-- policies on the table, and the grants revoke everything from anon and
-- authenticated (05_policies.sql / 06_grants.sql) — every access goes
-- through these SECURITY DEFINER, service_role-only functions.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values ('a1a2a3a4-9000-4000-8000-000000009011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'parse-quota-perm@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_entitled, 'a1a2a3a4-9000-4000-8000-000000009011', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a2a3a4-9000-4000-8000-000000009011","role":"authenticated"}';

do $$
declare
  v_acct_entitled bigint;
  v_item_entitled bigint;
begin
  select acct_entitled, item_entitled into v_acct_entitled, v_item_entitled from vars;
  begin
    perform public.claim_ai_parse_attempt(v_acct_entitled, v_item_entitled, 'perm/claim.pdf', 1::smallint);
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call claim_ai_parse_attempt', false, 'call unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call claim_ai_parse_attempt', true, sqlerrm);
  end;
end $$;

do $$
declare
  v_acct_entitled bigint;
  v_attempt1 bigint;
begin
  select acct_entitled, attempt1 into v_acct_entitled, v_attempt1 from vars;
  begin
    perform public.confirm_ai_parse_attempt(v_acct_entitled, v_attempt1, 1, '{}'::jsonb, 1::smallint);
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call confirm_ai_parse_attempt', false, 'call unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call confirm_ai_parse_attempt', true, sqlerrm);
  end;
end $$;

do $$
declare
  v_acct_entitled bigint;
  v_attempt1 bigint;
begin
  select acct_entitled, attempt1 into v_acct_entitled, v_attempt1 from vars;
  begin
    perform public.release_ai_parse_attempt(v_acct_entitled, v_attempt1, 1);
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call release_ai_parse_attempt', false, 'call unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call release_ai_parse_attempt', true, sqlerrm);
  end;
end $$;

do $$
declare
  v_acct_entitled bigint;
  v_attempt1 bigint;
begin
  select acct_entitled, attempt1 into v_acct_entitled, v_attempt1 from vars;
  begin
    perform public.force_reclaim_ai_parse_attempt(v_acct_entitled, v_attempt1);
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call force_reclaim_ai_parse_attempt', false, 'call unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call force_reclaim_ai_parse_attempt', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    perform public.sweep_expired_ai_parse_attempts();
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call sweep_expired_ai_parse_attempts', false, 'call unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot call sweep_expired_ai_parse_attempts', true, sqlerrm);
  end;
end $$;

do $$
declare
  v_acct_entitled bigint;
  v_item_entitled bigint;
begin
  select acct_entitled, item_entitled into v_acct_entitled, v_item_entitled from vars;
  begin
    insert into public.ai_parse_attempts (account_id, inbox_item_id, attachment_path, period)
    values (v_acct_entitled, v_item_entitled, 'perm/direct-insert.pdf', to_char(now(), 'YYYY-MM'));
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot INSERT into ai_parse_attempts directly', false, 'insert unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot INSERT into ai_parse_attempts directly', true, sqlerrm);
  end;
end $$;

-- No SELECT grant at all (06_grants.sql revokes everything from
-- authenticated), so this raises a hard permission error rather than
-- silently returning zero rows — asserted the same way as the write checks
-- above.
do $$
begin
  begin
    perform count(*) from public.ai_parse_attempts;
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot SELECT ai_parse_attempts directly', false, 'select unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into results (name, passed, detail) values
      ('permission: authenticated cannot SELECT ai_parse_attempts directly', true, sqlerrm);
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Single source of truth: ai_entitlement()'s resumes_limit for an entitled
-- account matches ai_monthly_resume_limit() exactly, confirming the shared
-- helper (ai_resume_limit_for_account()) never lets the two drift.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a2a3a4-9000-4000-8000-000000009011","role":"authenticated"}';

insert into results (name, passed, detail)
select 'single source of truth: ai_entitlement() resumes_limit matches ai_monthly_resume_limit()',
       (public.ai_entitlement() ->> 'resumes_limit')::int = public.ai_monthly_resume_limit(),
       'ai_entitlement() vs ai_monthly_resume_limit()';

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
