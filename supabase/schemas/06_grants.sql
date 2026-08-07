--
-- Grants
-- This file declares all grants and default privileges for the public schema.
--

-- Schema usage
grant usage on schema public to postgres;
grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant usage on schema public to service_role;

-- Function grants
grant all on function public.handle_new_user() to anon;
grant all on function public.handle_new_user() to authenticated;
grant all on function public.handle_new_user() to service_role;

grant all on function public.handle_update_user() to anon;
grant all on function public.handle_update_user() to authenticated;
grant all on function public.handle_update_user() to service_role;

grant all on function public.set_member_id_default() to anon;
grant all on function public.set_member_id_default() to authenticated;
grant all on function public.set_member_id_default() to service_role;

-- Table grants
--
-- The API roles reach base tables only as `authenticated` / `service_role`;
-- `anon` is never granted DML on them (it keeps only the REFERENCES / TRIGGER /
-- TRUNCATE privileges Postgres attaches at table creation).
grant all on table public.members to authenticated;
grant all on table public.members to service_role;

grant all on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

-- App configuration is read by every signed-in user. Story 2.7 (AC-9)
-- retired the admin-role-check helper and the two policies that called it —
-- this table-level insert/update grant is a no-op for `authenticated` now
-- (there is no insert/update POLICY left, so RLS refuses regardless), left
-- as-is rather than pared back, since `service_role` bypasses RLS and needs
-- it; nothing deletes it, so DELETE is deliberately not granted.
grant select, insert, update on table public.configuration to authenticated;
grant select, insert, update on table public.configuration to service_role;

-- Sequence grants
grant all on sequence public.members_id_seq to anon;
grant all on sequence public.members_id_seq to authenticated;
grant all on sequence public.members_id_seq to service_role;

grant all on sequence public.tasks_id_seq to anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

-- Default privileges
--
-- AD-1's anon revocation (Epic 2, Story 2.1): the fork's default privileges
-- used to auto-grant `anon` ALL on every new sequence/function/table. These
-- three lines withdraw that from the live database (an `alter default privileges`
-- edits pg_default_acl only, so it affects objects created AFTER it runs —
-- it is NOT retroactive; every pre-existing object still needs its own
-- per-object `revoke ... from anon`, which this file already does for the
-- shidduchim domain below). Story 1.1 Task A6 deferred exactly this to
-- Epic 2 by name; this closes it.
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

--
-- =====================================================================
-- MyShadchan — Shidduchim pipeline grants (AD-1, F6)
-- =====================================================================
-- The fork's default privileges used to auto-grant ALL on every new table to
-- `anon`; that default privilege itself is now revoked above (AD-1 / F6,
-- Story 2.1). Each shidduchim-domain object below is ALSO explicitly revoked
-- from anon and granted only to authenticated + service_role, as
-- defense-in-depth: the default-privilege revoke only affects objects
-- created after it runs, so every pre-existing object still needs its own
-- explicit revoke.

-- Table grants
revoke all on table public.accounts from anon;
grant all on table public.accounts to authenticated;
grant all on table public.accounts to service_role;

revoke all on table public.account_members from anon;
grant all on table public.account_members to authenticated;
grant all on table public.account_members to service_role;

-- member_state (Story 2.1, AD-19): SELECT-only for authenticated, like
-- identity_signals below. The only write path is set_active_context() /
-- activate_context_for(), both SECURITY DEFINER; a client has no grant to
-- write this table directly even if RLS did not already refuse it.
revoke all on table public.member_state from anon, authenticated;
grant select on table public.member_state to authenticated;
grant all on table public.member_state to service_role;

-- invites (Story 2.7, AC-2): SELECT-only for authenticated. DML is withheld
-- at the grant level, not merely by the absence of a policy — see
-- 05_policies.sql for why that distinction is the whole point. `from anon,
-- authenticated` (both, not just anon): the schema's default privileges
-- (top of this file) auto-grant ALL on every new table to `authenticated`
-- at creation time, so revoking from anon alone would leave TRUNCATE and
-- every other privilege standing for `authenticated` — mirrors
-- member_state's own grant block above. The sequence gets no
-- `authenticated` grant either, since `authenticated` never inserts
-- directly (contrast this file's other sequence grants, which hand `anon`
-- `all` — do NOT copy that pattern here).
revoke all on table public.invites from anon, authenticated;
grant select on table public.invites to authenticated;
grant all on table public.invites to service_role;

revoke all on sequence public.invites_id_seq from anon, authenticated;
grant all on sequence public.invites_id_seq to service_role;

revoke all on table public.singles from anon;
grant all on table public.singles to authenticated;
grant all on table public.singles to service_role;

revoke all on table public.shadchanim from anon;
grant all on table public.shadchanim to authenticated;
grant all on table public.shadchanim to service_role;

revoke all on table public."references" from anon;
grant all on table public."references" to authenticated;
grant all on table public."references" to service_role;

revoke all on table public.shidduchim from anon;
grant all on table public.shidduchim to authenticated;
grant all on table public.shidduchim to service_role;

revoke all on table public.resumes from anon;
grant all on table public.resumes to authenticated;
grant all on table public.resumes to service_role;

revoke all on table public.reference_links from anon;
grant all on table public.reference_links to authenticated;
grant all on table public.reference_links to service_role;

revoke all on table public.date_records from anon;
grant all on table public.date_records to authenticated;
grant all on table public.date_records to service_role;

revoke all on table public.redts from anon;
grant all on table public.redts to authenticated;
grant all on table public.redts to service_role;

revoke all on table public.shidduch_schools from anon;
grant all on table public.shidduch_schools to authenticated;
grant all on table public.shidduch_schools to service_role;

revoke all on table public.shidduchim_external_links from anon;
grant all on table public.shidduchim_external_links to authenticated;
grant all on table public.shidduchim_external_links to service_role;

revoke all on table public.pipeline_transitions from anon;
grant select on table public.pipeline_transitions to authenticated;
grant all on table public.pipeline_transitions to service_role;

-- View grant (summary read path)
revoke all on table public.shidduchim_summary from anon;
grant all on table public.shidduchim_summary to authenticated;
grant all on table public.shidduchim_summary to service_role;

-- Dedupe catch count (E3). An aggregate read path over identity_signals, so it is
-- not auto-updatable and only SELECT is meaningful for authenticated. anon never
-- reads it, like the rest of the shidduchim domain.
revoke all on table public.shidduchim_catch_summary from anon, authenticated;
grant select on table public.shidduchim_catch_summary to authenticated;
grant all on table public.shidduchim_catch_summary to service_role;

-- Sequence grants
revoke all on sequence public.accounts_id_seq from anon;
grant all on sequence public.accounts_id_seq to authenticated;
grant all on sequence public.accounts_id_seq to service_role;

revoke all on sequence public.account_members_id_seq from anon;
grant all on sequence public.account_members_id_seq to authenticated;
grant all on sequence public.account_members_id_seq to service_role;

revoke all on sequence public.singles_id_seq from anon;
grant all on sequence public.singles_id_seq to authenticated;
grant all on sequence public.singles_id_seq to service_role;

revoke all on sequence public.shadchanim_id_seq from anon;
grant all on sequence public.shadchanim_id_seq to authenticated;
grant all on sequence public.shadchanim_id_seq to service_role;

revoke all on sequence public.references_id_seq from anon;
grant all on sequence public.references_id_seq to authenticated;
grant all on sequence public.references_id_seq to service_role;

revoke all on sequence public.shidduchim_id_seq from anon;
grant all on sequence public.shidduchim_id_seq to authenticated;
grant all on sequence public.shidduchim_id_seq to service_role;

revoke all on sequence public.resumes_id_seq from anon;
grant all on sequence public.resumes_id_seq to authenticated;
grant all on sequence public.resumes_id_seq to service_role;

revoke all on sequence public.resume_photos_id_seq from anon;
grant all on sequence public.resume_photos_id_seq to authenticated;
grant all on sequence public.resume_photos_id_seq to service_role;

revoke all on sequence public.medical_notes_id_seq from anon;
grant all on sequence public.medical_notes_id_seq to authenticated;
grant all on sequence public.medical_notes_id_seq to service_role;

revoke all on sequence public.reference_links_id_seq from anon;
grant all on sequence public.reference_links_id_seq to authenticated;
grant all on sequence public.reference_links_id_seq to service_role;

revoke all on sequence public.date_records_id_seq from anon;
grant all on sequence public.date_records_id_seq to authenticated;
grant all on sequence public.date_records_id_seq to service_role;

revoke all on sequence public.redts_id_seq from anon;
grant all on sequence public.redts_id_seq to authenticated;
grant all on sequence public.redts_id_seq to service_role;

revoke all on sequence public.shidduch_schools_id_seq from anon;
grant all on sequence public.shidduch_schools_id_seq to authenticated;
grant all on sequence public.shidduch_schools_id_seq to service_role;

revoke all on sequence public.shidduchim_external_links_id_seq from anon;
grant all on sequence public.shidduchim_external_links_id_seq to authenticated;
grant all on sequence public.shidduchim_external_links_id_seq to service_role;

