--
-- Triggers
-- This file declares all triggers.
--

-- Auto-populate member_id from current auth user on insert
create or replace trigger set_task_member_id_trigger
    before insert on public.tasks
    for each row execute function public.set_member_id_default();

-- Auth triggers: sync auth.users to public.members
create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Epic 2 verification finding F2: this trigger used to fire (and
-- handle_update_user() run) on EVERY auth.users UPDATE, including the
-- last_sign_in_at bump every email-OTP sign-in performs. Since a plain OTP
-- login carries no name fields in raw_user_meta_data, that unconditional
-- fire fell through handle_update_user()'s coalesce chain to 'Pending',
-- wiping a member's real name on every single login, including one they had
-- just set in Settings. The WHEN guard scopes the trigger to updates that
-- can actually change what handle_update_user() writes (name-bearing
-- metadata, or the email column it also syncs), so a metadata-inert login
-- no longer touches public.members at all.
create or replace trigger on_auth_user_updated
    after update on auth.users
    for each row
    when (
        old.raw_user_meta_data is distinct from new.raw_user_meta_data
        or old.email is distinct from new.email
    )
    execute function public.handle_update_user();

-- Auto-activates a user's first live context (AC-5, AD-19). Fires only when
-- the inserted membership is itself active; activate_first_context() does
-- the rest of the "already has a working active context" check itself.
create or replace trigger activate_first_context_trigger
    after insert on public.account_members
    for each row
    when (new.status = 'active')
    execute function public.activate_first_context();

-- Shidduchim: enforce the transition graph on every pipeline_state change
-- (AD-4 invariant 2) so no raw UPDATE can bypass transition_shidduch().
create or replace trigger enforce_shidduch_transition
    before update on public.shidduchim
    for each row execute function public.enforce_pipeline_transition();

-- Shidduchim: block creating a row straight into a decision state (AD-4
-- invariant 1 defense-in-depth) and server-set account_id on insert (AD-1).
create or replace trigger set_shidduchim_account_id
    before insert on public.shidduchim
    for each row execute function public.set_account_id_default();

create or replace trigger enforce_shidduch_initial_state
    before insert on public.shidduchim
    for each row execute function public.enforce_shidduch_initial_state();

-- Shidduchim domain: server-set account_id on insert (AD-1).
create or replace trigger set_singles_account_id
    before insert on public.singles
    for each row execute function public.set_account_id_default();

-- Story 16.1: server-set account_id on insert (AD-1), same shape as
-- set_singles_account_id above.
create or replace trigger set_single_preferences_account_id
    before insert on public.single_preferences
    for each row execute function public.set_account_id_default();

create or replace trigger set_shadchanim_account_id
    before insert on public.shadchanim
    for each row execute function public.set_account_id_default();

create or replace trigger set_references_account_id
    before insert on public."references"
    for each row execute function public.set_account_id_default();

create or replace trigger set_resumes_account_id
    before insert on public.resumes
    for each row execute function public.set_account_id_default();

-- Story 5.4: server-set account_id on insert (AD-1), same shape as
-- set_resumes_account_id above.
create or replace trigger set_resume_photos_account_id
    before insert on public.resume_photos
    for each row execute function public.set_account_id_default();

-- Story 5.5: server-set account_id on insert (AD-1), same shape as
-- set_resume_photos_account_id above.
create or replace trigger set_medical_notes_account_id
    before insert on public.medical_notes
    for each row execute function public.set_account_id_default();

create or replace trigger set_reference_links_account_id
    before insert on public.reference_links
    for each row execute function public.set_account_id_default();

create or replace trigger set_date_records_account_id
    before insert on public.date_records
    for each row execute function public.set_account_id_default();

create or replace trigger set_redts_account_id
    before insert on public.redts
    for each row execute function public.set_account_id_default();

create or replace trigger set_shidduch_schools_account_id
    before insert on public.shidduch_schools
    for each row execute function public.set_account_id_default();

-- Story 5.6: server-set account_id on insert (AD-1), same shape as
-- set_shidduch_schools_account_id above.
create or replace trigger set_shidduchim_external_links_account_id
    before insert on public.shidduchim_external_links
    for each row execute function public.set_account_id_default();

-- Keep shidduchim's denormalized redt summary (last date, latest/first shadchan)
-- in sync whenever the redt history changes.
create or replace trigger refresh_shidduch_redts
    after insert or update or delete on public.redts
    for each row execute function public.refresh_shidduch_redt_summary();

