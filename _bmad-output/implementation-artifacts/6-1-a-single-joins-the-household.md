---
baseline_commit: c27cf8e3386a73b94bb1f58c4b30065de4fdad00
---

# Story 6.1: A single joins the household

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to invite my single to their own login,
so that they can take part in their own process, on the same app, with their
access already scoped the moment they sign in.

## Position in Epic 6

**5th of 6 to build, despite being numbered 6.1.** This is the story that
produces a **real** `account_members` row with `role = 'single'` bound to a
live login — deliberately sequenced **after** Stories 6.2, 6.3 and 6.4, so
that by the time a real single can sign in, the row scoping, the field
scoping and the input write-path are already enforced.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

Precedes **Story 6.5**, whose parity tests contrast this invite-provisioned
link with `add_persona('single')`'s self-managing provisioning path onto the
same `singles.member_id` column.

**What Epic 2 shipped, verified against the tree at HEAD** (this story
extends it and never builds a parallel invite system):

- `public.invites` (`01_tables.sql:247`) — `token uuid` (unique, defaulted),
  `email`, `account_id`, `role`, `invited_by`, `status`, `expires_at`
  (`now() + 14 days`), `accepted_at`. `invites_role_check` admits
  `parent_admin | helper | single | shadchan` (deliberately not
  `self_manager` — that role is *arrived at*, never invited into).
- RLS: **SELECT only** (`"Invites readable within active account"`,
  `05_policies.sql:182`). `06_grants.sql:119-121` revokes all DML from
  `authenticated` and grants `select` alone, so the two definer functions
  below are the entire write gate — not a convenience layer in front of RLS.
- `public.create_invite(p_email, p_role)` (`02_functions.sql:1139`) —
  SECURITY DEFINER. Refuses a caller with no active membership, a caller
  whose role is not `is_invite_capable_role()`
  (`parent_admin`/`self_manager`/`shadchan` — **`single` is not**), a
  `p_role` above `role_authority(caller)`, and a `p_role` that does not match
  the active context's `kind`. Sets `invited_by` from the caller's own
  membership id, never a parameter.
- **Acceptance is `public.accept_invite(p_token)`** (`02_functions.sql:79`),
  **not** a `handle_new_user()` branch. This is the single most important
  correction to this story's earlier draft: Story 2.7 review finding #4 moved
  binding OFF the `auth.users` trigger entirely, because that trigger fires
  when an OTP is *requested*, not when it is *verified*, so anyone holding a
  forwarded invite link could burn it. `handle_new_user()` today provisions
  the `public.members` profile row and nothing else — it never reads
  `invite_token`, never touches `invites`, and never creates an
  `account_members` row. `accept_invite()` is called by
  `login/InviteAcceptance.tsx` immediately after its own `verifyOtp()`
  succeeds; it gates on `auth.uid()`, re-checks the caller's own email
  against the invite, claims the invite with an atomic
  `update ... where status = 'pending'`, and only then inserts the
  `account_members` row. It is idempotent for a retry by the same
  already-bound caller.
- The invite is delivered as a copyable share link (2.8 AC-2), not an email.
- `check_signup_invite()` (`02_functions.sql:1245`) still gates signup as a
  GoTrue `before_user_created` hook. This story changes nothing about it.

## Acceptance Criteria