-- Function grants (execute for authenticated + service_role, never anon).
-- current_context_id() is SECURITY DEFINER, so anon must never execute it.
revoke all on function public.current_context_id() from public, anon;
grant execute on function public.current_context_id() to authenticated;
grant execute on function public.current_context_id() to service_role;

-- current_member_id() is SECURITY DEFINER, so anon must never execute it
-- (Story 3.5). Story 3.6 calls it from RLS and from a client-visible "is
-- this mine" read.
revoke all on function public.current_member_id() from public, anon;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_member_id() to service_role;

-- current_member_role() is SECURITY DEFINER, so anon must never execute it
-- (Story 6.2). Every RLS policy that gates on the caller's role calls it.
revoke all on function public.current_member_role() from public, anon;
grant execute on function public.current_member_role() to authenticated;
grant execute on function public.current_member_role() to service_role;

-- set_active_context() is SECURITY DEFINER and is the only validated way a
-- client switches its active context (AD-19); anon must never execute it.
revoke all on function public.set_active_context(bigint) from public, anon;
grant execute on function public.set_active_context(bigint) to authenticated;
grant execute on function public.set_active_context(bigint) to service_role;

-- activate_context_for() is the private member_state writer shared by
-- set_active_context() and the activate_first_context trigger. It does no
-- membership validation of its own, so — unlike every other function in
-- this file — it gets NO grant to authenticated either: only service_role
-- and its two SECURITY DEFINER callers can reach it.
revoke all on function public.activate_context_for(uuid, bigint) from public, anon, authenticated;
grant execute on function public.activate_context_for(uuid, bigint) to service_role;

-- activate_first_context() is the activate_first_context_trigger function
-- (04_triggers.sql); anon must never execute it.
revoke all on function public.activate_first_context() from public, anon;
grant execute on function public.activate_first_context() to authenticated;
grant execute on function public.activate_first_context() to service_role;

-- current_account_demo() is SECURITY DEFINER, so anon must never execute it.
revoke all on function public.current_account_demo() from public, anon;
grant execute on function public.current_account_demo() to authenticated;
grant execute on function public.current_account_demo() to service_role;

-- my_contexts() (Story 2.4) is SECURITY INVOKER, but Postgres still grants
-- EXECUTE to PUBLIC by default on every new function, so the revoke below is
-- the deny, not a formality.
revoke all on function public.my_contexts() from public, anon;
grant execute on function public.my_contexts() to authenticated;
grant execute on function public.my_contexts() to service_role;

revoke all on function public.is_single_visible_state(public.pipeline_state) from public, anon;
grant execute on function public.is_single_visible_state(public.pipeline_state) to authenticated;
grant execute on function public.is_single_visible_state(public.pipeline_state) to service_role;

revoke all on function public.enforce_pipeline_transition() from public, anon;
grant execute on function public.enforce_pipeline_transition() to authenticated;
grant execute on function public.enforce_pipeline_transition() to service_role;

revoke all on function public.set_account_id_default() from public, anon;
grant execute on function public.set_account_id_default() to authenticated;
grant execute on function public.set_account_id_default() to service_role;

-- Story 3.5 (AC 4): the trigger function backing set_interaction_actor_member_id.
revoke all on function public.set_interaction_actor_member_id() from public, anon;
grant execute on function public.set_interaction_actor_member_id() to authenticated;
grant execute on function public.set_interaction_actor_member_id() to service_role;

-- Story 2.2 (AC-3): enforce_household_scope() is the shared trigger function
-- backing the 11 validate_*_household_scope triggers (13 originally; Story
-- 3.14 dropped interactions/tasks from the set, AD-2). Not SECURITY
-- DEFINER — it only reads accounts.kind for the row it is validating, which
-- the caller's own RLS already lets them read — but every function gets an
-- explicit revoke-then-grant regardless of PUBLIC's default execute grant.
revoke all on function public.enforce_household_scope() from public, anon;
grant execute on function public.enforce_household_scope() to authenticated;
grant execute on function public.enforce_household_scope() to service_role;

-- Story 2.2 (AC-5): enforce_membership_role_matches_context() is AC-3's
-- mirror case on account_members itself; same posture as
-- enforce_household_scope().
revoke all on function public.enforce_membership_role_matches_context() from public, anon;
grant execute on function public.enforce_membership_role_matches_context() to authenticated;
grant execute on function public.enforce_membership_role_matches_context() to service_role;

-- Story 2.2 (AC-6/AC-8): the shared IMMUTABLE "owning role" predicate used by
-- both add_persona() and my_personas().
revoke all on function public.is_owning_membership_role(text) from public, anon;
grant execute on function public.is_owning_membership_role(text) to authenticated;
grant execute on function public.is_owning_membership_role(text) to service_role;

-- Story 3.6 (AC 3): can_moderate_note() is SECURITY DEFINER and called from
-- both the interactions UPDATE policy and interactions_summary.can_moderate
-- (05_policies.sql, 03_views.sql) — same posture as is_owning_membership_role
-- just above; anon must never execute it.
revoke all on function public.can_moderate_note(bigint) from public, anon;
grant execute on function public.can_moderate_note(bigint) to authenticated;
grant execute on function public.can_moderate_note(bigint) to service_role;

-- Story 2.2 (AC-6): add_persona() is SECURITY DEFINER — every query inside
-- is filtered to user_id = auth.uid() alone, never a parameter, so
-- bypassing RLS never becomes bypassing the tenant boundary; anon must
-- never execute it.
revoke all on function public.add_persona(text) from public, anon;
grant execute on function public.add_persona(text) to authenticated;
grant execute on function public.add_persona(text) to service_role;

-- Story 2.2 (AC-8): my_personas() is SECURITY DEFINER and takes NO
-- parameter — the empty signature is the only guard against it becoming a
-- cross-user oracle; anon must never execute it.
revoke all on function public.my_personas() from public, anon;
grant execute on function public.my_personas() to authenticated;
grant execute on function public.my_personas() to service_role;

-- Review finding #1 (2.5): account_has_domain_data() is a plain read-only
-- predicate used by guard_persona_removal(); safe to grant broadly (RLS
-- still applies unless called from within a SECURITY DEFINER caller).
revoke all on function public.account_has_domain_data(bigint) from public, anon;
grant execute on function public.account_has_domain_data(bigint) to authenticated;
grant execute on function public.account_has_domain_data(bigint) to service_role;

-- Review finding #1 (2.5): guard_persona_removal() is the shared refusal
-- check remove_persona()'s shadchan/parent branches call before archiving a
-- membership outright.
revoke all on function public.guard_persona_removal(bigint, bigint) from public, anon;
grant execute on function public.guard_persona_removal(bigint, bigint) to authenticated;
grant execute on function public.guard_persona_removal(bigint, bigint) to service_role;

-- Story 2.5 (AC-2): remove_persona() is SECURITY DEFINER — every query
-- inside is filtered to user_id = auth.uid() alone, never a parameter, so
-- bypassing RLS never becomes bypassing the tenant boundary; anon must
-- never execute it.
revoke all on function public.remove_persona(text) from public, anon;
grant execute on function public.remove_persona(text) to authenticated;
grant execute on function public.remove_persona(text) to service_role;

-- Story 2.7 (AC-3): role_authority() is a small IMMUTABLE helper — a pure
-- function of its argument — safe to grant broadly.
revoke all on function public.role_authority(text) from public, anon;
grant execute on function public.role_authority(text) to authenticated;
grant execute on function public.role_authority(text) to service_role;

-- Story 2.8 (Task 1): is_invite_capable_role() is a small IMMUTABLE helper
-- shared by create_invite() and revoke_invite() — a pure function of its
-- argument, safe to grant broadly, same reasoning as role_authority() above.
revoke all on function public.is_invite_capable_role(text) from public, anon;
grant execute on function public.is_invite_capable_role(text) to authenticated;
grant execute on function public.is_invite_capable_role(text) to service_role;

-- Story 2.7 (AC-3): create_invite() is SECURITY DEFINER and the sole
-- authenticated write path onto a table with no client DML grant — every
-- check in AC-3 is performed inside the function itself, since RLS no
-- longer backstops it.
--
-- Story 6.1: `p_target_single_id` was appended as create_invite()'s THIRD
-- parameter (02_functions.sql), which PostgREST/Postgres treat as a
-- distinct overload from the old two-argument signature — grants are
-- per-signature, not per-name, so this is a new grant, not an edit of the
-- one above. The migration this story generates drops the now-superseded
-- two-argument overload by hand (two overloads make PostgREST RPC
-- resolution ambiguous) — see the migration's own comment.
revoke all on function public.create_invite(text, text, bigint) from public, anon;
grant execute on function public.create_invite(text, text, bigint) to authenticated;
grant execute on function public.create_invite(text, text, bigint) to service_role;

