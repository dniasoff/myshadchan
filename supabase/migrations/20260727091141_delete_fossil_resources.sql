drop trigger if exists "company_saved" on "public"."companies";

drop trigger if exists "set_company_sales_id_trigger" on "public"."companies";

drop trigger if exists "on_contact_notes_attachments_updated_delete_note_attachments" on "public"."contact_notes";

drop trigger if exists "on_contact_notes_deleted_delete_note_attachments" on "public"."contact_notes";

drop trigger if exists "on_public_contact_notes_created_or_updated" on "public"."contact_notes";

drop trigger if exists "set_contact_notes_sales_id_trigger" on "public"."contact_notes";

drop trigger if exists "10_lowercase_contact_emails" on "public"."contacts";

drop trigger if exists "20_contact_saved" on "public"."contacts";

drop trigger if exists "set_contact_sales_id_trigger" on "public"."contacts";

drop trigger if exists "on_deal_notes_attachments_updated_delete_note_attachments" on "public"."deal_notes";

drop trigger if exists "on_deal_notes_deleted_delete_note_attachments" on "public"."deal_notes";

drop trigger if exists "set_deal_notes_sales_id_trigger" on "public"."deal_notes";

drop trigger if exists "set_deal_sales_id_trigger" on "public"."deals";

drop policy "Company Delete Policy" on "public"."companies";

drop policy "Enable insert for authenticated users only" on "public"."companies";

drop policy "Enable read access for authenticated users" on "public"."companies";

drop policy "Enable update for authenticated users only" on "public"."companies";

drop policy "Contact Notes Delete Policy" on "public"."contact_notes";

drop policy "Contact Notes Update policy" on "public"."contact_notes";

drop policy "Enable insert for authenticated users only" on "public"."contact_notes";

drop policy "Enable read access for authenticated users" on "public"."contact_notes";

drop policy "Contact Delete Policy" on "public"."contacts";

drop policy "Enable insert for authenticated users only" on "public"."contacts";

drop policy "Enable read access for authenticated users" on "public"."contacts";

drop policy "Enable update for authenticated users only" on "public"."contacts";

drop policy "Deal Notes Delete Policy" on "public"."deal_notes";

drop policy "Deal Notes Update Policy" on "public"."deal_notes";

drop policy "Enable insert for authenticated users only" on "public"."deal_notes";

drop policy "Enable read access for authenticated users" on "public"."deal_notes";

drop policy "Deals Delete Policy" on "public"."deals";

drop policy "Enable insert for authenticated users only" on "public"."deals";

drop policy "Enable read access for authenticated users" on "public"."deals";

drop policy "Enable update for authenticated users only" on "public"."deals";

drop policy "Enable access for authenticated users only" on "public"."favicons_excluded_domains";

drop policy "Enable delete for authenticated users only" on "public"."tags";

drop policy "Enable insert for authenticated users only" on "public"."tags";

drop policy "Enable read access for authenticated users" on "public"."tags";

drop policy "Enable update for authenticated users only" on "public"."tags";

revoke references on table "public"."companies" from "anon";

revoke trigger on table "public"."companies" from "anon";

revoke truncate on table "public"."companies" from "anon";

revoke delete on table "public"."companies" from "authenticated";

revoke insert on table "public"."companies" from "authenticated";

revoke references on table "public"."companies" from "authenticated";

revoke select on table "public"."companies" from "authenticated";

revoke trigger on table "public"."companies" from "authenticated";

revoke truncate on table "public"."companies" from "authenticated";

revoke update on table "public"."companies" from "authenticated";

revoke delete on table "public"."companies" from "service_role";

revoke insert on table "public"."companies" from "service_role";

revoke references on table "public"."companies" from "service_role";

revoke select on table "public"."companies" from "service_role";

revoke trigger on table "public"."companies" from "service_role";

revoke truncate on table "public"."companies" from "service_role";

