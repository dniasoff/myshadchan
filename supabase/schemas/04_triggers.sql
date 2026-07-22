--
-- Triggers
-- This file declares all triggers.
--

-- Auto-populate sales_id from current auth user on insert
create or replace trigger set_company_sales_id_trigger
    before insert on public.companies
    for each row execute function public.set_sales_id_default();

create or replace trigger set_contact_sales_id_trigger
    before insert on public.contacts
    for each row execute function public.set_sales_id_default();

create or replace trigger set_contact_notes_sales_id_trigger
    before insert on public.contact_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_sales_id_trigger
    before insert on public.deals
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_notes_sales_id_trigger
    before insert on public.deal_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_task_sales_id_trigger
    before insert on public.tasks
    for each row execute function public.set_sales_id_default();

-- Auto-fetch company logo from website favicon on save
create or replace trigger company_saved
    before insert or update on public.companies
    for each row execute function public.handle_company_saved();

-- Lowercase contact emails before insert or update (must run before contact_saved)
create or replace trigger "10_lowercase_contact_emails"
    before insert or update on public.contacts
    for each row execute function public.lowercase_email_jsonb();

-- Auto-fetch contact avatar from email on save (runs after lowercase_contact_emails)
create or replace trigger "20_contact_saved"
    before insert or update on public.contacts
    for each row execute function public.handle_contact_saved();

-- Update contact.last_seen when a contact note is created
create or replace trigger on_public_contact_notes_created_or_updated
    after insert on public.contact_notes
    for each row execute function public.handle_contact_note_created_or_updated();

-- Cleanup storage attachments when contact notes are updated or deleted
create or replace trigger on_contact_notes_attachments_updated_delete_note_attachments
    after update on public.contact_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_contact_notes_deleted_delete_note_attachments
    after delete on public.contact_notes
    for each row execute function public.cleanup_note_attachments();

-- Cleanup storage attachments when deal notes are updated or deleted
create or replace trigger on_deal_notes_attachments_updated_delete_note_attachments
    after update on public.deal_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_deal_notes_deleted_delete_note_attachments
    after delete on public.deal_notes
    for each row execute function public.cleanup_note_attachments();

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
