--
-- Triggers
-- This file declares all triggers.
--

-- Auto-populate sales_id from current auth user on insert
create or replace trigger set_task_sales_id_trigger
    before insert on public.tasks
    for each row execute function public.set_sales_id_default();

-- Auth triggers: sync auth.users to public.sales
create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace trigger on_auth_user_updated
    after update on auth.users
    for each row execute function public.handle_update_user();

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
create or replace trigger set_children_account_id
    before insert on public.children
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

-- Child portal tokens (E7): server-set account_id AND a forced CSPRNG token on
-- every insert, so the portal secret is never client-chosen. INSERT-only.
create or replace trigger set_child_portal_token_defaults
    before insert on public.child_portal_tokens
    for each row execute function public.set_child_portal_token_defaults();
