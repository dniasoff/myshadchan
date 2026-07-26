# Story 6.1: A single joins the household

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to invite my single to their own login,
so that they can take part in their own process, on the same app, with their
access already scoped the moment they sign in.

## Position in Epic 6

**4th of 5 to build, despite being numbered 6.1.** This is the story that
produces a **real** `account_members` row with `role = 'single'` bound to a
live login — deliberately sequenced **after** Stories 6.2, 6.3 and 6.4, so
that by the time a real single can sign in, the row scoping, the field
scoping and the input write-path are already enforced. Building it first
would land a real single's first sign-in on whatever pre-Epic-6 policies
happened to exist — the gap Epic 1's own pinned-order lesson
(`1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6`) warns against. Precedes **Story 6.5**,
whose parity tests contrast this invite-provisioned link with the
self-managing provisioning path onto the same `singles.member_id` column.

**What Epic 2 already shipped** (Stories 2.7/2.8 — this story extends it,
never builds a parallel invite system):
- `public.invites` — `token uuid`, `email`, `account_id`, `role` (check:
  `parent_admin | helper | single | shadchan`), `invited_by`, `status`
  (`pending | accepted | revoked | expired`), `expires_at` (+14 days),
  `accepted_at`. RLS: account-scoped to the active context.
- `public.create_invite(p_email, p_role)` — the one invite-creation path;
  refuses non-owning callers, enforces `role_authority(p_role) ≤` caller's.
- Acceptance = OTP signup: `/accept-invite/:token` →
  `login/InviteAcceptance.tsx` (18+ affirmation) → Supabase signup carrying
  `invite_token` in metadata → `check_signup_invite()` auth hook gates it →
  **`handle_new_user()`'s invite-binding branch** inserts the
  `account_members` row from `invites.role` and marks the invite `accepted`,
  all inside the auth-trigger transaction.
- The invite is delivered as a copyable share link (2.8 AC-2), not an email.

## Acceptance Criteria