1. **A parent (or self-manager) can give an existing, unlinked `singles` row
   in their own household its own login.** The action lives on that single's
   own record (the Single 360's `actions` region,
   `singles/entityDescriptorRegions.tsx`'s `SingleActions`), rendered only
   when `useViewerRole().role` is `parent_admin` or `self_manager` **and**
   the record's `member_id` is null; it produces a standard invite link via
   the extended `create_invite()` (AC-2).

2. **The invite is an ordinary Epic 2 invite bound to a target single.**
   `invites` gains `target_single_id bigint`, constrained two ways:
   - a composite FK `(account_id, target_single_id) references
     public.singles (account_id, id) on delete cascade` — the backing unique
     constraint `singles_account_id_id_key` already exists
     (`01_tables.sql:823`), and three tables already use exactly this shape
     against it (`:865`, `:880`, `:916`), so a tampered invite naming a
     foreign household's single fails referential integrity, not an
     application check;
   - `check ((role = 'single') = (target_single_id is not null))` — a
     single-role invite always binds a target, and no other role may carry
     one (see Dev Notes "Why the role and the target are coupled").

   `create_invite()` gains `p_target_single_id bigint default null`, passed
   through after verifying (for UX, not as the boundary) that the target is
   in the caller's active context and unlinked.

3. **On acceptance, `accept_invite()` creates exactly one `account_members`
   row (`role = 'single'`, `status = 'active'`, the invite's `account_id`
   and `invited_by`) and, in the same statement block, sets
   `singles.member_id` to that new row's id.** `accept_invite()` is one
   PL/pgSQL function body, so both writes are in one transaction: a `singles`
   row is never left half-linked. The link is added to the existing function,
   immediately after its existing `insert into public.account_members ...`,
   which must gain a `returning id into v_membership_id`.

4. **A `singles` row that already has a `member_id` cannot be re-invited or
   re-linked.** `create_invite()` refuses an already-linked target at
   creation time (UX), and `accept_invite()` fails closed even if the row
   became linked in the window between invite and acceptance (e.g. via
   `add_persona('single')`) — refused with a named exception, never silently
   reassigned. **The idempotent-retry branch is preserved:** a second
   `accept_invite()` call for an invite this same caller already completed
   still returns silently (it exits before reaching the linking code), and a
   test asserts that this story did not turn a benign page-reload retry into
   an error.

5. **Negative test, required by `.claude/rules/security-triggers.md`:** a
   direct insert into `invites` (as `postgres`, since `authenticated` holds
   no insert grant) naming another household's `singles.id` fails at the
   composite FK; an invite with `target_single_id` set and a role other than
   `'single'`, and a `'single'`-role invite with no target, each fail the
   check constraint; a second invite accepted against an already-linked
   single raises and leaves `member_id` unchanged (re-selected and compared,
   not merely "an error was raised").

6. **Once linked, the single's very first authenticated read is already
   scoped by Stories 6.2–6.4's policies** — one assertion block proves that,
   immediately after acceptance, the new login sees exactly the row/field set
   `single_row_scoping.sql` and `single_field_scoping.sql` proved for a
   directly-inserted `single` membership. This is the regression guard that
   the pinned build order actually held.

## Tasks / Subtasks

- [x] **Task 1 — Read the landed acceptance path before writing anything** (AC: 3)
  - [x] Read `public.accept_invite()` (`supabase/schemas/02_functions.sql:79-138`)
        and `supabase/tests/invites.sql:441-560`. The suite's own comment at
        `:441-443` states the binding move explicitly. Any instruction in an
        older story draft that names `handle_new_user()`'s "invite-binding
        branch" is describing code that no longer exists — do not resurrect
        it.

- [x] **Task 2 — Schema: `invites.target_single_id`** (AC: 2, 4, 5)
  - [x] `01_tables.sql`: append the column to the **end** of the
        `create table public.invites` block (COLUMN-ORDER TRAP at the top of
        that file — physical order is what `db diff` compares, and
        `supabase/tests/column_order.test.ts` fails on a mismatch). Add the
        role⇔target check inside the block; add the composite FK in the
        `alter table` region alongside `:865`/`:880`/`:916`, in the same
        style (define it composite from the start — no interim single-column
        FK).
  - [x] `02_functions.sql`, `create_invite()`: add
        `p_target_single_id bigint default null` as the **last** parameter
        (a new leading or middle parameter changes the PostgREST RPC
        signature for existing callers). When not null, raise unless the
        target row exists in `v_account_id` with `member_id is null` —
        mirror `create_shidduch()`'s exception style (`'single % not found in
        current account'`). When null and `p_role = 'single'`, raise: the
        check constraint would catch it, but a named error is a better
        client message than a constraint violation.
  - [x] Confirm the `invites` RLS policy needs no change: `target_single_id`
        is covered by the existing account-scoping plus the FK, and Story
        6.2's Task 6 already denies the whole table to the `single` role.

- [x] **Task 3 — Acceptance: the atomic link inside `accept_invite()`** (AC: 3, 4)
  - [x] Add `v_membership_id bigint;` to the `declare` block; change the
        existing membership insert to `returning id into v_membership_id`;
        then, only when `v_invite.target_single_id is not null`:
        ```sql
        update public.singles
        set member_id = v_membership_id
        where id = v_invite.target_single_id
          and account_id = v_invite.account_id
          and member_id is null;

        if not found then
          raise exception 'single % is already linked to a login, or does not belong to this household', v_invite.target_single_id
            using errcode = 'check_violation';
        end if;
        ```
        The `where ... member_id is null` + `not found` check (rather than a
        separate `select`-then-`if`) makes the guard race-safe: two
        concurrent acceptances cannot both pass a pre-check, because the
        second `update` matches zero rows and raises. The raise rolls back
        the whole function, including the invite's `status = 'accepted'`
        claim — which is correct: an invite that could not be honoured must
        not be burnt.
  - [x] Do not touch any of the function's existing token/email/expiry/
        idempotency logic — this is one `returning`, one `update` and one
        `if not found` added to one existing code path.
  - [x] `handle_new_user()` is **not** edited by this story.

- [x] **Task 4 — Frontend: the invite entry point** (AC: 1)
  - [x] `singles/entityDescriptorRegions.tsx`: `SingleActions` currently
        renders a bare `<TopToolbar><EditButton /></TopToolbar>`. Add a
        sibling action — "give {name} their own login" — in a new component
        file (`singles/SingleLoginInvite.tsx`, kept out of
        `entityDescriptorRegions.tsx` so that module stays a thin adapter
        list). It renders only when `useViewerRole().role` is
        `parent_admin`/`self_manager` **and** `record.member_id == null`;
        `isPending` renders nothing (fail-closed, the `RolePending` posture).
  - [x] It calls `dataProvider.createInvite(email, "single", targetSingleId)`
        and shows the same copyable `${origin}/#/accept-invite/${token}` link
        `settings/InvitesSection.tsx` already builds. Extend the method
        signature in **both** providers (AD-10):
        `providers/supabase/dataProvider.ts:576` (add
        `p_target_single_id` to the `rpc("create_invite", …)` payload) and
        `providers/fakerest/dataProvider.ts:1033` →
        `providers/fakerest/internal/invites.ts:47` (mirror the target
        checks, including the already-linked refusal).
  - [x] Once linked, the action is replaced by a read-only "has their own
        login" indicator — no active invite button on a linked single (the
        UI mirror of the Task 2/3 guards, never a substitute).
  - [x] `settings/InvitesSection.tsx`: remove `single` from the generic role
        selector. The selector's options come from
        `providers/commons/roleAuthority.ts`'s `invitableRoles()`, whose
        household candidate list is `["parent_admin", "helper", "single"]` —
        drop `"single"` there, with a comment citing this story, so the one
        path to a single's login is their own record (Dev Notes "One path,
        from the record"). `InvitableRole` in `types.ts` is **not** narrowed:
        `invites_role_check` still admits `'single'`, and the pending-invites
        list must still render single invites like any other.
  - [x] i18n keys for every new string in **both**
        `providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts` (AD-18 — no hardcoded UI text).

