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

-- current_account_demo() is SECURITY DEFINER, so anon must never execute it.
revoke all on function public.current_account_demo() from public, anon;
grant execute on function public.current_account_demo() to authenticated;
grant execute on function public.current_account_demo() to service_role;

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

-- Aggregate read paths (E5/E6). Both group several rows per key, so they are
-- not auto-updatable and only SELECT is meaningful for authenticated.
revoke all on table public.children_summary from anon, authenticated;
grant select on table public.children_summary to authenticated;
grant all on table public.children_summary to service_role;

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

revoke all on table public.account_members from anon, authenticated;
grant select, insert, update, delete on table public.account_members to authenticated;

revoke all on table public.children from anon, authenticated;
grant select, insert, update, delete on table public.children to authenticated;

revoke all on table public.shadchanim from anon, authenticated;
grant select, insert, update, delete on table public.shadchanim to authenticated;

revoke all on table public."references" from anon, authenticated;
grant select, insert, update, delete on table public."references" to authenticated;

revoke all on table public.shidduchim from anon, authenticated;
grant select, insert, update, delete on table public.shidduchim to authenticated;

revoke all on table public.resumes from anon, authenticated;
grant select, insert, update, delete on table public.resumes to authenticated;

revoke all on table public.reference_links from anon, authenticated;
grant select, insert, update, delete on table public.reference_links to authenticated;

revoke all on table public.date_records from anon, authenticated;
grant select, insert, update, delete on table public.date_records to authenticated;

revoke all on table public.redts from anon, authenticated;
grant select, insert, update, delete on table public.redts to authenticated;

revoke all on table public.shidduch_schools from anon, authenticated;
grant select, insert, update, delete on table public.shidduch_schools to authenticated;

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
-- a note SAYS stays allowed; moving where it HANGS does not.
revoke update on table public.interactions from authenticated;
grant update (body, metadata) on table public.interactions to authenticated;

revoke all on function public.rehome_reference_link_interactions(bigint, bigint) from public, anon;
grant execute on function public.rehome_reference_link_interactions(bigint, bigint) to authenticated;
grant execute on function public.rehome_reference_link_interactions(bigint, bigint) to service_role;

revoke all on function public.rehome_reference_interactions(bigint, bigint) from public, anon;
grant execute on function public.rehome_reference_interactions(bigint, bigint) to authenticated;
grant execute on function public.rehome_reference_interactions(bigint, bigint) to service_role;