1. **A parent (or self-manager) can give an existing, unlinked `singles` row
   in their own household its own login.** The action lives on that single's
   own record (Story 5.8's Single 360), visible only to an owning role and
   only while the row's `member_id` is null; it produces a standard invite
   link via the extended `create_invite()` (AC-2).

2. **The invite is an ordinary Epic 2 invite bound to a target single.**
   `invites` gains `target_single_id bigint`, constrained two ways:
   - a composite FK `(account_id, target_single_id) references
     public.singles (account_id, id) on delete cascade` — the same
     tenant-boundary trick this schema uses everywhere, so a tampered invite
     naming a foreign household's single fails referential integrity, not an
     application check;
   - `check ((role = 'single') = (target_single_id is not null))` — a
     single-role invite always binds a target, and no other role may carry
     one (see Dev Notes "Why the role and the target are coupled").
   `create_invite()` gains `p_target_single_id bigint default null`, passed
   through after verifying (for UX, not as the boundary) that the target is
   in the caller's active context and unlinked.

3. **On acceptance, exactly one `account_members` row is created with
   `role = 'single'`, `status = 'active'`, the invite's `account_id` and
   `invited_by` — and, atomically in the same transaction,
   `singles.member_id` is set to the new row's id.** The link runs inside
   `handle_new_user()`'s invite-binding branch, immediately after its
   `account_members` insert; the auth-trigger transaction is what makes
   "atomically" structural rather than aspirational — a `singles` row is
   never left half-linked.

4. **A `singles` row that already has a `member_id` cannot be re-invited or
   re-linked.** `create_invite()` refuses an already-linked target at
   creation time (UX), and acceptance fails closed even if the row became
   linked in the window between invite and acceptance (e.g. via Story 6.5's
   self-managing path) — refused with a named exception, never silently
   reassigned.

5. **Negative test, required by `.claude/rules/security-triggers.md`:** a
   direct insert into `invites` naming another household's `singles.id` fails
   at the composite FK; an invite with `target_single_id` set and a role
   other than `'single'` (or a `'single'`-role invite with no target) fails
   the check constraint; accepting a second invite against an already-linked
   single raises and leaves `member_id` unchanged.

6. **Once linked, the single's very first authenticated read is already
   scoped by Stories 6.2–6.4's policies** — one integration test proves that,
   immediately after acceptance, the new login sees exactly the row/field set
   Story 6.2's/6.3's own tests proved for a manually-inserted `single` row.
   This is the regression guard that the pinned build order actually held.

## Tasks / Subtasks

- [ ] **Task 1 — Verify Epic 2's landed shape** (AC: 2, 3)
  - [ ] `grep -n "create table public.invites\|create_invite\|handle_new_user" supabase/schemas/*.sql`
        — confirm the table/function/binding-branch shapes summarized above
        landed as 2.7 specified. Where implementation drifted from the story
        text, adapt this story's names to what actually shipped and note the
        drift in the PR; do not re-specify Epic 2's mechanism here.

- [ ] **Task 2 — Schema: `invites.target_single_id`** (AC: 2, 4, 5)
  - [ ] `01_tables.sql`: add the column, the composite FK and the
        role⇔target check from AC-2 (define the composite FK from the start —
        no interim single-column FK).
  - [ ] `02_functions.sql`, `create_invite()`: add
        `p_target_single_id bigint default null`; when not null, raise unless
        the target row exists in the caller's active context with
        `member_id is null` (mirror the exception style of
        `create_shidduch()`'s `'child % not found in current account'` —
        post-1.3, `'single % ...'`).
  - [ ] Confirm the `invites` RLS policy needs no change: `target_single_id`
        is covered by the existing account-scoping plus the FK; and Story
        6.2's Task 6 already excludes `single`-role members from the table
        entirely.

- [ ] **Task 3 — Acceptance: the atomic link in `handle_new_user()`** (AC: 3, 4)
  - [ ] In the invite-binding branch (2.7 AC-7), after the `account_members`
        insert and only when `v_invite.target_single_id is not null`:
        ```sql
        update public.singles
        set member_id = v_new_account_member_id
        where id = v_invite.target_single_id
          and account_id = v_invite.account_id
          and member_id is null;

        if not found then
          raise exception 'single % is already linked to a login, or does not belong to this household', v_invite.target_single_id;
        end if;
        ```
        The `where ... member_id is null` + `not found` check (rather than a
        separate `select`-then-`if`) makes the guard race-safe: two
        concurrent acceptances cannot both pass a pre-check, because the
        second `update` simply matches zero rows and raises.
  - [ ] Do not duplicate any of the branch's existing token/expiry/role
        logic — this is three statements added to one existing code path.

- [ ] **Task 4 — Frontend: the invite entry point** (AC: 1)
  - [ ] On the Single 360 (Story 5.8), an action "give {name} their own
        login", rendered only when `useViewerRole()` (real post-6.4) is
        `parent_admin`/`self_manager` **and** the record's `member_id` is
        null. It calls `dataProvider.createInvite(email, "single",
        targetSingleId)` (extend the existing 2.8 method signature in both
        providers, AD-10) and shows the same copyable
        `${origin}/#/accept-invite/${token}` link `InvitesSection.tsx`
        shows.
  - [ ] Once linked, the action is replaced by a read-only "has their own
        login" indicator — no active invite button on a linked single (the
        UI mirror of the Task 2/3 guards, not a substitute).
  - [ ] `settings/InvitesSection.tsx` (2.8): remove `single` from the
        generic role selector — with AC-2's constraint, a bare single-role
        invite is no longer creatable, and the one path to a single's login
        is their own record (see Dev Notes "One path, from the record").
        The pending-invites list there still shows single invites like any
        other.
  - [ ] i18n keys for the new strings in both
        `providers/commons/{english,french}CrmMessages.ts`.

