--
-- Read-only child portal (E7) — database test suite.
--
-- This is a NEW EXTERNAL TRUST BOUNDARY: get_child_portal() is the ONLY
-- anon-reachable path over portal data, and a bug in its scoping leaks a
-- family's private diligence to anyone with a link. The invariants proved here
-- live entirely inside Postgres — the token -> child scoping, the
-- visibility = 'shared' + is_child_visible_state() filter, cross-child and
-- cross-tenant isolation, revocation, the forced-CSPRNG token, and the fact that
-- anon can call the RPC but never read the token table — so they cannot be
-- meaningfully checked through a mock.
--
-- Every check appends one row to `results`; the script emits them as JSON at the
-- end and rolls back, so it leaves nothing behind. The runner
-- (child_portal.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange. Two tenants; a token belongs to ONE child in ONE account, and must
-- never reach across either boundary. handle_new_user bootstraps the first
-- user's membership; we clear and re-point memberships at this suite's accounts.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a1a1a1a1-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal-a@test.local'),
       ('b2b2b2b2-bbbb-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal-b@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('Portal Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('Portal Tenant B') returning id as acct_b \gset

insert into public.account_members (account_id, user_id, role)
values (:acct_a, 'a1a1a1a1-aaaa-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, 'b2b2b2b2-bbbb-2222-2222-222222222222', 'parent_admin');

-- Tenant A has two children. The portal token is for Leah; Rivka's suggestions
-- must never appear in Leah's portal even though they share an account.
insert into public.children (account_id, first_name_en, first_name_he, gender)
values (:acct_a, 'Leah', 'לאה', 'female') returning id as child_leah \gset
insert into public.children (account_id, first_name_en, gender)
values (:acct_a, 'Rivka', 'female') returning id as child_rivka \gset

-- Tenant B child (a whole other family).
insert into public.children (account_id, first_name_en, gender)
values (:acct_b, 'Miriam', 'female') returning id as child_b \gset

-- The three CHILD-VISIBLE states, all shared -> must appear in Leah's portal.
-- yes/unsure are decision states, reachable only from look_into, so they are
-- inserted as look_into and then transitioned (the enforce_pipeline_transition
-- trigger validates the edge on the raw UPDATE).
insert into public.shidduchim (account_id, child_id, name_en, name_he, visibility, pipeline_state, age, parents_en, seminary_en)
values (:acct_a, :child_leah, 'Avi Look', 'אבי', 'shared', 'look_into', 24, 'Secret Parents', 'Secret Seminary')
returning id as shid_look \gset

insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Yossi Yes', 'shared', 'look_into')
returning id as shid_yes \gset
update public.shidduchim set pipeline_state = 'yes' where id = :shid_yes;

insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Dov Unsure', 'shared', 'look_into')
returning id as shid_unsure \gset
update public.shidduchim set pipeline_state = 'unsure' where id = :shid_unsure;

-- The four HIDDEN states, all shared -> must NOT appear.
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Ben New', 'shared', 'new')
returning id as shid_new \gset
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Eli Notsure', 'shared', 'not_sure')
returning id as shid_notsure \gset
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Gad Fsn', 'shared', 'for_sure_not')
returning id as shid_fsn \gset
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Zev No', 'shared', 'look_into')
returning id as shid_no \gset
update public.shidduchim set pipeline_state = 'no' where id = :shid_no;

-- Child-visible STATE but private VISIBILITY -> must NOT appear (only 'shared'
-- is ever child-facing). This is the pair a naive state-only filter would leak.
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Priv Parent', 'private_parent', 'look_into')
returning id as shid_pp \gset
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_leah, 'Priv Child', 'private_child', 'look_into')
returning id as shid_pc \gset

-- Another child in the SAME account, shared + visible -> must NOT appear in
-- Leah's portal (the token is scoped to Leah).
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_a, :child_rivka, 'Rivka Match', 'shared', 'look_into')
returning id as shid_rivka \gset

-- Another ACCOUNT, shared + visible -> must NOT appear (cross-tenant).
insert into public.shidduchim (account_id, child_id, name_en, visibility, pipeline_state)
values (:acct_b, :child_b, 'Tenant B Match', 'shared', 'look_into')
returning id as shid_b \gset

-- Tokens. The trigger overwrites `token` with a CSPRNG value even here, so we
-- read the generated value back rather than choosing it.
insert into public.child_portal_tokens (account_id, child_id)
values (:acct_a, :child_leah) returning token as token_leah \gset
insert into public.child_portal_tokens (account_id, child_id)
values (:acct_b, :child_b) returning token as token_b \gset

-- A revoked token for Leah.
insert into public.child_portal_tokens (account_id, child_id)
values (:acct_a, :child_leah) returning id as revoked_id, token as token_revoked \gset
update public.child_portal_tokens set revoked_at = now() where id = :'revoked_id';

-- A client attempting to CHOOSE a weak token: the trigger must overwrite it.
insert into public.child_portal_tokens (account_id, child_id, token)
values (:acct_a, :child_leah, 'guessme') returning token as token_forced \gset

-- ---------------------------------------------------------------------------
-- Token model: unguessable + server-generated (the trigger, not the client).
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'token: a client-chosen token is overwritten by a CSPRNG value',
       :'token_forced' <> 'guessme' and length(:'token_forced') = 48,
       :'token_forced';

insert into results (name, passed)
select 'token: generated tokens are 48 hex chars (192 bits) and unique',
       :'token_leah' ~ '^[0-9a-f]{48}$' and :'token_leah' <> :'token_b';

-- ---------------------------------------------------------------------------
-- get_child_portal() run AS anon — the real production path (unauthenticated
-- caller, SECURITY DEFINER function). Everything below proves the scoping the
-- function must enforce itself, because it bypasses RLS by design.
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Present: exactly the three shared + child-visible-state suggestions, no more.
insert into results (name, passed, detail)
select 'portal: returns exactly the shared + child-visible suggestions',
       jsonb_array_length(public.get_child_portal(:'token_leah') -> 'suggestions') = 3,
       (public.get_child_portal(:'token_leah') -> 'suggestions')::text;

insert into results (name, passed)
select 'portal: a shared look_into item is shown with its soft label',
       exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' = 'Avi Look' and e ->> 'status_label' = 'Being looked into'
       );

