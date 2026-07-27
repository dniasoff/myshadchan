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

create or replace trigger on_auth_user_updated
    after update on auth.users
    for each row execute function public.handle_update_user();

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

create or replace trigger set_shadchanim_account_id
    before insert on public.shadchanim
    for each row execute function public.set_account_id_default();

create or replace trigger set_references_account_id
    before insert on public."references"
    for each row execute function public.set_account_id_default();

create or replace trigger set_resumes_account_id
    before insert on public.resumes
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

create or replace trigger set_interactions_account_id
    before insert on public.interactions
    for each row execute function public.set_account_id_default();

create or replace trigger set_identity_signals_account_id
    before insert on public.identity_signals
    for each row execute function public.set_account_id_default();

create or replace trigger set_inbox_items_account_id
    before insert on public.inbox_items
    for each row execute function public.set_account_id_default();

-- =====================================================================
-- MyShadchan — Persona and context data model (Story 2.2)
-- =====================================================================

-- AC-3/AC-3a: a shadchanus-kind account can never hold a household domain
-- row, enforced BEFORE insert or update of account_id on all 13
-- household-only domain tables (AD-1) — the exact set that already carries a
-- set_<table>_account_id trigger above. Postgres fires same-event BEFORE
-- triggers in ALPHABETICAL trigger-name order, and the SPA never sends
-- account_id on insert (set_account_id_default() fills it in) — so these are
-- named `validate_<table>_household_scope`, deliberately sorting AFTER every
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

create or replace trigger validate_interactions_household_scope
    before insert or update of account_id on public.interactions
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_identity_signals_household_scope
    before insert or update of account_id on public.identity_signals
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_inbox_items_household_scope
    before insert or update of account_id on public.inbox_items
    for each row execute function public.enforce_household_scope();

create or replace trigger validate_tasks_household_scope
    before insert or update of account_id on public.tasks
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