revoke update on table "public"."companies" from "service_role";

revoke references on table "public"."contact_notes" from "anon";

revoke trigger on table "public"."contact_notes" from "anon";

revoke truncate on table "public"."contact_notes" from "anon";

revoke delete on table "public"."contact_notes" from "authenticated";

revoke insert on table "public"."contact_notes" from "authenticated";

revoke references on table "public"."contact_notes" from "authenticated";

revoke select on table "public"."contact_notes" from "authenticated";

revoke trigger on table "public"."contact_notes" from "authenticated";

revoke truncate on table "public"."contact_notes" from "authenticated";

revoke update on table "public"."contact_notes" from "authenticated";

revoke delete on table "public"."contact_notes" from "service_role";

revoke insert on table "public"."contact_notes" from "service_role";

revoke references on table "public"."contact_notes" from "service_role";

revoke select on table "public"."contact_notes" from "service_role";

revoke trigger on table "public"."contact_notes" from "service_role";

revoke truncate on table "public"."contact_notes" from "service_role";

revoke update on table "public"."contact_notes" from "service_role";

revoke references on table "public"."contacts" from "anon";

revoke trigger on table "public"."contacts" from "anon";

revoke truncate on table "public"."contacts" from "anon";

revoke delete on table "public"."contacts" from "authenticated";

revoke insert on table "public"."contacts" from "authenticated";

revoke references on table "public"."contacts" from "authenticated";

revoke select on table "public"."contacts" from "authenticated";

revoke trigger on table "public"."contacts" from "authenticated";

revoke truncate on table "public"."contacts" from "authenticated";

revoke update on table "public"."contacts" from "authenticated";

revoke delete on table "public"."contacts" from "service_role";

revoke insert on table "public"."contacts" from "service_role";

revoke references on table "public"."contacts" from "service_role";

revoke select on table "public"."contacts" from "service_role";

revoke trigger on table "public"."contacts" from "service_role";

revoke truncate on table "public"."contacts" from "service_role";

revoke update on table "public"."contacts" from "service_role";

revoke references on table "public"."deal_notes" from "anon";

revoke trigger on table "public"."deal_notes" from "anon";

revoke truncate on table "public"."deal_notes" from "anon";

revoke delete on table "public"."deal_notes" from "authenticated";

revoke insert on table "public"."deal_notes" from "authenticated";

revoke references on table "public"."deal_notes" from "authenticated";

revoke select on table "public"."deal_notes" from "authenticated";

revoke trigger on table "public"."deal_notes" from "authenticated";

revoke truncate on table "public"."deal_notes" from "authenticated";

revoke update on table "public"."deal_notes" from "authenticated";

revoke delete on table "public"."deal_notes" from "service_role";

revoke insert on table "public"."deal_notes" from "service_role";

revoke references on table "public"."deal_notes" from "service_role";

revoke select on table "public"."deal_notes" from "service_role";

revoke trigger on table "public"."deal_notes" from "service_role";

revoke truncate on table "public"."deal_notes" from "service_role";

revoke update on table "public"."deal_notes" from "service_role";

revoke references on table "public"."deals" from "anon";

revoke trigger on table "public"."deals" from "anon";

revoke truncate on table "public"."deals" from "anon";

revoke delete on table "public"."deals" from "authenticated";

revoke insert on table "public"."deals" from "authenticated";

revoke references on table "public"."deals" from "authenticated";

revoke select on table "public"."deals" from "authenticated";

revoke trigger on table "public"."deals" from "authenticated";

revoke truncate on table "public"."deals" from "authenticated";

revoke update on table "public"."deals" from "authenticated";

revoke delete on table "public"."deals" from "service_role";

revoke insert on table "public"."deals" from "service_role";

revoke references on table "public"."deals" from "service_role";

revoke select on table "public"."deals" from "service_role";

revoke trigger on table "public"."deals" from "service_role";

