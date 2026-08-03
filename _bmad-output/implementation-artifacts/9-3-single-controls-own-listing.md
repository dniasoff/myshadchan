---
baseline_commit: fc0ecbf
---

# Story 9.3: A single controls their own listing

Status: review

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
  this story's authorization to target. The role itself is already live: Epic 2 Story 2.2
  shipped `single` into `account_members_role_check` (`01_tables.sql:239-241` today reads
  `role in ('parent_admin', 'single', 'helper', 'self_manager', 'shadchan')`), and `singles`
  already carries `singles_member_id_fkey` — per `1-3-rename-children-to-singles.md`'s
  cross-story note, which named this as Epic 2's future work at the time it was written and is
  now simply past. What Epic 6 supplies is not the role's existence but the actual
  self-managing/single-login lifecycle this story's authorization logic exercises (a `single`
  or `self_manager` whose `singles.member_id` genuinely points back at their own membership).

**Why this is the sharpest story in the epic:** AD-21's own text warns about exactly the failure
mode this story exists to close:

> "A withdrawal by the single blocks republication until that single consents — otherwise the
> dignity floor is a loop a manager can simply re-publish out of."
> [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-21]

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

- [x] **Task 1 — Schema: the lock table** (AC: 2, 3, 4, 6)
  - [x] New table in `01_tables.sql` (a **table, not a column on `singles`** — see Dev Notes
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
  - [x] RLS: `enable row level security` **and** `force row level security` (AD-1). One policy
        only — `"Listing locks readable in account"`, `for select to authenticated using
        (account_id = public.current_context_id())` — so the manager's UI can show "locked"
        honestly (Task 7). **No insert/update/delete policy for `authenticated`, ever.**
  - [x] Grants: `revoke all on table public.listing_withdrawal_locks from anon;` `grant select
        on table public.listing_withdrawal_locks to authenticated;` — `select` **only**; the
        absent DML grant *is* AC-4's security boundary. `grant all ... to service_role;`
        `singles`' own blanket `for all` policy (today's `"Children scoped to account"`, renamed
        by 1.3) is untouched — the lock deliberately lives outside any table `authenticated` can
        write.

- [x] **Task 2 — The withdrawal-lock trigger (sole creator of a lock row)** (AC: 2, 3, 6, 7)
  - [x] New function, `SECURITY DEFINER`, `search_path ''` — mirroring the
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
  - [x] The `role = 'single'` check is deliberately exact, not `role in ('single',
        'self_manager')` — AC-6 requires a self-manager's own withdrawal to **not** set the
        lock. Do not widen this predicate "for consistency" with 9.2's publish check, which
        legitimately includes `self_manager` for a different reason (authorization to publish,
        not the withdrawal-lock trigger).
  - [x] Because the function is `SECURITY DEFINER`, its internal `insert` bypasses the
        `authenticated` role's absent DML grant on the lock table — an ordinary
        (`SECURITY INVOKER`) trigger would hit that same absent grant and fail. The trigger runs
        as the function's owner, not as the deleting `authenticated` user.

