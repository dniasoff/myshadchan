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
- a new column and its supporting trigger + RPC on `public.singles` that make withdrawal
  **stick** against a manager who would otherwise just republish, and
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
lock this story adds to `public.singles`.

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
   the household) attempts to write `singles.listing_locked_by_single` directly via any client
   path, the write is refused — this must hold even for a `parent_admin` attempting a raw
   `update singles set listing_locked_by_single = false`, not only through whatever UI action
   this story ships.

5. **Withdrawal removes the listing from search immediately.** Given a published single listing,
   when it is withdrawn, an immediate `anon`-role `select` on `public.listings` returns zero rows
   for that single (same mechanism as 9.1 AC-5 — a plain `DELETE`, no soft-delete).

6. **A self-manager's own withdrawal does not need the lock, and does not set it.** Given a
   self-manager (who is both their own manager and the single) withdraws their own listing, no
   lock is set on their `singles` row — there is no separate manager for the lock to protect
   against, so leaving `listing_locked_by_single = false` after their own withdrawal is correct,
   not a gap.

7. **Negative test — cross-account.** Given single S1 in household A and single S2 in household
   B, when S2 (role `single`, correctly authorized over their own row) attempts to delete S1's
   listing or clear S1's lock, both are refused.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: the lock column** (AC: 2, 3, 4, 6)
  - [ ] Add to `public.singles` (the post-1.3 name; this table is `children` until Epic 1 lands):
        ```sql
        alter table public.singles
            add column listing_locked_by_single boolean not null default false;
        ```
  - [ ] `revoke update (listing_locked_by_single) on table public.singles from authenticated;`
        — **column-level** revoke. `singles` already carries a blanket `for all to authenticated
        using (account_id = current_context_id())` policy with no role distinction (today's
        `"Children scoped to account"`, renamed `"Singles scoped to account"` by 1.3); that
        policy is row-level and cannot express "only this role may touch only this column," so
        the column-level `revoke` is the only thing standing between a `parent_admin`'s ordinary
        `dataProvider.update("singles", …)` call and a silent lock-clear. This is why AC-4 tests
        a **raw** update attempt rather than only the shipped UI: the UI never offering the
        control is not the security boundary, the revoked grant is.

- [ ] **Task 2 — The withdrawal-lock trigger (sole writer of `true`)** (AC: 2, 3, 6, 7)
  - [ ] New function, `SECURITY DEFINER`, `search_path ''` — mirroring the existing
        `get_child_portal()` / `set_child_portal_token_defaults()` pattern for "one function
        that must act with elevated privilege and is therefore held to a higher review bar":
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
              update public.singles
                set listing_locked_by_single = true
                where account_id = old.account_id and id = old.single_id;
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
  - [ ] Because the function is `SECURITY DEFINER`, its internal `update public.singles` bypasses
        the ordinary `authenticated`-role RLS/grant restrictions — this is exactly why the
        column-level `revoke` in Task 1 does not also block the trigger: the trigger runs as the
        function's owner, not as the deleting `authenticated` user.

- [ ] **Task 3 — The consent RPC (sole writer of `false`)** (AC: 4, 7)
  - [ ] ```sql
        create or replace function public.consent_to_republish_listing(p_single_id bigint)
            returns void
            language plpgsql
            security definer
            set search_path = ''
        as $$
        begin
          update public.singles s
            set listing_locked_by_single = false
            where s.account_id = public.current_context_id()
              and s.id = p_single_id
              and exists (
                select 1 from public.account_members am
                where am.account_id = public.current_context_id()
                  and am.user_id = auth.uid()
                  and am.role = 'single'
                  and am.id = s.member_id
              );
        end;
        $$;
        ```
        No matching row means no-op, not an error — mirrors the fail-closed style of
        `current_context_id()` (AD-19) rather than leaking existence information via an
        exception.
  - [ ] Grants: `revoke all on function public.consent_to_republish_listing(bigint) from public,
        anon;` `grant execute on function public.consent_to_republish_listing(bigint) to
        authenticated;` `grant execute … to service_role;` — same pattern as
        `create_shidduch()`'s grant triplet in `06_grants.sql`.

- [ ] **Task 4 — RLS: withdrawal + the amended publish check** (AC: 1, 2, 3, 7)
  - [ ] `"Single listings delete"` on `public.listings`, `for delete to authenticated using
        (listing_type = 'single' and account_id = public.current_context_id() and exists (
          select 1 from public.account_members am where am.account_id =
            public.current_context_id() and am.user_id = auth.uid()
            and am.role = 'parent_admin'
        ) or exists (
          select 1 from public.account_members am
            join public.singles s on s.member_id = am.id
          where am.account_id = public.current_context_id() and am.user_id = auth.uid()
            and am.role in ('single', 'self_manager') and s.id = listings.single_id
        ))`.
  - [ ] `drop policy "Single listings insert" on public.listings;` then recreate it as 9.2's
        version **plus** `and not coalesce((select s.listing_locked_by_single from
        public.singles s where s.account_id = public.current_context_id() and s.id =
        listings.single_id), false)`. This is the one edit to another story's SQL in this
        epic — see "Position in Epic 9" above; do not silently skip re-stating 9.2's whole
        predicate, the reviewer needs to see the delta is additive, not a rewrite.