- [x] **Task 5 — Generate and hand-check the migration** (AC: 2, 3)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_invite_linking`
  - [x] Confirm the composite FK is present in the generated migration
        (verify by hand against `01_tables.sql`), and that the
        `create_invite()`/`accept_invite()` bodies match the exact `pg_dump`
        format rule from AGENTS.md.
  - [x] `create_invite()` gains a parameter, so `db diff` emits a **new**
        function rather than a replacement. Check whether the 2-argument
        overload survives; if it does, `drop function public.create_invite(text, text);`
        by hand in the same migration (two overloads make the PostgREST RPC
        call ambiguous) and re-issue its grant for the new signature —
        `06_grants.sql` grants execute per signature, and `db diff` does not
        re-emit function grants (AGENTS.md).
  - [x] `make check-migration-safety` — this migration adds a column and
        drops nothing, so it must pass with no new `declared-moves.sql`
        entry. (Story 6.6 refreshed the fixture; if 6.6 has not landed, this
        command fails inside the fixture, not on your migration.)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [x] **Task 6 — Tests** (AC: 4, 5, 6)
  - [x] Extend `supabase/tests/invites.sql` rather than starting a parallel
        suite — it already arranges two households, a full `create_invite()`
        authority matrix and four `accept_invite()` scenarios, and this story
        changes both functions. Add a new section at its end; do not
        restructure what is there.
  - [x] Acceptance is exercised the way that suite already does it:
        `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`
        then `select public.accept_invite(:'token'::uuid);` — never an
        `auth.users` insert carrying `invite_token` metadata (that path was
        removed by 2.7's review fix and would silently assert nothing).
  - [x] Assert (AC-5): an `invites` row (inserted as `postgres`) in household
        A with `target_single_id` pointing at household B's single fails at
        the FK; `role = 'helper'` + target fails the check; `role = 'single'`
        + null target fails the check.
  - [x] Assert (AC-3/4): a valid acceptance yields exactly one
        `account_members` row with `role = 'single'` and
        `singles.member_id` equal to its id; a second invite accepted against
        the now-linked single raises **and** `member_id` is unchanged on
        re-select **and** the second invite is still `pending` (the rollback
        of the status claim).
  - [x] Assert (AC-4): the existing idempotency case still passes — a repeat
        `accept_invite()` by the same bound caller neither raises nor creates
        a second membership.
  - [x] Assert (AC-6): immediately after linking, `set local
        request.jwt.claims` to the new user and re-run the core assertions
        from `single_row_scoping.sql` / `single_field_scoping.sql` via
        `supabase/tests/dbSuiteHelpers.ts` (or inline, if the helper does not
        expose them): same visible-suggestion set, zero rows on the 6.2/6.3
        deny tables, own-row-only on `account_members`.
  - [x] Component tests: `SingleLoginInvite` renders for an owning role on an
        unlinked single, renders nothing for `single`/`helper`, renders
        nothing while `isPending`, and renders the indicator once linked.
        `vitest-browser-react` + `TestMemoryRouter` (React Testing Library is
        not a dependency in this repo).
  - [x] `e2e/invite-sending.spec.ts` asserts the Settings role selector's
        options; it will go red when `single` is removed — update it in this
        story, and add the Single-360 path as the replacement coverage.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Why the composite FK, not an application-level check, is the tenant boundary

This schema already solves "can a client point a client-writable row at
another tenant's parent record" with composite FKs against
`singles(account_id, id)` (`01_tables.sql:865`, `:880`, `:916`). Reusing it
for `invites.target_single_id` means AC-5's cross-tenant case is refused by
referential integrity, not by a `WHERE` clause an application author could
forget — consistent with AD-1's "deny-by-default, enforced in Postgres."

### Why the role and the target are coupled

An accepted single-role invite with no target would create a member the whole
epic cannot account for: every 6.2 policy keys on
`singles.member_id = current_member_id()`, so an unbound `single`-role login
sees nothing (fail-closed, but a dead account), and nothing later can bind it
(this story's path binds at acceptance only). Conversely a target on a
non-single invite is meaningless. Making the coupling a check constraint
turns both mistakes into schema errors. This narrows Epic 2's generic
mechanism — `invites_role_check` admits `'single'` with no target — which is
why Task 4 also removes the now-impossible option from `invitableRoles()` in
the same change (NFR-14: the replaced path is deleted, not left to error at
submit).

### One path, from the record

AD-11/FR119: invites are the one mechanism for giving a single their own
login. The *entry point* is the single's own record because the action is
about that specific row (`target_single_id` is its identity), the gate
(`member_id is null`) is that row's state, and the post-acceptance indicator
belongs on the same surface. A second, generic entry in Settings would be the
same backend call with a worse affordance and a picker to build — YAGNI.

### Why `accept_invite()` and not the auth trigger — and why it matters here

Binding on `auth.uid()` is the only mechanically sound gate under this
project's `enable_confirmations = false` autoconfirm setting: GoTrue creates
the `auth.users` row (and stamps `email_confirmed_at`) the instant an OTP is
*requested*. This story inherits that property for free — the `singles`
link happens only for a caller who has proved mailbox control, so a forwarded
invite link cannot claim a single's identity. Any attempt to "simplify" this
back onto a trigger reopens 2.7's review finding #4 with a worse blast radius.

### What this story does not decide

- **Whether an invited single confirms or edits their display name at
  acceptance** — the generic acceptance flow is Epic 2's surface; this story
  changes nothing about it beyond what `accept_invite()` does after binding.
- **Re-linking a single to a different login later** (revoke + re-invite) —
  no Epic 6 AC asks for it; `singles_member_id_fkey` is `on delete set null`
  (`01_tables.sql:853`), so member removal (Story 2.5 territory) already
  frees the row without this story inventing an unlink action.

### Testing standard

Plain SQL `results`-table suites run via `npm run test:unit:db`,
multi-identity via `set local request.jwt.claims` — see
`supabase/tests/invites.sql` for the exact shape, since this story extends
it. AAA per `.claude/rules/testing.md`. Frontend tests are
`vitest-browser-react` in real Chromium with `TestMemoryRouter`.

### Project Structure Notes — the true file set

Schema / DB:
- `supabase/schemas/01_tables.sql` (column at the tail of `invites`, check,
  composite FK)
- `supabase/schemas/02_functions.sql` (`create_invite()`, `accept_invite()`)
- `supabase/schemas/06_grants.sql` (execute grant for the new
  `create_invite` signature; drop the old one)
- `supabase/migrations/<timestamp>_single_invite_linking.sql`
- `supabase/tests/invites.sql`, `supabase/tests/invites.test.ts` (extended)
- `supabase/tests/column_order.test.ts`, `supabase/tests/declaredColumnOrder.ts`
  (must stay green after the column addition)
- `supabase/tests/dbSuiteHelpers.ts` (if AC-6's shared assertions are
  factored there)

Frontend:
- `src/components/atomic-crm/singles/SingleLoginInvite.tsx` + `.test.tsx` (new)
- `src/components/atomic-crm/singles/entityDescriptorRegions.tsx` (mounts it)
- `src/components/atomic-crm/singles/entityDescriptor.tsx` +
  `entityDescriptor.test.tsx` (only if the action wiring is asserted there)
- `src/components/atomic-crm/settings/InvitesSection.tsx` + `.test.tsx`
- `src/components/atomic-crm/providers/commons/roleAuthority.ts` + `.test.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/internal/invites.ts` (+ its test)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/` (if invites
  are generated there)