- [x] **Task 3 — The consent RPC (sole remover of a lock row)** (AC: 4, 7)
  - [x] ```sql
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
  - [x] The role check is `in ('single', 'self_manager')` — wider than the trigger's, and
        deliberately so: only the subject themselves can ever match (the `member_id` join binds
        the caller to their own `singles` row), and a locked single whose role later changes to
        `self_manager` (persona lifecycle, Epic 2 Story 2.5) must still be able to clear their
        own lock — `'single'` alone would strand it. Publishing-as-self-manager while locked is
        still refused until they consent, which is coherent: consent is the explicit act.
  - [x] Grants: `revoke all on function public.consent_to_republish_listing(bigint) from public,
        anon;` `grant execute on function public.consent_to_republish_listing(bigint) to
        authenticated;` `grant execute … to service_role;` — same pattern as
        `create_shidduch()`'s grant triplet in `06_grants.sql`.

- [x] **Task 4 — RLS: withdrawal + the amended publish check** (AC: 1, 2, 3, 7)
  - [x] `"Single listings delete"` on `public.listings` — note the **explicit parentheses**
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
  - [x] `drop policy "Single listings insert" on public.listings;` then recreate it as 9.2's
        version **plus** `and not exists (select 1 from public.listing_withdrawal_locks ll
        where ll.account_id = public.current_context_id() and ll.single_id =
        listings.single_id)`. (The lock table's own `select` policy and grant make this
        sub-select evaluable by `authenticated`.) This is the one edit to another story's SQL in
        this epic — see "Position in Epic 9" above; do not silently skip re-stating 9.2's whole
        predicate, the reviewer needs to see the delta is additive, not a rewrite.

- [x] **Task 5 — Generate and hand-check the migration** (AC: all)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_listing_withdrawal_lock`
  - [x] Hand-check: confirm the `drop policy` + `create policy` pair for `"Single listings
        insert"` both appear (a `db diff` against a policy body change sometimes emits only the
        `create`, silently leaving two same-named policies in conflict — verify there is exactly
        one `"Single listings insert"` policy after migrating, via `select polname from
        pg_policies where tablename = 'listings';`).
  - [x] Confirm the lock table's grants and `FORCE ROW LEVEL SECURITY` are present in the diff,
        and that **no** DML grant to `authenticated` on `listing_withdrawal_locks` slipped in
        (watch the fork's `alter default privileges … grant all on tables` block, exactly as
        9.1 Task 3 flags); add explicit `revoke`s by hand if the diff omitted them.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`,
        never `db push`.

- [x] **Task 6 — Provider** (AC: 1, 4)
  - [x] `providers/supabase/dataProvider.ts`: add a `consentToRepublishListing(singleId)` custom
        method calling the RPC — mirror `createShidduchViaRpc`'s shape (a thin wrapper around
        `getSupabaseClient().rpc(...)`, added to the object returned by the provider factory).
        `dataProvider.delete("listings", { id })` needs no wrapper — the trigger runs
        automatically as a database-side effect of the plain delete.
  - [x] `providers/fakerest/`: FakeRest has no triggers, so emulate the lock explicitly — a small
        `internal/listingWithdrawal.ts` (mirroring the existing `internal/childPortal.ts` /
        `internal/shidduchCatch.ts` pattern of "logic that only exists as a Postgres
        trigger/function gets a hand-written FakeRest twin") that the FakeRest delete handler
        for `listings` calls, a `listing_withdrawal_locks` base resource (so the UI's lock read
        works in the demo build), and a `consentToRepublishListing` emulation for the RPC
        surface.

- [x] **Task 7 — Components** (AC: 1, 4)
  - [x] `listings/WithdrawSingleListingButton.tsx` — available to the single themselves
        (rendered when the viewer's own `member_id` matches the single's) regardless of who
        published it; calls `dataProvider.delete`.
  - [x] `listings/ConsentToRepublishButton.tsx` — shown to the single only, when a
        `listing_withdrawal_locks` row exists for their own `singles` record; calls the new
        provider method. Never rendered for a `parent_admin` viewing their single's record —
        there is no button for them to even see, since they have no path to trigger it (AC-4).
  - [x] On the manager's side (`listings/PublishSingleListingSection.tsx`, from 9.2): when a
        publish attempt is refused because of the lock, show a plain, honest message — the
        single withdrew this and must consent again before it can be republished — rather than a
        generic "not authorized" error. Source the "is it locked" fact from a
        `dataProvider.getList("listing_withdrawal_locks", { filter: { single_id } })` read (the
        table is `select`-able by any household member; only DML is withheld), not from parsing
        the RLS error text.

- [x] **Task 8 — Tests** (AC: all)
  - [x] Extend `supabase/tests/listings.sql`: every AC above needs its own named check. AC-4's
        raw-DML-refused check is the one most worth getting exactly right — assert it as a
        caught error from a **direct** `delete from public.listing_withdrawal_locks where
        single_id = ...` executed as the `parent_admin`'s role/JWT, not as a call through
        `consent_to_republish_listing()` with the wrong caller (that tests a different,
        also-necessary, distinct thing — test both). Include the `has_table_privilege` checks
        from AC-4 (all DML false for `authenticated`; everything false for `anon`).
  - [x] Add the RPC's own negative test: `consent_to_republish_listing()` called by a
        `parent_admin` for their single is a silent no-op (no rows deleted, no error) — confirm
        the lock row still exists afterward, since the function fails closed rather than
        raising.
  - [x] `has_function_privilege('anon', 'public.consent_to_republish_listing(bigint)',
        'EXECUTE')` must be **false** — this RPC is never anon-reachable.
  - [x] Frontend: a test that `PublishSingleListingSection` renders the "must consent again"
        message rather than a generic error, and that `ConsentToRepublishButton` never renders
        for a `parent_admin` viewer.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
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
- New components `listings/WithdrawSingleListingButton.tsx`, `listings/ConsentToRepublishButton.tsx`
  land under `atomic-crm/listings/` — regenerate **`registry.json`** (`make registry-gen` /
  pre-commit hook) and declare it as touched, same reasoning as 9.1/9.2.
- **Both i18n catalogues** (`providers/commons/englishCrmMessages.ts`,
  `providers/commons/frenchCrmMessages.ts`) — the "must consent again" honest-refusal message
  (Task 7) and both new buttons' copy need a key in both catalogues in the same diff (C7); all
  three components render inside Settings (inside `<Admin>`), so `useTranslate()` applies
  normally.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.3-A-single-controls-their-own-listing]
- [Source: amendment-a2.md#A2.5] — FR104
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-21] — the exact "blocks republication until consent" rule this story implements
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-19] — fail-closed style precedent (`current_context_id()`)
- [Source: 9-2-publish-single-listing.md] — the policy this story replaces, and why "manager" excludes plain `single`
- [Source: 9-1-publish-shadchan-listing.md#Dev-Notes] — policy ownership map for `listings`
- [Source: supabase/schemas/02_functions.sql — `get_child_portal()`, `set_child_portal_token_defaults()`, both deleted by Story 1.4; read from git history] — the `SECURITY DEFINER` + `search_path ''` precedent this story follows
- [Source: supabase/schemas/06_grants.sql — the table-level `authenticated` grants] — why a column-level revoke on `singles` would be a no-op (Dev Notes "Why a lock table")
- [Source: 1-3-rename-children-to-singles.md] — confirms `children`→`singles`, and that Epic 2 Story 2.2 adds the `single` role
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity-and-access] — "dignity floor" definition
- [Source: .claude/rules/security-triggers.md] — negative-test requirement, raw-boundary testing
- [Source: AGENTS.md#Database-Management] — migration workflow

## Change Log

- 2026-08-03 — Implemented Story 9.3 end to end: the `listing_withdrawal_locks` table (Task 1),
  the `SECURITY DEFINER` withdrawal-lock trigger and consent RPC (Tasks 2, 3), the new `"Single
  listings delete"` policy and the amended (drop+recreate) `"Single listings insert"` policy
  (Task 4), the hand-checked migration (Task 5), the Supabase + FakeRest provider wiring (Task
  6), `WithdrawSingleListingButton.tsx` / `ConsentToRepublishButton.tsx` and the manager-side
  "must consent again" message (Task 7), and the full database + component + FakeRest test suite
  (Task 8). Status → review.

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), dispatched as the `developer`/bmad-dev-story agent on `STACK_ID=1`,
`STACK_OWNER=9-3`.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_listing_withdrawal_lock`
  — generated `supabase/migrations/20260803003946_add_listing_withdrawal_lock.sql`. Hand-checked
  and confirmed it contains the expected `drop policy "Single listings insert"` +
  `create policy "Single listings insert"` pair (Task 5's own requirement); confirmed via
  `select polname from pg_policies where tablename = 'listings'` that exactly one
  `"Single listings insert"` policy exists after migrating (no duplicate left behind).
- Hand-checked the diff and found (and fixed) three omissions `db diff` never emits, all
  documented inline in the migration file itself: (1) `FORCE ROW LEVEL SECURITY` on
  `listing_withdrawal_locks` — present in `05_policies.sql` but silently dropped from the
  generated diff, exactly the class of drift AGENTS.md warns about; (2) the table-level
  `revoke all ... from anon, authenticated` — the "declared shadow" build applies
  `06_grants.sql`'s `alter default privileges` statements *after* `01_tables.sql` creates the
  table, so migra never sees a diff to emit here, but on the REAL database (where that
  default-privilege statement is fork-era, standing catalog state) a bare `CREATE TABLE` would
  silently auto-grant `authenticated` full DML — the exact F1 finding Story 9.1's own migration
  hit for `listings`, reproduced and closed the same way; (3) the three function-grant
  statements for `consent_to_republish_listing(bigint)` (`db diff` never re-emits function
  grants either, though empirically these turn out to be redundant with the same
  fork-era default privilege — added explicitly anyway, matching this codebase's own convention
  of never relying on an inferred default).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` run twice — both reported
  "No schema changes found" (clean, convergent).
