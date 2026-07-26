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
live login — it is deliberately sequenced **after** Stories 6.2, 6.3 and 6.4,
so that by the time a real single can sign in, the row-level scoping, the
field-level scoping and the input write-path are already enforced. Building
this story first would mean a real single's first sign-in landing on
whatever pre-Epic-6 (or partially-hardened) policies happened to exist at
that moment — exactly the gap Epic 1's own pinned-order lesson (`1.1 → 1.4 →
1.5 → 1.3 → 1.2 → 1.6`) warns against repeating. Precedes **Story 6.5**,
which needs a working invite/link mechanism to compare against
(self-managing is a *different* provisioning path onto the *same*
`singles.member_id` link, and 6.5's parity tests are clearer once this
story's version of the link exists to contrast with).

## Acceptance Criteria

1. **A parent (or self-manager) can invite an existing, unlinked `singles`
   row in their own household to its own login.** The action is reachable
   from that single's own record (their 360, once Epic 5 Story 5.8 exists) or
   from wherever Epic 4's roster/settings surface lists singles — the entry
   point is not this story's to invent from scratch (see Dev Notes), but the
   backend call it makes is.

2. **The invitee affirms 18+ and signs in passwordlessly, through the same
   invite mechanism Epic 2 Stories 2.7/2.8 already established for every
   other kind of household membership** (spouse, helper, self-manager) — this
   story does not build a second invite system, it extends the one Epic 2
   ships with an optional "bind to this existing single" parameter.

3. **On acceptance, exactly one `account_members` row is created with
   `role = 'single'`, `status = 'active'`, `account_id` = the inviting
   household, `invited_by` = the inviter's own `account_members.id` — and,
   atomically with that same acceptance, the target `singles` row's
   `member_id` is set to the new row's id.** "Atomically" means one
   transaction: a `singles` row is never left half-linked if the
   `account_members` insert fails, or vice versa.

4. **A `singles` row that already has a `member_id` cannot be re-invited or
   re-linked.** A second invite targeting an already-linked single is
   refused with a clear error at acceptance time, not silently reassigned to
   a new login.

5. **Negative test, required by `.claude/rules/security-triggers.md`:**
   accepting an invite cannot bind `member_id` to a `singles` row in a
   **different** household than the inviter's own, even if the invite
   payload is tampered with to name a foreign `singles.id`; accepting a
   second invite against an already-linked single fails closed (AC-4) rather
   than overwriting the existing link.

6. **Once linked, the single's very first authenticated read is already
   scoped by Stories 6.2–6.4's policies** — this story adds one integration
   test proving that, immediately after acceptance, the new login sees
   exactly the same row/field set Story 6.2's/6.3's own tests already proved
   for a manually-inserted `single` row. This is the story's own regression
   guard that the pinned build order (this story last among 6.2–6.4) actually
   held.

## Tasks / Subtasks

- [ ] **Task 1 — Ground this story in Epic 2's actual invite shape, before
      writing any SQL** (AC: 2)
  - [ ] `grep -rniE "invite" supabase/schemas/*.sql supabase/functions/` and
        `LSP workspaceSymbol` for `Invite`/`accept_invite`/anything similar,
        against the tree as it stands once Epic 2 has landed. As of this
        story being written, **no invite table or function exists yet** —
        `src/components/atomic-crm/login/InviteAcceptance.tsx` is a UI shell
        with an explicit comment that "there is no invite-token
        table/edge-function yet." Epic 2 Stories 2.7/2.8 are what build the
        real mechanism (invite table, token, acceptance function/edge
        function, 18+ affirmation, `role ≤ inviter authority` enforcement per
        AD-11). Read whatever Epic 2 actually shipped before writing Task 2 —
        do not build a second, parallel invite table for "inviting a single"
        specifically; extend the one table/function Epic 2 delivers.
  - [ ] The extension point is additive: an optional target column (naming
        below assumes Epic 2's table is called `invites` with an
        `account_id`, `role`, `invited_by`, `token`, `accepted_at`,
        `expires_at` shape per AD-11's description — **adapt every name in
        this story to whatever Epic 2 actually named them**). Add
        `target_single_id bigint references public.singles(id) on delete
        cascade`, nullable — null for every non-single invite (spouse,
        helper, self-manager), set only when a parent invites a specific
        single.

- [ ] **Task 2 — Add the constraint that stops cross-tenant/re-link at the
      database, not just in application code** (AC: 4, 5)
  - [ ] On the invites table, add a check/trigger that a non-null
        `target_single_id` requires `role = 'single'` and that the referenced
        `singles.account_id` equals the invite's own `account_id` — the
        composite-FK trick this schema already uses elsewhere (e.g.
        `date_records`/`shidduchim` → `singles(account_id, id)` composite FKs
        before this epic's renames) is the right tool here too: change the
        FK to `foreign key (account_id, target_single_id) references
        public.singles(account_id, id)` instead of the bare `id` reference
        above, so a tampered invite naming a foreign single's id fails the
        FK itself, not a later application check.
  - [ ] The re-link guard (AC-4) belongs in the **acceptance** function, not
        the invite-creation step (a `singles` row could become linked by a
        different mechanism, e.g. Story 6.5's self-managing path, in the
        window between an invite being sent and accepted): before setting
        `member_id`, the acceptance function checks `member_id is null` on
        the target `singles` row and raises a named exception
        (`'single % is already linked to a login'`) if it is not — mirroring
        the exception style already used in `create_shidduch()`
        (`raise exception 'child % not found in current account', p_child_id`).

- [ ] **Task 3 — Extend the acceptance path to perform the link atomically**
      (AC: 3, 5)
  - [ ] Locate Epic 2's acceptance function (whatever it is named — the
        function that turns a valid, unexpired invite token plus an
        authenticated `auth.uid()` into an `account_members` row). Add, in
        the same transaction, immediately after the `account_members` insert
        succeeds and only when the invite's `target_single_id` is not null:
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
        The `where ... and member_id is null` plus checking `not found`
        (rather than a separate `select` beforehand) makes the guard
        race-safe against two acceptances of the same invite landing
        concurrently — the second one's `update` simply matches zero rows
        and raises, rather than racing a separate check-then-set.
  - [ ] If Epic 2's acceptance path is a Postgres function (matching this
        schema's existing `SECURITY INVOKER`/`SECURITY DEFINER` conventions),
        add this logic inside it. If it is instead a Cloudflare Worker per
        AD-7 (server-side invite verification, `forAccount()`-scoped), the
        same two statements run through that Worker's scoped client inside
        its own transaction — either way, this is **one code path**, not a
        second one layered on top of Epic 2's; do not write a
        `accept_single_invite()` that duplicates Epic 2's token
        verification, expiry check, or `role ≤ inviter authority` logic.

- [ ] **Task 4 — Frontend: the invite entry point** (AC: 1)
  - [ ] An action on the single's own record (their 360, per Epic 5 Story
        5.8) or the household roster (per Epic 4), gated to visibility level
        `parent_admin`/`self_manager` and to an unlinked `singles` row
        (`member_id is null`) — grep for Epic 2's existing invite-trigger UI
        (whatever component calls its `invites` creation) and add a "give
        {single's name} their own login" variant that passes
        `target_single_id`, rather than building a second invite dialog.
  - [ ] Once linked, the action is replaced by a read-only "has their own
        login" indicator — do not leave an active "invite" button pointing
        at an already-linked single (this is a UI-level mirror of the
        database guard in Task 2/3, not a substitute for it).

- [ ] **Task 5 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_invite_linking`
  - [ ] Confirm the composite FK from Task 2 is present in the generated
        migration (composite FKs are sometimes omitted by `db diff` when only
        one column of the pair actually changed — verify by hand against
        `01_tables.sql`).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 6 — Tests** (AC: 5, 6)
  - [ ] New `supabase/tests/single_invite_linking.sql` + `.test.ts`. Arrange:
        two households (A, B), one unlinked `singles` row in each.
  - [ ] Assert (AC-5): an invite created in household A with
        `target_single_id` tampered to point at household B's single fails
        at the FK (insert into the invites table itself raises) — this
        proves the composite FK, not application logic, is the boundary.
  - [ ] Assert (AC-4/5): accepting a valid invite in household A links the
        single; a second invite targeting the now-linked single, on
        acceptance, raises the named exception and leaves `member_id`
        unchanged (re-select and compare, not just "no error thrown").
  - [ ] Assert (AC-3): after acceptance, exactly one `account_members` row
        exists for the new user with `role = 'single'`, and the target
        `singles.member_id` equals that row's id — checked in the same
        transaction, proving atomicity by construction rather than by timing.
  - [ ] Assert (AC-6): immediately after linking, authenticate as the new
        single (`set local request.jwt.claims` to their `auth.users.id`) and
        re-run the core assertions from `single_row_scoping.sql` (Story 6.2)
        inline or via a shared helper — same visible-suggestion set, same
        zero-row result on the wholesale-denied tables. Do not just assert
        "the row exists"; assert the *access* it grants matches Stories
        6.2–6.4's contract.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Why this story cannot be fully specified without Epic 2's real shape

Every other Epic 6 story operates on tables that already exist today
(`children`/`singles`, `shidduchim`, `interactions`, `reference_links`) and
simply gets renamed/renumbered en route. Invites do not exist yet in any
form beyond a UI mock (`login/InviteAcceptance.tsx`, explicitly commented as
non-functional). This story is therefore written as an **extension
contract** — the exact column/table/function names above are the
architecturally-implied shape (AD-11: "the invite server-path binds the row
to the inviter's active context and authorizes `role ≤ inviter authority`"),
not verified-against-code the way Stories 6.2–6.4 are. **Task 1 is not
optional boilerplate — it is the step that makes the rest of this story
buildable**, and the implementer must re-map every name below to what Epic 2
actually shipped before writing a line of SQL.

### Why the composite FK, not an application-level check, is the tenant boundary

This schema already solves "can a client point a client-writable row at
another tenant's parent record" with composite FKs
(`(account_id, single_id) references singles(account_id, id)`, per Story
1.3's Dev Notes on `shidduchim_single_id_fkey`/`date_records_single_id_fkey`).
Reusing the same trick for `invites.target_single_id` means the cross-tenant
case in AC-5 is refused by the database's own referential integrity, not by
a `WHERE` clause an application author could forget — consistent with AD-1's
"deny-by-default, enforced in Postgres."

### Why the re-link guard is `UPDATE ... WHERE member_id IS NULL` plus
`NOT FOUND`, not a `SELECT` then `IF`

A check-then-act (`select member_id from singles where id = ...; if
not null then raise; end if; update ...`) has a race window between the
`select` and the `update` — two acceptances of the same invite (e.g. a
double-submitted form, or an attacker replaying a token) could both pass the
check before either writes. Folding the guard into the `UPDATE`'s own
`WHERE` clause and checking `NOT FOUND` afterward makes the whole operation
atomic at the single-statement level; this is the same reasoning
`references_entity.sql`'s existing tests already validate for other
structural columns in this schema ("an interaction cannot be re-parented by
the client").

### What this story does not decide

- **The exact UI location of the "invite this single" action** — depends on
  Epic 4 (navigation/lists) and Epic 5 (single 360) having landed with a
  concrete roster/record surface. Task 4 names the *behaviour* (gated to an
  unlinked single, calls the extended invite path), not a specific
  component path, because that component does not exist yet at the time this
  story is written.
- **Whether an invited single needs a name pre-filled or confirms it
  themselves at acceptance** — an Epic 2 UX concern (the generic invite
  acceptance flow), not this story's.

### Testing standard

Same shape as Stories 6.2–6.4. This story's suite additionally needs to
simulate an *unauthenticated* acceptance step (the invitee has no
`account_members` row yet when they accept) — mirror
`references_entity.sql`'s own bootstrap pattern (inserting into `auth.users`
first, then asserting on the membership `handle_new_user()`/the acceptance
path produces), rather than inventing a new fixture style.

### Project Structure Notes

- Schema/migration files depend entirely on where Epic 2 put the invites
  table — likely `supabase/schemas/01_tables.sql` (new column + FK),
  `02_functions.sql` (acceptance function edit), `05_policies.sql` (if the
  invites table has its own RLS, confirm `target_single_id` is covered by
  the existing tenant-scoping policy rather than needing a new one).

### References

- [Source: ARCHITECTURE-SPINE.md#AD-11] — invite binds account + role
  server-side; `role ≤ inviter authority`; 18+ affirmation; "invites are the
  one mechanism" for household membership, a single's login, and
  parent↔shadchan connections.
- [Source: ARCHITECTURE-SPINE.md#AD-1] — composite-FK tenant-boundary
  pattern, reused here.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.7] and
  [#Story-2.8] — the invite mechanism this story extends.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.1] — literal AC
  text.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md]
  — confirms `singles.member_id` already exists today (as
  `children.member_id`, FK to `account_members(id)`) and is renamed, not
  newly added, by that story — this story's Task 3 writes to a column that
  already exists post-1.3, it does not create one.
- `src/components/atomic-crm/login/InviteAcceptance.tsx` — the current,
  explicitly-non-functional UI shell this story's Epic-2-dependent backend
  will eventually sit behind.
- `supabase/tests/single_invite_linking.sql`, `.test.ts` — new.
- Frontend: extends whatever component Epic 2 built for sending an invite —
  no new top-level directory expected.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