-- References epic: server-set match keys, shared identity signals, and the
-- polymorphic cascade. The SPA never normalizes and never writes match keys.
create or replace trigger set_reference_norms_trigger
    before insert or update on public."references"
    for each row execute function public.set_reference_norms();

create or replace trigger sync_reference_signals
    after insert or update on public."references"
    for each row execute function public.sync_reference_identity_signals();

create or replace trigger purge_reference_dependents
    before delete on public."references"
    for each row execute function public.purge_polymorphic_dependents('reference');

-- Story 3.5 (contract §8 rule 3): the same cascade, for the two target
-- types interactions.target_type widens to. purge_polymorphic_dependents()
-- itself is untouched — its TG_ARGV[0] design is exactly why one function
-- serves every polymorphic parent.
create or replace trigger purge_single_dependents
    before delete on public.singles
    for each row execute function public.purge_polymorphic_dependents('single');

create or replace trigger purge_shadchan_dependents
    before delete on public.shadchanim
    for each row execute function public.purge_polymorphic_dependents('shadchan');

-- Second caller of the shared identity service (AD-5).
create or replace trigger sync_shidduch_signals
    after insert or update on public.shidduchim
    for each row execute function public.sync_shidduch_identity_signals();

create or replace trigger purge_shidduch_dependents
    before delete on public.shidduchim
    for each row execute function public.purge_polymorphic_dependents('shidduch');

-- Polymorphic tasks (AD-13): account_id server-set on insert.
create or replace trigger set_tasks_account_id
    before insert on public.tasks
    for each row execute function public.set_account_id_default();

create or replace trigger sync_task_target_trigger
    before insert or update on public.tasks
    for each row execute function public.sync_task_target();

-- Story 12.3: an assignee must be an ACTIVE member of the task's own
-- account. `update of member_id, account_id` — never a bare `update`:
-- completing or snoozing a task whose assignee has since been archived
-- must keep working (AC-6). Named `validate_...` so it sorts AFTER every
-- `set_...`/`sync_...` trigger on this table ('v' > 's'), which is what
-- guarantees set_tasks_account_id has already filled new.account_id by
-- the time this reads it — read the alphabetical-trigger-ordering
-- rationale below (the `validate_*_household_scope` block's own comment,
-- "MyShadchan — Persona and context data model") before renaming this.
create or replace trigger validate_task_assignee
    before insert or update of member_id, account_id on public.tasks
    for each row execute function public.validate_task_assignee();

create or replace trigger set_interactions_account_id
    before insert on public.interactions
    for each row execute function public.set_account_id_default();

-- Story 3.5 (AC 4): server-sets actor_member_id, overwriting any
-- client-supplied value. The second BEFORE INSERT trigger on interactions;
-- ordering versus set_interactions_account_id above is irrelevant — neither
-- reads the other's output (current_member_id() resolves through
-- current_context_id(), not new.account_id). Named `set_interaction_…`
-- (singular), not `set_interactions_…`, per the contract's fixed symbol —
-- do not "correct" it to match the table-name convention.
create or replace trigger set_interaction_actor_member_id
    before insert on public.interactions
    for each row execute function public.set_interaction_actor_member_id();

create or replace trigger set_identity_signals_account_id
    before insert on public.identity_signals
    for each row execute function public.set_account_id_default();

create or replace trigger set_inbox_items_account_id
    before insert on public.inbox_items
    for each row execute function public.set_account_id_default();

-- Story 3.7 (AC 2f): entity_files is polymorphic (AD-13) but deliberately NOT
-- attached to enforce_household_scope() below — see that function's own
-- comment and AC 8(c)/(d) — so a shadchan can attach a file in their own
-- shadchanus context from day one (Epic 8.5).
create or replace trigger set_entity_files_account_id
    before insert on public.entity_files
    for each row execute function public.set_account_id_default();

-- Story 3.7 (AC 2f): server-sets uploaded_by_member_id ONLY when the client
-- did not already supply one — see set_entity_files_uploaded_by()'s own
-- comment (02_functions.sql) for why this is an if-null default rather than
-- set_interaction_actor_member_id()'s unconditional overwrite.
create or replace trigger set_entity_files_uploaded_by
    before insert on public.entity_files
    for each row execute function public.set_entity_files_uploaded_by();

-- =====================================================================
-- MyShadchan — Persona and context data model (Story 2.2)
-- =====================================================================

