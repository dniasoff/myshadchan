--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.sales enable row level security;
alter table public.tags enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;
alter table public.favicons_excluded_domains enable row level security;

-- Companies
create policy "Enable read access for authenticated users" on public.companies for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.companies for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.companies for update to authenticated using (true) with check (true);
create policy "Company Delete Policy" on public.companies for delete to authenticated using (true);

-- Contacts
create policy "Enable read access for authenticated users" on public.contacts for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contacts for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.contacts for update to authenticated using (true) with check (true);
create policy "Contact Delete Policy" on public.contacts for delete to authenticated using (true);

-- Contact Notes
create policy "Enable read access for authenticated users" on public.contact_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contact_notes for insert to authenticated with check (true);
create policy "Contact Notes Update policy" on public.contact_notes for update to authenticated using (true);
create policy "Contact Notes Delete Policy" on public.contact_notes for delete to authenticated using (true);

-- Deals
create policy "Enable read access for authenticated users" on public.deals for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deals for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.deals for update to authenticated using (true) with check (true);
create policy "Deals Delete Policy" on public.deals for delete to authenticated using (true);

-- Deal Notes
create policy "Enable read access for authenticated users" on public.deal_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deal_notes for insert to authenticated with check (true);
create policy "Deal Notes Update Policy" on public.deal_notes for update to authenticated using (true);
create policy "Deal Notes Delete Policy" on public.deal_notes for delete to authenticated using (true);

-- Sales
create policy "Enable read access for authenticated users" on public.sales for select to authenticated using (true);

-- Tags
create policy "Enable read access for authenticated users" on public.tags for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tags for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.tags for update to authenticated using (true);
create policy "Enable delete for authenticated users only" on public.tags for delete to authenticated using (true);

-- Tasks
create policy "Enable read access for authenticated users" on public.tasks for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tasks for insert to authenticated with check (true);
create policy "Task Update Policy" on public.tasks for update to authenticated using (true);
create policy "Task Delete Policy" on public.tasks for delete to authenticated using (true);

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Favicons excluded domains
create policy "Enable access for authenticated users only" on public.favicons_excluded_domains to authenticated using (true) with check (true);

--
-- =====================================================================
-- MyShadchan — Shidduchim pipeline RLS (AD-1)
-- =====================================================================
-- Every domain row is account-scoped via current_account_id(). Access is
-- authenticated-only and deny-by-default for anon (no anon policy, and no
-- anon grants — see 06_grants.sql). This is strictly stronger than the
-- fork's using(true). Full FORCE RLS + multi-account current_account_ids()
-- + CI RLS assertions are Epic-1 (deferred); the shape here lets that land
-- WITHOUT a schema change.

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.children enable row level security;
alter table public.shadchanim enable row level security;
alter table public."references" enable row level security;
alter table public.shidduchim enable row level security;
alter table public.resumes enable row level security;
alter table public.reference_links enable row level security;
alter table public.date_records enable row level security;
alter table public.redts enable row level security;
alter table public.shidduch_schools enable row level security;
alter table public.pipeline_transitions enable row level security;

-- Accounts: a member sees only their own account.
create policy "Account access scoped to member" on public.accounts
    for all to authenticated
    using (id = public.current_account_id())
    with check (id = public.current_account_id());

-- Account members: scoped to the caller's account. NOTE the reserved
-- `shadchan` role is granted nothing beyond this baseline in v1 (AD-2).
create policy "Account members scoped to account" on public.account_members
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Children scoped to account" on public.children
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Shadchanim scoped to account" on public.shadchanim
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "References scoped to account" on public."references"
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Shidduchim scoped to account" on public.shidduchim
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Resumes scoped to account" on public.resumes
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Reference links scoped to account" on public.reference_links
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Date records scoped to account" on public.date_records
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Redts scoped to account" on public.redts
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

create policy "Shidduch schools scoped to account" on public.shidduch_schools
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

-- Pipeline transitions are static, non-tenant reference data (the legal
-- state graph). Read-only for authenticated users; seeded by migration.
create policy "Pipeline transitions readable" on public.pipeline_transitions
    for select to authenticated
    using (true);
