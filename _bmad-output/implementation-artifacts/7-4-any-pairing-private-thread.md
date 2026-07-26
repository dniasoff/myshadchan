# Story 7.4: Any pairing may hold a private thread

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any user,
I want a private conversation with any other legitimate party — including a shadchan
I'm connected to — so that no conversation is structurally blocked just because the two
parties sit in different contexts (FR94, FR98).

## Position in Epic 7

**4th of 5. Depends on 7.1–7.3** (the full account-scoped thread model, default
posture, and privacy enforcement). Precedes 7.5 (notifications must fan out correctly
regardless of which scope axis a thread uses).

**This story also does something epics.md does not explicitly assign to Epic 7: it
creates the bare `public.connections` table.** That is flagged prominently below and
in the final report — it is a decision this story makes to resolve a genuine ordering
conflict in the plan, not scope quietly annexed from Epic 8.

### The cross-epic conflict this story resolves, and the decision

AD-20 ("A connection is a third scope, owned by neither party") binds **both**
Epic 7's FRs (94-99, via AD-22) **and** Epic 8's FRs (108-113). A connection-scoped
thread — which this story's own AC requires for shadchan↔single — cannot exist without
the `connections` table. But the epic list sequences **Epic 7 before Epic 8**, and
Epic 8 Story 8.2 ("Consent-based connection") is where the *decision-log* (D17) and the
epics.md FR-coverage map both place the `connections` table's ownership. Two ways to
resolve this were considered:

- **(a) Sequence Epic 8's schema stories ahead of Epic 7.** Rejected — it would mean
  silently reordering the epic list, which is not this document's authority to do, and
  it would leave 7.4 unbuildable as written until someone else acts on that
  reordering.
- **(b) This story creates the bare `connections` table as shared scaffolding, and
  Epic 8 builds the consent workflow on top of it.** **Chosen.** `connections` needs
  to exist as a table+RLS the moment any story needs `connection_id` as a foreign
  target (AD-1's rule that a table's scoping axis exists before anything can point at
  it) — which is *this* story, given the pinned order. Epic 8 Story 8.2 does **not**
  recreate the table; it adds the propose/accept/end **RPCs** (the actual consent
  workflow) and the UI, using the table this story ships.

**What this story explicitly does NOT build:** any way for a user to actually propose
or accept a connection. `connections` in this story is **read-only to `authenticated`**
(no INSERT/UPDATE/DELETE policy for `authenticated` at all — see Dev Notes "Why
`connections` ships without a write path here"). Rows are created directly (service
role / test fixtures) until Epic 8 ships the consent RPCs. This story's own AC is
about the **thread** system correctly permitting a connection-scoped pairing once a
connection exists — not about how the connection came to exist.

## Acceptance Criteria

1. **The `connections` table exists and is correctly scoped.**
   `public.connections(household_account_id, shadchanus_account_id, status)` exists
   per AD-20, with `status ∈ ('pending', 'accepted', 'ended')`, `FORCE ROW LEVEL
   SECURITY`, readable by a member of **either** side, and a trigger rejecting a row
   where `household_account_id`'s account isn't `kind='household'` or
   `shadchanus_account_id`'s account isn't `kind='shadchanus'` (relies on Epic 2's
   `accounts.kind`).

