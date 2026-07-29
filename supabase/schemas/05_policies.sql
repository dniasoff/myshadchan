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
-- set_account_id_default() populates account_id on every insert. No longer
-- household-only (Story 3.14 dropped validate_tasks_household_scope) — do
-- not infer that restriction from this table's neighbours in this file.
create policy "Tasks scoped to account" on public.tasks
    for all to authenticated
    using (account_id = public.current_context_id())
    with check (account_id = public.current_context_id());

-- Configuration (Story 2.7, AC-9: the admin-role-check helper this file used
-- to call for writes is retired — writes are service-role-only now, not
-- merely admin-only. There is deliberately no insert/update policy left for
-- `authenticated` at all: `service_role` bypasses RLS, so a config write is
-- a platform-ops runbook action exactly
-- like this story's genesis invite seed.)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);

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
alter table public.invites enable row level security;
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
-- still govern writes and the hole would survive. (Story 2.2 review finding
-- #1, CLOSED: this policy's own `with check` never constrained `role`, so a
-- caller UPDATE-ing their own row within their own active account could
-- rewrite their `role` to `parent_admin` in one request. There is no
-- equivalent INSERT-side hole — `account_members_account_user_active_uq`
-- (`(account_id, user_id) where status = 'active'`, 01_tables.sql) rejects a
-- second ACTIVE row for the same pair, so an INSERT-based self-promotion
-- attempt fails on the unique index, not on this policy. Closed by
-- withholding UPDATE entirely from `authenticated` at the grant layer
-- (06_grants.sql) rather than narrowing this policy further — there is
-- deliberately no `for update` policy on this table at all now. Every
-- legitimate role change today (self_manager -> parent_admin) already goes
-- through add_persona()'s SECURITY DEFINER UPDATE, which runs as the
-- function owner and is unaffected by this grant. Any future client-facing
-- role-change flow (Story 2.5/2.7) must add its own SECURITY DEFINER
-- function, never a raw grant of UPDATE back onto this table.)
create policy "Account members readable by owner or within active account" on public.account_members
    for select to authenticated
    using (
        user_id = auth.uid()
        or account_id = public.current_context_id()
    );

create policy "Account members insertable within active account" on public.account_members
    for insert to authenticated
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

-- Story 2.7 (AC-2): a context's own active members see its own invites.
-- Deliberately SELECT-only — there is no insert/update/delete policy for
-- `authenticated` at all. Every write goes through create_invite() (AC-3),
-- revoke_invite() (Story 2.8), handle_new_user()'s binding step (a definer
-- trigger), or the service_role genesis seed — withholding DML at the GRANT
-- level (06_grants.sql), not merely by omitting a policy, is what keeps
-- create_invite()'s authority/kind checks from being merely advisory: a
-- permissive `with check (account_id = current_context_id())` insert policy
-- would let any active member, including a `helper`, PostgREST-insert a
-- `role = 'parent_admin'` invite directly.
create policy "Invites readable within active account" on public.invites
    for select to authenticated
    using (account_id = public.current_context_id());

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
-- The `single` role itself now exists in `account_members_role_check`
-- (Story 2.2, AC-2) and Story 2.7's invite flow (create_invite() +
-- handle_new_user()) can bind a real `single`-role membership — but this
-- policy does not yet gate on it: an account_id match alone still resolves
-- to full parent-level visibility regardless of the caller's role. A real,
-- documented window rather than a settled one — a `single`-role membership
-- reads the full candid interactions timeline until Epic 6 restricts single
-- visibility. When it does, this join is the ONE place that gains
-- `and public.is_single_visible_state(s.pipeline_state)`, and the `scope =
-- 'account'` disjunct below (now a three-way, target-aware disjunct rather
-- than a bare predicate — Story 3.5) becomes an outright deny for the
-- single role.
--
-- Story 3.5 widens the `scope = 'account'` disjunct to cover the two new
-- target types AC 1 forces into that bucket unconditionally (`shadchan`,
-- `single` — neither has a shidduch parent to derive visibility from). The
-- enumeration is deliberately CLOSED, mirroring `interactions_scope_link_check`'s
-- own exhaustiveness (AD-3): an account-scoped row with any other
-- `target_type` (including `shidduch`, which the table constraint already
-- forbids in this scope) is denied rather than falling through, so a future
-- constraint loosening fails closed rather than silently granting visibility.
-- Story 3.6 (AC 2/AC 3) splits the single `for all` policy above into three
-- per-command policies — SELECT, INSERT, UPDATE — so the UPDATE command
-- alone can carry the narrower "author or owning role" clause
-- (can_moderate_note(), 02_functions.sql) that AC 3 adds. Postgres ORs
-- *permissive* policies together per command — the SAME hazard
-- account_members' own comment states in writing just above (:124-127:
-- "Do NOT add a `for select` policy alongside a `for all` one to 'restore'
-- this shape — permissive policies OR together") and whose per-command
-- split (:152-158) is the in-repo precedent this mirrors exactly. Adding a
-- second, narrower UPDATE policy ALONGSIDE a surviving `for all` would only
-- WIDEN update access, never narrow it — so the `for all` policy is
-- replaced outright, not supplemented.
--
-- The SELECT and INSERT policies below carry the IDENTICAL `using`/
-- `with check` predicate the `for all` policy enforced — byte for byte, no
-- author clause. This story narrows UPDATE rights only; it must never
-- change who can read or insert an interaction.
--
-- No `for delete` policy exists on this table, on purpose: `authenticated`
-- holds no DELETE grant on `interactions` at all (06_grants.sql, the
-- append-only audit-trail rule) — a DELETE policy here would be dead text
-- implying a capability nobody has.
create policy "Interactions readable within account and parent visibility" on public.interactions
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and (
            (
                scope = 'account'
                and (
                    target_type = 'reference'
                    or (
                        target_type = 'shadchan'
                        and exists (
                            select 1
                            from public.shadchanim sh
                            where sh.id = interactions.target_id
                              and sh.account_id = public.current_context_id()
                        )
                    )
                    or (
                        target_type = 'single'
                        and exists (
                            select 1
                            from public.singles si
                            where si.id = interactions.target_id
                              and si.account_id = public.current_context_id()
                        )
                    )
                )
            )
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

create policy "Interactions insertable within account and parent visibility" on public.interactions
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and (
            (
                scope = 'account'
                and (
                    target_type = 'reference'
                    or (
                        target_type = 'shadchan'
                        and exists (
                            select 1
                            from public.shadchanim sh
                            where sh.id = interactions.target_id
                              and sh.account_id = public.current_context_id()
                        )
                    )
                    or (
                        target_type = 'single'
                        and exists (
                            select 1
                            from public.singles si
                            where si.id = interactions.target_id
                              and si.account_id = public.current_context_id()
                        )
                    )
                )
            )
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

-- The UPDATE policy alone gains AC 3's author-or-owning-role clause,
-- `and (kind <> 'note' or public.can_moderate_note(actor_member_id))`,
-- ANDed onto the same visibility predicate above, in BOTH `using` and
-- `with check`:
--   `using`      — AC 4's own observable is a ZERO ROWS AFFECTED update,
--                   not a raised error. A with-check-only clause would
--                   raise instead of silently filtering the row out of the
--                   caller's UPDATE.
--   `with check` — so the update cannot re-point a row into a shape the
--                   caller was never allowed to target in the first place.
-- The `kind <> 'note'` escape means every OTHER interaction kind
-- (call_logged, status_change, merge, link_created, link_removed —
-- 01_tables.sql) keeps today's plain account-scoped update behaviour
-- unchanged; only notes gain the author-or-owning-role restriction.
create policy "Interactions updatable by author or owning role" on public.interactions
    for update to authenticated
    using (
        account_id = public.current_context_id()
        and (
            (
                scope = 'account'
                and (
                    target_type = 'reference'
                    or (
                        target_type = 'shadchan'
                        and exists (
                            select 1
                            from public.shadchanim sh
                            where sh.id = interactions.target_id
                              and sh.account_id = public.current_context_id()
                        )
                    )
                    or (
                        target_type = 'single'
                        and exists (
                            select 1
                            from public.singles si
                            where si.id = interactions.target_id
                              and si.account_id = public.current_context_id()
                        )
                    )
                )
            )
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
        and (kind <> 'note' or public.can_moderate_note(actor_member_id))
    )
    with check (
        account_id = public.current_context_id()
        and (
            (
                scope = 'account'
                and (
                    target_type = 'reference'
                    or (
                        target_type = 'shadchan'
                        and exists (
                            select 1
                            from public.shadchanim sh
                            where sh.id = interactions.target_id
                              and sh.account_id = public.current_context_id()
                        )
                    )
                    or (
                        target_type = 'single'
                        and exists (
                            select 1
                            from public.singles si
                            where si.id = interactions.target_id
                              and si.account_id = public.current_context_id()
                        )
                    )
                )
            )
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
        and (kind <> 'note' or public.can_moderate_note(actor_member_id))
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
