--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
alter table public.sales enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;

-- Sales
create policy "Enable read access for authenticated users" on public.sales for select to authenticated using (true);

-- Tasks. Account-scoped like the rest of the shidduchim domain (AD-1);
-- set_account_id_default() populates account_id on every insert.
create policy "Tasks scoped to account" on public.tasks
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

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
alter table public.singles enable row level security;
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

create policy "Singles scoped to account" on public.singles
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

alter table public.interactions enable row level security;
alter table public.identity_signals enable row level security;

-- Interactions carry the candid diligence timeline, so the account floor is not
-- the whole story (AD-3/F3). An interaction that belongs to a specific
-- reference<->shidduch conversation carries reference_link_id, and its
-- visibility is DERIVED by walking reference_links -> shidduchim — it has no
-- visibility column of its own and must never gain one. Interactions with no
-- shidduch context ("updated phone number") need only the account check.
--
-- The `scope` discriminator (01_tables.sql) makes the two cases total: a
-- shidduch-scoped row MUST have a link and is gated by the join below; an
-- account-scoped row has no shidduch parent at all. There is no third state a
-- row can fall into, which is what an earlier `reference_link_id is null`
-- shortcut allowed — every free-text note took it and would have bypassed
-- single visibility entirely once the single role existed.
--
-- The join is INNER, deliberately: a link whose parent shidduch is missing or
-- belongs to another account denies rather than falling through.
--
-- Today every authenticated member of an account is a parent/helper, so the
-- derived predicate resolves to the account check. When the single logs in and
-- the `single` role lands (Epic 6), this join is the ONE place that gains
-- `and public.is_single_visible_state(s.pipeline_state)`, and the `scope =
-- 'account'` branch becomes an outright deny for the single role.
create policy "Interactions scoped to account and parent visibility" on public.interactions
    for all to authenticated
    using (
        account_id = public.current_account_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_account_id()
                      and s.account_id = public.current_account_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_account_id()
                )
            )
        )
    )
    with check (
        account_id = public.current_account_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_account_id()
                      and s.account_id = public.current_account_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_account_id()
                )
            )
        )
    );

-- identity_signals is READ-ONLY to clients. It is written exclusively by the
-- SECURITY DEFINER sync triggers, because a client that could write its own
-- match keys could make matchIdentity() point anywhere. Reads stay
-- account-scoped (PRV-2: identity is never pooled across accounts).
create policy "Identity signals readable within account" on public.identity_signals
    for select to authenticated
    using (account_id = public.current_account_id());

-- Billing (E4). subscription and ai_usage are SELECT-only for the account
-- owner — a member may read their own entitlement and usage meter, nothing
-- else. There is deliberately NO insert/update/delete policy on either table:
-- with RLS enabled and no write policy, authenticated cannot write at all, so
-- there is no client-callable path to self-grant entitlement (set plan='ai' or
-- status='active'). Every write is service_role (payment webhook / the AI edge
-- functions incrementing the meter), which bypasses RLS. This is the tenant
-- half of what makes ai_entitlement() unforgeable from the browser.
alter table public.subscription enable row level security;
alter table public.ai_usage enable row level security;

create policy "Subscription readable within account" on public.subscription
    for select to authenticated
    using (account_id = public.current_account_id());

create policy "AI usage readable within account" on public.ai_usage
    for select to authenticated
    using (account_id = public.current_account_id());

-- Inbox items (Epic 2): full CRUD within the caller's account. Insert/update
-- are with-check-scoped so a client can capture (share/upload) and resolve its
-- own items but never read, write, or resolve another account's captures. The
-- inbound-email webhook writes as service_role (RLS-exempt).
alter table public.inbox_items enable row level security;

create policy "Inbox items scoped to account" on public.inbox_items
    for all to authenticated
    using (account_id = public.current_account_id())
    with check (account_id = public.current_account_id());