- `src/components/atomic-crm/types.ts` (`Invite.target_single_id`)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`,
  `frenchCrmMessages.ts`
- `registry.json` (regenerated by the pre-commit hook — a new file under
  `src/components/atomic-crm/` always changes it; commit the regenerated file)

E2E:
- `e2e/invite-sending.spec.ts` (role-selector options change)
- `e2e/invite-acceptance.spec.ts`, `e2e/fixtures.ts` (the 6-digit OTP regex
  the acceptance flow depends on)

No new top-level directory.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-11] — invite binds account + role
  server-side; `role ≤ inviter authority`; 18+ affirmation; invites are the
  one mechanism (FR119).
- [Source: ARCHITECTURE-SPINE.md#AD-1] — composite-FK tenant-boundary
  pattern, reused here.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md]
  — the `invites` table, `create_invite()`, `check_signup_invite()`, and
  review finding #4, which moved binding from `handle_new_user()` to
  `accept_invite()`.
- [Source: _bmad-output/implementation-artifacts/2-8-invites-as-the-one-membership-mechanism.md]
  — `createInvite` dataProvider method, `InvitesSection.tsx`, the share-link
  delivery decision, `revoke_invite()`'s mutual exclusion with acceptance.
- [Source: _bmad-output/implementation-artifacts/5-8-single-360.md] — the
  Single 360 whose `actions` region hosts this story's entry point.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.1] — literal AC
  text ("they receive an invite, affirm 18+, and sign in passwordlessly /
  and their member record is linked to their single record").
- Current code, all verified for this refresh:
  `supabase/schemas/01_tables.sql:247-266` (`invites`), `:267-282`
  (`singles`), `:823` (`singles_account_id_id_key`), `:853`
  (`singles_member_id_fkey … on delete set null`);
  `supabase/schemas/02_functions.sql:27-60` (`handle_new_user`, profile row
  only), `:79-138` (`accept_invite`), `:1139-1194` (`create_invite`);
  `supabase/schemas/05_policies.sql:182` (invites SELECT-only);
  `supabase/schemas/06_grants.sql:119-121`;
  `supabase/tests/invites.sql:441-560`.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-opus-5) — bmad-dev-story workflow, STACK_ID=5.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local --workdir .supabase-e2e-5 -f single_invite_linking` —
  generated `supabase/migrations/20260730204933_single_invite_linking.sql`.
  `migra` correctly emitted `drop function if exists
  "public"."create_invite"(p_email text, p_role text)` on its own (the
  2-argument overload did NOT survive, contrary to the task's own
  "check whether it survives" caution) but, as warned, emitted no GRANT
  statements at all for the new 3-argument overload — hand-added the
  revoke/grant block for `create_invite(text, text, bigint)`, copied
  verbatim from `06_grants.sql`.