-- Story 2.7 (AC-4): get_invite_preview() is deliberately anon-callable — the
-- one new anon surface this story adds, so an unauthenticated invitee can
-- preview their invite before signing up. Narrow by construction (AC-4's
-- five-field list) — see the function's own comment for why this is a
-- scoped exception to AD-1's anon posture, not a precedent.
revoke all on function public.get_invite_preview(uuid) from public;
grant execute on function public.get_invite_preview(uuid) to anon;
grant execute on function public.get_invite_preview(uuid) to authenticated;
grant execute on function public.get_invite_preview(uuid) to service_role;

-- check_signup_age() (renamed from check_signup_invite() when open signup
-- dropped the invite requirement — see the function's own comment,
-- 02_functions.sql) backs the before_user_created Auth Hook — GoTrue
-- invokes it as `supabase_auth_admin`, never `anon` or `authenticated`
-- directly.
revoke all on function public.check_signup_age(jsonb) from public, anon, authenticated;
grant execute on function public.check_signup_age(jsonb) to supabase_auth_admin;

-- Story 2.7 review finding #4: accept_invite() is SECURITY DEFINER and
-- requires a real authenticated session (auth.uid()) — never anon, since a
-- bare, unauthenticated caller can never satisfy its own "requires an
-- authenticated caller" check.
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.accept_invite(uuid) to service_role;

-- Story 2.8 (AC-3): revoke_invite() is SECURITY DEFINER and the sole
-- authenticated write path that transitions an invite to 'revoked' — same
-- reasoning as create_invite() above: AC-2 withholds every DML grant on
-- `invites` from `authenticated`, so an invoker-rights update would be
-- refused at the grant before any of the function's own checks ever ran.
revoke all on function public.revoke_invite(bigint) from public, anon;
grant execute on function public.revoke_invite(bigint) to authenticated;
grant execute on function public.revoke_invite(bigint) to service_role;

revoke all on function public.enforce_shidduch_initial_state() from public, anon;
grant execute on function public.enforce_shidduch_initial_state() to authenticated;
grant execute on function public.enforce_shidduch_initial_state() to service_role;

-- The two halves of the close_reason column control (02_functions.sql).
-- `authenticated` MUST hold execute on both: shidduchim_summary is
-- `security_invoker = on`, so shidduch_close_reason() is called with the
-- INVOKER's privileges when the board reads the view. That is safe because
-- the accessor guards itself — its `where` mirrors the "Shidduchim scoped to
-- account" policy, so calling it straight through
-- `/rest/v1/rpc/shidduch_close_reason` answers nothing a caller could not
-- already read, and answers NULL for the `single` role by construction.
-- `anon` is denied both, like every other domain function here.
revoke all on function public.shidduch_close_reason(bigint) from public, anon;
grant execute on function public.shidduch_close_reason(bigint) to authenticated;
grant execute on function public.shidduch_close_reason(bigint) to service_role;

revoke all on function public.shidduch_row(bigint) from public, anon;
grant execute on function public.shidduch_row(bigint) to authenticated;
grant execute on function public.shidduch_row(bigint) to service_role;

revoke all on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) from public, anon;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to authenticated;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to service_role;

revoke all on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) from public, anon;
grant execute on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) to authenticated;
grant execute on function public.transition_shidduch(bigint, public.pipeline_state, public.pipeline_state, text) to service_role;

revoke all on function public.refresh_shidduch_redt_summary() from public, anon;
grant execute on function public.refresh_shidduch_redt_summary() to authenticated;
grant execute on function public.refresh_shidduch_redt_summary() to service_role;

revoke all on function public.add_redt(bigint, bigint, date, text) from public, anon;
grant execute on function public.add_redt(bigint, bigint, date, text) to authenticated;
grant execute on function public.add_redt(bigint, bigint, date, text) to service_role;

revoke all on function public.add_school(bigint, text, text, text, integer, integer) from public, anon;
grant execute on function public.add_school(bigint, text, text, text, integer, integer) to authenticated;
grant execute on function public.add_school(bigint, text, text, text, integer, integer) to service_role;

-- Story 5.3: the sole write path into resumes.files (AC 2). Story 5.8
-- widened the argument list to also accept a single (p_shidduchim_id/
-- p_single_id, both defaulted) — a signature change is a DROP FUNCTION +
-- CREATE FUNCTION under the hood, which drops the function's grants, so
-- these are re-issued against the new signature in the same diff.
revoke all on function public.add_resume_file(text, text, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint) to authenticated;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint) to service_role;

-- Story 5.4: the two write paths into resume_photos (AC 2). Story 5.8
-- widened add_resume_photo the same way as add_resume_file above.
revoke all on function public.add_resume_photo(text, bigint, bigint, text) from public, anon;
grant execute on function public.add_resume_photo(text, bigint, bigint, text) to authenticated;
grant execute on function public.add_resume_photo(text, bigint, bigint, text) to service_role;

revoke all on function public.hide_resume_photo(bigint) from public, anon;
grant execute on function public.hide_resume_photo(bigint) to authenticated;
grant execute on function public.hide_resume_photo(bigint) to service_role;

-- References epic: new tables, views and functions. anon is revoked everywhere,
-- exactly as for the rest of the shidduchim domain.
-- interactions is the diligence audit timeline. Two grants are deliberately
-- withheld from authenticated:
--   TRUNCATE, because it bypasses RLS entirely — one statement from any
--     authenticated session would wipe every tenant's notes and call history.
--   DELETE, because a call log somebody can quietly erase row by row is worth
--     much less than one they cannot. Removing a whole conversation is still
--     possible by deleting its reference_link, which is an explicit, visible
--     action that takes the link's own log with it.
revoke all on table public.interactions from anon, authenticated;
grant select, insert, update on table public.interactions to authenticated;
grant all on table public.interactions to service_role;

-- identity_signals is deliberately SELECT-only for authenticated: it is written
-- by the SECURITY DEFINER sync triggers, never by a client. A client able to
-- write its own match keys could redirect matchIdentity() at any row. The
-- revoke names `authenticated` explicitly so the schema's default privileges
-- cannot leave TRUNCATE behind on a table nobody should be able to empty.
revoke all on table public.identity_signals from anon, authenticated;
grant select on table public.identity_signals to authenticated;
grant all on table public.identity_signals to service_role;

-- tasks became account-scoped and reference-targetable in this epic, so it can
-- no longer inherit the fork's blanket anon grant — nor keep the schema
-- default's TRUNCATE, which bypasses RLS across every tenant.
revoke all on table public.tasks from anon, authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

-- Read paths only. Both views aggregate or join several relations, so they are
-- not auto-updatable and a write grant would only be a misleading promise.
revoke all on table public.references_summary from anon, authenticated;
grant select on table public.references_summary to authenticated;
grant all on table public.references_summary to service_role;

revoke all on table public.reference_links_summary from anon, authenticated;
grant select on table public.reference_links_summary to authenticated;
grant all on table public.reference_links_summary to service_role;

-- Story 3.6 (AC 5): author identity resolved server-side. Read path only,
-- same posture as references_summary/reference_links_summary above.
revoke all on table public.interactions_summary from anon, authenticated;
grant select on table public.interactions_summary to authenticated;
grant all on table public.interactions_summary to service_role;

-- Aggregate read paths (E5/E6). Both group several rows per key, so they are
-- not auto-updatable and only SELECT is meaningful for authenticated.
revoke all on table public.singles_summary from anon, authenticated;
grant select on table public.singles_summary to authenticated;
grant all on table public.singles_summary to service_role;

revoke all on table public.shadchan_stats from anon, authenticated;
grant select on table public.shadchan_stats to authenticated;
grant all on table public.shadchan_stats to service_role;

-- Story 12.3: the assignee picker's roster. Read path only, same posture as
-- shadchan_stats above.
revoke all on table public.context_members from anon, authenticated;
grant select on table public.context_members to authenticated;
grant all on table public.context_members to service_role;

revoke all on sequence public.interactions_id_seq from anon;
grant all on sequence public.interactions_id_seq to authenticated;
grant all on sequence public.interactions_id_seq to service_role;

revoke all on sequence public.identity_signals_id_seq from anon, authenticated;
grant all on sequence public.identity_signals_id_seq to service_role;

revoke all on sequence public.tasks_id_seq from anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

-- Identity/normalization functions.
revoke all on function public.normalize_identity_text(text) from public, anon;
grant execute on function public.normalize_identity_text(text) to authenticated;
grant execute on function public.normalize_identity_text(text) to service_role;

revoke all on function public.normalize_phone(text) from public, anon;
grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.normalize_phone(text) to service_role;

revoke all on function public.identity_name_key(text) from public, anon;
grant execute on function public.identity_name_key(text) to authenticated;
grant execute on function public.identity_name_key(text) to service_role;

