# Story 9.3: A single controls their own listing

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a single with a login,
I want to withdraw my listing,
so that my dignity floor is real.

## Position in Epic 9

**3rd of 5** (`9.1 → 9.2 → 9.3 (this story) → 9.4 → 9.5`).

**Hard dependency: 9.2, landed first.** A single's listing has to be publishable before it can
be withdrawn. This story adds:
- the `Single listings delete` RLS policy (9.1/9.2 deliberately left it unwritten),
- a new **lock table** (`public.listing_withdrawal_locks` — row exists = republication blocked)
  whose only writers are a `SECURITY DEFINER` trigger and RPC, making withdrawal **stick**
  against a manager who would otherwise just republish, and
- **replaces** 9.2's `Single listings insert` policy with a version that checks the new lock —
  this is the one place this story edits SQL another story wrote, and it is called out here
  precisely so it is not mistaken for scope creep.

**Depends on:**
- **9.2** — the `listings` table's single-type publish path.
- **Epic 6** for "a single with a login" actually existing (`account_members.role = 'single'`
  bound to a `singles` row via `member_id`) — without Epic 6, there is no distinct login for
  this story's authorization to target; today's schema has no `single` role in
  `account_members_role_check` at all (Epic 2 Story 2.2 adds it, per
  `1-3-rename-children-to-singles.md`'s cross-story note: *"Epic 2 (story 2.2) will add `single`
  to `account_members_role_check`"*).

**Why this is the sharpest story in the epic:** AD-21's own text warns about exactly the failure
mode this story exists to close:

> "A withdrawal by the single blocks republication until that single consents — otherwise the
> dignity floor is a loop a manager can simply re-publish out of."
> [Source: ARCHITECTURE-SPINE.md#AD-21]

A row-delete alone (FR105: "withdrawal removes the listing from search immediately") is not
enough on its own — 9.1's schema already guarantees that half for free (delete a row, `anon` can
no longer see it). What FR104's *"the withdrawal cannot be overridden by the parent"* actually
requires is a mechanism that **outlives the deleted row**, because once the row is gone there is
nothing left on `listings` to check against on the next publish attempt. That mechanism is the
lock table this story adds (a row in `listing_withdrawal_locks` = the single objected and has
not yet consented again — mirroring `listings`' own existence-is-state design).

## Acceptance Criteria

1. **A single with a login may always withdraw their own listing, regardless of who published
   it.** Given a listing about single S was published by S's `parent_admin`, when S (role
   `single` or `self_manager`, `member_id` matching their own `account_members.id`) deletes it,
   the delete succeeds — this holds even though 9.2 never granted S insert/update rights over
   that row.

2. **Withdrawal by the single blocks republication until the single consents again.** Given S
   (role `single`) withdraws their own listing, when their `parent_admin` subsequently attempts
   to publish a new listing for S, the insert is refused by RLS — not merely discouraged in the
   UI.

3. **The lock is set only by the single's own withdrawal, never by a parent's.** Given a
   `parent_admin` withdraws a listing about S (S never touched it), when the `parent_admin`
   republishes for S immediately afterward, the insert **succeeds** — a parent withdrawing their
   own publication is not the protected case, and must not be treated as if it were.

4. **Only the single may clear the lock — never the parent, never any other role.** Given S's
   listing is locked, when S calls the consent action, the lock clears and a subsequent
   `parent_admin` publish succeeds. Given a `parent_admin` (or `helper`, or any other member of
   the household) attempts to clear or forge the lock via raw DML — a direct `delete from
   public.listing_withdrawal_locks`, `insert into` it, or `update` of it, as `authenticated` —
   every such statement is refused, because `authenticated` holds **no DML grant on the lock
   table at all** (`select` only). Assert both the attempted raw `delete` (as the
   `parent_admin`'s JWT) and `has_table_privilege('authenticated',
   'public.listing_withdrawal_locks', 'INSERT'/'UPDATE'/'DELETE')` all false — the UI never
   offering the control is not the boundary, the absent grant is.

5. **Withdrawal removes the listing from search immediately.** Given a published single listing,
   when it is withdrawn, an immediate `anon`-role `select` on `public.listings` returns zero rows
   for that single (same mechanism as 9.1 AC-5 — a plain `DELETE`, no soft-delete).

6. **A self-manager's own withdrawal does not need the lock, and does not set it.** Given a
   self-manager (who is both their own manager and the single) withdraws their own listing, no
   `listing_withdrawal_locks` row is created for their singles record — there is no separate
   manager for the lock to protect against, so the absence of a lock row after their own
   withdrawal is correct, not a gap.

7. **Negative test — cross-account.** Given single S1 in household A and single S2 in household
   B, when S2 (role `single`, correctly authorized over their own row) attempts to delete S1's
   listing or clear S1's lock, both are refused.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: the lock table** (AC: 2, 3, 4, 6)
  - [ ] New table in `01_tables.sql` (a **table, not a column on `singles`** — see Dev Notes
        "Why a lock table, not a column on `singles`"; row exists = locked):
        ```sql
        create table public.listing_withdrawal_locks (
            single_id bigint primary key,
            account_id bigint not null,
            locked_at timestamp with time zone not null default now()
        );
        alter table public.listing_withdrawal_locks
            add constraint listing_withdrawal_locks_single_id_fkey
            foreign key (account_id, single_id) references public.singles(account_id, id)
            on delete cascade;
        ```
        The composite FK follows the domain's standard (`shidduchim_single_id_fkey` pattern) and
        cascades: a purged single (AD-15) takes their lock with them. No identity column, so no
        sequence to grant.
  - [ ] RLS: `enable row level security` **and** `force row level security` (AD-1). One policy
        only — `"Listing locks readable in account"`, `for select to authenticated using
        (account_id = public.current_context_id())` — so the manager's UI can show "locked"
        honestly (Task 7). **No insert/update/delete policy for `authenticated`, ever.**
  - [ ] Grants: `revoke all on table public.listing_withdrawal_locks from anon;` `grant select
        on table public.listing_withdrawal_locks to authenticated;` — `select` **only**; the
        absent DML grant *is* AC-4's security boundary. `grant all ... to service_role;`
        `singles`' own blanket `for all` policy (today's `"Children scoped to account"`, renamed
        by 1.3) is untouched — the lock deliberately lives outside any table `authenticated` can
        write.

- [ ] **Task 2 — The withdrawal-lock trigger (sole creator of a lock row)** (AC: 2, 3, 6, 7)
  - [ ] New function, `SECURITY DEFINER`, `search_path ''` — mirroring the
        `get_child_portal()` / `set_child_portal_token_defaults()` pattern (both deleted by
        Story 1.4 — read them from git history) for "one function that must act with elevated
        privilege and is therefore held to a higher review bar":
        ```sql
        create or replace function public.lock_listing_on_single_withdrawal()
            returns trigger
            language plpgsql
            security definer
            set search_path = ''
        as $$
        begin
          if old.listing_type = 'single' then
            if exists (
              select 1
              from public.account_members am
                join public.singles s on s.member_id = am.id
              where am.account_id = old.account_id
                and am.user_id = auth.uid()
                and am.role = 'single'
                and s.id = old.single_id
            ) then
              insert into public.listing_withdrawal_locks (account_id, single_id)
                values (old.account_id, old.single_id)
                on conflict (single_id) do nothing;
            end if;
          end if;
          return old;
        end;
        $$;

        create or replace trigger lock_listing_on_single_withdrawal
            after delete on public.listings
            for each row execute function public.lock_listing_on_single_withdrawal();
        ```
  - [ ] The `role = 'single'` check is deliberately exact, not `role in ('single',
        'self_manager')` — AC-6 requires a self-manager's own withdrawal to **not** set the
        lock. Do not widen this predicate "for consistency" with 9.2's publish check, which
        legitimately includes `self_manager` for a different reason (authorization to publish,
        not the withdrawal-lock trigger).
  - [ ] Because the function is `SECURITY DEFINER`, its internal `insert` bypasses the
        `authenticated` role's absent DML grant on the lock table — an ordinary
        (`SECURITY INVOKER`) trigger would hit that same absent grant and fail. The trigger runs
        as the function's owner, not as the deleting `authenticated` user.

- [ ] **Task 3 — The consent RPC (sole remover of a lock row)** (AC: 4, 7)
  - [ ] ```sql
        create or replace function public.consent_to_republish_listing(p_single_id bigint)
            returns void
            language plpgsql
            security definer
            set search_path = ''
        as $$
        begin
          delete from public.listing_withdrawal_locks ll
            where ll.account_id = public.current_context_id()
              and ll.single_id = p_single_id
              and exists (
                select 1
                from public.account_members am
                  join public.singles s on s.member_id = am.id
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role in ('single', 'self_manager')
                  and s.id = ll.single_id
              );
        end;
        $$;
        ```
        No matching row means no-op, not an error — mirrors the fail-closed style of
        `current_context_id()` (AD-19) rather than leaking existence information via an
        exception.
  - [ ] The role check is `in ('single', 'self_manager')` — wider than the trigger's, and
        deliberately so: only the subject themselves can ever match (the `member_id` join binds
        the caller to their own `singles` row), and a locked single whose role later changes to
        `self_manager` (persona lifecycle, Epic 2 Story 2.5) must still be able to clear their
        own lock — `'single'` alone would strand it. Publishing-as-self-manager while locked is
        still refused until they consent, which is coherent: consent is the explicit act.
  - [ ] Grants: `revoke all on function public.consent_to_republish_listing(bigint) from public,
        anon;` `grant execute on function public.consent_to_republish_listing(bigint) to
        authenticated;` `grant execute … to service_role;` — same pattern as
        `create_shidduch()`'s grant triplet in `06_grants.sql`.

- [ ] **Task 4 — RLS: withdrawal + the amended publish check** (AC: 1, 2, 3, 7)
  - [ ] `"Single listings delete"` on `public.listings` — note the **explicit parentheses**
        around the role alternatives; an unparenthesized `and … and … or …` would bind as
        `(type and account and parent_admin) or (subject)` and silently drop the
        `listing_type`/`account_id` guards from the second branch:
        ```sql
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
        ```
  - [ ] `drop policy "Single listings insert" on public.listings;` then recreate it as 9.2's
        version **plus** `and not exists (select 1 from public.listing_withdrawal_locks ll
        where ll.account_id = public.current_context_id() and ll.single_id =
        listings.single_id)`. (The lock table's own `select` policy and grant make this
        sub-select evaluable by `authenticated`.) This is the one edit to another story's SQL in
        this epic — see "Position in Epic 9" above; do not silently skip re-stating 9.2's whole
        predicate, the reviewer needs to see the delta is additive, not a rewrite.

- [ ] **Task 5 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_listing_withdrawal_lock`
  - [ ] Hand-check: confirm the `drop policy` + `create policy` pair for `"Single listings
        insert"` both appear (a `db diff` against a policy body change sometimes emits only the
        `create`, silently leaving two same-named policies in conflict — verify there is exactly
        one `"Single listings insert"` policy after migrating, via `select polname from
        pg_policies where tablename = 'listings';`).
  - [ ] Confirm the lock table's grants and `FORCE ROW LEVEL SECURITY` are present in the diff,
        and that **no** DML grant to `authenticated` on `listing_withdrawal_locks` slipped in
        (watch the fork's `alter default privileges … grant all on tables` block, exactly as
        9.1 Task 3 flags); add explicit `revoke`s by hand if the diff omitted them.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`,
        never `db push`.

- [ ] **Task 6 — Provider** (AC: 1, 4)
  - [ ] `providers/supabase/dataProvider.ts`: add a `consentToRepublishListing(singleId)` custom
        method calling the RPC — mirror `createShidduchViaRpc`'s shape (a thin wrapper around
        `getSupabaseClient().rpc(...)`, added to the object returned by the provider factory).
        `dataProvider.delete("listings", { id })` needs no wrapper — the trigger runs
        automatically as a database-side effect of the plain delete.
  - [ ] `providers/fakerest/`: FakeRest has no triggers, so emulate the lock explicitly — a small
        `internal/listingWithdrawal.ts` (mirroring the existing `internal/childPortal.ts` /
        `internal/shidduchCatch.ts` pattern of "logic that only exists as a Postgres
        trigger/function gets a hand-written FakeRest twin") that the FakeRest delete handler
        for `listings` calls, a `listing_withdrawal_locks` base resource (so the UI's lock read
        works in the demo build), and a `consentToRepublishListing` emulation for the RPC
        surface.

- [ ] **Task 7 — Components** (AC: 1, 4)
  - [ ] `listings/WithdrawSingleListingButton.tsx` — available to the single themselves
        (rendered when the viewer's own `member_id` matches the single's) regardless of who
        published it; calls `dataProvider.delete`.
  - [ ] `listings/ConsentToRepublishButton.tsx` — shown to the single only, when a
        `listing_withdrawal_locks` row exists for their own `singles` record; calls the new
        provider method. Never rendered for a `parent_admin` viewing their single's record —
        there is no button for them to even see, since they have no path to trigger it (AC-4).
  - [ ] On the manager's side (`listings/PublishSingleListingSection.tsx`, from 9.2): when a
        publish attempt is refused because of the lock, show a plain, honest message — the
        single withdrew this and must consent again before it can be republished — rather than a
        generic "not authorized" error. Source the "is it locked" fact from a
        `dataProvider.getList("listing_withdrawal_locks", { filter: { single_id } })` read (the
        table is `select`-able by any household member; only DML is withheld), not from parsing
        the RLS error text.

- [ ] **Task 8 — Tests** (AC: all)
  - [ ] Extend `supabase/tests/listings.sql`: every AC above needs its own named check. AC-4's
        raw-DML-refused check is the one most worth getting exactly right — assert it as a
        caught error from a **direct** `delete from public.listing_withdrawal_locks where
        single_id = ...` executed as the `parent_admin`'s role/JWT, not as a call through
        `consent_to_republish_listing()` with the wrong caller (that tests a different,
        also-necessary, distinct thing — test both). Include the `has_table_privilege` checks
        from AC-4 (all DML false for `authenticated`; everything false for `anon`).
  - [ ] Add the RPC's own negative test: `consent_to_republish_listing()` called by a
        `parent_admin` for their single is a silent no-op (no rows deleted, no error) — confirm
        the lock row still exists afterward, since the function fails closed rather than
        raising.
  - [ ] `has_function_privilege('anon', 'public.consent_to_republish_listing(bigint)',
        'EXECUTE')` must be **false** — this RPC is never anon-reachable.
  - [ ] Frontend: a test that `PublishSingleListingSection` renders the "must consent again"
        message rather than a generic error, and that `ConsentToRepublishButton` never renders
        for a `parent_admin` viewer.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        `npx prettier --check` on this story's changed files only.

## Dev Notes

### The loop this story exists to close, spelled out

Without this story, the sequence "parent publishes → single objects → single deletes the row →
parent publishes again" is not merely possible, it is the *default* behavior of 9.1+9.2 alone:
nothing on the (now-deleted) `listings` row survives to remember that the single objected, so the
next `insert` sails through the same RLS check that let the first one through. FR104's dignity
floor is only real if the objection **outlives the object it was about** — hence the lock lives
in its own table, whose rows a withdrawal creates rather than deletes, not anywhere on
`listings` itself.

### Why a lock table, not a column on `singles`

The obvious shape — `singles.listing_locked_by_single boolean` guarded by `revoke update
(listing_locked_by_single) ... from authenticated` — **does not work in Postgres**:
`authenticated` already holds a *table-level* `UPDATE` grant on `singles` (06_grants.sql), and
revoking a column privilege only removes column-level grants; it cannot carve a column out of a
standing table-level grant, so the revoke is a silent no-op and any `parent_admin`'s ordinary
`dataProvider.update("singles", …)` could clear the lock. The alternatives — dropping the
table-level grant and re-granting `singles` column by column (fragile: every future column must
remember to re-grant), or a column-freeze trigger — are both worse than putting the lock where
`authenticated` simply has no write path at all: its own table, `select`-only, written
exclusively by two `SECURITY DEFINER` functions. Existence-of-row = locked also matches how
`listings` itself models "published" (AD-21).

### Why a `SECURITY DEFINER` trigger, not an RLS `WITH CHECK` side-effect

Postgres RLS can gate whether a statement is allowed; it cannot make a `DELETE` on one table
*also* write to a different table as a side effect. The lock-setting therefore has to be a
trigger, and it has to run with elevated privilege (`SECURITY DEFINER`) because the table it
writes is intentionally unreachable by the `authenticated` role that fires the delete (Task 1's
withheld DML grant) — an ordinary trigger (`SECURITY INVOKER`, the default) would hit that same
absent grant and fail. This is the same reasoning `get_child_portal()` and
`set_child_portal_token_defaults()` established in this codebase for "a function needs to act
with more privilege than its caller has, in a tightly scoped, auditable way" (both deleted by
Story 1.4 — read them from git history).

### Why the delete policy allows three different roles, but the insert-lock check tests for one

Three roles may legitimately **delete** a single's listing: `parent_admin` (a parent's own
change of mind), `self_manager` (managing themselves), and `single` (FR104's protected case). All
three deletes are equally valid withdrawals. But only **one** of them — a plain `single` acting
on their own record — should leave the lock behind, because only that one represents "the
subject objected to something someone else did to them." A `parent_admin` withdrawing their own
publication needs no protection from themselves (AC-3); a `self_manager` withdrawing needs no
protection because there is no second party to protect against (AC-6). Keep these three cases
distinct in both the SQL and the test suite — collapsing them is the most likely way this story
regresses.

### Security / RLS

This is the most security-sensitive story in the epic: it adds a deliberately write-locked
table, two `SECURITY DEFINER` functions, and drops/recreates an existing policy.
`.claude/rules/security-triggers.md` mandates review; AC-4 and AC-7 are the required negative
tests, and both must exercise the **raw** client path (a direct DML/RPC call from the wrong
role), not only a component-level assertion that the "wrong" UI control doesn't render — a
missing button is not a security boundary.

### Migration workflow

Same as 9.1/9.2: schema-first, `DBUS_SESSION_BUS_ADDRESS=/dev/null` on every `npx supabase` call,
never `db reset`/`db push` [Source: AGENTS.md#Database-Management,
memory/supabase-cli-dbus-hang.md]. This story's migration is unusual in that it both adds new
objects **and** replaces an existing policy (`drop` + `create` for `"Single listings insert"`) —
treat the generated diff for that policy with the same suspicion `db diff` earns for renames in
general (AGENTS.md's phantom-diff warning): verify by querying `pg_policies` after migrating,
not by reading the diff file alone.

### Testing standards

`supabase/tests/listings.sql` runs only under `npm run test:unit:db`, outside `make test`
[Source: vitest.config.ts `db` project; makefile `test-unit` target]. AAA structure, ≥80%
coverage on new paths, negative tests exercise the actual client-facing boundary, not a proxy
for it [Source: .claude/rules/testing.md, .claude/rules/security-triggers.md].

### Project Structure Notes

- Schema changes: one new table (`listing_withdrawal_locks`) in `01_tables.sql`, two new
  functions in `02_functions.sql`, one trigger in `04_triggers.sql`, its policies plus one new
  and one replaced `listings` policy in `05_policies.sql`, grants in `06_grants.sql` — no new
  schema files.
- New FakeRest helper `providers/fakerest/internal/listingWithdrawal.ts`, following the existing
  `internal/<behavior>.ts` convention for hand-written emulations of Postgres-only logic.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.3-A-single-controls-their-own-listing]
- [Source: amendment-a2.md#A2.5] — FR104
- [Source: ARCHITECTURE-SPINE.md#AD-21] — the exact "blocks republication until consent" rule this story implements
- [Source: ARCHITECTURE-SPINE.md#AD-19] — fail-closed style precedent (`current_context_id()`)
- [Source: 9-2-publish-single-listing.md] — the policy this story replaces, and why "manager" excludes plain `single`
- [Source: 9-1-publish-shadchan-listing.md#Dev-Notes] — policy ownership map for `listings`
- [Source: supabase/schemas/02_functions.sql — `get_child_portal()`, `set_child_portal_token_defaults()`, both deleted by Story 1.4; read from git history] — the `SECURITY DEFINER` + `search_path ''` precedent this story follows
- [Source: supabase/schemas/06_grants.sql — the table-level `authenticated` grants] — why a column-level revoke on `singles` would be a no-op (Dev Notes "Why a lock table")
- [Source: 1-3-rename-children-to-singles.md] — confirms `children`→`singles`, and that Epic 2 Story 2.2 adds the `single` role
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity-and-access] — "dignity floor" definition
- [Source: .claude/rules/security-triggers.md] — negative-test requirement, raw-boundary testing
- [Source: AGENTS.md#Database-Management] — migration workflow

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