- [ ] **Task 5 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_listing_withdrawal_lock`
  - [ ] Hand-check: confirm the `drop policy` + `create policy` pair for `"Single listings
        insert"` both appear (a `db diff` against a policy body change sometimes emits only the
        `create`, silently leaving two same-named policies in conflict — verify there is exactly
        one `"Single listings insert"` policy after migrating, via `select polname from
        pg_policies where tablename = 'listings';`).
  - [ ] Confirm the column-level `revoke update (listing_locked_by_single)` is present — `db
        diff` does not always surface column-level grant changes cleanly; if it is missing from
        the generated diff, add it by hand.
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
        for `listings` calls, and a `consentToRepublishListing` emulation for the RPC surface.

- [ ] **Task 7 — Components** (AC: 1, 4)
  - [ ] `listings/WithdrawSingleListingButton.tsx` — available to the single themselves
        (rendered when the viewer's own `member_id` matches the single's) regardless of who
        published it; calls `dataProvider.delete`.
  - [ ] `listings/ConsentToRepublishButton.tsx` — shown to the single only, when
        `listing_locked_by_single` is true on their own `singles` record; calls the new provider
        method. Never rendered for a `parent_admin` viewing their single's record — there is no
        button for them to even see, since they have no path to trigger it (AC-4).
  - [ ] On the manager's side (`listings/PublishSingleListingSection.tsx`, from 9.2): when a
        publish attempt is refused because of the lock, show a plain, honest message — the
        single withdrew this and must consent again before it can be republished — rather than a
        generic "not authorized" error. Source the "is it locked" fact from a `singles`
        `getOne`/`getList` read (the column is `select`-able by any household member; only
        `update` is column-revoked), not from parsing the RLS error text.

- [ ] **Task 8 — Tests** (AC: all)
  - [ ] Extend `supabase/tests/listings.sql`: every AC above needs its own named check. AC-4's
        raw-update-refused check is the one most worth getting exactly right — assert it as a
        caught exception from a **direct** `update public.singles set
        listing_locked_by_single = false ...` executed as the `parent_admin`'s role/JWT, not as
        a call through `consent_to_republish_listing()` with the wrong caller (that would test a
        different, also-necessary, but distinct thing — test both).
  - [ ] Add the RPC's own negative test: `consent_to_republish_listing()` called by a
        `parent_admin` for their single is a silent no-op (no rows updated, no error) — confirm
        by reading `listing_locked_by_single` unchanged afterward, since the function fails
        closed rather than raising.
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
on `public.singles`, a row that is not deleted by a withdrawal, rather than anywhere on
`listings` itself.

### Why a `SECURITY DEFINER` trigger, not an RLS `WITH CHECK` side-effect

Postgres RLS can gate whether a statement is allowed; it cannot make a `DELETE` on one table
*also* write to a different table as a side effect. The lock-setting therefore has to be a
trigger, and it has to run with elevated privilege (`SECURITY DEFINER`) because the column it
writes is intentionally unreachable by the `authenticated` role that fires the delete (Task 1's
column-level revoke) — an ordinary trigger (`SECURITY INVOKER`, the default) would hit that same
revoke and fail. This is the same reasoning `get_child_portal()` and
`set_child_portal_token_defaults()` already establish in this codebase for "a function needs to
act with more privilege than its caller has, in a tightly scoped, auditable way"
[Source: supabase/schemas/02_functions.sql].

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

This is the most security-sensitive story in the epic: it revokes a column-level grant, adds two
`SECURITY DEFINER` functions, and drops/recreates an existing policy.
`.claude/rules/security-triggers.md` mandates review; AC-4 and AC-7 are the required negative
tests, and both must exercise the **raw** client path (a direct `update`/`delete`/RPC call from
the wrong role), not only a component-level assertion that the "wrong" UI control doesn't render
— a missing button is not a security boundary.

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
[Source: vitest.config.ts:124, makefile:108]. AAA structure, ≥80% coverage on new paths, negative
tests exercise the actual client-facing boundary, not a proxy for it
[Source: .claude/rules/testing.md, .claude/rules/security-triggers.md].

### Project Structure Notes

- Schema changes append to the existing `singles` section of `01_tables.sql` (one new column)
  and the existing `listings` sections of `05_policies.sql` (one new policy, one replaced
  policy) and `02_functions.sql` (two new functions) — no new schema files.
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
- [Source: supabase/schemas/02_functions.sql — `get_child_portal()`, `set_child_portal_token_defaults()`] — the `SECURITY DEFINER` + `search_path ''` precedent this story follows
- [Source: 1-3-rename-children-to-singles.md] — confirms `children`→`singles`, and that Epic 2 Story 2.2 adds the `single` role
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity-and-access] — "dignity floor" definition
- [Source: .claude/rules/security-triggers.md] — negative-test requirement, raw-boundary testing
- [Source: AGENTS.md#Database-Management] — migration workflow

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
