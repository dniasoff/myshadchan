--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
alter table public.members enable row level security;
alter table public.members force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.configuration enable row level security;
alter table public.configuration force row level security;

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
--
-- Story 6.2 (AC 5): denies the `single` role entirely — zero rows on every
-- command. The family's follow-through work (CAP-6); free-text `text`
-- routinely names candid diligence steps. No Epic 6 story needs a single to
-- read this table; default-deny is the safe posture per AD-1.
create policy "Tasks scoped to account" on public.tasks
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

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
alter table public.accounts force row level security;
alter table public.account_members enable row level security;
alter table public.account_members force row level security;
alter table public.member_state enable row level security;
alter table public.member_state force row level security;
alter table public.invites enable row level security;
alter table public.invites force row level security;
alter table public.singles enable row level security;
alter table public.singles force row level security;
alter table public.single_preferences enable row level security;
alter table public.single_preferences force row level security;
alter table public.shadchanim enable row level security;
alter table public.shadchanim force row level security;
alter table public."references" enable row level security;
alter table public."references" force row level security;
alter table public.shidduchim enable row level security;
alter table public.shidduchim force row level security;
alter table public.resumes enable row level security;
alter table public.resumes force row level security;
alter table public.resume_photos enable row level security;
alter table public.resume_photos force row level security;
alter table public.medical_notes enable row level security;
alter table public.medical_notes force row level security;
alter table public.reference_links enable row level security;
alter table public.reference_links force row level security;
alter table public.date_records enable row level security;
alter table public.date_records force row level security;
alter table public.redts enable row level security;
alter table public.redts force row level security;
alter table public.shidduch_schools enable row level security;
alter table public.shidduch_schools force row level security;
alter table public.shidduchim_external_links enable row level security;
alter table public.shidduchim_external_links force row level security;
alter table public.pipeline_transitions enable row level security;
alter table public.pipeline_transitions force row level security;

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
--
-- Story 6.2 (AC 4) splits this single `for all` policy into two, per command,
-- rather than adding `and public.current_member_role() <> 'single'` to the
-- one policy above: a `single` must keep reading the household's own name
-- (the app shell and context switcher need it, and `my_contexts()` — SECURITY
-- INVOKER, 02_functions.sql — joins accounts under the caller's own rights),
-- but must never write it. A role guard on the shared `using`/`with check`
-- would have broken that read. The membership-`exists` predicate is
-- unchanged, verbatim, in both halves below — this is the two-policy pattern
-- (Dev Notes), not a narrowing of who may read.
create policy "Accounts readable to their members" on public.accounts
    for select to authenticated
    using (
        exists (
            select 1 from public.account_members am
            where am.account_id = accounts.id
              and am.user_id = auth.uid()
              and am.status = 'active'
        )
    );

-- INSERT/UPDATE/DELETE keep the same membership lookup, plus the `single`
-- role guard on BOTH `using` and `with check` — the `using` half is what
-- stops a single's DELETE, which never consults `with check` (Story 6.2).
-- `for all`, not a comma list (`CREATE POLICY ... FOR` accepts exactly one of
-- ALL/SELECT/INSERT/UPDATE/DELETE, never several) — safe here because the
-- unrestricted SELECT policy above already OR-combines to cover reads for
-- every role, so this policy's own SELECT reach is moot; only its
-- INSERT/UPDATE/DELETE reach is exercised in practice.
create policy "Accounts writable by non-single members" on public.accounts
    for all to authenticated
    using (
        exists (
            select 1 from public.account_members am
            where am.account_id = accounts.id
              and am.user_id = auth.uid()
              and am.status = 'active'
        )
        and public.current_member_role() <> 'single'
    )
    with check (
        exists (
            select 1 from public.account_members am
            where am.account_id = accounts.id
              and am.user_id = auth.uid()
              and am.status = 'active'
        )
        and public.current_member_role() <> 'single'
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
-- Story 6.2 (AC 5): the roster branch (`account_id = current_context_id()`)
-- is guarded with `and public.current_member_role() <> 'single'` — a single
-- must never browse the household roster. The own-rows branch
-- (`user_id = auth.uid()`) is left UNGUARDED: `my_contexts()` (SECURITY
-- INVOKER) and therefore `useViewerRole()`, the context switcher and sign-in
-- itself all depend on a caller reading their own membership row(s), single
-- included — guarding it would break sign-in for every single the moment
-- this migration landed. No `with check` to mirror on this SELECT-only policy.
create policy "Account members readable by owner or within active account" on public.account_members
    for select to authenticated
    using (
        user_id = auth.uid()
        or (
            account_id = public.current_context_id()
            and public.current_member_role() <> 'single'
        )
    );

create policy "Account members insertable within active account" on public.account_members
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

create policy "Account members deletable within active account" on public.account_members
    for delete to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Deliberately no `for update` policy on this table (Story 2.2 review
-- finding #1's fix, restated by Story 6.2): UPDATE is withheld entirely from
-- `authenticated` at the grant layer (06_grants.sql), so there is nothing for
-- a `single` role guard to narrow here — do not add one.

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
-- Story 6.2 (AC 5): a single never browses the household's invite list —
-- membership management is an owning-role concern (`is_invite_capable_role()`
-- already refuses a `single` caller inside `create_invite()`); this narrows
-- the read surface to match. SELECT-only, no `with check` to mirror: there is
-- no insert/update/delete policy for `authenticated` on this table at all
-- (06_grants.sql withholds DML entirely), so there is no PostgREST insert
-- surface for this story to close on top of.
create policy "Invites readable within active account" on public.invites
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

create policy "Singles scoped to account" on public.singles
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 3): a single reads exactly their own singles row — not a
-- sibling's, not another household's (already impossible via account_id, but
-- the same-household sibling case is the one worth naming). SELECT-only,
-- additive to the policy above (the two-policy pattern, Dev Notes): a single
-- caller's `for all` predicate above is now false (role guard), so they fall
-- through to seeing only what this policy grants.
create policy "Singles visible to self" on public.singles
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and member_id = public.current_member_id()
    );

-- Single preferences (Story 16.1 / FR67): a single owns her preferences with
-- full CRUD; a manager (parent_admin or self_manager — the two roles this
-- schema already treats as "manages the process", see the medical-notes policy
-- above) may read only the rows the single has explicitly shared via
-- visible_to_manager = true. Every policy is account-scoped via
-- current_context_id() because the table carries account_id directly.
-- Do NOT grant helper or any other role access — this would be the first
-- table in the schema to do so, which is a product decision.
create policy "Single preferences owned by single" on public.single_preferences
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and exists (
            select 1 from public.singles s
            where s.id = single_preferences.single_id
              and s.account_id = public.current_context_id()
              and s.member_id = public.current_member_id()
        )
    )
    with check (
        account_id = public.current_context_id()
        and exists (
            select 1 from public.singles s
            where s.id = single_preferences.single_id
              and s.account_id = public.current_context_id()
              and s.member_id = public.current_member_id()
        )
    );

create policy "Single preferences readable by manager when shared" on public.single_preferences
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and visible_to_manager = true
        and public.current_member_role() in ('parent_admin', 'self_manager')
    );

-- Single notes (Story 16.3 / FR69, PRV-4): a single owns her notes with
-- full CRUD; a manager (parent_admin or self_manager) may read only the
-- rows the single has explicitly shared via visible_to_manager = true.
-- Every policy is account-scoped via current_context_id() because the
-- table carries account_id directly. Do NOT grant helper or any other
-- role access -- this would be the first table in the schema to do so,
-- which is a product decision (precedent: single_preferences).

alter table public.single_notes enable row level security;
alter table public.single_notes force row level security;

create policy "Single notes owned by single" on public.single_notes
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and exists (
            select 1 from public.singles s
            where s.id = single_notes.single_id
              and s.account_id = public.current_context_id()
              and s.member_id = public.current_member_id()
        )
    )
    with check (
        account_id = public.current_context_id()
        and exists (
            select 1 from public.singles s
            where s.id = single_notes.single_id
              and s.account_id = public.current_context_id()
              and s.member_id = public.current_member_id()
        )
    );