2. **`connections` has no client write path.** No INSERT/UPDATE/DELETE RLS policy
   exists for `authenticated` (mirrors `subscription`/`ai_usage`'s "read-only,
   service-role writes" precedent) — see Dev Notes for why this is a hard requirement,
   not a shortcut.

3. **Threads gain a second scope axis.** `threads`, `thread_participants` and
   `messages` each gain a nullable `connection_id`, `account_id` becomes nullable, and
   each table enforces "exactly one of `account_id`/`connection_id` is set" (AD-1). The
   composite-FK machinery from 7.1 (`(account_id, id)`) is joined by a second
   `(connection_id, id)` composite unique key + FK pair, using `MATCH SIMPLE`
   semantics so exactly one FK is ever live per row (see Dev Notes).

4. **`create_thread()` accepts a connection.** A new `p_connection_id` parameter: when
   supplied, the caller's active context must be a member of one side of that
   connection with `status = 'accepted'`, or the call raises; the thread is created
   with `connection_id` set and `account_id` null. When a connection-scoped thread's
   subject is a `shidduch`, the subject must belong to the connection's
   `household_account_id` specifically (a shadchan's active context is the
   *shadchanus* account, which never holds `shidduchim` rows — AD-2).

5. **`thread_is_readable()` gains a third branch**, structurally identical to the
   account branch: for a connection-scoped thread, readability requires the caller's
   active context to be a member of the connection (either side) with
   `status = 'accepted'`, then applies the exact same open/private resolution as the
   account branch (7.1/7.3's logic, not reimplemented).

6. **INSERT policies work for both axes, not just SELECT.** 7.1's `messages`/
   `thread_participants`/`threads` `with check` clauses test
   `account_id = current_context_id()`, which is unconditionally `false` for a
   connection-scoped row (`account_id` is `NULL`). Every INSERT policy touched by this
   story is rewritten to accept **either** axis — a connection-scoped message from a
   valid connection member must actually be insertable, not silently rejected by a
   check nobody updated (see Dev Notes "The INSERT-policy gap this story must close").

7. **Given any two parties — parent↔parent, parent↔single, parent↔shadchan,
   single↔shadchan — a private thread between them is permitted and scoped to them,
   and shadchan↔single is enabled by default, not gated off.** Tested with a directly
   seeded `accepted` connection (per AC-2, this story cannot test via a real
   propose/accept UI flow — see Dev Notes).

8. **Verification — the negative test.** A shadchan whose shadchanus is **not** party
   to a given connection gets zero rows from that connection's threads/messages, even
   though they hold the `shadchan` role generally; a household member of a **different**
   household than the one in the connection gets zero rows likewise.

9. **Verification — the toolchain is green**, including all of `threads_entity.sql`'s
   prior (7.1-7.3) assertions still passing unchanged.

## Tasks / Subtasks

- [ ] **Task 1 — The bare `connections` table** (AC: 1, 2)
  - [ ] `supabase/schemas/01_tables.sql`: `public.connections(id, household_account_id
        bigint not null, shadchanus_account_id bigint not null, status text not null
        default 'pending', created_at, ended_at timestamptz)`, with
        `connections_status_check check (status in ('pending','accepted','ended'))`
        and `connections_household_shadchanus_key unique
        (household_account_id, shadchanus_account_id)` (no duplicate connections
        between the same pair).
  - [ ] FKs: `household_account_id`/`shadchanus_account_id` → `accounts(id) on delete
        cascade`.
  - [ ] `supabase/schemas/02_functions.sql`: `enforce_connection_account_kinds()`
        (`before insert or update on connections`) — raises unless
        `(select kind from accounts where id = new.household_account_id) =
        'household'` and `(select kind from accounts where id =
        new.shadchanus_account_id) = 'shadchanus'`. Wire in `04_triggers.sql`.
  - [ ] `05_policies.sql`: `enable row level security` + `force row level security`;
        **one policy only**: `for select to authenticated using
        (household_account_id = current_context_id() or shadchanus_account_id =
        current_context_id())`. Deliberately no `for insert`/`for update`/`for delete`
        policy — see AC-2 and Dev Notes.
  - [ ] `06_grants.sql`: `revoke all on table connections from anon;` `grant select on
        table connections to authenticated;` `grant all on table connections to
        service_role;` (mirrors `subscription`/`ai_usage`,
        `06_grants.sql`'s read-only-to-authenticated pattern).

- [ ] **Task 2 — Widen `threads`/`thread_participants`/`messages` to the dual axis**
      (AC: 3)
  - [ ] `01_tables.sql`: `alter column account_id drop not null` on all three; add
        `connection_id bigint` to all three; add the XOR check on each:
        `constraint <table>_scope_check check ((account_id is not null and
        connection_id is null) or (account_id is null and connection_id is not
        null))`.
  - [ ] Add `threads_connection_id_id_key unique (connection_id, id)` alongside 7.1's
        `threads_account_id_id_key`. FK `threads_connection_id_fkey` →
        `connections(id) on delete cascade`.
  - [ ] For `thread_participants`/`messages`: add the second composite FK
        `(connection_id, thread_id) references threads(connection_id, id)` alongside
        7.1's `(account_id, thread_id) references threads(account_id, id)`. Because
        Postgres FK `MATCH SIMPLE` skips the check when *any* referencing column is
        null, an account-scoped row (connection_id null) is checked only by the first
        FK and trivially passes the second; a connection-scoped row (account_id null)
        is the reverse. This is the **first** dual-axis child table in the schema —
        there is no existing FK pair to copy; verify it manually with two INSERTs
        (one each axis) before relying on it in tests.
  - [ ] Update `set_thread_defaults()`/`set_thread_participant_defaults()`/
        `set_message_defaults()` (7.1): each must derive its *own* scope column from
        whichever axis the parent row uses — e.g. `set_message_defaults()` copies
        `account_id` **and** `connection_id` from the parent `threads` row (whichever
        is non-null), not just `account_id`.

- [ ] **Task 3 — `create_thread()` v3 and the household-side subject check** (AC: 4)
  - [ ] `CREATE OR REPLACE FUNCTION create_thread(…, p_connection_id bigint default
        null)`: when `p_connection_id` is supplied, validate `exists (select 1 from
        connections c where c.id = p_connection_id and c.status = 'accepted' and
        (c.household_account_id = current_context_id() or
        c.shadchanus_account_id = current_context_id()))` or raise; set
        `connection_id := p_connection_id`, `account_id := null`. When
        `p_subject_type = 'shidduch'` **and** `p_connection_id` is supplied, the
        existing subject-exists check (7.1) must additionally resolve against the
        connection's `household_account_id` (not `current_context_id()`, which for a
        shadchan caller is their *shadchanus* account and never holds `shidduchim`
        rows — AD-4: "the resulting suggestion is owned by the household").
  - [ ] Participant validation: when connection-scoped, an id in
        `p_participant_member_ids` is accepted if it belongs to **either** side of the
        connection (household or shadchanus), not just the caller's own account.

- [ ] **Task 4 — `thread_is_readable()` v3** (AC: 5, 8)
  - [ ] `CREATE OR REPLACE FUNCTION thread_is_readable`: branch first on which scope
        column is set. If `account_id is not null`, run 7.1/7.3's existing logic
        unchanged. If `connection_id is not null`: deny unless
        `exists (select 1 from connections c where c.id = threads.connection_id and
        c.status = 'accepted' and (c.household_account_id = current_context_id() or
        c.shadchanus_account_id = current_context_id()))`; if that passes, apply the
        **identical** open/private resolution as the account branch (extract the
        open/private decision into a shared local step inside the function so it is
        written once, not duplicated per branch).

- [ ] **Task 4a — Fix the INSERT policies for the new axis** (AC: 6)
  - [ ] Add a small helper predicate (inline in each policy, or a
        `public.connection_is_active_for_caller(p_connection_id bigint) returns
        boolean STABLE SECURITY DEFINER` if repeating it three times gets noisy):
        `exists (select 1 from connections c where c.id = p_connection_id and
        c.status = 'accepted' and (c.household_account_id = current_context_id() or
        c.shadchanus_account_id = current_context_id()))`.
  - [ ] `threads` INSERT: `with check ((account_id = current_context_id() and
        connection_id is null) or (connection_id is not null and
        connection_is_active_for_caller(connection_id)))`.
  - [ ] `thread_participants` INSERT: same shape, `account_id`/`connection_id` read
        off the row being inserted.
  - [ ] `messages` INSERT: same shape **and** keep 7.1's participant-membership
        `exists` clause unchanged — a connection-scoped message still requires the
        caller to be a listed `thread_participants` member of that thread, exactly
        like the account-scoped case (AC-6 of Story 7.1 is not relaxed by this axis).
  - [ ] Add a positive test to `threads_entity.sql`: the shadchan side of the AC-7
        connection actually posts a message via `dataProvider.create("messages", …)`
        (not just via a service-role seed) and it succeeds — this is the assertion
        that would have silently failed without this task.

- [ ] **Task 4b — Generate and hand-check the migration** (AC: 1, 2, 3, 6)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        connections_and_dual_scope`. Hand-check carefully — this is the most
        consequential migration in the epic: (a) confirm `connections` gets
        `ALTER TABLE … FORCE ROW LEVEL SECURITY;` explicitly (7.4's Task 6 pattern);
        (b) confirm the `alter column account_id drop not null` on all three widened
        tables is present (an easy one for `db diff` to fold silently into a table
        rewrite instead — verify the diff is a plain `ALTER COLUMN`, not a
        drop/recreate that would lose data); (c) confirm **both** composite FKs per
        widened child table are present, not just the account one — `db diff` has been
        known to under-emit multi-column FKs when a similar single-column one already
        exists; add any missing statement by hand.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`, never `db push`. Manually verify the dual-axis FK behavior with two
        throwaway INSERTs (one `account_id`-scoped, one `connection_id`-scoped row on
        `threads`) before trusting it in the test suite, per Task 2's own instruction.

- [ ] **Task 5 — Types and provider** (AC: 4)
  - [ ] `types.ts`: add `Connection` type (`household_account_id`,
        `shadchanus_account_id`, `status`, `ended_at`); add `connection_id?:
        Identifier | null;` to `Thread`/`ThreadParticipant`/`Message`; add
        `connection_id?: Identifier;` to `CreateThreadInput`.
  - [ ] `providers/supabase/dataProvider.ts`: extend `createThread()`'s RPC call with
        `p_connection_id: input.connection_id ?? null`.
  - [ ] Mirror in `providers/fakerest/` (AD-10) — including a `db.connections`
        collection seeded (as `accepted`) for demo/dev purposes, since there is no
        in-app way to create one yet.

- [ ] **Task 6 — Tests** (AC: 6, 7, 8, 9)
  - [ ] Extend `supabase/tests/threads_entity.sql`: seed a household account, a
        shadchanus account, and a `connections` row with `status='accepted'` directly
        (service-role insert — the only way to create one before Epic 8); create a
        `subject_type='relationship'` private thread scoped to that connection with
        the household's single and the shadchan as participants; assert both sides
        read it and its message (AC-7). Add the AC-8 negative tests: a second,
        unconnected shadchanus account reads zero rows; a second, unrelated household
        reads zero rows.
  - [ ] Re-run the full suite to confirm no 7.1–7.3 regressions (AC-9).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        prettier on this story's changed files only.

## Dev Notes

### Why `connections` ships without a write path here

If this story added a plain `for all` RLS policy on `connections` (the pattern used
for most domain tables), any authenticated household member could
`dataProvider.create("connections", { household_account_id: mine, shadchanus_account_id:
anyone's, status: "accepted" })` and self-grant a connection to **any** shadchan without
their consent — a direct violation of FR109 ("no directory-driven or automatic
linkage") and AD-20, in the very story that is supposed to be proving pairings are
*permitted*, not that consent is *bypassable*. The `subscription`/`ai_usage` tables
already establish the precedent in this schema for "read-only to `authenticated`,
every write is `service_role`" (`05_policies.sql:251-268`) specifically to prevent a
client from self-granting something that must only ever result from a server-verified
event. `connections` needs the identical treatment until Epic 8 Story 8.2 adds the
actual consent RPCs (`propose_connection` / `accept_connection` / `end_connection`,
presumably SECURITY DEFINER, checking that the caller is the *other* side before
transitioning `status`). **Epic 8 must not re-create this table or its RLS policy** —
it adds RPCs on top of what this story ships.

### Why this story, not 8.1/8.2, creates the table

AD-1's rule ("every table has FORCE ROW LEVEL SECURITY … each table's migration adds
its RLS in the same migration") and this story's own AC-7 (a real,
database-verified shadchan↔single private thread) cannot be satisfied by a forward
reference to a table that doesn't exist yet. Given the epics.md pinned order places
Epic 7 before Epic 8, the schema dependency has to be satisfied here. This is called
out as a **flagged cross-epic decision** in the story header and will be repeated in
the epic-writer's final report — it is exactly the kind of thing epics.md doesn't
currently state as a dependency.

### The INSERT-policy gap this story must close

7.1's `with check` clauses on `threads`/`thread_participants`/`messages` all test
`account_id = current_context_id()`. Widening the tables to allow `connection_id`
instead (Task 2) without also widening these three `with check` clauses (Task 4a) would
leave every connection-scoped INSERT rejected by RLS — `NULL = current_context_id()`
is never true — while `thread_is_readable()` (Task 4) would report the row as
perfectly readable once it existed. That combination (unreadable-to-insert,
readable-once-inserted) is exactly the kind of half-migrated policy that passes a
lazy manual smoke test (an operator seeds the row directly, as the tests here also
do) but breaks the very first real user action. Task 4a exists specifically so this
doesn't ship silently broken; the Task 4a positive test (a real client-side INSERT,
not a service-role seed) is what actually catches it.

### The dual-axis composite-FK trick, spelled out

For a table `T` with both `account_id` and `connection_id` (mutually exclusive) that
needs to reference a parent `P` with the same dual axis:

```sql
alter table public.P
  add constraint p_account_id_id_key unique (account_id, id),
  add constraint p_connection_id_id_key unique (connection_id, id);

alter table public.T
  add constraint t_p_id_fkey_account
    foreign key (account_id, p_id) references public.P(account_id, id) on delete cascade,
  add constraint t_p_id_fkey_connection
    foreign key (connection_id, p_id) references public.P(connection_id, id) on delete cascade;
```

Postgres's default `MATCH SIMPLE` means a multi-column FK is satisfied trivially
(not checked) if **any** of its own columns is NULL. So on an account-scoped row of
`T` (`connection_id` is NULL), `t_p_id_fkey_connection` is not checked at all, and only
`t_p_id_fkey_account` does real work; the reverse holds for a connection-scoped row.
Both constraints must exist for the "exactly one axis is real" guarantee to actually
be enforced by the database rather than merely assumed.

### The household-side subject check

A shadchan's active context is always their **shadchanus** account (AD-2: "a
shadchanus context may never contain household domain rows"). When a shadchan
initiates or is added to a connection-scoped thread about a specific `shidduch`,
`current_context_id()` cannot be used to validate the subject (it resolves to the
shadchanus account, which holds no `shidduchim` rows at all) — the check must instead
walk `connections.household_account_id` to find the household side, then verify the
`shidduchim` row belongs to it. This mirrors AD-4's own statement that "the resulting
suggestion is owned by the household; only the conversation about it is
connection-scoped."

### References

- [Source: ARCHITECTURE-SPINE.md#AD-20] — the connection as a third scope; "a shadchan
  therefore cannot address a household row at all — FR113 is structural."
- [Source: ARCHITECTURE-SPINE.md#AD-1] — exactly one scoping axis per row; FORCE RLS.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — "a shadchanus context may never contain
  household domain rows."
- [Source: ARCHITECTURE-SPINE.md#AD-4] — suggestions redted through a connection still
  belong to the household.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md#D17]
  — groups "Shadchan context + connections + messaging" as one delivery slice, which
  is the root of the cross-epic ordering tension this story resolves.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-8-Shadchan-Context] — Story
  8.2 "Consent-based connection" is where the propose/accept RPCs belong, on top of
  this story's table.
- `supabase/schemas/05_policies.sql:251-268` (`subscription`/`ai_usage` — the
  read-only-to-authenticated precedent).
- `supabase/schemas/01_tables.sql:654-666` (existing single-axis composite-FK
  precedent, extended here to the dual-axis case).
- Story `7-1-thread-model.md` — the functions and tables this story widens.

### Project Structure Notes

- No new directories; all changes land in the existing `supabase/schemas/*` files and
  `threads/`/`types.ts`/provider files from 7.1.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