- [ ] **Task 5 — Generate and hand-check the migration** (AC: 2, 3)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_invite_linking`
  - [ ] Confirm the composite FK is present in the generated migration
        (composite FKs are sometimes omitted by `db diff` when only one
        column of the pair changed — verify by hand against `01_tables.sql`),
        and that the `handle_new_user()` change matches the pg_dump format
        rule from AGENTS.md.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 6 — Tests** (AC: 5, 6)
  - [ ] New `supabase/tests/single_invite_linking.sql` + `.test.ts`. Arrange:
        two households (A, B), one unlinked `singles` row in each. Acceptance
        is simulated by inserting into `auth.users` with
        `raw_user_meta_data->>'invite_token'` set — the exact pattern 2.7
        AC-9's own suite established on top of `references_entity.sql`'s
        bootstrap style.
  - [ ] Assert (AC-5): an invite created in household A with
        `target_single_id` tampered to household B's single fails at the FK;
        `role = 'helper'` + target fails the check; `role = 'single'` +
        null target fails the check.
  - [ ] Assert (AC-3/4): a valid acceptance links the single — exactly one
        `account_members` row, `role = 'single'`, and `singles.member_id`
        equal to it, checked in the same transaction; a second invite
        against the now-linked single raises on acceptance and `member_id`
        is unchanged (re-select and compare, not just "an error was
        raised").
  - [ ] Assert (AC-6): immediately after linking, `set local
        request.jwt.claims` to the new user and re-run the core assertions
        from `single_row_scoping.sql` (via a shared helper or inline): same
        visible-suggestion set, zero rows on the 6.2/6.3 deny tables,
        own-row-only on `account_members`.
  - [ ] Component test: the action renders only for an owning role on an
        unlinked single; renders the indicator once linked.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Why the composite FK, not an application-level check, is the tenant boundary

This schema already solves "can a client point a client-writable row at
another tenant's parent record" with composite FKs
(`(account_id, single_id) references singles (account_id, id)`, e.g.
`shidduchim_single_id_fkey`/`date_records_single_id_fkey` post-1.3). Reusing
it for `invites.target_single_id` means AC-5's cross-tenant case is refused
by referential integrity, not by a `WHERE` clause an application author could
forget — consistent with AD-1's "deny-by-default, enforced in Postgres."

### Why the role and the target are coupled

An accepted single-role invite with no target would create a member the
whole epic cannot account for: every 6.2 policy keys on
`singles.member_id = current_member_id()`, so an unbound `single`-role login
sees nothing (fail-closed, but a dead account), and nothing later can bind
it (this story's path binds at acceptance only). Conversely a target on a
non-single invite is meaningless. Making the coupling a check constraint
turns both mistakes into schema errors. This narrows Epic 2's generic
mechanism — 2.7's `invites.role` check admits `'single'` with no target —
which is why Task 4 also removes the now-impossible option from 2.8's
generic selector in the same change (NFR-14: the replaced path is deleted,
not left to error at submit).

### One path, from the record

AD-11/FR119: invites are the one mechanism for giving a single their own
login. The *entry point* is the single's own record because the action is
about that specific row (`target_single_id` is its identity), the gate
(`member_id is null`) is that row's state, and the post-acceptance indicator
belongs on the same surface. A second, generic entry in Settings would be
the same backend call with a worse affordance and a picker to build — YAGNI.

### What this story does not decide

- **Whether an invited single confirms or edits their display name at
  acceptance** — the generic acceptance flow is Epic 2's surface; this story
  changes nothing about it beyond what `handle_new_user()` does after
  binding.
- **Re-linking a single to a different login later** (revoke + re-invite) —
  no Epic 6 AC asks for it; `member_id` is `on delete set null` against
  `account_members`, so member removal (Story 2.5 territory) already frees
  the row without this story inventing an unlink action.

### Testing standard

Same SQL-suite shape as Stories 6.2–6.4. The acceptance step is exercised by
inserting `auth.users` rows with invite metadata — never a real Supabase Auth
session — mirroring 2.7's own suite so the two stories' tests stay
comparable.

### Project Structure Notes

- `supabase/schemas/01_tables.sql` (column + FK + check),
  `02_functions.sql` (`create_invite()`, `handle_new_user()`),
  `supabase/migrations/<timestamp>_single_invite_linking.sql`.
- `src/components/atomic-crm/`: the Single 360 action (wherever 5.8 put its
  action slot), `settings/InvitesSection.tsx`, both dataProviders'
  `createInvite`, i18n catalogs. No new top-level directory.
- `supabase/tests/single_invite_linking.sql`, `.test.ts` — new.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-11] — invite binds account + role
  server-side; `role ≤ inviter authority`; 18+ affirmation; invites are the
  one mechanism (FR119).
- [Source: ARCHITECTURE-SPINE.md#AD-1] — composite-FK tenant-boundary
  pattern, reused here.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md]
  — the `invites` table, `create_invite()`, `check_signup_invite()`,
  `handle_new_user()` binding branch and test pattern this story extends.
- [Source: _bmad-output/implementation-artifacts/2-8-invites-as-the-one-membership-mechanism.md]
  — `createInvite` dataProvider method, `InvitesSection.tsx`, the share-link
  delivery decision.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md]
  — `singles.member_id` already exists (renamed from `children.member_id`,
  FK to `account_members(id)`); Task 3 writes to an existing column.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.1] — literal AC
  text.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
