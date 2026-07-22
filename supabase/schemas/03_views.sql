--
-- Views
-- This file declares all views in the public schema.
--

create or replace view public.activity_log with (security_invoker = on) as
select
    ('company.' || c.id || '.created') as id,
    'company.created' as type,
    c.created_at as date,
    c.id as company_id,
    c.sales_id,
    to_json(c.*) as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from public.companies c
union all
select
    ('contact.' || co.id || '.created') as id,
    'contact.created' as type,
    co.first_seen as date,
    co.company_id,
    co.sales_id,
    null::json as company,
    to_json(co.*) as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from public.contacts co
union all
select
    ('contactNote.' || cn.id || '.created') as id,
    'contactNote.created' as type,
    cn.date,
    co.company_id,
    cn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    to_json(cn.*) as contact_note,
    null::json as deal_note
from public.contact_notes cn
    left join public.contacts co on co.id = cn.contact_id
union all
select
    ('deal.' || d.id || '.created') as id,
    'deal.created' as type,
    d.created_at as date,
    d.company_id,
    d.sales_id,
    null::json as company,
    null::json as contact,
    to_json(d.*) as deal,
    null::json as contact_note,
    null::json as deal_note
from public.deals d
union all
select
    ('dealNote.' || dn.id || '.created') as id,
    'dealNote.created' as type,
    dn.date,
    d.company_id,
    dn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    to_json(dn.*) as deal_note
from public.deal_notes dn
    left join public.deals d on d.id = dn.deal_id;

create or replace view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;

create or replace view public.contacts_summary with (security_invoker = on) as
select
    co.id,
    co.first_name,
    co.last_name,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.email_jsonb,
    co.phone_jsonb,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;

create or replace view public.init_state with (security_invoker = off) as
select count(sub.id) as is_initialized
from (
    select sales.id from public.sales limit 1
) sub;

-- Board list/detail read path for the shidduchim pipeline (AD-10, analogous
-- to contacts_summary/companies_summary). Joins the shadchan ("via {shadchan}")
-- and the child so the board card needs a single fetch. security_invoker
-- so the base-table RLS still applies to the caller.
create or replace view public.shidduchim_summary with (security_invoker = on) as
select
    s.id,
    s.account_id,
    s.created_at,
    s.child_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.parents_en,
    s.parents_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    s.close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name as shadchan_name,
    sh.name_he as shadchan_name_he,
    c.first_name_en as child_first_name_en,
    c.first_name_he as child_first_name_he,
    c.last_name_en as child_last_name_en,
    c.last_name_he as child_last_name_he,
    count(distinct rl.id) as nb_references,
    count(distinct r.id) as nb_redts
from public.shidduchim s
    left join public.shadchanim sh on sh.id = s.shadchan_id
    left join public.children c on c.id = s.child_id
    left join public.reference_links rl on rl.shidduchim_id = s.id
    left join public.redts r on r.shidduchim_id = s.id
group by s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;

-- The reference book's list read path (AD-10, mirrors contacts_summary /
-- shidduchim_summary). Every count the list row shows comes from here, so the
-- list never N+1-fetches links, interactions and tasks per reference.
-- security_invoker keeps base-table RLS — including the join-to-parent
-- visibility on interactions — applying to the caller.
create or replace view public.references_summary with (security_invoker = on) as
select
    r.id,
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
    count(distinct rl.shidduchim_id) as linked_shidduchim_count,
    count(distinct rl.id) filter (
        where rl.call_status in ('answered', 'they_will_call_back')
    ) as contacted_count,
    max(i.created_at) filter (where i.kind = 'call_logged') as last_conversation_at,
    count(distinct t.id) filter (where t.done_date is null) as open_task_count
from public."references" r
    left join public.reference_links rl on rl.reference_id = r.id
    left join public.interactions i on i.target_type = 'reference' and i.target_id = r.id
    left join public.tasks t on t.target_type = 'reference' and t.target_id = r.id
group by r.id;

-- One row per reference<->shidduch conversation. Serves BOTH renderings of the
-- same data: the per-shidduch call-log cards on a reference's detail page, and
-- the repeat-recognition panel ("you've spoken to them about N other singles").
-- effective_relationship resolves the per-link override against the reference's
-- own default, so the same person can read "shul rabbi" on one card and "family
-- friend" on another.
create or replace view public.reference_links_summary with (security_invoker = on) as
select
    rl.id,
    rl.account_id,
    rl.created_at,
    rl.reference_id,
    rl.shidduchim_id,
    rl.resume_id,
    rl.call_status,
    rl.what_they_said,
    rl.conversation_log,
    rl.relationship_override,
    coalesce(rl.relationship_override, r.relationship) as effective_relationship,
    coalesce(jsonb_array_length(rl.conversation_log), 0) as conversation_log_count,
    r.name_en as reference_name_en,
    r.name_he as reference_name_he,
    r.phone as reference_phone,
    s.name_en as shidduch_name_en,
    s.name_he as shidduch_name_he,
    s.pipeline_state as shidduch_pipeline_state,
    s.visibility as shidduch_visibility,
    s.child_id,
    c.first_name_en as child_first_name_en,
    c.first_name_he as child_first_name_he
from public.reference_links rl
    left join public."references" r on r.id = rl.reference_id
    left join public.shidduchim s on s.id = rl.shidduchim_id
    left join public.children c on c.id = s.child_id;