revoke truncate on table "public"."deals" from "service_role";

revoke update on table "public"."deals" from "service_role";

revoke references on table "public"."favicons_excluded_domains" from "anon";

revoke trigger on table "public"."favicons_excluded_domains" from "anon";

revoke truncate on table "public"."favicons_excluded_domains" from "anon";

revoke delete on table "public"."favicons_excluded_domains" from "authenticated";

revoke insert on table "public"."favicons_excluded_domains" from "authenticated";

revoke references on table "public"."favicons_excluded_domains" from "authenticated";

revoke select on table "public"."favicons_excluded_domains" from "authenticated";

revoke trigger on table "public"."favicons_excluded_domains" from "authenticated";

revoke truncate on table "public"."favicons_excluded_domains" from "authenticated";

revoke update on table "public"."favicons_excluded_domains" from "authenticated";

revoke delete on table "public"."favicons_excluded_domains" from "service_role";

revoke insert on table "public"."favicons_excluded_domains" from "service_role";

revoke references on table "public"."favicons_excluded_domains" from "service_role";

revoke select on table "public"."favicons_excluded_domains" from "service_role";

revoke trigger on table "public"."favicons_excluded_domains" from "service_role";

revoke truncate on table "public"."favicons_excluded_domains" from "service_role";

revoke update on table "public"."favicons_excluded_domains" from "service_role";

revoke references on table "public"."tags" from "anon";

revoke trigger on table "public"."tags" from "anon";

revoke truncate on table "public"."tags" from "anon";

revoke delete on table "public"."tags" from "authenticated";

revoke insert on table "public"."tags" from "authenticated";

revoke references on table "public"."tags" from "authenticated";

revoke select on table "public"."tags" from "authenticated";

revoke trigger on table "public"."tags" from "authenticated";

revoke truncate on table "public"."tags" from "authenticated";

revoke update on table "public"."tags" from "authenticated";

revoke delete on table "public"."tags" from "service_role";

revoke insert on table "public"."tags" from "service_role";

revoke references on table "public"."tags" from "service_role";

revoke select on table "public"."tags" from "service_role";

revoke trigger on table "public"."tags" from "service_role";

revoke truncate on table "public"."tags" from "service_role";

revoke update on table "public"."tags" from "service_role";

alter table "public"."companies" drop constraint "companies_sales_id_fkey";

alter table "public"."contact_notes" drop constraint "contactNotes_contact_id_fkey";

alter table "public"."contact_notes" drop constraint "contactNotes_sales_id_fkey";

alter table "public"."contacts" drop constraint "contacts_company_id_fkey";

alter table "public"."contacts" drop constraint "contacts_sales_id_fkey";

alter table "public"."deal_notes" drop constraint "dealNotes_deal_id_fkey";

alter table "public"."deal_notes" drop constraint "dealNotes_sales_id_fkey";

alter table "public"."deals" drop constraint "deals_company_id_fkey";

alter table "public"."deals" drop constraint "deals_sales_id_fkey";

alter table "public"."tasks" drop constraint "tasks_contact_id_fkey";

alter table "public"."tasks" drop constraint "tasks_target_type_check";

drop view if exists "public"."activity_log";

drop function if exists "public"."cleanup_note_attachments"();

drop view if exists "public"."companies_summary";

drop view if exists "public"."contacts_summary";

drop function if exists "public"."get_avatar_for_email"(email text);

drop function if exists "public"."get_domain_favicon"(domain_name text);

drop function if exists "public"."get_note_attachments_function_url"();

drop function if exists "public"."handle_company_saved"();

drop function if exists "public"."handle_contact_note_created_or_updated"();

drop function if exists "public"."handle_contact_saved"();

drop function if exists "public"."lowercase_email_jsonb"();

drop function if exists "public"."merge_contacts"(loser_id bigint, winner_id bigint);

drop view if exists "public"."references_summary";

alter table "public"."companies" drop constraint "companies_pkey";