-- AC-3/AC-3a: a shadchanus-kind account can never hold a household domain
-- row, enforced BEFORE insert or update of account_id on 11 household-only
-- domain tables (AD-1). interactions and tasks used to be in this set too
-- (13 originally) but Story 3.14 dropped their validate_* triggers on the
-- project owner's ruling that a shadchanus context must be able to hold a
-- task and log an interaction (AD-2, "shadchan is active, not deny-only");
-- they still carry their own set_<table>_account_id trigger above, just no
-- longer a validate_* one. Postgres fires same-event BEFORE triggers in
-- ALPHABETICAL trigger-name order, and the SPA never sends account_id on
-- insert (set_account_id_default() fills it in) — so these are named
-- `validate_<table>_household_scope`, deliberately sorting AFTER every
-- `set_...`/`sync_...` trigger above ('v' > 's'). Renaming any of these is a
-- migration-time total insert outage, not a refactor: read
-- enforce_household_scope()'s comment (02_functions.sql) before touching a
-- single name here. subscription/ai_usage are deliberately NOT in this list
-- (AC-4 — see the `comment on table` in 01_tables.sql).
create or replace trigger validate_singles_household_scope
    before insert or update of account_id on public.singles
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_shadchanim_household_scope
    before insert or update of account_id on public.shadchanim
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_references_household_scope
    before insert or update of account_id on public."references"
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_shidduchim_household_scope
    before insert or update of account_id on public.shidduchim
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_resumes_household_scope
    before insert or update of account_id on public.resumes
    for each row execute function public.enforce_household_scope();

-- Story 5.4: a photo of the suggested person is household data with no
-- shadchanus meaning (unlike entity_files, which a shadchanus context must
-- be able to hold from day one — Epic 8.5). Bumps household_scope_lift.sql's
-- catalog-fact literal from 11 to 12 in the same diff.
create or replace trigger validate_resume_photos_household_scope
    before insert or update of account_id on public.resume_photos
    for each row execute function public.enforce_household_scope();

-- Story 5.5: a medical note is household data with no shadchanus meaning —
-- this story's whole point is that a shadchan has no path to it at all
-- (05_policies.sql). Named 'validate_...' so it sorts after
-- 'set_medical_notes_account_id' above (Postgres fires same-event BEFORE
-- triggers in alphabetical name order, 'v' > 's'). Bumps
-- household_scope_lift.sql's catalog-fact literal from 12 to 13 in the same
-- diff.
create or replace trigger validate_medical_notes_household_scope
    before insert or update of account_id on public.medical_notes
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_reference_links_household_scope
    before insert or update of account_id on public.reference_links
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_date_records_household_scope
    before insert or update of account_id on public.date_records
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_redts_household_scope
    before insert or update of account_id on public.redts
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_shidduch_schools_household_scope
    before insert or update of account_id on public.shidduch_schools
    for each row execute function public.enforce_household_scope();

-- Story 5.6: a shidduch is household-only, so its child table is too — no
-- exclusion applies (unlike entity_files, which a shadchanus context must
-- be able to hold from day one). Bumps household_scope_lift.sql's
-- catalog-fact literal from 13 to 14 in the same diff.
create or replace trigger validate_shidduchim_external_links_household_scope
    before insert or update of account_id on public.shidduchim_external_links
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_identity_signals_household_scope
    before insert or update of account_id on public.identity_signals
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_inbox_items_household_scope
    before insert or update of account_id on public.inbox_items
    for each row execute function public.enforce_household_scope();

-- AC-5: the mirror case on account_members itself — a shadchan-role
-- membership may only exist on a shadchanus-kind account, and every other
-- role only on a household-kind account. Fires on UPDATE too, so a role
-- CHANGE on an existing membership is checked, not just the initial insert.
-- No ordering hazard: account_members carries no other BEFORE trigger today
-- (activate_first_context_trigger above is AFTER INSERT).
create or replace trigger enforce_membership_role_matches_context_trigger
    before insert or update on public.account_members
    for each row execute function public.enforce_membership_role_matches_context();

-- =====================================================================
-- MyShadchan — Communication (Epic 7: threads)
-- =====================================================================

-- Story 7.1 (AC-5, AC-6): connections' one trigger. No ordering hazard: no
-- other BEFORE trigger exists on this table today, but named `validate_*`
-- (not `set_*`) so it would sort after one, per the alphabetical
-- BEFORE-trigger-order warning above.
create or replace trigger validate_connections_kinds
    before insert or update on public.connections
    for each row execute function public.enforce_connection_kinds();