insert into results (name, passed)
select 'portal: a shared yes item reads as a calm "looking promising"',
       exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' = 'Yossi Yes' and e ->> 'status_label' = 'Looking promising'
       );

insert into results (name, passed)
select 'portal: a shared unsure item reads as "still being considered"',
       exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' = 'Dov Unsure' and e ->> 'status_label' = 'Still being considered'
       );

-- Absent: every hidden state, even though shared.
insert into results (name, passed)
select 'portal: hidden-state items (new/not_sure/for_sure_not/no) never appear',
       not exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' in ('Ben New', 'Eli Notsure', 'Gad Fsn', 'Zev No')
       );

-- Absent: private visibility, even in a child-visible state.
insert into results (name, passed)
select 'portal: private_parent / private_child items never appear',
       not exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' in ('Priv Parent', 'Priv Child')
       );

-- Absent: another child's suggestions in the same account.
insert into results (name, passed)
select 'portal: another child in the same account is never leaked',
       not exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' = 'Rivka Match'
       );

-- Absent: another account entirely.
insert into results (name, passed)
select 'portal: another account is never leaked (cross-tenant)',
       not exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ->> 'name_en' = 'Tenant B Match'
       );

-- Only child-safe fields ever leave the function.
insert into results (name, passed, detail)
select 'portal: suggestions expose ONLY child-safe fields (no age/parents/state/id/visibility)',
       not exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_leah') -> 'suggestions') e
         where e ? 'age' or e ? 'parents_en' or e ? 'seminary_en'
            or e ? 'pipeline_state' or e ? 'id' or e ? 'shadchan_id'
            or e ? 'visibility' or e ? 'account_id' or e ? 'child_id'
       ),
       (public.get_child_portal(:'token_leah') -> 'suggestions' -> 0)::text;

insert into results (name, passed)
select 'portal: the child object carries only the first name, no ids',
       (public.get_child_portal(:'token_leah') -> 'child' ->> 'first_name_en') = 'Leah'
       and (public.get_child_portal(:'token_leah') -> 'child' ->> 'first_name_he') = 'לאה'
       and not (public.get_child_portal(:'token_leah') -> 'child' ? 'id')
       and not (public.get_child_portal(:'token_leah') -> 'child' ? 'account_id');

-- Revoked / unknown tokens: null, with no oracle distinguishing them.
insert into results (name, passed)
select 'portal: a revoked token returns nothing',
       public.get_child_portal(:'token_revoked') is null;

insert into results (name, passed)
select 'portal: an unknown token returns nothing (no enumeration oracle)',
       public.get_child_portal('00000000000000000000000000000000000000000000dead') is null;

insert into results (name, passed)
select 'portal: a null / too-short token returns nothing without touching a table',
       public.get_child_portal(null) is null and public.get_child_portal('short') is null;

-- Tenant B's token sees ONLY tenant B, proving the scope is the token's, not a
-- global one.
insert into results (name, passed)
select 'portal: tenant B token sees only tenant B suggestions',
       jsonb_array_length(public.get_child_portal(:'token_b') -> 'suggestions') = 1
       and exists (
         select 1 from jsonb_array_elements(public.get_child_portal(:'token_b') -> 'suggestions') e
         where e ->> 'name_en' = 'Tenant B Match'
       );

reset role;

-- ---------------------------------------------------------------------------
-- Anon reaches ONLY get_child_portal — nothing else on the portal path.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'grants: anon may EXECUTE get_child_portal',
       has_function_privilege('anon', 'public.get_child_portal(text)', 'EXECUTE');

insert into results (name, passed)
select 'grants: anon has NO privilege on child_portal_tokens (the secret column)',
       not has_table_privilege('anon', 'public.child_portal_tokens', 'SELECT')
       and not has_table_privilege('anon', 'public.child_portal_tokens', 'INSERT')
       and not has_table_privilege('anon', 'public.child_portal_tokens', 'UPDATE')
       and not has_table_privilege('anon', 'public.child_portal_tokens', 'DELETE');

insert into results (name, passed)
select 'grants: anon cannot run the token-defaults trigger fn directly',
       not has_function_privilege('anon', 'public.set_child_portal_token_defaults()', 'EXECUTE');

insert into results (name, passed)
select 'grants: authenticated cannot DELETE or TRUNCATE tokens (audit trail + RLS)',
       not has_table_privilege('authenticated', 'public.child_portal_tokens', 'DELETE')
       and not has_table_privilege('authenticated', 'public.child_portal_tokens', 'TRUNCATE');

-- ---------------------------------------------------------------------------
-- RLS: a parent manages only their own account's tokens.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a1a1a1-aaaa-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'RLS: a parent sees only their own account tokens',
       (select count(*) from public.child_portal_tokens) =
       (select count(*) from public.child_portal_tokens where account_id = :acct_a);

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
