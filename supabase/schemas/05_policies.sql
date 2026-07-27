--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;

-- Members (Story 2.2, AC-9): a caller always reads their own row, plus any
-- other member's profile row that shares an ACTIVE membership of the
-- caller's currently active context — narrower than "everyone", and
-- consistent with account_members' own established shape further below (a
-- foreign member's row is visible only inside the context that member and
-- the caller currently share). A negative test proves a member of household
-- A cannot read the profile row of a member who belongs only to household B.
create policy "Members readable by self or within active account" on public.members
    for select to authenticated
    using (
        user_id = auth.uid()
        or exists (
            select 1
            from public.account_members am
            where am.account_id = public.current_context_id()
              and am.status = 'active'
              and am.user_id = members.user_id
        )
    );

-- Tasks. Account-scoped like the rest of the shidduchim domain (AD-1);
-- set_account_id_default() populates account_id on every insert.
create policy "Tasks scoped to account" on public.tasks
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

--
-- =====================================================================
-- MyShadchan — Shidduchim pipeline RLS (AD-1)
-- =====================================================================
-- Every domain row is account-scoped via current_context_id(), which reads
-- the caller's explicit, server-held active context (member_state, AD-19)
-- rather than an arbitrary membership. Access is authenticated-only and
-- deny-by-default for anon (no anon policy, and no anon grants — see
-- 06_grants.sql). Full FORCE RLS + CI RLS assertions remain a flagged gap
-- with no assigned story (see Story 2.1's Dev Notes).

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.member_state enable row level security;
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

-- Accounts: a member sees every account they hold ANY membership in
-- (active or not) — a strict superset of "the currently active one", never
-- a subset. This is AC-7's corrected shape: a literal
-- `id = current_context_id()` swap would make a user's own non-active
-- context invisible to them, breaking Story 2.4's context switcher (it must
-- read the name/kind of a context that is not currently active, to render
-- it as a switch target) before that story is even built. No `user_id`
-- column exists on `accounts` itself, so the check is a membership lookup
-- rather than a direct comparison. Reading account_members from inside this
-- policy is safe only because account_members's own policy never reads
-- accounts back — see Story 2.1's Dev Notes on the recursion risk before
-- changing either.
create policy "Account access scoped to member" on public.accounts
    for all to authenticated
    using (
        exists (
            select 1 from public.account_members am
            where am.account_id = accounts.id
              and am.user_id = auth.uid()
              and am.status = 'active'
        )
    )
    with check (
        exists (
            select 1 from public.account_members am
            where am.account_id = accounts.id
              and am.user_id = auth.uid()
              and am.status = 'active'
        )
    );

-- Account members: scoped to the caller's account, PLUS always the caller's
-- own membership rows regardless of which context is active. NOTE the
-- reserved `shadchan` role is granted nothing beyond this baseline in v1
-- (AD-2). AC-7's corrected shape: a literal `account_id = current_context_id()`
-- swap would hide a caller's own membership row in a context they are not
-- currently active in — the same context-switcher regression as `accounts`
-- above. A caller always sees their own membership rows (every context they
-- belong to), plus other members' rows only inside the context they are
-- currently active in.
--
-- Command-scoped on purpose (post-review hardening, Story 2.1 finding #1):
-- a single `for all` policy with this same `using`/`with check` predicate is
-- a cross-tenant takeover. `grant insert, update, delete` (06_grants.sql)
-- plus a permissive `with check (user_id = auth.uid() or ...)` lets ANY
-- authenticated caller INSERT themselves an `active` membership row into ANY
-- account id (the `user_id = auth.uid()` disjunct alone satisfies the
-- check), then legitimately `set_active_context()` into it — read, write and
-- even evict the legitimate owner. The widened, `user_id = auth.uid()`-or-
-- `current_context_id()` predicate is only safe for SELECT: reading your own
-- membership rows across every context you hold does not let you touch
-- anyone else's data. INSERT/UPDATE/DELETE stay scoped to the caller's
-- ACTIVE context ONLY, on both `using` and `with check`. Do NOT add a
-- `for select` policy alongside a `for all` one to "restore" this shape —
-- permissive policies OR together, so the wide `for all` predicate would
-- still govern writes and the hole would survive. (A narrower, still-open
-- gap: an insert scoped to `current_context_id()` alone still lets a
-- `helper` self-promote to `parent_admin` inside their OWN tenant, since
-- `role` is unconstrained here — pre-existing, not this policy's to close;
-- flagged for Story 2.2/2.7.)
create policy "Account members readable by owner or within active account" on public.account_members
    for select to authenticated
    using (
        user_id = auth.uid()
        or account_id = public.current_context_id()
    );

create policy "Account members insertable within active account" on public.account_members
    for insert to authenticated
    with check (account_id = public.current_context_id());

create policy "Account members updatable within active account" on public.account_members
    for update to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Account members deletable within active account" on public.account_members
    for delete to authenticated
    using (account_id = public.current_context_id());

-- The active-context pointer (Story 2.1, AD-19). SELECT only — there is no
-- insert/update/delete policy for authenticated at all, so the only way this
-- table changes is through set_active_context() / activate_context_for(),
-- both SECURITY DEFINER and both bypassing RLS internally. That absence IS
-- the enforcement.
create policy "Member state readable by owner" on public.member_state
    for select to authenticated
    using (user_id = auth.uid());

create policy "Singles scoped to account" on public.singles
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Shadchanim scoped to account" on public.shadchanim
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "References scoped to account" on public."references"
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Shidduchim scoped to account" on public.shidduchim
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Resumes scoped to account" on public.resumes
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Reference links scoped to account" on public.reference_links
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Date records scoped to account" on public.date_records
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Redts scoped to account" on public.redts
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

create policy "Shidduch schools scoped to account" on public.shidduch_schools
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

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
        account_id = public.current_context_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_context_id()
                      and s.account_id = public.current_context_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_context_id()
                )
            )
        )
    )
    with check (
        account_id = public.current_context_id()
        and (
            scope = 'account'
            or (
                target_type = 'reference'
                and exists (
                    select 1
                    from public.reference_links rl
                        join public.shidduchim s on s.id = rl.shidduchim_id
                    where rl.id = interactions.reference_link_id
                      and rl.account_id = public.current_context_id()
                      and s.account_id = public.current_context_id()
                )
            )
            or (
                target_type = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                    where s.id = interactions.target_id
                      and s.account_id = public.current_context_id()
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
    using (account_id = public.current_context_id());

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
    using (account_id = public.current_context_id());

create policy "AI usage readable within account" on public.ai_usage
    for select to authenticated
    using (account_id = public.current_context_id());

-- Inbox items (Epic 2): full CRUD within the caller's account. Insert/update
-- are with-check-scoped so a client can capture (share/upload) and resolve its
-- own items but never read, write, or resolve another account's captures. The
-- inbound-email webhook writes as service_role (RLS-exempt).
alter table public.inbox_items enable row level security;

create policy "Inbox items scoped to account" on public.inbox_items
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());