-- Story 8.5 review fix (F2 — BLOCKING, contract §8 rule 3): see
-- purge_connection_dependents()'s own comment (02_functions.sql) for why
-- connections needs its own purge trigger, not a branch of
-- purge_polymorphic_dependents(). BEFORE DELETE, same firing point as every
-- other purge_* trigger in this file, so the dependent rows are gone before
-- the cascade removes the connections row itself.
create or replace trigger purge_connection_dependents_trigger
    before delete on public.connections
    for each row execute function public.purge_connection_dependents();

-- Story 7.1 (AC-1, AC-3, AC-7): server-set scope/creator on threads. No
-- ordering hazard: the only BEFORE INSERT trigger on this table.
create or replace trigger set_threads_defaults
    before insert on public.threads
    for each row execute function public.set_thread_defaults();

-- Story 7.1 (AC-2, AC-5): copies both scope columns from the parent thread.
-- No ordering hazard: the only BEFORE INSERT trigger on this table.
create or replace trigger set_thread_participants_defaults
    before insert on public.thread_participants
    for each row execute function public.set_thread_participant_defaults();

-- Story 7.1 (AC-4, AC-5): same parent-copy shape, plus server-stamps
-- sender_member_id. No ordering hazard: the only BEFORE INSERT trigger on
-- this table.
create or replace trigger set_messages_defaults
    before insert on public.messages
    for each row execute function public.set_message_defaults();

-- Story 7.5 (AC-3, AC-4, AC-5, AC-6, AC-7, AC-8): fans a new message out into
-- message_notifications. AFTER INSERT, a different firing event from
-- set_messages_defaults' BEFORE INSERT above, so there is no ordering
-- interaction between the two triggers on this table.
create or replace trigger fan_out_message_notifications_trigger
    after insert on public.messages
    for each row execute function public.fan_out_message_notifications();

-- Story 7.1 (AC-10): NO new trigger for the polymorphic cascade —
-- purge_polymorphic_dependents() (02_functions.sql) is already attached to
-- public.shidduchim as purge_shidduch_dependents above, and this story
-- extends that shared function with a fifth delete (threads, both scope
-- axes) rather than duplicating the wiring.

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.1: publish a shadchan
-- listing)
-- =====================================================================

-- Server-set account_id on insert (AD-1) — the same reusable
-- set_account_id_default() every other shidduchim-domain table's own
-- set_<table>_account_id trigger calls above, not a new per-table function.
create or replace trigger set_listings_account_id
    before insert on public.listings
    for each row execute function public.set_account_id_default();

-- Story 9.3 (AC-2, AC-3, AC-6, AC-7): the withdrawal-lock trigger — the
-- sole creator of a public.listing_withdrawal_locks row (02_functions.sql).
-- AFTER DELETE, not BEFORE: the row must actually be gone before deciding
-- whether to lock republication of it, and OLD is all this trigger ever
-- needs (it never touches NEW). SECURITY DEFINER (the function's own
-- attribute) lets it write a table `authenticated` holds no DML grant on
-- at all.
create or replace trigger lock_listing_on_single_withdrawal
    after delete on public.listings
    for each row execute function public.lock_listing_on_single_withdrawal();

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.5: revocable share links)
-- =====================================================================

-- AC-2: the CSPRNG token trigger — INSERT only, never re-run on update, so
-- revoking a link (an UPDATE) never rotates its token.
create or replace trigger set_share_link_token_defaults
    before insert on public.share_links
    for each row execute function public.set_share_link_token_defaults();

-- AC-6: revocation is one-way — a revoked link can never be un-revoked by
-- any subsequent update, client-issued or otherwise.
create or replace trigger enforce_share_link_revoke_once
    before update on public.share_links
    for each row execute function public.enforce_share_link_revoke_once();

-- =====================================================================
-- MyShadchan — Inbound Email Capture (Epic 11)
-- =====================================================================

-- Every future household account gets its own private inbound address at
-- birth. No ordering hazard: no other BEFORE trigger exists on
-- public.accounts today.
create or replace trigger set_account_inbound_email_token_default
    before insert on public.accounts
    for each row execute function public.set_account_inbound_email_token_default();

-- Household-only domain data (AD-1), same shape as every other
-- `validate_<table>_household_scope` trigger in this file — a
-- shadchanus-kind account can never hold a trusted-sender row. Bumps
-- household_scope_lift.sql's catalog-fact literal from 14 to 15 in the same
-- diff.
create or replace trigger validate_trusted_senders_household_scope
    before insert or update of account_id on public.trusted_senders
    for each row execute function public.enforce_household_scope();