revoke all on function public.match_identity(text, text, text, text, text, text, text, text, bigint) from public, anon;
grant execute on function public.match_identity(text, text, text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.match_identity(text, text, text, text, text, text, text, text, bigint) to service_role;

revoke all on function public.match_reference_on_entry(text, text, text, text, bigint) from public, anon;
grant execute on function public.match_reference_on_entry(text, text, text, text, bigint) to authenticated;
grant execute on function public.match_reference_on_entry(text, text, text, text, bigint) to service_role;

-- Dedupe catch (E3): read-only evidence for the "you've come across this person
-- before" panel. FREE feature, never gated by AI entitlement; anon never runs it.
revoke all on function public.catch_shidduch(bigint) from public, anon;
grant execute on function public.catch_shidduch(bigint) to authenticated;
grant execute on function public.catch_shidduch(bigint) to service_role;

-- Trigger functions: never executable by anon.
revoke all on function public.set_reference_norms() from public, anon;
grant execute on function public.set_reference_norms() to authenticated;
grant execute on function public.set_reference_norms() to service_role;

revoke all on function public.sync_reference_identity_signals() from public, anon;
grant execute on function public.sync_reference_identity_signals() to authenticated;
grant execute on function public.sync_reference_identity_signals() to service_role;

revoke all on function public.sync_shidduch_identity_signals() from public, anon;
grant execute on function public.sync_shidduch_identity_signals() to authenticated;
grant execute on function public.sync_shidduch_identity_signals() to service_role;

revoke all on function public.purge_polymorphic_dependents() from public, anon;
grant execute on function public.purge_polymorphic_dependents() to authenticated;
grant execute on function public.purge_polymorphic_dependents() to service_role;

revoke all on function public.sync_task_target() from public, anon;
grant execute on function public.sync_task_target() to authenticated;
grant execute on function public.sync_task_target() to service_role;

-- Reference write paths.
revoke all on function public.link_reference_to_shidduch(bigint, bigint, text) from public, anon;
grant execute on function public.link_reference_to_shidduch(bigint, bigint, text) to authenticated;
grant execute on function public.link_reference_to_shidduch(bigint, bigint, text) to service_role;

revoke all on function public.log_reference_call(bigint, text, text, text) from public, anon;
grant execute on function public.log_reference_call(bigint, text, text, text) to authenticated;
grant execute on function public.log_reference_call(bigint, text, text, text) to service_role;

revoke all on function public.preview_reference_merge(bigint, bigint) from public, anon;
grant execute on function public.preview_reference_merge(bigint, bigint) to authenticated;
grant execute on function public.preview_reference_merge(bigint, bigint) to service_role;

revoke all on function public.merge_references(bigint, bigint, jsonb) from public, anon;
grant execute on function public.merge_references(bigint, bigint, jsonb) to authenticated;
grant execute on function public.merge_references(bigint, bigint, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- TRUNCATE/MAINTAIN hardening across the shidduchim domain.
--
-- The fork's default privileges grant every new table's full privilege set to
-- anon and authenticated, and the pipeline epic's `grant all` re-added it. That
-- leaves TRUNCATE, which BYPASSES ROW LEVEL SECURITY: one statement from any
-- authenticated session empties a table for every tenant at once. `db diff`
-- cannot see MAINTAIN at all, so this drift is invisible to the migration
-- generator and has to be stated explicitly.
--
-- Revoke-all-then-regrant is deliberate: naming individual privileges misses
-- whichever ones a future Postgres adds.
-- ---------------------------------------------------------------------------
revoke all on table public.accounts from anon, authenticated;
grant select, insert, update, delete on table public.accounts to authenticated;

-- UPDATE is withheld entirely from authenticated (Story 2.2 review finding
-- #1, CLOSED): the UPDATE policy's own `using`/`with check`
-- (05_policies.sql) scopes only `account_id`, never `role`, so granting
-- table-level UPDATE let any authenticated member of an account rewrite
-- their OWN row's `role` to `parent_admin` in one PostgREST request — a
-- real self-promotion, not merely a theoretical gap. No legitimate write
-- path needs it today: add_persona()'s self_manager -> parent_admin
-- promotion runs as a SECURITY DEFINER function, which executes with the
-- function owner's privileges and is unaffected by this grant either way.
-- A future client-facing role-change flow (Story 2.5/2.7) must add its own
-- SECURITY DEFINER function — the same shape add_persona() already
-- establishes — never a raw grant of UPDATE back onto this table.
revoke all on table public.account_members from anon, authenticated;
grant select, insert, delete on table public.account_members to authenticated;

revoke all on table public.singles from anon, authenticated;
grant select, insert, update, delete on table public.singles to authenticated;

revoke all on table public.shadchanim from anon, authenticated;
grant select, insert, update, delete on table public.shadchanim to authenticated;

revoke all on table public."references" from anon, authenticated;
grant select, insert, update, delete on table public."references" to authenticated;

-- The ONE table in this schema whose SELECT is granted COLUMN BY COLUMN, and
-- the only reason it is: `close_reason` (Story 6.3, AC-4) must always read
-- NULL for a `single` caller. Story 6.3 expressed that as a CASE inside
-- shidduchim_summary, and a single simply asked PostgREST for the base table
-- instead — `GET /rest/v1/shidduchim?select=id,close_reason` returned the
-- candid text. RLS cannot fix it (row-scoped, never column-scoped), and
-- `revoke select (close_reason) ... from authenticated` cannot either: while
-- the role holds table-level SELECT, a column-level REVOKE is a silent no-op
-- (has_column_privilege stays true). Postgres offers no "all columns except
-- one" grant, so the grant is enumerated and close_reason is simply absent
-- from it.
--
-- `authenticated` is the single Postgres role EVERY member of every household
-- logs in as — parent_admin, helper, shadchan and single alike — so there is
-- no role to re-grant the column to. The legitimate readers go through
-- public.shidduch_close_reason() (02_functions.sql), a SECURITY DEFINER
-- accessor whose guard mirrors the "Shidduchim scoped to account" policy;
-- shidduchim_summary calls it, and public.shidduch_row() carries it into the
-- three RPCs that return SETOF public.shidduchim.
--
-- Consequences to keep in mind:
--   * `select *` on this table is now an error (42501) for authenticated —
--     including PostgREST's default representation. Client reads go through
--     shidduchim_summary (dataProvider getList/getOne/getMany redirect), and
--     the one base-table write names its returned columns explicitly.
--   * ADDING A COLUMN to public.shidduchim means adding it HERE too, or it is
--     unreadable. That default is deliberate: fail closed, loudly.
--   * INSERT/UPDATE/DELETE stay table-level. Writing close_reason needs
--     UPDATE, not SELECT; RLS (05_policies.sql) is what gates the writes.
revoke all on table public.shidduchim from anon, authenticated;
grant insert, update, delete on table public.shidduchim to authenticated;
grant select (
    id,
    account_id,
    created_at,
    single_id,
    shadchan_id,
    name_en,
    name_he,
    seminary_en,
    seminary_he,
    shul_en,
    shul_he,
    location_en,
    location_he,
    age,
    height,
    pipeline_state,
    first_suggested_by,
    first_suggested_at,
    redt_date,
    origin,
    owner_member_id,
    visibility,
    index,
    background,
    dob,
    existing_children_note,
    father_en,
    father_he,
    marital_status,
    mother_en,
    mother_he
) on table public.shidduchim to authenticated;

revoke all on table public.resumes from anon, authenticated;
grant select, insert, update, delete on table public.resumes to authenticated;

-- Story 5.4: same full-CRUD shape as resumes above. RLS (05_policies.sql) is
-- the real gate — the SPA disciplines itself to write only through
-- add_resume_photo()/hide_resume_photo(), the same "sole write path" pattern
-- resumes.files already establishes for add_resume_file().
revoke all on table public.resume_photos from anon, authenticated;
grant select, insert, update, delete on table public.resume_photos to authenticated;
grant all on table public.resume_photos to service_role;

-- Story 5.5: same full-CRUD-at-the-grant-layer shape as resume_photos above.
-- RLS (05_policies.sql) is the real gate — restricted to parent_admin/
-- self_manager — and the grant only makes the table reachable at all.
revoke all on table public.medical_notes from anon, authenticated;
grant select, insert, update, delete on table public.medical_notes to authenticated;
grant all on table public.medical_notes to service_role;

revoke all on table public.reference_links from anon, authenticated;
grant select, insert, update, delete on table public.reference_links to authenticated;

revoke all on table public.date_records from anon, authenticated;
grant select, insert, update, delete on table public.date_records to authenticated;

revoke all on table public.redts from anon, authenticated;
grant select, insert, update, delete on table public.redts to authenticated;

revoke all on table public.shidduch_schools from anon, authenticated;
grant select, insert, update, delete on table public.shidduch_schools to authenticated;

-- Story 5.6: same full-CRUD-at-the-grant-layer shape as shidduch_schools
-- above. RLS (05_policies.sql) is the real gate — account-scoped only, no
-- sensitivity tier — and the grant only makes the table reachable at all.
revoke all on table public.shidduchim_external_links from anon, authenticated;
grant select, insert, update, delete on table public.shidduchim_external_links to authenticated;

-- The three tables this epic added, restated here so the whole hardening rule
-- reads in one place. interactions withholds DELETE as well (audit trail).
revoke all on table public.interactions from anon, authenticated;
grant select, insert, update on table public.interactions to authenticated;

revoke all on table public.identity_signals from anon, authenticated;
grant select on table public.identity_signals to authenticated;

revoke all on table public.tasks from anon, authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

-- pipeline_transitions is static reference data (the legal state graph), read-only
-- to clients. It was missed by the sweep above: TRUNCATE survived, and emptying it
-- makes enforce_pipeline_transition() reject every state change for every tenant.
revoke all on table public.pipeline_transitions from anon, authenticated;
grant select on table public.pipeline_transitions to authenticated;

-- The structural columns of `interactions` are not client-writable. A client
-- that could rewrite scope/reference_link_id/target_* could move a candid note
-- onto a different parent and change whose visibility it inherits. Editing what
-- a note SAYS stays allowed; moving where it HANGS does not. Story 3.6 (AC 1)
-- widens the writable set to include `deleted_at`: a soft delete IS an update
-- to what the note says about itself ("this note is withdrawn"), not a move of
-- where it hangs, so it joins `body`/`metadata` here rather than the withheld
-- structural set. The column grant cannot distinguish setting `deleted_at`
-- from clearing it, so an author can technically un-delete their own note —
-- accepted (Story 3.6 AC 1): the same author could equally re-post the same
-- text, and no UI offers undelete.
revoke update on table public.interactions from authenticated;
grant update (body, metadata, deleted_at) on table public.interactions to authenticated;

revoke all on function public.rehome_reference_link_interactions(bigint, bigint) from public, anon;
grant execute on function public.rehome_reference_link_interactions(bigint, bigint) to authenticated;
grant execute on function public.rehome_reference_link_interactions(bigint, bigint) to service_role;

revoke all on function public.rehome_reference_interactions(bigint, bigint) from public, anon;
grant execute on function public.rehome_reference_interactions(bigint, bigint) to authenticated;
grant execute on function public.rehome_reference_interactions(bigint, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- accounts billing columns are NOT client-writable (E4 hardening).
--
-- The five billing columns on `accounts` (stripe_customer_id,
-- subscription_status, plan, current_period_end, trial_end) are legacy
-- schema-readiness fields (AD-16, 01_tables.sql). They are UNUSED for
-- entitlement — the only authority is the `subscription` table via
-- public.ai_entitlement() — but they are indistinguishable from the real
-- thing, so a client-writable `accounts.plan = 'ai'` would be an instant
-- paywall bypass the day any code read it. Close the write path now.
--
-- A bare column-level `revoke update (plan, ...) on accounts` would be a
-- no-op: the table-level `grant update on accounts` above (the TRUNCATE
-- hardening block) covers every column, and a column-level revoke cannot
-- subtract from a table-level grant. So revoke table-level UPDATE and re-grant
-- UPDATE only on the mutable business columns — exactly the idiom used for
-- `interactions` above. Today the client updates `name` (login/
-- FirstRunSetup.tsx) and `default_thread_visibility` (Story 7.2,
-- settings/CommunicationSection.tsx); transparency_level/data_region are the
-- account-config columns a settings screen would edit. `demo` is
-- deliberately omitted: it is server-owned, written only by the
-- seed_demo/clear_demo edge functions via the service_role client, which
-- bypasses these grants. id/created_at are immutable. The five billing
-- columns are thus unreachable by any client.
--
-- Story 7.2 (AC-5): no new role-gating here — the shipped
-- "Accounts writable by non-single members" RLS policy (05_policies.sql)
-- already denies every `accounts` write to the `single` role, and every
-- other role is already updatable via this same grant (Dev Notes, "Who may
-- change the default posture").
--
-- anon already has ALL privileges revoked on accounts (above), so it holds no
-- UPDATE to narrow.
revoke update on table public.accounts from authenticated;
grant update (name, transparency_level, data_region, default_thread_visibility)
  on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Billing / AI entitlement (E4). subscription and ai_usage are the paid-tier
-- ledger. They are SELECT-only for authenticated: a member reads their own
-- entitlement and usage meter, and nothing else. NO write grant is issued to
-- authenticated, so — combined with the SELECT-only RLS policies — there is no
-- client path that flips plan/status to a paid state. The `revoke all` also
-- strips TRUNCATE (which bypasses RLS) from a table nobody should be able to
-- empty. Every write is service_role: the payment webhook that provisions a
-- subscription, and the AI edge functions that increment the usage meter after
-- confirming entitlement. anon is denied everywhere, as across the domain.
revoke all on table public.subscription from anon, authenticated;
grant select on table public.subscription to authenticated;
grant all on table public.subscription to service_role;

revoke all on table public.ai_usage from anon, authenticated;
grant select on table public.ai_usage to authenticated;
grant all on table public.ai_usage to service_role;

-- Sequences: only the server (service_role) inserts, so authenticated never
-- needs them; anon is denied.
revoke all on sequence public.subscription_id_seq from anon, authenticated;
grant all on sequence public.subscription_id_seq to service_role;

revoke all on sequence public.ai_usage_id_seq from anon, authenticated;
grant all on sequence public.ai_usage_id_seq to service_role;

-- Epic 11 Findings 6/7/8 closure: ai_parse_attempts is the per-attachment
-- parse claim/idempotency ledger. Same posture as ai_usage above — no client
-- write path, no client read path at all (05_policies.sql has zero policies
-- on it). Every access goes through the claim/confirm/release RPCs below,
-- which are service_role-only.
revoke all on table public.ai_parse_attempts from anon, authenticated;
grant all on table public.ai_parse_attempts to service_role;

revoke all on sequence public.ai_parse_attempts_id_seq from anon, authenticated;
grant all on sequence public.ai_parse_attempts_id_seq to service_role;

-- Story 12.4 (AC-3): stripe_events is the webhook idempotency ledger. Same
-- posture as ai_parse_attempts above — no client write path, no client read
-- path at all (05_policies.sql has zero policies on it). Every access is
-- service_role, from the billing worker alone. `event_id` is a `text`
-- primary key (the Stripe event id itself), not an identity column, so
-- there is no owned sequence to grant here.
revoke all on table public.stripe_events from anon, authenticated;
grant all on table public.stripe_events to service_role;

-- ai_entitlement() is the single server-authoritative entitlement decision,
-- called by the SPA and (future) AI edge functions alike. anon must never run
-- it; authenticated and service_role may.
revoke all on function public.ai_entitlement() from public, anon;
grant execute on function public.ai_entitlement() to authenticated;
grant execute on function public.ai_entitlement() to service_role;

-- ai_monthly_resume_limit() is a read-only constant lookup, safe for a
-- client JWT to invoke directly (same posture as ai_entitlement() above).
revoke all on function public.ai_monthly_resume_limit() from public, anon;
grant execute on function public.ai_monthly_resume_limit() to authenticated;
grant execute on function public.ai_monthly_resume_limit() to service_role;

-- ai_resume_limit_for_account(): reads only public.subscription, which is
-- already RLS-scoped to the caller's own account — asking about another
-- account's id from a client JWT simply resolves no row (returns 0), never
-- another tenant's data (see the function's own comment). Same posture as
-- ai_entitlement()/ai_monthly_resume_limit() above.
revoke all on function public.ai_resume_limit_for_account(bigint) from public, anon;
grant execute on function public.ai_resume_limit_for_account(bigint) to authenticated;
grant execute on function public.ai_resume_limit_for_account(bigint) to service_role;

-- claim/confirm/release are reachable ONLY from the Worker's service-role
-- client — EXECUTE is never granted to authenticated or anon, unlike
-- ai_entitlement()/ai_monthly_resume_limit() above. SECURITY DEFINER
-- bypasses RLS entirely, so if EXECUTE were ever granted to authenticated, a
-- modified client could pass ANY p_account_id, not just its own, enabling
-- cross-tenant quota exhaustion and — worse — could insert a fake
-- 'completed' row with attacker-controlled result JSON that a later
-- legitimate request would replay verbatim into another account's resume
-- draft.
revoke all on function public.claim_ai_parse_attempt(bigint, bigint, text, smallint) from public, anon, authenticated;
grant execute on function public.claim_ai_parse_attempt(bigint, bigint, text, smallint) to service_role;

revoke all on function public.confirm_ai_parse_attempt(bigint, bigint, bigint, jsonb, smallint) from public, anon, authenticated;
grant execute on function public.confirm_ai_parse_attempt(bigint, bigint, bigint, jsonb, smallint) to service_role;

revoke all on function public.release_ai_parse_attempt(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.release_ai_parse_attempt(bigint, bigint, bigint) to service_role;

-- force_reclaim_ai_parse_attempt() (Finding 12 closure): same posture as
-- claim/confirm/release above — SECURITY DEFINER, reachable ONLY from the
-- Worker's service-role client. A modified client with EXECUTE could
-- force-reclaim any account's completed row and trigger a free re-parse on
-- its behalf.
revoke all on function public.force_reclaim_ai_parse_attempt(bigint, bigint) from public, anon, authenticated;
grant execute on function public.force_reclaim_ai_parse_attempt(bigint, bigint) to service_role;

-- sweep_expired_ai_parse_attempts() (Finding 11 closure): called only from
-- workers/cron's scheduled() tick via the service-role client — never a
-- caller-supplied JWT.
revoke all on function public.sweep_expired_ai_parse_attempts() from public, anon, authenticated;
grant execute on function public.sweep_expired_ai_parse_attempts() to service_role;

-- ---------------------------------------------------------------------------
-- Inbox items (Epic 2 capture funnel). Unlike the billing ledger, authenticated
-- needs full CRUD within its own account (RLS-scoped): capture via share/upload
-- (insert), resolve/dismiss (update), remove (delete). The `revoke all` strips
-- TRUNCATE (which bypasses RLS). The inbound-email webhook writes as
-- service_role. anon is denied everywhere.
revoke all on table public.inbox_items from anon, authenticated;
grant select, insert, update, delete on table public.inbox_items to authenticated;
grant all on table public.inbox_items to service_role;

-- authenticated inserts its own captures, so it needs the identity sequence.
revoke all on sequence public.inbox_items_id_seq from anon;
grant usage, select on sequence public.inbox_items_id_seq to authenticated;
grant all on sequence public.inbox_items_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Files tab (Story 3.7). entity_files is the storage catalog table:
-- authenticated gets full CRUD except UPDATE at the table level — only
-- `visibility` is mutable after the fact (the column-level grant below).
-- Every other column is a fact about a stored object; changing one would
-- desynchronise the row from the bucket. The `revoke all` strips TRUNCATE
-- (bypasses RLS). anon is denied everywhere, like the rest of the domain.
revoke all on table public.entity_files from anon, authenticated;
grant select, insert, delete on table public.entity_files to authenticated;
grant all on table public.entity_files to service_role;

-- Same column-level shape interactions uses above (body, metadata,
-- deleted_at): only visibility is writable after the fact (AC 2e).
grant update (visibility) on table public.entity_files to authenticated;

-- The sequence revoke is not optional — every domain table in this file
-- pairs its table grant with one.
revoke all on sequence public.entity_files_id_seq from anon;
grant usage, select on sequence public.entity_files_id_seq to authenticated;
grant all on sequence public.entity_files_id_seq to service_role;

-- Read path only (AD-10), same posture as interactions_summary above: an
-- aggregating join is not auto-updatable, so only SELECT is meaningful for
-- authenticated.
revoke all on table public.entity_files_summary from anon, authenticated;
grant select on table public.entity_files_summary to authenticated;
grant all on table public.entity_files_summary to service_role;

-- ---------------------------------------------------------------------------
-- Communication (Epic 7: threads). connections mirrors the
-- subscription/ai_usage precedent above exactly — SELECT-only for
-- authenticated, no client write path at all; every write is service_role
-- (Epic 8's consent workflow).
-- ---------------------------------------------------------------------------
revoke all on table public.connections from anon, authenticated;
grant select on table public.connections to authenticated;
grant all on table public.connections to service_role;

-- No `authenticated` sequence grant — `authenticated` cannot insert into
-- connections at all (no INSERT policy, no INSERT grant above).
revoke all on sequence public.connections_id_seq from anon, authenticated;
grant all on sequence public.connections_id_seq to service_role;

-- threads/thread_participants/messages: no UPDATE, no DELETE anywhere,
-- matching the RLS policies above (messages are append-only, AC-4; a
-- thread/participant row is never edited or removed by a client). The
-- `revoke all` strips the TRUNCATE/REFERENCES/TRIGGER grant Postgres's
-- default privileges hand `authenticated` on every new table `postgres`
-- creates (verified on the local stack) — TRUNCATE bypasses RLS, so
-- leaving it ungranted is not optional.
--
-- `threads` gets SELECT only — no INSERT grant at all. The review fix for
-- Story 7.1's F2/F4: this story originally shipped `insert` here too, with
-- an RLS `with check` as the only defense against a direct
-- `dataProvider.create("threads", …)`. That defense didn't enforce AC-1's
-- subject-reachability rule and was independently unusable for a real
-- PostgREST `POST … return=representation` (05_policies.sql has the full
-- account). Revoking the grant closes both at the ACL layer, which no
-- policy can be bypassed under: the sole writer is create_thread()
-- (SECURITY DEFINER, owned by `postgres`, needing no grant on its own
-- table) or service_role. thread_participants/messages keep INSERT — the
-- SPA posts to both directly (Task 8: "Plain dataProvider.create(…) needs
-- no wrapper") and their own INSERT policies are the enforcement layer.
revoke all on table public.threads from anon, authenticated;
grant select on table public.threads to authenticated;
grant all on table public.threads to service_role;

revoke all on table public.thread_participants from anon, authenticated;
grant select, insert on table public.thread_participants to authenticated;
grant all on table public.thread_participants to service_role;

revoke all on table public.messages from anon, authenticated;
grant select, insert on table public.messages to authenticated;
grant all on table public.messages to service_role;

-- No `authenticated` sequence grant on threads_id_seq — `authenticated`
-- cannot insert into threads at all (mirrors connections_id_seq above,
-- same reasoning: F2's fix removed the only path that would have consumed
-- a value from this sequence as `authenticated`). thread_participants and
-- messages are still inserted directly by `authenticated`, so they keep
-- their sequence grants.
revoke all on sequence public.threads_id_seq from anon, authenticated;
grant all on sequence public.threads_id_seq to service_role;

revoke all on sequence public.thread_participants_id_seq from anon;
grant usage, select on sequence public.thread_participants_id_seq to authenticated;
grant all on sequence public.thread_participants_id_seq to service_role;

revoke all on sequence public.messages_id_seq from anon;
grant usage, select on sequence public.messages_id_seq to authenticated;
grant all on sequence public.messages_id_seq to service_role;

-- thread_is_readable()/create_thread() are SECURITY DEFINER, so anon must
-- never execute either. enforce_connection_kinds() needs no grant — it is
-- invoked only by the validate_connections_kinds trigger, and Postgres
-- never requires EXECUTE on a trigger function for the triggering role.
revoke all on function public.thread_is_readable(bigint) from public, anon;
grant execute on function public.thread_is_readable(bigint) to authenticated;
grant execute on function public.thread_is_readable(bigint) to service_role;

-- Story 7.4 (Task 1): connection_is_active_for_caller() is called DIRECTLY
-- from RLS policies (the two INSERT policies above, evaluated as
-- `authenticated`) as well as from create_thread() and thread_is_readable()
-- — unlike thread_visibility_permits() below, this one needs the client
-- grant.
revoke all on function public.connection_is_active_for_caller(bigint) from public, anon;
grant execute on function public.connection_is_active_for_caller(bigint) to authenticated;
grant execute on function public.connection_is_active_for_caller(bigint) to service_role;

-- Story 7.4 (Task 2): thread_visibility_permits() is an internal helper for
-- thread_is_readable() ONLY — it has no scope gate of its own, so a direct
-- RPC to it would let any signed-in caller probe an arbitrary thread id's
-- open/private visibility without ever passing the scope check
-- thread_is_readable() enforces. Revoked from every client role, exactly
-- like activate_context_for() above: reachable only from its SECURITY
-- DEFINER caller (which runs as the owning role, needing no grant of its
-- own) and service_role.
revoke all on function public.thread_visibility_permits(bigint) from public, anon, authenticated;
grant execute on function public.thread_visibility_permits(bigint) to service_role;

-- Story 7.4 (Task 3): create_thread() gains a fifth parameter
-- (p_connection_id), which is a NEW signature for grant purposes too — the
-- old 4-argument grant below is dropped by this story's migration (matching
-- the DROP FUNCTION the schema change itself requires; see 02_functions.sql's
-- own comment on the two-overload trap) and re-issued here under the new
-- 5-argument signature.
revoke all on function public.create_thread(text, bigint, bigint[], text, bigint) from public, anon;
grant execute on function public.create_thread(text, bigint, bigint[], text, bigint) to authenticated;
grant execute on function public.create_thread(text, bigint, bigint[], text, bigint) to service_role;

-- Story 7.3: set_thread_visibility() is the SOLE write path for
-- `threads.visibility` after creation — deliberately NO table-level UPDATE
-- grant on `threads` for `authenticated` anywhere in this file (matches the
-- "SELECT only, no INSERT" posture above). If `authenticated` ever gained
-- UPDATE on `threads`, this RPC's own participant/readability checks would
-- be one `dataProvider.update("threads", …)` away from bypassed.
revoke all on function public.set_thread_visibility(bigint, text) from public, anon;
grant execute on function public.set_thread_visibility(bigint, text) to authenticated;
grant execute on function public.set_thread_visibility(bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- Communication (Epic 7 Story 7.5: notification delivery)
-- ---------------------------------------------------------------------------
-- message_notifications (AC-11): unreachable from a browser. No grant at all
-- for anon/authenticated — belt-and-braces alongside the "no policy" RLS
-- posture (05_policies.sql): either layer alone already denies every client
-- access, so neither can regress silently on its own.
revoke all on table public.message_notifications from anon, authenticated;
grant all on table public.message_notifications to service_role;
revoke all on sequence public.message_notifications_id_seq from anon, authenticated;
grant all on sequence public.message_notifications_id_seq to service_role;

-- push_subscriptions (AC-12): a member manages their own rows directly — no
-- UPDATE grant, because a changed key is a new subscription (replace via
-- delete + insert, Task 3), never an edit of an existing one.
--
-- `revoke all ... from anon, authenticated` (not just `anon`, which is all
-- the story's own Task 3 text names): Postgres's default privileges hand
-- `authenticated` TRUNCATE/REFERENCES/TRIGGER on every new table `postgres`
-- creates (verified on the local stack, same fact `thread_participants`'s own
-- grant block above documents) — TRUNCATE bypasses RLS entirely, force or
-- no force, so leaving it ungranted is not optional on a table AC-12 exists
-- specifically to lock to one member's own rows.
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;
revoke all on sequence public.push_subscriptions_id_seq from anon;
grant usage, select on sequence public.push_subscriptions_id_seq to authenticated;
grant all on sequence public.push_subscriptions_id_seq to service_role;

-- mark_thread_read() (AC-1, AC-2): the sole write path for
-- thread_participants.last_read_at — `authenticated` holds no UPDATE grant on
-- the table itself (unchanged above), so this SECURITY DEFINER function,
-- gated entirely by its own current_member_id() predicate, is the only way a
-- client can ever move it.
revoke all on function public.mark_thread_read(bigint) from public, anon;
grant execute on function public.mark_thread_read(bigint) to authenticated;
grant execute on function public.mark_thread_read(bigint) to service_role;

-- claim_message_notifications()/settle_message_notification()/
-- delete_push_subscription_by_endpoint() (AC-9, AC-10): service_role only —
-- the sweep Worker's entire interface to this domain, never called from a
-- browser. fan_out_message_notifications() needs no grant: it runs only as
-- the AFTER INSERT trigger on messages, and Postgres never requires EXECUTE
-- on a trigger function for the triggering role (same reasoning as
-- enforce_connection_kinds() above).
revoke all on function public.claim_message_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_message_notifications(integer) to service_role;

revoke all on function public.settle_message_notification(bigint, text, text) from public, anon, authenticated;
grant execute on function public.settle_message_notification(bigint, text, text) to service_role;

revoke all on function public.delete_push_subscription_by_endpoint(text) from public, anon, authenticated;
grant execute on function public.delete_push_subscription_by_endpoint(text) to service_role;

-- ---------------------------------------------------------------------------
-- Reminders (Story 12.2: reminder delivery, AD-13)
-- ---------------------------------------------------------------------------
-- task_notifications (AC-8): unreachable from a browser. No grant at all for
-- anon/authenticated — belt-and-braces alongside the "no policy" RLS posture
-- (05_policies.sql): either layer alone already denies every client access,
-- so neither can regress silently on its own.
revoke all on table public.task_notifications from anon, authenticated;
grant all on table public.task_notifications to service_role;
revoke all on sequence public.task_notifications_id_seq from anon, authenticated;
grant all on sequence public.task_notifications_id_seq to service_role;

-- cron_heartbeat (AC-9): SELECT-only for every signed-in member — it holds
-- no tenant data, so no per-account narrowing is needed. No sequence: the
-- primary key is `worker text`, not an identity column. Every write is
-- service_role, through record_cron_heartbeat() alone.
revoke all on table public.cron_heartbeat from anon, authenticated;
grant select on table public.cron_heartbeat to authenticated;
grant all on table public.cron_heartbeat to service_role;

-- enqueue_due_task_notifications()/claim_due_task_notifications()/
-- settle_task_notification()/record_cron_heartbeat() (AC-1, AC-6, AC-7,
-- AC-9): service_role only — the cron Worker's entire interface to this
-- domain, never called from a browser.
revoke all on function public.enqueue_due_task_notifications(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.enqueue_due_task_notifications(timestamp with time zone) to service_role;

revoke all on function public.claim_due_task_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_task_notifications(integer) to service_role;

revoke all on function public.settle_task_notification(bigint, text, text) from public, anon, authenticated;
grant execute on function public.settle_task_notification(bigint, text, text) to service_role;

revoke all on function public.record_cron_heartbeat(text, text) from public, anon, authenticated;
grant execute on function public.record_cron_heartbeat(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Shadchan Context (Epic 8 Story 8.2: consent-based connection)
-- ---------------------------------------------------------------------------

-- connection_invites: SELECT-only for authenticated (scoped further by
-- 05_policies.sql's own select policy to the issuer's own rows) — no DML
-- grant at all, matching connections' own no-client-write posture (7.4).
-- Every write goes through this story's SECURITY DEFINER functions below.
revoke all on table public.connection_invites from anon, authenticated;
grant select on table public.connection_invites to authenticated;
grant all on table public.connection_invites to service_role;

-- No `authenticated` sequence grant — `authenticated` cannot insert into
-- connection_invites at all (no INSERT policy, no INSERT grant above),
-- mirrors connections_id_seq/threads_id_seq above.
revoke all on sequence public.connection_invites_id_seq from anon, authenticated;
grant all on sequence public.connection_invites_id_seq to service_role;

-- shadchanim.connection_id is set ONLY by accept_connection_invite()
-- (SECURITY DEFINER) — never client-writable. A bare table-level grant
-- would let a household self-link a shadchanim row to an arbitrary
-- `connections` id it can already READ (7.4's select policy lets either
-- party read a connection), forging a "connected" badge without ever going
-- through consent. Column-list grants, the same idiom this file already
-- uses for `interactions`/`accounts` above (`grant update (body, metadata,
-- deleted_at) on public.interactions`, `grant update (name,
-- transparency_level, data_region, default_thread_visibility) on
-- public.accounts`): revoke the table-level INSERT/UPDATE the earlier
-- "Shadchanim scoped to account" grant block issued, then re-grant on every
-- column except connection_id. `id`/`created_at` need no INSERT grant —
-- both have defaults, so omitting them from the column list is exactly
-- right, not an oversight.
revoke insert, update on table public.shadchanim from authenticated;
grant insert (account_id, name, name_he, location, contacts, responsiveness)
  on public.shadchanim to authenticated;
grant update (name, name_he, location, contacts, responsiveness)
  on public.shadchanim to authenticated;

-- The five consent-workflow functions (Task 3). `authenticated` only —
-- never `anon` (AD-1: the only anon-readable relation is Epic 9's future
-- `listings`). Accepting requires already being logged in with the
-- opposite-kind context active; there is no anonymous acceptance path in
-- this phase.
revoke all on function public.create_connection_invite() from public, anon;
grant execute on function public.create_connection_invite() to authenticated;
grant execute on function public.create_connection_invite() to service_role;

revoke all on function public.revoke_connection_invite(bigint) from public, anon;
grant execute on function public.revoke_connection_invite(bigint) to authenticated;
grant execute on function public.revoke_connection_invite(bigint) to service_role;

revoke all on function public.preview_connection_invite(text) from public, anon;
grant execute on function public.preview_connection_invite(text) to authenticated;
grant execute on function public.preview_connection_invite(text) to service_role;

revoke all on function public.accept_connection_invite(text) from public, anon;
grant execute on function public.accept_connection_invite(text) to authenticated;
grant execute on function public.accept_connection_invite(text) to service_role;

revoke all on function public.end_connection(bigint) from public, anon;
grant execute on function public.end_connection(bigint) to authenticated;
grant execute on function public.end_connection(bigint) to service_role;

-- Story 8.3 (Task 2): sending a redt requires an authenticated, connected
-- shadchan (AD-1) — never `anon`, matching every other cross-account
-- SECURITY DEFINER writer in this file.
revoke all on function public.redt_via_connection(bigint, text, text, jsonb) from public, anon;
grant execute on function public.redt_via_connection(bigint, text, text, jsonb) to authenticated;
grant execute on function public.redt_via_connection(bigint, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Listings & Sharing (Epic 9 Story 9.1: publish a shadchan listing)
-- ---------------------------------------------------------------------------

-- AC-8: `listings` is the sole anon-readable relation (AD-21) — `anon` gets
-- `select` and NOTHING else, ever. `authenticated` gets full DML; the
-- `shadchan`/`single` branch split is the policies' job (05_policies.sql),
-- not the grant's.
--
-- Review finding F1 (Story 9.1): `revoke all ... from anon` alone left
-- `authenticated` holding whatever the schema's own
-- `alter default privileges ... grant all on tables to authenticated`
-- attaches to every new table — REFERENCES, TRIGGER, and, critically,
-- TRUNCATE, which BYPASSES ROW LEVEL SECURITY exactly as the
-- "TRUNCATE/MAINTAIN hardening" block above documents for ~20 other tables.
-- `authenticated` must be named in the SAME `revoke all` as `anon`, matching
-- that block's own idiom, or a single `truncate table listings;` from any
-- signed-in session empties every shadchan's and single's listing across
-- every tenant at once.
--
-- Review finding F6 (Story 9.1): `anon`'s SELECT is an ENUMERATED column
-- list, not the whole table — the same reasoning, and the same mechanism,
-- as `shidduchim.close_reason` below (`grant select (...)`  because a
-- column-level REVOKE is a silent no-op once table-level SELECT is held).
-- `account_id`, `single_id` and `published_by_member_id` are internal
-- tenant/member identifiers, never opted-in listing content — FR101 promises
-- "name, area, how to reach", not a household's or single's own primary
-- key. Left off the anon grant, `?account_id=eq.N` / `?order=account_id.desc`
-- can never enumerate or link records; a client that wants "this listing's
-- id" already has it as `listings.id`. This has to be established on the
-- shadchan branch this story ships, not retrofitted once 9.2 adds `single`
-- rows, where the same `account_id` would otherwise let an anonymous caller
-- link two singles of the same household.
revoke all on table public.listings from anon, authenticated;
grant select (
    id,
    created_at,
    listing_type,
    shadchan_name,
    shadchan_area,
    shadchan_contact_info,
    single_first_name_en,
    single_first_name_he,
    single_age,
    single_height,
    single_community,
    single_location,
    single_summary
  ) on table public.listings to anon;
grant select, insert, update, delete on table public.listings to authenticated;
grant all on table public.listings to service_role;

-- The sequence must NEVER be reachable by `anon` — a sequence grant leaks no
-- row data, but AD-1 revokes all table/sequence grants from `anon`
-- unconditionally, and this table is the one place a slip here would sit
-- right next to the table it IS allowed to read.
--
-- Review finding F4 (Story 9.1): `db diff` never emits sequence grants
-- (AGENTS.md), and a `generated ... as identity` column's sequence does not
-- inherit the same default-privilege ACL a plain `create sequence` gets —
-- these three statements were declared here from the start but never made
-- it into the migration. Hand-added to the follow-up migration alongside the
-- F1/F6 grant fixes so the deployed database matches what this file
-- declares; functionally harmless either way (identity columns don't
-- consult the sequence ACL to generate a value, and `anon` already holds
-- nothing on it), but a schema file asserting state the database does not
-- have is exactly the kind of drift `db diff` cannot catch on its own.
revoke all on sequence public.listings_id_seq from anon;
grant usage, select on sequence public.listings_id_seq to authenticated;
grant all on sequence public.listings_id_seq to service_role;

-- Closing a narrower, PRE-EXISTING instance of the same AD-1 gap while this
-- file is open (found by the Epic 9 pre-flight, 2026-08-02): line 46 above
-- still runs `grant all on sequence public.members_id_seq to anon;` with no
-- revoke anywhere in this file — a fork-era leftover the Epic 2 AD-1 sweep
-- missed. (Line 50's `tasks_id_seq` grant to `anon` looks like a second
-- instance, but it is already revoked above, ahead of the
-- interactions/tasks grant block — by the time this file finishes applying,
-- `anon` holds nothing on `tasks_id_seq`, so `members_id_seq` is the only
-- one still actually exposed; it is not "fixed" a second time here.) This
-- is not Epic 9's own defect and predates `listings` entirely, but Epic 9 is
-- the first epic where `anon` becomes a live, reachable production role —
-- shipping the first public surface next to a known, named,
-- one-line-fixable `anon` leak is worse than closing it in passing. The
-- much larger, repo-wide FORCE ROW LEVEL SECURITY retrofit (epics.md's
-- Unowned-work item S2, ~33 pre-existing tables) is deliberately NOT folded
-- in here — different order of magnitude, different owner.
revoke all on sequence public.members_id_seq from anon;

-- ---------------------------------------------------------------------------
-- Listings & Sharing (Epic 9 Story 9.3: a single controls their own listing)
-- ---------------------------------------------------------------------------

-- AC-4: the absent DML grant IS the security boundary — `authenticated`
-- gets SELECT and NOTHING else, ever, on the lock table (`revoke all ...
-- from anon, authenticated` first, matching 9.1's own listings idiom above,
-- so the fork's `alter default privileges ... grant all on tables to
-- authenticated` never leaves a TRUNCATE/REFERENCES/TRIGGER leftover
-- behind either). No sequence to revoke: single_id is a plain bigint
-- primary key, not `generated ... as identity` (Task 1's own note — no
-- identity column, no sequence).
revoke all on table public.listing_withdrawal_locks from anon, authenticated;
grant select on table public.listing_withdrawal_locks to authenticated;
grant all on table public.listing_withdrawal_locks to service_role;

-- The sole remover of a lock row — `authenticated` only, matching every
-- other cross-account/elevated-privilege SECURITY DEFINER writer in this
-- file (create_connection_invite() etc. above). Never `anon`.
revoke all on function public.consent_to_republish_listing(bigint) from public, anon;
grant execute on function public.consent_to_republish_listing(bigint) to authenticated;
grant execute on function public.consent_to_republish_listing(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Listings & Sharing (Epic 9 Story 9.5: revocable share links)
-- ---------------------------------------------------------------------------

-- AC-10: `share_links`/`share_access_log` are NEVER anon-reachable via
-- PostgREST — no `grant ... to anon` line at all, on either table, ever.
-- The only path to this data for an unauthenticated caller is the `share/`
-- Worker using the service-role key (which bypasses RLS/grants entirely),
-- never a direct table or RPC grant to `anon` — this is what keeps AD-1's
-- "the only anon-readable relation is `listings`" true even though this
-- story adds two more tables that unauthenticated recipients effectively
-- read from. `revoke all ... from anon, authenticated` first, matching
-- 9.1/9.3's own idiom above, so the fork's `alter default privileges ...
-- grant all on tables to authenticated` never leaves a
-- TRUNCATE/REFERENCES/TRIGGER leftover behind on either table.
--
-- `authenticated` gets `select, insert` on `share_links` (creating and
-- listing their own links, narrowed by "Share links manager scoped") plus
-- a COLUMN-LEVEL `update (revoked_at)` — and NO table-level `update` grant
-- is ever issued, because a table-level grant would override the column
-- restriction and let any member rewrite `token`/`single_id`/
-- `include_photo`/`expires_at` (AC-2's "never client-chosen" must hold for
-- updates too, not merely inserts). No `delete` at all (Dev Notes "Does
-- revoking delete the log" — revocation is `update ... set revoked_at =
-- now()`, never a hard delete; there is no product path that ever needs
-- one).
revoke all on table public.share_links from anon, authenticated;
grant select, insert on table public.share_links to authenticated;
grant update (revoked_at) on table public.share_links to authenticated;
grant all on table public.share_links to service_role;

revoke all on sequence public.share_links_id_seq from anon;
grant usage, select on sequence public.share_links_id_seq to authenticated;
grant all on sequence public.share_links_id_seq to service_role;

-- `authenticated` gets `select` only (AC-8: the sharer sees who accessed
-- and when, narrowed through `share_links`' own RLS) — no
-- insert/update/delete grant at all. The ONLY writer of this table is the
-- `share/` Worker using the service-role key, which bypasses RLS/grants
-- entirely (AD-7); a client-issued write here would let a sharer forge
-- their own access history.
revoke all on table public.share_access_log from anon, authenticated;
grant select on table public.share_access_log to authenticated;
grant all on table public.share_access_log to service_role;

-- No `authenticated` sequence grant here (unlike `share_links_id_seq`
-- above) — `authenticated` never inserts into `share_access_log`, so
-- `usage` would be an ungranted-for-nothing privilege; only `anon` needs
-- the explicit revoke (belt-and-suspenders, matching this file's own
-- pattern of never leaving a sequence's default ACL unexamined) and
-- `service_role` needs `all` for the Worker's writes.
revoke all on sequence public.share_access_log_id_seq from anon;
grant all on sequence public.share_access_log_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Trusted senders (Epic 11, inbound email capture). Same shape as inbox_items
-- above — full CRUD within the caller's account (RLS-scoped): add a sender
-- (insert), remove one (delete). The `revoke all` strips TRUNCATE. anon is
-- denied everywhere.
revoke all on table public.trusted_senders from anon, authenticated;
grant select, insert, update, delete on table public.trusted_senders to authenticated;
grant all on table public.trusted_senders to service_role;

revoke all on sequence public.trusted_senders_id_seq from anon;
grant usage, select on sequence public.trusted_senders_id_seq to authenticated;
grant all on sequence public.trusted_senders_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Signup intents (open signup: carries the 18+ affirmation across a Google
-- OAuth redirect, which signInWithOAuth() cannot put in user_metadata).
-- `anon` gets INSERT only — never SELECT, so this table can never become an
-- oracle for which email addresses have attempted signup — and nothing else
-- touches it directly: check_signup_age() (02_functions.sql) reads, consumes
-- and sweeps it running as the table owner, not through a grant.
revoke all on table public.signup_intents from anon, authenticated;
grant insert on table public.signup_intents to anon;
grant all on table public.signup_intents to service_role;

-- Review finding F4 (Story 9.1)'s lesson applies here too: a `generated ...
-- as identity` column does not consult the sequence ACL to generate a
-- value, so `anon` needs no sequence grant to insert successfully — these
-- three statements are declared anyway for the same reason
-- `listings_id_seq`/`members_id_seq` are above: a schema file asserting
-- less than the database actually grants is exactly the drift `db diff`
-- cannot catch on its own.
revoke all on sequence public.signup_intents_id_seq from anon, authenticated;
grant all on sequence public.signup_intents_id_seq to service_role;