create policy "Single notes readable by manager when shared" on public.single_notes
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and visible_to_manager = true
        and public.current_member_role() in ('parent_admin', 'self_manager')
    );

-- Story 6.3 (AC 3): writes stay denied to a `single`; reads are carved out
-- into a second, SELECT-only policy below rather than added here — the same
-- two-policy pattern Story 6.2 established for `accounts`/`account_members`
-- (permissive policies OR together per command, so a role guard on this
-- shared `for all` predicate would have blocked the read too).
create policy "Shadchanim scoped to account" on public.shadchanim
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.3 (AC 3): a single reads the WHOLE household shadchan book, not
-- just shadchanim attached to their own visible suggestions. Deliberate —
-- see Dev Notes "Why the single sees the whole shadchan book" in
-- 6-3-field-level-scoping-for-a-single.md: post-5.9 a shadchanim row is a
-- contact card (name/location/contact details/responsiveness) with no
-- candid column left (the candid commentary now lives in `interactions`,
-- denied by this same story), and narrowing to "own suggestions only" would
-- break every RecordLink render of a shadchan the moment a suggestion
-- leaves the single's visible set. SELECT-only, additive to the policy
-- above (the two-policy pattern).
create policy "Shadchanim visible to single" on public.shadchanim
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
    );

-- Story 6.3 (AC 1): denies the `single` role entirely — zero rows on every
-- command. The reference book itself is candid by construction (the whole
-- diligence surface); no row is safe to expose regardless of the parent
-- suggestion's visibility, so this is a pure narrowing of the existing `for
-- all` policy, not a two-policy split. R7-scoped besides (no nav, no browse
-- surface, out of global search) — this closes the data half of that ruling.
create policy "References scoped to account" on public."references"
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

create policy "Shidduchim scoped to account" on public.shidduchim
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 1): a single sees a suggestion only when all three are
-- simultaneously true — it belongs to their OWN singles row (not a
-- sibling's, per the epic's "or yourself" dignity floor — Dev Notes "Why
-- sibling exclusion is this story's, not an invention"), its visibility is
-- 'shared' (excludes 'private_parent' and 'private_single' —
-- shidduchim_visibility_check, 01_tables.sql), and its pipeline_state is one
-- of the three single-visible states (is_single_visible_state(), the one
-- authority for that axis — never re-implemented here). SELECT-only,
-- additive to the policy above (the two-policy pattern, Dev Notes).
create policy "Shidduchim visible to single" on public.shidduchim
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and visibility = 'shared'
        and public.is_single_visible_state(pipeline_state)
        and exists (
            select 1 from public.singles c
            where c.id = shidduchim.single_id
              and c.member_id = public.current_member_id()
        )
    );

create policy "Resumes scoped to account" on public.resumes
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 2): a single's resume-adjacent facts. Two mutually exclusive
-- branches (resumes_owner_check, 01_tables.sql, guarantees exactly one of
-- shidduchim_id/single_id is set): a visible suggestion's resume (the same
-- account/visibility/state/sibling join as "Shidduchim visible to single"
-- above), or the single's OWN outbound resume (the Story 5.8 shape — it
-- describes the single themselves and carries no candid third-party content,
-- so AC 2 grants it unconditionally once ownership is proven).
create policy "Resumes visible to single" on public.resumes
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and (
            exists (  -- a visible suggestion's resume
                select 1
                from public.shidduchim s
                    join public.singles c on c.id = s.single_id
                where s.id = resumes.shidduchim_id
                  and s.visibility = 'shared'
                  and public.is_single_visible_state(s.pipeline_state)
                  and c.member_id = public.current_member_id()
            )
            or exists (  -- the single's own outbound resume (5.8 shape)
                select 1 from public.singles c
                where c.id = resumes.single_id
                  and c.member_id = public.current_member_id()
            )
        )
    );

-- Photo tab (Story 5.4, AC-3). Unlike every plain "scoped to account"
-- policy in this file, this one narrows further: a caller whose ACTIVE
-- membership role is 'single' must never read (or write) a 'private_parent'
-- row. This is a self-contained role check on this one table, not a
-- dependency on Epic 6's general single-access work (which lands later and
-- covers other tables, e.g. interactions below) — 'single' is already a
-- real, invitable role at HEAD (account_members_role_check, 01_tables.sql).
--
-- current_member_role() (Story 6.2) is SECURITY DEFINER and already resolves
-- to the caller's ACTIVE membership's role ((auth.uid(), current_context_id(),
-- status = 'active') — 02_functions.sql), derived from current_member_id().
-- When the caller has no active membership it returns NULL, and
-- `NULL <> 'single'` is NULL (falsy in a USING clause) — exactly the fail-
-- closed behaviour the inlined `exists (… am.id = current_member_id() …)`
-- this replaces already had (Story 6.2 Task 7 — a DRY fold).
--
-- Story 6.2 REVIEW FIX (finding #2): Task 7's original fold kept the
-- `visibility = 'shared'` test account-WIDE — any `single` could read, and
-- (being a `for all` policy) HIDE, any shared photo in the household,
-- including a sibling's, and could read a `shared`-tagged photo whose parent
-- suggestion is itself `private_parent` (a suggestion AC-1 says must be
-- wholly invisible to them). That was consistent with Story 5.4's
-- household-wide "single" model, but every OTHER single-adjacent table this
-- story touches (`resumes`, `shidduch_schools`, `shidduchim`) is scoped to
-- the caller's OWN suggestion via a `singles.member_id` join — leaving this
-- one table household-wide reopened exactly the sibling leak AC-1/AC-8 exist
-- to close, and made it a write hole too (`hide_resume_photo()` is SECURITY
-- INVOKER and trusts this policy's own SELECT for its "does this photo
-- exist" check). Closed with the SAME ownership join "Resumes visible to
-- single" already uses (own visible suggestion, or the single's own
-- outbound resume) — one authority for "is this resume mine", not a second,
-- table-local reinvention. `resume_photos.sql`'s fixture was updated
-- alongside this (its `single` members are now linked to a real `singles`
-- row via `member_id` — see that file's own note) rather than this policy
-- being loosened to keep an un-updated fixture green.
create policy "Resume photos scoped to account, single sees only own shared" on public.resume_photos
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and (
            public.current_member_role() <> 'single'
            or (
                visibility = 'shared'
                and exists (
                    select 1
                    from public.resumes r
                    where r.id = resume_photos.resume_id
                      and (
                        exists (  -- a visible suggestion's resume
                            select 1
                            from public.shidduchim s
                                join public.singles c on c.id = s.single_id
                            where s.id = r.shidduchim_id
                              and s.visibility = 'shared'
                              and public.is_single_visible_state(s.pipeline_state)
                              and c.member_id = public.current_member_id()
                        )
                        or exists (  -- the single's own outbound resume (5.8 shape)
                            select 1 from public.singles c
                            where c.id = r.single_id
                              and c.member_id = public.current_member_id()
                        )
                      )
                )
            )
        )
    )
    with check (
        account_id = public.current_context_id()
        and (
            public.current_member_role() <> 'single'
            or (
                visibility = 'shared'
                and exists (
                    select 1
                    from public.resumes r
                    where r.id = resume_photos.resume_id
                      and (
                        exists (
                            select 1
                            from public.shidduchim s
                                join public.singles c on c.id = s.single_id
                            where s.id = r.shidduchim_id
                              and s.visibility = 'shared'
                              and public.is_single_visible_state(s.pipeline_state)
                              and c.member_id = public.current_member_id()
                        )
                        or exists (
                            select 1 from public.singles c
                            where c.id = r.single_id
                              and c.member_id = public.current_member_id()
                        )
                      )
                )
            )
        )
    );

-- Medical tab (Story 5.5, AC-3): readable and writable ONLY by a caller whose
-- ACTIVE membership role is 'parent_admin' or 'self_manager' — the two roles
-- that actually run a household's shidduch process. `helper` and `single`
-- are denied outright; a `shadchan` has no membership path into a household
-- row at all (AD-20), so no explicit shadchan check is needed.
--
-- current_member_role() (Story 6.2) is SECURITY DEFINER and already resolves
-- to the caller's ACTIVE membership's role, derived from current_member_id()
-- — when the caller has no active membership it returns NULL, and
-- `NULL in (...)` is NULL (falsy), so this policy fails closed exactly like
-- the inlined `exists (… am.id = current_member_id() …)` it replaces (Story
-- 6.2 Task 7 — a DRY fold, not a behaviour change; `medical_notes.sql`
-- passes unmodified).
--
-- ONE `for all` policy, not a `for all` plus a narrower `for select`:
-- permissive policies OR together per command, so a second policy could
-- only ever widen access (account_members' own comment states the hazard
-- above).
create policy "Medical notes scoped to account, parent_admin/self_manager only" on public.medical_notes
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() in ('parent_admin', 'self_manager')
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() in ('parent_admin', 'self_manager')
    );

-- Story 6.3 (AC 1): denies the `single` role entirely — zero rows on every
-- command. `call_status`/`what_they_said`/`conversation_log` are candid
-- diligence content by construction; no row-subset is safe to expose, so
-- this is a pure narrowing of the existing `for all` policy, not a
-- two-policy split.
create policy "Reference links scoped to account" on public.reference_links
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 5): denies the `single` role entirely — zero rows on every
-- command. Dating history `notes` is free-text and unaudited for candour.
create policy "Date records scoped to account" on public.date_records
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 5): denies the `single` role entirely — zero rows on every
-- command. The redt history's own `note` field is shadchan/parent commentary.
create policy "Redts scoped to account" on public.redts
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

create policy "Shidduch schools scoped to account" on public.shidduch_schools
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Story 6.2 (AC 2): the resume-adjacent facts a single may see — a school
-- tied to a suggestion that passes AC-1's three-part test. SELECT-only,
-- additive to the policy above (the two-policy pattern, Dev Notes).
create policy "Shidduch schools visible to single" on public.shidduch_schools
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and exists (
            select 1
            from public.shidduchim s
                join public.singles c on c.id = s.single_id
            where s.id = shidduch_schools.shidduchim_id
              and s.visibility = 'shared'
              and public.is_single_visible_state(s.pipeline_state)
              and c.member_id = public.current_member_id()
        )
    );

-- Story 5.6: same shape as "Shidduch schools scoped to account" above — a
-- URL bookmark is not sensitive data, so there is no sensitivity tier and no
-- role check, only account scoping.
--
-- Story 6.3 (AC 1): denies the `single` role entirely, all the same — a link
-- bookmark attached during diligence is candid by construction (it names
-- what was uploaded/found during the diligence pass), with no per-row
-- visibility column to narrow on. Pure narrowing of the existing `for all`
-- policy, not a two-policy split.
create policy "Shidduchim external links scoped to account" on public.shidduchim_external_links
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Pipeline transitions are static, non-tenant reference data (the legal
-- state graph). Read-only for authenticated users; seeded by migration.
create policy "Pipeline transitions readable" on public.pipeline_transitions
    for select to authenticated
    using (true);

alter table public.interactions enable row level security;
alter table public.interactions force row level security;
alter table public.identity_signals enable row level security;
alter table public.identity_signals force row level security;

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
-- Story 6.3 (AC 2): denies the `single` role by default on every command —
-- private parent notes, the full activity/status-change timeline, and the
-- 5.9-migrated shadchan commentary (target_type = 'shadchan') all live here.
-- `and public.current_member_role() <> 'single'` is ANDed onto the WHOLE
-- predicate (not one branch), so a single sees zero interaction rows of any
-- kind at the end of this story — Story 6.4 carves the one narrow exception.
create policy "Interactions readable within account and parent visibility" on public.interactions
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
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
                    or (
                        -- Story 8.5 (Task 8, AC-9): own-account scoping, same
                        -- shape as shadchan/single above — the top-level
                        -- `account_id = current_context_id()` already keys
                        -- this row to the CALLER's own account; this exists()
                        -- only confirms the caller is legitimately a party of
                        -- the named connection (either side, no `status =
                        -- 'accepted'` filter — annotating an ended
                        -- connection's history is legitimate, Story 8.2 Dev
                        -- Notes). Never widens visibility ACROSS accounts
                        -- (AD-20): the other party reads their OWN
                        -- interactions row about this same connection, never
                        -- this one.
                        target_type = 'connection'
                        and exists (
                            select 1
                            from public.connections c
                            where c.id = interactions.target_id
                              and (
                                c.household_account_id = public.current_context_id()
                                or c.shadchanus_account_id = public.current_context_id()
                              )
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

-- Story 6.3 (AC 2): the same deny-the-single-role-by-default clause as the
-- SELECT policy above, ANDed onto the whole predicate.
--
-- Story 6.4 (AC 1/AC 7): `and kind <> 'single_input'` is ANDed on below,
-- alongside the `<> 'single'` role clause, so no non-single path can ever
-- create a `single_input` row — that kind has exactly one INSERT path, the
-- narrow "Single adds input on a visible suggestion" policy just below,
-- never this general one. Without this clause a `parent_admin`/`helper`
-- could plant words into a single's own input feed, which is exactly the
-- forgery AC 2's attribution guarantee exists to rule out.
create policy "Interactions insertable within account and parent visibility" on public.interactions
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
        and kind <> 'single_input'
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
                    or (
                        -- Story 8.5 — see the mirror comment on the SELECT
                        -- policy above; identical shape, own-account scoping.
                        target_type = 'connection'
                        and exists (
                            select 1
                            from public.connections c
                            where c.id = interactions.target_id
                              and (
                                c.household_account_id = public.current_context_id()
                                or c.shadchanus_account_id = public.current_context_id()
                              )
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

-- Story 6.4 (AC 1, AC 2, AC 4, AC 7): the one narrow hole in Story 6.3's
-- "deny `single` by default" wall — additive two-policy pattern (Dev Notes),
-- deliberately no UPDATE or DELETE policy for `single` anywhere on this
-- table (AC 3's append-only rule).
--
-- SELECT: a single reads back only their OWN `single_input` rows — not a
-- sibling's, not any other `kind`. `actor_member_id = current_member_id()`
-- is the whole boundary; it is safe to compare directly here (unlike the
-- INSERT policy's identical-looking clause below) because a stored row's
-- `actor_member_id` was already stamped by `set_interaction_actor_member_id`
-- at insert time and is not client-writable afterward (06_grants.sql column
-- grant omits it) — there is no forgery window on the read side.
create policy "Single reads own input" on public.interactions
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and kind = 'single_input'
        and actor_member_id = public.current_member_id()
    );

-- INSERT: a single may add `single_input` on a suggestion they can see under
-- Story 6.2's own visibility rule (own singles row, visibility = 'shared',
-- is_single_visible_state(pipeline_state)) — the identical three-clause
-- join "Shidduchim visible to single" (above) already proved, never
-- re-derived. `actor_member_id = current_member_id()` is satisfied BY
-- CONSTRUCTION here: `set_interaction_actor_member_id` (04_triggers.sql) is
-- a BEFORE INSERT trigger, so it has already overwritten whatever the
-- client sent by the time this WITH CHECK evaluates — the clause pins the
-- policy against a future weakening of that trigger rather than doing any
-- live forgery-detection work of its own today.
create policy "Single adds input on a visible suggestion" on public.interactions
    for insert to authenticated
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and kind = 'single_input'
        and actor_member_id = public.current_member_id()
        and target_type = 'shidduch'
        and scope = 'shidduch'
        and exists (
            select 1
            from public.shidduchim s
                join public.singles c on c.id = s.single_id
            where s.id = interactions.target_id
              and s.visibility = 'shared'
              and public.is_single_visible_state(s.pipeline_state)
              and c.member_id = public.current_member_id()
        )
    );

-- The UPDATE policy alone gains AC 3's author-or-owning-role clause,
-- `and (kind not in ('note', 'single_input') or (kind = 'note' and
-- public.can_moderate_note(actor_member_id)))`, ANDed onto the same
-- visibility predicate above, in BOTH `using` and `with check`:
--   `using`      — AC 4's own observable is a ZERO ROWS AFFECTED update,
--                   not a raised error. A with-check-only clause would
--                   raise instead of silently filtering the row out of the
--                   caller's UPDATE.
--   `with check` — so the update cannot re-point a row into a shape the
--                   caller was never allowed to target in the first place.
-- The `kind not in ('note', 'single_input')` escape means every OTHER
-- interaction kind (call_logged, status_change, merge, link_created,
-- link_removed — 01_tables.sql) keeps today's plain account-scoped update
-- behaviour unchanged; `note` alone reaches `can_moderate_note()`, and
-- `single_input` satisfies neither branch, so it is denied to every role —
-- including its own author and a `parent_admin` — full stop.
--
-- Story 6.4 (AC 3) narrows this from what Story 5.7's review-fix pass
-- (finding F2) shipped: F2 added `single_input` to the SAME bucket as
-- `note` (`kind not in ('note', 'single_input') or
-- can_moderate_note(actor_member_id))`), so the author or an owning-role
-- member could still edit or soft-delete a single's submitted words —
-- exactly the shape a `note` has. That stopped a HELPER rewriting the
-- single's voice, but left the single free to revise their own past input,
-- and an owning-role member free to "correct" it — both of which put words
-- in the single's mouth that were not there when they hit submit. This
-- story decides append-only instead (Dev Notes "Append-only — decided,
-- against a shipped nuance", story 6-4-the-singles-input.md): a
-- `single_input` row records what was said at the time, not a draft to be
-- revised, so `kind = 'single_input'` is carved OUT of `can_moderate_note`'s
-- reach with `(kind = 'note' and can_moderate_note(...))` rather than
-- calling that function on it at all. `can_moderate_note()` itself needed
-- no change — the exclusion lives entirely in this policy's own clause —
-- and the `note` behaviour it still governs is completely untouched.
-- Story 6.3 (AC 2): the same deny-the-single-role-by-default clause as the
-- SELECT/INSERT policies above, ANDed onto the whole predicate in BOTH
-- `using` and `with check` — not merely one of the two, for the same reason
-- the surrounding comment already states (a `using`-only clause silently
-- filters, `with check` stops re-pointing a row into a shape the caller was
-- never allowed to target). Moot for `single_input` specifically now that no
-- role reaches it through this policy at all, but the `single` role is
-- still denied on every OTHER kind through this exact clause, so it stays.
create policy "Interactions updatable by author or owning role" on public.interactions
    for update to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
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
        and (kind not in ('note', 'single_input')
             or (kind = 'note' and public.can_moderate_note(actor_member_id)))
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
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
        and (kind not in ('note', 'single_input')
             or (kind = 'note' and public.can_moderate_note(actor_member_id)))
    );

-- identity_signals is READ-ONLY to clients. It is written exclusively by the
-- SECURITY DEFINER sync triggers, because a client that could write its own
-- match keys could make matchIdentity() point anywhere. Reads stay
-- account-scoped (PRV-2: identity is never pooled across accounts).
--
-- Story 6.2 (AC 5): denies the `single` role entirely. This is an internal
-- match-key store spanning EVERY matchable entity in the household (not
-- singles-row-scoped), so a naive per-single read would leak cross-sibling
-- signals — SELECT-only, so the `<> 'single'` clause narrows `using` alone.
create policy "Identity signals readable within account" on public.identity_signals
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Billing (E4). subscription and ai_usage are SELECT-only for the account
-- owner — a member may read their own entitlement and usage meter, nothing
-- else. There is deliberately NO insert/update/delete policy on either table:
-- with RLS enabled and no write policy, authenticated cannot write at all, so
-- there is no client-callable path to self-grant entitlement (set plan='ai' or
-- status='active'). Every write is service_role (payment webhook / the AI edge
-- functions incrementing the meter), which bypasses RLS. This is the tenant
-- half of what makes ai_entitlement() unforgeable from the browser.
--
-- Story 6.2 (AC 5) denies the `single` role on both: billing/entitlement is
-- household-owner business.
alter table public.subscription enable row level security;
alter table public.subscription force row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

create policy "Subscription readable within account" on public.subscription
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

create policy "AI usage readable within account" on public.ai_usage
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Epic 11 Findings 6/7/8 closure. RLS enabled, ZERO client policies — not
-- even SELECT. With RLS on and no policy, authenticated has no visible rows
-- even if a grant were ever mistakenly added — belt-and-suspenders on top
-- of the grants in 06_grants.sql. Every access to this table goes through
-- claim_ai_parse_attempt() / confirm_ai_parse_attempt() /
-- release_ai_parse_attempt() (02_functions.sql), all SECURITY DEFINER +
-- service_role-only, which bypass RLS by design. No story needs a client to
-- read this table directly.
alter table public.ai_parse_attempts enable row level security;
alter table public.ai_parse_attempts force row level security;

-- Story 12.4 (AC-3). Same shape as ai_parse_attempts above: RLS enabled,
-- ZERO client policies — not even SELECT. The webhook that writes it, and
-- everything downstream (the future reconciliation sweep, if any ships),
-- runs as service_role, which bypasses RLS. No story needs a client to read
-- raw Stripe event metadata directly, and there is deliberately no path for
-- one to try.
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;

-- Inbox items (Epic 2): full CRUD within the caller's account. Insert/update
-- are with-check-scoped so a client can capture (share/upload) and resolve its
-- own items but never read, write, or resolve another account's captures. The
-- inbound-email webhook writes as service_role (RLS-exempt).
--
-- Story 6.2 (AC 5): denies the `single` role entirely — zero rows on every
-- command. Raw, pre-confirm captures; the least triaged, most candid layer
-- in the product (AD-6).
alter table public.inbox_items enable row level security;
alter table public.inbox_items force row level security;

create policy "Inbox items scoped to account" on public.inbox_items
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- Files tab (Story 3.7, AC 2d): copies "Tasks scoped to account" verbatim.
-- entity_files is account-scoped like the rest of the domain and, like tasks
-- (Story 3.14), is NOT household-only: a shadchanus context must be able to
-- attach files to its own shadchan/shidduch rows from day one (Epic 8.5).
-- FORCE ROW LEVEL SECURITY — added by Story 15.3(b) retrofit.
alter table public.entity_files enable row level security;
alter table public.entity_files force row level security;

create policy "Entity files scoped to account" on public.entity_files
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- =====================================================================
-- MyShadchan — Communication (Epic 7: threads, AD-1, AD-3, AD-20, AD-22)
-- =====================================================================
--
-- FORCE ROW LEVEL SECURITY (Story 7.1 Task 5) — decided WITH evidence, per
-- the rule at 01_tables.sql / above: no OTHER table in this repo has it.
-- Query run on the local stack before deciding:
--
--   select rolname, rolbypassrls from pg_roles
--   where rolname in ('postgres', 'supabase_admin');
--
--     postgres        | t
--     supabase_admin  | t
--
-- `postgres` owns every table in this schema and carries BYPASSRLS, which
-- negates FORCE for anything running as postgres regardless (BYPASSRLS
-- always wins over FORCE, per the Postgres RLS documentation) — so
-- create_thread() (SECURITY DEFINER, owned by postgres, 02_functions.sql)
-- is completely unaffected by FORCE either way; this is exactly the
-- evidence Task 5 asked for before writing it. FORCE is shipped anyway: it
-- costs nothing (no behavioural change for the one write path that exists
-- today) and it is the AD-1-correct posture for four brand-new tables, all
-- landing in the same diff, with no legacy caller anywhere relying on
-- owner-bypass — the point at which "a single forced table would diverge"
-- (the objection recorded above and in 12-2-reminder-delivery.md's Task 3)
-- stops applying. 7.4 and 7.5 follow this decision rather than re-deciding
-- it.
alter table public.connections enable row level security;
alter table public.connections force row level security;
alter table public.threads enable row level security;
alter table public.threads force row level security;
alter table public.thread_participants enable row level security;
alter table public.thread_participants force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

-- Connections (AC-6): read-only to `authenticated` — a member of EITHER
-- side may see the connection exists. No INSERT/UPDATE/DELETE policy at
-- all: the consent workflow (Epic 8 Story 8.2) writes as service_role,
-- which bypasses RLS.
create policy "Connections visible to either side" on public.connections
    for select to authenticated
    using (
        household_account_id = public.current_context_id()
        or shadchanus_account_id = public.current_context_id()
    );

-- Threads (AC-1, AC-9, AC-11): SELECT delegates entirely to
-- thread_is_readable() — the one authority every Epic 7 policy below calls,
-- exactly as is_single_visible_state() is the one authority for its own
-- axis. No INSERT policy and no INSERT grant for `authenticated`
-- (06_grants.sql) — the review fix for Story 7.1's F2/F4, replacing the
-- "defense-in-depth" INSERT `with check` this story originally shipped.
-- That policy validated the scope axis but NOT AC-1's "subject reachable
-- from the thread's own scope" — proved live: an authenticated caller
-- inserted a thread naming ANOTHER account's shidduch as its subject, and
-- one naming a subject_id that does not exist at all, both of which
-- purge_polymorphic_dependents()'s AC-10 delete (keyed on subject_id) can
-- never clean up, since the delete only fires when the NAMED subject is
-- itself deleted. Separately, that policy was already unusable for the
-- real PostgREST client shape (`POST … Prefer: return=representation`,
-- i.e. `ra-data-postgrest`'s create()): thread_is_readable()'s own SELECT
-- re-query cannot see the row an INSERT…RETURNING is still inserting, so
-- every such call was denied regardless of the row's validity. threads
-- now matches the `connections` bare pattern exactly (Task 1): the ONLY
-- writer is create_thread() (SECURITY DEFINER, owned by `postgres`, which
-- needs no grant on its own table) or service_role. No UPDATE/DELETE
-- policy for `authenticated` either.
create policy "Threads readable per thread_is_readable" on public.threads
    for select to authenticated
    using (public.thread_is_readable(id));

-- Thread participants (AC-2, AC-8, AC-9, AC-11): same read authority as
-- threads above — a participant row is only ever as visible as its thread.
-- INSERT requires the CALLER to already be a listed participant of the
-- SAME thread: a same-account member can never add themselves to a
-- conversation they are not in (AC-8) — without this exists() clause any
-- same-account member could self-join any thread and Story 7.3's privacy
-- would be one INSERT away from bypassed. The initial rows come from
-- create_thread(), which is SECURITY DEFINER and unaffected. No
-- UPDATE/DELETE policy for `authenticated` in this story (7.5 adds
-- last_read_at writes through its own RPC).
--
-- The second exists() clause is the review fix for Story 7.1's F3:
-- create_thread() validates every participant id is an ACTIVE member of
-- current_context_id(), but this direct-insert policy originally checked
-- only the CALLER's own participation and the row's account_id — never
-- whose account the ADDED member_id actually belongs to. Proved live: an
-- existing participant added a member of a completely different account to
-- their own thread, and the row persisted (thread_participants_member_id_
-- fkey accepts any account_members.id, cross-account or not). No read leak
-- resulted (thread_is_readable() still gates on the READER's own context),
-- but Story 7.5 keys notification delivery off this exact table, and the
-- gap contradicted AC-2/AC-11's intent regardless.
create policy "Thread participants readable per thread_is_readable" on public.thread_participants
    for select to authenticated
    using (public.thread_is_readable(thread_id));

-- Story 7.4 (AC-6): the scope check widened from a single account-only
-- clause to a two-disjunct form accepting EITHER axis — the account clause
-- unchanged from 7.1, the connection clause delegating to
-- connection_is_active_for_caller() (Task 1's one shared authority). The two
-- exists() clauses below are UNCHANGED by this story: the "caller is already
-- a participant" check works identically for both axes (it only compares
-- thread_id/member_id, never account_id), and the "added member belongs to
-- the caller's own account" check (the F3 review fix, above) still names
-- `current_context_id()` literally — a cross-side addition through this
-- direct-INSERT path (as opposed to create_thread()'s own initial-participant
-- validation, which DOES admit either side per AC-3) remains denied. No
-- built UI reaches this path at all (Dev Notes, "Why the INSERT policy still
-- matters"), and no AC in this story exercises it on the connection axis, so
-- widening it is left to whichever future story gives thread_participants a
-- direct add-a-participant surface.
create policy "Thread participants insertable by an existing participant" on public.thread_participants
    for insert to authenticated
    with check (
        (
            (account_id = public.current_context_id() and connection_id is null)
            or (connection_id is not null and public.connection_is_active_for_caller(connection_id))
        )
        and exists (
            select 1 from public.thread_participants tp
            where tp.thread_id = thread_participants.thread_id
              and tp.member_id = public.current_member_id()
        )
        and exists (
            select 1 from public.account_members am
            where am.id = thread_participants.member_id
              and am.account_id = public.current_context_id()
              and am.status = 'active'
        )
    );

-- Messages (AC-4, AC-8, AC-9, AC-11): same read authority as threads above.
-- INSERT is participant-gated regardless of the thread's visibility (Story
-- 7.1 Dev Notes, "Why posting is participant-gated even on open threads")
-- — the SAME exists() shape as thread_participants' own INSERT policy
-- above, one authority for "is the caller in this conversation", not two.
-- No UPDATE/DELETE policy for `authenticated`: messages are append-only
-- (AC-4) — no Epic 7 AC asks for editing or deleting a sent message.
create policy "Messages readable per thread_is_readable" on public.messages
    for select to authenticated
    using (public.thread_is_readable(thread_id));

-- Story 7.4 (AC-6): the same two-disjunct scope widening as
-- thread_participants above, plus 7.1's participant-membership exists()
-- clause UNCHANGED — a connection-scoped message still requires the caller
-- to be a listed participant of that thread; this axis is not a relaxation
-- of AC-8. This is the policy AC-6's own falsifiable test names directly: a
-- real client-side INSERT through dataProvider.create("messages", …) by the
-- shadchan side of an accepted connection must succeed once this ships —
-- without it, the row is rejected here while thread_is_readable() (Task 2)
-- already reports it as readable once it exists, the exact half-migrated
-- shape that passes a service-role smoke test and breaks on the first real
-- user action.
create policy "Messages insertable by an existing participant" on public.messages
    for insert to authenticated
    with check (
        (
            (account_id = public.current_context_id() and connection_id is null)
            or (connection_id is not null and public.connection_is_active_for_caller(connection_id))
        )
        and exists (
            select 1 from public.thread_participants tp
            where tp.thread_id = messages.thread_id
              and tp.member_id = public.current_member_id()
        )
    );

-- =====================================================================
-- MyShadchan — Communication (Epic 7 Story 7.5: notification delivery)
-- =====================================================================
--
-- FORCE ROW LEVEL SECURITY — this story follows Story 7.1's decision above
-- rather than re-deciding it (Task 0): `postgres` and `supabase_admin` both
-- carry BYPASSRLS on this stack (evidence recorded at 7.1's FORCE block
-- above), so FORCE changes no behaviour for any SECURITY DEFINER function
-- here (every one of them owned by `postgres`) — it is shipped anyway, for
-- the identical reason 7.1 shipped it: two brand-new tables, landing in the
-- same diff, with no legacy caller anywhere relying on owner-bypass.
alter table public.message_notifications enable row level security;
alter table public.message_notifications force row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

-- message_notifications (AC-11): NO policy for `authenticated` at all — the
-- stricter form of the subscription/ai_usage no-write posture above, which
-- withholds even SELECT because this queue carries recipient email addresses
-- across every tenant. With RLS enabled and no policy, `authenticated` reads,
-- writes and deletes zero rows regardless of any table grant; 06_grants.sql
-- also withholds the grant outright, so neither layer alone regressing would
-- expose this table on its own.

-- push_subscriptions (AC-12): keyed on auth.uid() via the owning
-- account_members row — deliberately NOT current_member_id(). Registering a
-- device is not a tenant-data read: it must succeed whichever context
-- (household or shadchanus) happens to be active, and current_member_id()
-- only ever resolves the caller's CURRENTLY ACTIVE one. A member manages only
-- their own subscription rows, across every account they belong to.
create policy "Push subscriptions manageable by their own member" on public.push_subscriptions
    for all to authenticated
    using (
        exists (
            select 1 from public.account_members am
            where am.id = push_subscriptions.member_id
              and am.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.account_members am
            where am.id = push_subscriptions.member_id
              and am.user_id = auth.uid()
        )
    );

-- =====================================================================
-- MyShadchan — Reminders (Story 12.2: reminder delivery, AD-13)
-- =====================================================================
--
-- FORCE ROW LEVEL SECURITY on task_notifications — extends Story 7.5's
-- precedent above (message_notifications/push_subscriptions) rather than
-- re-deciding it: `postgres`/`supabase_admin` both carry BYPASSRLS on this
-- stack (evidence recorded at Story 7.1's FORCE block, top of this file),
-- so FORCE changes no behaviour for any SECURITY DEFINER function here
-- (every one of them owned by `postgres`) — shipped anyway for the same
-- reason 7.5 shipped it: a brand-new table, landing in this diff, with no
-- legacy caller anywhere relying on owner-bypass. (This story's own draft
-- text predates 7.5 and says no table in this schema uses FORCE — that was
-- true when written and is superseded by 7.5 having since landed it; this
-- table is task_notifications' closest twin — no `authenticated` policy at
-- all, recipient-email-bearing, service_role only — so it follows the newer
-- precedent rather than forking a second posture for one table.)
alter table public.task_notifications enable row level security;
alter table public.task_notifications force row level security;
alter table public.cron_heartbeat enable row level security;
alter table public.cron_heartbeat force row level security;

-- task_notifications (AC-8): NO policy for `authenticated` at all — the
-- stricter form of the subscription/ai_usage no-write posture above, which
-- withholds even SELECT because this queue carries recipient email
-- addresses across every tenant, and a client has no legitimate reason to
-- read a delivery queue at all. With RLS enabled and no policy,
-- `authenticated` reads, writes and deletes zero rows regardless of any
-- table grant; 06_grants.sql also withholds the grant outright, so neither
-- layer alone regressing would expose this table on its own.

-- cron_heartbeat (AC-9): readable by any signed-in member, deliberately.
-- Safe only because it holds no tenant data — no account_id column exists
-- to scope by — and because last_error is constrained to a bounded code by
-- record_cron_heartbeat() (02_functions.sql), never a raw provider response
-- body, stack trace or URL. No write policy: every write is service_role
-- (the cron Worker via record_cron_heartbeat()), which bypasses RLS.
create policy "Cron heartbeat readable by any signed-in member" on public.cron_heartbeat
    for select to authenticated
    using (true);

-- =====================================================================
-- MyShadchan — Shadchan Context (Epic 8 Story 8.2: consent-based connection)
-- =====================================================================
--
-- FORCE ROW LEVEL SECURITY — Story 7.1's decision (its own FORCE block
-- above), not re-decided here: `postgres`/`supabase_admin` both carry
-- BYPASSRLS on this stack, so FORCE changes no behaviour for any SECURITY
-- DEFINER function in this section (every one of them owned by `postgres`)
-- — shipped anyway, same reasoning as every other Epic 7/8 table: a
-- brand-new table, no legacy caller anywhere relying on owner-bypass.
alter table public.connection_invites enable row level security;
alter table public.connection_invites force row level security;

-- connection_invites (AC-2, AC-6): ONE select policy — the issuer manages
-- their own outstanding invites, exactly the scope create_connection_invite()/
-- revoke_connection_invite() operate under. No insert/update/delete policy
-- and no DML grant to `authenticated` at all (06_grants.sql): every write
-- goes through this story's SECURITY DEFINER functions, so a client can
-- never hand-craft an invite row with a chosen `expires_at` or `token_hash`
-- — the same no-client-write posture 7.4 set for `connections`. The
-- acceptor has NO select path here (AD-9's spirit: they authenticate via the
-- token in the URL, never via a table read) — preview_connection_invite()
-- is their one purpose-built read, SECURITY DEFINER, so it needs no policy
-- of its own to serve them.
create policy "Connection invites visible to their issuer" on public.connection_invites
    for select to authenticated
    using (inviter_account_id = public.current_context_id());

-- Story 13.1: child_grants RLS — the grant lifecycle table.
-- Proposer (granting household) manages their own grants (create/revoke/sever).
-- Grantee (receiving household) can SELECT accepted grants where they are the grantee.
-- No insert/update/delete policy for `authenticated` — all writes go through
-- SECURITY DEFINER functions (create_child_grant, revoke_child_grant,
-- accept_child_grant, sever_child_grant, regrant_child_grant).
-- The acceptor has NO direct select path to pending grants — they authenticate
-- via the token in preview_child_grant() (SECURITY DEFINER).
alter table public.child_grants enable row level security;
alter table public.child_grants force row level security;

create policy "Child grants visible to proposer" on public.child_grants
    for select to authenticated
    using (proposer_account_id = public.current_context_id());

create policy "Child grants visible to grantee when accepted" on public.child_grants
    for select to authenticated
    using (
        grantee_account_id = public.current_context_id()
        and status = 'accepted'
    );

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.1: publish a shadchan
-- listing)
-- =====================================================================

-- FORCE ROW LEVEL SECURITY — Story 7.1's decision (its own FORCE block
-- above), not re-decided here: `postgres`/`supabase_admin` both carry
-- BYPASSRLS on this stack, so FORCE changes no behaviour for any owner-run
-- path here — shipped anyway, and matters MORE for this table than any
-- prior one: `listings` also carries a deliberate blanket `anon` grant
-- (AD-21), and AD-1 requires FORCE on every table without exception.
alter table public.listings enable row level security;
alter table public.listings force row level security;

-- "Listings readable by anon" (AC-4, AC-5) — deliberate `using (true)`, the
-- entire point of AD-21: a row's existence IS what "published" means, so
-- every column in every row is safe for `anon` to read by construction (no
-- private column exists on this table at all, and none may ever be added —
-- see this story's Dev Notes "Security / RLS").
create policy "Listings readable by anon" on public.listings
    for select to anon
    using (true);

-- "Listings readable by owner" (shared by both branches — this story owns
-- it so 9.2 does not duplicate it): lets a shadchan, or 9.2's household
-- manager, see their own listing regardless of listing_type.
create policy "Listings readable by owner" on public.listings
    for select to authenticated
    using (account_id = public.current_context_id());

-- The `shadchan` branch only (AC-1, AC-2, AC-6, AC-7). Story 9.2 adds
-- separate, named `single`-branch policies for insert/update; Story 9.3
-- replaces the single-branch delete policy with the dignity-floor lock —
-- neither ever edits these three (Dev Notes "Policy ownership map").
create policy "Shadchan listings insert" on public.listings
    for insert to authenticated
    with check (
        listing_type = 'shadchan'
        and account_id = public.current_context_id()
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'shadchanus'
        )
        and exists (
            select 1 from public.account_members am
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid()
              and am.role = 'shadchan'
        )
    );

create policy "Shadchan listings update" on public.listings
    for update to authenticated
    using (
        listing_type = 'shadchan'
        and account_id = public.current_context_id()
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'shadchanus'
        )
        and exists (
            select 1 from public.account_members am
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid()
              and am.role = 'shadchan'
        )
    )
    with check (
        listing_type = 'shadchan'
        and account_id = public.current_context_id()
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'shadchanus'
        )
        and exists (
            select 1 from public.account_members am
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid()
              and am.role = 'shadchan'
        )
    );

create policy "Shadchan listings delete" on public.listings
    for delete to authenticated
    using (
        listing_type = 'shadchan'
        and account_id = public.current_context_id()
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'shadchanus'
        )
        and exists (
            select 1 from public.account_members am
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid()
              and am.role = 'shadchan'
        )
    );

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.2: publish a single's
-- listing)
-- =====================================================================

-- The `single` branch only (AC-1, AC-2, AC-3, AC-6, AC-8 of Story 9.2; the
-- lock clause below is Story 9.3's own amendment). FR103: "manager" means
-- exactly two roles against the target single's OWN household —
-- `parent_admin` (any single in the household) and `self_manager` (only the
-- single record that is themselves, via singles.member_id). A plain `single`
-- role or a `helper` can never publish (they only ever withdraw).
--
-- Story 9.3 amendment (AC-2): DROPPED and RECREATED here, not edited in
-- place — Postgres has no ALTER POLICY for a USING/WITH CHECK body, only a
-- full replace. The predicate below is 9.2's own, restated in full, plus
-- ONE additive clause at the end: `and not exists (... listing_withdrawal_
-- locks ...)`. Restated in full (not merely referenced) so a reviewer can
-- see the delta is additive, not a rewrite — 9-3's own Dev Notes name this
-- as the one place that story touches another story's SQL. The lock
-- table's own "Listing locks readable in account" SELECT policy and grant
-- (06_grants.sql) are what make this sub-select evaluable by
-- `authenticated` at all.
--
-- Deliberately a SEPARATE, named policy from "Shadchan listings insert"
-- above (never edited by this story) — Postgres combines multiple
-- permissive policies for the same command with OR (Dev Notes "Policy
-- ownership map across 9.1-9.3").
create policy "Single listings insert" on public.listings
    for insert to authenticated
    with check (
        listing_type = 'single'
        and account_id = public.current_context_id()
        and single_id in (
            select s.id from public.singles s
            where s.account_id = public.current_context_id()
        )
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'household'
        )
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'self_manager'
                  and s.id = listings.single_id
            )
        )
        and not exists (
            select 1 from public.listing_withdrawal_locks ll
            where ll.account_id = public.current_context_id()
              and ll.single_id = listings.single_id
        )
    );

-- Review fix (F1, BLOCKING): `using` MUST repeat the full manager predicate
-- against the OLD row — it is not safe to leave it narrow (tenant + branch
-- only), because `with check` alone evaluates the ATTACKER-CONTROLLED NEW
-- row. A self-manager with no listing of their own could otherwise `update
-- ... set single_id = <their own single>` on a SIBLING's row: a tenant-only
-- `using` lets the row be targeted, and `with check` on the resulting NEW
-- row is satisfied because the NEW single_id now points at the caller's own
-- record — silently un-publishing the sibling's real listing and re-pointing
-- its opted-in fields at the attacker. Repeating the predicate here means
-- `using` is evaluated against the row's CURRENT (OLD) single_id, so the
-- caller must already manage the row being targeted, before `with check`
-- ever gets a chance to evaluate what they are trying to turn it into. Both
-- clauses are needed: `using` refuses an unauthorized OLD row; `with check`
-- separately refuses repointing an authorized OLD row onto a single the
-- caller does NOT manage.
create policy "Single listings update" on public.listings
    for update to authenticated
    using (
        listing_type = 'single'
        and account_id = public.current_context_id()
        and single_id in (
            select s.id from public.singles s
            where s.account_id = public.current_context_id()
        )
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'household'
        )
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'self_manager'
                  and s.id = listings.single_id
            )
        )
    )
    with check (
        listing_type = 'single'
        and account_id = public.current_context_id()
        and single_id in (
            select s.id from public.singles s
            where s.account_id = public.current_context_id()
        )
        and exists (
            select 1 from public.accounts a
            where a.id = public.current_context_id() and a.kind = 'household'
        )
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'self_manager'
                  and s.id = listings.single_id
            )
        )
        -- Review fix (F1, BLOCKING, Story 9.3): the SAME lock check the
        -- insert policy carries, restated here for `with check`. Without
        -- it, a `parent_admin` repoints an UNLOCKED sibling's row onto a
        -- LOCKED single (`update listings set single_id = <locked>, ...`):
        -- `using` only ever sees the OLD row (the sibling's own, unlocked,
        -- authorized) so it never inspects the target being repointed TO,
        -- and this WITH CHECK clause is the only place the NEW row's
        -- single_id is evaluated. Omitting it here made the dignity-floor
        -- lock (AD-21) bypassable by UPDATE even though plain re-INSERT was
        -- already refused — the exact loop AD-21 names, reopened through a
        -- different statement. `listings.single_id` below resolves against
        -- the NEW row inside WITH CHECK, mirroring the insert policy's own
        -- clause verbatim.
        and not exists (
            select 1 from public.listing_withdrawal_locks ll
            where ll.account_id = public.current_context_id()
              and ll.single_id = listings.single_id
        )
    );

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.3: a single controls
-- their own listing)
-- =====================================================================

-- FORCE ROW LEVEL SECURITY (AD-1) — same reasoning as `listings` itself:
-- postgres/supabase_admin carry BYPASSRLS on this stack, so FORCE changes
-- nothing for any owner-run path here, but AD-1 requires it
-- unconditionally.
alter table public.listing_withdrawal_locks enable row level security;
alter table public.listing_withdrawal_locks force row level security;

-- SELECT only (Task 7): lets the manager's UI show "locked" honestly. There
-- is NO insert/update/delete policy for `authenticated` on this table,
-- ever — the absent DML grant (06_grants.sql) is AC-4's real boundary, not
-- this policy. The two SECURITY DEFINER functions
-- (lock_listing_on_single_withdrawal(), consent_to_republish_listing(),
-- both in 02_functions.sql) are the ONLY writers.
create policy "Listing locks readable in account" on public.listing_withdrawal_locks
    for select to authenticated
    using (account_id = public.current_context_id());

-- "Single listings delete" (AC-1, AC-3, AC-7): three roles may legitimately
-- delete a single's listing — `parent_admin` (a parent's own change of
-- mind) and a `single`/`self_manager` acting on their OWN record (the
-- second EXISTS branch, joining singles.member_id back to the caller).
-- Explicit parentheses around the two branches are load-bearing: an
-- unparenthesized `and ... and ... or ...` would bind as `(type and
-- account and parent_admin) or (subject)`, silently dropping the
-- listing_type/account_id guards from the second branch. This policy does
-- NOT decide who leaves a lock behind — that is the AFTER DELETE trigger's
-- own, narrower `role = 'single'` check (lock_listing_on_single_withdrawal,
-- 02_functions.sql); a `single` OR a `self_manager` may both delete here,
-- but only the plain `single` case leaves a lock (AC-6).
create policy "Single listings delete" on public.listings
    for delete to authenticated
    using (
        listing_type = 'single'
        and account_id = public.current_context_id()
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid() and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                  join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role in ('single', 'self_manager')
                  and s.id = listings.single_id
            )
        )
    );

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.5: revocable share links)
-- =====================================================================

-- FORCE ROW LEVEL SECURITY (AD-1) unconditionally, exactly like `listings`
-- and `listing_withdrawal_locks` above — postgres/supabase_admin carry
-- BYPASSRLS, so FORCE changes nothing for an owner-run path, but every
-- table gets it regardless.
alter table public.share_links enable row level security;
alter table public.share_links force row level security;

-- "Share links manager scoped" (Dev Notes "Why share links are
-- manager-scoped, not household-scoped"): a `share_links` row carries the
-- bearer token itself, and the `share/` Worker serves files to WHOEVER
-- presents that token using the service-role key — not the reader's own
-- rights. Widening this to the domain's usual blanket "scoped to account"
-- policy would let a `helper` or a plain `single` mint or read a token and
-- reach resume/photo bytes their role is denied everywhere else. Only the
-- two roles FR103 already trusts to publish a listing may create, list, or
-- revoke a share link: `parent_admin` (any single in the household) or
-- `self_manager` (their own record only). One `for all` policy — creating,
-- listing and revoking (an UPDATE, never a DELETE — Dev Notes "Does
-- revoking delete the log") all go through it. Both `using` and `with
-- check` carry the identical predicate, with explicit parentheses around
-- the two-branch OR (the 9.3 Task 4 operator-precedence lesson applies
-- here too — an unparenthesized `and ... or` would silently drop the
-- account_id guard from the second branch).
--
-- Hardening found in this story's own SQL suite (share_links.sql), not in
-- the ticket's own Task 1 SQL: `single_id in (select s.id from public.
-- singles s where s.account_id = public.current_context_id())` — mirrors
-- `listings`' own "Single listings insert"/"update" policies EXACTLY
-- (`05_policies.sql`'s 9.2 section above). Without it, a parent_admin's
-- WITH CHECK is satisfied by the FIRST disjunct alone (they genuinely ARE a
-- parent_admin — of their OWN account) regardless of which single_id the
-- row names, so a cross-account INSERT naming another household's single
-- was refused only by the composite `share_links_single_id_fkey` FK
-- (23503), never by RLS (42501) — safe in outcome (the row is still never
-- created) but the wrong layer doing the refusing, and NOT the same
-- "RLS is the real boundary, the FK is defense-in-depth" posture every
-- other policy in this domain keeps (Dev Notes "Why the cross-account
-- negative test still matters despite the composite FK", 9.2's own). This
-- clause makes the refusal come from RLS itself, matching that posture,
-- and closes the same gap for the self_manager branch's OWN clause too
-- (that branch's `s.id = share_links.single_id` already narrows to their
-- own record specifically, so this addition is redundant there but
-- harmless — consistency, not a second boundary).
create policy "Share links manager scoped" on public.share_links
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and single_id in (
            select s.id from public.singles s
            where s.account_id = public.current_context_id()
        )
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid() and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                  join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'self_manager' and s.id = share_links.single_id
            )
        )
    )
    with check (
        account_id = public.current_context_id()
        and single_id in (
            select s.id from public.singles s
            where s.account_id = public.current_context_id()
        )
        and (
            exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid() and am.role = 'parent_admin'
            )
            or exists (
                select 1 from public.account_members am
                  join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'self_manager' and s.id = share_links.single_id
            )
        )
    );

alter table public.share_access_log enable row level security;
alter table public.share_access_log force row level security;

-- "Share access log readable by link owner" (AC-8): the subquery runs
-- under `share_links`' own RLS (it is a plain correlated subquery, not
-- SECURITY DEFINER), so the manager scoping above narrows this too — a
-- helper or plain single who cannot see a share_links row cannot see its
-- access log either, even though this policy's own predicate never
-- mentions role. No insert/update/delete policy for `authenticated` at
-- all: the ONLY writer of this table is the `share/` Worker using the
-- service-role key, which bypasses RLS entirely (AD-7) — do not add one.
create policy "Share access log readable by link owner" on public.share_access_log
    for select to authenticated
    using (
        exists (
            select 1 from public.share_links sl
            where sl.id = share_access_log.share_link_id
              and sl.account_id = public.current_context_id()
        )
    );

-- =====================================================================
-- MyShadchan — Inbound Email Capture (Epic 11)
-- =====================================================================

-- Trusted senders: full CRUD within the caller's account, same shape as
-- "Inbox items scoped to account" above — the same trust domain (AD-6, the
-- candid capture layer this table gates). Denies `single` entirely, like
-- inbox_items, rather than the ownership-only check most other tables use.
alter table public.trusted_senders enable row level security;
alter table public.trusted_senders force row level security;

create policy "Trusted senders scoped to account" on public.trusted_senders
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

-- =====================================================================
-- MyShadchan — Open signup (age affirmation across a Google OAuth redirect)
-- =====================================================================

-- FORCE ROW LEVEL SECURITY (AD-1), matching `listings`/`share_links`/
-- `connection_invites` above — postgres/supabase_admin carry BYPASSRLS, so
-- FORCE changes nothing for check_signup_age()'s own owner-run UPDATE/
-- DELETE, but every anon-writable table gets it regardless.
alter table public.signup_intents enable row level security;
alter table public.signup_intents force row level security;

-- The only policy this table ever needs: `anon` may INSERT one row for an
-- email address it does not need to prove ownership of yet (see
-- signup_intents' own comment, 01_tables.sql, for why that is safe). The
-- `with check` bounds every column a client actually sends, not merely
-- `email` — an unconstrained `expires_at` would let a forged row outlive
-- the ten-minute window this table's whole safety argument depends on, and
-- `consumed_at is null` keeps a client from inserting a row that already
-- looks used. There is no SELECT/UPDATE/DELETE policy for `anon` or
-- `authenticated` at all — consuming and sweeping are check_signup_age()'s
-- job alone, running as the table owner (postgres), which needs no policy
-- of its own to do it.
create policy "Signup intents insertable by anon" on public.signup_intents
    for insert to anon
    with check (
        email is not null
        and consumed_at is null
        and expires_at <= now() + interval '10 minutes'
    );

-- =====================================================================
-- Analytics Events (Story 15.2) — First-party event collection for PRD §18
-- =====================================================================

-- Analytics events are append-only, account-scoped, with FORCE RLS.
-- No UPDATE/DELETE policies — events are immutable once stored.
alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

create policy "Analytics events selectable by account" on public.analytics_events
    for select to authenticated
    using (account_id = public.current_context_id());

create policy "Analytics events insertable by account" on public.analytics_events
    for insert to authenticated
    with check (account_id = public.current_context_id());

-- ---------------------------------------------------------------------------
-- Story 14.2 / 14.4 — account deletion and purge requests.
-- Transcribed from the live database; these existed only in migrations, which
-- is why `db diff` proposed dropping them.
--
-- Two of these are worth a second look and are recorded here rather than
-- silently reproduced: the original "Anon can create purge requests" policy
-- let an unauthenticated caller insert an arbitrary row, and "Service role
-- has full access" keyed off CURRENT_USER = 'postgres' (which never matches
-- a service_role connection). Both were fixed: the anon policy is now scoped
-- to `with check (status = 'pending' and verified_at is null)`, and the
-- service_role policy was removed (service_role has rolbypassrls = true, so
-- it was dead code). That reasoning originally also cited purge_requests
-- having relforcerowsecurity = false; FORCE is now on (below), which does not
-- revive the policy — BYPASSRLS beats FORCE, so service_role still bypasses.
-- ---------------------------------------------------------------------------

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
alter table public.purge_requests enable row level security;
alter table public.purge_requests force row level security;

create policy "Users can view their own deletion requests" on public.account_deletion_requests
    for select to authenticated
    using (requested_by_auth_uid = auth.uid());

create policy "Users can insert their own deletion requests" on public.account_deletion_requests
    for insert to authenticated
    with check (requested_by_auth_uid = auth.uid());

create policy "Users can update their own deletion requests" on public.account_deletion_requests
    for update to authenticated
    using (requested_by_auth_uid = auth.uid())
    with check (requested_by_auth_uid = auth.uid());

create policy "Users can delete their own deletion requests" on public.account_deletion_requests
    for delete to authenticated
    using (requested_by_auth_uid = auth.uid());

create policy "Anon can create purge requests" on public.purge_requests
    for insert to anon
    with check (
        status = 'pending'
        and verified_at is null
    );