- Verified the live grants/RLS state directly against the migrated database (not merely the
  schema-file text): `has_table_privilege('authenticated', 'public.listing_withdrawal_locks',
  'select'|'insert'|'update'|'delete'|'truncate'|'references'|'trigger')` is
  true/false/false/false/false/false/false respectively; `anon` holds nothing at all;
  `relrowsecurity`/`relforcerowsecurity` both true; `has_function_privilege('anon',
  'public.consent_to_republish_listing(bigint)', 'execute')` is false,
  `has_function_privilege('authenticated', ...)` is true.
- `supabase/tests/listings.sql` run directly via `psql`: 90 checks total (60 pre-existing
  9.1/9.2 checks + 30 new Story 9.3 checks), all green.
- Mutation-proved two of the most security-sensitive checks live against the local stack, then
  reverted both: (1) temporarily `grant delete on table public.listing_withdrawal_locks to
  authenticated` — flips 3 of the AC-4 raw-DML checks red (the DELETE statement no longer raises
  a permission error), while the actual lock row survives untouched regardless, because RLS's
  own absent delete-policy is a SECOND, independent backstop even when the grant leaks —
  structural defense-in-depth the mutation test surfaces empirically, not merely asserted; (2)
  temporarily widened the trigger's role predicate to `role in ('single', 'self_manager')` —
  flips the AC-6 "no lock on a self-manager's own withdrawal" check red exactly as expected.
  Restored both to the committed state afterward; re-ran the full suite (90/90 green) to confirm
  the restore was exact.
