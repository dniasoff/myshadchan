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
grant all on function public.cleanup_note_attachments() to anon;
grant all on function public.cleanup_note_attachments() to authenticated;
grant all on function public.cleanup_note_attachments() to service_role;

grant all on function public.get_avatar_for_email(text) to anon;
grant all on function public.get_avatar_for_email(text) to authenticated;
grant all on function public.get_avatar_for_email(text) to service_role;

grant all on function public.get_domain_favicon(text) to anon;
grant all on function public.get_domain_favicon(text) to authenticated;
grant all on function public.get_domain_favicon(text) to service_role;

grant all on function public.get_note_attachments_function_url() to anon;
grant all on function public.get_note_attachments_function_url() to authenticated;
grant all on function public.get_note_attachments_function_url() to service_role;

revoke all on function public.get_user_id_by_email(text) from public;
grant all on function public.get_user_id_by_email(text) to service_role;

grant all on function public.handle_company_saved() to anon;
grant all on function public.handle_company_saved() to authenticated;
grant all on function public.handle_company_saved() to service_role;

grant all on function public.handle_contact_note_created_or_updated() to anon;
grant all on function public.handle_contact_note_created_or_updated() to authenticated;
grant all on function public.handle_contact_note_created_or_updated() to service_role;

grant all on function public.handle_contact_saved() to anon;
grant all on function public.handle_contact_saved() to authenticated;
grant all on function public.handle_contact_saved() to service_role;

grant all on function public.handle_new_user() to anon;
grant all on function public.handle_new_user() to authenticated;
grant all on function public.handle_new_user() to service_role;

grant all on function public.handle_update_user() to anon;
grant all on function public.handle_update_user() to authenticated;
grant all on function public.handle_update_user() to service_role;

grant all on function public.is_admin() to anon;
grant all on function public.is_admin() to authenticated;
grant all on function public.is_admin() to service_role;

grant all on function public.lowercase_email_jsonb() to anon;
grant all on function public.lowercase_email_jsonb() to authenticated;
grant all on function public.lowercase_email_jsonb() to service_role;

grant all on function public.merge_contacts(bigint, bigint) to anon;
grant all on function public.merge_contacts(bigint, bigint) to authenticated;
grant all on function public.merge_contacts(bigint, bigint) to service_role;

grant all on function public.set_sales_id_default() to anon;
grant all on function public.set_sales_id_default() to authenticated;
grant all on function public.set_sales_id_default() to service_role;

-- Table grants
--
-- The API roles reach base tables only as `authenticated` / `service_role`;
-- `anon` is never granted DML on them (it keeps only the REFERENCES / TRIGGER /
-- TRUNCATE privileges Postgres attaches at table creation). Views that must be
-- readable before sign-in (init_state and friends) are granted separately below.
grant all on table public.companies to authenticated;
grant all on table public.companies to service_role;

grant all on table public.contacts to authenticated;
grant all on table public.contacts to service_role;

grant all on table public.contact_notes to authenticated;
grant all on table public.contact_notes to service_role;

grant all on table public.deals to authenticated;
grant all on table public.deals to service_role;

grant all on table public.deal_notes to authenticated;
grant all on table public.deal_notes to service_role;

grant all on table public.sales to authenticated;
grant all on table public.sales to service_role;

grant all on table public.tags to authenticated;
grant all on table public.tags to service_role;

grant all on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

-- App configuration is read by every signed-in user and written by admins only
-- (enforced by RLS); nothing deletes it, so DELETE is deliberately not granted.
grant select, insert, update on table public.configuration to authenticated;
grant select, insert, update on table public.configuration to service_role;

grant all on table public.favicons_excluded_domains to authenticated;
grant all on table public.favicons_excluded_domains to service_role;

-- View grants
grant all on table public.activity_log to anon;
grant all on table public.activity_log to authenticated;
grant all on table public.activity_log to service_role;

grant all on table public.companies_summary to anon;
grant all on table public.companies_summary to authenticated;
grant all on table public.companies_summary to service_role;

grant all on table public.contacts_summary to anon;
grant all on table public.contacts_summary to authenticated;
grant all on table public.contacts_summary to service_role;

grant all on table public.init_state to anon;
grant all on table public.init_state to authenticated;
grant all on table public.init_state to service_role;

-- Sequence grants
grant all on sequence public.companies_id_seq to anon;
grant all on sequence public.companies_id_seq to authenticated;
grant all on sequence public.companies_id_seq to service_role;