alter table "public"."contact_notes" drop constraint "contactNotes_pkey";

alter table "public"."contacts" drop constraint "contacts_pkey";

alter table "public"."deal_notes" drop constraint "dealNotes_pkey";

alter table "public"."deals" drop constraint "deals_pkey";

alter table "public"."favicons_excluded_domains" drop constraint "favicons_excluded_domains_pkey";

alter table "public"."tags" drop constraint "tags_pkey";

drop index if exists "public"."companies_pkey";

drop index if exists "public"."contactNotes_pkey";

drop index if exists "public"."contact_notes_contact_id_idx";

drop index if exists "public"."contacts_company_id_idx";

drop index if exists "public"."contacts_pkey";

drop index if exists "public"."dealNotes_pkey";

drop index if exists "public"."deal_notes_deal_id_idx";

drop index if exists "public"."deals_company_id_idx";

drop index if exists "public"."deals_pkey";

drop index if exists "public"."favicons_excluded_domains_pkey";

drop index if exists "public"."tags_pkey";

drop table "public"."companies";

drop table "public"."contact_notes";

drop table "public"."contacts";

drop table "public"."deal_notes";

drop table "public"."deals";

drop table "public"."favicons_excluded_domains";

drop table "public"."tags";

alter table "public"."tasks" drop column "contact_id";

alter table "public"."tasks" alter column "target_type" set default 'shidduch'::text;

-- `db diff` compares schemas, not data, so it never emits this DML. Without
-- it a stray 'contact' row (there are none in this snapshot, but production
-- is not this snapshot) would fail ADD CONSTRAINT validation below.
update public.tasks set target_type = 'shidduch' where target_type = 'contact';

alter table "public"."tasks" add constraint "tasks_target_type_check" CHECK ((target_type = ANY (ARRAY['shadchan'::text, 'shidduch'::text, 'reference'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_target_type_check";

set check_function_bodies = off;

create or replace view "public"."references_summary" with (security_invoker = on) as  SELECT r.id,
    r.account_id,
    r.created_at,
    r.name_en,
    r.name_he,
    r.relationship,
    r.phone,
    r.school,
    r.grad_year,
    r.name_norm_en,
    r.name_norm_he,
    r.phone_norm,
    count(DISTINCT rl.shidduchim_id) AS linked_shidduchim_count,
    count(DISTINCT rl.id) FILTER (WHERE (rl.call_status = ANY (ARRAY['answered'::text, 'they_will_call_back'::text]))) AS contacted_count,
    max(i.created_at) FILTER (WHERE (i.kind = 'call_logged'::text)) AS last_conversation_at,
    count(DISTINCT t.id) FILTER (WHERE (t.done_date IS NULL)) AS open_task_count
   FROM (((public."references" r
     LEFT JOIN public.reference_links rl ON ((rl.reference_id = r.id)))
     LEFT JOIN public.interactions i ON (((i.target_type = 'reference'::text) AND (i.target_id = r.id))))
     LEFT JOIN public.tasks t ON (((t.target_type = 'reference'::text) AND (t.target_id = r.id))))
  GROUP BY r.id;

-- `db diff` drops and recreates this view (see the drop above) because its
-- shadow-vs-local comparison flags it, even though its SELECT text is
-- unchanged. DROP + CREATE loses every explicit grant and re-inherits the
-- schema's `alter default privileges ... grant all on tables to anon` rule
-- (06_grants.sql), so the privileges declared for this view there must be
-- reissued by hand here or `authenticated` silently loses SELECT and `anon`
-- silently regains table-level access.
revoke all on table public.references_summary from anon, authenticated;
grant select on table public.references_summary to authenticated;
grant all on table public.references_summary to service_role;

CREATE OR REPLACE FUNCTION public.sync_task_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.target_id is null then
    raise exception 'a task needs a target: set target_type + target_id'
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$function$
;