- `db diff --local` run twice post-migration: both `No schema changes
  found`.
- `make check-migration-safety STACK_ID=5`: PASSED (adds a column, drops
  nothing — no `declared-moves.sql` entry needed).
- `npm run test:unit:db STACK_ID=5`: 25 files / 803 tests passed
  (`invites.test.ts` alone: 75 tests, including the new Story 6.1
  section).
- Two real bugs caught and fixed while writing `invites.sql`'s new
  section, both from the newly-linked `single` caller being unable to
  read `public.invites` under RLS at all (6.2's own deny-the-whole-table
  policy — exactly the behaviour AC-6 exists to prove): a DO block that
  looked up an invite's token via `select token into v_token from
  public.invites where email = ...` under the SINGLE's OWN role found
  zero rows and silently passed the wrong (NULL) token to
  `accept_invite()`, producing the generic "invalid" message instead of
  the specific one each test intended to pin. Fixed by adding a small,
  RLS-free `invite_tokens` temp table (the shared `ids` table is
  bigint-valued only, so a uuid token could not go there) populated
  BEFORE the identity switch, since psql's `:'var'` interpolation does
  not reach inside `do $$ … $$` bodies (confirmed empirically) — the
  file's own established `ids`-table convention adapted for a uuid
  value instead of invented from scratch.
- `make typecheck`, `npm run lint`, `npx vitest run` (full suite, 217
  files / 2425 tests), `make build`: all green, run repeatedly after
  each fix.
- `misc/recordSurfaceDialogs.guard.test.ts` (UX-DR3) failed on the first
  pass: `SingleLoginInvite.tsx` had been built with `@/components/ui
  /dialog`, which the guard flags as a new, unrecognized dialog-wrapped
  record-surface file. Rebuilt on `@/components/ui/popover` instead —
  `references/ReferenceAttachToShidduch.tsx` is the exact same call for
  the exact same reason (a one-tap action with a small form, not a
  record's own screen) — rather than adding an allowlist entry to a file
  outside this story's declared path ownership.

### Completion Notes List

- Schema: `invites.target_single_id bigint` appended to the tail of the
  `create table` block (column-order trap respected), plus
  `invites_role_target_check` (`(role = 'single') = (target_single_id is
  not null)`) and a composite `invites_target_single_id_fkey (account_id,
  target_single_id) references singles(account_id, id) on delete
  cascade`, defined composite from the start.
- `create_invite()` gains `p_target_single_id bigint default null` as its
  LAST parameter (a new overload, not a breaking change to existing
  callers) with two named-exception UX checks (null target for a
  single-role invite; target not found/foreign/already-linked in the
  caller's own account) ahead of the real boundary (the check constraint
  and composite FK).
- `accept_invite()` gained exactly the diff the story specified: one
  `returning id into v_membership_id` on the existing membership insert,
  and one race-safe `update … where member_id is null` +
  `if not found then raise` immediately after, gated on
  `v_invite.target_single_id is not null`. Nothing else in the function
  was touched; `handle_new_user()` was not touched at all.
- Migration hand-adjustments (both flagged in the task and both
  confirmed necessary): the 2-argument `create_invite` overload's drop
  WAS auto-emitted by `migra` this time; its new 3-argument overload's
  grants were NOT and were hand-added, matching the `resume_photos`
  migration's own "MANUAL ADJUSTMENTS" header convention.
- Frontend: `SingleLoginInvite.tsx` (new) is a `Popover`-based action
  (not a `Dialog` — see Debug Log) mounted as a sibling to `EditButton`
  inside `SingleActions`, which now receives `record` and threads it
  through. Gated on `useViewerRole()` (`parent_admin`/`self_manager`,
  fail-closed on `isPending`) and `single.member_id == null`; once
  linked, renders a read-only "Has their own login" badge instead.
  Calls `dataProvider.createInvite(email, "single", single.id)`.
- Both providers' `createInvite` extended with an optional third
  `targetSingleId` parameter (Supabase: `p_target_single_id` in the RPC
  payload; FakeRest: `providers/fakerest/internal/invites.ts`, whose
  role/kind validation was rewritten to check `ROLE_AUTHORITY`/
  `isInviteCapableRole` directly rather than through `invitableRoles()` —
  that helper's own candidate list no longer includes `single`, so
  routing a `single`-role FakeRest call through it would have incorrectly
  refused every one of them).
- `roleAuthority.ts`'s `invitableRoles()` household candidate list drops
  `single` (comment cites this story); `InvitableRole`/`invites_role_check`
  are untouched, and `InvitesSection.tsx` itself needed no edit — it
  already derives its options from `invitableRoles()` and its
  pending-invites list already renders any `InvitableRole` uniformly, so
  a `single`-role invite still lists correctly (new test added: `still
  renders a pending 'single'-role invite in the list, exactly like any
  other role`).
- `e2e/invite-sending.spec.ts`: added an explicit assertion that the
  Settings role selector no longer offers "Single", and a new test
  covering the Single-360 replacement path end-to-end (send from the
  record, see the copyable link). `e2e/invite-acceptance.spec.ts` and
  `e2e/fixtures.ts` needed no change — the generic OTP-based acceptance
  flow and its fixtures are unaffected by this story, and AC-6's full
  post-acceptance scoping regression is covered at the DB layer (the
  authoritative layer for RLS, per AD-1), not re-proven at the e2e layer.
- `registry.json` regenerated (`make registry-gen`) for the new
  `SingleLoginInvite.tsx` file, per the pre-commit-hook convention.
- Nothing from the declared path list was left untouched without reason:
  `settings/InvitesSection.tsx` and `singles/entityDescriptor.tsx`
  required no edits (verified, not merely skipped) — the former already
  reads its options from `invitableRoles()`, the latter's `actions:
  SingleActions` reference needed no change since `SingleActions`'s new
  `{ record }` signature already matches `EntityDescriptor`'s
  `ComponentType<{ record: T }>` contract for the `actions` region.

### File List

Schema / DB:
- `supabase/schemas/01_tables.sql` (modified)
- `supabase/schemas/02_functions.sql` (modified)
- `supabase/schemas/06_grants.sql` (modified)
- `supabase/migrations/20260730204933_single_invite_linking.sql` (new)
- `supabase/tests/invites.sql` (modified)

Frontend:
- `src/components/atomic-crm/singles/SingleLoginInvite.tsx` (new)
- `src/components/atomic-crm/singles/SingleLoginInvite.test.tsx` (new)
- `src/components/atomic-crm/singles/entityDescriptorRegions.tsx` (modified)
- `src/components/atomic-crm/singles/entityDescriptor.test.tsx` (modified —
  new coverage for the real `actions` region wiring; `entityDescriptor.tsx`
  itself needed no change)
- `src/components/atomic-crm/settings/InvitesSection.test.tsx` (modified)
- `src/components/atomic-crm/providers/commons/roleAuthority.ts` (modified)
- `src/components/atomic-crm/providers/commons/roleAuthority.test.ts` (modified)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` (modified)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (modified)
- `src/components/atomic-crm/providers/fakerest/internal/invites.ts` (modified)
- `src/components/atomic-crm/providers/fakerest/internal/invites.test.ts` (new)
- `src/components/atomic-crm/types.ts` (modified)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (modified)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (modified)
- `registry.json` (regenerated)

E2E:
- `e2e/invite-sending.spec.ts` (modified)

### Change Log

- 2026-07-30: Story 6.1 implemented — `invites.target_single_id`,
  `create_invite()`/`accept_invite()` extended, `SingleLoginInvite.tsx`
  entry point, `single` dropped from the generic invite-role selector.
  All 6 tasks complete; DB suite (803 tests), full unit suite (2425
  tests), `make typecheck`, `make lint`, `make build`, `db diff` (clean
  twice) and `make check-migration-safety` all green. Status → review.