grant all on sequence public."contactNotes_id_seq" to anon;
grant all on sequence public."contactNotes_id_seq" to authenticated;
grant all on sequence public."contactNotes_id_seq" to service_role;

grant all on sequence public.contacts_id_seq to anon;
grant all on sequence public.contacts_id_seq to authenticated;
grant all on sequence public.contacts_id_seq to service_role;

grant all on sequence public."dealNotes_id_seq" to anon;
grant all on sequence public."dealNotes_id_seq" to authenticated;
grant all on sequence public."dealNotes_id_seq" to service_role;

grant all on sequence public.deals_id_seq to anon;
grant all on sequence public.deals_id_seq to authenticated;
grant all on sequence public.deals_id_seq to service_role;

grant all on sequence public.favicons_excluded_domains_id_seq to anon;
grant all on sequence public.favicons_excluded_domains_id_seq to authenticated;
grant all on sequence public.favicons_excluded_domains_id_seq to service_role;

grant all on sequence public.sales_id_seq to anon;
grant all on sequence public.sales_id_seq to authenticated;
grant all on sequence public.sales_id_seq to service_role;

grant all on sequence public.tags_id_seq to anon;
grant all on sequence public.tags_id_seq to authenticated;
grant all on sequence public.tags_id_seq to service_role;

grant all on sequence public.tasks_id_seq to anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

-- Default privileges
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public grant all on functions to anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

--
-- =====================================================================
-- MyShadchan — Shidduchim pipeline grants (AD-1, F6)
-- =====================================================================
-- The fork's default privileges above auto-grant ALL on every new table to
-- `anon`. Each shidduchim-domain object is therefore EXPLICITLY revoked from
-- anon and granted only to authenticated + service_role. (Full revocation of
-- the anon default-privilege itself is Epic-1 / F6 and deferred; this build
-- must not silently inherit anon on its own tables.)

-- Table grants
revoke all on table public.accounts from anon;
grant all on table public.accounts to authenticated;
grant all on table public.accounts to service_role;

revoke all on table public.account_members from anon;
grant all on table public.account_members to authenticated;
grant all on table public.account_members to service_role;

revoke all on table public.children from anon;
grant all on table public.children to authenticated;
grant all on table public.children to service_role;

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

revoke all on table public.pipeline_transitions from anon;
grant select on table public.pipeline_transitions to authenticated;
grant all on table public.pipeline_transitions to service_role;

-- View grant (summary read path)
revoke all on table public.shidduchim_summary from anon;
grant all on table public.shidduchim_summary to authenticated;
grant all on table public.shidduchim_summary to service_role;

-- Sequence grants
revoke all on sequence public.accounts_id_seq from anon;
grant all on sequence public.accounts_id_seq to authenticated;
grant all on sequence public.accounts_id_seq to service_role;

revoke all on sequence public.account_members_id_seq from anon;
grant all on sequence public.account_members_id_seq to authenticated;
grant all on sequence public.account_members_id_seq to service_role;

revoke all on sequence public.children_id_seq from anon;
grant all on sequence public.children_id_seq to authenticated;
grant all on sequence public.children_id_seq to service_role;

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

-- Function grants (execute for authenticated + service_role, never anon).
-- current_account_id() is SECURITY DEFINER, so anon must never execute it.
revoke all on function public.current_account_id() from public, anon;
grant execute on function public.current_account_id() to authenticated;
grant execute on function public.current_account_id() to service_role;

revoke all on function public.is_child_visible_state(public.pipeline_state) from public, anon;
grant execute on function public.is_child_visible_state(public.pipeline_state) to authenticated;
grant execute on function public.is_child_visible_state(public.pipeline_state) to service_role;

revoke all on function public.enforce_pipeline_transition() from public, anon;
grant execute on function public.enforce_pipeline_transition() to authenticated;
grant execute on function public.enforce_pipeline_transition() to service_role;

revoke all on function public.set_account_id_default() from public, anon;
grant execute on function public.set_account_id_default() to authenticated;
grant execute on function public.set_account_id_default() to service_role;

revoke all on function public.enforce_shidduch_initial_state() from public, anon;
grant execute on function public.enforce_shidduch_initial_state() to authenticated;
grant execute on function public.enforce_shidduch_initial_state() to service_role;

revoke all on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) from public, anon;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to authenticated;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to service_role;

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
