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

-- Story 2.7 (AC-5): check_signup_invite() backs the before_user_created Auth
-- Hook — GoTrue invokes it as `supabase_auth_admin`, never `anon` or
-- `authenticated` directly.
revoke all on function public.check_signup_invite(jsonb) from public, anon, authenticated;
grant execute on function public.check_signup_invite(jsonb) to supabase_auth_admin;

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
-- `interactions` above. Today the client updates only `name` (login/
-- FirstRunSetup.tsx); transparency_level/data_region are the account-config
-- columns a settings screen would edit. `demo` is deliberately omitted: it is
-- server-owned, written only by the seed_demo/clear_demo edge functions via
-- the service_role client, which bypasses these grants. id/created_at are
-- immutable. The five billing columns are thus unreachable by any client.
--
-- anon already has ALL privileges revoked on accounts (above), so it holds no
-- UPDATE to narrow.
revoke update on table public.accounts from authenticated;
grant update (name, transparency_level, data_region) on public.accounts to authenticated;

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

-- ai_entitlement() is the single server-authoritative entitlement decision,
-- called by the SPA and (future) AI edge functions alike. anon must never run
-- it; authenticated and service_role may.
revoke all on function public.ai_entitlement() from public, anon;
grant execute on function public.ai_entitlement() to authenticated;
grant execute on function public.ai_entitlement() to service_role;

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

-- threads/thread_participants/messages: `authenticated` gets SELECT and
-- INSERT only — no UPDATE, no DELETE, matching the RLS policies above
-- everywhere (messages are append-only, AC-4; a thread/participant row is
-- never edited or removed by a client). The `revoke all` strips the
-- TRUNCATE/REFERENCES/TRIGGER grant Postgres's default privileges hand
-- `authenticated` on every new table `postgres` creates (verified on the
-- local stack) — TRUNCATE bypasses RLS, so leaving it ungranted is not
-- optional.
revoke all on table public.threads from anon, authenticated;
grant select, insert on table public.threads to authenticated;
grant all on table public.threads to service_role;

revoke all on table public.thread_participants from anon, authenticated;
grant select, insert on table public.thread_participants to authenticated;
grant all on table public.thread_participants to service_role;

revoke all on table public.messages from anon, authenticated;
grant select, insert on table public.messages to authenticated;
grant all on table public.messages to service_role;

-- authenticated inserts its own threads/participants/messages, so it needs
-- these three identity sequences (unlike connections' sequence above).
revoke all on sequence public.threads_id_seq from anon;
grant usage, select on sequence public.threads_id_seq to authenticated;
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

revoke all on function public.create_thread(text, bigint, bigint[], text) from public, anon;
grant execute on function public.create_thread(text, bigint, bigint[], text) to authenticated;
grant execute on function public.create_thread(text, bigint, bigint[], text) to service_role;