- `npm run test:unit:db` — 34 files / 1266 tests, all pass (`listings.test.ts` alone: 91 tests —
  the 90 SQL checks plus the file's own "runs every 9.1/9.2/9.3 check group" floor assertion,
  bumped from 60 to 90).
- `npx vitest run` (unscoped, `make test` equivalent) — 264 files / 3184 tests, all pass.
- `make check-migration-safety STACK_ID=1` — reproduced the SAME pre-existing failure 9.1's and
  9.2's own Dev Agent Records already documented and independently re-confirmed here rather than
  merely cited: `fixture.sql:533`'s `connections` seed is missing the NOT NULL
  `proposed_by_account_id` column. Traced the constraint directly to
  `supabase/migrations/20260802175028_connections_shadchan_crm.sql` (Story 8.5, predates every
  Epic 9 migration including this one's five). `git diff HEAD -- supabase/tests/migration-data
  -safety/fixture.sql` is empty (this story never touches that file), and the failure occurs
  during the guard's own SEED step, which runs against the *last-deployed* migration baseline —
  strictly *before* any of this story's five pending migrations are ever applied — so it is
  structurally impossible for this story's diff to be the cause. Reported, not fixed, per
  `.claude/rules/parallel-ownership.md` and 9.1/9.2's own precedent for the identical finding.
- `make test STACK_ID=1` (a fresh, isolated Supabase stack, `STACK_OWNER=9-3`, built from every
  migration in `supabase/migrations/` from scratch, independent of the long-lived dev stack) —
  264 files / 3184 tests, all pass. Stack released afterward
  (`make stop-supabase-e2e STACK_ID=1`).
- `make typecheck`, `make lint` (ESLint + `prettier --config ./.prettierrc.json --check`),
  `make build`, and `make registry-gen` all pass/clean. Bare `npx prettier --check .` (no
  `--config`) flags the same 16 pre-existing files 9.1's/9.2's own Dev Agent Records already
  named (`.github/workflows/*.yml`, `doc/src/content/docs/**/*.mdx`, `.lintstagedrc`) — none
  touched by this story. All four CI guards (suppression ratchet, retired-name, route-convention,
  Tailwind v3-syntax) are green.

### Completion Notes List

- All 7 ACs implemented and covered. AC-1 (single withdraws own listing regardless of publisher)
  and AC-5 (immediate anon disappearance) by `supabase/tests/listings.sql`'s new Story 9.3
  checks plus `WithdrawSingleListingButton.test.tsx`. AC-2 (withdrawal blocks republication) and
  AC-3 (a parent's own withdrawal does not lock, and republishes freely) by the SQL suite plus
  `PublishSingleListingSection.test.tsx`'s new "must consent again" describe block. AC-4 (only
  the single may clear the lock — raw DML refused, RPC wrong-caller no-op, both privilege checks)
  by the SQL suite's raw-DML `do $$` blocks (mutation-proved) plus
  `ConsentToRepublishButton.test.tsx`'s self+role double-gate test. AC-6 (self-manager's own
  withdrawal sets no lock) by the SQL suite (mutation-proved) plus
  `internal/listingWithdrawal.test.ts`'s and `dataProvider.listingWithdrawal.test.ts`'s own
  FakeRest-mirror equivalents. AC-7 (cross-account) by the SQL suite's S2-vs-S1 checks plus
  `internal/listingWithdrawal.test.ts`'s own cross-account no-op test.
- **Two omissions the pre-flight/refresh pass did not need to touch, found and fixed while
  reading the actual codebase rather than assumed:** (1) `useListingUpsert.ts`'s own doc comment
  on `withdraw()` still said "the `single` branch has no delete policy yet" — now stale the
  moment this story's migration lands; corrected in place rather than left to rot, since a wrong
  comment right next to the very code this story changes the behavior of is worse than no
  comment. (2) `PublishSingleListingSection.tsx`'s header comment claimed it "offers NO
  withdrawal action (Story 9.3's — there is no policy yet)"; updated to point at
  `WithdrawSingleListingButton.tsx`'s actual, now-shipped home.
  Both are in this story's own File List, not a separate excursion.
  - Actual RPC/DB behavior was verified empirically (has_table_privilege / has_function_privilege
    / mutation tests against the live local stack), not assumed from the schema text alone —
    the one surprising finding worth flagging: `listing_withdrawal_locks`'s RLS (no delete
    policy at all) and its grant (no DML at all) are two INDEPENDENT boundaries. Granting DELETE
    back to `authenticated` (simulated via mutation test) does not actually let a row be deleted,
    because RLS's own absence of a delete policy still excludes every row from the DELETE's
    target set — genuine defense in depth, not merely two copies of the same rule.
- **Frontend architecture decision:** `WithdrawSingleListingButton.tsx` and
  `ConsentToRepublishButton.tsx` are both self-contained, self-gating components (own
  `useCurrentMemberId()`/`useViewerRole()`/data-fetch calls, render `null` when the viewer isn't
  the subject) — mirroring `SingleLoginInvite.tsx`'s established self-gating pattern — rather
  than accepting a `listing`/`lock` prop from `SingleListingSection.tsx`'s own already-fetched
  lists. This trades a modest N+1 fetch cost (one extra `getList` per household row) for each
  button staying internally consistent after its own action (its own `refetch()` makes it
  disappear once nothing is left to act on) without depending on a sibling component's cache
  entry — the same imperfection (independent query-cache entries that don't cross-invalidate)
  9.2's own `PublishSingleListingSection.tsx`/`SingleListingSection.tsx` pair already has, not a
  new one introduced here.
- **Manager-side UI for AC-3's parent_admin withdrawal is intentionally not built in this
  story** — Task 7's own scope note reads "AC: 1, 4"; AC-3's parent_admin-withdraws case is
  proven at the database/RLS layer (`supabase/tests/listings.sql`), and the story's task list
  never asked for a manager-facing withdraw button inside `PublishSingleListingSection.tsx`. Not
  a gap — a deliberate scope boundary, consistent with `.claude/rules/coding-style.md`'s
  YAGNI note and this story's own declared file-set.
- FakeRest parity (Task 6): `internal/listingWithdrawal.ts`'s two functions mirror
  `lock_listing_on_single_withdrawal()`/`consent_to_republish_listing()` predicate-for-predicate,
  in the same order, following `internal/shidduchCatch.ts`'s "hand-written FakeRest twin"
  convention. `primaryKeys` had to be added to the Supabase provider's own
  `supabaseDataProvider(...)` config (`PRIMARY_KEYS` map) because `listing_withdrawal_locks` has
  no `id` column at all — the first resource in this codebase needing a non-default primary key;
  `@raphiniert/ra-data-postgrest`'s own `dataWithVirtualId()` mirrors `single_id` onto a
  client-side `id`, and the FakeRest mirror matches this shape by hand
  (`id: deletedListing.single_id` on create) so `ListingWithdrawalLock` fits `RaRecord` on both
  data providers identically.
- A genuine FakeRest engine quirk surfaced and worked around while writing
  `dataProvider.listingWithdrawal.test.ts`: `createDataProvider(db, ...)` snapshots `db` into its
  own internal store at construction time, so two SEPARATE provider instances built from the
  same `db` variable at different moments do NOT see each other's writes. Simulating "a
  different user calls next" against the same underlying store therefore needs ONE provider
  instance with a swappable identity closure, not two instances — documented inline in the test
  file for the next person who hits the same surprising 0-vs-1 assertion failure.

### File List

- `supabase/schemas/01_tables.sql` — new `listing_withdrawal_locks` table (Task 1), its composite
  FK, and its `account_id` index.
- `supabase/schemas/02_functions.sql` — `lock_listing_on_single_withdrawal()` (Task 2) and
  `consent_to_republish_listing(bigint)` (Task 3), both `SECURITY DEFINER`.
- `supabase/schemas/04_triggers.sql` — the `lock_listing_on_single_withdrawal` AFTER DELETE
  trigger on `public.listings`.
- `supabase/schemas/05_policies.sql` — `listing_withdrawal_locks`'s RLS (enable + force, one
  SELECT-only policy), the new `"Single listings delete"` policy, and the amended (drop +
  recreate) `"Single listings insert"` policy with the added lock check.
- `supabase/schemas/06_grants.sql` — the lock table's grants (select-only to `authenticated`, all
  to `service_role`, nothing to `anon`) and the consent RPC's grant triplet.
- `supabase/migrations/20260803003946_add_listing_withdrawal_lock.sql` — generated + hand-checked
  (FORCE ROW LEVEL SECURITY, the table-level revoke, and the function grants all hand-added; see
  Debug Log).
- `src/components/atomic-crm/types.ts` — `ListingWithdrawalLock` type.
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — `PRIMARY_KEYS` config
  (`listing_withdrawal_locks` → `single_id`) and `consentToRepublishListingViaRpc`, wired as
  `consentToRepublishListing`.
- `src/components/atomic-crm/providers/fakerest/internal/listingWithdrawal.ts` — the FakeRest
  mirrors of the trigger and the RPC.
- `src/components/atomic-crm/providers/fakerest/internal/listingWithdrawal.test.ts` — unit tests
  for both mirrors (AC-1, AC-3, AC-6, AC-7, idempotency, no-identity edge cases).
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — wires the `listings` delete
  handler to the lock trigger mirror, and exposes `consentToRepublishListing`.
- `src/components/atomic-crm/providers/fakerest/dataProvider.listingWithdrawal.test.ts` —
  end-to-end wiring tests against the real `createDataProvider` factory.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` /
  `dataGenerator/types.ts` — `db.listing_withdrawal_locks = []` (seeded empty, matching
  `listings`' own "opt-in, nothing published/locked by default" convention).
- `src/components/atomic-crm/listings/WithdrawSingleListingButton.tsx` — the single's own
  withdraw control (AC-1).
- `src/components/atomic-crm/listings/WithdrawSingleListingButton.test.tsx` — self-gating and
  click-behavior tests.
- `src/components/atomic-crm/listings/ConsentToRepublishButton.tsx` — the single's own
  consent-to-republish control (AC-4).
- `src/components/atomic-crm/listings/ConsentToRepublishButton.test.tsx` — self+role double-gate
  and click-behavior tests.
- `src/components/atomic-crm/listings/PublishSingleListingSection.tsx` — the "must consent
  again" honest-refusal message (AC-2), sourced from a fresh `getList` read at the point of
  failure; header comment corrected (see Completion Notes).
- `src/components/atomic-crm/listings/PublishSingleListingSection.test.tsx` — the two new
  "must consent again" vs. "generic error" tests.
- `src/components/atomic-crm/listings/useListingUpsert.ts` — doc comment on `withdraw()`
  corrected now that the `single` branch's delete policy exists (see Completion Notes).
- `src/components/atomic-crm/settings/SingleListingSection.tsx` — mounts both new buttons per
  row, alongside the existing canPublish-gated Publish/Manage dialog.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` /
  `frenchCrmMessages.ts` — `crm.settings.listing.consent_*` keys and
  `crm.settings.single_listing_form.locked_error`.
- `registry.json` — regenerated (`make registry-gen`) for the two new `listings/` components.
- `supabase/tests/listings.sql` — extended with Story 9.3's 30 new checks (AC-1 through AC-7,
  plus the Task 5 "exactly one policy" structural checks).
- `supabase/tests/listings.test.ts` — header comment updated for all three stories; the "floor"
  assertion raised from 60 to 90.
